/**
 * ============================================================================
 *  FILE: 16_Documents.gs
 *  ROLE: Employee document vault with expiry tracking (§9.8). Files live in the
 *        company's private Drive folder and are served only through the
 *        token-gated `getFile` action (§10).
 * ============================================================================
 */

function documentDto_(d, ctx) {
  if (!d) return null;
  var umap = ctx && ctx.__userMap ? ctx.__userMap : null;
  var u = umap ? (umap[String(d.UserID)] || {}) : {};
  return {
    docId: d.DocID, userId: d.UserID, userName: u.Name || '', docType: d.DocType,
    fileName: d.FileName || '', driveLink: d.DriveLink || '', fileId: d.FileId || '',
    expiryDate: d.ExpiryDate || '', status: d.Status || 'Valid',
    uploadedBy: d.UploadedBy || '', uploadedAt: d.UploadedAt || '',
    alertSentAt: d.AlertSentAt || '', expiryAlertDays: num_(d.ExpiryAlertDays, 15),
    notes: d.Notes || '',
    daysToExpiry: d.ExpiryDate ? Math.ceil((toDate_(d.ExpiryDate).getTime() - Date.now()) / 86400000) : null
  };
}

function expiryStatus_(expiryDate, alertDays) {
  if (!expiryDate) return 'Valid';
  var days = Math.ceil((toDate_(expiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Expired';
  if (days <= num_(alertDays, 15)) return 'ExpiringSoon';
  return 'Valid';
}

function actionListDocuments(payload, ctx) {
  var ss = ctx.ss;
  var ctxLocal = ctx;
  ctxLocal.__userMap = userMap_(ss);
  var rows = readTable_(ss, 'Documents');

  if (String(ctx.role) === ROLES.EMPLOYEE) {
    rows = rows.filter(function (d) { return String(d.UserID) === ctx.userId; });
  } else if (!scopeIsAll_(ctx) && !can_(ctx, 'viewAllEmployees')) {
    var allowed = {};
    readTable_(ss, 'ProjectAssignments').forEach(function (a) {
      if (inScope_(ctx, a.ProjectID)) allowed[String(a.UserID)] = true;
    });
    rows = rows.filter(function (d) { return allowed[String(d.UserID)]; });
  }

  var userId = str_(payload.userId, 40);
  if (userId) {
    if (String(ctx.role) === ROLES.EMPLOYEE && userId !== ctx.userId) throw new ApiError_('Not permitted', 403);
    rows = rows.filter(function (d) { return String(d.UserID) === userId; });
  }
  var docType = str_(payload.docType, 40);
  if (docType) rows = rows.filter(function (d) { return String(d.DocType) === docType; });
  var status = str_(payload.status, 20);

  // Refresh computed status so the list always reflects today's date.
  rows = rows.map(function (d) {
    d.Status = d.Status === 'Rejected' ? 'Rejected' : expiryStatus_(d.ExpiryDate, d.ExpiryAlertDays);
    return d;
  });
  if (status) rows = rows.filter(function (d) { return String(d.Status) === status; });

  rows = sortBy_(rows, function (d) { return String(d.ExpiryDate || '9999'); });
  return {
    count: rows.length,
    expiringSoon: rows.filter(function (d) { return String(d.Status) === 'ExpiringSoon'; }).length,
    expired: rows.filter(function (d) { return String(d.Status) === 'Expired'; }).length,
    documents: rows.slice(0, 500).map(function (d) { return documentDto_(d, ctxLocal); })
  };
}

function actionUploadDocument(payload, ctx) {
  requireFields_(payload, ['docType']);
  var ss = ctx.ss;
  var forUserId = str_(payload.userId, 40) || ctx.userId;
  if (forUserId !== ctx.userId) {
    assertStaff_(ctx);
    assert_(can_(ctx, 'manageDocuments') || can_(ctx, 'editEmployees'),
      'You need document management rights to upload for another employee', 403);
  }
  var user = findRecord_(ss, 'Users', 'UserID', forUserId);
  assert_(user, 'User not found', 404);
  var docType = pickOne_(payload.docType, DOC_TYPES, '');
  assert_(docType, 'docType must be one of: ' + DOC_TYPES.join(', '), 400);

  var expiry = '';
  if (!isBlank_(payload.expiryDate)) {
    assert_(isIsoDate_(payload.expiryDate), 'expiryDate must be yyyy-mm-dd', 400);
    expiry = payload.expiryDate;
  }
  var noExpiryTypes = ['AadhaarCard', 'PANCard', 'VoterID', 'Photo', 'Resume', 'BankPassbook'];
  if (!expiry && noExpiryTypes.indexOf(docType) < 0 && String(payload.hasExpiry || 'N') === 'Y') {
    throw new ApiError_('An expiry date is required for ' + docType, 400);
  }

  var link = '', fileId = '', fileName = str_(payload.fileName, 160) || (docType + '-' + forUserId);
  if (!isBlank_(payload.fileBase64)) {
    var mime = str_(payload.fileMime, 'application/octet-stream');
    var stored = storeCompanyUpload_(ctx.company, 'Documents',
      docType + '-' + forUserId + '-' + shortId_(4), String(payload.fileBase64), mime);
    link = stored.link; fileId = stored.fileId; fileName = stored.name || fileName;
  } else if (!isBlank_(payload.driveLink)) {
    link = str_(payload.driveLink, 400);
  } else {
    throw new ApiError_('Provide fileBase64 or an existing driveLink', 400);
  }

  var alertDays = num_(payload.expiryAlertDays, 15);
  var docId = str_(payload.docId, 40);
  if (docId) {
    var existing = findRecord_(ss, 'Documents', 'DocID', docId);
    assert_(existing, 'Document not found', 404);
    var updated = updateRecord_(ss, 'Documents', 'DocID', docId, {
      DocType: docType, DriveLink: link, FileId: fileId, FileName: fileName,
      ExpiryDate: expiry, Status: expiryStatus_(expiry, alertDays),
      ExpiryAlertDays: String(alertDays), UploadedBy: ctx.userId,
      UploadedAt: fmtDateTime_(new Date()), Notes: str_(payload.notes, 300)
    });
    audit_(ss, ctx, 'UPDATE_DOCUMENT', 'Documents', docId, { type: docType, user: forUserId }, 'OK');
    return { docId: docId, updated: true, document: documentDto_(updated, ctx) };
  }

  var row = {
    DocID: id_('DOC'),
    UserID: forUserId,
    DocType: docType,
    DriveLink: link,
    FileId: fileId,
    FileName: fileName,
    ExpiryDate: expiry,
    Status: expiryStatus_(expiry, alertDays),
    UploadedBy: ctx.userId,
    UploadedAt: fmtDateTime_(new Date()),
    ExpiryAlertDays: String(alertDays),
    Notes: str_(payload.notes, 300)
  };
  appendRecord_(ss, 'Documents', row);
  audit_(ss, ctx, 'UPLOAD_DOCUMENT', 'Documents', row.DocID,
    { type: docType, user: forUserId, expiry: expiry }, 'OK');
  notify_(ss, forUserId, 'Document uploaded',
    docType + ' was added to your document vault' + (expiry ? ' (valid till ' + expiry + ')' : '') + '.', 'Info');
  return { docId: row.DocID, created: true, document: documentDto_(row, ctx) };
}

function actionUpdateDocument(payload, ctx) {
  requireFields_(payload, ['docId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Documents', 'DocID', payload.docId);
  assert_(row, 'Document not found', 404);
  var patch = {};
  if (payload.expiryDate !== undefined) {
    var expiry = str_(payload.expiryDate, 12);
    if (expiry) assert_(isIsoDate_(expiry), 'expiryDate must be yyyy-mm-dd', 400);
    patch.ExpiryDate = expiry;
    patch.Status = expiryStatus_(expiry, row.ExpiryAlertDays);
    patch.AlertSentAt = '';
  }
  if (payload.status !== undefined) {
    // An unrecognised value is a client bug — say so instead of quietly keeping the old status.
    var nextStatus = pickOne_(payload.status, ['Valid', 'ExpiringSoon', 'Expired', 'Rejected'], '');
    assert_(nextStatus, 'status must be Valid, ExpiringSoon, Expired or Rejected', 400);
    patch.Status = nextStatus;
  }
  if (payload.notes !== undefined) patch.Notes = str_(payload.notes, 300);
  if (payload.docType !== undefined) {
    var nextType = pickOne_(payload.docType, DOC_TYPES, '');
    assert_(nextType, 'Unknown document type', 400);
    patch.DocType = nextType;
  }
  if (payload.expiryAlertDays !== undefined) patch.ExpiryAlertDays = String(num_(payload.expiryAlertDays, 15));
  assert_(Object.keys(patch).length, 'Nothing to update', 400);
  var updated = updateRecord_(ss, 'Documents', 'DocID', row.DocID, patch);
  audit_(ss, ctx, 'UPDATE_DOCUMENT', 'Documents', row.DocID, Object.keys(patch).join(','), 'OK');
  return { docId: row.DocID, updated: true, document: documentDto_(updated, ctx) };
}

function actionDeleteDocument(payload, ctx) {
  requireFields_(payload, ['docId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Documents', 'DocID', payload.docId);
  assert_(row, 'Document not found', 404);
  if (row.FileId) trashDriveFile_(row.FileId);
  deleteRecord_(ss, 'Documents', 'DocID', row.DocID);
  audit_(ss, ctx, 'DELETE_DOCUMENT', 'Documents', row.DocID, { type: row.DocType, user: row.UserID }, 'OK');
  return { docId: row.DocID, deleted: true };
}
