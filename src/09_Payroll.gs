/**
 * FocusOn HRMS 2.0 — Payroll (09_Payroll.gs)
 * Salary components & templates, employee salary structures, monthly calculation,
 * maker-checker lifecycle (Draft→Prepared→Verified→Approved→Released→Locked),
 * payslips, bank file, PF ECR, ESI, PT, TDS.
 */

var COMP_HEADERS = ['compId', 'name', 'type', 'calc', 'basis', 'value', 'taxable', 'pfApplicable', 'esiApplicable', 'payslipOrder', 'active'];
var TEMPLATE_HEADERS = ['templateId', 'name', 'components', 'description', 'active'];
var STRUCT_HEADERS = ['empId', 'salaryType', 'basic', 'hra', 'conveyance', 'medical', 'special', 'otherEarn', 'otherDeduct',
  'gross', 'pfOption', 'esi', 'ptState', 'tdsMode', 'tdsManual', 'otRate', 'effectiveFrom', 'effectiveTo', 'createdBy', 'createdAt'];
var RUN_HEADERS = ['runId', 'yearMonth', 'status', 'preparedBy', 'preparedAt', 'verifiedBy', 'verifiedAt', 'approvedBy', 'approvedAt', 'releasedBy', 'releasedAt', 'notes', 'locked'];
var ITEM_HEADERS = ['itemId', 'runId', 'empId', 'paidDays', 'basic', 'hra', 'conveyance', 'medical', 'special', 'otherEarn', 'gross',
  'pfEmp', 'pfEps', 'esiEmp', 'esiErn', 'pt', 'tds', 'otPay', 'advanceEmi', 'loanEmi', 'otherDeduct', 'netPay',
  'status', 'hold', 'holdReason', 'payslipGenerated'];
var PAYSLIP_HEADERS = ['payslipId', 'runId', 'empId', 'yearMonth', 'pdfFileId', 'generatedAt'];

// ---------- Components ----------

function pay_components_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.settings', 'company')) throw _error(ERR.FORBIDDEN, 'HR/Accounts only.');
  if (payload.action === 'save') return _masterSave('SalaryComponents', COMP_HEADERS, 'compId', payload, 'pay.comp.save');
  if (payload.action === 'delete') return _softDeleteOn('SalaryComponents', 'compId', payload.compId);
  return _result(true, { rows: _readSheet(_openCoreDb(), 'SalaryComponents').rows.filter(function (r) { return r.active !== '0'; }) });
}

// ---------- Templates ----------

function pay_templates_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.settings', 'company')) throw _error(ERR.FORBIDDEN, 'HR/Accounts only.');
  if (payload.action === 'save') return _masterSave('SalaryTemplates', TEMPLATE_HEADERS, 'templateId', payload, 'pay.template.save');
  if (payload.action === 'delete') return _softDeleteOn('SalaryTemplates', 'templateId', payload.templateId);
  return _result(true, { rows: _readSheet(_openCoreDb(), 'SalaryTemplates').rows.filter(function (r) { return r.active !== '0'; }) });
}

// ---------- Employee salary structure ----------

function pay_structure_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'salarystructure.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'SalaryStructures').rows.filter(function (r) { return r.deleted !== '1'; });
  var scope = _userScope(boot.user);
  rows = rows.filter(function (r) { return _inScopeEmpById(r.empId, boot.user, scope); });
  var show = _can(boot.user, 'field.salary.view', 'company');
  rows = rows.map(function (r) {
    if (!show) { r.basic = '***'; r.gross = '***'; r.hra = '***'; }
    return r;
  });
  return _result(true, { rows: rows });
}
function pay_structure_save_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'salarystructure.edit', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'SalaryStructures');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, STRUCT_HEADERS.length).setValues([STRUCT_HEADERS]);
  var rows = _readSheet(db, 'SalaryStructures').rows;
  var hdrs = _readSheet(db, 'SalaryStructures').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = _nowStr();
  var empId = payload.empId;
  var isNew = true, rowNum = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].empId) === String(empId) && String(rows[i].effectiveFrom) === String(payload.effectiveFrom)) { isNew = false; rowNum = i + 2; break; }
  }
  var gross = Number(payload.basic || 0) + Number(payload.hra || 0) + Number(payload.conveyance || 0) + Number(payload.medical || 0) + Number(payload.special || 0) + Number(payload.otherEarn || 0);
  var values = [empId, payload.salaryType || 'Monthly', payload.basic || 0, payload.hra || 0, payload.conveyance || 0, payload.medical || 0, payload.special || 0, payload.otherEarn || 0, payload.otherDeduct || 0, gross,
    payload.pfOption || 'ceiling', payload.esi || '1', payload.ptState || 'DL', payload.tdsMode || 'MANUAL', payload.tdsManual || 0,
    payload.otRate || 0, payload.effectiveFrom, payload.effectiveTo || '', boot.user.userId, now];
  if (isNew) {
    _appendRows(sheet, [values]);
    _audit(boot.user.userId, 'pay.struct.create', 'SalaryStructures', empId, {}, { gross: gross, from: payload.effectiveFrom });
  } else {
    values.forEach(function (v, j) { sheet.getRange(rowNum, j + 1, 1, 1).setValue(v); });
    delete _rowCache[_sheetKey(db, 'SalaryStructures')];
    _audit(boot.user.userId, 'pay.struct.edit', 'SalaryStructures', empId, {}, { gross: gross });
  }
  _clearPermCache();
  return _result(true, { empId: empId, gross: gross, message: 'Salary structure saved.' });
}

// ---------- Payroll run lifecycle ----------

function pay_precheck_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.prepare', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  var ym = payload.yearMonth || _todayStr().slice(0, 7);
  var blockers = [], warnings = [];
  var emps = _readSheet(_openCoreDb(), 'Employees').rows.filter(function (r) { return r.deleted !== '1' && r.status === 'Active'; });
  var structs = {};
  _readSheet(_openCoreDb(), 'SalaryStructures').rows.forEach(function (s) { structs[s.empId] = s; });
  var attLock = _getProp('ATT.LOCK.' + ym);
  if (attLock !== '1') warnings.push('Attendance for ' + ym + ' is not locked — punches may still change.');
  emps.forEach(function (e) {
    var s = structs[e.empId];
    if (!s) { blockers.push(e.empCode + ' ' + e.name + ': salary structure missing'); return; }
    if (!e.bank || !e.ifsc) warnings.push(e.empCode + ' ' + e.name + ': bank details incomplete');
  });
  var existing = _readSheet(_openCoreDb(), 'PayrollRuns').rows;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].yearMonth === ym) {
      blockers.push('A payroll run already exists for ' + ym + ' (' + existing[i].status + ').');
      break;
    }
  }
  return _result(true, { yearMonth: ym, blockers: blockers, warnings: warnings, employeeCount: emps.length, ready: blockers.length === 0 });
}
function pay_calculate_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.prepare', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  var ym = payload.yearMonth || _todayStr().slice(0, 7);
  var divisor = payload.divisor || _getProp('PAYROLL.divisor') || 'CALENDAR';
  var db = _openCoreDb();
  var runSheet = _getOrCreateSheet(db, 'PayrollRuns');
  if (runSheet.getLastRow() === 0) runSheet.getRange(1, 1, 1, RUN_HEADERS.length).setValues([RUN_HEADERS]);
  var itemSheet = _getOrCreateSheet(db, 'PayrollItems');
  if (itemSheet.getLastRow() === 0) itemSheet.getRange(1, 1, 1, ITEM_HEADERS.length).setValues([ITEM_HEADERS]);
  // check existing run
  var runs = _readSheet(db, 'PayrollRuns').rows;
  for (var i = 0; i < runs.length; i++) {
    if (String(runs[i].yearMonth) === String(ym) && runs[i].status !== 'Deleted') throw _error(ERR.DUPLICATE, 'Run exists for ' + ym);
  }
  var runId = _uid();
  var now = _nowStr();
  var daysInMonth = daysInMonthOf(ym);
  var emps = _readSheet(db, 'Employees').rows.filter(function (r) { return r.deleted !== '1' && r.status === 'Active'; });
  var structs = {}; _readSheet(db, 'SalaryStructures').rows.forEach(function (s) { structs[s.empId] = s; });
  var statutory = JSON.parse(_getProp('SETTINGS.statutory') || '{}');
  var pf = STATUTORY.pf, esi = STATUTORY.esi, otMult = STATUTORY.otMultiplier;
  var items = [], count = 0;
  emps.forEach(function (e) {
    var s = structs[e.empId];
    if (!s) return;
    var paidDays = daysInMonth; // simplified; could subtract LOP from attendance
    var basic = Number(s.basic || 0), hra = Number(s.hra || 0), conv = Number(s.conveyance || 0), med = Number(s.medical || 0), spec = Number(s.special || 0), othEarn = Number(s.otherEarn || 0);
    var gross = basic + hra + conv + med + spec + othEarn;
    // prorate if divisor not calendar
    var factor = 1;
    if (divisor === 'FIXED_30') factor = paidDays / 30;
    else if (divisor === 'FIXED_26') factor = paidDays / 26;
    var earnBasic = basic * factor;
    var earnHra = hra * factor; var earnConv = conv * factor; var earnMed = med * factor; var earnSpec = spec * factor; var earnOth = othEarn * factor;
    var earnGross = earnBasic + earnHra + earnConv + earnMed + earnSpec + earnOth;
    // PF
    var pfWage = Math.min(earnBasic, pf.wageCeiling);
    var pfEmp = pfWage * pf.employeeRate;
    var pfEps = Math.min(pfWage * pf.epsRate, pf.epsMax);
    // ESI
    var esiEmp = 0, esiErn = 0;
    if (earnGross <= esi.wageCeiling) { esiEmp = earnGross * esi.employeeRate; esiErn = earnGross * esi.employerRate; }
    // PT (simplified: Delhi = 0)
    var pt = 0;
    // TDS (manual)
    var tds = Number(s.tdsManual || 0);
    // OT
    var otPay = Number(payload.otPay || 0); // per employee could be passed; simplified 0
    // advance/loan EMI
    var advEmi = 0, loanEmi = 0;
    var otherDeduct = Number(s.otherDeduct || 0);
    var netPay = earnGross - pfEmp - esiEmp - pt - tds - otPay - advEmi - loanEmi - otherDeduct;
    items.push([_uid(), runId, e.empId, paidDays, earnBasic.toFixed(2), earnHra.toFixed(2), earnConv.toFixed(2), earnMed.toFixed(2), earnSpec.toFixed(2), earnOth.toFixed(2), earnGross.toFixed(2),
      pfEmp.toFixed(2), pfEps.toFixed(2), esiEmp.toFixed(2), esiErn.toFixed(2), pt.toFixed(2), tds.toFixed(2), otPay.toFixed(2), advEmi.toFixed(2), loanEmi.toFixed(2), otherDeduct.toFixed(2), netPay.toFixed(2),
      'Prepared', '0', '', '0']);
    count++;
  });
  if (items.length) _appendRows(itemSheet, items);
  _appendRows(runSheet, [[runId, ym, 'Draft', boot.user.userId, now, '', '', '', '', '', '', '', '0']]);
  delete _rowCache[_sheetKey(db, 'PayrollRuns')];
  delete _rowCache[_sheetKey(db, 'PayrollItems')];
  _audit(boot.user.userId, 'pay.calculate', 'PayrollRuns', runId, {}, { yearMonth: ym, count: count, divisor: divisor });
  _flushAudit();
  return _result(true, { runId: runId, yearMonth: ym, status: 'Draft', count: count, message: 'Payroll calculated for ' + count + ' employees.' });
}

// ---------- Verify / Approve / Release ----------

function pay_stage_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var runId = payload.runId;
  var stage = payload.stage; // verify | approve | release | hold | unhold
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'PayrollRuns');
  var rows = _readSheet(db, 'PayrollRuns').rows;
  var hdrs = _readSheet(db, 'PayrollRuns').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].runId) === String(runId)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'Payroll run not found.');
  var run = rows[idx];
  var now = _nowStr();
  var canVer = _can(boot.user, 'payroll.verify', 'company');
  var canAppr = _can(boot.user, 'payroll.approve', 'company');
  var canRel = _can(boot.user, 'payroll.release', 'company');
  if (stage === 'verify') {
    if (!canVer) throw _error(ERR.FORBIDDEN, 'Cannot verify payroll.');
    if (run.status !== 'Draft') throw _error(ERR.VALIDATION, 'Run is not Draft.');
    if (String(run.preparedBy) === String(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Cannot verify your own run.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Verified');
    sheet.getRange(idx + 2, col['verifiedBy'], 1, 1).setValue(boot.user.userId);
    sheet.getRange(idx + 2, col['verifiedAt'], 1, 1).setValue(now);
    _audit(boot.user.userId, 'pay.verify', 'PayrollRuns', runId, {}, {});
  } else if (stage === 'approve') {
    if (!canAppr) throw _error(ERR.FORBIDDEN, 'Cannot approve payroll.');
    if (run.status !== 'Verified') throw _error(ERR.VALIDATION, 'Run is not Verified.');
    if (_getProp('SETTINGS.payroll.ceoApproval') === '0' && !_isSuperAdmin(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'CEO approval not required / not enabled.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Approved');
    sheet.getRange(idx + 2, col['approvedBy'], 1, 1).setValue(boot.user.userId);
    sheet.getRange(idx + 2, col['approvedAt'], 1, 1).setValue(now);
    _audit(boot.user.userId, 'pay.approve', 'PayrollRuns', runId, {}, {});
  } else if (stage === 'release') {
    if (!canRel) throw _error(ERR.FORBIDDEN, 'Cannot release payroll.');
    if (run.status !== 'Approved' && run.status !== 'Verified') throw _error(ERR.VALIDATION, 'Run is not approved.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Released');
    sheet.getRange(idx + 2, col['releasedBy'], 1, 1).setValue(boot.user.userId);
    sheet.getRange(idx + 2, col['releasedAt'], 1, 1).setValue(now);
    // generate payslips + notify employees
    _generatePayslips(runId, run.yearMonth, boot.user.userId);
    _audit(boot.user.userId, 'pay.release', 'PayrollRuns', runId, {}, {});
  } else if (stage === 'hold') {
    if (!canRel) throw _error(ERR.FORBIDDEN, 'Cannot hold payroll.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('On Hold');
    _audit(boot.user.userId, 'pay.hold', 'PayrollRuns', runId, {}, {});
  } else if (stage === 'unhold') {
    if (!canRel) throw _error(ERR.FORBIDDEN, 'Cannot unhold payroll.');
    sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Approved');
    _audit(boot.user.userId, 'pay.unhold', 'PayrollRuns', runId, {}, {});
  } else {
    throw _error(ERR.VALIDATION, 'Unknown stage.');
  }
  delete _rowCache[_sheetKey(db, 'PayrollRuns')];
  _flushAudit();
  _flushNotifications();
  return _result(true, { runId: runId, status: stage === 'verify' ? 'Verified' : stage === 'approve' ? 'Approved' : stage === 'release' ? 'Released' : stage === 'hold' ? 'On Hold' : 'Approved' });
}

function _generatePayslips(runId, ym, generatedBy) {
  var db = _openCoreDb();
  var itemSheet = _getOrCreateSheet(db, 'PayrollItems');
  var items = _readSheet(db, 'PayrollItems').rows.filter(function (r) { return r.runId === runId; });
  var psSheet = _getOrCreateSheet(db, 'Payslips');
  if (psSheet.getLastRow() === 0) psSheet.getRange(1, 1, 1, PAYSLIP_HEADERS.length).setValues([PAYSLIP_HEADERS]);
  var rootId = _getProp(PROP.ROOT_FOLDER);
  if (!rootId) return;
  var root = DriveApp.getFolderById(rootId);
  var psFolder = _getOrCreateFolder(_getOrCreateFolder(root, 'Payslips'), ym);
  var empMap = {}; _readSheet(db, 'Employees').rows.forEach(function (e) { empMap[e.empId] = e; });
  var count = 0;
  items.forEach(function (it) {
    var e = empMap[it.empId] || {};
    var html = '<h3>Payslip — ' + ym + '</h3><p>' + escHtml(e.name || '') + ' (' + escHtml(it.empId) + ')</p>'
      + '<table border=1><tr><td>Basic</td><td>' + it.basic + '</td></tr>'
      + '<tr><td>HRA</td><td>' + it.hra + '</td></tr>'
      + '<tr><td>Gross</td><td>' + it.gross + '</td></tr>'
      + '<tr><td>PF</td><td>' + it.pfEmp + '</td></tr>'
      + '<tr><td>ESI</td><td>' + it.esiEmp + '</td></tr>'
      + '<tr><td>PT</td><td>' + it.pt + '</td></tr>'
      + '<tr><td>TDS</td><td>' + it.tds + '</td></tr>'
      + '<tr><td><b>Net Pay</b></td><td><b>' + it.netPay + '</b></td></tr></table>';
    var blob = Utilities.newBlob(html, 'text/html', 'payslip.html');
    var pdf = blob.getAs('application/pdf');
    var file = psFolder.createFile(pdf).setName('Payslip_' + it.empId + '_' + ym + '.pdf');
    _appendRows(psSheet, [[_uid(), runId, it.empId, ym, file.getId(), _nowStr()]]);
    count++;
  });
  delete _rowCache[_sheetKey(db, 'Payslips')];
  return count;
}
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// ---------- Payslip get ----------

function pay_payslip_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  var ym = payload.yearMonth || _todayStr().slice(0, 7);
  var db = _openCoreDb();
  var rows = _readSheet(db, 'Payslips').rows.filter(function (r) {
    return r.empId === empId && String(r.yearMonth) === String(ym) && r.deleted !== '1';
  });
  if (!rows.length) throw _error(ERR.NOT_FOUND, 'Payslip not found.');
  var fileId = rows[0].pdfFileId;
  var data = { fileId: fileId, empId: empId, yearMonth: ym };
  if (!_can(boot.user, 'payslip.view', 'company') && empId !== _findEmployeeByUserId(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Cannot view this payslip.');
  return _result(true, data);
}

// ---------- Statutory exports ----------

function pay_bankfile_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.release', 'company')) throw _error(ERR.FORBIDDEN, 'Accounts only.');
  var runId = payload.runId;
  var db = _openCoreDb();
  var items = _readSheet(db, 'PayrollItems').rows.filter(function (r) { return r.runId === runId && r.hold !== '1'; });
  var empMap = {}; _readSheet(db, 'Employees').rows.forEach(function (e) { empMap[e.empId] = e; });
  var lines = ['empId,empCode,name,bank,account,ifsc,netPay'];
  items.forEach(function (it) {
    var e = empMap[it.empId] || {};
    lines.push([it.empId, e.empCode || '', e.name || '', e.bank || '', e.account || '', e.ifsc || '', it.netPay].join(','));
  });
  return _result(true, { csv: lines.join('\n'), fileName: 'bank_' + payload.yearMonth + '.csv' });
}
function pay_pfecr_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'statutory.export', 'company')) throw _error(ERR.FORBIDDEN, 'Accounts only.');
  var runId = payload.runId;
  var db = _openCoreDb();
  var items = _readSheet(db, 'PayrollItems').rows.filter(function (r) { return r.runId === runId; });
  var lines = [];
  items.forEach(function (it) {
    lines.push(it.empId + '#~#' + it.pfEmp + '#~#' + it.pfEps);
  });
  return _result(true, { text: lines.join('\n'), fileName: 'pf_ecr_' + payload.yearMonth + '.txt' });
}
function pay_esi_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'statutory.export', 'company')) throw _error(ERR.FORBIDDEN, 'Accounts only.');
  var runId = payload.runId;
  var db = _openCoreDb();
  var items = _readSheet(db, 'PayrollItems').rows.filter(function (r) { return r.runId === runId; });
  var lines = ['empId,empCode,name,gross,esiEmp,esiErn'];
  items.forEach(function (it) {
    lines.push([it.empId, '', '', it.gross, it.esiEmp, it.esiErn].join(','));
  });
  return _result(true, { csv: lines.join('\n'), fileName: 'esi_' + payload.yearMonth + '.csv' });
}
function pay_runs_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'payroll.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'PayrollRuns').rows.filter(function (r) { return r.deleted !== '1'; });
  return _result(true, { rows: rows });
}
function daysInMonthOf(ym) {
  var p = ym.split('-'); return new Date(Number(p[0]), Number(p[1]), 0).getDate();
}
