/**
 * FocusOn HRMS 2.0 — System (13_System.gs)
 * setupSystem, seedDemoData, seedLoadTest200, settings, backup/restore,
 * cron jobs, retention, RDash, system health, error log.
 */

// ---------- setupSystem: initialize the whole DB ----------

function setupSystem_(payload) {
  var caller = payload && payload.caller;
  // protect: only script owner / first run
  var done = _getProp(PROP.SETUP_DONE);
  if (done === '1' && !payload.force) return _result(true, { message: 'Already initialized. Use force:true to re-run.' });
  var root = DriveApp.getRootFolder();
  var rootFolder = root.createFolder('FocusOn HRMS 2.0');
  _setProp(PROP.ROOT_FOLDER, rootFolder.getId());

  // Core DB
  var core = SpreadsheetApp.create('FocusOn HRMS — Core DB');
  _setProp(PROP.DB_CORE, core.getId());
  // Attendance & Logs for current year
  var y = new Date().getFullYear();
  var att = SpreadsheetApp.create('FocusOn HRMS — Attendance ' + y);
  _setProp(PROP.DB_ATT_PREFIX + y, att.getId());
  var log = SpreadsheetApp.create('FocusOn HRMS — Logs ' + y);
  _setProp(PROP.DB_LOG_PREFIX + y, log.getId());

  var db = core;
  // create all tabs with headers
  var TABS = {
    Settings: ['key', 'value', 'type', 'updatedAt'],
    Users: ['userId', 'empCode', 'name', 'email', 'mobile', 'passwordHash', 'salt', 'status', 'role', 'panel', 'theme', 'failedAttempts', 'lockedUntil', 'tempPassword', 'mustChangePassword', 'createdAt'],
    Roles: ['roleId', 'name', 'desc', 'base', 'active', 'createdAt'],
    RolePerms: ['roleId', 'perm', 'scope', 'limit', 'allowDeny', 'expiry', 'grantedBy'],
    UserRoles: ['userId', 'roleId', 'from', 'to', 'assignedBy', 'assignedAt'],
    Overrides: ['overrideId', 'userId', 'perm', 'scope', 'limit', 'allowDeny', 'expiry', 'reason', 'grantedBy', 'grantedAt'],
    Delegations: ['delegationId', 'fromUserId', 'toUserId', 'requestTypes', 'from', 'to', 'active', 'createdBy', 'createdAt'],
    Authorities: ['authorityId', 'userId', 'scope', 'scopeValue', 'ceilingRoles', 'ceilingPerms', 'workflowRights', 'userMgmt', 'validFrom', 'validTo', 'active', 'grantedBy', 'grantedAt'],
    FeatureFlags: ['key', 'enabled', 'updatedAt'],
    Employees: EMP_HEADERS,
    Branches: ['branchId', 'name', 'code', 'address', 'state', 'geoLocations', 'headId', 'createdAt', 'deleted'],
    Departments: ['deptId', 'name', 'code', 'headId', 'parentId', 'createdAt', 'deleted'],
    Designations: ['desgId', 'name', 'level', 'defaultRoleId', 'noticePeriod', 'createdAt', 'deleted'],
    Sites: ['siteId', 'name', 'code', 'branchId', 'address', 'geoPoint', 'createdAt', 'deleted'],
    Shifts: ['shiftId', 'name', 'start', 'end', 'graceMins', 'breakMins', 'nightShift', 'weeklyOff', 'createdAt', 'deleted'],
    AttPolicies: ['policyId', 'name', 'type', 'geoRadiusM', 'selfie', 'blockOrFlag', 'graceMins', 'autoCheckout', 'createdAt', 'deleted'],
    Holidays: ['holidayId', 'date', 'name', 'type', 'branchId', 'createdAt', 'deleted'],
    ConsentLog: ['consentId', 'userId', 'version', 'acceptedAt'],
    Sessions: ['token', 'userId', 'expiry', 'createdAt', 'revoked'],
    LoginHistory: ['historyId', 'userId', 'success', 'ip', 'at'],
    Notifications: ['notifId', 'userId', 'message', 'type', 'link', 'isRead', 'createdAt'],
    AuditLog: ['auditId', 'userId', 'action', 'table', 'recordId', 'oldVal', 'newVal', 'at', 'meta'],
    BackupLog: ['backupId', 'type', 'fileId', 'rows', 'at', 'status'],
    Workflows: WF_HEADERS,
    Requests: REQ_HEADERS,
    RequestActions: ACT_HEADERS,
    LeaveTypes: LV_TYPE_HEADERS,
    LeaveApps: LV_APP_HEADERS,
    LeaveBalances: LV_BAL_HEADERS,
    LeaveLedger: LV_LED_HEADERS,
    SalaryComponents: COMP_HEADERS,
    SalaryTemplates: TEMPLATE_HEADERS,
    SalaryStructures: STRUCT_HEADERS,
    PayAdjustments: ['adjustId', 'empId', 'yearMonth', 'amount', 'type', 'reason', 'approvedBy', 'createdAt'],
    Loans: ['loanId', 'empId', 'amount', 'emi', 'tenure', 'status', 'disbursedDate', 'disbursedBy', 'createdAt'],
    LoanLedger: ['ledgerId', 'loanId', 'empId', 'date', 'type', 'amount', 'balance', 'remark', 'createdAt'],
    PayrollRuns: RUN_HEADERS,
    PayrollItems: ITEM_HEADERS,
    Payslips: PAYSLIP_HEADERS,
    Expenses: ['expenseId', 'empId', 'category', 'amount', 'date', 'receiptFileId', 'status', 'approvedBy', 'paidDate', 'createdAt'],
    ExpenseCategories: ['catId', 'name', 'limit', 'receiptRequired', 'active'],
    DocTemplates: DOC_TEMPLATE_HEADERS,
    Documents: DOC_HEADERS,
    EmpDocs: EMPDOC_HEADERS,
    Library: ['libId', 'title', 'category', 'fileId', 'visibility', 'createdAt'],
    Acks: ['ackId', 'libId', 'empId', 'acknowledgedAt'],
    Jobs: JOB_HEADERS,
    Candidates: CAND_HEADERS,
    Interviews: INTERVIEW_HEADERS,
    OnboardTasks: ONBOARD_HEADERS,
    PerfCycles: PERF_CYCLE_HEADERS,
    PerfGoals: PERF_GOAL_HEADERS,
    PerfReviews: PERF_REVIEW_HEADERS,
    Exits: EXIT_HEADERS,
    ExitTasks: EXIT_TASK_HEADERS,
    FnF: FNF_HEADERS,
    Tickets: TICKET_HEADERS,
    TicketComments: TICKET_COMMENT_HEADERS,
    Announcements: ANNOUNCE_HEADERS,
    AnnouncementAcks: ANNOUNCE_ACK_HEADERS,
    RDash_Mapping: ['empId', 'rdashId', 'name', 'mappedAt'],
    IntegrationLog: ['logId', 'source', 'action', 'status', 'detail', 'at'],
    ErrorLog: ['errorId', 'ref', 'message', 'at']
  };
  Object.keys(TABS).forEach(function (name) {
    var sheet = _getOrCreateSheet(db, name);
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      sheet.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
      sheet.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold');
    }
  });

  // Default settings
  var now = _nowStr();
  var settings = [
    ['company.name', APP.companyName, 'text', now],
    ['company.primaryColor', APP.primaryColor, 'text', now],
    ['PAYROLL.divisor', 'CALENDAR', 'text', now],
    ['PAYROLL.otMultiplier', String(STATUTORY.otMultiplier), 'text', now],
    ['PAYROLL.ceoApproval', '1', 'text', now],
    ['SETTINGS.payroll.saBreakGlass', '1', 'text', now],
    ['ATT.defaultPolicy', 'POL_OFFICE', 'text', now],
    ['LEAVE.yearStart', '4-1', 'text', now],
    ['EMAIL.dailyGuard', String(EMAIL.dailyGuard), 'text', now],
    ['INTEGRATION.rdash.enabled', '0', 'text', now]
  ];
  settings.forEach(function (s) { _appendRows(_getOrCreateSheet(db, 'Settings'), [s]); });

  // Default feature flags
  Object.keys(DEFAULT_FEATURE_FLAGS).forEach(function (k) {
    _appendRows(_getOrCreateSheet(db, 'FeatureFlags'), [k, DEFAULT_FEATURE_FLAGS[k] ? '1' : '0', now]);
  });

  // Default roles + permissions (starter preset)
  PRESET_ROLES.forEach(function (role) {
    _appendRows(_getOrCreateSheet(db, 'Roles'), [role.id, role.name, role.desc, role.base ? '1' : '0', '1', now]);
  });
  // seed some base perms for EMPLOYEE + HR/Admin examples (minimal; SA completes via UI)
  var basePerms = [
    ['EMPLOYEE', 'attendance.markself', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['EMPLOYEE', 'leave.view', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['EMPLOYEE', 'leave.apply', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['EMPLOYEE', 'payslip.view', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['EMPLOYEE', 'request.leave', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['EMPLOYEE', 'profile.view', 'S', '', 'ALLOW', '', 'SYSTEM'],
    ['HR', 'employee.view', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['HR', 'employee.edit', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['HR', 'leave.approve', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['HR', 'payroll.prepare', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['ACCOUNTS', 'payroll.verify', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['ACCOUNTS', 'payroll.release', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['EXEC', 'payroll.approve', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['EXEC', 'report.payroll', 'C', '', 'ALLOW', '', 'SYSTEM'],
    ['MANAGER', 'leave.approve', 'P', '3', 'ALLOW', '', 'SYSTEM'],
    ['SUPERVISOR', 'attendance.markothers', 'T', '', 'ALLOW', '', 'SYSTEM']
  ];
  basePerms.forEach(function (p) { _appendRows(_getOrCreateSheet(db, 'RolePerms'), p); });

  // Default attendance policies, shifts
  DEFAULT_ATT_POLICIES.forEach(function (p) {
    _appendRows(_getOrCreateSheet(db, 'AttPolicies'), [p.id, p.name, p.type, p.geoRadiusM, p.selfie ? '1' : '0', p.blockOrFlag, p.graceMins, p.autoCheckout ? '1' : '0', now]);
  });
  DEFAULT_SHIFTS.forEach(function (s) {
    _appendRows(_getOrCreateSheet(db, 'Shifts'), [s.id, s.name, s.start, s.end, s.graceMins, s.breakMins, s.nightShift ? '1' : '0', JSON.stringify(s.weeklyOff), now]);
  });

  // Default leave types
  var leaveTypes = [
    ['LV_CL', 'Casual Leave', '1', '12', 'none', '1', '0', '0', '0', '0', '1', '0', '1', '3', '3', 'All', '1', '1', '#10B981', '1'],
    ['LV_SL', 'Sick Leave', '1', '12', 'none', '1', '0', '0', '0', '0', '1', '0', '1', '3', '3', 'All', '1', '1', '#F59E0B', '1'],
    ['LV_EL', 'Earned Leave', '1', '18', 'monthly', '1', '1', '30', '1', '15', '0', '1', '0', '15', '15', 'All', '1', '1', '#3B82F6', '1'],
    ['LV_LWP', 'Leave Without Pay', '0', '999', 'none', '0', '0', '0', '0', '0', '0', '0', '0', '30', '30', 'All', '1', '1', '#6B7280', '1']
  ];
  leaveTypes.forEach(function (lt) { _appendRows(_getOrCreateSheet(db, 'LeaveTypes'), lt); });

  // Create default Super Admin (user 1) and Admin
  var saSalt = _makeSalt();
  var saHash = _hashPassword('FocusOn@2026', saSalt);
  var saId = _uid();
  _appendRows(_getOrCreateSheet(db, 'Users'), [[saId, 'FO-0001', 'Super Admin', 'sa@focuson.in', '9999999999', saHash, saSalt, 'Active', 'SUPER_ADMIN', 'super', 'light', '0', '', '', '1', now]]);
  _setProp(PROP.SUPER_ADMINS, saId);
  // Admin
  var adSalt = _makeSalt();
  var adHash = _hashPassword('Admin@2026', adSalt);
  var adId = _uid();
  _appendRows(_getOrCreateSheet(db, 'Users'), [[adId, 'FO-0002', 'Admin', 'admin@focuson.in', '8888888888', adHash, adSalt, 'Active', 'ADMIN', 'admin', 'light', '0', '', '', '0', now]]);

  _setProp(PROP.SETUP_DONE, '1');
  _setProp(PROP.ACL_VER, '1');
  _audit(saId, 'system.setup', 'Settings', 'setup', {}, { version: APP.version });
  _flushAudit();
  return _result(true, {
    message: 'FocusOn HRMS 2.0 initialized.',
    db: core.getId(),
    superAdmin: { empCode: 'FO-0001', name: 'Super Admin', tempPassword: 'FocusOn@2026' },
    admin: { empCode: 'FO-0002', name: 'Admin', tempPassword: 'Admin@2026' },
    note: 'Change temp passwords on first login. Max 2 Super Admins.'
  });
}

// ---------- Seed demo data ----------

function seedDemoData_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_isSuperAdmin(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  // create a few branches, depts, employees
  var db = _openCoreDb();
  var now = _nowStr();
  var branches = [
    ['BR_HO', 'Head Office Delhi', 'HO', 'Connaught Place, New Delhi', 'DL', JSON.stringify([{ lat: 28.6304, lng: 77.2177, radius: 100 }]), '', now, '0'],
    ['BR_MUM', 'Mumbai Branch', 'MU', 'Bandra Kurla Complex, Mumbai', 'MH', JSON.stringify([{ lat: 19.0760, lng: 72.8777, radius: 100 }]), '', now, '0']
  ];
  branches.forEach(function (b) { _appendRows(_getOrCreateSheet(db, 'Branches'), b); });
  var depts = [
    ['DP_ENG', 'Engineering', 'ENG', '', '', now, '0'],
    ['DP_HR', 'Human Resources', 'HR', '', '', now, '0'],
    ['DP_ACC', 'Accounts', 'ACC', '', '', now, '0']
  ];
  depts.forEach(function (d) { _appendRows(_getOrCreateSheet(db, 'Departments'), d); });
  var emps = [
    ['FO-0003', 'Rahul Sharma', 'DP_ENG', 'BR_HO', 'MANAGER', '2025-01-10'],
    ['FO-0004', 'Priya Patel', 'DP_HR', 'BR_HO', 'HR', '2025-03-15'],
    ['FO-0005', 'Amit Singh', 'DP_ENG', 'BR_MUM', 'EMPLOYEE', '2025-06-01'],
    ['FO-0006', 'Neha Gupta', 'DP_ACC', 'BR_HO', 'ACCOUNTS', '2025-07-20']
  ];
  emps.forEach(function (e) {
    var empId = _uid();
    _appendRows(_getOrCreateSheet(db, 'Employees'), [empId, e[0], e[1], 'Male', '', '900000000' + e[0].slice(-1), e[0].toLowerCase() + '@focuson.in', '', '', '', '', '', 'BR_' + (e[3] === 'BR_HO' ? 'HO' : 'MUM'), e[2], '', '', '', 'SH_GEN', 'POL_OFFICE', 'Full-time', e[4], '3', '0', '', '1', 'Active', '', '', '', '', boot.user.userId, now, '0']);
  });
  _audit(boot.user.userId, 'system.seed_demo', 'Settings', 'demo', {}, { branches: branches.length, depts: depts.length, emps: emps.length });
  _flushAudit();
  return _result(true, { message: 'Demo data seeded (branches, departments, sample employees).', branches: branches.length, employees: emps.length });
}

// ---------- Seed 200 users for load test ----------

function seedLoadTest200_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_isSuperAdmin(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var db = _openCoreDb();
  var now = _nowStr();
  var batch = [];
  for (var i = 1; i <= 200; i++) {
    var empId = _uid();
    var code = 'FO-' + String(1000 + i);
    var dept = i % 3 === 0 ? 'DP_HR' : (i % 2 === 0 ? 'DP_ENG' : 'DP_ACC');
    var branch = i % 4 === 0 ? 'BR_MUM' : 'BR_HO';
    var role = i <= 5 ? 'MANAGER' : 'EMPLOYEE';
    batch.push([empId, code, 'Load Test User ' + i, 'Male', '', '9' + String(100000000 + i), code.toLowerCase() + '@focuson.in', '', '', '', '', '', branch, dept, '', '', '', 'SH_GEN', 'POL_OFFICE', 'Full-time', '2025-01-01', '3', '0', '', '1', 'Active', '', '', '', '', boot.user.userId, now, '0']);
  }
  var sheet = _getOrCreateSheet(db, 'Employees');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, EMP_HEADERS.length).setValues([EMP_HEADERS]);
  _appendRows(sheet, batch);
  delete _rowCache[_sheetKey(db, 'Employees')];
  return _result(true, { message: 'Seeded 200 load-test employees.', count: 200 });
}

// ---------- Settings ----------

function system_settings_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'settings.company', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Settings');
  var rows = _readSheet(db, 'Settings').rows;
  var hdrs = _readSheet(db, 'Settings').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = _nowStr();
  if (payload.action === 'set') {
    var key = payload.key;
    var val = payload.value;
    var found = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].key === key) { sheet.getRange(i + 2, col['value'], 1, 1).setValue(val); sheet.getRange(i + 2, col['updatedAt'], 1, 1).setValue(now); found = true; break; }
    }
    if (!found) _appendRows(sheet, [[key, val, 'text', now]]);
    delete _rowCache[_sheetKey(db, 'Settings')];
    _audit(boot.user.userId, 'system.settings.set', 'Settings', key, {}, { value: val });
    if (key === 'SETTINGS.payroll.saBreakGlass') _clearPermCache();
    return _result(true, { message: 'Setting saved.' });
  }
  var kv = {}; rows.forEach(function (r) { kv[r.key] = r.value; });
  return _result(true, { settings: kv });
}

// ---------- Backup / restore ----------

function system_backup_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'backup.run', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var db = _openCoreDb();
  var rootId = _getProp(PROP.ROOT_FOLDER);
  if (!rootId) throw _error(ERR.NOT_FOUND, 'Root folder not set.');
  var root = DriveApp.getFolderById(rootId);
  var backupFolder = _getOrCreateFolder(root, 'Backups');
  var ts = _todayStr() + '_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HHmmss');
  // copy core db
  var coreId = _getProp(PROP.DB_CORE);
  var coreFile = DriveApp.getFileById(coreId);
  var copy = coreFile.makeCopy('Core_DB_' + ts, backupFolder);
  // log row count
  var sheet = _getOrCreateSheet(db, 'BackupLog');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, ['backupId', 'type', 'fileId', 'rows', 'at', 'status'].length).setValues([['backupId', 'type', 'fileId', 'rows', 'at', 'status']]);
  var totalRows = 0;
  try {
    var allSheets = db.getSheets();
    allSheets.forEach(function (s) { totalRows += s.getLastRow(); });
  } catch (e) {}
  _appendRows(sheet, [[_uid(), 'core', copy.getId(), totalRows, _nowStr(), 'ok']]);
  delete _rowCache[_sheetKey(db, 'BackupLog')];
  _audit(boot.user.userId, 'system.backup', 'BackupLog', copy.getId(), {}, { fileId: copy.getId(), rows: totalRows });
  return _result(true, { message: 'Backup created.', fileId: copy.getId(), timestamp: ts });
}

function system_backups_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'backup.run', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var rootId = _getProp(PROP.ROOT_FOLDER);
  var root = DriveApp.getFolderById(rootId);
  var folder = _getOrCreateFolder(root, 'Backups');
  var files = folder.getFiles();
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    out.push({ name: f.getName(), fileId: f.getId(), size: f.getSize(), created: f.getDateCreated() });
  }
  return _result(true, { files: out });
}

function system_restore_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_isSuperAdmin(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var fileId = payload.fileId;
  // safety backup first
  system_backup_({ token: payload.token });
  var dbId = _getProp(PROP.DB_CORE);
  var current = DriveApp.getFileById(dbId);
  // copy selected backup over: we can't replace file id easily; instead point DB_CORE to a copy
  var backupFile = DriveApp.getFileById(fileId);
  var restored = backupFile.makeCopy('FocusOn HRMS — Core DB (restored ' + _todayStr() + ')', current.getParents().next());
  _setProp(PROP.DB_CORE, restored.getId());
  // clear caches
  _ssCache = {}; _sheetCache = {}; _rowCache = {}; _permCache = {};
  _audit(boot.user.userId, 'system.restore', 'Settings', PROP.DB_CORE, {}, { restoredTo: restored.getId() });
  return _result(true, { message: 'Database restored. DB pointer switched.', db: restored.getId() });
}

// ---------- Cron jobs ----------

function cron_hourly_() {
  try {
    // SLA reminders & escalation
    var db = _openCoreDb();
    var rows = _readSheet(db, 'Requests').rows.filter(function (r) { return r.status === 'Pending'; });
    var now = new Date();
    rows.forEach(function (r) {
      var created = new Date(r.createdAt);
      var hours = (now - created) / (1000 * 60 * 60);
      if (hours > 24) {
        var wf = _evaluateNextStep(r);
        if (wf) wf.approvers.forEach(function (au) { _notify(au, 'SLA escalation: request ' + r.reqId + ' pending > 24h.', 'approval', r.reqId); });
      }
    });
    _flushNotifications();
    // auto-checkout if night shift end passed
    cron_autocheckout_();
    return { ok: true };
  } catch (e) { _logError('cron_hourly', e); return { ok: false, error: String(e) }; }
}
function cron_daily_() {
  try {
    var today = _todayStr();
    // daily backup
    system_backup_({ token: 'system', force: true });
    // leave accrual (runs on 1st, handled inside)
    cron_leaveaccrual_();
    // retention purge
    cron_retention_();
    // alerts: probation, document expiry, birthdays
    cron_alerts_();
    // daily digest email
    if (_getProp('SETTINGS.email.digest') !== '0') cron_digest_();
    return { ok: true };
  } catch (e) { _logError('cron_daily', e); return { ok: false, error: String(e) }; }
}
function cron_nightly_() {
  try { cron_autocheckout_(); return { ok: true }; } catch (e) { _logError('cron_nightly', e); return { ok: false, error: String(e) }; }
}
function cron_retention_() {
  // purge selfies older than 90 days, notifications older than 60 days
  var cutoffSelfie = _addDays(_todayStr(), -STATUTORY.selfieRetentionDays);
  var cutoffNotif = _addDays(_todayStr(), -STATUTORY.notificationRetentionDays);
  var db = _openCoreDb();
  var att = _readSheet(db, 'AttendanceSelfies'); // placeholder table if used
  // Notifications purge
  var sheet = _getOrCreateSheet(db, 'Notifications');
  var rows = _readSheet(db, 'Notifications').rows;
  var hdrs = _readSheet(db, 'Notifications').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].createdAt && rows[i].createdAt.slice(0, 10) < cutoffNotif) {
      sheet.deleteRow(i + 2); removed++;
    }
  }
  if (removed) delete _rowCache[_sheetKey(db, 'Notifications')];
  _audit('system', 'retention.purge', 'Notifications', 'all', {}, { removed: removed });
  return { notificationsPurged: removed };
}
function cron_alerts_() {
  // probation due, doc expiry, birthdays - lightweight notifications
  try {
    var db = _openCoreDb();
    var emps = _readSheet(db, 'Employees').rows.filter(function (r) { return r.deleted !== '1'; });
    emps.forEach(function (e) {
      if (e.doj && !e.confirmed) {
        var d = _parseDate(e.doj); d.setMonth(d.getMonth() + Number(e.probationMonths || 3));
        var due = Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
        var days = _daysBetween(_todayStr(), due);
        if (days === 7 || days === 1) _notify(e.userId || e.empId, 'Probation confirmation due on ' + due + '.', 'alert');
      }
      if (e.dob) {
        var mm = _todayStr().slice(5, 7), dd = _todayStr().slice(8, 10);
        if (String(e.dob).slice(5, 7) === mm && String(e.dob).slice(8, 10) === dd) _notify(e.userId || e.empId, 'Happy Birthday! 🎂', 'wish');
      }
    });
    _flushNotifications();
  } catch (e) { _logError('cron_alerts', e); }
}
function cron_digest_() {
  var sent = 0;
  try {
    var db = _openCoreDb();
    var users = _readSheet(db, 'Users').rows.filter(function (r) { return r.deleted !== '1'; });
    users.forEach(function (u) {
      var rows = _readSheet(db, 'Notifications').rows;
      var unread = rows.filter(function (r) { return String(r.userId) === String(u.userId) && r.isRead === '0'; }).length;
      if (unread > 0 && u.email) {
        var ok = _sendEmail(u.email, 'FocusOn — Daily Digest (' + _todayStr() + ')', 'You have ' + unread + ' unread notifications.');
        if (ok.ok) sent++;
      }
    });
  } catch (e) { _logError('cron_digest', e); }
  return { digestSent: sent };
}

// ---------- Health ----------

function system_health_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'system.health', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var db = _openCoreDb();
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + ' (' + t.getEventType() + ')'; });
  var emailUsed = _emailSentToday + '/' + EMAIL.dailyGuard;
  return _result(true, {
    version: APP.version,
    setupDone: _getProp(PROP.SETUP_DONE) === '1',
    dbCore: _getProp(PROP.DB_CORE) ? 'yes' : 'no',
    triggers: triggers,
    emailUsed: emailUsed,
    quotaGuard: EMAIL.dailyGuard,
    aclVersion: _getProp(PROP.ACL_VER),
    superAdmins: String(_getProp(PROP.SUPER_ADMINS) || '').split(',').length
  });
}

// ---------- Error log ----------

function _logError(ref, e) {
  try {
    var db = _openCoreDb();
    var sheet = _getOrCreateSheet(db, 'ErrorLog');
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, ['errorId', 'ref', 'message', 'at'].length).setValues([['errorId', 'ref', 'message', 'at']]);
    _appendRows(sheet, [[_uid(), ref, String(e), _nowStr()]]);
    delete _rowCache[_sheetKey(db, 'ErrorLog')];
  } catch (ee) { /* ignore */ }
}

// ---------- RDash ----------

function system_rdash_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'integration.manage', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var db = _openCoreDb();
  var emps = _readSheet(db, 'Employees').rows.filter(function (r) { return r.deleted !== '1'; });
  var rows = emps.map(function (e) { return [e.empId, e.empCode || '', e.name || '', '', e.branchId || '', e.departmentId || '', e.phone || '', e.email || '', e.status || '']; });
  var sheet = _getOrCreateSheet(db, 'RDash_Mapping');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, RDASH.exportColumns.length).setValues([RDASH.exportColumns]);
  return _result(true, { rows: rows, columns: RDASH.exportColumns, link: _getProp('INTEGRATION.rdashLink') || '' });
}
