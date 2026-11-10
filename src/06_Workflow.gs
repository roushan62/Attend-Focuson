/**
 * FocusOn HRMS 2.0 — Workflow & Approvals (06_Workflow.gs)
 * Multi-step chains, conditions, SLA, escalation, delegate, send-back, withdraw,
 * unified inbox. 23 request types.
 */

var WF_HEADERS = ['workflowId', 'requestType', 'version', 'steps', 'active', 'createdAt'];
var REQ_HEADERS = ['reqId', 'type', 'empId', 'status', 'data', 'currentStep', 'createdBy', 'createdAt', 'updatedAt'];
var ACT_HEADERS = ['actionId', 'reqId', 'userId', 'action', 'comment', 'at'];

var TYPE_PERM = {
  LEAVE: 'request.leave', LEAVE_CANCEL: 'request.leave', LEAVE_ENCASH: 'request.leaveencash',
  COMP_OFF: 'request.compoff', ATT_REG: 'request.regularize', ATT_EXCEPTION: 'request.regularize',
  ON_DUTY: 'request.onduty', OVERTIME: 'request.overtime', ADVANCE: 'request.advance',
  LOAN: 'request.loan', EXPENSE: 'request.expense', SALARY_REVISION: 'request.salaryrevision',
  JOB_OPENING: 'request.jobopening', OFFER: 'request.offer', RESIGNATION: 'request.resignation',
  FNF: 'request.fnf', DOC_REQUEST: 'request.document', LETTER_APPROVAL: 'request.letter',
  PROFILE_CHANGE: 'request.profilechange', TRANSFER: 'request.transfer',
  PAYROLL_REOPEN: 'request.payrollreopen', ROLE_CHANGE: 'request.rolechange', GENERAL: 'request.general'
};

// ---------- Workflow definitions ----------

function wf_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'workflow.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'Workflows').rows.filter(function (r) { return r.active !== '0'; });
  return _result(true, { rows: rows });
}
function wf_save_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'workflow.define', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin / authority only.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Workflows');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, WF_HEADERS.length).setValues([WF_HEADERS]);
  var rows = _readSheet(db, 'Workflows').rows;
  var hdrs = _readSheet(db, 'Workflows').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = _nowStr();
  var id = payload.workflowId || _uid();
  var type = payload.requestType;
  var steps = payload.steps || []; // [{stepNo, approverType, approverValue, mode, condition, slaHours, escalateTo}]
  var version = 1;
  // bump version for same type
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].requestType) === String(type)) version = Number(rows[i].version || 1) + 1;
  }
  var row = [id, type, version, JSON.stringify(steps), '1', now];
  // check existing
  var found = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].workflowId) === String(id)) { found = i; break; }
  }
  if (found >= 0) {
    sheet.getRange(found + 2, col['steps'], 1, 1).setValue(JSON.stringify(steps));
    sheet.getRange(found + 2, col['version'], 1, 1).setValue(version);
    delete _rowCache[_sheetKey(db, 'Workflows')];
    _audit(boot.user.userId, 'wf.save', 'Workflows', id, {}, { type: type, version: version });
    return _result(true, { id: id, version: version, message: 'Workflow saved.' });
  }
  _appendRows(sheet, [row]);
  delete _rowCache[_sheetKey(db, 'Workflows')];
  _audit(boot.user.userId, 'wf.save', 'Workflows', id, {}, { type: type, version: version });
  return _result(true, { id: id, version: version, message: 'Workflow created.' });
}
function wf_delete_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'workflow.define', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var ok = _softDelete(_openCoreDb(), 'Workflows', payload.workflowId, 'workflowId');
  _audit(boot.user.userId, 'wf.delete', 'Workflows', payload.workflowId, {}, {});
  return _result(true, { deleted: ok });
}
function _getWorkflow(type, version) {
  var rows = _readSheet(_openCoreDb(), 'Workflows').rows;
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].active === '0') continue;
    if (String(rows[i].requestType) !== String(type)) continue;
    if (version && Number(rows[i].version) === version) return JSON.parse(rows[i].steps || '[]');
    if (!best || Number(rows[i].version) > Number(best.version)) best = rows[i];
  }
  return best ? JSON.parse(best.steps || '[]') : [];
}

// ---------- Evaluate next step for a request ----------

function _approverUsersForStep(step, requesterEmpId) {
  // returns list of userIds who can approve this step
  var out = [];
  var type = step.approverType;
  var val = step.approverValue;
  var allUsers = _readSheet(_openCoreDb(), 'Users').rows;
  var byEmp = {};
  allUsers.forEach(function (u) { if (u.empId) byEmp[u.empId] = u.userId; });
  if (type === 'Reporting Manager') {
    var emp = _findEmployeeById(requesterEmpId);
    var mgr = emp ? emp.managerId : '';
    if (mgr && byEmp[mgr]) out.push(byEmp[mgr]);
  } else if (type === 'Department Head') {
    var emp = _findEmployeeById(requesterEmpId);
    var dept = emp ? emp.departmentId : '';
    var depts = _readSheet(_openCoreDb(), 'Departments').rows;
    for (var i = 0; i < depts.length; i++) if (depts[i].deptId === dept && depts[i].headId) { out.push(depts[i].headId); break; }
  } else if (type === 'Branch Head') {
    var emp = _findEmployeeById(requesterEmpId);
    var branch = emp ? emp.branchId : '';
    var branches = _readSheet(_openCoreDb(), 'Branches').rows;
    for (var i = 0; i < branches.length; i++) if (branches[i].branchId === branch && branches[i].headId) { out.push(branches[i].headId); break; }
  } else if (type === 'Role') {
    var roleUsers = _readSheet(_openCoreDb(), 'UserRoles').rows;
    for (var i = 0; i < roleUsers.length; i++) {
      if (roleUsers[i].roleId === val) out.push(roleUsers[i].userId);
    }
  } else if (type === 'Specific') {
    if (byEmp[val]) out.push(byEmp[val]);
  } else if (type === 'Super Admin') {
    String(_getProp(PROP.SUPER_ADMINS) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (s) { out.push(s); });
  }
  return out.filter(Boolean);
}
function _findEmployeeById(empId) {
  var rows = _readSheet(_openCoreDb(), 'Employees').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].empId) === String(empId)) return rows[i];
  return null;
}
function _evaluateNextStep(req) {
  var steps = _getWorkflow(req.type, req.version || 1);
  var curStep = Number(req.currentStep || 0);
  // find next step whose condition is met
  for (var i = curStep; i < steps.length; i++) {
    var s = steps[i];
    if (!_conditionMet(s, req)) continue;
    return { stepNo: i, step: s, approvers: _approverUsersForStep(s, req.empId) };
  }
  return null; // no more steps -> completed
}
function _conditionMet(step, req) {
  var c = step.condition || {};
  if (!c || Object.keys(c).length === 0) return true;
  var data = {};
  try { data = JSON.parse(req.data || '{}'); } catch (e) {}
  if (c.days !== undefined) {
    var days = Number(data.leaveDays || data.days || 0);
    var op = c.op || '>';
    if (op === '>' && !(days > Number(c.days))) return false;
    if (op === '>=' && !(days >= Number(c.days))) return false;
    if (op === '<' && !(days < Number(c.days))) return false;
  }
  if (c.amount !== undefined) {
    var amt = Number(data.amount || 0);
    var op = c.op || '>';
    if (op === '>' && !(amt > Number(c.amount))) return false;
    if (op === '>=' && !(amt >= Number(c.amount))) return false;
  }
  if (c.monthCount !== undefined) {
    // leave regularization count this month
    var cnt = _monthRequestCount(req.empId, req.type);
    if (!(cnt > Number(c.monthCount))) return false;
  }
  if (c.postLock === '1') {
    // attendance locked for this month (simplified)
    var lock = _getProp('ATT.LOCK.' + data.month || _todayStr().slice(0,7));
    if (lock !== '1') return false;
  }
  return true;
}
function _monthRequestCount(empId, type) {
  var rows = _readSheet(_openCoreDb(), 'Requests').rows;
  var ym = _todayStr().slice(0, 7);
  var c = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].empId !== empId || rows[i].type !== type) continue;
    if (String(rows[i].createdAt).slice(0, 7) === ym) c++;
  }
  return c;
}

// ---------- Create request ----------

function wf_create_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var type = payload.type;
  if (REQUEST_TYPES.indexOf(type) < 0) throw _error(ERR.VALIDATION, 'Unknown request type.');
  var perm = TYPE_PERM[type];
  if (!_can(boot.user, perm, 'company')) throw _error(ERR.FORBIDDEN, 'You cannot raise ' + type + ' requests.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!empId) throw _error(ERR.NOT_FOUND, 'Employee record not found.');
  var data = payload.data || {};
  var reqId = _uid();
  var version = 1;
  var wf = _evaluateNextStep({ type: type, empId: empId, currentStep: 0, data: JSON.stringify(data) });
  var status = wf ? 'Pending' : 'Approved'; // no workflow -> auto approved
  var now = _nowStr();
  var row = [reqId, type, empId, status, JSON.stringify(data), String(wf ? wf.stepNo : 0), boot.user.userId, now, now];
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Requests');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, REQ_HEADERS.length).setValues([REQ_HEADERS]);
  _appendRows(sheet, [row]);
  delete _rowCache[_sheetKey(db, 'Requests')];
  _audit(boot.user.userId, 'wf.create', 'Requests', reqId, {}, { type: type, status: status });
  _flushAudit();
  // notify approvers
  if (wf) {
    wf.approvers.forEach(function (au) {
      _notify(au, 'New ' + type + ' request awaiting your approval.', 'approval', reqId);
    });
    _flushNotifications();
  }
  return _result(true, { reqId: reqId, status: status, step: wf || null, message: status === 'Approved' ? 'Auto-approved (no workflow defined).' : 'Submitted for approval.' });
}
function _findEmployeeByUserId(userId) {
  var rows = _readSheet(_openCoreDb(), 'Employees').rows;
  for (var i = 0; i < rows.length; i++) if (rows[i].userId === userId || rows[i].loginId === userId) return rows[i].empId;
  return null;
}

// ---------- List requests (inbox / my requests) ----------

function wf_listrequests_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var mode = payload.mode || 'inbox'; // inbox | my | all
  var rows = _readSheet(_openCoreDb(), 'Requests').rows.filter(function (r) { return r.deleted !== '1'; });
  var empId = _findEmployeeByUserId(boot.user.userId);
  var out = rows.filter(function (r) {
    if (mode === 'my') return String(r.createdBy) === String(boot.user.userId) || String(r.empId) === String(empId);
    if (mode === 'inbox') {
      // pending requests where user is an approver of current step
      if (r.status !== 'Pending') return false;
      var wf = _evaluateNextStep(r);
      return wf && wf.approvers.indexOf(boot.user.userId) >= 0;
    }
    return _can(boot.user, 'approval.viewall', 'company');
  });
  // enrich with employee name + step info
  var empMap = {};
  _readSheet(_openCoreDb(), 'Employees').rows.forEach(function (e) { empMap[e.empId] = e; });
  out = out.map(function (r) {
    var e = empMap[r.empId] || {};
    var wf = r.status === 'Pending' ? _evaluateNextStep(r) : null;
    return { reqId: r.reqId, type: r.type, empId: r.empId, empName: e.name || '', empCode: e.empCode || '', status: r.status, currentStep: Number(r.currentStep || 0), data: JSON.parse(r.data || '{}'), createdAt: r.createdAt, updatedAt: r.updatedAt, nextStep: wf };
  });
  return _result(true, { rows: out });
}

// ---------- Act on a request ----------

function wf_action_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var reqId = payload.reqId;
  var action = payload.action; // approve | reject | sendback | withdraw | reassign
  var comment = payload.comment || '';
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Requests');
  var rows = _readSheet(db, 'Requests').rows;
  var hdrs = _readSheet(db, 'Requests').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].reqId) === String(reqId)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'Request not found.');
  var req = rows[idx];
  var now = _nowStr();
  if (action === 'withdraw') {
    if (String(req.createdBy) !== String(boot.user.userId) && String(req.empId) !== _findEmployeeByUserId(boot.user.userId))
      throw _error(ERR.FORBIDDEN, 'Only requester can withdraw.');
    if (req.status !== 'Pending') throw _error(ERR.VALIDATION, 'Only pending requests can be withdrawn.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Withdrawn');
    sheet.getRange(idx + 2, col['updatedAt'], 1, 1).setValue(now);
    delete _rowCache[_sheetKey(db, 'Requests')];
    _appendAction(db, reqId, boot.user.userId, 'withdraw', comment);
    _notify(req.createdBy, 'Your ' + req.type + ' request was withdrawn.', 'request');
    _flushNotifications();
    _audit(boot.user.userId, 'wf.withdraw', 'Requests', reqId, {}, { comment: comment });
    return _result(true, { status: 'Withdrawn' });
  }
  if (req.status !== 'Pending') throw _error(ERR.VALIDATION, 'Request already ' + req.status + '.');
  var wf = _evaluateNextStep(req);
  if (!wf) throw _error(ERR.VALIDATION, 'No active approval step.');
  if (wf.approvers.indexOf(boot.user.userId) < 0 && !_can(boot.user, 'approval.override', 'company')) throw _error(ERR.FORBIDDEN, 'You are not an approver for this step.');
  // maker-checker: approver cannot approve own request
  if (String(req.createdBy) === String(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Cannot approve your own request.');
  var perm = TYPE_PERM[req.type];
  if (!_can(boot.user, perm + '.approve', 'company')) throw _error(ERR.FORBIDDEN, 'You do not have approve permission for this type.');
  // limit check
  var data = JSON.parse(req.data || '{}');
  var limit = _effectivePermissions(boot.user.userId).perms[perm + '.approve'];
  if (limit && limit.limit) {
    var amt = Number(data.amount || data.leaveDays || 0);
    var lim = Number(limit.limit);
    if (!isNaN(lim) && amt > lim) throw _error(ERR.FORBIDDEN, 'Amount exceeds your approval limit of ₹' + lim + '.');
  }
  if (action === 'approve') {
    var next = _evaluateNextStep({ type: req.type, empId: req.empId, currentStep: Number(wf.stepNo) + 1, data: req.data });
    var newStatus = next ? 'Pending' : 'Approved';
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue(newStatus);
    sheet.getRange(idx + 2, col['currentStep'], 1, 1).setValue(String(next ? next.stepNo : wf.stepNo + 1));
    sheet.getRange(idx + 2, col['updatedAt'], 1, 1).setValue(now);
    delete _rowCache[_sheetKey(db, 'Requests')];
    _appendAction(db, reqId, boot.user.userId, 'approve', comment);
    if (next) {
      next.approvers.forEach(function (au) { _notify(au, 'A ' + req.type + ' request needs your approval (step ' + (next.stepNo + 1) + ').', 'approval', reqId); });
    } else {
      _notify(req.createdBy, 'Your ' + req.type + ' request has been approved.', 'request');
      _executeApprovedRequest(req, data);
    }
    _flushNotifications();
    _audit(boot.user.userId, 'wf.approve', 'Requests', reqId, {}, { step: wf.stepNo, newStatus: newStatus });
  } else if (action === 'reject') {
    if (!comment) throw _error(ERR.VALIDATION, 'Comment is required to reject.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Rejected');
    sheet.getRange(idx + 2, col['updatedAt'], 1, 1).setValue(now);
    delete _rowCache[_sheetKey(db, 'Requests')];
    _appendAction(db, reqId, boot.user.userId, 'reject', comment);
    _notify(req.createdBy, 'Your ' + req.type + ' request was rejected: ' + comment, 'request');
    _flushNotifications();
    _audit(boot.user.userId, 'wf.reject', 'Requests', reqId, {}, { comment: comment });
  } else if (action === 'sendback') {
    if (!comment) throw _error(ERR.VALIDATION, 'Comment is required.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Send Back');
    sheet.getRange(idx + 2, col['updatedAt'], 1, 1).setValue(now);
    delete _rowCache[_sheetKey(db, 'Requests')];
    _appendAction(db, reqId, boot.user.userId, 'sendback', comment);
    _notify(req.createdBy, 'Your ' + req.type + ' request was sent back: ' + comment, 'request');
    _flushNotifications();
    _audit(boot.user.userId, 'wf.sendback', 'Requests', reqId, {}, { comment: comment });
  } else {
    throw _error(ERR.VALIDATION, 'Unknown action.');
  }
  _flushAudit();
  return _result(true, { status: req.status === 'Pending' ? (action === 'reject' ? 'Rejected' : action === 'sendback' ? 'Send Back' : 'Pending') : req.status });
}
function _appendAction(db, reqId, userId, action, comment) {
  var sheet = _getOrCreateSheet(db, 'RequestActions');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, ACT_HEADERS.length).setValues([ACT_HEADERS]);
  _appendRows(sheet, [[_uid(), reqId, userId, action, comment, _nowStr()]]);
  delete _rowCache[_sheetKey(db, 'RequestActions')];
}
function _executeApprovedRequest(req, data) {
  // side-effects after final approval
  var type = req.type;
  var empId = req.empId;
  if (type === 'LEAVE') {
    _leaveApplyCommitted(empId, data);
  } else if (type === 'ATT_REG') {
    // regularize attendance — handled in attendance module
  } else if (type === 'RESIGNATION') {
    // mark exit initiated
  }
  // generic: just record
}
function _leaveApplyCommitted(empId, data) {
  // deduct leave balance (simplified: HR module handles balances via leave apps)
}
