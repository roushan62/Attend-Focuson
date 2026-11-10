/**
 * FocusOn HRMS 2.0 — Core helpers (01_Core.gs)
 * Session, audit, cache, logging, IDs, date/time utilities.
 */

// ---------- Script Properties helpers ----------

function _getProp(key) {
  try { return PropertiesService.getScriptProperties().getProperty(key); } catch (e) { return null; }
}
function _setProp(key, val) {
  if (val === undefined || val === null) { _delProp(key); return; }
  try { PropertiesService.getScriptProperties().setProperty(key, String(val)); } catch (e) { /* quota safe: ignore */ }
}
function _delProp(key) {
  try { PropertiesService.getScriptProperties().deleteProperty(key); } catch (e) { /* ignore */ }
}

// ---------- CacheService helpers (versioned, short TTL) ----------

function _cacheGet(key) {
  try { return CacheService.getScriptCache().get(key); } catch (e) { return null; }
}
function _cacheSet(key, val, ttl) {
  try { CacheService.getScriptCache().put(key, String(val), ttl || 3600); } catch (e) { /* ignore */ }
}
function _cacheDel(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) { /* ignore */ }
}

// ---------- Date / time (Asia/Kolkata) ----------

function _tz() { return Session.getScriptTimeZone(); } // Asia/Kolkata per manifest

function _nowIso() {
  var d = new Date();
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
}
function _todayStr() {
  var d = new Date();
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}
function _nowStr() {
  var d = new Date();
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
}
function _parseDate(str) {
  if (!str) return null;
  var s = String(str);
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function _addDays(dateStr, days) {
  var d = _parseDate(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}
function _daysBetween(a, b) {
  var da = _parseDate(a), db = _parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

// ---------- IDs & counters ----------

var _uidCounter = 0;
function _uid() {
  // time-based unique id, monotonic within an execution
  var now = Date.now();
  _uidCounter = (_uidCounter + 1) % 1000;
  return 'uid_' + now + '_' + String(_uidCounter).padStart(3, '0');
}
function _nextCounter(name) {
  var key = PROP.COUNTER_PREFIX + name;
  var cur = Number(_getProp(key) || 0) + 1;
  _setProp(key, cur);
  return String(cur).padStart(6, '0');
}

// ---------- Errors ----------

function _error(code, message, field) {
  var e = new Error(message || code);
  e.code = code;
  e.field = field || null;
  return e;
}
function _result(ok, data, error) {
  var r = { ok: ok };
  if (data !== undefined) r.data = data;
  if (error) r.error = error;
  return r;
}

// ---------- Audit log (buffered) ----------

var _auditBuffer = [];
function _audit(userId, action, table, recordId, oldVal, newVal, meta) {
  try {
    _auditBuffer.push({
      id: _uid(), userId: userId || '', action: action || '', table: table || '',
      recordId: recordId || '', oldVal: JSON.stringify(oldVal || {}).slice(0, 1000),
      newVal: JSON.stringify(newVal || {}).slice(0, 1000), at: _nowStr(),
      meta: JSON.stringify(meta || {}).slice(0, 500)
    });
  } catch (e) { /* ignore */ }
}
function _flushAudit() {
  if (!_auditBuffer.length) return;
  try {
    var db = _openCoreDb();
    var sheet = _getOrCreateSheet(db, 'AuditLog');
    var rows = _auditBuffer.map(function (a) {
      return [a.id, a.userId, a.action, a.table, a.recordId, a.oldVal, a.newVal, a.at, a.meta];
    });
    _appendRows(sheet, rows);
    _auditBuffer = [];
  } catch (e) { /* keep buffer small; drop on failure to avoid unbounded growth */ if (_auditBuffer.length > 1000) _auditBuffer.splice(0, 500); }
}

// ---------- Notifications (buffered) ----------

var _notifBuffer = [];
function _notify(userId, message, type, link) {
  try {
    _notifBuffer.push({ id: _uid(), userId: userId || '', message: message || '', type: type || 'info', link: link || '', isRead: '0', createdAt: _nowStr() });
  } catch (e) { /* ignore */ }
}
function _flushNotifications() {
  if (!_notifBuffer.length) return;
  try {
    var db = _openCoreDb();
    var sheet = _getOrCreateSheet(db, 'Notifications');
    var rows = _notifBuffer.map(function (n) {
      return [n.id, n.userId, n.message, n.type, n.link, n.isRead, n.createdAt];
    });
    _appendRows(sheet, rows);
    _notifBuffer = [];
  } catch (e) { if (_notifBuffer.length > 1000) _notifBuffer.splice(0, 500); }
}

// ---------- Email (quota-guarded) ----------

var _emailSentToday = 0;
var _emailDate = _todayStr();
function _emailGuardOk() {
  var today = _todayStr();
  if (today !== _emailDate) { _emailDate = today; _emailSentToday = 0; }
  return _emailSentToday < EMAIL.dailyGuard;
}
function _sendEmail(to, subject, body, htmlBody) {
  if (!_emailGuardOk()) return { ok: false, reason: 'quota' };
  try {
    if (htmlBody) MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody });
    else MailApp.sendEmail({ to: to, subject: subject, body: body });
    _emailSentToday++;
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e) }; }
}

// ---------- Boot / session ----------

function _boot(token) {
  var res = { loggedIn: false };
  if (!token) return res;
  var session = _readSheetRows('Sessions', ['token', 'userId', 'expiry', 'createdAt', 'revoked']);
  var now = new Date();
  var found = null;
  for (var i = 0; i < session.length; i++) {
    var s = session[i];
    if (s.token === token && s.revoked === '0' && new Date(s.expiry) > now) { found = s; break; }
  }
  if (!found) return res;
  var user = _getUserById(found.userId);
  if (!user || user.status !== 'Active') return res;
  res.loggedIn = true;
  res.user = user;
  res.panel = user.panel || 'admin';
  res.perms = _effectivePermissions(user.userId);
  res.counts = _dashboardCounts(user);
  res.now = { today: _todayStr(), now: _nowStr() };
  res.company = _getCompanyProfile();
  res.theme = user.theme || 'light';
  return res;
}

function _getUserById(userId) {
  var rows = _readSheetRows('Users', ['userId', 'empCode', 'name', 'email', 'mobile', 'passwordHash', 'salt', 'status', 'role', 'panel', 'theme', 'failedAttempts', 'lockedUntil', 'tempPassword', 'mustChangePassword', 'createdAt']);
  for (var i = 0; i < rows.length; i++) if (rows[i].userId === userId) return rows[i];
  return null;
}
function _getUserByLogin(loginId) {
  var rows = _readSheetRows('Users', ['userId', 'empCode', 'name', 'email', 'mobile', 'passwordHash', 'salt', 'status', 'role', 'panel', 'theme', 'failedAttempts', 'lockedUntil', 'tempPassword', 'mustChangePassword', 'createdAt']);
  var l = String(loginId).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    var u = rows[i];
    if (u.empCode && String(u.empCode).toLowerCase() === l) return u;
    if (u.email && String(u.email).toLowerCase() === l) return u;
    if (u.mobile && String(u.mobile).toLowerCase() === l) return u;
  }
  return null;
}

function _getCompanyProfile() {
  var rows = _readSheetRows('Settings', ['key', 'value', 'type']);
  var kv = {};
  for (var i = 0; i < rows.length; i++) kv[rows[i].key] = rows[i].value;
  return {
    name: kv['company.name'] || APP.companyName,
    legalName: kv['company.legalName'] || '',
    address: kv['company.address'] || '',
    gstin: kv['company.gstin'] || '',
    pan: kv['company.pan'] || '',
    logo: kv['company.logo'] || '',
    signature: kv['company.signature'] || '',
    stamp: kv['company.stamp'] || '',
    primaryColor: kv['company.primaryColor'] || APP.primaryColor,
    rdashLink: kv['integration.rdashLink'] || ''
  };
}

// ---------- Dashboard counts ----------

function _dashboardCounts(user) {
  var counts = { pending: 0, notifications: 0, transfer: 0, leave: 0, special: 0, expense: 0 };
  try {
    var reqs = _readSheetRows('Requests', ['reqId', 'status', 'empId', 'type']);
    var pend = 0;
    for (var i = 0; i < reqs.length; i++) {
      if (reqs[i].status === 'Pending') pend++;
    }
    counts.pending = pend;
    var notifs = _readSheetRows('Notifications', ['notifId', 'userId', 'isRead']);
    var unread = 0;
    for (var i = 0; i < notifs.length; i++) if (notifs[i].userId === user.userId && notifs[i].isRead === '0') unread++;
    counts.notifications = unread;
  } catch (e) { /* ignore */ }
  return counts;
}
