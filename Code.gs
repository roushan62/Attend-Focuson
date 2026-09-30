/**
 * ============================================================================
 *  ASTRA HR & PAYROLL  —  Code.gs  (single server file)
 *  Google Apps Script web app.  Database = Google Sheets, files = Google Drive.
 *
 *  Public entry points (the ONLY globals):
 *    doGet(e)            serves Index.html
 *    api(action, token, payload)   the single RPC endpoint used by the client
 *    setupSystem()       run once from the editor (creates Sheet, Drive folder, seeds)
 *    seedDemoData()      optional, run from the editor (demo company + data)
 *
 *  Everything else lives inside the private APP namespace below, so nothing
 *  else can be invoked through google.script.run.
 *
 *  Conventions
 *   - companyId is ALWAYS resolved server-side from the session.
 *   - Dates are 'yyyy-MM-dd'; timestamps are ISO-8601 with the +05:30 offset,
 *     both generated on the server (Asia/Kolkata).
 *   - Extra tabs beyond the requested data model (needed by the spec's
 *     features, kept separate so the requested tabs keep their exact headers):
 *       Settings, Holidays, Notifications, EmployeeProfiles,
 *       PayrollBreakups, Decisions
 * ============================================================================
 */
var APP = (function () {
'use strict';

/* ============================== 1. CONSTANTS ============================== */
var TZ = 'Asia/Kolkata';
var DEFAULT_APP_NAME = 'Astra HR';
var UNPAID = 'Unpaid Leave';
var PLATFORM = 'PLATFORM';
var SUPER = 'SUPER_ADMIN';
var MODULES = ['projects', 'employees', 'attendance', 'leave', 'payroll', 'expenses', 'reports', 'documents', 'settings', 'support', 'audit'];
var ACTIONS = ['view', 'create', 'edit', 'approve', 'export'];
var DOC_TYPES = ['Aadhaar', 'PAN', 'Bank Proof', 'Offer Letter', 'Photo', 'Other'];
var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
var ALLOWED_MIME = {
  'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1, 'text/plain': 1,
  'application/msword': 1, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1,
  'application/vnd.ms-excel': 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1
};

var SCHEMA = {
  Companies: ['companyId', 'companyName', 'legalName', 'gstin', 'pan', 'email', 'phone', 'address', 'contactPerson', 'status', 'createdAt'],
  Users: ['userId', 'companyId', 'employeeId', 'role', 'loginId', 'email', 'phone', 'passwordHash', 'salt', 'status', 'createdAt'],
  Sessions: ['tokenHash', 'userId', 'companyId', 'role', 'createdAt', 'expiresAt'],
  Roles: ['companyId', 'roleId', 'roleName'],
  RolePermissions: ['companyId', 'roleId', 'module', 'action', 'allowed'],
  Employees: ['employeeId', 'companyId', 'empCode', 'fullName', 'phone', 'email', 'photoFileId', 'designation', 'department', 'doj', 'employmentType', 'bankName', 'accountNo', 'ifsc', 'panNumber', 'uan', 'esicNo', 'status', 'roleId', 'createdAt'],
  EmployeeDocuments: ['docId', 'employeeId', 'docType', 'fileId', 'fileName', 'uploadedBy', 'createdAt'],
  SalaryStructures: ['id', 'employeeId', 'effectiveFrom', 'basic', 'hra', 'specialAllowance', 'monthlyGross', 'isCurrent'],
  Projects: ['projectId', 'companyId', 'type', 'name', 'clientName', 'address', 'lat', 'lng', 'geofenceRadiusM', 'status', 'createdAt'],
  ProjectAssignments: ['assignmentId', 'projectId', 'employeeId', 'startDate', 'endDate', 'status', 'assignedBy', 'endReason'],
  TransferRequests: ['requestId', 'employeeId', 'fromProjectId', 'toProjectId', 'requestedBy', 'reason', 'status', 'decidedBy', 'decisionRemark'],
  Attendance: ['attendanceId', 'employeeId', 'projectId', 'date', 'punchInAt', 'inLat', 'inLng', 'inDistanceM', 'punchOutAt', 'outLat', 'outLng', 'workMinutes', 'status', 'source'],
  LeaveTypes: ['companyId', 'leaveType', 'defaultDaysPerYear'],
  LeaveBalances: ['employeeId', 'leaveType', 'fy', 'balance'],
  LeaveRequests: ['requestId', 'employeeId', 'leaveType', 'fromDate', 'toDate', 'days', 'reason', 'status', 'approverId', 'decisionRemark'],
  SpecialRequests: ['requestId', 'employeeId', 'fromProjectId', 'toProjectId', 'fromDate', 'toDate', 'reason', 'taggedPersonId', 'status', 'decidedBy', 'decisionRemark'],
  ExpenseCategories: ['companyId', 'category'],
  ExpenseClaims: ['claimId', 'employeeId', 'projectId', 'category', 'expenseDate', 'amount', 'reason', 'billFileId', 'status', 'decidedBy', 'payrollRunId'],
  PayrollRuns: ['runId', 'companyId', 'fy', 'month', 'status', 'totals', 'calculatedAt', 'approvedAt', 'paidAt'],
  PayrollItems: ['itemId', 'runId', 'employeeId', 'payableDays', 'lopDays', 'gross', 'reimbursements', 'deductions', 'netPay', 'status'],
  Payslips: ['payslipId', 'runId', 'employeeId', 'fileId', 'generatedAt'],
  Documents: ['docId', 'companyId', 'category', 'title', 'fileId', 'visibilityRoles'],
  Tickets: ['ticketId', 'companyId', 'raisedBy', 'raisedByRole', 'subject', 'description', 'status', 'assignedTo', 'createdAt'],
  TicketComments: ['commentId', 'ticketId', 'authorId', 'message', 'createdAt'],
  AuditLog: ['logId', 'companyId', 'actorId', 'actorRole', 'module', 'action', 'entityId', 'remark', 'createdAt'],
  Counters: ['name', 'lastValue'],
  // ---- supporting tabs (not part of the requested model) ----
  Settings: ['companyId', 'key', 'value'],
  Holidays: ['companyId', 'date', 'name'],
  Notifications: ['notifId', 'companyId', 'userId', 'message', 'isRead', 'createdAt'],
  EmployeeProfiles: ['employeeId', 'dob', 'gender', 'address', 'emergencyContact', 'maritalStatus'],
  PayrollBreakups: ['itemId', 'breakupJson'],
  Decisions: ['entityId', 'companyId', 'decision', 'remark', 'decidedBy', 'decidedAt']
};
// column types: n = number, b = boolean, everything else = text
var COLTYPES = {
  SalaryStructures: { basic: 'n', hra: 'n', specialAllowance: 'n', monthlyGross: 'n', isCurrent: 'b' },
  Projects: { lat: 'n', lng: 'n', geofenceRadiusM: 'n' },
  Attendance: { inLat: 'n', inLng: 'n', inDistanceM: 'n', outLat: 'n', outLng: 'n', workMinutes: 'n' },
  LeaveTypes: { defaultDaysPerYear: 'n' },
  LeaveBalances: { balance: 'n' },
  LeaveRequests: { days: 'n' },
  ExpenseClaims: { amount: 'n' },
  PayrollItems: { payableDays: 'n', lopDays: 'n', gross: 'n', reimbursements: 'n', deductions: 'n', netPay: 'n' },
  RolePermissions: { allowed: 'b' },
  Notifications: { isRead: 'b' },
  Counters: { lastValue: 'n' }
};

var DEFAULT_PLATFORM = {
  platformName: DEFAULT_APP_NAME, platformLogoFileId: '', defaultGeofenceRadiusM: '50',
  sessionTimeoutMin: '480', verificationRequired: 'TRUE'
};
var DEFAULT_COMPANY_SETTINGS = {
  brandColor: '#4F46E5', logoFileId: '', signatureFileId: '', stampFileId: '', payslipTemplate: 'classic',
  shiftStart: '09:30', graceMinutes: '15', halfDayMinutes: '240', geofenceRadiusM: '50', maxAccuracyM: '100',
  weeklyOff: '0', empCodePrefix: 'EMP', maxConsecutiveLeaveDays: '15', backdatedLeaveDays: '7',
  pfEnabled: 'TRUE', esiEnabled: 'TRUE', ptAmount: '200'
};

var DEFAULT_PERMS = {
  ADMIN: 'ALL',
  HR: {
    projects: ['view', 'create', 'edit', 'approve'], employees: ['view', 'create', 'edit', 'export'],
    attendance: ['view', 'create', 'edit', 'approve', 'export'], leave: ['view', 'create', 'edit', 'approve', 'export'],
    payroll: ['view', 'create', 'edit', 'approve', 'export'], expenses: ['view', 'create', 'edit', 'approve', 'export'],
    reports: ['view', 'export'], documents: ['view', 'create', 'edit'], settings: ['view'],
    support: ['view', 'create', 'edit'], audit: ['view']
  },
  MANAGER: {
    projects: ['view', 'edit', 'approve'], employees: ['view'], attendance: ['view', 'edit', 'approve'],
    leave: ['view', 'approve'], expenses: ['view', 'approve'], reports: ['view'], documents: ['view'], support: ['view', 'edit']
  },
  EMPLOYEE: {}
};

/* ============================== 2. ERRORS / UTILS ============================== */
function ApiError(code, message, extra) { this.code = code; this.message = message; this.extra = extra; this.isApi = true; }
ApiError.prototype = Object.create(Error.prototype);
function fail(code, message, extra) { throw new ApiError(code, message, extra); }

function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function nowIso() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function hhmmNow() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
function isMonthStr(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || ''); }
function dt(s) { return new Date(s + 'T00:00:00Z'); }
function dstr(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { var d = dt(s); d.setUTCDate(d.getUTCDate() + n); return dstr(d); }
function diffDays(a, b) { return Math.round((dt(b) - dt(a)) / 86400000); } // b - a
function dow(s) { return dt(s).getUTCDay(); }
function daysInMonth(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function monthStart(ym) { return ym + '-01'; }
function monthEnd(ym) { return ym + '-' + pad(daysInMonth(ym), 2); }
function addMonths(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; var d = new Date(Date.UTC(y, m, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2); }
function fyOf(dateStr) { var y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7); var s = m >= 4 ? y : y - 1; return s + '-' + pad((s + 1) % 100, 2); }
function fyRange(fy) { var s = +fy.slice(0, 4); return { from: s + '-04-01', to: (s + 1) + '-03-31' }; }
function round2(n) { return Math.round((Number(n) + 1e-9) * 100) / 100; }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 500); }
function lc(v) { return str(v).toLowerCase(); }
function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }
function sortBy(arr, fn, desc) { return arr.sort(function (a, b) { var x = fn(a), y = fn(b); var c = x < y ? -1 : x > y ? 1 : 0; return desc ? -c : c; }); }
function idx(arr, key) { var o = {}; arr.forEach(function (r) { o[r[key]] = r; }); return o; }
function group(arr, key) { var o = {}; arr.forEach(function (r) { (o[r[key]] = o[r[key]] || []).push(r); }); return o; }
function sum(arr, fn) { var t = 0; arr.forEach(function (x) { t += fn(x); }); return t; }
function safeJson(s, dflt) { try { return JSON.parse(s); } catch (e) { return dflt; } }
function paginate(arr, p) {
  var size = Math.min(Math.max(parseInt(p && p.pageSize, 10) || 10, 1), 200);
  var total = arr.length, pages = Math.max(1, Math.ceil(total / size));
  var page = Math.min(Math.max(parseInt(p && p.page, 10) || 1, 1), pages);
  return { rows: arr.slice((page - 1) * size, page * size), total: total, page: page, pageSize: size, pages: pages };
}
function matches(q, fields) { q = lc(q); if (!q) return true; for (var i = 0; i < fields.length; i++) if (String(fields[i] == null ? '' : fields[i]).toLowerCase().indexOf(q) >= 0) return true; return false; }

// validators
var RX = {
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, phone: /^[6-9][0-9]{9}$/, ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/, color: /^#[0-9A-Fa-f]{6}$/
};
function reqStr(p, k, label, max) { var v = str(p[k], max); if (!v) fail('VALIDATION', label + ' is required.', { field: k }); return v; }
function reqEnum(v, list, label) { if (list.indexOf(v) < 0) fail('VALIDATION', label + ' is invalid.'); return v; }
function reqDate(v, label) { v = str(v, 10); if (!isDateStr(v)) fail('VALIDATION', label + ' must be a valid date (YYYY-MM-DD).'); return v; }
function reqMonth(v) { v = str(v, 7); if (!isMonthStr(v)) fail('VALIDATION', 'Month must be in YYYY-MM format.'); return v; }
function normPhone(v) { var d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function reqPhone(v, label) { var p = normPhone(v); if (!RX.phone.test(p)) fail('VALIDATION', (label || 'Phone') + ' must be a valid 10-digit Indian mobile number.'); return p; }
function reqEmail(v, label) { v = lc(v); if (!RX.email.test(v)) fail('VALIDATION', (label || 'Email') + ' is not valid.'); return v; }
function optNum(v, label, min, max) { if (v === '' || v == null) return 0; var n = Number(v); if (!isFinite(n) || n < (min == null ? 0 : min) || (max != null && n > max)) fail('VALIDATION', label + ' is invalid.'); return round2(n); }
function checkPassword(pw) { pw = String(pw || ''); if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail('VALIDATION', 'Password must be at least 8 characters with letters and numbers.'); return pw; }

// crypto
function b64(bytes) { return Utilities.base64Encode(bytes); }
function sha256(s) { return b64(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hashPassword(pw, salt) {
  var h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  for (var i = 0; i < 64; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b64(h) + salt + pw, Utilities.Charset.UTF_8);
  }
  return b64(h);
}
function newSalt() { return Utilities.getUuid().replace(/-/g, ''); }
function randomCode(len) { var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; }
function tempPassword() { return randomCode(4) + Math.floor(1000 + Math.random() * 9000) + randomCode(3).toLowerCase() + '#'; }

/* ============================== 3. SHEET LAYER ============================== */
var _ss = null, _sheets = {}, MEMO = {}, MM = {};
var CACHE = CacheService.getScriptCache();
var PROP = PropertiesService.getScriptProperties();

function memoClear() { MEMO = {}; MM = {}; }
function getSS() {
  if (_ss) return _ss;
  var id = PROP.getProperty('SS_ID');
  if (!id) fail('NOT_SETUP', 'The system has not been set up yet. Run setupSystem() from the Apps Script editor.');
  _ss = SpreadsheetApp.openById(id);
  return _ss;
}
function sheetOf(name) {
  if (_sheets[name]) return _sheets[name];
  var sh = getSS().getSheetByName(name);
  if (!sh) fail('NOT_SETUP', 'Missing sheet tab "' + name + '". Run setupSystem() again.');
  _sheets[name] = sh; return sh;
}
function headers(name) {
  var key = 'H_' + name, c = CACHE.get(key);
  if (c) { var a = safeJson(c, null); if (a) return a; }
  var sh = sheetOf(name), h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  CACHE.put(key, JSON.stringify(h), 21600);
  return h;
}
function ctype(name, col) { var t = COLTYPES[name]; return (t && t[col]) || 't'; }
function fromCell(t, v) {
  if (t === 'n') return (v === '' || v == null) ? 0 : (Number(v) || 0);
  if (t === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
  return v == null ? '' : String(v);
}
function toCell(t, v) {
  if (t === 'n') return (v === '' || v == null) ? 0 : Number(v);
  if (t === 'b') return (v === true || String(v).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
}
function T(name) {
  if (MEMO[name]) return MEMO[name];
  var h = headers(name), sh = sheetOf(name), last = sh.getLastRow();
  var raw = last > 1 ? sh.getRange(2, 1, last - 1, h.length).getValues() : [];
  var types = h.map(function (c) { return ctype(name, c); });
  var rows = raw.map(function (r, i) {
    var o = { _row: i + 2 };
    for (var j = 0; j < h.length; j++) o[h[j]] = fromCell(types[j], r[j]);
    return o;
  });
  MEMO[name] = { h: h, raw: raw, rows: rows };
  return MEMO[name];
}
function rows(name) { return T(name).rows; }
function where(name, fn) { return rows(name).filter(fn); }
function findOne(name, fn) { var r = rows(name); for (var i = 0; i < r.length; i++) if (fn(r[i])) return r[i]; return null; }
function insert(name, objs) {
  if (!Array.isArray(objs)) objs = [objs];
  if (!objs.length) return [];
  var h = headers(name), sh = sheetOf(name), start = Math.max(sh.getLastRow(), 1) + 1;
  var types = h.map(function (c) { return ctype(name, c); });
  var matrix = objs.map(function (o) { return h.map(function (c, j) { return toCell(types[j], o[c]); }); });
  var needRow = start + matrix.length - 1;
  if (needRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), needRow - sh.getMaxRows() + 200);
  var rg = sh.getRange(start, 1, matrix.length, h.length);
  rg.setNumberFormat('@');
  rg.setValues(matrix);
  delete MEMO[name]; MM = {};
  return objs;
}
function updateMany(name, patches) {
  if (!patches.length) return;
  var t = T(name), h = t.h, min = 1e9, max = 0;
  patches.forEach(function (p) {
    var i = p._row - 2, r = t.raw[i].slice();
    for (var j = 0; j < h.length; j++) if (Object.prototype.hasOwnProperty.call(p, h[j])) r[j] = toCell(ctype(name, h[j]), p[h[j]]);
    t.raw[i] = r; if (p._row < min) min = p._row; if (p._row > max) max = p._row;
  });
  var slice = t.raw.slice(min - 2, max - 1);
  sheetOf(name).getRange(min, 1, slice.length, h.length).setValues(slice);
  delete MEMO[name]; MM = {};
}
function update(name, row, patch) { var p = {}; for (var k in patch) p[k] = patch[k]; p._row = row._row != null ? row._row : row; updateMany(name, [p]); }
function deleteRows(name, rowObjs) {
  var nums = rowObjs.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  var sh = sheetOf(name);
  nums.forEach(function (n) { sh.deleteRow(n); });
  delete MEMO[name]; MM = {};
}
function rewrite(name, objs) {
  var h = headers(name), sh = sheetOf(name), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, h.length).clearContent();
  delete MEMO[name]; MM = {};
  if (objs.length) insert(name, objs);
}
// Counters (call only inside a lock)
function nextIds(counter, n) {
  var sh = sheetOf('Counters'), last = sh.getLastRow();
  var data = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  var at = -1;
  for (var i = 0; i < data.length; i++) if (String(data[i][0]) === counter) { at = i; break; }
  var cur = at >= 0 ? (Number(data[at][1]) || 0) : 0, nv = cur + n;
  if (at >= 0) sh.getRange(at + 2, 2).setValue(nv);
  else { var r = sh.getRange(last + 1, 1, 1, 2); r.setNumberFormat('@'); r.setValues([[counter, nv]]); }
  var out = []; for (var k = 1; k <= n; k++) out.push(cur + k);
  return out;
}
function newId(prefix, counter, w) { return prefix + pad(nextIds(counter, 1)[0], w || 6); }
function newIds(prefix, counter, n, w) { return nextIds(counter, n).map(function (x) { return prefix + pad(x, w || 6); }); }

function withLock(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { fail('BUSY', 'The system is busy. Please try again in a moment.'); }
  try { memoClear(); return fn(); } finally { try { lock.releaseLock(); } catch (e2) { /* ignore */ } }
}

/* ============================== 4. SETTINGS / LOOKUPS ============================== */
function settingsFor(cid) {
  var ck = 'SET_' + cid, c = CACHE.get(ck);
  if (c) { var o = safeJson(c, null); if (o) return o; }
  var base = cid === PLATFORM ? DEFAULT_PLATFORM : DEFAULT_COMPANY_SETTINGS, out = {};
  for (var k in base) out[k] = base[k];
  where('Settings', function (r) { return r.companyId === cid; }).forEach(function (r) { out[r.key] = r.value; });
  CACHE.put(ck, JSON.stringify(out), 1800);
  return out;
}
function saveSettings(cid, obj) {
  var existing = where('Settings', function (r) { return r.companyId === cid; }), byKey = idx(existing, 'key');
  var patches = [], adds = [];
  Object.keys(obj).forEach(function (k) {
    var v = String(obj[k]);
    if (byKey[k]) { if (byKey[k].value !== v) patches.push({ _row: byKey[k]._row, value: v }); }
    else adds.push({ companyId: cid, key: k, value: v });
  });
  updateMany('Settings', patches); insert('Settings', adds);
  CACHE.remove('SET_' + cid); CACHE.remove('B_' + cid);
}
function sflag(v) { return String(v).toUpperCase() === 'TRUE'; }

function companyOf(cid) { return findOne('Companies', function (c) { return c.companyId === cid; }); }
function empsOf(cid) {
  if (MM['emps_' + cid]) return MM['emps_' + cid];
  var list = where('Employees', function (e) { return e.companyId === cid; });
  MM['emps_' + cid] = { list: list, byId: idx(list, 'employeeId') };
  return MM['emps_' + cid];
}
function empName(cid, id) { var e = empsOf(cid).byId[id]; return e ? e.fullName : ''; }
function projectsOf(cid) {
  if (MM['prj_' + cid]) return MM['prj_' + cid];
  var list = where('Projects', function (p) { return p.companyId === cid; });
  MM['prj_' + cid] = { list: list, byId: idx(list, 'projectId') };
  return MM['prj_' + cid];
}
function empIdSet(cid) { var s = {}; empsOf(cid).list.forEach(function (e) { s[e.employeeId] = 1; }); return s; }
function userName(cid, userId) {
  if (!userId) return '';
  var u = findOne('Users', function (x) { return x.userId === userId; });
  if (!u) return userId;
  if (u.employeeId) { var n = empName(u.companyId, u.employeeId); if (n) return n; }
  if (u.role === SUPER) return 'Super Admin';
  var c = companyOf(u.companyId);
  return (c && c.contactPerson ? c.contactPerson : 'Admin') + (u.role !== 'ADMIN' ? '' : '');
}
function userForEmployee(empId) { return findOne('Users', function (u) { return u.employeeId === empId; }); }
function roleName(cid, roleId) { var r = findOne('Roles', function (x) { return x.companyId === cid && x.roleId === roleId; }); return r ? r.roleName : roleId; }
function decisionMap(cid, entityIds) {
  var set = {}; entityIds.forEach(function (i) { set[i] = 1; });
  var out = {};
  where('Decisions', function (d) { return d.companyId === cid && set[d.entityId]; }).forEach(function (d) { out[d.entityId] = d; });
  return out;
}
function addDecision(ctx, entityId, decision, remark) {
  insert('Decisions', { entityId: entityId, companyId: ctx.cid, decision: decision, remark: remark, decidedBy: ctx.user.userId, decidedAt: ctx.now });
}
function needRemark(p) { var r = str(p.remark, 500); if (r.length < 3) fail('VALIDATION', 'A remark (at least 3 characters) is mandatory.', { field: 'remark' }); return r; }

function audit(cid, actorId, actorRole, module, action, entityId, remark) {
  insert('AuditLog', { logId: newId('LOG', 'audit', 8), companyId: cid, actorId: actorId, actorRole: actorRole, module: module, action: action, entityId: entityId || '', remark: str(remark, 500), createdAt: nowIso() });
}
function notify(cid, userId, message) {
  if (!userId) return;
  insert('Notifications', { notifId: newId('NTF', 'notif', 8), companyId: cid, userId: userId, message: str(message, 300), isRead: false, createdAt: nowIso() });
}
function notifyEmployee(cid, empId, message) { var u = userForEmployee(empId); if (u) notify(cid, u.userId, message); }
function notifyAdmins(cid, message, permKey) {
  where('Users', function (u) { return u.companyId === cid && u.role !== 'EMPLOYEE' && u.status !== 'Disabled' && u.status !== 'Pending'; }).forEach(function (u) {
    var parts = (permKey || '').split('.');
    if (!permKey || u.role === 'ADMIN' || permsOf(cid, u.role)[permKey]) notify(cid, u.userId, message);
  });
}

/* ---------- roles & permissions ---------- */
function permsOf(cid, roleId) {
  var ck = 'P_' + cid + '_' + roleId, c = CACHE.get(ck);
  if (c) { var o = safeJson(c, null); if (o) return o; }
  var map = {};
  if (roleId === 'ADMIN') MODULES.forEach(function (m) { ACTIONS.forEach(function (a) { map[m + '.' + a] = 1; }); });
  else where('RolePermissions', function (r) { return r.companyId === cid && r.roleId === roleId && r.allowed; }).forEach(function (r) { map[r.module + '.' + r.action] = 1; });
  CACHE.put(ck, JSON.stringify(map), 1800);
  return map;
}
function seedCompanyData(cid) {
  var roles = [
    { companyId: cid, roleId: 'ADMIN', roleName: 'Company Admin' }, { companyId: cid, roleId: 'HR', roleName: 'HR Manager' },
    { companyId: cid, roleId: 'MANAGER', roleName: 'Project Manager' }, { companyId: cid, roleId: 'EMPLOYEE', roleName: 'Employee' }
  ];
  var perms = [];
  roles.forEach(function (r) {
    var def = DEFAULT_PERMS[r.roleId];
    MODULES.forEach(function (m) {
      ACTIONS.forEach(function (a) {
        var allowed = def === 'ALL' || (def[m] && def[m].indexOf(a) >= 0);
        perms.push({ companyId: cid, roleId: r.roleId, module: m, action: a, allowed: !!allowed });
      });
    });
  });
  insert('Roles', roles); insert('RolePermissions', perms);
  insert('LeaveTypes', [
    { companyId: cid, leaveType: 'Casual Leave', defaultDaysPerYear: 12 }, { companyId: cid, leaveType: 'Sick Leave', defaultDaysPerYear: 12 },
    { companyId: cid, leaveType: 'Earned Leave', defaultDaysPerYear: 15 }, { companyId: cid, leaveType: UNPAID, defaultDaysPerYear: 0 }
  ]);
  insert('ExpenseCategories', ['Travel', 'Food', 'Accommodation', 'Fuel', 'Materials', 'Other'].map(function (c) { return { companyId: cid, category: c }; }));
  var plat = settingsFor(PLATFORM), s = {};
  for (var k in DEFAULT_COMPANY_SETTINGS) s[k] = DEFAULT_COMPANY_SETTINGS[k];
  s.geofenceRadiusM = plat.defaultGeofenceRadiusM || '50';
  saveSettings(cid, s);
}

/* ============================== 5. FILES (DRIVE) ============================== */
function rootFolder() {
  var id = PROP.getProperty('ROOT_FOLDER_ID');
  if (!id) fail('NOT_SETUP', 'Drive root folder missing. Run setupSystem().');
  return DriveApp.getFolderById(id);
}
function subFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function folderFor(cid, parts) {
  var key = 'F_' + cid + '/' + parts.join('/'), id = CACHE.get(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { CACHE.remove(key); } }
  var f = subFolder(rootFolder(), cid);
  parts.forEach(function (p) { f = subFolder(f, String(p).replace(/[\\\/:*?"<>|]/g, '_')); });
  CACHE.put(key, f.getId(), 21600);
  return f;
}
function saveUpload(cid, parts, file, opts) {
  opts = opts || {};
  if (!file || !file.data || !file.name) fail('VALIDATION', 'Please choose a file to upload.', { field: 'file' });
  var mime = str(file.mime, 120) || 'application/octet-stream';
  if (!ALLOWED_MIME[mime]) fail('VALIDATION', 'This file type is not allowed. Upload an image, PDF or Office document.', { field: 'file' });
  if (opts.imageOnly && mime.indexOf('image/') !== 0) fail('VALIDATION', 'Please upload an image file.', { field: 'file' });
  var data = String(file.data).replace(/^data:[^,]*,/, '');
  if (data.length * 0.75 > (opts.maxBytes || MAX_UPLOAD_BYTES)) fail('VALIDATION', 'File is too large (max ' + Math.round((opts.maxBytes || MAX_UPLOAD_BYTES) / 1048576 * 10) / 10 + ' MB).', { field: 'file' });
  var safe = str(file.name, 120).replace(/[\\\/:*?"<>|]/g, '_') || 'file';
  var bytes;
  try { bytes = Utilities.base64Decode(data); } catch (e) { fail('VALIDATION', 'The uploaded file is corrupted.', { field: 'file' }); }
  var blob = Utilities.newBlob(bytes, mime, (opts.prefix ? opts.prefix + '_' : '') + safe);
  var f = folderFor(cid, parts).createFile(blob);
  return { fileId: f.getId(), fileName: f.getName(), mime: mime };
}
function trashFile(id) { if (!id) return; try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ } }
function readFile(id) {
  var f = DriveApp.getFileById(id), blob = f.getBlob();
  if (blob.getBytes().length > 12 * 1024 * 1024) fail('TOO_LARGE', 'File is too large to preview.');
  return { name: f.getName(), mime: blob.getContentType(), data: b64(blob.getBytes()) };
}
function brandAsset(cid, key) { // returns data URI or ''
  var s = settingsFor(cid), id = cid === PLATFORM ? s.platformLogoFileId : s[key];
  if (!id) return '';
  var ck = 'A_' + id, c = CACHE.get(ck);
  if (c) return c;
  try {
    var blob = DriveApp.getFileById(id).getBlob(), bytes = blob.getBytes();
    if (bytes.length > 70000) return '';
    var uri = 'data:' + blob.getContentType() + ';base64,' + b64(bytes);
    CACHE.put(ck, uri, 21600);
    return uri;
  } catch (e) { return ''; }
}

/* ============================== 6. SESSIONS / AUTH ============================== */
var ISO_FMT = "yyyy-MM-dd'T'HH:mm:ssXXX";
function sessionTimeoutMs() { return (parseInt(settingsFor(PLATFORM).sessionTimeoutMin, 10) || 480) * 60000; }
function createSession(u) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var th = sha256(token), exp = new Date(Date.now() + sessionTimeoutMs());
  var all = rows('Sessions');
  if (all.length > 300) { // purge expired sessions in one batch
    var keep = all.filter(function (s) { return Date.parse(s.expiresAt) > Date.now(); });
    rewrite('Sessions', keep.map(function (s) { return { tokenHash: s.tokenHash, userId: s.userId, companyId: s.companyId, role: s.role, createdAt: s.createdAt, expiresAt: s.expiresAt }; }));
  }
  insert('Sessions', { tokenHash: th, userId: u.userId, companyId: u.companyId, role: u.role, createdAt: nowIso(), expiresAt: Utilities.formatDate(exp, TZ, ISO_FMT) });
  CACHE.put('S_' + th, JSON.stringify({ userId: u.userId, exp: exp.getTime() }), 1800);
  return token;
}
function dropSession(token) {
  if (!token) return;
  var th = sha256(token); CACHE.remove('S_' + th);
  var s = findOne('Sessions', function (x) { return x.tokenHash === th; });
  if (s) update('Sessions', s, { expiresAt: '2000-01-01T00:00:00+05:30' });
}
function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 200) return null;
  var th = sha256(token), c = CACHE.get('S_' + th), s = c ? safeJson(c, null) : null;
  if (!s) {
    var row = findOne('Sessions', function (x) { return x.tokenHash === th; });
    if (!row) return null;
    s = { userId: row.userId, exp: Date.parse(row.expiresAt) };
    CACHE.put('S_' + th, JSON.stringify(s), 1800);
  }
  if (!(s.exp > Date.now())) return null;
  return s;
}
function userLite(userId) {
  var ck = 'U_' + userId, c = CACHE.get(ck);
  if (c) { var o = safeJson(c, null); if (o) return o; }
  var u = findOne('Users', function (x) { return x.userId === userId; });
  if (!u) return null;
  var lite = { userId: u.userId, companyId: u.companyId, employeeId: u.employeeId, role: u.role, status: u.status, loginId: u.loginId, email: u.email };
  CACHE.put(ck, JSON.stringify(lite), 600);
  return lite;
}
function bustUser(userId) { CACHE.remove('U_' + userId); }
function companyStatus(cid) {
  var ck = 'CS_' + cid, c = CACHE.get(ck);
  if (c) return c;
  var co = companyOf(cid); var st = co ? co.status : '';
  if (st) CACHE.put(ck, st, 600);
  return st;
}
function bustCompany(cid) { CACHE.remove('CS_' + cid); }

function panelOf(u) { return u.role === SUPER ? 'super' : (u.role === 'EMPLOYEE' ? 'employee' : 'admin'); }

function authenticate(ctx, token, route) {
  var s = resolveSession(token);
  if (!s) fail('AUTH', 'Your session has expired. Please sign in again.');
  var u = userLite(s.userId);
  if (!u) fail('AUTH', 'Your session is no longer valid. Please sign in again.');
  if (u.status === 'Disabled' || u.status === 'Pending') fail('AUTH', 'Your account is not active.');
  if (u.role !== SUPER) {
    var cs = companyStatus(u.companyId);
    if (cs !== 'Active') fail('AUTH', 'Your company account is ' + (cs || 'unavailable').toLowerCase() + '.');
  }
  ctx.user = u; ctx.cid = u.role === SUPER ? '' : u.companyId; ctx.role = u.role; ctx.employeeId = u.employeeId || ''; ctx.panel = panelOf(u);
  if (u.status === 'Temp' && ['boot', 'auth.changePassword', 'auth.logout'].indexOf(ctx.action) < 0) fail('PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password to continue.');
  if (route.auth === 'super' && u.role !== SUPER) fail('FORBIDDEN', 'You do not have access to this action.');
  if ((route.auth === 'company' || route.auth === 'self') && u.role === SUPER) fail('FORBIDDEN', 'This action is not available for the Super Admin.');
  if (route.auth === 'self' && !ctx.employeeId) fail('FORBIDDEN', 'This action needs an employee profile.');
  if (route.perm) { var pp = route.perm.split('.'); if (!can(ctx, pp[0], pp[1])) fail('FORBIDDEN', 'You do not have permission to ' + pp[1] + ' ' + pp[0] + '.'); }
}
function can(ctx, module, action) {
  if (ctx.role === SUPER) return true;
  if (ctx.role === 'ADMIN') return true;
  return !!permsOf(ctx.cid, ctx.role)[module + '.' + action];
}
function need(ctx, module, action) { if (!can(ctx, module, action)) fail('FORBIDDEN', 'You do not have permission for this.'); }

function throttleCheck(key) { if ((Number(CACHE.get('L_' + key)) || 0) >= 5) fail('LOCKED', 'Too many failed attempts. Please try again in 15 minutes.'); }
function throttleFail(key) { CACHE.put('L_' + key, String((Number(CACHE.get('L_' + key)) || 0) + 1), 900); }
function throttleClear(key) { CACHE.remove('L_' + key); }

var R_ = {}; // route registry (assigned below)
var ROUTES = R_;
function R(name, opts, fn) {
  ROUTES[name] = {
    auth: opts.auth || (opts.perm ? 'company' : 'any'), perm: opts.perm || '', write: !!opts.write, lock: !!(opts.write || opts.lock),
    audit: opts.audit, module: opts.module || (opts.perm ? opts.perm.split('.')[0] : 'system'), fn: fn
  };
}
function writeAudit(ctx, route) {
  audit(ctx.cid || ctx.auditCid || PLATFORM, ctx.user ? ctx.user.userId : '', ctx.role, route.module, ctx.action, ctx.entityId || '', ctx.remark || '');
}

/* ---------- user creation helpers ---------- */
function makeUserRow(cid, employeeId, role, loginId, email, phone, password, status) {
  var salt = newSalt();
  return { userId: newId('USR', 'user', 6), companyId: cid, employeeId: employeeId || '', role: role, loginId: loginId, email: email || '', phone: phone || '',
    passwordHash: hashPassword(password, salt), salt: salt, status: status || 'Active', createdAt: nowIso() };
}
function makeActivation(u) { // returns plain code; stores only a salted hash
  var code = randomCode(8), salt = 'ACT:' + newSalt();
  update('Users', u, { passwordHash: hashPassword(code, salt), salt: salt, status: 'Invited' });
  bustUser(u.userId);
  return code;
}
function isInvited(u) { return String(u.salt).indexOf('ACT:') === 0; }
function loginIdTaken(loginId, exceptUserId) { return !!findOne('Users', function (u) { return u.loginId === loginId && u.userId !== exceptUserId; }); }

function loginResult(u) {
  var token = createSession(u);
  var ctx = { user: userLite(u.userId), now: nowIso(), today: todayStr() };
  ctx.cid = u.role === SUPER ? '' : u.companyId; ctx.role = u.role; ctx.employeeId = u.employeeId || ''; ctx.panel = panelOf(u);
  return { token: token, boot: buildBoot(ctx) };
}

/* ---------- auth handlers ---------- */
function hLogin(ctx, p) {
  var mode = reqEnum(str(p.mode, 10), ['company', 'employee', 'super'], 'Login mode');
  var loginId = mode === 'employee' ? normPhone(p.loginId) : lc(p.loginId);
  var password = String(p.password || '');
  if (!loginId) fail('VALIDATION', (mode === 'employee' ? 'Phone number' : 'Email') + ' is required.', { field: 'loginId' });
  if (!password) fail('VALIDATION', 'Password is required.', { field: 'password' });
  if (mode === 'employee' && !RX.phone.test(loginId)) fail('VALIDATION', 'Enter your 10-digit phone number.', { field: 'loginId' });
  if (mode !== 'employee' && !RX.email.test(loginId)) fail('VALIDATION', 'Enter a valid email address.', { field: 'loginId' });
  throttleCheck(loginId);
  var u = findOne('Users', function (x) { return x.loginId === loginId; });
  var bad = function () { throttleFail(loginId); fail('BAD_CREDENTIALS', 'Incorrect login ID or password.'); };
  if (!u) bad();
  if (mode === 'super' && u.role !== SUPER) bad();
  if (mode !== 'super' && u.role === SUPER) bad();
  if (u.status === 'Invited' || isInvited(u)) fail('NOT_ACTIVATED', 'Your account is not activated yet. Use "Activate account" with the code your admin gave you.');
  if (hashPassword(password, u.salt) !== u.passwordHash) bad();
  if (u.status === 'Pending') fail('PENDING', 'Your company registration is awaiting Super Admin approval.');
  if (u.status === 'Disabled') fail('DISABLED', 'This account has been disabled. Please contact your administrator.');
  if (u.role !== SUPER) {
    var co = companyOf(u.companyId), st = co ? co.status : '';
    if (st === 'Pending') fail('PENDING', 'Your company registration is awaiting Super Admin approval.');
    if (st === 'Rejected') fail('REJECTED', 'Your company registration was rejected. Please contact platform support.');
    if (st === 'Suspended') fail('SUSPENDED', 'Your company account is suspended. Please contact platform support.');
    if (st !== 'Active') fail('DISABLED', 'Your company account is not active.');
  }
  throttleClear(loginId);
  var res = loginResult(u);
  audit(u.companyId || PLATFORM, u.userId, u.role, 'auth', 'auth.login', u.userId, mode);
  return res;
}
function hActivate(ctx, p) {
  var phone = reqPhone(p.phone, 'Phone number'), code = str(p.code, 20).toUpperCase(), pw = checkPassword(p.password);
  if (!code) fail('VALIDATION', 'Activation code is required.', { field: 'code' });
  throttleCheck('A' + phone);
  var u = findOne('Users', function (x) { return x.loginId === phone && x.role !== SUPER; });
  if (!u || !isInvited(u) || hashPassword(code, u.salt) !== u.passwordHash) { throttleFail('A' + phone); fail('BAD_CODE', 'The phone number or activation code is incorrect.'); }
  var co = companyOf(u.companyId);
  if (!co || co.status !== 'Active') fail('SUSPENDED', 'Your company account is not active.');
  var salt = newSalt();
  update('Users', u, { passwordHash: hashPassword(pw, salt), salt: salt, status: 'Active' });
  bustUser(u.userId); throttleClear('A' + phone);
  u = findOne('Users', function (x) { return x.userId === u.userId; });
  audit(u.companyId, u.userId, u.role, 'auth', 'auth.activate', u.userId, '');
  return loginResult(u);
}
function hLogout(ctx, p) { dropSession(ctx.token); ctx.entityId = ctx.user.userId; return { done: true }; }
function hChangePassword(ctx, p) {
  var old = String(p.oldPassword || ''), nw = checkPassword(p.newPassword);
  var u = findOne('Users', function (x) { return x.userId === ctx.user.userId; });
  if (hashPassword(old, u.salt) !== u.passwordHash) fail('VALIDATION', 'Current password is incorrect.', { field: 'oldPassword' });
  if (old === nw) fail('VALIDATION', 'New password must be different from the current one.', { field: 'newPassword' });
  var salt = newSalt();
  update('Users', u, { passwordHash: hashPassword(nw, salt), salt: salt, status: 'Active' });
  bustUser(u.userId); ctx.entityId = u.userId;
  return { done: true };
}
function hSignupCompany(ctx, p) {
  var d = {
    companyName: reqStr(p, 'companyName', 'Company name', 120), legalName: reqStr(p, 'legalName', 'Legal name', 160),
    gstin: str(p.gstin, 15).toUpperCase(), pan: str(p.pan, 10).toUpperCase(), address: reqStr(p, 'address', 'Address', 300),
    contactPerson: reqStr(p, 'contactPerson', 'Contact person', 100)
  };
  if (!RX.gstin.test(d.gstin)) fail('VALIDATION', 'GSTIN format is invalid (e.g. 27AABCU9603R1ZX).', { field: 'gstin' });
  if (!RX.pan.test(d.pan)) fail('VALIDATION', 'PAN format is invalid (e.g. AABCU9603R).', { field: 'pan' });
  d.email = reqEmail(p.email, 'Email'); d.phone = reqPhone(p.phone, 'Phone');
  var pw = checkPassword(p.password);
  if (d.gstin.substr(2, 10) !== d.pan) fail('VALIDATION', 'PAN must match characters 3–12 of the GSTIN.', { field: 'pan' });
  var all = rows('Companies');
  if (all.some(function (c) { return c.gstin === d.gstin; })) fail('DUPLICATE', 'A company with this GSTIN is already registered.', { field: 'gstin' });
  if (all.some(function (c) { return lc(c.email) === d.email; }) || loginIdTaken(d.email)) fail('DUPLICATE', 'This email address is already registered.', { field: 'email' });
  if (all.some(function (c) { return c.phone === d.phone; })) fail('DUPLICATE', 'This phone number is already registered.', { field: 'phone' });
  var cid = newId('CMP', 'company', 4), auto = !sflag(settingsFor(PLATFORM).verificationRequired);
  insert('Companies', { companyId: cid, companyName: d.companyName, legalName: d.legalName, gstin: d.gstin, pan: d.pan, email: d.email, phone: d.phone, address: d.address, contactPerson: d.contactPerson, status: 'Pending', createdAt: nowIso() });
  insert('Users', makeUserRow(cid, '', 'ADMIN', d.email, d.email, d.phone, pw, 'Pending'));
  audit(cid, '', 'ADMIN', 'auth', 'company.signup', cid, d.companyName);
  if (auto) { approveCompanyInternal(cid, 'SYSTEM', 'Auto-approved (verification not required)'); return { companyId: cid, status: 'Active', message: 'Registration complete. You can sign in now.' }; }
  return { companyId: cid, status: 'Pending', message: 'Registration received. You can sign in once the Super Admin approves your company.' };
}
function approveCompanyInternal(cid, actorId, remark) {
  var co = companyOf(cid);
  if (!findOne('Roles', function (r) { return r.companyId === cid; })) seedCompanyData(cid);
  update('Companies', co, { status: 'Active' }); bustCompany(cid);
  where('Users', function (u) { return u.companyId === cid && u.role === 'ADMIN' && u.status === 'Pending'; }).forEach(function (u) { update('Users', u, { status: 'Active' }); bustUser(u.userId); });
  audit(cid, actorId, actorId === 'SYSTEM' ? 'SYSTEM' : SUPER, 'companies', 'company.approve', cid, remark);
}

/* ============================== 7. BOOTSTRAP ============================== */
function platformPublic() {
  var s = settingsFor(PLATFORM);
  return { name: s.platformName || DEFAULT_APP_NAME, logo: brandAsset(PLATFORM, 'platformLogoFileId'), verificationRequired: sflag(s.verificationRequired), defaultGeofenceRadiusM: num(s.defaultGeofenceRadiusM) || 50 };
}
function pendingCounts(cid) {
  var ids = empIdSet(cid);
  var leave = where('LeaveRequests', function (r) { return r.status === 'Pending' && ids[r.employeeId]; }).length;
  var special = where('SpecialRequests', function (r) { return r.status === 'Pending' && ids[r.employeeId]; }).length;
  var exp = where('ExpenseClaims', function (r) { return r.status === 'Pending' && ids[r.employeeId]; }).length;
  var tr = where('TransferRequests', function (r) { return r.status === 'Pending' && ids[r.employeeId]; }).length;
  return { leave: leave, special: special, expense: exp, transfer: tr, total: leave + special + exp + tr };
}
function lookups(cid) {
  return {
    leaveTypes: where('LeaveTypes', function (x) { return x.companyId === cid; }).map(function (x) { return { leaveType: x.leaveType, defaultDaysPerYear: x.defaultDaysPerYear }; }),
    expenseCategories: where('ExpenseCategories', function (x) { return x.companyId === cid; }).map(function (x) { return x.category; }),
    roles: where('Roles', function (x) { return x.companyId === cid; }).map(function (x) { return { roleId: x.roleId, roleName: x.roleName }; }),
    docTypes: DOC_TYPES
  };
}
function buildBoot(ctx) {
  var u = ctx.user, out = {
    loggedIn: true, platform: platformPublic(),
    now: { today: ctx.today, month: ctx.today.slice(0, 7), fy: fyOf(ctx.today) },
    user: { userId: u.userId, role: u.role, employeeId: ctx.employeeId, loginId: u.loginId, email: u.email, panel: ctx.panel, status: u.status },
    mustChangePassword: u.status === 'Temp', modules: MODULES, actions: ACTIONS
  };
  out.user.name = userName(ctx.cid, u.userId);
  out.canSwitch = ctx.panel === 'admin' && !!ctx.employeeId;
  if (u.role === SUPER) {
    out.perms = {}; out.user.roleName = 'Super Admin';
    out.counts = { notifications: unreadCount(u.userId), pendingCompanies: where('Companies', function (c) { return c.status === 'Pending'; }).length };
    return out;
  }
  var co = companyOf(ctx.cid), s = settingsFor(ctx.cid);
  out.perms = permsOf(ctx.cid, u.role); out.user.roleName = roleName(ctx.cid, u.role);
  out.company = {
    companyId: co.companyId, name: co.companyName, legalName: co.legalName, status: co.status, brandColor: s.brandColor, logo: brandAsset(ctx.cid, 'logoFileId'),
    settings: { shiftStart: s.shiftStart, graceMinutes: num(s.graceMinutes), geofenceRadiusM: num(s.geofenceRadiusM), halfDayMinutes: num(s.halfDayMinutes), weeklyOff: s.weeklyOff, payslipTemplate: s.payslipTemplate }
  };
  out.lookups = lookups(ctx.cid);
  out.counts = { notifications: unreadCount(u.userId) };
  if (ctx.panel === 'admin') out.counts.pending = pendingCounts(ctx.cid);
  if (ctx.employeeId) {
    var e = empsOf(ctx.cid).byId[ctx.employeeId];
    if (e) { out.employee = { employeeId: e.employeeId, empCode: e.empCode, fullName: e.fullName, designation: e.designation, photoFileId: e.photoFileId }; out.user.name = e.fullName; }
  }
  return out;
}
function unreadCount(userId) { return where('Notifications', function (n) { return n.userId === userId && !n.isRead; }).length; }
function hBoot(ctx, p) {
  var s = ctx.token ? resolveSession(ctx.token) : null;
  var pub = { loggedIn: false, platform: null };
  var setup = !!PROP.getProperty('SS_ID');
  if (!setup) return { loggedIn: false, needsSetup: true, platform: { name: DEFAULT_APP_NAME, logo: '' } };
  pub.platform = platformPublic();
  if (!s) return pub;
  var u = userLite(s.userId);
  if (!u || u.status === 'Disabled' || u.status === 'Pending') return pub;
  if (u.role !== SUPER && companyStatus(u.companyId) !== 'Active') return pub;
  ctx.user = u; ctx.cid = u.role === SUPER ? '' : u.companyId; ctx.role = u.role; ctx.employeeId = u.employeeId || ''; ctx.panel = panelOf(u);
  return buildBoot(ctx);
}

/* ============================== 8. SUPER ADMIN ============================== */
function monthKey(iso) { return String(iso).slice(0, 7); }
function hSaDashboard(ctx, p) {
  var cos = rows('Companies'), emps = rows('Employees'), thisM = ctx.today.slice(0, 7);
  var open = where('Tickets', function (t) { return t.assignedTo === 'SUPER_ADMIN' && (t.status === 'Open' || t.status === 'In Progress'); }).length;
  var trend = [];
  for (var i = 5; i >= 0; i--) { var m = addMonths(thisM, -i); trend.push({ label: m, value: cos.filter(function (c) { return monthKey(c.createdAt) === m; }).length }); }
  var pend = cos.filter(function (c) { return c.status === 'Pending'; });
  return {
    cards: {
      total: cos.length, pending: pend.length, active: cos.filter(function (c) { return c.status === 'Active'; }).length,
      suspended: cos.filter(function (c) { return c.status === 'Suspended'; }).length,
      employees: emps.filter(function (e) { return e.status === 'Active'; }).length, openTickets: open,
      newThisMonth: cos.filter(function (c) { return monthKey(c.createdAt) === thisM; }).length
    },
    signupTrend: trend,
    statusSplit: ['Active', 'Pending', 'Suspended', 'Rejected'].map(function (s) { return { label: s, value: cos.filter(function (c) { return c.status === s; }).length }; }),
    pendingList: sortBy(pend, function (c) { return c.createdAt; }, true).slice(0, 6).map(function (c) { return { companyId: c.companyId, companyName: c.companyName, email: c.email, createdAt: c.createdAt }; })
  };
}
function companyCard(c, empCounts, prjCounts) {
  return { companyId: c.companyId, companyName: c.companyName, legalName: c.legalName, gstin: c.gstin, pan: c.pan, email: c.email, phone: c.phone, address: c.address, contactPerson: c.contactPerson, status: c.status, createdAt: c.createdAt, employees: empCounts[c.companyId] || 0, projects: prjCounts[c.companyId] || 0 };
}
function hSaCompaniesList(ctx, p) {
  var st = str(p.status, 20), q = p.q;
  var list = rows('Companies').filter(function (c) { return (!st || c.status === st) && matches(q, [c.companyName, c.legalName, c.gstin, c.email, c.phone, c.companyId]); });
  sortBy(list, function (c) { return c.createdAt; }, true);
  var emp = {}, prj = {};
  rows('Employees').forEach(function (e) { if (e.status === 'Active') emp[e.companyId] = (emp[e.companyId] || 0) + 1; });
  rows('Projects').forEach(function (x) { prj[x.companyId] = (prj[x.companyId] || 0) + 1; });
  var pg = paginate(list, p);
  pg.rows = pg.rows.map(function (c) { return companyCard(c, emp, prj); });
  return pg;
}
function hSaCompanyGet(ctx, p) {
  var c = companyOf(str(p.companyId, 20));
  if (!c) fail('NOT_FOUND', 'Company not found.');
  var adm = where('Users', function (u) { return u.companyId === c.companyId && u.role === 'ADMIN'; })[0];
  var emps = where('Employees', function (e) { return e.companyId === c.companyId; });
  var logs = where('AuditLog', function (l) { return l.companyId === c.companyId; });
  sortBy(logs, function (l) { return l.logId; }, true);
  var dec = logs.filter(function (l) { return l.action === 'company.approve' || l.action === 'company.reject' || l.action === 'company.suspend' || l.action === 'company.reactivate'; })[0];
  return {
    company: companyCard(c, {}, {}), admin: adm ? { loginId: adm.loginId, status: adm.status, email: adm.email, phone: adm.phone } : null,
    stats: { employees: emps.length, activeEmployees: emps.filter(function (e) { return e.status === 'Active'; }).length, projects: where('Projects', function (x) { return x.companyId === c.companyId; }).length, tickets: where('Tickets', function (t) { return t.companyId === c.companyId; }).length },
    lastDecision: dec ? { action: dec.action, remark: dec.remark, at: dec.createdAt } : null,
    recent: logs.slice(0, 8).map(function (l) { return { action: l.action, module: l.module, remark: l.remark, createdAt: l.createdAt }; })
  };
}
function hSaCompanyDecide(ctx, p) {
  var c = companyOf(str(p.companyId, 20)); if (!c) fail('NOT_FOUND', 'Company not found.');
  var decision = reqEnum(str(p.decision, 10), ['approve', 'reject'], 'Decision'), remark = needRemark(p);
  if (c.status !== 'Pending') fail('STATE', 'Only pending companies can be approved or rejected.');
  if (decision === 'approve') approveCompanyInternal(c.companyId, ctx.user.userId, remark);
  else {
    update('Companies', c, { status: 'Rejected' }); bustCompany(c.companyId);
    where('Users', function (u) { return u.companyId === c.companyId; }).forEach(function (u) { update('Users', u, { status: 'Disabled' }); bustUser(u.userId); });
    audit(c.companyId, ctx.user.userId, SUPER, 'companies', 'company.reject', c.companyId, remark);
  }
  return { companyId: c.companyId, status: decision === 'approve' ? 'Active' : 'Rejected' };
}
function hSaCompanySetStatus(ctx, p) {
  var c = companyOf(str(p.companyId, 20)); if (!c) fail('NOT_FOUND', 'Company not found.');
  var st = reqEnum(str(p.status, 12), ['Active', 'Suspended'], 'Status'), remark = needRemark(p);
  if (c.status !== 'Active' && c.status !== 'Suspended') fail('STATE', 'Only active or suspended companies can be changed.');
  update('Companies', c, { status: st }); bustCompany(c.companyId);
  audit(c.companyId, ctx.user.userId, SUPER, 'companies', st === 'Suspended' ? 'company.suspend' : 'company.reactivate', c.companyId, remark);
  return { status: st };
}
function hSaResetAdmin(ctx, p) {
  var c = companyOf(str(p.companyId, 20)); if (!c) fail('NOT_FOUND', 'Company not found.');
  var u = where('Users', function (x) { return x.companyId === c.companyId && x.role === 'ADMIN'; })[0];
  if (!u) fail('NOT_FOUND', 'Company admin user not found.');
  if (c.status === 'Pending' || c.status === 'Rejected') fail('STATE', 'Approve the company first.');
  var tp = tempPassword(), salt = newSalt();
  update('Users', u, { passwordHash: hashPassword(tp, salt), salt: salt, status: 'Temp' }); bustUser(u.userId);
  audit(c.companyId, ctx.user.userId, SUPER, 'companies', 'company.resetAdminPassword', u.userId, '');
  return { loginId: u.loginId, tempPassword: tp };
}
function hSaSettingsGet(ctx, p) { var s = settingsFor(PLATFORM); return { settings: s, logo: brandAsset(PLATFORM, 'platformLogoFileId') }; }
function hSaSettingsSave(ctx, p) {
  var d = {
    platformName: reqStr(p, 'platformName', 'Platform name', 60),
    defaultGeofenceRadiusM: String(optNum(p.defaultGeofenceRadiusM, 'Default geofence radius', 10, 5000) || 50),
    sessionTimeoutMin: String(optNum(p.sessionTimeoutMin, 'Session timeout', 5, 1440) || 480),
    verificationRequired: p.verificationRequired === true || String(p.verificationRequired).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'
  };
  saveSettings(PLATFORM, d); ctx.remark = 'Platform settings updated';
  return { settings: settingsFor(PLATFORM) };
}
function hSaSettingsUpload(ctx, p) {
  var f = saveUpload(PLATFORM, ['Branding'], p.file, { imageOnly: true, maxBytes: 69000 });
  var old = settingsFor(PLATFORM).platformLogoFileId; if (old) { CACHE.remove('A_' + old); trashFile(old); }
  saveSettings(PLATFORM, { platformLogoFileId: f.fileId }); ctx.entityId = f.fileId;
  return { logo: brandAsset(PLATFORM, 'platformLogoFileId') };
}

/* ============================== 9. TICKETS ============================== */
function ticketLevel(ctx, t) {
  if (ctx.role === SUPER) return t.assignedTo === 'SUPER_ADMIN' ? 'manage' : null;
  if (t.companyId !== ctx.cid) return null;
  if (t.assignedTo === 'COMPANY' && can(ctx, 'support', 'view')) return can(ctx, 'support', 'edit') ? 'manage' : 'read';
  if (t.raisedBy === ctx.user.userId) return 'owner';
  if (t.assignedTo === 'SUPER_ADMIN' && can(ctx, 'support', 'view')) return can(ctx, 'support', 'create') ? 'comment' : 'read';
  return null;
}
function ticketOut(t, names) {
  return { ticketId: t.ticketId, companyId: t.companyId, raisedBy: t.raisedBy, raisedByName: names(t), raisedByRole: t.raisedByRole, subject: t.subject, description: t.description, status: t.status, assignedTo: t.assignedTo, createdAt: t.createdAt };
}
function hTicketList(ctx, p) {
  var scope = reqEnum(str(p.scope, 10), ['mine', 'inbox', 'own', 'platform'], 'Scope'), st = str(p.status, 20), list;
  if (scope === 'platform') { if (ctx.role !== SUPER) fail('FORBIDDEN', 'Not allowed.'); list = where('Tickets', function (t) { return t.assignedTo === 'SUPER_ADMIN'; }); }
  else {
    if (ctx.role === SUPER) fail('FORBIDDEN', 'Not allowed.');
    if (scope === 'mine') list = where('Tickets', function (t) { return t.companyId === ctx.cid && t.raisedBy === ctx.user.userId; });
    else {
      need(ctx, 'support', 'view');
      var to = scope === 'inbox' ? 'COMPANY' : 'SUPER_ADMIN';
      list = where('Tickets', function (t) { return t.companyId === ctx.cid && t.assignedTo === to; });
    }
  }
  list = list.filter(function (t) { return (!st || t.status === st) && matches(p.q, [t.subject, t.description, t.ticketId]); });
  sortBy(list, function (t) { return t.ticketId; }, true);
  var pg = paginate(list, p), cache = {};
  var cos = idx(rows('Companies'), 'companyId');
  pg.rows = pg.rows.map(function (t) {
    var o = ticketOut(t, function (x) { return cache[x.raisedBy] || (cache[x.raisedBy] = userName(x.companyId, x.raisedBy)); });
    o.companyName = cos[t.companyId] ? cos[t.companyId].companyName : '';
    return o;
  });
  return pg;
}
function hTicketGet(ctx, p) {
  var t = findOne('Tickets', function (x) { return x.ticketId === str(p.ticketId, 20); });
  if (!t) fail('NOT_FOUND', 'Ticket not found.');
  var lvl = ticketLevel(ctx, t); if (!lvl) fail('FORBIDDEN', 'You cannot view this ticket.');
  var cache = {}, nm = function (uid) { return cache[uid] || (cache[uid] = userName(t.companyId, uid)); };
  var comments = sortBy(where('TicketComments', function (c) { return c.ticketId === t.ticketId; }), function (c) { return c.commentId; }).map(function (c) { return { commentId: c.commentId, authorId: c.authorId, authorName: nm(c.authorId), message: c.message, createdAt: c.createdAt, mine: c.authorId === ctx.user.userId }; });
  var co = companyOf(t.companyId);
  var o = ticketOut(t, function (x) { return nm(x.raisedBy); }); o.companyName = co ? co.companyName : '';
  return { ticket: o, comments: comments, level: lvl };
}
function hTicketCreate(ctx, p) {
  var subject = reqStr(p, 'subject', 'Subject', 140), desc = reqStr(p, 'description', 'Description', 2000);
  var to = reqEnum(str(p.to, 12), ['COMPANY', 'SUPER_ADMIN'], 'Recipient');
  if (to === 'SUPER_ADMIN') need(ctx, 'support', 'create');
  else if (!ctx.employeeId) fail('FORBIDDEN', 'Only employees can raise tickets to the company admin.');
  var id = newId('TKT', 'ticket', 5);
  insert('Tickets', { ticketId: id, companyId: ctx.cid, raisedBy: ctx.user.userId, raisedByRole: ctx.role, subject: subject, description: desc, status: 'Open', assignedTo: to, createdAt: ctx.now });
  if (to === 'COMPANY') notifyAdmins(ctx.cid, 'New support ticket ' + id + ': ' + subject, 'support.view');
  else where('Users', function (u) { return u.role === SUPER; }).forEach(function (u) { notify('', u.userId, 'New ticket ' + id + ' from ' + (companyOf(ctx.cid) || {}).companyName + ': ' + subject); });
  ctx.entityId = id; ctx.remark = subject;
  return { ticketId: id };
}
function hTicketReply(ctx, p) {
  var t = findOne('Tickets', function (x) { return x.ticketId === str(p.ticketId, 20); });
  if (!t) fail('NOT_FOUND', 'Ticket not found.');
  var lvl = ticketLevel(ctx, t);
  if (lvl !== 'manage' && lvl !== 'owner' && lvl !== 'comment') fail('FORBIDDEN', 'You cannot reply to this ticket.');
  var msg = reqStr(p, 'message', 'Message', 2000);
  if (t.status === 'Closed') fail('STATE', 'This ticket is closed.');
  insert('TicketComments', { commentId: newId('TCM', 'tcomment', 6), ticketId: t.ticketId, authorId: ctx.user.userId, message: msg, createdAt: ctx.now });
  var patch = {};
  if (lvl === 'manage' && t.status === 'Open') patch.status = 'In Progress';
  if (p.status && lvl === 'manage') patch.status = reqEnum(str(p.status, 12), ['Open', 'In Progress', 'Resolved', 'Closed'], 'Status');
  if (Object.keys(patch).length) update('Tickets', t, patch);
  if (t.raisedBy !== ctx.user.userId) notify(t.companyId, t.raisedBy, 'Reply on ticket ' + t.ticketId + ': ' + msg.slice(0, 80));
  else if (t.assignedTo === 'COMPANY') notifyAdmins(t.companyId, 'Reply from employee on ticket ' + t.ticketId, 'support.view');
  else where('Users', function (u) { return u.role === SUPER; }).forEach(function (u) { notify('', u.userId, 'Reply on ticket ' + t.ticketId); });
  ctx.entityId = t.ticketId; ctx.remark = msg.slice(0, 120); ctx.auditCid = t.companyId;
  return { done: true };
}
function hTicketStatus(ctx, p) {
  var t = findOne('Tickets', function (x) { return x.ticketId === str(p.ticketId, 20); });
  if (!t) fail('NOT_FOUND', 'Ticket not found.');
  var lvl = ticketLevel(ctx, t), st = reqEnum(str(p.status, 12), ['Open', 'In Progress', 'Resolved', 'Closed'], 'Status');
  if (lvl !== 'manage' && !(lvl === 'owner' && st === 'Closed')) fail('FORBIDDEN', 'You cannot change this ticket.');
  update('Tickets', t, { status: st });
  if (t.raisedBy !== ctx.user.userId) notify(t.companyId, t.raisedBy, 'Ticket ' + t.ticketId + ' is now ' + st);
  ctx.entityId = t.ticketId; ctx.remark = st; ctx.auditCid = t.companyId;
  return { status: st };
}

/* ============================== 10. NOTIFICATIONS / AUDIT / SEARCH ============================== */
function hNotifList(ctx, p) {
  var mine = where('Notifications', function (n) { return n.userId === ctx.user.userId; });
  sortBy(mine, function (n) { return n.notifId; }, true);
  return { unread: mine.filter(function (n) { return !n.isRead; }).length, items: mine.slice(0, 30).map(function (n) { return { notifId: n.notifId, message: n.message, isRead: n.isRead, createdAt: n.createdAt }; }) };
}
function hNotifRead(ctx, p) {
  var ids = {}; (Array.isArray(p.ids) ? p.ids : []).forEach(function (i) { ids[str(i, 20)] = 1; });
  var patches = where('Notifications', function (n) { return n.userId === ctx.user.userId && !n.isRead && (p.all || ids[n.notifId]); }).map(function (n) { return { _row: n._row, isRead: true }; });
  updateMany('Notifications', patches);
  return { marked: patches.length };
}
function auditQuery(ctx, p, cid) {
  var list = rows('AuditLog').filter(function (l) {
    if (cid !== null && l.companyId !== cid) return false;
    if (cid === null && p.companyId && l.companyId !== str(p.companyId, 20)) return false;
    if (p.module && l.module !== str(p.module, 30)) return false;
    var d = l.createdAt.slice(0, 10);
    if (p.from && isDateStr(p.from) && d < p.from) return false;
    if (p.to && isDateStr(p.to) && d > p.to) return false;
    return matches(p.q, [l.action, l.remark, l.entityId, l.actorId]);
  });
  sortBy(list, function (l) { return l.logId; }, true);
  var modules = uniq(rows('AuditLog').filter(function (l) { return cid === null || l.companyId === cid; }).map(function (l) { return l.module; })).sort();
  var pg = paginate(list, p), names = {}, cos = idx(rows('Companies'), 'companyId');
  pg.rows = pg.rows.map(function (l) {
    if (l.actorId && names[l.actorId] === undefined) names[l.actorId] = l.actorId === 'SYSTEM' ? 'System' : userName(l.companyId, l.actorId);
    return { logId: l.logId, companyId: l.companyId, companyName: cos[l.companyId] ? cos[l.companyId].companyName : (l.companyId === PLATFORM ? 'Platform' : ''), actorId: l.actorId, actorName: l.actorId ? names[l.actorId] : 'Anonymous', actorRole: l.actorRole, module: l.module, action: l.action, entityId: l.entityId, remark: l.remark, createdAt: l.createdAt };
  });
  pg.modules = modules;
  return pg;
}
function hAuditList(ctx, p) { return auditQuery(ctx, p, ctx.cid); }
function hSaAuditList(ctx, p) { return auditQuery(ctx, p, null); }
function hSearch(ctx, p) {
  if (ctx.panel !== 'admin') fail('FORBIDDEN', 'Search is only available to administrators.');
  var q = lc(p.q); if (q.length < 2) return { employees: [], projects: [] };
  var out = { employees: [], projects: [] };
  if (can(ctx, 'employees', 'view')) out.employees = empsOf(ctx.cid).list.filter(function (e) { return matches(q, [e.fullName, e.empCode, e.phone, e.designation]); }).slice(0, 6).map(function (e) { return { employeeId: e.employeeId, fullName: e.fullName, empCode: e.empCode, designation: e.designation }; });
  if (can(ctx, 'projects', 'view')) out.projects = projectsOf(ctx.cid).list.filter(function (x) { return matches(q, [x.name, x.clientName, x.address]); }).slice(0, 6).map(function (x) { return { projectId: x.projectId, name: x.name, type: x.type }; });
  return out;
}
function hPeopleSearch(ctx, p) { // authorizer name search for special requests
  var q = lc(p.q), list = empsOf(ctx.cid).list.filter(function (e) { return e.status === 'Active' && e.employeeId !== ctx.employeeId && (!q || matches(q, [e.fullName, e.empCode, e.designation])); });
  sortBy(list, function (e) { return e.fullName.toLowerCase(); });
  return list.slice(0, 8).map(function (e) { return { employeeId: e.employeeId, fullName: e.fullName, designation: e.designation, empCode: e.empCode }; });
}
function hApprovers(ctx, p) {
  return where('Users', function (u) { return u.companyId === ctx.cid && u.role !== 'EMPLOYEE' && (u.status === 'Active' || u.status === 'Temp'); })
    .filter(function (u) { return u.role === 'ADMIN' || permsOf(ctx.cid, u.role)['projects.approve']; })
    .map(function (u) { return { userId: u.userId, name: userName(ctx.cid, u.userId), roleName: roleName(ctx.cid, u.role) }; });
}
function hFileGet(ctx, p) {
  var id = str(p.fileId, 200); if (!id) fail('VALIDATION', 'File is required.');
  var cid = ctx.cid, allowed = false, eIds = cid ? empIdSet(cid) : {}, self = ctx.employeeId;
  var ownerOk = function (empId, module) { return eIds[empId] && (empId === self || can(ctx, module, 'view')); };
  if (ctx.role === SUPER) { allowed = settingsFor(PLATFORM).platformLogoFileId === id; }
  else {
    var s = settingsFor(cid);
    if (s.logoFileId === id || s.signatureFileId === id || s.stampFileId === id || settingsFor(PLATFORM).platformLogoFileId === id) allowed = true;
    if (!allowed) { var e = findOne('Employees', function (x) { return x.photoFileId === id; }); if (e && ownerOk(e.employeeId, 'employees')) allowed = true; }
    if (!allowed) { var d = findOne('EmployeeDocuments', function (x) { return x.fileId === id; }); if (d && ownerOk(d.employeeId, 'employees')) allowed = true; }
    if (!allowed) { var c = findOne('ExpenseClaims', function (x) { return x.billFileId === id; }); if (c && ownerOk(c.employeeId, 'expenses')) allowed = true; }
    if (!allowed) { var ps = findOne('Payslips', function (x) { return x.fileId === id; }); if (ps && ownerOk(ps.employeeId, 'payroll')) allowed = true; }
    if (!allowed) { var dc = findOne('Documents', function (x) { return x.fileId === id && x.companyId === cid; }); if (dc && (can(ctx, 'documents', 'view') || docVisible(dc, ctx.role))) allowed = true; }
  }
  if (!allowed) fail('FORBIDDEN', 'You do not have access to this file.');
  return readFile(id);
}

/* ============================== 11. EMPLOYEES ============================== */
var EMP_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Daily Wage'];
function activeAssignMap(cid) {
  var ids = empIdSet(cid), m = {};
  rows('ProjectAssignments').forEach(function (a) { if (a.status === 'Active' && ids[a.employeeId]) m[a.employeeId] = a; });
  return m;
}
function currentSalary(empId) {
  var list = where('SalaryStructures', function (s) { return s.employeeId === empId; });
  var cur = list.filter(function (s) { return s.isCurrent; })[0];
  return cur || sortBy(list, function (s) { return s.effectiveFrom; }, true)[0] || null;
}
function salaryOut(s) { return s ? { id: s.id, effectiveFrom: s.effectiveFrom, basic: s.basic, hra: s.hra, specialAllowance: s.specialAllowance, monthlyGross: s.monthlyGross, isCurrent: s.isCurrent } : null; }
function empBrief(cid, e, am, prj) {
  var a = am[e.employeeId], pr = a ? prj[a.projectId] : null;
  return { employeeId: e.employeeId, empCode: e.empCode, fullName: e.fullName, phone: e.phone, email: e.email, designation: e.designation, department: e.department, doj: e.doj, employmentType: e.employmentType, status: e.status, roleId: e.roleId, photoFileId: e.photoFileId, currentProject: pr ? { projectId: pr.projectId, name: pr.name } : null };
}
function hEmployeeList(ctx, p) {
  var cid = ctx.cid, am = activeAssignMap(cid), prj = projectsOf(cid).byId;
  var st = str(p.status, 12), dep = str(p.department, 60), pid = str(p.projectId, 20);
  var all = empsOf(cid).list;
  var list = all.filter(function (e) {
    if (st && e.status !== st) return false;
    if (dep && e.department !== dep) return false;
    if (pid === 'NONE' && am[e.employeeId]) return false;
    if (pid && pid !== 'NONE' && !(am[e.employeeId] && am[e.employeeId].projectId === pid)) return false;
    return matches(p.q, [e.fullName, e.empCode, e.phone, e.email, e.designation, e.department]);
  });
  sortBy(list, function (e) { return e.fullName.toLowerCase(); });
  var pg = paginate(list, p);
  pg.rows = pg.rows.map(function (e) { return empBrief(cid, e, am, prj); });
  pg.departments = uniq(all.map(function (e) { return e.department; }).filter(Boolean)).sort();
  pg.counts = { total: all.length, active: all.filter(function (e) { return e.status === 'Active'; }).length };
  return pg;
}
function getEmployeeScoped(ctx, id) {
  var e = empsOf(ctx.cid).byId[str(id, 20)];
  if (!e) fail('NOT_FOUND', 'Employee not found.');
  return e;
}
function docsOut(cid, empId) {
  return sortBy(where('EmployeeDocuments', function (d) { return d.employeeId === empId; }), function (d) { return d.docId; }, true).map(function (d) {
    return { docId: d.docId, docType: d.docType, fileId: d.fileId, fileName: d.fileName, createdAt: d.createdAt, uploadedByName: userName(cid, d.uploadedBy) };
  });
}
function profileOf(empId) { return findOne('EmployeeProfiles', function (x) { return x.employeeId === empId; }); }
function hEmployeeGet(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), cid = ctx.cid, pr = profileOf(e.employeeId) || {};
  var u = userForEmployee(e.employeeId), a = activeAssignMap(cid)[e.employeeId];
  var history = sortBy(where('SalaryStructures', function (s) { return s.employeeId === e.employeeId; }), function (s) { return s.effectiveFrom; }, true).map(salaryOut);
  var emp = {}; Object.keys(e).forEach(function (k) { if (k !== '_row') emp[k] = e[k]; });
  return {
    employee: emp, roleName: roleName(cid, e.roleId),
    profile: { dob: pr.dob || '', gender: pr.gender || '', address: pr.address || '', emergencyContact: pr.emergencyContact || '', maritalStatus: pr.maritalStatus || '' },
    docs: docsOut(cid, e.employeeId), salary: can(ctx, 'payroll', 'view') || can(ctx, 'employees', 'edit') ? salaryOut(currentSalary(e.employeeId)) : null, salaryHistory: history,
    assignment: a ? { assignmentId: a.assignmentId, projectId: a.projectId, projectName: (projectsOf(cid).byId[a.projectId] || {}).name, startDate: a.startDate } : null,
    access: u ? { status: u.status, loginId: u.loginId, invited: isInvited(u) } : null
  };
}
function validateEmployee(p, isNew) {
  var d = {
    fullName: reqStr(p, 'fullName', 'Full name', 100), designation: str(p.designation, 80), department: str(p.department, 60),
    employmentType: str(p.employmentType, 20) || 'Full-time', bankName: str(p.bankName, 80), accountNo: str(p.accountNo, 20).replace(/\s/g, ''),
    ifsc: str(p.ifsc, 11).toUpperCase(), panNumber: str(p.panNumber, 10).toUpperCase(), uan: str(p.uan, 12).replace(/\s/g, ''), esicNo: str(p.esicNo, 17).replace(/\s/g, '')
  };
  d.phone = reqPhone(p.phone, 'Phone (login ID)');
  d.email = p.email ? reqEmail(p.email) : '';
  d.doj = reqDate(p.doj, 'Date of joining');
  reqEnum(d.employmentType, EMP_TYPES, 'Employment type');
  if (d.accountNo && !/^\d{6,18}$/.test(d.accountNo)) fail('VALIDATION', 'Account number must be 6–18 digits.', { field: 'accountNo' });
  if (d.ifsc && !RX.ifsc.test(d.ifsc)) fail('VALIDATION', 'IFSC code is invalid (e.g. HDFC0001234).', { field: 'ifsc' });
  if (d.panNumber && !RX.pan.test(d.panNumber)) fail('VALIDATION', 'PAN is invalid (e.g. ABCDE1234F).', { field: 'panNumber' });
  if (d.uan && !/^\d{12}$/.test(d.uan)) fail('VALIDATION', 'UAN must be 12 digits.', { field: 'uan' });
  if (d.esicNo && !/^\d{10,17}$/.test(d.esicNo)) fail('VALIDATION', 'ESIC number must be 10–17 digits.', { field: 'esicNo' });
  if (p.dob && !isDateStr(str(p.dob, 10))) fail('VALIDATION', 'Date of birth is invalid.', { field: 'dob' });
  if (p.gender && ['Male', 'Female', 'Other'].indexOf(str(p.gender, 10)) < 0) fail('VALIDATION', 'Gender is invalid.', { field: 'gender' });
  return d;
}
function parseSalary(s) {
  if (!s || typeof s !== 'object') return null;
  if ((s.basic === '' || s.basic == null) && (s.hra === '' || s.hra == null) && (s.specialAllowance === '' || s.specialAllowance == null)) return null;
  var out = { effectiveFrom: s.effectiveFrom ? reqDate(s.effectiveFrom, 'Salary effective date') : todayStr(), basic: optNum(s.basic, 'Basic salary', 0, 10000000), hra: optNum(s.hra, 'HRA', 0, 10000000), specialAllowance: optNum(s.specialAllowance, 'Special allowance', 0, 10000000) };
  out.monthlyGross = round2(out.basic + out.hra + out.specialAllowance);
  if (out.monthlyGross <= 0) fail('VALIDATION', 'Salary must be greater than zero.', { field: 'basic' });
  if (out.basic <= 0) fail('VALIDATION', 'Basic salary is required.', { field: 'basic' });
  return out;
}
function saveSalary(empId, sal) {
  var cur = currentSalary(empId);
  if (cur && cur.basic === sal.basic && cur.hra === sal.hra && cur.specialAllowance === sal.specialAllowance && cur.effectiveFrom === sal.effectiveFrom) return false;
  var olds = where('SalaryStructures', function (s) { return s.employeeId === empId && s.isCurrent; }).map(function (s) { return { _row: s._row, isCurrent: false }; });
  updateMany('SalaryStructures', olds);
  insert('SalaryStructures', { id: newId('SAL', 'salary', 6), employeeId: empId, effectiveFrom: sal.effectiveFrom, basic: sal.basic, hra: sal.hra, specialAllowance: sal.specialAllowance, monthlyGross: sal.monthlyGross, isCurrent: true });
  return true;
}
function initBalances(cid, empId, fy) {
  var have = {};
  where('LeaveBalances', function (b) { return b.employeeId === empId && b.fy === fy; }).forEach(function (b) { have[b.leaveType] = 1; });
  var add = where('LeaveTypes', function (t) { return t.companyId === cid && t.leaveType !== UNPAID && !have[t.leaveType]; })
    .map(function (t) { return { employeeId: empId, leaveType: t.leaveType, fy: fy, balance: t.defaultDaysPerYear }; });
  insert('LeaveBalances', add);
}
function hEmployeeSave(ctx, p) {
  var cid = ctx.cid, d = validateEmployee(p), sal = parseSalary(p.salary), roleId = str(p.roleId, 30) || 'EMPLOYEE';
  var roleOk = findOne('Roles', function (r) { return r.companyId === cid && r.roleId === roleId; });
  if (!roleOk) fail('VALIDATION', 'Role is invalid.', { field: 'roleId' });
  var prof = { dob: str(p.dob, 10), gender: str(p.gender, 10), address: str(p.address, 300), emergencyContact: str(p.emergencyContact, 100), maritalStatus: str(p.maritalStatus, 20) };
  if (p.employeeId) {
    need(ctx, 'employees', 'edit');
    var e = getEmployeeScoped(ctx, p.employeeId), u = userForEmployee(e.employeeId);
    if (roleId !== e.roleId && ctx.role !== 'ADMIN') fail('FORBIDDEN', 'Only the Company Admin can change an employee role.');
    if (d.phone !== e.phone && loginIdTaken(d.phone, u ? u.userId : '')) fail('DUPLICATE', 'This phone number is already used by another login.', { field: 'phone' });
    var st = str(p.status, 12) || e.status; reqEnum(st, ['Active', 'Inactive', 'Exited'], 'Status');
    update('Employees', e, { fullName: d.fullName, phone: d.phone, email: d.email, designation: d.designation, department: d.department, doj: d.doj, employmentType: d.employmentType, bankName: d.bankName, accountNo: d.accountNo, ifsc: d.ifsc, panNumber: d.panNumber, uan: d.uan, esicNo: d.esicNo, roleId: roleId, status: st });
    var pr = profileOf(e.employeeId);
    if (pr) update('EmployeeProfiles', pr, prof); else insert('EmployeeProfiles', { employeeId: e.employeeId, dob: prof.dob, gender: prof.gender, address: prof.address, emergencyContact: prof.emergencyContact, maritalStatus: prof.maritalStatus });
    if (u) { update('Users', u, { loginId: d.phone, phone: d.phone, email: d.email, role: roleId }); bustUser(u.userId); }
    if (st !== e.status) applyEmployeeStatus(ctx, e, st);
    if (sal) saveSalary(e.employeeId, sal);
    ctx.entityId = e.employeeId; ctx.remark = 'Updated ' + d.fullName;
    return { employeeId: e.employeeId };
  }
  need(ctx, 'employees', 'create');
  if (roleId !== 'EMPLOYEE' && ctx.role !== 'ADMIN') fail('FORBIDDEN', 'Only the Company Admin can create users with elevated roles.');
  if (loginIdTaken(d.phone)) fail('DUPLICATE', 'This phone number is already registered as a login.', { field: 'phone' });
  var s = settingsFor(cid), eid = newId('EMP', 'employee', 6), code = (s.empCodePrefix || 'EMP') + '-' + pad(nextIds('empcode_' + cid, 1)[0], 4);
  insert('Employees', { employeeId: eid, companyId: cid, empCode: code, fullName: d.fullName, phone: d.phone, email: d.email, photoFileId: '', designation: d.designation, department: d.department, doj: d.doj, employmentType: d.employmentType, bankName: d.bankName, accountNo: d.accountNo, ifsc: d.ifsc, panNumber: d.panNumber, uan: d.uan, esicNo: d.esicNo, status: 'Active', roleId: roleId, createdAt: ctx.now });
  insert('EmployeeProfiles', { employeeId: eid, dob: prof.dob, gender: prof.gender, address: prof.address, emergencyContact: prof.emergencyContact, maritalStatus: prof.maritalStatus });
  if (sal) saveSalary(eid, sal);
  initBalances(cid, eid, fyOf(ctx.today));
  var activation = randomCode(8), salt = 'ACT:' + newSalt();
  insert('Users', { userId: newId('USR', 'user', 6), companyId: cid, employeeId: eid, role: roleId, loginId: d.phone, email: d.email, phone: d.phone, passwordHash: hashPassword(activation, salt), salt: salt, status: 'Invited', createdAt: ctx.now });
  ctx.entityId = eid; ctx.remark = 'Added ' + d.fullName + ' (' + code + ')';
  return { employeeId: eid, empCode: code, activationCode: activation, phone: d.phone };
}
function applyEmployeeStatus(ctx, e, st) {
  var u = userForEmployee(e.employeeId);
  if (u) { update('Users', u, { status: st === 'Active' ? (isInvited(u) ? 'Invited' : 'Active') : 'Disabled' }); bustUser(u.userId); }
  if (st !== 'Active') {
    where('ProjectAssignments', function (a) { return a.employeeId === e.employeeId && a.status === 'Active'; }).forEach(function (a) { update('ProjectAssignments', a, { status: 'Ended', endDate: ctx.today, endReason: 'Employee ' + st.toLowerCase() }); });
  }
}
function hEmployeeSetStatus(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), st = reqEnum(str(p.status, 12), ['Active', 'Inactive', 'Exited'], 'Status');
  update('Employees', e, { status: st }); applyEmployeeStatus(ctx, e, st);
  ctx.entityId = e.employeeId; ctx.remark = e.fullName + ' → ' + st;
  return { status: st };
}
function hEmployeeResetAccess(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), u = userForEmployee(e.employeeId);
  if (!u) fail('NOT_FOUND', 'Login not found for this employee.');
  if (e.status !== 'Active') fail('STATE', 'Reactivate the employee first.');
  var code = makeActivation(u); ctx.entityId = e.employeeId; ctx.remark = 'Activation code regenerated';
  return { activationCode: code, phone: e.phone };
}
function hEmployeeDocUpload(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), type = reqEnum(str(p.docType, 30), DOC_TYPES, 'Document type');
  var f = saveUpload(ctx.cid, ['Employees', e.empCode], p.file, { prefix: type.replace(/\s/g, '') });
  if (type === 'Photo') {
    if (f.mime.indexOf('image/') !== 0) { trashFile(f.fileId); fail('VALIDATION', 'Photo must be an image.', { field: 'file' }); }
    update('Employees', e, { photoFileId: f.fileId });
  }
  var id = newId('DOC', 'empdoc', 6);
  insert('EmployeeDocuments', { docId: id, employeeId: e.employeeId, docType: type, fileId: f.fileId, fileName: f.fileName, uploadedBy: ctx.user.userId, createdAt: ctx.now });
  ctx.entityId = id; ctx.remark = type + ' for ' + e.fullName;
  return { docs: docsOut(ctx.cid, e.employeeId) };
}
function hEmployeeDocDelete(ctx, p) {
  var d = findOne('EmployeeDocuments', function (x) { return x.docId === str(p.docId, 20); });
  if (!d) fail('NOT_FOUND', 'Document not found.');
  var e = getEmployeeScoped(ctx, d.employeeId);
  deleteRows('EmployeeDocuments', [d]); trashFile(d.fileId);
  if (e.photoFileId === d.fileId) update('Employees', e, { photoFileId: '' });
  ctx.entityId = d.docId; ctx.remark = d.docType + ' deleted for ' + e.fullName;
  return { docs: docsOut(ctx.cid, e.employeeId) };
}

/* ============================== 12. PROJECTS ============================== */
function prjOut(x, teamCount) {
  return { projectId: x.projectId, type: x.type, name: x.name, clientName: x.clientName, address: x.address, lat: x.lat, lng: x.lng, geofenceRadiusM: x.geofenceRadiusM, status: x.status, createdAt: x.createdAt, teamCount: teamCount || 0 };
}
function teamCounts(cid) {
  var ids = empIdSet(cid), m = {};
  rows('ProjectAssignments').forEach(function (a) { if (a.status === 'Active' && ids[a.employeeId]) m[a.projectId] = (m[a.projectId] || 0) + 1; });
  return m;
}
function hProjectList(ctx, p) {
  var st = str(p.status, 12), ty = str(p.type, 10), tc = teamCounts(ctx.cid);
  var list = projectsOf(ctx.cid).list.filter(function (x) { return (!st || x.status === st) && (!ty || x.type === ty) && matches(p.q, [x.name, x.clientName, x.address, x.projectId]); });
  sortBy(list, function (x) { return x.projectId; }, true);
  var pg = paginate(list, p);
  pg.rows = pg.rows.map(function (x) { return prjOut(x, tc[x.projectId]); });
  return pg;
}
function assignHistory(cid, filterFn) {
  var emps = empsOf(cid), prj = projectsOf(cid).byId;
  return sortBy(where('ProjectAssignments', function (a) { return emps.byId[a.employeeId] && filterFn(a); }), function (a) { return a.assignmentId; }, true).map(function (a) {
    var e = emps.byId[a.employeeId], pr = prj[a.projectId] || {};
    return { assignmentId: a.assignmentId, projectId: a.projectId, projectName: pr.name || a.projectId, employeeId: a.employeeId, employeeName: e.fullName, empCode: e.empCode, startDate: a.startDate, endDate: a.endDate, status: a.status, endReason: a.endReason, assignedByName: userName(cid, a.assignedBy) };
  });
}
function hProjectGet(ctx, p) {
  var x = projectsOf(ctx.cid).byId[str(p.projectId, 20)]; if (!x) fail('NOT_FOUND', 'Project not found.');
  var hist = assignHistory(ctx.cid, function (a) { return a.projectId === x.projectId; });
  return { project: prjOut(x, hist.filter(function (a) { return a.status === 'Active'; }).length), team: hist.filter(function (a) { return a.status === 'Active'; }), history: hist.filter(function (a) { return a.status !== 'Active'; }) };
}
function hProjectSave(ctx, p) {
  need(ctx, 'projects', p.projectId ? 'edit' : 'create');
  var cid = ctx.cid, s = settingsFor(cid);
  var d = { type: reqEnum(str(p.type, 10), ['site', 'office'], 'Project type'), name: reqStr(p, 'name', 'Project name', 120), clientName: str(p.clientName, 120), address: reqStr(p, 'address', 'Address', 300) };
  var lat = Number(p.lat), lng = Number(p.lng);
  if (p.lat === '' || p.lat == null || !isFinite(lat) || lat < -90 || lat > 90) fail('VALIDATION', 'Latitude must be a number between -90 and 90.', { field: 'lat' });
  if (p.lng === '' || p.lng == null || !isFinite(lng) || lng < -180 || lng > 180) fail('VALIDATION', 'Longitude must be a number between -180 and 180.', { field: 'lng' });
  d.lat = Math.round(lat * 1e6) / 1e6; d.lng = Math.round(lng * 1e6) / 1e6;
  var rad = (p.geofenceRadiusM === '' || p.geofenceRadiusM == null) ? (num(s.geofenceRadiusM) || 50) : Number(p.geofenceRadiusM);
  if (!isFinite(rad) || rad < 10 || rad > 5000) fail('VALIDATION', 'Geofence radius must be between 10 and 5000 metres.', { field: 'geofenceRadiusM' });
  d.geofenceRadiusM = Math.round(rad);
  var dup = projectsOf(cid).list.filter(function (x) { return lc(x.name) === lc(d.name) && x.projectId !== p.projectId; })[0];
  if (dup) fail('DUPLICATE', 'A project with this name already exists.', { field: 'name' });
  if (p.projectId) {
    var x = projectsOf(cid).byId[str(p.projectId, 20)]; if (!x) fail('NOT_FOUND', 'Project not found.');
    d.status = reqEnum(str(p.status, 12) || x.status, ['Active', 'On Hold', 'Closed'], 'Status');
    if (d.status !== 'Active' && x.status === 'Active' && teamCounts(cid)[x.projectId]) fail('STATE', 'Unassign the team before closing or holding this project.');
    update('Projects', x, d); ctx.entityId = x.projectId; ctx.remark = 'Updated ' + d.name;
    return { projectId: x.projectId };
  }
  var id = newId('PRJ', 'project', 4);
  d.projectId = id; d.companyId = cid; d.status = 'Active'; d.createdAt = ctx.now;
  insert('Projects', d); ctx.entityId = id; ctx.remark = 'Created ' + d.name;
  return { projectId: id };
}
function startAssignment(ctx, id, projectId, empId, reason) {
  insert('ProjectAssignments', { assignmentId: id, projectId: projectId, employeeId: empId, startDate: ctx.today, endDate: '', status: 'Active', assignedBy: ctx.user.userId, endReason: '' });
  notifyEmployee(ctx.cid, empId, 'You have been assigned to project ' + (projectsOf(ctx.cid).byId[projectId] || {}).name + '.');
}
function hProjectAssign(ctx, p) {
  var cid = ctx.cid, x = projectsOf(cid).byId[str(p.projectId, 20)];
  if (!x) fail('NOT_FOUND', 'Project not found.');
  if (x.status !== 'Active') fail('STATE', 'Only active projects can receive assignments.');
  var ids = uniq((Array.isArray(p.employeeIds) ? p.employeeIds : []).map(function (i) { return str(i, 20); }).filter(Boolean));
  if (!ids.length) fail('VALIDATION', 'Select at least one employee.');
  var am = activeAssignMap(cid), emps = empsOf(cid).byId, prj = projectsOf(cid).byId, assigned = [], conflicts = [], skipped = [];
  var todo = [];
  ids.forEach(function (id) {
    var e = emps[id]; if (!e) fail('NOT_FOUND', 'Employee not found.');
    if (e.status !== 'Active') { skipped.push({ employeeId: id, name: e.fullName, reason: 'Employee is not active' }); return; }
    var a = am[id];
    if (a && a.projectId === x.projectId) { skipped.push({ employeeId: id, name: e.fullName, reason: 'Already on this project' }); return; }
    if (a) { conflicts.push({ employeeId: id, name: e.fullName, fromProjectId: a.projectId, fromProjectName: (prj[a.projectId] || {}).name }); return; }
    todo.push(e);
  });
  var aids = todo.length ? newIds('ASG', 'assignment', todo.length, 6) : [];
  todo.forEach(function (e, i) { startAssignment(ctx, aids[i], x.projectId, e.employeeId); assigned.push({ employeeId: e.employeeId, name: e.fullName }); });
  ctx.entityId = x.projectId; ctx.remark = 'Assigned ' + assigned.length + ' employee(s) to ' + x.name;
  return { assigned: assigned, conflicts: conflicts, skipped: skipped };
}
function hProjectUnassign(ctx, p) {
  var a = findOne('ProjectAssignments', function (x) { return x.assignmentId === str(p.assignmentId, 20); });
  if (!a || !empsOf(ctx.cid).byId[a.employeeId]) fail('NOT_FOUND', 'Assignment not found.');
  if (a.status !== 'Active') fail('STATE', 'This assignment has already ended.');
  var reason = str(p.reason, 200) || 'Unassigned';
  update('ProjectAssignments', a, { status: 'Ended', endDate: ctx.today, endReason: reason });
  notifyEmployee(ctx.cid, a.employeeId, 'You have been unassigned from project ' + (projectsOf(ctx.cid).byId[a.projectId] || {}).name + '.');
  ctx.entityId = a.assignmentId; ctx.remark = reason;
  return { done: true };
}
function transferOut(cid, t) {
  var emps = empsOf(cid).byId, prj = projectsOf(cid).byId;
  return { requestId: t.requestId, employeeId: t.employeeId, employeeName: (emps[t.employeeId] || {}).fullName, fromProjectId: t.fromProjectId, fromProjectName: (prj[t.fromProjectId] || {}).name, toProjectId: t.toProjectId, toProjectName: (prj[t.toProjectId] || {}).name, requestedByName: userName(cid, t.requestedBy), reason: t.reason, status: t.status, approverName: userName(cid, t.decidedBy), decidedBy: t.decidedBy, decisionRemark: t.decisionRemark };
}
function hTransferRequest(ctx, p) {
  var cid = ctx.cid, e = getEmployeeScoped(ctx, p.employeeId), to = projectsOf(cid).byId[str(p.toProjectId, 20)];
  if (!to || to.status !== 'Active') fail('VALIDATION', 'Choose an active destination project.', { field: 'toProjectId' });
  var a = activeAssignMap(cid)[e.employeeId];
  if (!a) fail('STATE', 'This employee has no active assignment to transfer from. Assign directly instead.');
  if (a.projectId === to.projectId) fail('STATE', 'Employee is already on this project.');
  var reason = reqStr(p, 'reason', 'Reason', 300), approver = str(p.approverId, 20);
  if (!approver) fail('VALIDATION', 'Choose an approver.', { field: 'approverId' });
  if (!hApprovers(ctx, {}).some(function (x) { return x.userId === approver; })) fail('VALIDATION', 'Selected approver cannot approve transfers.', { field: 'approverId' });
  if (where('TransferRequests', function (t) { return t.employeeId === e.employeeId && t.status === 'Pending'; }).length) fail('DUPLICATE', 'A transfer request is already pending for this employee.');
  var id = newId('TRF', 'transfer', 5);
  // decidedBy holds the requested approver while the request is Pending
  insert('TransferRequests', { requestId: id, employeeId: e.employeeId, fromProjectId: a.projectId, toProjectId: to.projectId, requestedBy: ctx.user.userId, reason: reason, status: 'Pending', decidedBy: approver, decisionRemark: '' });
  notify(cid, approver, 'Transfer approval requested for ' + e.fullName + ' → ' + to.name);
  ctx.entityId = id; ctx.remark = e.fullName + ' → ' + to.name;
  return { requestId: id };
}
function hTransferDecide(ctx, p) {
  var t = findOne('TransferRequests', function (x) { return x.requestId === str(p.requestId, 20); });
  if (!t || !empsOf(ctx.cid).byId[t.employeeId]) fail('NOT_FOUND', 'Transfer request not found.');
  if (t.status !== 'Pending') fail('STATE', 'This request has already been decided.');
  var decision = reqEnum(str(p.decision, 10), ['Approved', 'Rejected'], 'Decision'), remark = needRemark(p);
  if (decision === 'Approved') {
    var a = activeAssignMap(ctx.cid)[t.employeeId], to = projectsOf(ctx.cid).byId[t.toProjectId];
    if (!a || a.projectId !== t.fromProjectId) fail('STATE', 'The employee\'s assignment has changed. Reject this request and raise a new one.');
    if (!to || to.status !== 'Active') fail('STATE', 'Destination project is not active.');
    update('ProjectAssignments', a, { status: 'Ended', endDate: ctx.today, endReason: 'Transferred to ' + to.name + ' (' + t.requestId + ')' });
    startAssignment(ctx, newId('ASG', 'assignment', 6), t.toProjectId, t.employeeId);
  }
  update('TransferRequests', t, { status: decision, decidedBy: ctx.user.userId, decisionRemark: remark });
  addDecision(ctx, t.requestId, decision, remark);
  notify(ctx.cid, t.requestedBy, 'Transfer request ' + t.requestId + ' was ' + decision.toLowerCase() + '.');
  ctx.entityId = t.requestId; ctx.remark = decision + ': ' + remark;
  return { status: decision };
}
function hTransferList(ctx, p) {
  var ids = empIdSet(ctx.cid), st = str(p.status, 12);
  var list = where('TransferRequests', function (t) { return ids[t.employeeId] && (!st || t.status === st); });
  sortBy(list, function (t) { return t.requestId; }, true);
  var pg = paginate(list, p); pg.rows = pg.rows.map(function (t) { return transferOut(ctx.cid, t); });
  return pg;
}

/* ============================== 13. ATTENDANCE ENGINE ============================== */
function haversineM(lat1, lon1, lat2, lon2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function holidayMap(cid) { var m = {}; where('Holidays', function (h) { return h.companyId === cid; }).forEach(function (h) { m[h.date] = h.name; }); return m; }
function weeklyOffMap(cid) { var m = {}; String(settingsFor(cid).weeklyOff).split(',').forEach(function (x) { if (x !== '') m[Number(x)] = 1; }); return m; }
function loadPeriodData(cid, empIds, from, to) {
  var set = {}; empIds.forEach(function (i) { set[i] = 1; });
  var att = {}, leaves = {}, specials = {};
  rows('Attendance').forEach(function (r) { if (set[r.employeeId] && r.date >= from && r.date <= to) (att[r.employeeId] = att[r.employeeId] || {})[r.date] = r; });
  rows('LeaveRequests').forEach(function (r) { if (set[r.employeeId] && r.status === 'Approved' && r.fromDate <= to && r.toDate >= from) (leaves[r.employeeId] = leaves[r.employeeId] || []).push(r); });
  rows('SpecialRequests').forEach(function (r) { if (set[r.employeeId] && r.status === 'Approved' && r.fromDate <= to && r.toDate >= from) (specials[r.employeeId] = specials[r.employeeId] || []).push(r); });
  return { att: att, leaves: leaves, specials: specials, holidays: holidayMap(cid), wo: weeklyOffMap(cid) };
}
var ATT_VALUE = { 'Present': ['P', 1], 'Late': ['L', 1], 'Half Day': ['H', 0.5], 'Absent': ['A', 0] };
function evalDay(emp, d, data, today, forPayroll) {
  if (d < emp.doj) return { code: '-', value: 0 };
  var isWo = !!data.wo[dow(d)], isHol = data.holidays[d] !== undefined;
  if (d > today && !forPayroll) return { code: isWo ? 'W' : (isHol ? 'O' : '-'), value: 0 };
  if (isWo) return { code: 'W', value: 1 };
  if (isHol) return { code: 'O', value: 1 };
  if (d > today) return { code: 'F', value: 0 };
  var cands = [], a = (data.att[emp.employeeId] || {})[d];
  if (a) {
    if (a.status === 'Open') cands.push(d === today ? { code: 'P', value: 1 } : { code: 'X', value: 0 });
    else { var m = ATT_VALUE[a.status] || ['A', 0]; cands.push({ code: m[0], value: m[1] }); }
  }
  (data.leaves[emp.employeeId] || []).forEach(function (l) { if (l.fromDate <= d && l.toDate >= d) cands.push(l.leaveType === UNPAID ? { code: 'U', value: 0 } : { code: 'V', value: 1 }); });
  (data.specials[emp.employeeId] || []).forEach(function (s) { if (s.fromDate <= d && s.toDate >= d) cands.push({ code: 'S', value: 1 }); });
  var best = null;
  cands.forEach(function (c) { if (!best || c.value > best.value) best = c; });
  return best || { code: 'A', value: 0 };
}
function evalMonth(emp, ym, data, today, forPayroll) {
  var n = daysInMonth(ym), out = [], tot = { P: 0, L: 0, H: 0, V: 0, U: 0, S: 0, W: 0, O: 0, A: 0, X: 0, F: 0, payable: 0 };
  for (var i = 1; i <= n; i++) {
    var d = ym + '-' + pad(i, 2), r = evalDay(emp, d, data, today, forPayroll);
    r.date = d; out.push(r);
    if (tot[r.code] !== undefined) tot[r.code]++;
    tot.payable += r.value;
  }
  return { days: out, totals: tot };
}
function workingDaysBetween(cid, from, to) {
  var wo = weeklyOffMap(cid), hol = holidayMap(cid), n = 0;
  for (var d = from; d <= to; d = addDays(d, 1)) if (!wo[dow(d)] && hol[d] === undefined) n++;
  return n;
}
function shiftInfo(cid) {
  var s = settingsFor(cid), m = String(s.shiftStart || '09:30').split(':');
  return { startMin: (+m[0]) * 60 + (+m[1] || 0), grace: num(s.graceMinutes), halfDay: num(s.halfDayMinutes) || 240 };
}
function minutesOfIso(iso) { return (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16)); }
function isLatePunch(cid, iso) { var si = shiftInfo(cid); return !!iso && minutesOfIso(iso) > si.startMin + si.grace; }
function finalStatus(cid, punchInAt, workMinutes) {
  var si = shiftInfo(cid);
  if (workMinutes < si.halfDay) return 'Half Day';
  return isLatePunch(cid, punchInAt) ? 'Late' : 'Present';
}
function todaysRow(empId, date) { return findOne('Attendance', function (r) { return r.employeeId === empId && r.date === date; }); }

function hPunch(ctx, p) {
  var cid = ctx.cid, type = reqEnum(str(p.type, 4), ['in', 'out'], 'Punch type');
  var lat = Number(p.lat), lng = Number(p.lng), acc = Number(p.accuracy);
  if (p.lat === '' || p.lat == null || p.lng === '' || p.lng == null || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('GPS_MISSING', 'Your location could not be read. Turn on GPS/location permission and try again.');
  var s = settingsFor(cid), maxAcc = num(s.maxAccuracyM) || 100;
  if (p.accuracy === '' || p.accuracy == null || !isFinite(acc) || acc <= 0) fail('GPS_ACCURACY', 'GPS accuracy is unavailable. Move to an open area and try again.');
  if (acc > maxAcc) fail('GPS_ACCURACY', 'GPS accuracy is too poor (±' + Math.round(acc) + ' m). It must be within ' + maxAcc + ' m. Move to an open area and try again.', { accuracy: Math.round(acc), max: maxAcc });
  var emp = empsOf(cid).byId[ctx.employeeId];
  if (!emp || emp.status !== 'Active') fail('FORBIDDEN', 'Your employee profile is not active.');
  var today = ctx.today, row = todaysRow(emp.employeeId, today), prj = projectsOf(cid).byId;
  var cands = [], a = activeAssignMap(cid)[emp.employeeId];
  if (type === 'in') {
    if (row) fail('ALREADY_PUNCHED', row.punchOutAt ? 'You have already completed attendance for today.' : 'You already punched in today at ' + row.punchInAt.slice(11, 16) + '.');
    if (a && prj[a.projectId]) cands.push(prj[a.projectId]);
    where('SpecialRequests', function (r) { return r.employeeId === emp.employeeId && r.status === 'Approved' && r.fromDate <= today && r.toDate >= today && r.toProjectId; }).forEach(function (r) { if (prj[r.toProjectId] && cands.indexOf(prj[r.toProjectId]) < 0) cands.push(prj[r.toProjectId]); });
    if (!cands.length) fail('NO_PROJECT', 'You are not assigned to any project yet. Please contact your admin.');
  } else {
    if (!row || row.punchOutAt || !row.punchInAt) fail('NOT_PUNCHED_IN', row && row.punchOutAt ? 'You have already punched out today.' : 'You have not punched in today.');
    if (!prj[row.projectId]) fail('NO_PROJECT', 'Project for today\'s attendance was not found.');
    cands.push(prj[row.projectId]);
  }
  var best = null;
  cands.forEach(function (pr) { var dd = haversineM(lat, lng, pr.lat, pr.lng); if (!best || dd < best.dist) best = { project: pr, dist: dd }; });
  var dist = Math.round(best.dist), radius = best.project.geofenceRadiusM;
  if (dist > radius) fail('OUT_OF_RANGE', 'You are ' + dist + ' m away from "' + best.project.name + '". You must be within ' + radius + ' m to punch ' + type + '.', { distance: dist, radius: radius, projectName: best.project.name });
  if (type === 'in') {
    var id = newId('ATT', 'attendance', 8);
    insert('Attendance', { attendanceId: id, employeeId: emp.employeeId, projectId: best.project.projectId, date: today, punchInAt: ctx.now, inLat: lat, inLng: lng, inDistanceM: dist, punchOutAt: '', outLat: 0, outLng: 0, workMinutes: 0, status: 'Open', source: 'GPS' });
    ctx.entityId = id; ctx.remark = 'Punch in @' + best.project.name + ' (' + dist + ' m)';
    return { type: 'in', time: ctx.now, distance: dist, radius: radius, projectName: best.project.name, late: isLatePunch(cid, ctx.now) };
  }
  var mins = Math.max(0, Math.round((Date.parse(ctx.now) - Date.parse(row.punchInAt)) / 60000));
  var st = finalStatus(cid, row.punchInAt, mins);
  update('Attendance', row, { punchOutAt: ctx.now, outLat: lat, outLng: lng, workMinutes: mins, status: st });
  ctx.entityId = row.attendanceId; ctx.remark = 'Punch out @' + best.project.name + ' (' + dist + ' m), ' + mins + ' min';
  return { type: 'out', time: ctx.now, distance: dist, radius: radius, projectName: best.project.name, workMinutes: mins, status: st };
}

function hAttToday(ctx, p) {
  var cid = ctx.cid, today = ctx.today, am = activeAssignMap(cid), prj = projectsOf(cid).byId;
  var emps = empsOf(cid).list.filter(function (e) { return e.status === 'Active' && e.doj <= today; });
  var pid = str(p.projectId, 20);
  if (pid) emps = emps.filter(function (e) { return am[e.employeeId] && am[e.employeeId].projectId === pid; });
  emps = emps.filter(function (e) { return matches(p.q, [e.fullName, e.empCode]); });
  var data = loadPeriodData(cid, emps.map(function (e) { return e.employeeId; }), today, today);
  var list = emps.map(function (e) {
    var r = (data.att[e.employeeId] || {})[today], ev = evalDay(e, today, data, today, false), label;
    if (r && r.status === 'Open') label = 'Working'; else if (r) label = r.status;
    else if (ev.code === 'V' || ev.code === 'U') label = 'On Leave'; else if (ev.code === 'S') label = 'Duty Travel';
    else if (ev.code === 'W') label = 'Weekly Off'; else if (ev.code === 'O') label = 'Holiday'; else label = 'Not Marked';
    var a = am[e.employeeId], pr = r && prj[r.projectId] ? prj[r.projectId] : (a ? prj[a.projectId] : null);
    return { employeeId: e.employeeId, empCode: e.empCode, fullName: e.fullName, designation: e.designation, project: pr ? pr.name : '—', punchInAt: r ? r.punchInAt : '', punchOutAt: r ? r.punchOutAt : '', distance: r ? r.inDistanceM : null, workMinutes: r ? r.workMinutes : 0, status: label, late: r && r.punchInAt ? isLatePunch(cid, r.punchInAt) : false, source: r ? r.source : '' };
  });
  var f = str(p.status, 20);
  var counts = { total: list.length, present: 0, late: 0, onLeave: 0, notMarked: 0, halfDay: 0 };
  list.forEach(function (x) {
    if (x.status === 'Working' || x.status === 'Present' || x.status === 'Late' || x.status === 'Half Day' || x.status === 'Duty Travel') counts.present++;
    if (x.late) counts.late++; if (x.status === 'On Leave') counts.onLeave++; if (x.status === 'Not Marked') counts.notMarked++; if (x.status === 'Half Day') counts.halfDay++;
  });
  if (f) list = list.filter(function (x) { return x.status === f; });
  sortBy(list, function (x) { return x.fullName.toLowerCase(); });
  var pg = paginate(list, p); pg.counts = counts; pg.date = today;
  return pg;
}
function hAttMonth(ctx, p) {
  var cid = ctx.cid, ym = p.month ? reqMonth(p.month) : ctx.today.slice(0, 7), from = monthStart(ym), to = monthEnd(ym);
  var pid = str(p.projectId, 20), eid = str(p.employeeId, 20);
  var attSet = {};
  rows('Attendance').forEach(function (r) { if (r.date >= from && r.date <= to) attSet[r.employeeId] = 1; });
  var emps = empsOf(cid).list.filter(function (e) { return e.doj <= to && (e.status === 'Active' || attSet[e.employeeId]) && (!eid || e.employeeId === eid) && matches(p.q, [e.fullName, e.empCode]); });
  if (pid) {
    var ok = {};
    rows('ProjectAssignments').forEach(function (a) { if (a.projectId === pid && a.startDate <= to && (!a.endDate || a.endDate >= from)) ok[a.employeeId] = 1; });
    rows('Attendance').forEach(function (r) { if (r.projectId === pid && r.date >= from && r.date <= to) ok[r.employeeId] = 1; });
    emps = emps.filter(function (e) { return ok[e.employeeId]; });
  }
  sortBy(emps, function (e) { return e.fullName.toLowerCase(); });
  p.pageSize = p.pageSize || 15;
  var pg = paginate(emps, p), data = loadPeriodData(cid, pg.rows.map(function (e) { return e.employeeId; }), from, to);
  pg.rows = pg.rows.map(function (e) {
    var ev = evalMonth(e, ym, data, ctx.today, false);
    return { employeeId: e.employeeId, empCode: e.empCode, fullName: e.fullName, cells: ev.days.map(function (d) { return d.code; }), totals: ev.totals };
  });
  var dayInfo = []; for (var i = 1; i <= daysInMonth(ym); i++) dayInfo.push({ d: i, dow: dow(ym + '-' + pad(i, 2)) });
  pg.month = ym; pg.dayInfo = dayInfo;
  return pg;
}
function hAttMark(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), date = reqDate(p.date, 'Date');
  var st = reqEnum(str(p.status, 10), ['Present', 'Half Day', 'Absent'], 'Status'), reason = needRemark(p);
  if (date > ctx.today) fail('VALIDATION', 'You cannot mark attendance for a future date.', { field: 'date' });
  if (date < e.doj) fail('VALIDATION', 'Date is before the employee\'s joining date.', { field: 'date' });
  var mins = st === 'Present' ? 480 : st === 'Half Day' ? 240 : 0, row = todaysRow(e.employeeId, date);
  if (row) update('Attendance', row, { status: st, workMinutes: mins, source: 'Manual' });
  else {
    var a = activeAssignMap(ctx.cid)[e.employeeId];
    insert('Attendance', { attendanceId: newId('ATT', 'attendance', 8), employeeId: e.employeeId, projectId: a ? a.projectId : '', date: date, punchInAt: '', inLat: 0, inLng: 0, inDistanceM: 0, punchOutAt: '', outLat: 0, outLng: 0, workMinutes: mins, status: st, source: 'Manual' });
  }
  notifyEmployee(ctx.cid, e.employeeId, 'Your attendance for ' + date + ' was marked "' + st + '" by admin.');
  ctx.entityId = e.employeeId; ctx.remark = date + ' → ' + st + ': ' + reason;
  return { done: true };
}

/* ---------- holidays ---------- */
function hHolidayList(ctx, p) {
  var year = str(p.year, 4) || ctx.today.slice(0, 4);
  return sortBy(where('Holidays', function (h) { return h.companyId === ctx.cid && h.date.slice(0, 4) === year; }), function (h) { return h.date; }).map(function (h) { return { date: h.date, name: h.name, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(h.date)] }; });
}
function hHolidaySave(ctx, p) {
  var date = reqDate(p.date, 'Date'), name = reqStr(p, 'name', 'Holiday name', 80);
  var ex = findOne('Holidays', function (h) { return h.companyId === ctx.cid && h.date === date; });
  if (ex) update('Holidays', ex, { name: name }); else insert('Holidays', { companyId: ctx.cid, date: date, name: name });
  ctx.entityId = date; ctx.remark = name;
  return { done: true };
}
function hHolidayDelete(ctx, p) {
  var date = reqDate(p.date, 'Date'), ex = findOne('Holidays', function (h) { return h.companyId === ctx.cid && h.date === date; });
  if (!ex) fail('NOT_FOUND', 'Holiday not found.');
  deleteRows('Holidays', [ex]); ctx.entityId = date; ctx.remark = ex.name;
  return { done: true };
}

/* ============================== 14. LEAVE & SPECIAL REQUESTS ============================== */
function leaveTypeRow(cid, name) { return findOne('LeaveTypes', function (t) { return t.companyId === cid && t.leaveType === name; }); }
function balanceRow(empId, type, fy) { return findOne('LeaveBalances', function (b) { return b.employeeId === empId && b.leaveType === type && b.fy === fy; }); }
function balanceOf(cid, empId, type, fy) {
  var b = balanceRow(empId, type, fy); if (b) return b.balance;
  var t = leaveTypeRow(cid, type); return t ? t.defaultDaysPerYear : 0;
}
function adjustBalance(cid, empId, type, fy, delta) {
  var b = balanceRow(empId, type, fy);
  if (b) update('LeaveBalances', b, { balance: round2(b.balance + delta) });
  else { var t = leaveTypeRow(cid, type); insert('LeaveBalances', { employeeId: empId, leaveType: type, fy: fy, balance: round2((t ? t.defaultDaysPerYear : 0) + delta) }); }
}
function leaveOut(cid, r, dm, withBal) {
  var e = empsOf(cid).byId[r.employeeId] || {}, d = dm[r.requestId];
  var o = { requestId: r.requestId, employeeId: r.employeeId, employeeName: e.fullName, empCode: e.empCode, leaveType: r.leaveType, fromDate: r.fromDate, toDate: r.toDate, days: r.days, reason: r.reason, status: r.status, decisionRemark: r.decisionRemark || (d ? d.remark : ''), decidedAt: d ? d.decidedAt : '', approverName: r.approverId ? userName(cid, r.approverId) : '' };
  if (withBal && r.leaveType !== UNPAID) o.balance = balanceOf(cid, r.employeeId, r.leaveType, fyOf(r.fromDate));
  return o;
}
function hLeaveApply(ctx, p) {
  var cid = ctx.cid, emp = empsOf(cid).byId[ctx.employeeId], s = settingsFor(cid);
  var type = reqStr(p, 'leaveType', 'Leave type', 60), lt = leaveTypeRow(cid, type);
  if (!lt) fail('VALIDATION', 'Leave type is invalid.', { field: 'leaveType' });
  var from = reqDate(p.fromDate, 'From date'), to = reqDate(p.toDate, 'To date'), reason = reqStr(p, 'reason', 'Reason', 300);
  if (to < from) fail('VALIDATION', 'To date cannot be before From date.', { field: 'toDate' });
  if (from < emp.doj) fail('VALIDATION', 'Leave cannot start before your joining date.', { field: 'fromDate' });
  var back = num(s.backdatedLeaveDays), maxC = num(s.maxConsecutiveLeaveDays) || 30;
  if (diffDays(from, ctx.today) > back) fail('VALIDATION', 'Leave can be applied for at most ' + back + ' day(s) in the past.', { field: 'fromDate' });
  if (diffDays(from, to) + 1 > maxC) fail('VALIDATION', 'A single request cannot exceed ' + maxC + ' days.', { field: 'toDate' });
  var days = workingDaysBetween(cid, from, to);
  if (days <= 0) fail('VALIDATION', 'The selected dates are all weekly offs or holidays.', { field: 'fromDate' });
  var mine = where('LeaveRequests', function (r) { return r.employeeId === emp.employeeId && (r.status === 'Pending' || r.status === 'Approved'); });
  if (mine.some(function (r) { return r.fromDate <= to && r.toDate >= from; })) fail('DUPLICATE', 'You already have a pending or approved leave overlapping these dates.', { field: 'fromDate' });
  if (type !== UNPAID) {
    var fy = fyOf(from), pend = sum(mine.filter(function (r) { return r.status === 'Pending' && r.leaveType === type && fyOf(r.fromDate) === fy; }), function (r) { return r.days; });
    var bal = balanceOf(cid, emp.employeeId, type, fy);
    if (bal - pend < days) fail('INSUFFICIENT_BALANCE', 'Insufficient ' + type + ' balance. Available: ' + round2(bal - pend) + ' day(s), requested: ' + days + '.', { field: 'leaveType' });
  }
  var id = newId('LVR', 'leave', 6);
  insert('LeaveRequests', { requestId: id, employeeId: emp.employeeId, leaveType: type, fromDate: from, toDate: to, days: days, reason: reason, status: 'Pending', approverId: '', decisionRemark: '' });
  notifyAdmins(cid, emp.fullName + ' requested ' + days + ' day(s) of ' + type + ' (' + from + ' → ' + to + ')', 'leave.approve');
  ctx.entityId = id; ctx.remark = type + ' ' + from + '→' + to;
  return { requestId: id, days: days };
}
function hLeaveCancel(ctx, p) {
  var r = findOne('LeaveRequests', function (x) { return x.requestId === str(p.requestId, 20) && x.employeeId === ctx.employeeId; });
  if (!r) fail('NOT_FOUND', 'Request not found.');
  if (r.status !== 'Pending') fail('STATE', 'Only pending requests can be cancelled.');
  update('LeaveRequests', r, { status: 'Cancelled' }); ctx.entityId = r.requestId;
  return { done: true };
}
function hLeaveList(ctx, p) {
  var cid = ctx.cid, ids = empIdSet(cid), st = str(p.status, 12), eid = str(p.employeeId, 20);
  var list = where('LeaveRequests', function (r) { return ids[r.employeeId] && (!st || r.status === st) && (!eid || r.employeeId === eid); });
  list = list.filter(function (r) { var e = empsOf(cid).byId[r.employeeId]; return matches(p.q, [e.fullName, e.empCode, r.leaveType, r.reason]); });
  sortBy(list, function (r) { return r.requestId; }, true);
  var pg = paginate(list, p), dm = decisionMap(cid, pg.rows.map(function (r) { return r.requestId; }));
  pg.rows = pg.rows.map(function (r) { return leaveOut(cid, r, dm, r.status === 'Pending'); });
  return pg;
}
function hLeaveDecide(ctx, p) {
  var cid = ctx.cid, r = findOne('LeaveRequests', function (x) { return x.requestId === str(p.requestId, 20); });
  if (!r || !empsOf(cid).byId[r.employeeId]) fail('NOT_FOUND', 'Request not found.');
  if (r.status !== 'Pending') fail('STATE', 'This request has already been decided.');
  var decision = reqEnum(str(p.decision, 10), ['Approved', 'Rejected'], 'Decision'), remark = needRemark(p);
  if (decision === 'Approved' && r.leaveType !== UNPAID) {
    var fy = fyOf(r.fromDate), bal = balanceOf(cid, r.employeeId, r.leaveType, fy);
    if (bal < r.days) fail('INSUFFICIENT_BALANCE', 'Employee has only ' + bal + ' day(s) of ' + r.leaveType + ' left. Adjust the balance or reject.');
    adjustBalance(cid, r.employeeId, r.leaveType, fy, -r.days);
  }
  update('LeaveRequests', r, { status: decision, approverId: ctx.user.userId, decisionRemark: remark });
  addDecision(ctx, r.requestId, decision, remark);
  notifyEmployee(cid, r.employeeId, 'Your ' + r.leaveType + ' request (' + r.fromDate + ') was ' + decision.toLowerCase() + ': ' + remark);
  ctx.entityId = r.requestId; ctx.remark = decision + ': ' + remark;
  return { status: decision };
}
function hLeaveBalances(ctx, p) {
  var cid = ctx.cid, fy = str(p.fy, 7) || fyOf(ctx.today);
  var types = where('LeaveTypes', function (t) { return t.companyId === cid && t.leaveType !== UNPAID; });
  var emps = empsOf(cid).list.filter(function (e) { return e.status === 'Active' && matches(p.q, [e.fullName, e.empCode]); });
  sortBy(emps, function (e) { return e.fullName.toLowerCase(); });
  var pg = paginate(emps, p), ids = {}; pg.rows.forEach(function (e) { ids[e.employeeId] = 1; });
  var bal = {}; where('LeaveBalances', function (b) { return ids[b.employeeId] && b.fy === fy; }).forEach(function (b) { bal[b.employeeId + '|' + b.leaveType] = b.balance; });
  pg.rows = pg.rows.map(function (e) {
    var o = { employeeId: e.employeeId, empCode: e.empCode, fullName: e.fullName, balances: {} };
    types.forEach(function (t) { var k = e.employeeId + '|' + t.leaveType; o.balances[t.leaveType] = bal[k] !== undefined ? bal[k] : t.defaultDaysPerYear; });
    return o;
  });
  pg.types = types.map(function (t) { return t.leaveType; }); pg.fy = fy;
  return pg;
}
function hLeaveAdjust(ctx, p) {
  var cid = ctx.cid, e = getEmployeeScoped(ctx, p.employeeId), type = reqStr(p, 'leaveType', 'Leave type', 60), fy = str(p.fy, 7) || fyOf(ctx.today);
  if (!leaveTypeRow(cid, type) || type === UNPAID) fail('VALIDATION', 'Leave type is invalid.');
  var b = Number(p.balance); if (!isFinite(b) || b < 0 || b > 366) fail('VALIDATION', 'Balance must be between 0 and 366.', { field: 'balance' });
  var row = balanceRow(e.employeeId, type, fy);
  if (row) update('LeaveBalances', row, { balance: round2(b) }); else insert('LeaveBalances', { employeeId: e.employeeId, leaveType: type, fy: fy, balance: round2(b) });
  ctx.entityId = e.employeeId; ctx.remark = type + ' (' + fy + ') set to ' + b;
  return { done: true };
}

function specialOut(cid, r, dm) {
  var e = empsOf(cid).byId[r.employeeId] || {}, prj = projectsOf(cid).byId, d = dm[r.requestId];
  return { requestId: r.requestId, employeeId: r.employeeId, employeeName: e.fullName, empCode: e.empCode, fromProjectName: (prj[r.fromProjectId] || {}).name || '', toProjectId: r.toProjectId, toProjectName: (prj[r.toProjectId] || {}).name || '', fromDate: r.fromDate, toDate: r.toDate, reason: r.reason, taggedPersonId: r.taggedPersonId, taggedPersonName: empName(cid, r.taggedPersonId), status: r.status, decisionRemark: r.decisionRemark || (d ? d.remark : ''), decidedAt: d ? d.decidedAt : '' };
}
function hSpecialApply(ctx, p) {
  var cid = ctx.cid, emp = empsOf(cid).byId[ctx.employeeId];
  var from = reqDate(p.fromDate, 'From date'), to = reqDate(p.toDate, 'To date'), reason = reqStr(p, 'reason', 'Reason', 300);
  if (to < from) fail('VALIDATION', 'To date cannot be before From date.', { field: 'toDate' });
  if (diffDays(from, ctx.today) > 7) fail('VALIDATION', 'Requests can be raised for at most 7 days in the past.', { field: 'fromDate' });
  if (diffDays(from, to) > 30) fail('VALIDATION', 'A duty-travel request cannot exceed 31 days.', { field: 'toDate' });
  var tag = empsOf(cid).byId[str(p.taggedPersonId, 20)];
  if (!tag || tag.employeeId === emp.employeeId) fail('VALIDATION', 'Tag the person who authorised this travel.', { field: 'taggedPersonId' });
  var toP = str(p.toProjectId, 20);
  if (toP && !projectsOf(cid).byId[toP]) fail('VALIDATION', 'Destination project is invalid.', { field: 'toProjectId' });
  if (where('SpecialRequests', function (r) { return r.employeeId === emp.employeeId && (r.status === 'Pending' || r.status === 'Approved') && r.fromDate <= to && r.toDate >= from; }).length) fail('DUPLICATE', 'You already have a special request overlapping these dates.', { field: 'fromDate' });
  var a = activeAssignMap(cid)[emp.employeeId], id = newId('SPR', 'special', 6);
  insert('SpecialRequests', { requestId: id, employeeId: emp.employeeId, fromProjectId: a ? a.projectId : '', toProjectId: toP, fromDate: from, toDate: to, reason: reason, taggedPersonId: tag.employeeId, status: 'Pending', decidedBy: '', decisionRemark: '' });
  notifyAdmins(cid, emp.fullName + ' raised a duty-travel request (' + from + ' → ' + to + '), authorised by ' + tag.fullName, 'leave.approve');
  notifyEmployee(cid, tag.employeeId, emp.fullName + ' has tagged you as the authorising person for a duty-travel request.');
  ctx.entityId = id; ctx.remark = from + '→' + to;
  return { requestId: id };
}
function hSpecialCancel(ctx, p) {
  var r = findOne('SpecialRequests', function (x) { return x.requestId === str(p.requestId, 20) && x.employeeId === ctx.employeeId; });
  if (!r) fail('NOT_FOUND', 'Request not found.');
  if (r.status !== 'Pending') fail('STATE', 'Only pending requests can be cancelled.');
  update('SpecialRequests', r, { status: 'Cancelled' }); ctx.entityId = r.requestId;
  return { done: true };
}
function hSpecialList(ctx, p) {
  var cid = ctx.cid, ids = empIdSet(cid), st = str(p.status, 12);
  var list = where('SpecialRequests', function (r) { return ids[r.employeeId] && (!st || r.status === st); });
  list = list.filter(function (r) { return matches(p.q, [empName(cid, r.employeeId), r.reason, empName(cid, r.taggedPersonId)]); });
  sortBy(list, function (r) { return r.requestId; }, true);
  var pg = paginate(list, p), dm = decisionMap(cid, pg.rows.map(function (r) { return r.requestId; }));
  pg.rows = pg.rows.map(function (r) { return specialOut(cid, r, dm); });
  return pg;
}
function hSpecialDecide(ctx, p) {
  var cid = ctx.cid, r = findOne('SpecialRequests', function (x) { return x.requestId === str(p.requestId, 20); });
  if (!r || !empsOf(cid).byId[r.employeeId]) fail('NOT_FOUND', 'Request not found.');
  if (r.status !== 'Pending') fail('STATE', 'This request has already been decided.');
  var decision = reqEnum(str(p.decision, 10), ['Approved', 'Rejected'], 'Decision'), remark = needRemark(p);
  update('SpecialRequests', r, { status: decision, decidedBy: ctx.user.userId, decisionRemark: remark });
  addDecision(ctx, r.requestId, decision, remark);
  notifyEmployee(cid, r.employeeId, 'Your duty-travel request (' + r.fromDate + ') was ' + decision.toLowerCase() + ': ' + remark);
  ctx.entityId = r.requestId; ctx.remark = decision + ': ' + remark;
  return { status: decision };
}

/* ============================== 15. PAYROLL ============================== */
function salaryMapFor(empIds, to) {
  var set = {}, by = {};
  empIds.forEach(function (i) { set[i] = 1; });
  rows('SalaryStructures').forEach(function (s) { if (set[s.employeeId]) (by[s.employeeId] = by[s.employeeId] || []).push(s); });
  var out = {};
  Object.keys(by).forEach(function (id) {
    var list = by[id], eff = list.filter(function (s) { return s.effectiveFrom <= to; });
    out[id] = sortBy(eff.length ? eff : list, function (s) { return s.effectiveFrom; }, !!eff.length)[0];
  });
  return out;
}
function findRun(cid, ym) { return findOne('PayrollRuns', function (r) { return r.companyId === cid && r.month === ym; }); }
function runItems(runId) { return where('PayrollItems', function (i) { return i.runId === runId; }); }
function computeItem(a) {
  var sal = a.sal, s = a.settings, emp = a.emp, dim = a.dim;
  var payable = Math.min(dim, Math.max(0, round2(a.payable))), lop = round2(dim - payable), ratio = dim ? payable / dim : 0;
  var basic = round2(sal.basic * ratio), hra = round2(sal.hra * ratio), special = round2(sal.specialAllowance * ratio);
  var bonus = round2(a.bonus || 0), gross = round2(basic + hra + special + bonus);
  var reimb = round2(sum(a.reimbs, function (r) { return r.amount; }));
  var pf = (sflag(s.pfEnabled) && emp.uan) ? round2(0.12 * Math.min(basic, 15000)) : 0;
  var esi = (sflag(s.esiEnabled) && emp.esicNo && sal.monthlyGross <= 21000) ? round2(0.0075 * gross) : 0;
  var pt = (num(s.ptAmount) > 0 && gross >= 15000) ? round2(num(s.ptAmount)) : 0;
  var other = round2(a.otherDed || 0);
  var dedRaw = round2(pf + esi + pt + other), avail = round2(gross + reimb), cap = dedRaw > avail ? round2(dedRaw - avail) : 0;
  var ded = round2(dedRaw - cap), net = Math.max(0, round2(avail - ded));
  return {
    payable: payable, lop: lop, gross: gross, reimb: reimb, ded: ded, net: net,
    breakup: {
      daysInMonth: dim, payableDays: payable, lopDays: lop, structure: { basic: sal.basic, hra: sal.hra, specialAllowance: sal.specialAllowance, monthlyGross: sal.monthlyGross, effectiveFrom: sal.effectiveFrom },
      earnings: { basic: basic, hra: hra, specialAllowance: special, bonus: bonus }, reimbursements: a.reimbs,
      deductions: { pf: pf, esi: esi, pt: pt, other: other, capAdjust: -cap }, capped: cap > 0,
      adj: { bonus: bonus, otherDeduction: other, note: a.note || '', lopOverride: a.lopOverride === undefined ? null : a.lopOverride }
    }
  };
}
function runTotals(items) {
  return { employees: items.length, gross: round2(sum(items, function (i) { return i.gross; })), reimbursements: round2(sum(items, function (i) { return i.reimbursements; })), deductions: round2(sum(items, function (i) { return i.deductions; })), net: round2(sum(items, function (i) { return i.netPay; })) };
}
function refreshRun(run, ctx) {
  var items = runItems(run.runId), st = 'Draft', patch = { totals: JSON.stringify(runTotals(items)) };
  if (items.length && items.every(function (i) { return i.status === 'Paid'; })) st = 'Paid';
  else if (items.length && items.every(function (i) { return i.status === 'Approved' || i.status === 'Paid'; })) st = 'Approved';
  patch.status = st;
  if ((st === 'Approved' || st === 'Paid') && !run.approvedAt) patch.approvedAt = ctx.now;
  if (st === 'Paid' && !run.paidAt) patch.paidAt = ctx.now;
  if (st === 'Draft') { patch.approvedAt = ''; patch.paidAt = ''; } else if (st === 'Approved') patch.paidAt = '';
  update('PayrollRuns', run, patch);
  return st;
}
function upsertBreakups(list) { // list of {itemId, json}
  var have = idx(rows('PayrollBreakups'), 'itemId'), patches = [], adds = [];
  list.forEach(function (x) { if (have[x.itemId]) patches.push({ _row: have[x.itemId]._row, breakupJson: x.json }); else adds.push({ itemId: x.itemId, breakupJson: x.json }); });
  updateMany('PayrollBreakups', patches); insert('PayrollBreakups', adds);
}
function hPayrollPrecheck(ctx, p) {
  var cid = ctx.cid, ym = p.month ? reqMonth(p.month) : ctx.today.slice(0, 7), from = monthStart(ym), to = monthEnd(ym);
  var emps = empsOf(cid).list.filter(function (e) { return e.status === 'Active' && e.doj <= to; }), ids = emps.map(function (e) { return e.employeeId; }), issues = [];
  var sal = salaryMapFor(ids, to), set = {}; ids.forEach(function (i) { set[i] = 1; });
  emps.forEach(function (e) {
    if (!sal[e.employeeId]) issues.push({ severity: 'error', type: 'Missing salary structure', employeeId: e.employeeId, name: e.fullName, detail: 'Employee will be skipped until a salary structure is added.' });
    if (!e.bankName || !e.accountNo || !e.ifsc) issues.push({ severity: 'warning', type: 'Missing bank details', employeeId: e.employeeId, name: e.fullName, detail: 'Bank name, account number or IFSC is missing.' });
  });
  rows('Attendance').forEach(function (r) {
    if (set[r.employeeId] && r.date >= from && r.date <= to && r.status === 'Open' && r.date < ctx.today) issues.push({ severity: 'error', type: 'Unresolved attendance', employeeId: r.employeeId, name: empName(cid, r.employeeId), detail: 'Punch-in on ' + r.date + ' has no punch-out. Regularize it in Attendance.' });
  });
  rows('LeaveRequests').forEach(function (r) { if (set[r.employeeId] && r.status === 'Pending' && r.fromDate <= to && r.toDate >= from) issues.push({ severity: 'error', type: 'Pending leave request', employeeId: r.employeeId, name: empName(cid, r.employeeId), detail: r.leaveType + ' ' + r.fromDate + ' → ' + r.toDate + ' is awaiting a decision.' }); });
  rows('SpecialRequests').forEach(function (r) { if (set[r.employeeId] && r.status === 'Pending' && r.fromDate <= to && r.toDate >= from) issues.push({ severity: 'error', type: 'Pending special request', employeeId: r.employeeId, name: empName(cid, r.employeeId), detail: 'Duty travel ' + r.fromDate + ' → ' + r.toDate + ' is awaiting a decision.' }); });
  var pendingExp = where('ExpenseClaims', function (c) { return set[c.employeeId] && c.status === 'Pending'; });
  if (pendingExp.length) issues.push({ severity: 'info', type: 'Pending expense claims', employeeId: '', name: '', detail: pendingExp.length + ' claim(s) are not yet approved and will not be reimbursed in this run.' });
  if (ym === ctx.today.slice(0, 7) && ctx.today < to) issues.push({ severity: 'warning', type: 'Month not complete', employeeId: '', name: '', detail: 'Days after today are counted as loss of pay. Wait until month-end or adjust LOP manually.' });
  if (ym > ctx.today.slice(0, 7)) issues.push({ severity: 'error', type: 'Future month', employeeId: '', name: '', detail: 'Payroll cannot be calculated for a future month.' });
  var run = findRun(cid, ym);
  return {
    month: ym, fy: fyOf(from), employees: emps.length, issues: issues, errors: issues.filter(function (i) { return i.severity === 'error'; }).length,
    warnings: issues.filter(function (i) { return i.severity === 'warning'; }).length, run: run ? { runId: run.runId, status: run.status } : null
  };
}
function hPayrollCalculate(ctx, p) {
  var cid = ctx.cid, ym = reqMonth(p.month), from = monthStart(ym), to = monthEnd(ym), dim = daysInMonth(ym);
  if (ym > ctx.today.slice(0, 7)) fail('VALIDATION', 'Payroll cannot be calculated for a future month.');
  var s = settingsFor(cid), run = findRun(cid, ym);
  var items = run ? runItems(run.runId) : [], byEmp = idx(items, 'employeeId');
  var emps = empsOf(cid).list.filter(function (e) { return e.status === 'Active' && e.doj <= to && (!byEmp[e.employeeId] || byEmp[e.employeeId].status === 'Draft'); });
  if (!emps.length) fail('STATE', run ? 'All payroll items for this month are already approved or paid.' : 'No active employees to process for this month.');
  var ids = emps.map(function (e) { return e.employeeId; }), sal = salaryMapFor(ids, to), data = loadPeriodData(cid, ids, from, to);
  var recalcSet = {}; ids.forEach(function (i) { recalcSet[i] = 1; });
  if (!run) {
    var rid = newId('RUN', 'payrollrun', 5);
    insert('PayrollRuns', { runId: rid, companyId: cid, fy: fyOf(from), month: ym, status: 'Draft', totals: '{}', calculatedAt: ctx.now, approvedAt: '', paidAt: '' });
    run = findRun(cid, ym);
  }
  var claimsAll = where('ExpenseClaims', function (c) { return recalcSet[c.employeeId] && c.status === 'Approved' && (c.payrollRunId === '' || c.payrollRunId === run.runId); });
  var claimsBy = group(claimsAll, 'employeeId');
  var oldBk = {}; items.forEach(function (i) { oldBk[i.itemId] = i; });
  var bkRows = idx(rows('PayrollBreakups'), 'itemId');
  var computed = [], skipped = [];
  emps.forEach(function (e) {
    var sl = sal[e.employeeId];
    if (!sl) { skipped.push(e.fullName); return; }
    var ev = evalMonth(e, ym, data, ctx.today, true), prev = byEmp[e.employeeId], adj = {};
    if (prev && bkRows[prev.itemId]) adj = (safeJson(bkRows[prev.itemId].breakupJson, {}) || {}).adj || {};
    var reimbs = (claimsBy[e.employeeId] || []).map(function (c) { return { claimId: c.claimId, category: c.category, expenseDate: c.expenseDate, amount: c.amount }; });
    var r = computeItem({ sal: sl, emp: e, dim: dim, payable: ev.totals.payable, bonus: adj.bonus, otherDed: adj.otherDeduction, note: adj.note, reimbs: reimbs, settings: s });
    computed.push({ emp: e, prev: prev, r: r, claims: claimsBy[e.employeeId] || [] });
  });
  var fresh = computed.filter(function (c) { return !c.prev; }), newIds_ = fresh.length ? newIds('PIT', 'payrollitem', fresh.length, 6) : [], k = 0;
  var patches = [], adds = [], bks = [], claimPatches = {};
  computed.forEach(function (c) {
    var id = c.prev ? c.prev.itemId : newIds_[k++];
    var row = { payableDays: c.r.payable, lopDays: c.r.lop, gross: c.r.gross, reimbursements: c.r.reimb, deductions: c.r.ded, netPay: c.r.net, status: 'Draft' };
    if (c.prev) { row._row = c.prev._row; patches.push(row); } else { row.itemId = id; row.runId = run.runId; row.employeeId = c.emp.employeeId; adds.push(row); }
    bks.push({ itemId: id, json: JSON.stringify(c.r.breakup) });
  });
  // expense claims: link exactly once to this run
  var want = {}; computed.forEach(function (c) { c.claims.forEach(function (cl) { want[cl.claimId] = run.runId; }); });
  claimsAll.forEach(function (cl) { var w = want[cl.claimId] || ''; if (cl.payrollRunId !== w) claimPatches[cl.claimId] = { _row: cl._row, payrollRunId: w }; });
  updateMany('PayrollItems', patches); insert('PayrollItems', adds); upsertBreakups(bks);
  updateMany('ExpenseClaims', Object.keys(claimPatches).map(function (k2) { return claimPatches[k2]; }));
  update('PayrollRuns', run, { calculatedAt: ctx.now });
  refreshRun(findRun(cid, ym), ctx);
  ctx.entityId = run.runId; ctx.remark = 'Calculated ' + ym + ' for ' + computed.length + ' employee(s)';
  return { runId: run.runId, calculated: computed.length, skipped: skipped };
}
function itemOut(cid, i, emp, hasSlip) {
  return { itemId: i.itemId, runId: i.runId, employeeId: i.employeeId, fullName: emp ? emp.fullName : '', empCode: emp ? emp.empCode : '', designation: emp ? emp.designation : '', payableDays: i.payableDays, lopDays: i.lopDays, gross: i.gross, reimbursements: i.reimbursements, deductions: i.deductions, netPay: i.netPay, status: i.status, hasPayslip: !!hasSlip };
}
function hPayrollRun(ctx, p) {
  var cid = ctx.cid, ym = p.month ? reqMonth(p.month) : ctx.today.slice(0, 7), run = findRun(cid, ym);
  var out = { month: ym, fy: fyOf(monthStart(ym)), run: null, items: { rows: [], total: 0, page: 1, pageSize: 10, pages: 1 } };
  if (!run) return out;
  var emps = empsOf(cid).byId, slips = {};
  where('Payslips', function (x) { return x.runId === run.runId; }).forEach(function (x) { slips[x.employeeId] = 1; });
  var items = runItems(run.runId), st = str(p.status, 10);
  var list = items.filter(function (i) { return (!st || i.status === st) && matches(p.q, [(emps[i.employeeId] || {}).fullName, (emps[i.employeeId] || {}).empCode]); });
  var sk = str(p.sort, 12) || 'name', desc = str(p.dir, 4) === 'desc';
  var keyFns = { name: function (i) { return ((emps[i.employeeId] || {}).fullName || '').toLowerCase(); }, net: function (i) { return i.netPay; }, gross: function (i) { return i.gross; }, lop: function (i) { return i.lopDays; }, status: function (i) { return i.status; } };
  sortBy(list, keyFns[sk] || keyFns.name, desc);
  var pg = paginate(list, p);
  pg.rows = pg.rows.map(function (i) { return itemOut(cid, i, emps[i.employeeId], slips[i.employeeId]); });
  out.items = pg;
  var counts = { Draft: 0, Approved: 0, Paid: 0 }; items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
  out.run = { runId: run.runId, status: run.status, totals: safeJson(run.totals, {}), calculatedAt: run.calculatedAt, approvedAt: run.approvedAt, paidAt: run.paidAt, counts: counts };
  return out;
}
function hPayrollRuns(ctx, p) {
  var list = sortBy(where('PayrollRuns', function (r) { return r.companyId === ctx.cid; }), function (r) { return r.month; }, true);
  return list.map(function (r) { return { runId: r.runId, month: r.month, fy: r.fy, status: r.status, totals: safeJson(r.totals, {}), calculatedAt: r.calculatedAt, approvedAt: r.approvedAt, paidAt: r.paidAt }; });
}
function itemScoped(ctx, id) {
  var it = findOne('PayrollItems', function (i) { return i.itemId === str(id, 20); });
  if (!it) fail('NOT_FOUND', 'Payroll item not found.');
  var run = findOne('PayrollRuns', function (r) { return r.runId === it.runId; });
  if (!run || run.companyId !== ctx.cid) fail('NOT_FOUND', 'Payroll item not found.');
  return { item: it, run: run };
}
function breakupOf(itemId) { var b = findOne('PayrollBreakups', function (x) { return x.itemId === itemId; }); return b ? safeJson(b.breakupJson, {}) : {}; }
function hPayrollItemGet(ctx, p) {
  var sc = itemScoped(ctx, p.itemId), e = empsOf(ctx.cid).byId[sc.item.employeeId];
  var slip = findOne('Payslips', function (x) { return x.runId === sc.run.runId && x.employeeId === sc.item.employeeId; });
  return { item: itemOut(ctx.cid, sc.item, e, slip), breakup: breakupOf(sc.item.itemId), month: sc.run.month, runStatus: sc.run.status, employee: { fullName: e.fullName, empCode: e.empCode, designation: e.designation, bankName: e.bankName, accountNo: e.accountNo ? '••••' + e.accountNo.slice(-4) : '', uan: e.uan, esicNo: e.esicNo, panNumber: e.panNumber }, payslipId: slip ? slip.payslipId : '' };
}
function hPayrollItemUpdate(ctx, p) {
  var sc = itemScoped(ctx, p.itemId), it = sc.item;
  if (it.status !== 'Draft') fail('STATE', 'Only draft payroll items can be edited.');
  var bk = breakupOf(it.itemId), e = empsOf(ctx.cid).byId[it.employeeId], dim = bk.daysInMonth;
  var lop = p.lopDays === '' || p.lopDays == null ? it.lopDays : Number(p.lopDays);
  if (!isFinite(lop) || lop < 0 || lop > dim || Math.round(lop * 2) !== lop * 2) fail('VALIDATION', 'LOP days must be between 0 and ' + dim + ' in steps of 0.5.', { field: 'lopDays' });
  var bonus = optNum(p.bonus, 'Bonus / extra earnings', 0, 10000000), other = optNum(p.otherDeduction, 'Other deduction', 0, 10000000), note = str(p.note, 200);
  var r = computeItem({ sal: bk.structure, emp: e, dim: dim, payable: dim - lop, bonus: bonus, otherDed: other, note: note, reimbs: bk.reimbursements || [], settings: settingsFor(ctx.cid), lopOverride: lop });
  update('PayrollItems', it, { payableDays: r.payable, lopDays: r.lop, gross: r.gross, reimbursements: r.reimb, deductions: r.ded, netPay: r.net });
  upsertBreakups([{ itemId: it.itemId, json: JSON.stringify(r.breakup) }]);
  refreshRun(sc.run, ctx);
  ctx.entityId = it.itemId; ctx.remark = e.fullName + ' ' + sc.run.month + ' edited (LOP ' + lop + ', net ' + r.net + ')';
  return { item: itemOut(ctx.cid, findOne('PayrollItems', function (i) { return i.itemId === it.itemId; }), e, false), breakup: r.breakup };
}
function selectItems(ctx, p, fromStatus) {
  var run = findOne('PayrollRuns', function (r) { return r.runId === str(p.runId, 20) && r.companyId === ctx.cid; });
  if (!run) fail('NOT_FOUND', 'Payroll run not found.');
  var sel = {}; (Array.isArray(p.itemIds) ? p.itemIds : []).forEach(function (i) { sel[str(i, 20)] = 1; });
  if (!p.all && !Object.keys(sel).length) fail('VALIDATION', 'Select at least one employee.');
  var list = runItems(run.runId).filter(function (i) { return (p.all || sel[i.itemId]) && (!fromStatus || i.status === fromStatus); });
  return { run: run, list: list };
}
function hPayrollApprove(ctx, p) {
  var sc = selectItems(ctx, p, 'Draft');
  if (!sc.list.length) fail('STATE', 'No draft items to approve.');
  updateMany('PayrollItems', sc.list.map(function (i) { return { _row: i._row, status: 'Approved' }; }));
  refreshRun(sc.run, ctx);
  ctx.entityId = sc.run.runId; ctx.remark = 'Approved ' + sc.list.length + ' item(s) for ' + sc.run.month;
  return { approved: sc.list.length };
}
function hPayrollMarkPaid(ctx, p) {
  var sc = selectItems(ctx, p, 'Approved');
  if (!sc.list.length) fail('STATE', 'No approved items to mark as paid.');
  var set = {}; sc.list.forEach(function (i) { set[i.employeeId] = 1; });
  updateMany('PayrollItems', sc.list.map(function (i) { return { _row: i._row, status: 'Paid' }; }));
  var claims = where('ExpenseClaims', function (c) { return c.payrollRunId === sc.run.runId && set[c.employeeId] && c.status === 'Approved'; });
  updateMany('ExpenseClaims', claims.map(function (c) { return { _row: c._row, status: 'Paid' }; }));
  sc.list.forEach(function (i) { notifyEmployee(ctx.cid, i.employeeId, 'Salary for ' + sc.run.month + ' has been paid. Net pay: ₹' + inr(i.netPay, 2)); });
  refreshRun(sc.run, ctx);
  ctx.entityId = sc.run.runId; ctx.remark = 'Paid ' + sc.list.length + ' item(s) for ' + sc.run.month;
  return { paid: sc.list.length, claimsPaid: claims.length };
}

/* ---------- payslip PDF ---------- */
function inr(n, dec) {
  var neg = n < 0, v = Math.abs(Number(n) || 0).toFixed(dec === undefined ? 2 : dec), parts = v.split('.'), i = parts[0], last3 = i.slice(-3), rest = i.slice(0, -3);
  if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  return (neg ? '-' : '') + last3 + (parts[1] ? '.' + parts[1] : '');
}
function rupees(n) { return '₹' + inr(n, 2); }
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function amountWords(n) {
  n = Math.round(n); if (n === 0) return 'Zero Rupees Only';
  var a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(x) { return x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''); }
  function three(x) { return (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : ''); }
  var parts = [], cr = Math.floor(n / 10000000), lk = Math.floor(n / 100000) % 100, th = Math.floor(n / 1000) % 100, rest = n % 1000;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (rest) parts.push(three(rest));
  return parts.join(' ') + ' Rupees Only';
}
function monthLabel(ym) { return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
function payslipHtml(cid, run, item, bk, emp) {
  var co = companyOf(cid), s = settingsFor(cid), tpl = s.payslipTemplate || 'classic', color = RX.color.test(s.brandColor) ? s.brandColor : '#4F46E5';
  var logo = brandAsset(cid, 'logoFileId'), sign = brandAsset(cid, 'signatureFileId'), stamp = brandAsset(cid, 'stampFileId');
  var pr = profileOf(emp.employeeId) || {};
  var earn = [['Basic', bk.earnings.basic], ['HRA', bk.earnings.hra], ['Special Allowance', bk.earnings.specialAllowance]];
  if (bk.earnings.bonus) earn.push(['Bonus / Other Earnings', bk.earnings.bonus]);
  (bk.reimbursements || []).forEach(function (r) { earn.push(['Reimbursement – ' + r.category + ' (' + r.expenseDate + ')', r.amount]); });
  var ded = [['Provident Fund (12%)', bk.deductions.pf], ['ESI (0.75%)', bk.deductions.esi], ['Professional Tax', bk.deductions.pt], ['Other Deductions', bk.deductions.other]];
  if (bk.deductions.capAdjust) ded.push(['Deduction cap adjustment', bk.deductions.capAdjust]);
  ded = ded.filter(function (d) { return d[1] !== 0; });
  var totalEarn = round2(item.gross + item.reimbursements), rowsN = Math.max(earn.length, ded.length || 1), trs = '';
  for (var i = 0; i < rowsN; i++) {
    trs += '<tr><td>' + (earn[i] ? escHtml(earn[i][0]) : '&nbsp;') + '</td><td class="r">' + (earn[i] ? rupees(earn[i][1]) : '') + '</td><td>' + (ded[i] ? escHtml(ded[i][0]) : '&nbsp;') + '</td><td class="r">' + (ded[i] ? rupees(ded[i][1]) : '') + '</td></tr>';
  }
  var css = 'body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:12px;margin:0;padding:24px}table{width:100%;border-collapse:collapse}td,th{padding:7px 9px;vertical-align:top}.r{text-align:right}.muted{color:#6b7280}h1{font-size:20px;margin:0}h2{font-size:15px;margin:0}.grid td{width:25%}';
  if (tpl === 'modern') css += '.head{background:' + color + ';color:#fff;padding:18px 20px}.head h1,.head h2{color:#fff}.sec th{background:' + color + '1A;color:' + color + ';text-align:left;border-bottom:2px solid ' + color + '}.tbl td{border-bottom:1px solid #e5e7eb}.net{background:' + color + ';color:#fff;padding:12px 16px;font-size:15px;margin-top:14px}';
  else if (tpl === 'compact') css += 'body{font-size:11px;padding:16px}.head{border-bottom:2px solid #111;padding-bottom:8px}.sec th{background:#f3f4f6;text-align:left;border-top:1px solid #111;border-bottom:1px solid #111}.tbl td{padding:4px 8px}.net{border-top:2px solid #111;border-bottom:2px solid #111;padding:8px;margin-top:10px;font-size:13px}';
  else css += '.head{border:1px solid #111;padding:14px 16px}.sec th{background:#eef0f4;text-align:left;border:1px solid #111}.tbl td{border:1px solid #111}.net{border:1px solid #111;padding:10px 14px;margin-top:12px;font-size:14px}';
  var h = '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>';
  h += '<table class="head"><tr><td style="width:70px">' + (logo ? '<img src="' + logo + '" style="max-height:56px;max-width:110px">' : '') + '</td><td><h1>' + escHtml(co.companyName) + '</h1><div class="muted" style="' + (tpl === 'modern' ? 'color:#e0e7ff' : '') + '">' + escHtml(co.address) + '</div></td><td class="r"><h2>PAYSLIP</h2><div>' + monthLabel(run.month) + '</div></td></tr></table>';
  h += '<table class="grid" style="margin-top:10px"><tr><td class="muted">Employee</td><td><b>' + escHtml(emp.fullName) + '</b></td><td class="muted">Employee Code</td><td>' + escHtml(emp.empCode) + '</td></tr>';
  h += '<tr><td class="muted">Designation</td><td>' + escHtml(emp.designation || '—') + '</td><td class="muted">Department</td><td>' + escHtml(emp.department || '—') + '</td></tr>';
  h += '<tr><td class="muted">Date of Joining</td><td>' + escHtml(emp.doj) + '</td><td class="muted">PAN</td><td>' + escHtml(emp.panNumber || '—') + '</td></tr>';
  h += '<tr><td class="muted">Bank A/C</td><td>' + (emp.accountNo ? '••••' + escHtml(emp.accountNo.slice(-4)) : '—') + ' ' + escHtml(emp.bankName) + '</td><td class="muted">UAN / ESIC</td><td>' + escHtml(emp.uan || '—') + ' / ' + escHtml(emp.esicNo || '—') + '</td></tr>';
  h += '<tr><td class="muted">Days in Month</td><td>' + bk.daysInMonth + '</td><td class="muted">Payable / LOP Days</td><td>' + bk.payableDays + ' / ' + bk.lopDays + '</td></tr></table>';
  h += '<table class="tbl" style="margin-top:12px"><tr class="sec"><th>Earnings</th><th class="r">Amount</th><th>Deductions</th><th class="r">Amount</th></tr>' + trs;
  h += '<tr class="sec"><th>Total Earnings</th><th class="r">' + rupees(totalEarn) + '</th><th>Total Deductions</th><th class="r">' + rupees(item.deductions) + '</th></tr></table>';
  h += '<div class="net"><table><tr><td><b>Net Pay</b></td><td class="r"><b>' + rupees(item.netPay) + '</b></td></tr><tr><td colspan="2" style="font-size:11px">' + escHtml(amountWords(item.netPay)) + '</td></tr></table></div>';
  h += '<table style="margin-top:36px"><tr><td class="muted">This is a system generated payslip.</td><td class="r">' + (stamp ? '<img src="' + stamp + '" style="max-height:60px;margin-right:12px">' : '') + (sign ? '<img src="' + sign + '" style="max-height:48px">' : '') + '<div class="muted">Authorised Signatory – HR</div></td></tr></table>';
  return h + '</body></html>';
}
function makePayslip(ctx, run, item, emp) {
  var bk = breakupOf(item.itemId);
  if (!bk.earnings) fail('STATE', 'Payroll breakup is missing. Recalculate payroll.');
  var html = payslipHtml(ctx.cid, run, item, bk, emp);
  var pdf = Utilities.newBlob(html, 'text/html', 'payslip.html').getAs('application/pdf').setName('Payslip_' + emp.empCode + '_' + run.month + '.pdf');
  var file = folderFor(ctx.cid, ['Payslips', run.fy]).createFile(pdf);
  var old = findOne('Payslips', function (x) { return x.runId === run.runId && x.employeeId === emp.employeeId; });
  if (old) { trashFile(old.fileId); update('Payslips', old, { fileId: file.getId(), generatedAt: ctx.now }); return old.payslipId; }
  var id = newId('PSL', 'payslip', 6);
  insert('Payslips', { payslipId: id, runId: run.runId, employeeId: emp.employeeId, fileId: file.getId(), generatedAt: ctx.now });
  return id;
}
function hPayslipsGenerate(ctx, p) {
  var run = findOne('PayrollRuns', function (r) { return r.runId === str(p.runId, 20) && r.companyId === ctx.cid; });
  if (!run) fail('NOT_FOUND', 'Payroll run not found.');
  var sel = {}; (Array.isArray(p.itemIds) ? p.itemIds : []).forEach(function (i) { sel[str(i, 20)] = 1; });
  var have = {}; where('Payslips', function (x) { return x.runId === run.runId; }).forEach(function (x) { have[x.employeeId] = 1; });
  var cand = runItems(run.runId).filter(function (i) { return (i.status === 'Approved' || i.status === 'Paid') && (p.all || sel[i.itemId]) && (p.regenerate || !have[i.employeeId]); });
  if (!cand.length && !p.all && !Object.keys(sel).length) fail('VALIDATION', 'Select at least one employee.');
  var batch = cand.slice(0, 15), emps = empsOf(ctx.cid).byId, done = 0;
  batch.forEach(function (i) { makePayslip(ctx, run, i, emps[i.employeeId]); done++; });
  ctx.entityId = run.runId; ctx.remark = 'Generated ' + done + ' payslip(s) for ' + run.month;
  return { generated: done, remaining: cand.length - batch.length };
}
function payslipFileFor(ctx, item, run, emp) {
  var slip = findOne('Payslips', function (x) { return x.runId === run.runId && x.employeeId === emp.employeeId; });
  if (!slip) { makePayslip(ctx, run, item, emp); slip = findOne('Payslips', function (x) { return x.runId === run.runId && x.employeeId === emp.employeeId; }); }
  return readFile(slip.fileId);
}
function hPayslipDownload(ctx, p) {
  var it = findOne('PayrollItems', function (i) { return i.itemId === str(p.itemId, 20); });
  if (!it) fail('NOT_FOUND', 'Payslip not found.');
  var run = findOne('PayrollRuns', function (r) { return r.runId === it.runId; });
  if (!run || run.companyId !== ctx.cid) fail('NOT_FOUND', 'Payslip not found.');
  var own = it.employeeId === ctx.employeeId;
  if (!own && !can(ctx, 'payroll', 'view')) fail('FORBIDDEN', 'You cannot access this payslip.');
  if (own && it.status === 'Draft') fail('STATE', 'Your payslip is not published yet.');
  if (it.status === 'Draft') fail('STATE', 'Approve the payroll item before generating its payslip.');
  var emp = empsOf(ctx.cid).byId[it.employeeId];
  return payslipFileFor(ctx, it, run, emp);
}
function payslipList(cid, empId, p) {
  var runs = idx(where('PayrollRuns', function (r) { return r.companyId === cid; }), 'runId'), slips = {};
  where('Payslips', function (x) { return x.employeeId === empId; }).forEach(function (x) { slips[x.runId] = x; });
  var fy = str(p.fy, 7), month = str(p.month, 7);
  var list = where('PayrollItems', function (i) { return i.employeeId === empId && i.status !== 'Draft' && runs[i.runId]; })
    .filter(function (i) { var r = runs[i.runId]; return (!fy || r.fy === fy) && (!month || r.month === month); });
  sortBy(list, function (i) { return runs[i.runId].month; }, true);
  var pg = paginate(list, p);
  pg.rows = pg.rows.map(function (i) { var r = runs[i.runId]; return { itemId: i.itemId, month: r.month, fy: r.fy, gross: i.gross, reimbursements: i.reimbursements, deductions: i.deductions, netPay: i.netPay, status: i.status, payableDays: i.payableDays, lopDays: i.lopDays, hasPdf: !!slips[i.runId], generatedAt: slips[i.runId] ? slips[i.runId].generatedAt : '' }; });
  pg.fys = uniq(list.map(function (i) { return runs[i.runId].fy; }));
  return pg;
}
function hEmployeePayslips(ctx, p) { return payslipList(ctx.cid, getEmployeeScoped(ctx, p.employeeId).employeeId, p); }
function hMePayslips(ctx, p) { return payslipList(ctx.cid, ctx.employeeId, p); }
function hMePayslipGet(ctx, p) {
  var it = findOne('PayrollItems', function (i) { return i.itemId === str(p.itemId, 20) && i.employeeId === ctx.employeeId; });
  if (!it || it.status === 'Draft') fail('NOT_FOUND', 'Payslip not found.');
  var run = findOne('PayrollRuns', function (r) { return r.runId === it.runId && r.companyId === ctx.cid; });
  if (!run) fail('NOT_FOUND', 'Payslip not found.');
  var e = empsOf(ctx.cid).byId[ctx.employeeId], co = companyOf(ctx.cid);
  return { month: run.month, fy: run.fy, status: it.status, item: itemOut(ctx.cid, it, e, true), breakup: breakupOf(it.itemId), company: { name: co.companyName, address: co.address, logo: brandAsset(ctx.cid, 'logoFileId'), signature: brandAsset(ctx.cid, 'signatureFileId'), stamp: brandAsset(ctx.cid, 'stampFileId') }, employee: { fullName: e.fullName, empCode: e.empCode, designation: e.designation, department: e.department, doj: e.doj, bankName: e.bankName, accountNo: e.accountNo ? '••••' + e.accountNo.slice(-4) : '', uan: e.uan, esicNo: e.esicNo, panNumber: e.panNumber } };
}

/* ============================== 16. EXPENSE CLAIMS ============================== */
function claimOut(cid, c, dm) {
  var e = empsOf(cid).byId[c.employeeId] || {}, pr = projectsOf(cid).byId[c.projectId] || {}, d = dm[c.claimId];
  return { claimId: c.claimId, employeeId: c.employeeId, employeeName: e.fullName, empCode: e.empCode, projectId: c.projectId, projectName: pr.name || '', category: c.category, expenseDate: c.expenseDate, amount: c.amount, reason: c.reason, billFileId: c.billFileId, status: c.status, decidedByName: c.decidedBy ? userName(cid, c.decidedBy) : '', remark: d ? d.remark : '', decidedAt: d ? d.decidedAt : '', payrollRunId: c.payrollRunId };
}
function hExpenseSubmit(ctx, p) {
  var cid = ctx.cid, emp = empsOf(cid).byId[ctx.employeeId];
  var cat = reqStr(p, 'category', 'Category', 60);
  if (!findOne('ExpenseCategories', function (x) { return x.companyId === cid && x.category === cat; })) fail('VALIDATION', 'Category is invalid.', { field: 'category' });
  var date = reqDate(p.expenseDate, 'Expense date');
  if (date > ctx.today) fail('VALIDATION', 'Expense date cannot be in the future.', { field: 'expenseDate' });
  if (diffDays(date, ctx.today) > 180) fail('VALIDATION', 'Claims older than 180 days cannot be submitted.', { field: 'expenseDate' });
  var amount = Number(p.amount);
  if (!isFinite(amount) || amount <= 0 || amount > 1000000) fail('VALIDATION', 'Amount must be greater than 0 and at most 10,00,000.', { field: 'amount' });
  var reason = reqStr(p, 'reason', 'Reason', 300), pid = str(p.projectId, 20);
  if (pid && !projectsOf(cid).byId[pid]) fail('VALIDATION', 'Project is invalid.', { field: 'projectId' });
  if (!p.file) fail('VALIDATION', 'Please attach the bill photo or PDF.', { field: 'file' });
  var f = saveUpload(cid, ['Expenses', emp.empCode], p.file, { prefix: 'bill' });
  var id = newId('CLM', 'claim', 6);
  insert('ExpenseClaims', { claimId: id, employeeId: emp.employeeId, projectId: pid, category: cat, expenseDate: date, amount: round2(amount), reason: reason, billFileId: f.fileId, status: 'Pending', decidedBy: '', payrollRunId: '' });
  notifyAdmins(cid, emp.fullName + ' submitted an expense claim of ₹' + round2(amount) + ' (' + cat + ')', 'expenses.approve');
  ctx.entityId = id; ctx.remark = cat + ' ₹' + round2(amount);
  return { claimId: id };
}
function claimsQuery(ctx, p, onlyMine) {
  var cid = ctx.cid, ids = empIdSet(cid), st = str(p.status, 10), eid = onlyMine ? ctx.employeeId : str(p.employeeId, 20), pid = str(p.projectId, 20), cat = str(p.category, 60);
  var list = where('ExpenseClaims', function (c) {
    if (!ids[c.employeeId]) return false;
    if (eid && c.employeeId !== eid) return false;
    if (st && c.status !== st) return false; if (pid && c.projectId !== pid) return false; if (cat && c.category !== cat) return false;
    if (p.from && isDateStr(p.from) && c.expenseDate < p.from) return false; if (p.to && isDateStr(p.to) && c.expenseDate > p.to) return false;
    return matches(p.q, [empName(cid, c.employeeId), c.category, c.reason, c.claimId]);
  });
  sortBy(list, function (c) { return c.claimId; }, true);
  return list;
}
function hExpenseList(ctx, p) {
  var list = claimsQuery(ctx, p, false), pg = paginate(list, p), dm = decisionMap(ctx.cid, pg.rows.map(function (c) { return c.claimId; }));
  pg.rows = pg.rows.map(function (c) { return claimOut(ctx.cid, c, dm); });
  pg.summary = { pending: list.filter(function (c) { return c.status === 'Pending'; }).length, pendingAmount: round2(sum(list.filter(function (c) { return c.status === 'Pending'; }), function (c) { return c.amount; })), approvedUnpaid: round2(sum(list.filter(function (c) { return c.status === 'Approved'; }), function (c) { return c.amount; })) };
  return pg;
}
function hExpenseMine(ctx, p) {
  var list = claimsQuery(ctx, p, true), pg = paginate(list, p), dm = decisionMap(ctx.cid, pg.rows.map(function (c) { return c.claimId; }));
  pg.rows = pg.rows.map(function (c) { return claimOut(ctx.cid, c, dm); });
  return pg;
}
function hExpenseDecide(ctx, p) {
  var cid = ctx.cid, c = findOne('ExpenseClaims', function (x) { return x.claimId === str(p.claimId, 20); });
  if (!c || !empsOf(cid).byId[c.employeeId]) fail('NOT_FOUND', 'Claim not found.');
  if (c.status !== 'Pending') fail('STATE', 'This claim has already been decided.');
  var decision = reqEnum(str(p.decision, 10), ['Approved', 'Rejected'], 'Decision'), remark = needRemark(p);
  update('ExpenseClaims', c, { status: decision, decidedBy: ctx.user.userId });
  addDecision(ctx, c.claimId, decision, remark);
  notifyEmployee(cid, c.employeeId, 'Your expense claim ' + c.claimId + ' (₹' + c.amount + ') was ' + decision.toLowerCase() + ': ' + remark);
  ctx.entityId = c.claimId; ctx.remark = decision + ': ' + remark;
  return { status: decision };
}

/* ============================== 17. DOCUMENTS ============================== */
var DOC_CATEGORIES = ['Policy', 'HR Forms', 'Compliance', 'Handbook', 'Circular', 'Other'];
function docVisible(d, roleId) { var v = String(d.visibilityRoles || 'ALL'); return v === 'ALL' || v.split(',').indexOf(roleId) >= 0; }
function docOut(cid, d) {
  var vis = String(d.visibilityRoles || 'ALL');
  return { docId: d.docId, category: d.category, title: d.title, fileId: d.fileId, visibilityRoles: vis, visibilityLabel: vis === 'ALL' ? 'Everyone' : vis.split(',').map(function (r) { return roleName(cid, r); }).join(', ') };
}
function hDocList(ctx, p) {
  var cat = str(p.category, 30);
  var list = where('Documents', function (d) { return d.companyId === ctx.cid && (!cat || d.category === cat) && matches(p.q, [d.title, d.category]); });
  sortBy(list, function (d) { return d.docId; }, true);
  var pg = paginate(list, p); pg.rows = pg.rows.map(function (d) { return docOut(ctx.cid, d); }); pg.categories = DOC_CATEGORIES;
  return pg;
}
function hDocUpload(ctx, p) {
  var cid = ctx.cid, cat = reqEnum(str(p.category, 30), DOC_CATEGORIES, 'Category'), title = reqStr(p, 'title', 'Title', 120);
  var roles = Array.isArray(p.visibilityRoles) ? p.visibilityRoles.map(function (r) { return str(r, 30); }) : ['ALL'];
  var valid = where('Roles', function (r) { return r.companyId === cid; }).map(function (r) { return r.roleId; });
  var vis = (!roles.length || roles.indexOf('ALL') >= 0) ? 'ALL' : roles.filter(function (r) { return valid.indexOf(r) >= 0; }).join(',');
  if (!vis) vis = 'ALL';
  var f = saveUpload(cid, ['Documents', cat], p.file, { prefix: '' });
  var id = newId('CDC', 'companydoc', 6);
  insert('Documents', { docId: id, companyId: cid, category: cat, title: title, fileId: f.fileId, visibilityRoles: vis });
  ctx.entityId = id; ctx.remark = cat + ': ' + title;
  return { docId: id };
}
function hDocDelete(ctx, p) {
  var d = findOne('Documents', function (x) { return x.docId === str(p.docId, 20) && x.companyId === ctx.cid; });
  if (!d) fail('NOT_FOUND', 'Document not found.');
  deleteRows('Documents', [d]); trashFile(d.fileId); ctx.entityId = d.docId; ctx.remark = d.title;
  return { done: true };
}
function hMeDocuments(ctx, p) {
  var own = docsOut(ctx.cid, ctx.employeeId);
  var comp = where('Documents', function (d) { return d.companyId === ctx.cid && docVisible(d, ctx.role); });
  sortBy(comp, function (d) { return d.docId; }, true);
  return { own: own, company: comp.map(function (d) { return docOut(ctx.cid, d); }) };
}

/* ============================== 18. SETTINGS / ROLES ============================== */
function hSettingsGet(ctx, p) {
  var cid = ctx.cid, s = settingsFor(cid), co = companyOf(cid), roles = where('Roles', function (r) { return r.companyId === cid; });
  var perms = where('RolePermissions', function (r) { return r.companyId === cid; }), pm = {};
  perms.forEach(function (r) { (pm[r.roleId] = pm[r.roleId] || {})[r.module + '.' + r.action] = r.allowed; });
  var clean = {}; Object.keys(s).forEach(function (k) { if (!/FileId$/.test(k)) clean[k] = s[k]; });
  return {
    settings: clean, company: { companyName: co.companyName, legalName: co.legalName, gstin: co.gstin, pan: co.pan, email: co.email, phone: co.phone, address: co.address, contactPerson: co.contactPerson },
    assets: { logo: brandAsset(cid, 'logoFileId'), signature: brandAsset(cid, 'signatureFileId'), stamp: brandAsset(cid, 'stampFileId') },
    roles: roles.map(function (r) { return { roleId: r.roleId, roleName: r.roleName, permissions: pm[r.roleId] || {}, locked: r.roleId === 'ADMIN' }; }),
    leaveTypes: where('LeaveTypes', function (t) { return t.companyId === cid; }).map(function (t) { return { leaveType: t.leaveType, defaultDaysPerYear: t.defaultDaysPerYear, unpaid: t.leaveType === UNPAID }; }),
    expenseCategories: where('ExpenseCategories', function (x) { return x.companyId === cid; }).map(function (x) { return x.category; }),
    modules: MODULES, actions: ACTIONS, templates: ['classic', 'modern', 'compact']
  };
}
function hSettingsSave(ctx, p) {
  var cid = ctx.cid, cs = p.company || {}, st = p.settings || {}, co = companyOf(cid), out = {};
  if (cs && Object.keys(cs).length) {
    var cu = { companyName: reqStr(cs, 'companyName', 'Company name', 120), legalName: reqStr(cs, 'legalName', 'Legal name', 160), address: reqStr(cs, 'address', 'Address', 300), contactPerson: reqStr(cs, 'contactPerson', 'Contact person', 100), phone: reqPhone(cs.phone, 'Phone') };
    if (cu.phone !== co.phone && rows('Companies').some(function (c) { return c.phone === cu.phone && c.companyId !== cid; })) fail('DUPLICATE', 'This phone number is used by another company.', { field: 'phone' });
    update('Companies', co, cu);
  }
  if (st.brandColor !== undefined) { if (!RX.color.test(str(st.brandColor, 7))) fail('VALIDATION', 'Brand colour must be a hex value like #4F46E5.', { field: 'brandColor' }); out.brandColor = str(st.brandColor, 7).toUpperCase(); }
  if (st.payslipTemplate !== undefined) out.payslipTemplate = reqEnum(str(st.payslipTemplate, 10), ['classic', 'modern', 'compact'], 'Payslip template');
  if (st.shiftStart !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(str(st.shiftStart, 5))) fail('VALIDATION', 'Shift start must be HH:MM.', { field: 'shiftStart' }); out.shiftStart = str(st.shiftStart, 5); }
  if (st.graceMinutes !== undefined) out.graceMinutes = String(optNum(st.graceMinutes, 'Grace minutes', 0, 240));
  if (st.halfDayMinutes !== undefined) out.halfDayMinutes = String(optNum(st.halfDayMinutes, 'Half-day threshold', 30, 720));
  if (st.geofenceRadiusM !== undefined) out.geofenceRadiusM = String(optNum(st.geofenceRadiusM, 'Geofence radius', 10, 5000));
  if (st.maxAccuracyM !== undefined) out.maxAccuracyM = String(optNum(st.maxAccuracyM, 'Max GPS accuracy', 10, 1000));
  if (st.weeklyOff !== undefined) { var wo = (Array.isArray(st.weeklyOff) ? st.weeklyOff : String(st.weeklyOff).split(',')).map(function (x) { return String(x).trim(); }).filter(function (x) { return x !== ''; }); wo.forEach(function (x) { if (!/^[0-6]$/.test(x)) fail('VALIDATION', 'Weekly off is invalid.'); }); out.weeklyOff = uniq(wo).join(','); }
  if (st.maxConsecutiveLeaveDays !== undefined) out.maxConsecutiveLeaveDays = String(optNum(st.maxConsecutiveLeaveDays, 'Max consecutive leave days', 1, 120));
  if (st.backdatedLeaveDays !== undefined) out.backdatedLeaveDays = String(optNum(st.backdatedLeaveDays, 'Backdated leave days', 0, 60));
  if (st.pfEnabled !== undefined) out.pfEnabled = (st.pfEnabled === true || String(st.pfEnabled).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
  if (st.esiEnabled !== undefined) out.esiEnabled = (st.esiEnabled === true || String(st.esiEnabled).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
  if (st.ptAmount !== undefined) out.ptAmount = String(optNum(st.ptAmount, 'Professional tax', 0, 10000));
  if (st.empCodePrefix !== undefined) { var px = str(st.empCodePrefix, 6).toUpperCase(); if (!/^[A-Z0-9]{2,6}$/.test(px)) fail('VALIDATION', 'Employee code prefix must be 2–6 letters/numbers.', { field: 'empCodePrefix' }); out.empCodePrefix = px; }
  saveSettings(cid, out); ctx.remark = 'Organization settings updated';
  return { saved: true };
}
function hSettingsUpload(ctx, p) {
  var kind = reqEnum(str(p.kind, 12), ['logo', 'signature', 'stamp'], 'Asset type'), key = kind + 'FileId', cid = ctx.cid;
  var f = saveUpload(cid, ['Branding'], p.file, { imageOnly: true, maxBytes: 69000, prefix: kind });
  var old = settingsFor(cid)[key]; if (old) { CACHE.remove('A_' + old); trashFile(old); }
  var o = {}; o[key] = f.fileId; saveSettings(cid, o); ctx.entityId = f.fileId; ctx.remark = kind + ' updated';
  return { asset: brandAsset(cid, key) };
}
function hRoleSave(ctx, p) {
  var cid = ctx.cid, roleId = str(p.roleId, 30), role = findOne('Roles', function (r) { return r.companyId === cid && r.roleId === roleId; });
  if (!role) fail('NOT_FOUND', 'Role not found.');
  if (roleId === 'ADMIN') fail('FORBIDDEN', 'The Company Admin role always has full access.');
  var perms = p.permissions && typeof p.permissions === 'object' ? p.permissions : {};
  var ex = where('RolePermissions', function (r) { return r.companyId === cid && r.roleId === roleId; }), byKey = {};
  ex.forEach(function (r) { byKey[r.module + '.' + r.action] = r; });
  var patches = [], adds = [];
  MODULES.forEach(function (m) { ACTIONS.forEach(function (a) {
    var k = m + '.' + a, v = perms[k] === true || String(perms[k]).toUpperCase() === 'TRUE';
    if (byKey[k]) { if (byKey[k].allowed !== v) patches.push({ _row: byKey[k]._row, allowed: v }); } else adds.push({ companyId: cid, roleId: roleId, module: m, action: a, allowed: v });
  }); });
  updateMany('RolePermissions', patches); insert('RolePermissions', adds);
  CACHE.remove('P_' + cid + '_' + roleId);
  ctx.entityId = roleId; ctx.remark = 'Permissions updated for ' + role.roleName;
  return { changed: patches.length + adds.length };
}
function hRoleCreate(ctx, p) {
  var cid = ctx.cid, name = reqStr(p, 'roleName', 'Role name', 40);
  if (findOne('Roles', function (r) { return r.companyId === cid && lc(r.roleName) === lc(name); })) fail('DUPLICATE', 'A role with this name already exists.', { field: 'roleName' });
  var id = 'R' + pad(nextIds('role_' + cid, 1)[0], 3);
  insert('Roles', { companyId: cid, roleId: id, roleName: name });
  var perms = []; MODULES.forEach(function (m) { ACTIONS.forEach(function (a) { perms.push({ companyId: cid, roleId: id, module: m, action: a, allowed: m === 'reports' && a === 'view' ? false : false }); }); });
  insert('RolePermissions', perms); ctx.entityId = id; ctx.remark = name;
  return { roleId: id };
}
function hLeaveTypeSave(ctx, p) {
  var cid = ctx.cid, name = reqStr(p, 'leaveType', 'Leave type', 60), days = optNum(p.defaultDaysPerYear, 'Days per year', 0, 366);
  var ex = leaveTypeRow(cid, name);
  if (name === UNPAID) fail('VALIDATION', 'Unpaid Leave is a system leave type and cannot be changed.');
  if (ex) update('LeaveTypes', ex, { defaultDaysPerYear: days }); else insert('LeaveTypes', { companyId: cid, leaveType: name, defaultDaysPerYear: days });
  ctx.entityId = name; ctx.remark = name + ' = ' + days + ' days/year';
  return { done: true };
}
function hLeaveTypeDelete(ctx, p) {
  var cid = ctx.cid, name = str(p.leaveType, 60), ex = leaveTypeRow(cid, name);
  if (!ex) fail('NOT_FOUND', 'Leave type not found.');
  if (name === UNPAID) fail('VALIDATION', 'Unpaid Leave cannot be deleted.');
  var ids = empIdSet(cid);
  if (where('LeaveRequests', function (r) { return ids[r.employeeId] && r.leaveType === name && r.status === 'Pending'; }).length) fail('STATE', 'Decide the pending requests of this leave type first.');
  deleteRows('LeaveTypes', [ex]); ctx.entityId = name;
  return { done: true };
}
function hExpCatSave(ctx, p) {
  var cid = ctx.cid, c = reqStr(p, 'category', 'Category', 40);
  if (findOne('ExpenseCategories', function (x) { return x.companyId === cid && lc(x.category) === lc(c); })) fail('DUPLICATE', 'This category already exists.', { field: 'category' });
  insert('ExpenseCategories', { companyId: cid, category: c }); ctx.entityId = c;
  return { done: true };
}
function hExpCatDelete(ctx, p) {
  var cid = ctx.cid, c = str(p.category, 40), ex = findOne('ExpenseCategories', function (x) { return x.companyId === cid && x.category === c; });
  if (!ex) fail('NOT_FOUND', 'Category not found.');
  deleteRows('ExpenseCategories', [ex]); ctx.entityId = c;
  return { done: true };
}

/* ============================== 19. REPORTS ============================== */
function hReport(ctx, p) {
  if (p.all) need(ctx, 'reports', 'export');
  var cid = ctx.cid, type = reqEnum(str(p.type, 12), ['attendance', 'leave', 'payroll', 'expense'], 'Report type'), f = p.filters || {}, cols, data = [], title;
  var emps = empsOf(cid).byId;
  if (type === 'attendance') {
    var ym = f.month ? reqMonth(f.month) : ctx.today.slice(0, 7), from = monthStart(ym), to = monthEnd(ym);
    var list = empsOf(cid).list.filter(function (e) { return e.doj <= to && (!f.employeeId || e.employeeId === f.employeeId); });
    if (f.projectId) {
      var ok = {}; rows('ProjectAssignments').forEach(function (a) { if (a.projectId === f.projectId && a.startDate <= to && (!a.endDate || a.endDate >= from)) ok[a.employeeId] = 1; });
      list = list.filter(function (e) { return ok[e.employeeId]; });
    }
    var dd = loadPeriodData(cid, list.map(function (e) { return e.employeeId; }), from, to), mins = {};
    rows('Attendance').forEach(function (r) { if (dd.att[r.employeeId] && r.date >= from && r.date <= to) mins[r.employeeId] = (mins[r.employeeId] || 0) + r.workMinutes; });
    sortBy(list, function (e) { return e.fullName.toLowerCase(); });
    list.forEach(function (e) {
      var t = evalMonth(e, ym, dd, ctx.today, false).totals;
      data.push({ employee: e.fullName, code: e.empCode, present: t.P, late: t.L, half: t.H, paidLeave: t.V, unpaidLeave: t.U, duty: t.S, absent: t.A + t.X, weeklyOff: t.W, holidays: t.O, payable: t.payable, hours: round2((mins[e.employeeId] || 0) / 60) });
    });
    cols = [['employee', 'Employee'], ['code', 'Code'], ['present', 'Present', 'num'], ['late', 'Late', 'num'], ['half', 'Half Days', 'num'], ['paidLeave', 'Paid Leave', 'num'], ['unpaidLeave', 'Unpaid Leave', 'num'], ['duty', 'Duty Travel', 'num'], ['absent', 'Absent', 'num'], ['weeklyOff', 'Weekly Offs', 'num'], ['holidays', 'Holidays', 'num'], ['payable', 'Payable Days', 'num'], ['hours', 'Work Hours', 'num']];
    title = 'Attendance summary ' + ym;
  } else if (type === 'leave') {
    var fy = str(f.fy, 7) || fyOf(ctx.today), rg = fyRange(fy), types = where('LeaveTypes', function (t) { return t.companyId === cid; });
    var reqs = where('LeaveRequests', function (r) { return emps[r.employeeId] && r.fromDate >= rg.from && r.fromDate <= rg.to; });
    var el = empsOf(cid).list.filter(function (e) { return !f.employeeId || e.employeeId === f.employeeId; });
    sortBy(el, function (e) { return e.fullName.toLowerCase(); });
    el.forEach(function (e) {
      types.forEach(function (t) {
        if (f.leaveType && t.leaveType !== f.leaveType) return;
        var mine = reqs.filter(function (r) { return r.employeeId === e.employeeId && r.leaveType === t.leaveType; });
        var taken = sum(mine.filter(function (r) { return r.status === 'Approved'; }), function (r) { return r.days; }), pend = sum(mine.filter(function (r) { return r.status === 'Pending'; }), function (r) { return r.days; });
        if (t.leaveType === UNPAID && !taken && !pend) return;
        data.push({ employee: e.fullName, code: e.empCode, leaveType: t.leaveType, entitlement: t.leaveType === UNPAID ? '—' : t.defaultDaysPerYear, taken: taken, pending: pend, balance: t.leaveType === UNPAID ? '—' : balanceOf(cid, e.employeeId, t.leaveType, fy) });
      });
    });
    cols = [['employee', 'Employee'], ['code', 'Code'], ['leaveType', 'Leave Type'], ['entitlement', 'Yearly Quota', 'num'], ['taken', 'Taken', 'num'], ['pending', 'Pending', 'num'], ['balance', 'Balance', 'num']];
    title = 'Leave summary ' + fy;
  } else if (type === 'payroll') {
    var runs = where('PayrollRuns', function (r) { return r.companyId === cid && (f.month ? r.month === f.month : (!f.fy || r.fy === f.fy)); }), rm = idx(runs, 'runId');
    var its = where('PayrollItems', function (i) { return rm[i.runId] && (!f.employeeId || i.employeeId === f.employeeId) && (!f.status || i.status === f.status); });
    sortBy(its, function (i) { return rm[i.runId].month + (emps[i.employeeId] || {}).fullName; }, true);
    its.forEach(function (i) { var e = emps[i.employeeId] || {}; data.push({ month: rm[i.runId].month, employee: e.fullName, code: e.empCode, payable: i.payableDays, lop: i.lopDays, gross: i.gross, reimb: i.reimbursements, deductions: i.deductions, net: i.netPay, status: i.status }); });
    cols = [['month', 'Month'], ['employee', 'Employee'], ['code', 'Code'], ['payable', 'Payable Days', 'num'], ['lop', 'LOP', 'num'], ['gross', 'Gross', 'money'], ['reimb', 'Reimb.', 'money'], ['deductions', 'Deductions', 'money'], ['net', 'Net Pay', 'money'], ['status', 'Status']];
    title = 'Payroll register';
  } else {
    var cl = claimsQuery(ctx, { status: f.status, employeeId: f.employeeId, projectId: f.projectId, category: f.category, from: f.from, to: f.to }, false);
    var dm = decisionMap(cid, cl.map(function (c) { return c.claimId; }));
    cl.forEach(function (c) { var o = claimOut(cid, c, dm); data.push({ claim: o.claimId, date: o.expenseDate, employee: o.employeeName, project: o.projectName || '—', category: o.category, amount: o.amount, status: o.status, remark: o.remark || '' }); });
    cols = [['claim', 'Claim'], ['date', 'Date'], ['employee', 'Employee'], ['project', 'Project'], ['category', 'Category'], ['amount', 'Amount', 'money'], ['status', 'Status'], ['remark', 'Remark']];
    title = 'Expense report';
  }
  var numericKeys = cols.filter(function (c) { return c[2] === 'money'; }).map(function (c) { return c[0]; }), totals = {};
  numericKeys.forEach(function (k) { totals[k] = round2(sum(data, function (r) { return num(r[k]); })); });
  var res = { columns: cols.map(function (c) { return { key: c[0], label: c[1], type: c[2] || 'text' }; }), title: title, totals: totals };
  if (p.all) { res.rows = data.slice(0, 20000); res.total = data.length; res.page = 1; res.pages = 1; res.pageSize = data.length; }
  else { var pg = paginate(data, p); res.rows = pg.rows; res.total = pg.total; res.page = pg.page; res.pages = pg.pages; res.pageSize = pg.pageSize; }
  return res;
}

/* ============================== 20. DASHBOARDS ============================== */
function pctTrend(cur, prev, label) {
  var diff = cur - prev; return { dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', text: (diff > 0 ? '+' : '') + diff + ' ' + label };
}
function hDashboard(ctx, p) {
  if (ctx.panel !== 'admin') fail('FORBIDDEN', 'The company dashboard is only available to administrators.');
  var cid = ctx.cid, today = ctx.today, ym = today.slice(0, 7), emps = empsOf(cid).list, active = emps.filter(function (e) { return e.status === 'Active'; });
  var set = empIdSet(cid), byDate = {};
  rows('Attendance').forEach(function (r) { if (set[r.employeeId] && r.date >= addDays(today, -14) && r.status !== 'Absent') byDate[r.date] = (byDate[r.date] || 0) + 1; });
  var trend = []; for (var i = 13; i >= 0; i--) { var d = addDays(today, -i); trend.push({ label: d.slice(5), value: byDate[d] || 0 }); }
  var presentToday = byDate[today] || 0, presentYest = byDate[addDays(today, -1)] || 0;
  var onLeaveIds = {}; where('LeaveRequests', function (r) { return set[r.employeeId] && r.status === 'Approved' && r.fromDate <= today && r.toDate >= today; }).forEach(function (r) { onLeaveIds[r.employeeId] = 1; });
  var onLeave = Object.keys(onLeaveIds).length, pend = pendingCounts(cid), projects = projectsOf(cid).list.filter(function (x) { return x.status === 'Active'; });
  var runs = where('PayrollRuns', function (r) { return r.companyId === cid; }), run = runs.filter(function (r) { return r.month === ym; })[0], prev = runs.filter(function (r) { return r.month === addMonths(ym, -1); })[0];
  var ptot = run ? safeJson(run.totals, {}) : {}, prevTot = prev ? safeJson(prev.totals, {}) : {};
  var ptrend = []; for (var k = 5; k >= 0; k--) { var m = addMonths(ym, -k), rr = runs.filter(function (r) { return r.month === m; })[0]; ptrend.push({ label: m.slice(2), value: rr ? (safeJson(rr.totals, {}).net || 0) : 0 }); }
  var depts = {}; active.forEach(function (e) { var d = e.department || 'Unassigned'; depts[d] = (depts[d] || 0) + 1; });
  var joined = active.filter(function (e) { return e.doj.slice(0, 7) === ym; }).length;
  var recent = sortBy(where('AuditLog', function (l) { return l.companyId === cid; }), function (l) { return l.logId; }, true).slice(0, 6).map(function (l) { return { action: l.action, remark: l.remark, createdAt: l.createdAt, actorName: l.actorId ? userName(cid, l.actorId) : '' }; });
  return {
    cards: {
      headcount: active.length, joinedThisMonth: joined, presentToday: presentToday, presentTrend: pctTrend(presentToday, presentYest, 'vs yesterday'), onLeave: onLeave,
      activeProjects: projects.length, pendingApprovals: pend.total, pending: pend, payrollStatus: run ? run.status : 'Not started', payrollTotal: ptot.net || 0,
      payrollTrend: prevTot.net ? { dir: (ptot.net || 0) >= prevTot.net ? 'up' : 'down', text: Math.round((((ptot.net || 0) - prevTot.net) / prevTot.net) * 100) + '% vs last month' } : { dir: 'flat', text: 'no previous run' }
    },
    attendanceTrend: trend, payrollTrend: ptrend,
    deptSplit: Object.keys(depts).map(function (k2) { return { label: k2, value: depts[k2] }; }),
    todaySplit: [{ label: 'Present', value: presentToday }, { label: 'On leave', value: onLeave }, { label: 'Not marked', value: Math.max(0, active.length - presentToday - onLeave) }],
    recent: recent
  };
}

function hMeDashboard(ctx, p) {
  var cid = ctx.cid, today = ctx.today, ym = today.slice(0, 7), emp = empsOf(cid).byId[ctx.employeeId], a = activeAssignMap(cid)[emp.employeeId], prj = projectsOf(cid).byId;
  var row = todaysRow(emp.employeeId, today), data = loadPeriodData(cid, [emp.employeeId], monthStart(ym), monthEnd(ym));
  var ev = evalDay(emp, today, data, today, false), label;
  if (row && row.status === 'Open') label = 'Working'; else if (row) label = row.status;
  else if (ev.code === 'V' || ev.code === 'U') label = 'On Leave'; else if (ev.code === 'S') label = 'Duty Travel'; else if (ev.code === 'W') label = 'Weekly Off'; else if (ev.code === 'O') label = 'Holiday'; else label = 'Not Punched In';
  var pr = a ? prj[a.projectId] : null, month = evalMonth(emp, ym, data, today, false), fy = fyOf(today);
  var bal = where('LeaveTypes', function (t) { return t.companyId === cid && t.leaveType !== UNPAID; }).map(function (t) { return { leaveType: t.leaveType, total: t.defaultDaysPerYear, balance: balanceOf(cid, emp.employeeId, t.leaveType, fy) }; });
  var slips = payslipList(cid, emp.employeeId, { page: 1, pageSize: 1 }).rows[0] || null;
  var hol = sortBy(where('Holidays', function (h) { return h.companyId === cid && h.date >= today; }), function (h) { return h.date; }).slice(0, 3).map(function (h) { return { date: h.date, name: h.name }; });
  var pendingReq = where('LeaveRequests', function (r) { return r.employeeId === emp.employeeId && r.status === 'Pending'; }).length + where('SpecialRequests', function (r) { return r.employeeId === emp.employeeId && r.status === 'Pending'; }).length;
  return {
    today: { date: today, status: label, punchInAt: row ? row.punchInAt : '', punchOutAt: row ? row.punchOutAt : '', workMinutes: row ? row.workMinutes : 0, canPunchIn: !row && !!pr, canPunchOut: !!row && !row.punchOutAt && !!row.punchInAt, late: row && row.punchInAt ? isLatePunch(cid, row.punchInAt) : false },
    project: pr ? { projectId: pr.projectId, name: pr.name, type: pr.type, clientName: pr.clientName, address: pr.address, lat: pr.lat, lng: pr.lng, radius: pr.geofenceRadiusM, since: a.startDate } : null,
    month: { month: ym, totals: month.totals }, balances: bal, latestPayslip: slips, holidays: hol, pendingRequests: pendingReq,
    employee: { fullName: emp.fullName, empCode: emp.empCode, designation: emp.designation }
  };
}
function hMeProjects(ctx, p) {
  var cid = ctx.cid, emp = empsOf(cid).byId[ctx.employeeId], prj = projectsOf(cid).byId, today = ctx.today;
  var list = sortBy(where('ProjectAssignments', function (a) { return a.employeeId === emp.employeeId; }), function (a) { return a.assignmentId; }, true);
  var att = where('Attendance', function (r) { return r.employeeId === emp.employeeId; });
  var leaves = where('LeaveRequests', function (r) { return r.employeeId === emp.employeeId && r.status === 'Approved'; });
  var out = list.map(function (a) {
    var pr = prj[a.projectId] || {}, end = a.endDate || today;
    var worked = sum(att.filter(function (r) { return r.projectId === a.projectId && r.date >= a.startDate && r.date <= end && (r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day' || r.status === 'Open'); }), function (r) { return r.status === 'Half Day' ? 0.5 : 1; });
    var lv = sum(leaves, function (l) { var f = l.fromDate > a.startDate ? l.fromDate : a.startDate, t = l.toDate < end ? l.toDate : end; return f <= t ? workingDaysBetween(cid, f, t) : 0; });
    return { assignmentId: a.assignmentId, projectId: a.projectId, name: pr.name || a.projectId, type: pr.type, clientName: pr.clientName, address: pr.address, lat: pr.lat, lng: pr.lng, radius: pr.geofenceRadiusM, startDate: a.startDate, endDate: a.endDate, status: a.status, endReason: a.endReason, daysWorked: worked, leaveDays: lv };
  });
  return { current: out.filter(function (x) { return x.status === 'Active'; })[0] || null, history: out.filter(function (x) { return x.status !== 'Active'; }) };
}
function attendanceDetail(cid, emp, ym, today) {
  var from = monthStart(ym), to = monthEnd(ym), data = loadPeriodData(cid, [emp.employeeId], from, to), ev = evalMonth(emp, ym, data, today, false), prj = projectsOf(cid).byId;
  var punches = {}; Object.keys(data.att[emp.employeeId] || {}).forEach(function (d) { var r = data.att[emp.employeeId][d]; punches[d] = { in: r.punchInAt ? r.punchInAt.slice(11, 16) : '', out: r.punchOutAt ? r.punchOutAt.slice(11, 16) : '', project: (prj[r.projectId] || {}).name || '', minutes: r.workMinutes, distance: r.inDistanceM, status: r.status, source: r.source }; });
  var hol = []; Object.keys(data.holidays).forEach(function (d) { if (d >= from && d <= to) hol.push({ date: d, name: data.holidays[d] }); });
  return { month: ym, days: ev.days.map(function (d) { return { date: d.date, code: d.code }; }), totals: ev.totals, punches: punches, holidays: hol, weeklyOff: Object.keys(data.wo).map(Number) };
}
function hMeAttendance(ctx, p) {
  var ym = p.month ? reqMonth(p.month) : ctx.today.slice(0, 7);
  return attendanceDetail(ctx.cid, empsOf(ctx.cid).byId[ctx.employeeId], ym, ctx.today);
}
function hEmployeeAttendance(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), ym = p.month ? reqMonth(p.month) : ctx.today.slice(0, 7);
  return attendanceDetail(ctx.cid, e, ym, ctx.today);
}
function requestsFor(cid, empId) {
  var L = sortBy(where('LeaveRequests', function (r) { return r.employeeId === empId; }), function (r) { return r.requestId; }, true);
  var S = sortBy(where('SpecialRequests', function (r) { return r.employeeId === empId; }), function (r) { return r.requestId; }, true);
  var dm = decisionMap(cid, L.map(function (r) { return r.requestId; }).concat(S.map(function (r) { return r.requestId; })));
  return { leave: L.map(function (r) { return leaveOut(cid, r, dm, false); }), special: S.map(function (r) { return specialOut(cid, r, dm); }) };
}
function hMeRequests(ctx, p) { return requestsFor(ctx.cid, ctx.employeeId); }
function hEmployeeLeaves(ctx, p) {
  var e = getEmployeeScoped(ctx, p.employeeId), cid = ctx.cid, fy = fyOf(ctx.today), out = requestsFor(cid, e.employeeId);
  out.balances = where('LeaveTypes', function (t) { return t.companyId === cid && t.leaveType !== UNPAID; }).map(function (t) { return { leaveType: t.leaveType, total: t.defaultDaysPerYear, balance: balanceOf(cid, e.employeeId, t.leaveType, fy) }; });
  return out;
}
function hProfileGet(ctx, p) {
  var cid = ctx.cid, e = empsOf(cid).byId[ctx.employeeId], pr = profileOf(e.employeeId) || {};
  return {
    employee: { fullName: e.fullName, empCode: e.empCode, phone: e.phone, email: e.email, designation: e.designation, department: e.department, doj: e.doj, employmentType: e.employmentType, photoFileId: e.photoFileId, bankName: e.bankName, accountNo: e.accountNo ? '••••' + e.accountNo.slice(-4) : '', ifsc: e.ifsc, panNumber: e.panNumber, uan: e.uan, esicNo: e.esicNo },
    profile: { dob: pr.dob || '', gender: pr.gender || '', address: pr.address || '', emergencyContact: pr.emergencyContact || '', maritalStatus: pr.maritalStatus || '' }
  };
}
function hProfileSave(ctx, p) {
  var e = empsOf(ctx.cid).byId[ctx.employeeId];
  var email = p.email ? reqEmail(p.email) : '';
  if (p.dob && !isDateStr(str(p.dob, 10))) fail('VALIDATION', 'Date of birth is invalid.', { field: 'dob' });
  if (p.gender && ['Male', 'Female', 'Other'].indexOf(str(p.gender, 10)) < 0) fail('VALIDATION', 'Gender is invalid.', { field: 'gender' });
  var prof = { dob: str(p.dob, 10), gender: str(p.gender, 10), address: str(p.address, 300), emergencyContact: str(p.emergencyContact, 100), maritalStatus: str(p.maritalStatus, 20) };
  update('Employees', e, { email: email });
  var pr = profileOf(e.employeeId);
  if (pr) update('EmployeeProfiles', pr, prof); else insert('EmployeeProfiles', { employeeId: e.employeeId, dob: prof.dob, gender: prof.gender, address: prof.address, emergencyContact: prof.emergencyContact, maritalStatus: prof.maritalStatus });
  var u = userForEmployee(e.employeeId); if (u) { update('Users', u, { email: email }); bustUser(u.userId); }
  ctx.entityId = e.employeeId;
  return { saved: true };
}
function hProfilePhoto(ctx, p) {
  var e = empsOf(ctx.cid).byId[ctx.employeeId], f = saveUpload(ctx.cid, ['Employees', e.empCode], p.file, { imageOnly: true, maxBytes: 2 * 1048576, prefix: 'Photo' });
  insert('EmployeeDocuments', { docId: newId('DOC', 'empdoc', 6), employeeId: e.employeeId, docType: 'Photo', fileId: f.fileId, fileName: f.fileName, uploadedBy: ctx.user.userId, createdAt: ctx.now });
  update('Employees', e, { photoFileId: f.fileId }); ctx.entityId = e.employeeId;
  return { photoFileId: f.fileId };
}
function hMeProjectOptions(ctx, p) { // for the expense form
  return projectsOf(ctx.cid).list.filter(function (x) { return x.status === 'Active'; }).map(function (x) { return { projectId: x.projectId, name: x.name }; });
}

/* ============================== 21. ROUTE TABLE ============================== */
// public
R('boot', { auth: 'public' }, hBoot);
R('auth.login', { auth: 'public', write: true, audit: false }, hLogin);
R('auth.signupCompany', { auth: 'public', write: true, audit: false }, hSignupCompany);
R('auth.activate', { auth: 'public', write: true, audit: false }, hActivate);
R('auth.logout', { auth: 'any', write: true, module: 'auth' }, hLogout);
R('auth.changePassword', { auth: 'any', write: true, module: 'auth' }, hChangePassword);
// super admin
R('sa.dashboard', { auth: 'super' }, hSaDashboard);
R('sa.companies.list', { auth: 'super' }, hSaCompaniesList);
R('sa.company.get', { auth: 'super' }, hSaCompanyGet);
R('sa.company.decide', { auth: 'super', write: true, audit: false }, hSaCompanyDecide);
R('sa.company.setStatus', { auth: 'super', write: true, audit: false }, hSaCompanySetStatus);
R('sa.company.resetAdminPassword', { auth: 'super', write: true, audit: false }, hSaResetAdmin);
R('sa.settings.get', { auth: 'super' }, hSaSettingsGet);
R('sa.settings.save', { auth: 'super', write: true, module: 'settings' }, hSaSettingsSave);
R('sa.settings.upload', { auth: 'super', write: true, module: 'settings' }, hSaSettingsUpload);
R('sa.audit.list', { auth: 'super' }, hSaAuditList);
// shared
R('ticket.list', { auth: 'any' }, hTicketList);
R('ticket.get', { auth: 'any' }, hTicketGet);
R('ticket.create', { auth: 'any', write: true, module: 'support' }, hTicketCreate);
R('ticket.reply', { auth: 'any', write: true, module: 'support' }, hTicketReply);
R('ticket.status', { auth: 'any', write: true, module: 'support' }, hTicketStatus);
R('notif.list', { auth: 'any' }, hNotifList);
R('notif.read', { auth: 'any', write: true, audit: false }, hNotifRead);
R('file.get', { auth: 'any' }, hFileGet);
R('holiday.list', { auth: 'company' }, hHolidayList);
R('payslip.download', { auth: 'company', write: true, audit: false }, hPayslipDownload);
// company admin
R('dashboard', { auth: 'company' }, hDashboard);
R('search.global', { auth: 'company' }, hSearch);
R('project.list', { perm: 'projects.view' }, hProjectList);
R('project.get', { perm: 'projects.view' }, hProjectGet);
R('project.save', { perm: 'projects.view', write: true }, hProjectSave);
R('project.assign', { perm: 'projects.edit', write: true }, hProjectAssign);
R('project.unassign', { perm: 'projects.edit', write: true }, hProjectUnassign);
R('transfer.request', { perm: 'projects.edit', write: true }, hTransferRequest);
R('transfer.decide', { perm: 'projects.approve', write: true }, hTransferDecide);
R('transfer.list', { perm: 'projects.view' }, hTransferList);
R('people.approvers', { perm: 'projects.view' }, hApprovers);
R('employee.list', { perm: 'employees.view' }, hEmployeeList);
R('employee.get', { perm: 'employees.view' }, hEmployeeGet);
R('employee.save', { perm: 'employees.view', write: true }, hEmployeeSave);
R('employee.setStatus', { perm: 'employees.edit', write: true }, hEmployeeSetStatus);
R('employee.resetAccess', { perm: 'employees.edit', write: true }, hEmployeeResetAccess);
R('employee.doc.upload', { perm: 'employees.edit', write: true }, hEmployeeDocUpload);
R('employee.doc.delete', { perm: 'employees.edit', write: true }, hEmployeeDocDelete);
R('employee.attendance', { perm: 'employees.view' }, hEmployeeAttendance);
R('employee.leaves', { perm: 'employees.view' }, hEmployeeLeaves);
R('employee.payslips', { perm: 'payroll.view' }, hEmployeePayslips);
R('att.today', { perm: 'attendance.view' }, hAttToday);
R('att.month', { perm: 'attendance.view' }, hAttMonth);
R('att.mark', { perm: 'attendance.edit', write: true }, hAttMark);
R('holiday.save', { perm: 'attendance.edit', write: true, module: 'attendance' }, hHolidaySave);
R('holiday.delete', { perm: 'attendance.edit', write: true, module: 'attendance' }, hHolidayDelete);
R('leave.list', { perm: 'leave.view' }, hLeaveList);
R('leave.decide', { perm: 'leave.approve', write: true }, hLeaveDecide);
R('leave.balances', { perm: 'leave.view' }, hLeaveBalances);
R('leave.adjust', { perm: 'leave.edit', write: true }, hLeaveAdjust);
R('special.list', { perm: 'leave.view' }, hSpecialList);
R('special.decide', { perm: 'leave.approve', write: true, module: 'leave' }, hSpecialDecide);
R('payroll.precheck', { perm: 'payroll.view' }, hPayrollPrecheck);
R('payroll.run', { perm: 'payroll.view' }, hPayrollRun);
R('payroll.runs', { perm: 'payroll.view' }, hPayrollRuns);
R('payroll.calculate', { perm: 'payroll.create', write: true }, hPayrollCalculate);
R('payroll.item.get', { perm: 'payroll.view' }, hPayrollItemGet);
R('payroll.item.update', { perm: 'payroll.edit', write: true }, hPayrollItemUpdate);
R('payroll.approve', { perm: 'payroll.approve', write: true }, hPayrollApprove);
R('payroll.markPaid', { perm: 'payroll.approve', write: true }, hPayrollMarkPaid);
R('payroll.payslips.generate', { perm: 'payroll.edit', write: true }, hPayslipsGenerate);
R('expense.list', { perm: 'expenses.view' }, hExpenseList);
R('expense.decide', { perm: 'expenses.approve', write: true }, hExpenseDecide);
R('report.run', { perm: 'reports.view' }, hReport);
R('doc.list', { perm: 'documents.view' }, hDocList);
R('doc.upload', { perm: 'documents.create', write: true }, hDocUpload);
R('doc.delete', { perm: 'documents.edit', write: true }, hDocDelete);
R('settings.get', { perm: 'settings.view' }, hSettingsGet);
R('settings.save', { perm: 'settings.edit', write: true }, hSettingsSave);
R('settings.upload', { perm: 'settings.edit', write: true }, hSettingsUpload);
R('role.save', { perm: 'settings.edit', write: true }, hRoleSave);
R('role.create', { perm: 'settings.edit', write: true }, hRoleCreate);
R('leaveType.save', { perm: 'settings.edit', write: true }, hLeaveTypeSave);
R('leaveType.delete', { perm: 'settings.edit', write: true }, hLeaveTypeDelete);
R('expCat.save', { perm: 'settings.edit', write: true }, hExpCatSave);
R('expCat.delete', { perm: 'settings.edit', write: true }, hExpCatDelete);
R('audit.list', { perm: 'audit.view' }, hAuditList);
// employee self-service
R('me.dashboard', { auth: 'self' }, hMeDashboard);
R('me.projects', { auth: 'self' }, hMeProjects);
R('me.attendance', { auth: 'self' }, hMeAttendance);
R('me.requests', { auth: 'self' }, hMeRequests);
R('me.payslips', { auth: 'self' }, hMePayslips);
R('me.payslip.get', { auth: 'self' }, hMePayslipGet);
R('me.documents', { auth: 'self' }, hMeDocuments);
R('me.projectOptions', { auth: 'self' }, hMeProjectOptions);
R('att.punch', { auth: 'self', write: true, module: 'attendance' }, hPunch);
R('leave.apply', { auth: 'self', write: true, module: 'leave' }, hLeaveApply);
R('leave.cancel', { auth: 'self', write: true, module: 'leave' }, hLeaveCancel);
R('special.apply', { auth: 'self', write: true, module: 'leave' }, hSpecialApply);
R('special.cancel', { auth: 'self', write: true, module: 'leave' }, hSpecialCancel);
R('people.search', { auth: 'self' }, hPeopleSearch);
R('expense.submit', { auth: 'self', write: true, module: 'expenses' }, hExpenseSubmit);
R('expense.mine', { auth: 'self' }, hExpenseMine);
R('profile.get', { auth: 'self' }, hProfileGet);
R('profile.save', { auth: 'self', write: true, module: 'profile' }, hProfileSave);
R('profile.photo', { auth: 'self', write: true, module: 'profile' }, hProfilePhoto);

/* ============================== 22. API ENTRY ============================== */
function apiImpl(action, token, payload) {
  try {
    action = String(action || '');
    var route = ROUTES[action];
    if (!route) fail('UNKNOWN_ACTION', 'Unknown action.');
    payload = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
    var ctx = { action: action, token: typeof token === 'string' ? token : '', now: nowIso(), today: todayStr(), user: null, cid: '', role: '', employeeId: '', panel: '' };
    if (route.auth !== 'public') { getSS(); authenticate(ctx, ctx.token, route); }
    var run = function () {
      var res = route.fn(ctx, payload);
      if (route.write && route.audit !== false) writeAudit(ctx, route);
      return res;
    };
    var data = route.lock ? withLock(run) : run();
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    if (e && e.isApi) return { ok: false, error: { code: e.code, message: e.message, field: e.extra && e.extra.field ? e.extra.field : '', details: e.extra || null } };
    var ref = Utilities.getUuid().slice(0, 8);
    try { console.error('[' + ref + '] ' + action + ' :: ' + (e && e.stack ? e.stack : e)); } catch (x) { /* ignore */ }
    Logger.log('[' + ref + '] ' + action + ' :: ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server. Please try again. (ref ' + ref + ')' } };
  }
}

/* ============================== 23. SETUP ============================== */
function assertEditor() {
  var a = '', b = '';
  try { a = Session.getActiveUser().getEmail(); b = Session.getEffectiveUser().getEmail(); } catch (e) { /* ignore */ }
  if (!a || a !== b) throw new Error('This function can only be run by the script owner from the Apps Script editor.');
}
function setupImpl() {
  assertEditor();
  var id = PROP.getProperty('SS_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('Astra HR – Database'); PROP.setProperty('SS_ID', ss.getId()); }
  _ss = ss; _sheets = {};
  try { ss.setSpreadsheetTimeZone(TZ); } catch (e2) { /* ignore */ }
  var first = ss.getSheets()[0], created = 0;
  Object.keys(SCHEMA).forEach(function (name) {
    var h = SCHEMA[name], sh = ss.getSheetByName(name);
    if (!sh) {
      if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0 && !ss.getSheetByName('Companies') && name === 'Companies') { first.setName(name); sh = first; }
      else sh = ss.insertSheet(name);
      created++;
    }
    var have = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    if (have.join('|') !== h.join('|')) {
      if (have.filter(String).length === 0 || h.join('|').indexOf(have.join('|')) === 0) sh.getRange(1, 1, 1, h.length).setValues([h]); // fresh sheet or upgrade with added columns
      else throw new Error('Sheet "' + name + '" has unexpected headers. Fix or delete the tab and run setupSystem() again.');
    }
    if (sh.getMaxColumns() < h.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#EEF0F4');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1'); if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  CACHE.removeAll(Object.keys(SCHEMA).map(function (n) { return 'H_' + n; }));
  memoClear();
  if (!PROP.getProperty('ROOT_FOLDER_ID')) { var f = DriveApp.createFolder('Astra HR – Files'); PROP.setProperty('ROOT_FOLDER_ID', f.getId()); }
  var out = { spreadsheetUrl: ss.getUrl(), driveFolderUrl: DriveApp.getFolderById(PROP.getProperty('ROOT_FOLDER_ID')).getUrl() };
  withLock(function () {
    if (!rows('Settings').some(function (r) { return r.companyId === PLATFORM; })) saveSettings(PLATFORM, DEFAULT_PLATFORM);
    var sa = findOne('Users', function (u) { return u.role === SUPER; });
    if (!sa) {
      var email = lc(Session.getEffectiveUser().getEmail()); if (!RX.email.test(email)) email = 'superadmin@example.com';
      var tp = tempPassword(), u = makeUserRow('', '', SUPER, email, email, '', tp, 'Temp');
      insert('Users', u); audit(PLATFORM, 'SYSTEM', 'SYSTEM', 'system', 'setup', u.userId, 'Super Admin created');
      out.superAdminLogin = email; out.superAdminTempPassword = tp;
    } else if (sa.status === 'Temp') {
      var tp2 = tempPassword(), salt = newSalt();
      update('Users', sa, { passwordHash: hashPassword(tp2, salt), salt: salt }); bustUser(sa.userId);
      out.superAdminLogin = sa.loginId; out.superAdminTempPassword = tp2;
    } else out.superAdminLogin = sa.loginId;
  });
  Logger.log('================ ASTRA HR SETUP COMPLETE ================');
  Logger.log('Spreadsheet  : ' + out.spreadsheetUrl);
  Logger.log('Drive folder : ' + out.driveFolderUrl);
  Logger.log('Super Admin  : ' + out.superAdminLogin);
  if (out.superAdminTempPassword) Logger.log('TEMP PASSWORD : ' + out.superAdminTempPassword + '   (you must change it at first login)');
  else Logger.log('Super Admin password was already changed – not shown.');
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Access: Anyone) and open the URL.');
  return out;
}

/* ============================== 24. DEMO DATA ============================== */
function seedImpl() {
  assertEditor();
  if (!PROP.getProperty('SS_ID')) throw new Error('Run setupSystem() first.');
  var report = {};
  withLock(function () {
    if (findOne('Companies', function (c) { return c.gstin === '29AABCD1234E1Z5'; })) { Logger.log('Demo company already exists – nothing to do.'); report.skipped = true; return; }
    var PW = 'Demo@1234', today = todayStr(), ym = today.slice(0, 7), prevYm = addMonths(ym, -1);
    var cid = newId('CMP', 'company', 4);
    insert('Companies', { companyId: cid, companyName: 'Bharat Build Co', legalName: 'Bharat Build Constructions Pvt Ltd', gstin: '29AABCD1234E1Z5', pan: 'AABCD1234E', email: 'demo@astra-demo.com', phone: '9800000000', address: '14, MG Road, Bengaluru, Karnataka 560001', contactPerson: 'Rohan Mehta', status: 'Pending', createdAt: nowIso() });
    var adm = makeUserRow(cid, '', 'ADMIN', 'demo@astra-demo.com', 'demo@astra-demo.com', '9800000000', PW, 'Pending'); insert('Users', adm);
    approveCompanyInternal(cid, 'SYSTEM', 'Demo company');
    var ctx = { action: 'seed', now: nowIso(), today: today, cid: cid, role: 'ADMIN', employeeId: '', panel: 'admin', user: { userId: adm.userId } };
    saveSettings(cid, { brandColor: '#0F766E' });
    [['-14', 'Founders Day']].forEach(function (h) { var d = addDays(monthStart(prevYm), 13); if (!weeklyOffMap(cid)[dow(d)]) hHolidaySave(ctx, { date: d, name: h[1] }); });
    hHolidaySave(ctx, { date: '2026-10-02', name: 'Gandhi Jayanti' }); hHolidaySave(ctx, { date: '2026-11-09', name: 'Diwali' }); hHolidaySave(ctx, { date: '2026-12-25', name: 'Christmas' });
    var hq = hProjectSave(ctx, { type: 'office', name: 'Head Office – MG Road', clientName: 'Internal', address: '14, MG Road, Bengaluru', lat: 12.9756, lng: 77.6066, geofenceRadiusM: 100 }).projectId;
    var site = hProjectSave(ctx, { type: 'site', name: 'Whitefield Tower Site', clientName: 'Skyline Developers', address: 'ITPL Main Road, Whitefield, Bengaluru', lat: 12.9698, lng: 77.75, geofenceRadiusM: 75 }).projectId;
    var people = [
      ['Anita Sharma', '9876500001', 'HR Manager', 'Human Resources', 'HR', 55000, 22000, 13000, hq],
      ['Vikram Rao', '9876500002', 'Site Engineer', 'Engineering', 'MANAGER', 48000, 19200, 10800, site],
      ['Suresh Kumar', '9876500003', 'Supervisor', 'Operations', 'EMPLOYEE', 32000, 12800, 7200, site],
      ['Priya Nair', '9876500004', 'Accountant', 'Finance', 'EMPLOYEE', 38000, 15200, 8800, hq],
      ['Imran Khan', '9876500005', 'Electrician', 'Operations', 'EMPLOYEE', 18000, 7200, 3800, site],
      ['Deepa Iyer', '9876500006', 'Architect', 'Design', 'EMPLOYEE', 62000, 24800, 13200, hq],
      ['Rahul Verma', '9876500007', 'Helper', 'Operations', 'EMPLOYEE', 14000, 5600, 2400, site],
      ['Neha Gupta', '9876500008', 'Office Assistant', 'Administration', 'EMPLOYEE', 20000, 8000, 4000, hq]
    ];
    var emps = [], totalDays = 400;
    people.forEach(function (x, i) {
      var doj = i === 7 ? addDays(monthStart(prevYm), 9) : addDays(today, -totalDays + i * 20);
      var r = hEmployeeSave(ctx, { fullName: x[0], phone: x[1], email: x[0].split(' ')[0].toLowerCase() + '@astra-demo.com', designation: x[2], department: x[3], doj: doj, employmentType: 'Full-time', roleId: x[4], bankName: 'HDFC Bank', accountNo: '5010' + (1000000 + i * 1111), ifsc: 'HDFC0001234', panNumber: 'ABCDE' + (1000 + i) + 'F', uan: i % 3 === 2 ? '' : '1012345678' + pad(i, 2), esicNo: x[5] <= 21000 ? '31000123450000' + pad(i, 3) : '', gender: i % 2 ? 'Male' : 'Female', dob: '1990-0' + (1 + i) + '-15', address: 'Bengaluru', salary: { effectiveFrom: doj, basic: x[6], hra: x[7], specialAllowance: x[5] - x[6] - x[7] } });
      var u = userForEmployee(r.employeeId), salt = newSalt();
      update('Users', u, { passwordHash: hashPassword(PW, salt), salt: salt, status: 'Active' });
      emps.push({ id: r.employeeId, doj: doj, project: x[8], name: x[0], phone: x[1] });
    });
    hProjectAssign(ctx, { projectId: hq, employeeIds: emps.filter(function (e) { return e.project === hq; }).map(function (e) { return e.id; }) });
    hProjectAssign(ctx, { projectId: site, employeeIds: emps.filter(function (e) { return e.project === site; }).map(function (e) { return e.id; }) });
    // back-date the assignments so project history / days-worked look realistic
    var dojMap = idx(emps.map(function (e) { return { id: e.id, doj: e.doj }; }), 'id');
    updateMany('ProjectAssignments', where('ProjectAssignments', function (a) { return dojMap[a.employeeId]; }).map(function (a) { var d = dojMap[a.employeeId].doj, m = monthStart(prevYm); return { _row: a._row, startDate: d > m ? d : m }; }));
    // leaves (approved sick leave in previous month; pending casual leave upcoming)
    var leaveDay = addDays(monthStart(prevYm), 19), lctx = function (empIdx) { var c = {}; for (var k in ctx) c[k] = ctx[k]; c.employeeId = emps[empIdx].id; return c; };
    var skip = {}; skip[emps[2].id] = {}; skip[emps[2].id][leaveDay] = 1; skip[emps[2].id][addDays(leaveDay, 1)] = 1;
    saveSettings(cid, { backdatedLeaveDays: '90' });
    var lr = hLeaveApply(lctx(2), { leaveType: 'Sick Leave', fromDate: leaveDay, toDate: addDays(leaveDay, 1), reason: 'Fever and rest advised by doctor' });
    saveSettings(cid, { backdatedLeaveDays: '7' });
    // attendance history
    var attRows = [], from = monthStart(prevYm), hol = holidayMap(cid), wo = weeklyOffMap(cid);
    emps.forEach(function (e, i) {
      var pr = projectsOf(cid).byId[e.project];
      for (var d = from; d < today; d = addDays(d, 1)) {
        if (d < e.doj || wo[dow(d)] || hol[d] !== undefined || (skip[e.id] && skip[e.id][d])) continue;
        var dn = +d.slice(8, 10), h = (dn * 7 + i * 13) % 23, st, inM = 5 + (dn % 12), mins;
        if (h === 0) continue;
        if (h === 1 || h === 2) { st = 'Late'; inM = 50 + (dn % 9); mins = 470; } else if (h === 3) { st = 'Half Day'; inM = 8; mins = 230; } else { st = 'Present'; mins = 520 + (dn % 30); }
        var inIso = d + 'T09:' + pad(inM, 2) + ':00+05:30', outTot = 9 * 60 + inM + mins, outIso = d + 'T' + pad(Math.floor(outTot / 60), 2) + ':' + pad(outTot % 60, 2) + ':00+05:30';
        attRows.push({ employeeId: e.id, projectId: e.project, date: d, punchInAt: inIso, inLat: pr.lat + (dn % 5) * 0.00002, inLng: pr.lng + (i % 4) * 0.00002, inDistanceM: 5 + (dn * 3 + i) % 40, punchOutAt: outIso, outLat: pr.lat, outLng: pr.lng, workMinutes: mins, status: st, source: 'GPS' });
      }
    });
    var ids = newIds('ATT', 'attendance', attRows.length, 8);
    attRows.forEach(function (r, k) { r.attendanceId = ids[k]; });
    insert('Attendance', attRows);
    // today: half the team has punched in
    var todayRows = [];
    if (!wo[dow(today)] && hol[today] === undefined) emps.slice(0, 5).forEach(function (e, i) { var pr = projectsOf(cid).byId[e.project]; todayRows.push({ employeeId: e.id, projectId: e.project, date: today, punchInAt: today + 'T09:' + pad(2 + i * 4, 2) + ':00+05:30', inLat: pr.lat, inLng: pr.lng, inDistanceM: 10 + i * 6, punchOutAt: '', outLat: 0, outLng: 0, workMinutes: 0, status: 'Open', source: 'GPS' }); });
    var tids = todayRows.length ? newIds('ATT', 'attendance', todayRows.length, 8) : []; todayRows.forEach(function (r, k) { r.attendanceId = tids[k]; }); insert('Attendance', todayRows);
    hLeaveDecide(ctx, { requestId: lr.requestId, decision: 'Approved', remark: 'Get well soon' });
    // pending requests for the admin inbox
    var up = addDays(today, 3); while (wo[dow(up)] || hol[up] !== undefined) up = addDays(up, 1);
    hLeaveApply(lctx(3), { leaveType: 'Casual Leave', fromDate: up, toDate: up, reason: 'Family function' });
    hSpecialApply(lctx(1), { fromDate: today, toDate: addDays(today, 1), toProjectId: hq, reason: 'Material procurement meeting at head office', taggedPersonId: emps[0].id });
    // payroll for previous month -> approved + paid, with payslips
    var pc = hPayrollCalculate(ctx, { month: prevYm });
    hPayrollApprove(ctx, { runId: pc.runId, all: true }); hPayrollMarkPaid(ctx, { runId: pc.runId, all: true });
    try { hPayslipsGenerate(ctx, { runId: pc.runId, all: true }); } catch (e3) { Logger.log('Payslip PDF generation skipped: ' + e3.message); }
    // expense claims after payroll so they feed the NEXT run
    var cats = ['Fuel', 'Travel', 'Food'], claimIds = newIds('CLM', 'claim', 3, 6);
    insert('ExpenseClaims', [
      { claimId: claimIds[0], employeeId: emps[1].id, projectId: site, category: 'Fuel', expenseDate: addDays(today, -6), amount: 850, reason: 'Fuel for site visits', billFileId: '', status: 'Approved', decidedBy: adm.userId, payrollRunId: '' },
      { claimId: claimIds[1], employeeId: emps[2].id, projectId: site, category: 'Travel', expenseDate: addDays(today, -2), amount: 1200, reason: 'Cab to vendor warehouse', billFileId: '', status: 'Pending', decidedBy: '', payrollRunId: '' },
      { claimId: claimIds[2], employeeId: emps[3].id, projectId: hq, category: cats[2], expenseDate: addDays(today, -4), amount: 640, reason: 'Client lunch', billFileId: '', status: 'Rejected', decidedBy: adm.userId, payrollRunId: '' }
    ]);
    insert('Decisions', [{ entityId: claimIds[0], companyId: cid, decision: 'Approved', remark: 'Bill verified', decidedBy: adm.userId, decidedAt: nowIso() }, { entityId: claimIds[2], companyId: cid, decision: 'Rejected', remark: 'Client entertainment is not reimbursable', decidedBy: adm.userId, decidedAt: nowIso() }]);
    // tickets
    var tid = newId('TKT', 'ticket', 5), eu = userForEmployee(emps[4].id);
    insert('Tickets', { ticketId: tid, companyId: cid, raisedBy: eu.userId, raisedByRole: 'EMPLOYEE', subject: 'Payslip shows wrong bank account', description: 'Last 4 digits of my account look incorrect on the payslip.', status: 'Open', assignedTo: 'COMPANY', createdAt: nowIso() });
    var tid2 = newId('TKT', 'ticket', 5);
    insert('Tickets', { ticketId: tid2, companyId: cid, raisedBy: adm.userId, raisedByRole: 'ADMIN', subject: 'Need help importing holiday calendar', description: 'Can the platform team pre-load the 2027 holiday list?', status: 'Open', assignedTo: 'SUPER_ADMIN', createdAt: nowIso() });
    audit(cid, 'SYSTEM', 'SYSTEM', 'system', 'seedDemoData', cid, 'Demo data created');
    report = { company: 'Bharat Build Co', adminLogin: 'demo@astra-demo.com', employeeLogins: emps.map(function (e) { return e.phone; }), password: PW };
    Logger.log('================ DEMO DATA READY ================');
    Logger.log('Company admin : demo@astra-demo.com  /  ' + PW + '   (login tab: Company)');
    Logger.log('HR manager    : 9876500001 / ' + PW + '   Site manager: 9876500002 / ' + PW);
    Logger.log('Employees     : 9876500003 … 9876500008 / ' + PW + '   (login tab: Employee)');
    Logger.log('Punching needs GPS within the project radius – Head Office (12.9756, 77.6066, 100 m) / Whitefield Site (12.9698, 77.7500, 75 m).');
  });
  return report;
}

return {
  api: apiImpl, setup: setupImpl, seed: seedImpl,
  platformName: function () { try { return settingsFor(PLATFORM).platformName || DEFAULT_APP_NAME; } catch (e) { return DEFAULT_APP_NAME; } },
  __test: { memoClear: memoClear }
};
})();

/* ============================== PUBLIC GLOBALS ============================== */
/** Serves the single-page app. */
function doGet(e) {
  var title = 'Astra HR';
  try { if (PropertiesService.getScriptProperties().getProperty('SS_ID')) title = APP.platformName(); } catch (err) { /* ignore */ }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/** The ONLY function the client calls (google.script.run.api). */
function api(action, token, payload) { return APP.api(action, token, payload); }
/** Run ONCE from the Apps Script editor. */
function setupSystem() { return APP.setup(); }
/** Optional: run from the editor to load a demo company with realistic data. */
function seedDemoData() { return APP.seed(); }
