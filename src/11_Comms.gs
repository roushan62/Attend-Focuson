/**
 * FocusOn HRMS 2.0 — Communication (11_Comms.gs)
 * Helpdesk tickets, announcements, in-app notifications.
 */

var TICKET_HEADERS = ['ticketId', 'empId', 'category', 'subject', 'description', 'priority', 'status', 'handlerRole', 'handlerId', 'createdAt', 'updatedAt'];
var TICKET_COMMENT_HEADERS = ['commentId', 'ticketId', 'userId', 'comment', 'createdAt'];
var ANNOUNCE_HEADERS = ['announceId', 'title', 'message', 'audience', 'audienceValue', 'pin', 'expiry', 'ackRequired', 'createdBy', 'createdAt'];
var ANNOUNCE_ACK_HEADERS = ['ackId', 'announceId', 'empId', 'acknowledgedAt'];

// ---------- Helpdesk ----------

function helpdesk_tickets_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'helpdesk.raise', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'Tickets').rows.filter(function (r) { return r.deleted !== '1'; });
  var empId = _findEmployeeByUserId(boot.user.userId);
  var scope = _userScope(boot.user);
  rows = rows.filter(function (r) {
    if (scope === 'S') return String(r.empId) === String(empId);
    if (scope === 'D') return r.managerId === boot.user.userId || String(r.empId) === String(empId);
    if (scope === 'T') return _teamMemberIds(boot.user.userId).indexOf(r.empId) >= 0;
    return true;
  });
  return _result(true, { rows: rows });
}
function helpdesk_raise_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!empId) throw _error(ERR.NOT_FOUND, 'Employee not found.');
  var category = payload.category || 'General';
  var handlerRole = { Payroll: 'ACCOUNTS', Attendance: 'HR', Leave: 'HR', IT: 'ADMIN', Admin: 'ADMIN', General: 'HR' }[category] || 'HR';
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Tickets');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, TICKET_HEADERS.length).setValues([TICKET_HEADERS]);
  var now = _nowStr();
  _appendRows(sheet, [[_uid(), empId, category, payload.subject || '', payload.description || '', payload.priority || 'Medium', 'Open', handlerRole, '', now, now]]);
  delete _rowCache[_sheetKey(db, 'Tickets')];
  _notify(empId, 'Your helpdesk ticket (' + category + ') has been raised.', 'helpdesk');
  _flushNotifications();
  return _result(true, { message: 'Ticket raised.' });
}
function helpdesk_comments_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'TicketComments');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, TICKET_COMMENT_HEADERS.length).setValues([TICKET_COMMENT_HEADERS]);
  _appendRows(sheet, [[_uid(), payload.ticketId, boot.user.userId, payload.comment || '', _nowStr()]]);
  delete _rowCache[_sheetKey(db, 'TicketComments')];
  return _result(true, { message: 'Comment added.' });
}

// ---------- Announcements ----------

function announce_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'announce.send', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var now = _todayStr();
  var rows = _readSheet(_openCoreDb(), 'Announcements').rows.filter(function (r) {
    return r.deleted !== '1' && (!r.expiry || r.expiry >= now);
  });
  var empId = _findEmployeeByUserId(boot.user.userId);
  var out = [];
  rows.forEach(function (r) {
    var aud = r.audience || 'all';
    var show = false;
    if (aud === 'all') show = true;
    if (aud === 'department' && r.audienceValue === _getUserDept(boot.user)) show = true;
    if (aud === 'branch' && r.audienceValue === _getUserBranch(boot.user)) show = true;
    if (aud === 'role' && r.audienceValue === boot.user.role) show = true;
    if (show) out.push(r);
  });
  return _result(true, { rows: out });
}
function announce_send_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'announce.send', 'company')) throw _error(ERR.FORBIDDEN, 'HR/Admin only.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Announcements');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, ANNOUNCE_HEADERS.length).setValues([ANNOUNCE_HEADERS]);
  var now = _nowStr();
  _appendRows(sheet, [[_uid(), payload.title || '', payload.message || '', payload.audience || 'all', payload.audienceValue || '', payload.pin || '0', payload.expiry || '', payload.ackRequired || '0', boot.user.userId, now]]);
  delete _rowCache[_sheetKey(db, 'Announcements')];
  _audit(boot.user.userId, 'announce.send', 'Announcements', 'announce', {}, { title: payload.title });
  return _result(true, { message: 'Announcement sent.' });
}
function announce_ack_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = _findEmployeeByUserId(boot.user.userId);
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'AnnouncementAcks');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, ANNOUNCE_ACK_HEADERS.length).setValues([ANNOUNCE_ACK_HEADERS]);
  // avoid duplicate
  var rows = _readSheet(db, 'AnnouncementAcks').rows;
  for (var i = 0; i < rows.length; i++) if (rows[i].announceId === payload.announceId && rows[i].empId === empId) return _result(true, { acknowledged: true });
  _appendRows(sheet, [[_uid(), payload.announceId, empId, _nowStr()]]);
  delete _rowCache[_sheetKey(db, 'AnnouncementAcks')];
  return _result(true, { acknowledged: true });
}

// ---------- Notifications list ----------

function notif_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var rows = _readSheet(_openCoreDb(), 'Notifications').rows.filter(function (r) { return String(r.userId) === String(boot.user.userId) && r.deleted !== '1'; });
  rows.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  var unread = 0;
  rows.forEach(function (r) { if (r.isRead === '0') unread++; });
  return _result(true, { items: rows.slice(0, 50), unread: unread });
}
function notif_read_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Notifications');
  var rows = _readSheet(db, 'Notifications').rows;
  var hdrs = _readSheet(db, 'Notifications').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  if (payload.all === '1') {
    rows.forEach(function (r, i) {
      if (String(r.userId) === String(boot.user.userId) && r.isRead === '0') sheet.getRange(i + 2, col['isRead'], 1, 1).setValue('1');
    });
  } else if (payload.notifId) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].notifId) === String(payload.notifId)) { sheet.getRange(i + 2, col['isRead'], 1, 1).setValue('1'); break; }
    }
  }
  delete _rowCache[_sheetKey(db, 'Notifications')];
  return _result(true, { ok: true });
}
