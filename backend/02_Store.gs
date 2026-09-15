/**
 * ============================================================================
 *  FILE: 02_Store.gs
 *  ROLE: The ONLY module that touches SpreadsheetApp. Everything above it works
 *        with plain JS objects; everything below it works with sheet rows.
 *
 *  Design: one Platform Master spreadsheet (registry) + one spreadsheet per
 *  company (§6 recommendation) → hard data isolation between tenants.
 * ============================================================================
 */

/** Extract a spreadsheet ID from either a bare ID or a full Sheets URL. */
function parseSheetId_(value) {
  var s = String(value || '').trim();
  if (!s) return '';
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return s;
}

/* -------------------------------------------------------------------------- */
/*  Spreadsheet handles                                                       */
/* -------------------------------------------------------------------------- */

function masterSpreadsheet_() {
  var id = parseSheetId_(prop_(PROP.MASTER_ID, ''));
  if (!id) {
    throw new ApiError_('Platform Master Sheet is not configured. Set Script Property ' +
      PROP.MASTER_ID + ' (or run the bootstrap action).', 500);
  }
  return memo_('ss:master:' + id, function () { return SpreadsheetApp.openById(id); });
}

function companySpreadsheetById_(sheetId) {
  var id = parseSheetId_(sheetId);
  if (!id) throw new ApiError_('Company spreadsheet id missing', 404);
  return memo_('ss:co:' + id, function () { return SpreadsheetApp.openById(id); });
}

/* -------------------------------------------------------------------------- */
/*  Company registry                                                          */
/* -------------------------------------------------------------------------- */

/** Full CompanyRegistry as an array of objects. */
function listCompaniesRaw_() {
  return readTable_(masterSpreadsheet_(), 'CompanyRegistry');
}

function findCompany_(companyId) {
  var rows = listCompaniesRaw_();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].CompanyID) === String(companyId)) return rows[i];
  }
  return null;
}

/** Resolve + open a company spreadsheet, throwing if unknown/suspended. */
function companyContext_(companyId, allowSuspended) {
  var co = findCompany_(companyId);
  if (!co) throw new ApiError_('Company not found: ' + companyId, 404);
  if (!allowSuspended && String(co.Status) === 'Suspended') {
    throw new ApiError_('This company account is suspended. Contact the platform administrator.', 403);
  }
  co.__ss = companySpreadsheetById_(co.SheetID);
  return co;
}

function touchCompanyActive_(companyId) {
  try {
    updateRecord_(masterSpreadsheet_(), 'CompanyRegistry', 'CompanyID', companyId, {
      LastActiveAt: fmtDateTime_(new Date())
    });
  } catch (e) {
    Logger.log('touchCompanyActive_ failed: ' + e.message);
  }
}

/* -------------------------------------------------------------------------- */
/*  Core read/write primitives                                                */
/* -------------------------------------------------------------------------- */

function getSheetSafe_(ss, tabName) {
  var sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  return sh;
}

/**
 * Read a tab and return {headers, values, rows} where rows are objects keyed by
 * header name. Empty rows are dropped.
 */
function readTableRaw_(ss, tabName) {
  var cacheKey = 'tbl:' + ss.getId() + ':' + tabName;
  if (MEMO_.hasOwnProperty(cacheKey)) return MEMO_[cacheKey];

  var sh = getSheetSafe_(ss, tabName);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var headers = [];
  var values = [];

  if (lastRow >= 1 && lastCol >= 1) {
    var all = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
    headers = (all[0] || []).map(function (h) { return String(h === null || typeof h === 'undefined' ? '' : h).trim(); });
    for (var r = 1; r < all.length; r++) {
      var row = all[r];
      var empty = true;
      for (var c = 0; c < row.length; c++) {
        if (!isBlank_(row[c])) { empty = false; break; }
      }
      if (empty) continue;
      values.push({ __row: r + 1, cells: row });
    }
  }

  var rows = values.map(function (v) {
    var o = { __row: v.__row };
    for (var i = 0; i < headers.length; i++) {
      if (!headers[i]) continue;
      var cell = v.cells[i];
      if (cell instanceof Date) cell = Utilities.formatDate(cell, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
      o[headers[i]] = cell === null || typeof cell === 'undefined' ? '' : cell;
    }
    return o;
  });

  var out = { headers: headers, values: values, rows: rows, sheet: sh };
  MEMO_[cacheKey] = out;
  return out;
}

/** Convenience: array of row objects only. */
function readTable_(ss, tabName) {
  return readTableRaw_(ss, tabName).rows;
}

/** Find one record by a key column. */
function findRecord_(ss, tabName, keyField, keyValue) {
  var rows = readTable_(ss, tabName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyField]) === String(keyValue)) return rows[i];
  }
  return null;
}

function findRecords_(ss, tabName, keyField, keyValue) {
  return readTable_(ss, tabName).filter(function (r) {
    return String(r[keyField]) === String(keyValue);
  });
}

/** Invalidate the read cache for one tab (called after any write). */
function bustTableCache_(ss, tabName) {
  delete MEMO_['tbl:' + ss.getId() + ':' + tabName];
}

function withLock_(fn) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
  } catch (e) {
    Logger.log('Lock unavailable, continuing unlocked: ' + e.message);
    lock = null;
  }
  try {
    return fn();
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e2) { } }
  }
}

/**
 * Append an object as a new row, aligned to the tab's schema headers.
 * Unknown keys are ignored; missing keys become empty cells.
 */
function appendRecord_(ss, tabName, obj) {
  return withLock_(function () {
    var headers = schemaHeaders_(tabName, ss);
    var row = headers.map(function (h) {
      var v = obj[h];
      if (v === null || typeof v === 'undefined') return '';
      if (typeof v === 'object') return jsonString_(v);
      return v;
    });
    var sh = getSheetSafe_(ss, tabName);
    sh.appendRow(row);
    bustTableCache_(ss, tabName);
    obj.__row = sh.getLastRow();
    return obj;
  });
}

/** Append several records in one write (faster for seeding / bulk inserts). */
function appendRecords_(ss, tabName, objs) {
  if (!objs || !objs.length) return [];
  return withLock_(function () {
    var headers = schemaHeaders_(tabName, ss);
    var sh = getSheetSafe_(ss, tabName);
    var startRow = Math.max(sh.getLastRow(), 1) + (sh.getLastRow() >= 1 ? 0 : 1);
    var matrix = objs.map(function (obj) {
      return headers.map(function (h) {
        var v = obj[h];
        if (v === null || typeof v === 'undefined') return '';
        if (typeof v === 'object') return jsonString_(v);
        return v;
      });
    });
    if (sh.getLastRow() < 1) {
      // No header row yet — write header + data together.
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      startRow = 2;
    } else {
      startRow = sh.getLastRow() + 1;
    }
    sh.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
    bustTableCache_(ss, tabName);
    return objs;
  });
}

/** Update a single record matched by keyField === keyValue. Returns updated obj. */
function updateRecord_(ss, tabName, keyField, keyValue, patch) {
  return withLock_(function () {
    var table = readTableRaw_(ss, tabName);
    var headers = table.headers.length ? table.headers : schemaHeaders_(tabName, ss);
    var target = null;
    for (var i = 0; i < table.rows.length; i++) {
      if (String(table.rows[i][keyField]) === String(keyValue)) { target = table.rows[i]; break; }
    }
    if (!target) return null;
    var merged = {};
    for (var k in target) if (k !== '__row') merged[k] = target[k];
    for (var p in patch) {
      if (p === '__row') continue;
      var v = patch[p];
      merged[p] = (v === null || typeof v === 'undefined') ? '' : (typeof v === 'object' ? jsonString_(v) : v);
    }
    var row = headers.map(function (h) {
      var val = merged[h];
      return (val === null || typeof val === 'undefined') ? '' : val;
    });
    var sh = getSheetSafe_(ss, tabName);
    sh.getRange(target.__row, 1, 1, headers.length).setValues([row]);
    bustTableCache_(ss, tabName);
    merged.__row = target.__row;
    return merged;
  });
}

/** Delete a record by key. Returns true when a row was removed. */
function deleteRecord_(ss, tabName, keyField, keyValue) {
  return withLock_(function () {
    var table = readTableRaw_(ss, tabName);
    var sh = getSheetSafe_(ss, tabName);
    var found = false;
    // delete from bottom up so row numbers stay valid
    for (var i = table.rows.length - 1; i >= 0; i--) {
      if (String(table.rows[i][keyField]) === String(keyValue)) {
        sh.deleteRow(table.rows[i].__row);
        found = true;
      }
    }
    if (found) bustTableCache_(ss, tabName);
    return found;
  });
}

/** Count rows in a tab (excluding header). */
function countRows_(ss, tabName) {
  return readTableRaw_(ss, tabName).rows.length;
}

/* -------------------------------------------------------------------------- */
/*  Schema helpers                                                            */
/* -------------------------------------------------------------------------- */

function schemaFor_(tabName, isPlatform) {
  if (isPlatform && PLATFORM_TABS[tabName]) return PLATFORM_TABS[tabName];
  if (COMPANY_TABS[tabName]) return COMPANY_TABS[tabName];
  return null;
}

/** Headers for a tab — from the live sheet when present, else from the schema. */
function schemaHeaders_(tabName, ss) {
  var live = null;
  try {
    var sh = ss.getSheetByName(tabName);
    if (sh && sh.getLastRow() >= 1) {
      live = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
        .map(function (h) { return String(h === null || typeof h === 'undefined' ? '' : h).trim(); })
        .filter(function (h) { return h !== ''; });
    }
  } catch (e) { live = null; }
  if (live && live.length) return live;

  var def = schemaFor_(tabName, false) || schemaFor_(tabName, true);
  return def ? def.headers.slice() : [];
}

/**
 * Create every tab in a spreadsheet from the schema (headers + formatting).
 * Idempotent — existing tabs keep their data and gain any missing columns.
 */
function ensureTabs_(ss, schemaMap, order) {
  var created = [];
  // Remove the default "Sheet1" once at least one real tab exists.
  for (var i = 0; i < order.length; i++) {
    var tabName = order[i];
    var def = schemaMap[tabName];
    if (!def) continue;
    var sh = ss.getSheetByName(tabName);
    var isNew = !sh;
    if (isNew) sh = ss.insertSheet(tabName);
    var headers = def.headers;
    var existing = [];
    if (sh.getLastRow() >= 1 && sh.getLastColumn() >= 1) {
      existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h === null || typeof h === 'undefined' ? '' : h).trim(); });
    }
    var hasAll = headers.every(function (h) { return existing.indexOf(h) >= 0; });
    if (!hasAll) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      // Wipe stale data only when the tab was just created or was empty.
      if (!isNew && sh.getLastRow() > 1 && existing.length) {
        Logger.log('Tab ' + tabName + ' header upgraded from ' + existing.length + ' to ' + headers.length + ' columns');
      }
    }
    applyTabFormatting_(ss, sh, tabName, def, headers);
    bustTableCache_(ss, tabName);
    created.push(tabName);
  }
  // Tidy up the boilerplate "Sheet1" tab Google creates with a new spreadsheet.
  // Only ever deletes an *empty* default tab — never a schema tab.
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var nm = String(sheets[s].getName());
    if (/^Sheet\s*\d*$/i.test(nm) && sheets.length > 1 && sheets[s].getLastRow() <= 1) {
      try { ss.deleteSheet(sheets[s]); } catch (e) { }
    }
  }
  return created;
}

/** Freeze headers, bold them, add dropdowns + status colour rules. */
function applyTabFormatting_(ss, sh, tabName, def, headers) {
  try {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  } catch (e) { }

  if (isDev_()) return; // formatting APIs are not polyfilled locally

  try {
    var dvKeys = def.dropdowns || {};
    for (var key in dvKeys) {
      var colIdx = headers.indexOf(key);
      if (colIdx < 0 || !dvKeys[key] || !dvKeys[key].length) continue;
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(dvKeys[key], true)
        .setAllowInvalid(false)
        .build();
      sh.getRange(2, colIdx + 1, 900, 1).setDataValidation(rule);
    }
  } catch (e) {
    Logger.log('Data validation failed on ' + tabName + ': ' + e.message);
  }

  try {
    var statusCols = def.statusColumns || [];
    for (var i = 0; i < statusCols.length; i++) {
      var cIdx = headers.indexOf(statusCols[i]);
      if (cIdx < 0) continue;
      var letter = columnLetter_(cIdx + 1);
      var range = sh.getRange('A1:' + letter + '1000');
      var rules = [
        colourRule_(range, 'PRESENT_OR_APPROVED', '#d9ead3', '#274e13'),
        colourRule_(range, 'REJECTED_OR_ABSENT', '#f4cccc', '#990000'),
        colourRule_(range, 'PENDING_OR_FLAGGED', '#fff2cc', '#7f6000')
      ].filter(function (r) { return !!r; });
      if (rules.length) sh.setConditionalFormatRules(rules);
    }
  } catch (e) {
    Logger.log('Conditional formatting failed on ' + tabName + ': ' + e.message);
  }
}

function colourRule_(range, kind, bg, fg) {
  try {
    var b = SpreadsheetApp.newConditionalFormatRule();
    if (kind === 'PRESENT_OR_APPROVED') {
      return b.whenTextContains('Approved').setBackgroundColor(bg).setRanges([range]).build();
    }
    if (kind === 'REJECTED_OR_ABSENT') {
      return b.whenTextContains('Rejected').setBackgroundColor(bg).setRanges([range]).build();
    }
    return b.whenTextContains('Pending').setBackgroundColor(bg).setRanges([range]).build();
  } catch (e) {
    return null;
  }
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m - 1) / 26);
  }
  return s;
}

/** Write a full Settings map (Key/Value tab) — upsert semantics. */
function writeSettings_(ss, settingsObj, actorId) {
  var existing = readTable_(ss, 'Settings');
  var byKey = {};
  existing.forEach(function (r) { byKey[String(r.Key)] = r; });
  var toAppend = [];
  var ts = fmtDateTime_(new Date());
  for (var k in settingsObj) {
    var v = settingsObj[k];
    var val = (v === null || typeof v === 'undefined') ? '' : (typeof v === 'object' ? jsonString_(v) : String(v));
    if (byKey[k]) {
      updateRecord_(ss, 'Settings', 'Key', k, { Value: val, UpdatedAt: ts, UpdatedBy: actorId || 'system' });
    } else {
      toAppend.push({
        Key: k, Value: val, UpdatedAt: ts, UpdatedBy: actorId || 'system',
        Description: DEFAULT_SETTINGS.hasOwnProperty(k) ? 'SiteTrack setting' : 'Custom'
      });
    }
  }
  if (toAppend.length) appendRecords_(ss, 'Settings', toAppend);
  return readSettings_(ss);
}

/** Read Settings tab into a plain object, layered over DEFAULT_SETTINGS. */
function readSettings_(ss) {
  var rows = readTable_(ss, 'Settings');
  var out = {};
  for (var d in DEFAULT_SETTINGS) out[d] = DEFAULT_SETTINGS[d];
  rows.forEach(function (r) {
    var k = String(r.Key || '').trim();
    if (!k) return;
    out[k] = String(r.Value === null || typeof r.Value === 'undefined' ? '' : r.Value);
  });
  return out;
}

function settingValue_(ss, key, fallback) {
  var s = readSettings_(ss);
  return isBlank_(s[key]) ? fallback : s[key];
}

/**
 * Append a row to a company's AuditLog (§12.6). Never throws — an audit
 * failure must not break the business action it describes.
 */
function audit_(ss, ctx, action, targetEntity, entityId, details, result) {
  try {
    if (!ss) return null;
    var row = {
      LogID: id_('LOG'),
      ActorUserID: (ctx && ctx.userId) || 'anonymous',
      ActorName: (ctx && ctx.userName) || '',
      ActorRole: (ctx && ctx.role) || '',
      CompanyID: (ctx && ctx.companyId) || '',
      Action: action,
      TargetEntity: targetEntity || '',
      EntityID: entityId || '',
      Timestamp: fmtDateTime_(new Date()),
      Details: truncate_(typeof details === 'object' ? jsonString_(details) : String(details || ''), 1800),
      UserAgent: truncate_((ctx && ctx.userAgent) || '', 200),
      Result: result || 'OK'
    };
    appendRecord_(ss, 'AuditLog', row);
    return row;
  } catch (e) {
    Logger.log('audit_ failed: ' + e.message);
    return null;
  }
}

function platformAudit_(action, details, result) {
  try {
    var row = {
      LogID: id_('PLOG'),
      ActorUserID: 'platform',
      Action: action,
      TargetEntity: 'Platform',
      Timestamp: fmtDateTime_(new Date()),
      Details: truncate_(typeof details === 'object' ? jsonString_(details) : String(details || ''), 1800),
      Result: result || 'OK'
    };
    var ss = masterSpreadsheet_();
    ensureTabs_(ss, PLATFORM_TABS, ['PlatformAuditLog']);
    appendRecord_(ss, 'PlatformAuditLog', row);
    return row;
  } catch (e) {
    Logger.log('platformAudit_ failed: ' + e.message);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Company spreadsheet lifecycle                                             */
/* -------------------------------------------------------------------------- */

/** Create a brand-new per-company spreadsheet with every tab scaffolded. */
function createCompanySpreadsheet_(companyName, companyId, ownerEmail) {
  var ss = SpreadsheetApp.create('SiteTrack - ' + companyName + ' [' + companyId + ']');
  try { ss.setSpreadsheetTimeZone(platformTimezone_()); } catch (e) { }
  ensureTabs_(ss, COMPANY_TABS, COMPANY_TAB_ORDER);

  // Give the company's own Google account viewer access when we know it.
  if (ownerEmail && emailOk_(ownerEmail)) {
    try { ss.addViewer(ownerEmail); } catch (e) { Logger.log('addViewer failed: ' + e.message); }
  }
  return ss;
}

/** Create/lookup the restricted Drive folder tree for a company (§10). */
function companyDriveFolder_(company, createIfMissing) {
  try {
    var existingId = company && company.DriveFolderID ? String(company.DriveFolderID) : '';
    if (existingId) {
      try { return DriveApp.getFolderById(existingId); } catch (e) { existingId = ''; }
    }
    if (!createIfMissing) return null;

    var root = null;
    var rootId = prop_(PROP.DRIVE_ROOT_ID, '');
    if (rootId) {
      try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; }
    }
    if (!root) {
      root = DriveApp.createFolder('SiteTrack');
      setProp_(PROP.DRIVE_ROOT_ID, root.getId());
    }
    var name = 'SiteTrack-' + (company && company.CompanyID ? company.CompanyID : 'unknown');
    var sub = null;
    var it = root.getFoldersByName(name);
    sub = it.hasNext() ? it.next() : root.createFolder(name);
    ['Selfies', 'Documents', 'Expenses', 'VendorPhotos', 'Reports', 'Temp'].forEach(function (n) {
      var f = sub.getFoldersByName(n);
      if (!f.hasNext()) sub.createFolder(n);
    });
    try { sub.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { }
    if (company && company.CompanyID) {
      updateRecord_(masterSpreadsheet_(), 'CompanyRegistry', 'CompanyID', company.CompanyID, {
        DriveFolderID: sub.getId()
      });
      company.DriveFolderID = sub.getId();
    }
    return sub;
  } catch (e) {
    Logger.log('companyDriveFolder_ failed: ' + e.message);
    return null;
  }
}

function companySubFolder_(company, subName, createIfMissing) {
  var base = companyDriveFolder_(company, createIfMissing !== false);
  if (!base) return null;
  var it = base.getFoldersByName(subName);
  return it.hasNext() ? it.next() : base.createFolder(subName);
}
