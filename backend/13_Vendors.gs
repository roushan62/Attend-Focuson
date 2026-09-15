/**
 * ============================================================================
 *  FILE: 13_Vendors.gs
 *  ROLE: Sub-vendor manpower module (§6 Vendors / VendorWorkers, §7 report 5).
 *        Site supervisors can log vendor headcount daily; admins manage vendors.
 * ============================================================================
 */

/** Only these on-site roles may log vendor workers from the mobile app (§8). */
var VENDOR_LOGGING_ROLES = ['Supervisor', 'SiteIncharge', 'ProjectManager', 'Engineer', 'Foreman'];

function canLogVendorWorkers_(ss, ctx) {
  if (isStaffRole_(ctx.role)) return can_(ctx, 'manageVendors') || scopeIsAll_(ctx);
  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', ctx.userId)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  return assignments.some(function (a) {
    return VENDOR_LOGGING_ROLES.indexOf(String(a.RoleOnSite)) >= 0;
  });
}

function vendorDto_(v) {
  return {
    vendorId: v.VendorID, vendorName: v.VendorName, contactPerson: v.ContactPerson || '',
    mobile: v.Mobile || '', projectIds: String(v.ProjectIDs || '').split(',').filter(function (x) { return x; }),
    status: v.Status, gst: v.GST || '', address: v.Address || '', email: v.Email || '',
    ratePerHead: num_(v.RatePerHead, 0), paymentTerms: v.PaymentTerms || '',
    createdAt: v.CreatedAt || '', notes: v.Notes || ''
  };
}

function actionListVendors(payload, ctx) {
  var ss = ctx.ss;
  var rows = readTable_(ss, 'Vendors');
  if (String(ctx.role) === ROLES.EMPLOYEE) {
    assert_(canLogVendorWorkers_(ss, ctx), 'Your role cannot access the vendor module', 403);
    var mine = {};
    findRecords_(ss, 'ProjectAssignments', 'UserID', ctx.userId).forEach(function (a) {
      if (String(a.Status) === 'Active') mine[String(a.ProjectID)] = true;
    });
    rows = rows.filter(function (v) {
      var ids = String(v.ProjectIDs || '').split(',');
      return ids.some(function (p) { return mine[p.trim()]; });
    });
  } else {
    rows = rows.filter(function (v) {
      if (scopeIsAll_(ctx)) return true;
      var ids = String(v.ProjectIDs || '').split(',');
      return ids.some(function (p) { return inScope_(ctx, p.trim()); });
    });
  }
  var status = str_(payload.status, 20);
  if (status) rows = rows.filter(function (v) { return String(v.Status) === status; });
  var q = str_(payload.query, 60).toLowerCase();
  if (q) {
    rows = rows.filter(function (v) {
      return String(v.VendorName).toLowerCase().indexOf(q) >= 0 ||
        String(v.ContactPerson || '').toLowerCase().indexOf(q) >= 0 ||
        String(v.Mobile || '').indexOf(q) >= 0;
    });
  }
  rows = sortBy_(rows, function (v) { return String(v.VendorName); });

  var workers = readTable_(ss, 'VendorWorkers');
  var activeWorkers = {};
  workers.forEach(function (w) {
    if (String(w.Status) !== 'Left') {
      var k = String(w.VendorID);
      activeWorkers[k] = (activeWorkers[k] || 0) + 1;
    }
  });

  return {
    count: rows.length,
    canLog: canLogVendorWorkers_(ss, ctx),
    vendors: rows.map(function (v) {
      var dto = vendorDto_(v);
      dto.workerCount = activeWorkers[String(v.VendorID)] || 0;
      return dto;
    })
  };
}

function actionSaveVendor(payload, ctx) {
  requireFields_(payload, ['vendorName', 'mobile']);
  var ss = ctx.ss;
  var mobile = normaliseMobile_(payload.mobile);
  assert_(mobileOk_(mobile), 'Enter a valid vendor mobile number', 400);

  var projectIds = jsonList_(payload.projectIds);
  if (typeof payload.projectIds === 'string') projectIds = payload.projectIds.split(',');
  projectIds = projectIds.map(function (p) { return String(p).trim(); }).filter(function (p) { return p; });
  assert_(projectIds.length, 'Select at least one project for this vendor', 400);
  projectIds.forEach(function (p) {
    assertProjectScope_(ctx, p);
    assert_(findRecord_(ss, 'Projects', 'ProjectID', p), 'Project not found: ' + p, 404);
  });

  var vendorId = str_(payload.vendorId, 40);
  if (vendorId) {
    var existing = findRecord_(ss, 'Vendors', 'VendorID', vendorId);
    assert_(existing, 'Vendor not found', 404);
    var updated = updateRecord_(ss, 'Vendors', 'VendorID', vendorId, {
      VendorName: str_(payload.vendorName, 160),
      ContactPerson: str_(payload.contactPerson, 120),
      Mobile: mobile,
      ProjectIDs: projectIds.join(','),
      GST: str_(payload.gst, 32),
      Address: str_(payload.address, 300),
      Email: str_(payload.email, 120).toLowerCase(),
      RatePerHead: String(num_(payload.ratePerHead, num_(existing.RatePerHead, 0))),
      PaymentTerms: str_(payload.paymentTerms, 200),
      Notes: str_(payload.notes, 400),
      Status: pickOne_(payload.status, ['Active', 'Inactive'], String(existing.Status))
    });
    audit_(ss, ctx, 'UPDATE_VENDOR', 'Vendors', vendorId, { name: updated.VendorName }, 'OK');
    return { vendorId: vendorId, updated: true, vendor: vendorDto_(updated) };
  }

  var dup = readTable_(ss, 'Vendors').some(function (v) {
    return String(v.VendorName).toLowerCase() === str_(payload.vendorName, 160).toLowerCase();
  });
  assert_(!dup, 'A vendor with this name already exists', 409);

  var row = {
    VendorID: id_('VND'),
    VendorName: str_(payload.vendorName, 160),
    ContactPerson: str_(payload.contactPerson, 120),
    Mobile: mobile,
    ProjectIDs: projectIds.join(','),
    Status: 'Active',
    GST: str_(payload.gst, 32),
    Address: str_(payload.address, 300),
    Email: str_(payload.email, 120).toLowerCase(),
    RatePerHead: String(num_(payload.ratePerHead, 0)),
    PaymentTerms: str_(payload.paymentTerms, 200),
    CreatedAt: fmtDateTime_(new Date()),
    Notes: str_(payload.notes, 400)
  };
  appendRecord_(ss, 'Vendors', row);
  audit_(ss, ctx, 'CREATE_VENDOR', 'Vendors', row.VendorID, { name: row.VendorName }, 'OK');
  return { vendorId: row.VendorID, created: true, vendor: vendorDto_(row) };
}

function actionSetVendorStatus(payload, ctx) {
  requireFields_(payload, ['vendorId', 'status']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Vendors', 'VendorID', payload.vendorId);
  assert_(row, 'Vendor not found', 404);
  var status = pickOne_(payload.status, ['Active', 'Inactive'], '');
  assert_(status, 'Status must be Active or Inactive', 400);
  updateRecord_(ss, 'Vendors', 'VendorID', row.VendorID, { Status: status });
  audit_(ss, ctx, 'SET_VENDOR_STATUS', 'Vendors', row.VendorID, { status: status }, 'OK');
  return { vendorId: row.VendorID, status: status };
}

/**
 * Log vendor manpower for a day — individual workers by name, or a bulk count.
 * Called from the mobile "Sub-Vendor Log" screen by supervisors (§8).
 */
function actionAddVendorWorkerEntry(payload, ctx) {
  var ss = ctx.ss;
  assert_(canLogVendorWorkers_(ss, ctx), 'Your role cannot log vendor workers. Ask your administrator.', 403);
  requireFields_(payload, ['vendorId']);

  var vendor = findRecord_(ss, 'Vendors', 'VendorID', payload.vendorId);
  assert_(vendor, 'Vendor not found', 404);
  assert_(String(vendor.Status) === 'Active', 'That vendor is inactive', 400);

  var projectId = str_(payload.projectId, 40);
  if (!projectId) {
    var p = resolveMarkProject_(ss, ctx, {});
    projectId = p ? String(p.ProjectID) : '';
  }
  assert_(projectId, 'Select the project where the vendor workers are deployed', 400);
  assertProjectScope_(ctx, projectId);
  assert_(String(vendor.ProjectIDs || '').split(',').indexOf(projectId) >= 0,
    'That vendor is not linked to this project', 400);

  var dateStr = isIsoDate_(payload.date) ? payload.date : today_(ctx.tz);
  assert_(dateStr <= today_(ctx.tz), 'Vendor manpower can only be logged for today or earlier', 400);
  assert_(dateStr >= shiftDate_(today_(ctx.tz), -30), 'Entries older than 30 days cannot be added', 400);

  var ratePerHead = num_(payload.ratePerDay !== undefined ? payload.ratePerDay : vendor.RatePerHead, 0);
  var rows = [];

  var workers = payload.workers;
  if (workers && Object.prototype.toString.call(workers) === '[object Array]' && workers.length) {
    assert_(workers.length <= 200, 'Add at most 200 workers per submission', 400);
    workers.forEach(function (w) {
      var name = str_(w.name || w.workerName, 120);
      assert_(name.length >= 2, 'Worker name is required', 400);
      var photoLink = '', photoFileId = '';
      if (!isBlank_(w.photoBase64)) {
        var stored = storeCompanyUpload_(ctx.company, 'VendorPhotos',
          'vw-' + shortId_(6), String(w.photoBase64), str_(w.photoMime, 'image/jpeg'));
        photoLink = stored.link; photoFileId = stored.fileId;
      }
      rows.push({
        EntryID: id_('VW'),
        VendorID: vendor.VendorID,
        ProjectID: projectId,
        WorkerName: name,
        PhotoDriveLink: photoLink,
        PhotoFileId: photoFileId,
        Designation: str_(w.designation, 60) || str_(payload.designation, 60) || 'Worker',
        Date: dateStr,
        Count: '1',
        MarkedBy: ctx.userId,
        AadhaarMasked: str_(w.aadhaarMasked, 40),
        Mobile: normaliseMobile_(w.mobile || ''),
        RatePerDay: String(num_(w.ratePerDay !== undefined ? w.ratePerDay : ratePerHead, 0)),
        AmountPayable: String(num_(w.ratePerDay !== undefined ? w.ratePerDay : ratePerHead, 0)),
        Status: 'Active',
        CreatedAt: fmtDateTime_(new Date()),
        Notes: str_(w.notes, 200)
      });
    });
  } else {
    // Bulk headcount entry (no individual names) — common for labour contractors.
    var count = Math.round(num_(payload.count, 0));
    assert_(count > 0 && count <= 5000, 'Enter a headcount between 1 and 5000', 400);
    rows.push({
      EntryID: id_('VW'),
      VendorID: vendor.VendorID,
      ProjectID: projectId,
      WorkerName: str_(payload.label, 120) || ('Bulk headcount (' + count + ')'),
      Designation: str_(payload.designation, 60) || 'Worker',
      Date: dateStr,
      Count: String(count),
      MarkedBy: ctx.userId,
      RatePerDay: String(ratePerHead),
      AmountPayable: String(Math.round(ratePerHead * count * 100) / 100),
      Status: 'Active',
      CreatedAt: fmtDateTime_(new Date()),
      Notes: str_(payload.notes, 200)
    });
  }

  appendRecords_(ss, 'VendorWorkers', rows);
  var totalHeads = rows.reduce(function (s, r) { return s + num_(r.Count, 1); }, 0);
  var totalAmount = rows.reduce(function (s, r) { return s + num_(r.AmountPayable, 0); }, 0);
  audit_(ss, ctx, 'VENDOR_WORKER_ENTRY', 'VendorWorkers', vendor.VendorID,
    { vendor: vendor.VendorName, project: projectId, date: dateStr, heads: totalHeads, amount: totalAmount }, 'OK');

  return {
    created: rows.length,
    headcount: totalHeads,
    amountPayable: Math.round(totalAmount * 100) / 100,
    date: dateStr,
    vendor: vendor.VendorName,
    entries: rows.map(function (r) {
      return { entryId: r.EntryID, workerName: r.WorkerName, count: num_(r.Count, 1), designation: r.Designation };
    })
  };
}

function vendorWorkerDto_(w, vendorMap, projectMap, userMap) {
  var v = vendorMap[String(w.VendorID)] || {};
  var p = projectMap[String(w.ProjectID)] || {};
  var m = userMap[String(w.MarkedBy)] || {};
  return {
    entryId: w.EntryID, vendorId: w.VendorID, vendorName: v.VendorName || '',
    projectId: w.ProjectID, projectName: p.Name || '',
    workerName: w.WorkerName || '', designation: w.Designation || '',
    date: w.Date, count: num_(w.Count, 1), markedBy: w.MarkedBy || '', markedByName: m.Name || '',
    mobile: w.Mobile || '', aadhaarMasked: w.AadhaarMasked || '',
    ratePerDay: num_(w.RatePerDay, 0), amountPayable: num_(w.AmountPayable, 0),
    photoLink: w.PhotoDriveLink || '', photoFileId: w.PhotoFileId || '',
    status: w.Status || 'Active', createdAt: w.CreatedAt || '', notes: w.Notes || ''
  };
}

function actionListVendorWorkers(payload, ctx) {
  var ss = ctx.ss;
  var rows = scopedRows_(ctx, readTable_(ss, 'VendorWorkers'), 'ProjectID');
  if (String(ctx.role) === ROLES.EMPLOYEE) {
    assert_(canLogVendorWorkers_(ss, ctx), 'Your role cannot access vendor records', 403);
    var mine = {};
    findRecords_(ss, 'ProjectAssignments', 'UserID', ctx.userId).forEach(function (a) {
      if (String(a.Status) === 'Active') mine[String(a.ProjectID)] = true;
    });
    rows = rows.filter(function (w) { return mine[String(w.ProjectID)]; });
  }
  if (payload.vendorId) rows = rows.filter(function (w) { return String(w.VendorID) === String(payload.vendorId); });
  if (payload.projectId) rows = rows.filter(function (w) { return String(w.ProjectID) === String(payload.projectId); });
  if (isIsoDate_(payload.from)) rows = rows.filter(function (w) { return String(w.Date) >= payload.from; });
  if (isIsoDate_(payload.to)) rows = rows.filter(function (w) { return String(w.Date) <= payload.to; });
  if (isIsoDate_(payload.date)) rows = rows.filter(function (w) { return String(w.Date) === payload.date; });
  rows = sortBy_(rows, function (w) { return String(w.Date) + String(w.CreatedAt); }, true);

  var vendorMap = indexBy_(readTable_(ss, 'Vendors'), 'VendorID');
  var projectMap = projectMap_(ss);
  var userMap = userMap_(ss);
  var limit = Math.min(Math.max(num_(payload.limit, 300), 1), 2000);
  var slice = rows.slice(0, limit).map(function (w) { return vendorWorkerDto_(w, vendorMap, projectMap, userMap); });

  return {
    count: rows.length,
    totalHeadcount: slice.reduce(function (s, w) { return s + w.count; }, 0),
    totalAmount: Math.round(slice.reduce(function (s, w) { return s + w.amountPayable; }, 0) * 100) / 100,
    workers: slice
  };
}

/** Daily/weekly headcount by vendor (§7 report 5). */
function actionVendorManpowerReport(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var from = isIsoDate_(payload.from) ? payload.from : shiftDate_(today_(ctx.tz), -6);
  var to = isIsoDate_(payload.to) ? payload.to : today_(ctx.tz);
  assert_(to >= from, 'To-date cannot be before from-date', 400);
  assert_(daysBetween_(from, to) <= 120, 'Limit the range to 120 days', 400);

  var rows = scopedRows_(ctx, readTable_(ss, 'VendorWorkers'), 'ProjectID')
    .filter(function (w) { return String(w.Date) >= from && String(w.Date) <= to; });
  if (payload.projectId) {
    assertProjectScope_(ctx, payload.projectId);
    rows = rows.filter(function (w) { return String(w.ProjectID) === String(payload.projectId); });
  }
  var vendorMap = indexBy_(readTable_(ss, 'Vendors'), 'VendorID');
  var projectMap = projectMap_(ss);
  var dates = dateRange_(from, to);
  var groupBy = String(payload.groupBy || 'vendor').toLowerCase();

  var groups = {};
  rows.forEach(function (w) {
    var key = groupBy === 'project' ? String(w.ProjectID) : String(w.VendorID);
    if (!groups[key]) {
      groups[key] = {
        key: key,
        label: groupBy === 'project' ? ((projectMap[key] || {}).Name || key) : ((vendorMap[key] || {}).Name || key),
        contact: groupBy === 'vendor' ? ((vendorMap[key] || {}).ContactPerson || '') : '',
        mobile: groupBy === 'vendor' ? ((vendorMap[key] || {}).Mobile || '') : '',
        byDate: {}, total: 0, amount: 0
      };
      dates.forEach(function (d) { groups[key].byDate[d] = 0; });
    }
    var heads = num_(w.Count, 1);
    groups[key].byDate[String(w.Date)] = (groups[key].byDate[String(w.Date)] || 0) + heads;
    groups[key].total += heads;
    groups[key].amount += num_(w.AmountPayable, 0);
  });

  var list = Object.keys(groups).map(function (k) {
    var g = groups[k];
    g.amount = Math.round(g.amount * 100) / 100;
    g.average = dates.length ? Math.round((g.total / dates.length) * 10) / 10 : 0;
    return g;
  });
  list = sortBy_(list, function (g) { return g.total; }, true);

  var dailyTotals = dates.map(function (d) {
    return { date: d, headcount: list.reduce(function (s, g) { return s + num_(g.byDate[d], 0); }, 0) };
  });

  return {
    from: from, to: to, dates: dates, groupBy: groupBy,
    currency: settings.currency || 'INR',
    vendorCount: list.length,
    totalHeadcount: list.reduce(function (s, g) { return s + g.total; }, 0),
    totalAmount: Math.round(list.reduce(function (s, g) { return s + g.amount; }, 0) * 100) / 100,
    groups: list,
    dailyTotals: dailyTotals
  };
}
