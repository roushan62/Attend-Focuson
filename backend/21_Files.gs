/**
 * ============================================================================
 *  FILE: 21_Files.gs
 *  ROLE: All Drive I/O — selfie/document/proof uploads into a private,
 *        per-company folder tree, and token-gated retrieval (§10).
 *
 *  Files are NEVER publicly shared. The frontend fetches bytes through the
 *  `getFile` action, which re-checks permissions on every request.
 * ============================================================================
 */

/** Split a possible data-URL into { mime, base64 }. */
function parseDataUrl_(dataUrl, defaultMime) {
  var s = String(dataUrl || '').trim();
  var mime = defaultMime || 'application/octet-stream';
  if (s.indexOf('data:') === 0) {
    var comma = s.indexOf(',');
    var header = s.substring(5, comma);
    var parts = header.split(';');
    if (parts[0]) mime = parts[0];
    s = s.substring(comma + 1);
  }
  s = s.replace(/\s+/g, '');
  return { mime: mime, base64: s };
}

function extensionForMime_(mime) {
  var map = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/octet-stream': 'bin'
  };
  return map[String(mime).toLowerCase()] || 'bin';
}

/**
 * Store a base64 file in the company's private Drive folder tree.
 * Returns { fileId, link, name, folder }.
 */
function storeCompanyUpload_(company, subFolder, baseName, dataUrl, mime) {
  var parsed = parseDataUrl_(dataUrl, mime);
  assert_(parsed.base64.length > 0, 'Empty file payload', 400);
  var maxBytes = num_(prop_(PROP.SELFIE_MAX_BYTES, ''), 5000000);
  assert_(parsed.base64.length <= maxBytes, 'File is too large (limit ' +
    Math.round(maxBytes / 1048576) + ' MB)', 413);

  var folder = companySubFolder_(company, subFolder || 'Documents', true);
  if (!folder) {
    // Drive unreachable — keep the workflow alive with a placeholder link.
    Logger.log('Drive folder unavailable; storing placeholder for ' + baseName);
    return { fileId: '', link: '', name: baseName, stored: false };
  }
  var safeName = String(baseName).replace(/[^A-Za-z0-9._-]/g, '-').substring(0, 80) +
    '-' + shortId_(4) + '.' + extensionForMime_(parsed.mime);

  var bytes = Utilities.base64Decode(parsed.base64);
  var blob = Utilities.newBlob(bytes, parsed.mime, safeName);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) { }
  try { file.setDescription('SiteTrack upload — company ' + (company ? company.CompanyID : '')); } catch (e2) { }

  return {
    fileId: file.getId(),
    link: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    name: safeName,
    mime: parsed.mime,
    bytes: bytes.length,
    folder: folder.getName(),
    stored: true
  };
}

/** Selfies are filed by date so a month of site photos is easy to browse. */
function storeSelfie_(company, userId, projectId, when, dataUrl, mime) {
  var d = toDate_(when);
  var ym = Utilities.formatDate(d, 'UTC', 'yyyy-MM');
  var folder = companySubFolder_(company, 'Selfies', true);
  var monthFolder = folder;
  if (folder) {
    var it = folder.getFoldersByName(ym);
    monthFolder = it.hasNext() ? it.next() : folder.createFolder(ym);
  }
  if (!monthFolder) return { fileId: '', link: '', name: '', stored: false };

  var parsed = parseDataUrl_(dataUrl, mime || 'image/jpeg');
  var name = 'selfie-' + userId + '-' + Utilities.formatDate(d, 'UTC', 'yyyyMMdd-HHmmss') +
    '-' + shortId_(3) + '.' + extensionForMime_(parsed.mime);
  var bytes = Utilities.base64Decode(parsed.base64);
  var file = monthFolder.createFile(Utilities.newBlob(bytes, parsed.mime, name));
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { }
  return {
    fileId: file.getId(),
    link: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    name: name,
    bytes: bytes.length,
    stored: true
  };
}

/** Upload that is not tied to a company yet (e.g. a logo during signup). */
function storeTempUpload_(company, subFolder, baseName, dataUrl, mime) {
  try {
    var parsed = parseDataUrl_(dataUrl, mime);
    var rootId = prop_(PROP.DRIVE_ROOT_ID, '');
    var root = null;
    if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; } }
    if (!root) { root = DriveApp.createFolder('SiteTrack'); setProp_(PROP.DRIVE_ROOT_ID, root.getId()); }
    var it = root.getFoldersByName(subFolder || 'Temp');
    var folder = it.hasNext() ? it.next() : root.createFolder(subFolder || 'Temp');
    var name = String(baseName).replace(/[^A-Za-z0-9._-]/g, '-') + '.' + extensionForMime_(parsed.mime);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(parsed.base64), parsed.mime, name));
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e2) { }
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch (e) {
    Logger.log('storeTempUpload_ failed: ' + e.message);
    return '';
  }
}

function trashDriveFile_(fileId) {
  try {
    if (!fileId) return false;
    DriveApp.getFileById(String(fileId)).setTrashed(true);
    return true;
  } catch (e) {
    Logger.log('trashDriveFile_ failed: ' + e.message);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Token-gated retrieval                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A file may be read only if it is referenced by a record the caller can see.
 * This is what keeps selfies and ID proofs out of public link sharing (§10).
 */
function canAccessFile_(ss, ctx, fileId) {
  if (!fileId) return false;
  if (ctx.isOwner) return true;
  var fid = String(fileId);

  var checks = [
    { tab: 'Attendance', fields: ['SelfieFileId'], scopeField: 'ProjectID' },
    { tab: 'VendorWorkers', fields: ['PhotoFileId'], scopeField: 'ProjectID' },
    { tab: 'ExpenseRequests', fields: ['ProofFileId'], scopeField: 'ProjectID' },
    { tab: 'RegularizationRequests', fields: ['ProofFileId'], scopeField: 'ProjectID' },
    { tab: 'Documents', fields: ['FileId'], scopeField: null, userField: 'UserID' }
  ];

  for (var i = 0; i < checks.length; i++) {
    var spec = checks[i];
    var rows = readTable_(ss, spec.tab);
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var matched = spec.fields.some(function (f) { return String(row[f] || '') === fid; });
      if (!matched) continue;
      if (String(ctx.role) === ROLES.EMPLOYEE) {
        var ownerField = spec.userField || 'UserID';
        if (String(row[ownerField]) === String(ctx.userId)) return true;
        continue;
      }
      if (spec.scopeField && !scopeIsAll_(ctx)) {
        if (inScope_(ctx, row[spec.scopeField])) return true;
        continue;
      }
      return true;
    }
  }
  return false;
}

function actionGetFile(payload, ctx) {
  requireFields_(payload, ['fileId']);
  var ss = ctx.ss;
  var fileId = str_(payload.fileId, 200);
  assert_(canAccessFile_(ss, ctx, fileId), 'You do not have access to this file', 403);

  var file = null;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw new ApiError_('File not found in Drive (it may have been deleted)', 404);
  }
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  var mime = blob.getContentType ? blob.getContentType() : 'application/octet-stream';
  var maxBytes = 8 * 1024 * 1024;
  assert_(bytes.length <= maxBytes, 'File is too large to stream through the API', 413);

  audit_(ss, ctx, 'FILE_ACCESS', 'Drive', fileId, { name: file.getName(), bytes: bytes.length }, 'OK');

  return {
    fileId: fileId,
    name: file.getName(),
    mime: mime,
    size: bytes.length,
    dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes),
    url: 'https://drive.google.com/file/d/' + fileId + '/view'
  };
}
