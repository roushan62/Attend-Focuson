/**
 * FocusOn HRMS 2.0 — Leave (08_Leave.gs)
 * Leave types, applications, balances, ledger, accrual, year-end carry/lapse, encashment.
 */

var LV_TYPE_HEADERS = ['typeId', 'name', 'paid', 'yearlyQuota', 'accrual', 'prorate',
  'carryForward', 'carryMax', 'encashable', 'encashMax', 'halfDay', 'sandwich',
  'minNotice', 'maxDays', 'docAfterDays', 'gender', 'probationAllowed', 'negativeAllowed', 'color', 'active'];
var LV_APP_HEADERS = ['appId', 'empId', 'typeId', 'fromDate', 'toDate', 'days', 'halfDay', 'half',
  'reason', 'attachment', 'status', 'currentStep', 'createdBy', 'createdAt', 'updatedAt'];
var LV_BAL_HEADERS = ['empId', 'typeId', 'year', 'opening', 'accrued', 'used', 'adjusted', 'encashed', 'lapsed', 'updatedAt'];
var LV_LED_HEADERS = ['ledgerId', 'empId', 'typeId', 'year', 'date', 'txnType', 'days', 'refId', 'remark', 'balanceAfter', 'createdBy', 'createdAt'];

// ---------- Leave types ----------

function lv_typelist_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'leave.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'LeaveTypes').rows.filter(function (r) { return r.active !== '0'; });
  return _result(true, { rows: rows });
}
function lv_typesave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'leave.policy.configure', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  return _masterSave('LeaveTypes', LV_TYPE_HEADERS, 'typeId', payload, 'lv.type.save');
}
function lv_typedelete_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'leave.policy.configure', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  return _softDeleteOn('LeaveTypes', 'typeId', payload.typeId);
}

// ---------- Apply leave (creates a workflow request) ----------

function lv_apply_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!empId) throw _error(ERR.NOT_FOUND, 'Employee record not found.');
  var isSelf = (empId === _findEmployeeByUserId(boot.user.userId));
  if (!isSelf && !_can(boot.user, 'leave.apply', 'company')) throw _error(ERR.FORBIDDEN, 'Cannot apply for others.');
  var typeId = payload.typeId;
  var from = payload.fromDate, to = payload.toDate;
  var days = Number(payload.days || 0);
  var halfDay = payload.halfDay === '1' || payload.halfDay === true;
  var half = payload.half || '';
  var reason = payload.reason || '';
  var attachment = payload.attachment || '';
  // validate type
  var type = _getLeaveType(typeId);
  if (!type) throw _error(ERR.NOT_FOUND, 'Leave type not found.');
  if (!type.probationAllowed === '1') {
    var emp = _findEmployeeById(empId);
    if (emp && emp.confirmed !== '1') throw _error(ERR.FORBIDDEN, 'Not allowed during probation.');
  }
  if (halfDay && type.halfDay !== '1') throw _error(ERR.VALIDATION, 'Half-day not allowed for this leave type.');
  if (days > Number(type.maxDays || 999)) throw _error(ERR.VALIDATION, 'Exceeds max days (' + type.maxDays + ') for this type.');
  // balance check
  var year = _leaveYear(from);
  var bal = _getBalance(empId, typeId, year);
  var available = Number(bal.opening || 0) + Number(bal.accrued || 0) - Number(bal.used || 0) - Number(bal.adjusted || 0) - Number(bal.encashed || 0) - Number(bal.lapsed || 0);
  if (!type.negativeAllowed === '1' && days > available + 0.0001) throw _error(ERR.VALIDATION, 'Insufficient ' + type.name + ' balance (' + available.toFixed(1) + ' days left).');
  // create workflow request
  var data = {
    typeId: typeId, typeName: type.name, fromDate: from, toDate: to, days: days,
    halfDay: halfDay ? '1' : '0', half: half, reason: reason, attachment: attachment, leaveDays: days
  };
  return wf_create_({ token: payload.token, type: 'LEAVE', empId: empId, data: data });
}
function _getLeaveType(typeId) {
  var rows = _readSheet(_openCoreDb(), 'LeaveTypes').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].typeId) === String(typeId)) return rows[i];
  return null;
}
function _leaveYear(dateStr) {
  var d = _parseDate(dateStr);
  if (!d) return new Date().getFullYear();
  var m = d.getMonth() + 1;
  var y = d.getFullYear();
  return m >= LEAVE_YEAR_START.month ? y : y - 1;
}

// ---------- Balances ----------

function lv_balances_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'leave.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var empId = payload.empId;
  var year = payload.year || _leaveYear(_todayStr());
  var scope = _userScope(boot.user);
  if (empId && !_inScopeEmpById(empId, boot.user, scope)) throw _error(ERR.FORBIDDEN, 'Not in your scope.');
  if (!empId) empId = _findEmployeeByUserId(boot.user.userId);
  var rows = _readSheet(_openCoreDb(), 'LeaveBalances').rows.filter(function (r) {
    return r.empId === empId && String(r.year) === String(year);
  });
  var types = {};
  _readSheet(_openCoreDb(), 'LeaveTypes').rows.forEach(function (t) { types[t.typeId] = t; });
  var out = rows.map(function (r) {
    var t = types[r.typeId] || {};
    var used = Number(r.used || 0);
    var avail = Number(r.opening || 0) + Number(r.accrued || 0) - used - Number(r.adjusted || 0) - Number(r.encashed || 0) - Number(r.lapsed || 0);
    return { typeId: r.typeId, typeName: t.name || '', year: r.year, opening: Number(r.opening || 0), accrued: Number(r.accrued || 0), used: used, adjusted: Number(r.adjusted || 0), encashed: Number(r.encashed || 0), lapsed: Number(r.lapsed || 0), available: Math.max(0, avail), color: t.color || '' };
  });
  return _result(true, { empId: empId, year: year, rows: out });
}
function _getBalance(empId, typeId, year) {
  var rows = _readSheet(_openCoreDb(), 'LeaveBalances').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].empId === empId && rows[i].typeId === typeId && String(rows[i].year) === String(year)) return rows[i];
  }
  return { empId: empId, typeId: typeId, year: year, opening: 0, accrued: 0, used: 0, adjusted: 0, encashed: 0, lapsed: 0 };
}
function _inScopeEmpById(empId, user, scope) {
  var emp = _findEmployeeById(empId);
  if (!emp) return false;
  return _inScopeEmp(emp, user, scope);
}

// ---------- Ledger entry ----------

function _ledger(empId, typeId, year, txnType, days, refId, remark, createdBy) {
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'LeaveLedger');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, LV_LED_HEADERS.length).setValues([LV_LED_HEADERS]);
  var bal = _getBalance(empId, typeId, year);
  var after = Number(bal.opening || 0) + Number(bal.accrued || 0) - Number(bal.used || 0) - Number(bal.adjusted || 0) - Number(bal.encashed || 0) - Number(bal.lapsed || 0);
  if (txnType === 'USE') after = after - Number(days);
  if (txnType === 'ACCURE') after = after + Number(days);
  if (txnType === 'ADJUST') after = after + Number(days);
  if (txnType === 'ENCASH') after = after - Number(days);
  if (txnType === 'LAPSE') after = after - Number(days);
  _appendRows(sheet, [[_uid(), empId, typeId, year, _todayStr(), txnType, days, refId || '', remark || '', after.toFixed(2), createdBy || 'system', _nowStr()]]);
  delete _rowCache[_sheetKey(db, 'LeaveLedger')];
}

// ---------- Approve leave (updates balance + ledger) ----------

function lv_approve_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var app = wf_action_({ token: payload.token, reqId: payload.reqId, action: payload.action, comment: payload.comment });
  if (!app.ok) return app;
  if (payload.action !== 'approve') return app;
  var db = _openCoreDb();
  var rows = _readSheet(db, 'Requests').rows;
  var req = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].reqId) === String(payload.reqId)) { req = rows[i]; break; }
  if (!req || req.status !== 'Approved') return app;
  var data = JSON.parse(req.data || '{}');
  var empId = req.empId;
  var year = _leaveYear(data.fromDate);
  var typeId = data.typeId;
  // ensure balance row exists
  _ensureBalance(empId, typeId, year);
  // deduct
  var sheet = _getOrCreateSheet(db, 'LeaveBalances');
  var browses = _readSheet(db, 'LeaveBalances').rows;
  var hdrs = _readSheet(db, 'LeaveBalances').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var rowNum = -1;
  for (var i = 0; i < browses.length; i++) {
    if (browses[i].empId === empId && browses[i].typeId === typeId && String(browses[i].year) === String(year)) { rowNum = i + 2; break; }
  }
  if (rowNum > 0) {
    var used = Number(browses[rowNum - 2].used || 0) + Number(data.days || 0);
    sheet.getRange(rowNum, col['used'], 1, 1).setValue(used);
    sheet.getRange(rowNum, col['updatedAt'], 1, 1).setValue(_nowStr());
    delete _rowCache[_sheetKey(db, 'LeaveBalances')];
  }
  _ledger(empId, typeId, year, 'USE', Number(data.days || 0), req.reqId, 'Leave approved: ' + data.typeName, boot.user.userId);
  _notify(empId, 'Your ' + data.typeName + ' leave (' + data.fromDate + ' to ' + data.toDate + ') has been approved.', 'leave');
  _flushNotifications();
  _flushAudit();
  return _result(true, { status: 'Approved', balanceDeducted: Number(data.days || 0) });
}
function _ensureBalance(empId, typeId, year) {
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'LeaveBalances');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, LV_BAL_HEADERS.length).setValues([LV_BAL_HEADERS]);
  var rows = _readSheet(db, 'LeaveBalances').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].empId === empId && rows[i].typeId === typeId && String(rows[i].year) === String(year)) return;
  }
  var type = _getLeaveType(typeId);
  var opening = type ? Number(type.yearlyQuota || 0) : 0;
  _appendRows(sheet, [[_uid(), empId, typeId, year, opening, 0, 0, 0, 0, 0, '', _nowStr(), '0']]);
  delete _rowCache[_sheetKey(db, 'LeaveBalances')];
}

// ---------- Accrual (monthly cron) ----------

function cron_leaveaccrual_() {
  var now = new Date();
  if (now.getDate() !== 1) return { accrued: 0 }; // run on 1st
  var year = _leaveYear(_todayStr());
  var types = _readSheet(_openCoreDb(), 'LeaveTypes').rows;
  var emps = _readSheet(_openCoreDb(), 'Employees').rows.filter(function (r) { return r.deleted !== '1' && r.status === 'Active'; });
  var count = 0;
  emps.forEach(function (emp) {
    types.forEach(function (type) {
      if (type.accrual !== 'monthly') return;
      var qty = Number(type.yearlyQuota || 0) / 12;
      var db = _openCoreDb();
      _ensureBalance(emp.empId, type.typeId, year);
      var sheet = _getOrCreateSheet(db, 'LeaveBalances');
      var browses = _readSheet(db, 'LeaveBalances').rows;
      var hdrs = _readSheet(db, 'LeaveBalances').headers;
      var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
      var rn = -1;
      for (var i = 0; i < browses.length; i++) {
        if (browses[i].empId === emp.empId && browses[i].typeId === type.typeId && String(browses[i].year) === String(year)) { rn = i + 2; break; }
      }
      if (rn > 0) {
        var cur = Number(browses[rn - 2].accrued || 0);
        sheet.getRange(rn, col['accrued'], 1, 1).setValue(cur + qty);
        sheet.getRange(rn, col['updatedAt'], 1, 1).setValue(_nowStr());
        delete _rowCache[_sheetKey(db, 'LeaveBalances')];
        _ledger(emp.empId, type.typeId, year, 'ACCURE', qty, '', 'Monthly accrual: ' + type.name, 'system');
        count++;
      }
    });
  });
  if (count) { _flushAudit(); }
  return { accrued: count, month: _todayStr() };
}

// ---------- Year-end processing ----------

function lv_yearend_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'leave.yearend', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin / HR only.');
  var year = payload.year || (new Date().getFullYear() - 1);
  var carry = payload.carry === '1';
  var rows = _readSheet(_openCoreDb(), 'LeaveBalances').rows.filter(function (r) { return String(r.year) === String(year); });
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'LeaveBalances');
  var hdrs = _readSheet(db, 'LeaveBalances').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var processed = 0;
  rows.forEach(function (r, i) {
    var used = Number(r.used || 0);
    var opening = Number(r.opening || 0);
    var accrued = Number(r.accrued || 0);
    var available = opening + accrued - used - Number(r.adjusted || 0) - Number(r.encashed || 0) - Number(r.lapsed || 0);
    var type = _getLeaveType(r.typeId);
    var carryMax = type ? Number(type.carryMax || 0) : 0;
    var carryDays = carry && carryMax > 0 ? Math.min(available, carryMax) : 0;
    var lapseDays = carry ? Math.max(0, available - carryDays) : available;
    // update current row
    var rn = i + 2;
    sheet.getRange(rn, col['lapsed'], 1, 1).setValue(lapseDays);
    sheet.getRange(rn, col['updatedAt'], 1, 1).setValue(_nowStr());
    // create next-year balance row with carry
    var nextYear = Number(year) + 1;
    var exists = false;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].empId === r.empId && rows[j].typeId === r.typeId && String(rows[j].year) === String(nextYear)) { exists = true; break; }
    }
    if (!exists && carryDays > 0) {
      _appendRows(sheet, [[_uid(), r.empId, r.typeId, nextYear, carryDays, 0, 0, 0, 0, 0, '', _nowStr(), '0']]);
    }
    _ledger(r.empId, r.typeId, year, carryDays > 0 ? 'CARRY' : 'LAPSE', lapseDays, 'YE-' + year, 'Year end ' + year, 'system');
    processed++;
  });
  delete _rowCache[_sheetKey(db, 'LeaveBalances')];
  _flushAudit();
  _notify('system', 'Year-end leave processing done for ' + year + '. ' + processed + ' balances processed.', 'system');
  _flushNotifications();
  return _result(true, { year: year, processed: processed, carry: carry });
}

function _softDeleteOn(kind, idCol, id) { return _softDelete(_openCoreDb(), kind, id, idCol); }
