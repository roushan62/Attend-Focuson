/**
 * FocusOn HRMS 2.0 — Database layer (02_DB.gs)
 * Google Sheets backend: Core DB, yearly Attendance DB, yearly Logs DB.
 * Reads are cached per execution; writes are batched and lock-guarded.
 */

var _ssCache = {};      // spreadsheetId -> Spreadsheet
var _sheetCache = {};   // "spreadsheetId!sheetName" -> Sheet
var _rowCache = {};     // "spreadsheetId!sheetName" -> {headers:[], rows:[]}
var _lock = LockService.getScriptLock();

// ---------- Spreadsheet openers ----------

function _getDbId(kind, year) {
  var core = _getProp(PROP.DB_CORE);
  if (!core) throw _error(ERR.NOT_FOUND, 'Core database not initialized. Run setupSystem first.');
  if (kind === 'core') return core;
  if (kind === 'att') {
    var key = PROP.DB_ATT_PREFIX + year;
    var id = _getProp(key);
    if (!id) throw _error(ERR.NOT_FOUND, 'Attendance DB for year ' + year + ' not initialized.');
    return id;
  }
  if (kind === 'log') {
    var key = PROP.DB_LOG_PREFIX + year;
    var id = _getProp(key);
    if (!id) throw _error(ERR.NOT_FOUND, 'Logs DB for year ' + year + ' not initialized.');
    return id;
  }
  throw _error(ERR.INVALID_ACTION, 'Unknown db kind: ' + kind);
}
function _openDb(kind, year) {
  var id = _getDbId(kind, year);
  if (_ssCache[id]) return _ssCache[id];
  var ss = SpreadsheetApp.openById(id);
  _ssCache[id] = ss;
  return ss;
}
function _openCoreDb() { return _openDb('core'); }
function _openAttDb(year) { return _openDb('att', year || new Date().getFullYear()); }
function _openLogDb(year) { return _openDb('log', year || new Date().getFullYear()); }

// ---------- Sheet helpers ----------

function _getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}
function _sheetKey(ss, name) { return ss.getId() + '!' + name; }

// ---------- Read a sheet into header-keyed rows (cached per execution) ----------

function _readSheet(ss, name, maxRows) {
  var key = _sheetKey(ss, name);
  if (_rowCache[key]) return _rowCache[key];
  var sheet = _getOrCreateSheet(ss, name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var out = { headers: [], rows: [] };
  if (lastRow === 0 || lastCol === 0) { _rowCache[key] = out; return out; }
  var maxR = Math.min(lastRow, (maxRows || BATCH.maxReadRows) + 1);
  var data = sheet.getRange(1, 1, maxR, lastCol).getValues();
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      var h = String(headers[j]).trim();
      if (!h) continue;
      row[h] = data[i][j];
      if (data[i][j] !== '') empty = false;
    }
    if (!empty) out.rows.push(row);
  }
  out.headers = headers.filter(function (h) { return String(h).trim() !== ''; });
  _rowCache[key] = out;
  return out;
}
function readSheet(name, maxRows) { // public-ish for tools / testing
  return _readSheet(_openCoreDb(), name, maxRows).rows;
}

// Read a sheet from the core DB and return rows keyed by the given header names
function _readSheetRows(name, headers) {
  var sheet = _getOrCreateSheet(_openCoreDb(), name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var out = [];
  if (lastRow === 0 || lastCol === 0) return out;
  var data = sheet.getRange(1, 1, Math.min(lastRow, 5000), lastCol).getValues();
  var hdr = data[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = hdr.indexOf(h); });
  for (var i = 1; i < data.length; i++) {
    var row = {}, empty = true;
    headers.forEach(function (h) {
      var j = idx[h];
      row[h] = j >= 0 ? data[i][j] : '';
      if (data[i][j] !== '') empty = false;
    });
    if (!empty) out.push(row);
  }
  return out;
}

// Ensure a sheet exists with given headers (idempotent)
function _ensureSheet(ss, name, headers) {
  var sheet = _getOrCreateSheet(ss, name);
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    _rowCache[_sheetKey(ss, name)] = { headers: headers, rows: [] };
  }
  return sheet;
}

// ---------- Write helpers ----------

function _appendRows(sheet, rows) {
  if (!rows.length) return;
  // accept a single row (1D array) or multiple rows (2D array)
  if (!Array.isArray(rows[0])) rows = [rows];
  var lastRow = sheet.getLastRow();
  var startRow = lastRow === 0 ? 1 : lastRow + 1;
  var numCols = rows[0].length;
  sheet.getRange(startRow, 1, rows.length, numCols).setValues(rows);
  // invalidate row cache for this sheet so next read is fresh
  var ss = sheet.getParent();
  delete _rowCache[_sheetKey(ss, sheet.getName())];
}
function _setCell(sheet, row, col, val) {
  sheet.getRange(row, col, 1, 1).setValue(val);
  var ss = sheet.getParent();
  delete _rowCache[_sheetKey(ss, sheet.getName())];
}

// ---------- Lock-guarded write ----------

function _withLock(fn, seconds) {
  var lock = LockService.getScriptLock();
  var waited = false;
  try {
    lock.waitLock(seconds || BATCH.lockSeconds);
    waited = true;
    return fn();
  } finally {
    if (waited) lock.releaseLock();
  }
}

// ---------- Soft delete / restore ----------

function _softDelete(ss, name, recordId, idCol) {
  if (!idCol) idCol = 'id';
  var sheet = _getOrCreateSheet(ss, name);
  var data = _readSheet(ss, name);
  var found = -1;
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i][idCol]) === String(recordId)) { found = i; break; }
  }
  if (found < 0) return false;
  // header row is row 1, data starts at row 2
  var rowNum = found + 2;
  var colIndex = data.headers.indexOf(idCol);
  // mark deleted via a 'deleted' column if present, else status
  var deletedCol = data.headers.indexOf('deleted');
  var statusCol = data.headers.indexOf('status');
  if (deletedCol >= 0) {
    sheet.getRange(rowNum, deletedCol + 1, 1, 1).setValue('1');
  } else if (statusCol >= 0) {
    sheet.getRange(rowNum, statusCol + 1, 1, 1).setValue('Deleted');
  } else {
    // fallback: set id to deleted prefix
    sheet.getRange(rowNum, colIndex + 1, 1, 1).setValue('DELETED_' + recordId);
  }
  delete _rowCache[_sheetKey(ss, name)];
  return true;
}
