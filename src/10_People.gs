/**
 * FocusOn HRMS 2.0 — People (10_People.gs)
 * Documents & letters (templates, generate, vault), recruitment, onboarding,
 * performance, exit & Full & Final.
 */

var DOC_TEMPLATE_HEADERS = ['templateId', 'name', 'category', 'content', 'placeholders', 'needsApproval', 'active'];
var DOC_HEADERS = ['docId', 'templateId', 'empId', 'docNumber', 'version', 'status', 'pdfFileId', 'generatedBy', 'generatedAt'];
var EMPDOC_HEADERS = ['empDocId', 'empId', 'name', 'fileId', 'type', 'expiryDate', 'verified', 'uploadedAt'];
var JOB_HEADERS = ['jobId', 'title', 'department', 'branch', 'positions', 'ctcMin', 'ctcMax', 'description', 'status', 'createdBy', 'createdAt'];
var CAND_HEADERS = ['candId', 'jobId', 'name', 'email', 'phone', 'resumeFileId', 'source', 'stage', 'status', 'createdAt'];
var INTERVIEW_HEADERS = ['interviewId', 'candId', 'round', 'date', 'interviewer', 'feedback', 'rating', 'createdAt'];
var ONBOARD_HEADERS = ['onboardId', 'empId', 'task', 'owner', 'dueDate', 'status', 'createdAt'];
var PERF_CYCLE_HEADERS = ['cycleId', 'name', 'startDate', 'endDate', 'status', 'createdAt'];
var PERF_GOAL_HEADERS = ['goalId', 'cycleId', 'empId', 'kra', 'weightage', 'status', 'createdAt'];
var PERF_REVIEW_HEADERS = ['reviewId', 'cycleId', 'empId', 'stage', 'reviewer', 'score', 'comments', 'createdAt'];
var EXIT_HEADERS = ['exitId', 'empId', 'type', 'resignationDate', 'lastWorkingDay', 'noticeServed', 'noticeRequired', 'status', 'createdBy', 'createdAt'];
var EXIT_TASK_HEADERS = ['taskId', 'exitId', 'owner', 'task', 'status', 'dueDate', 'completedAt'];
var FNF_HEADERS = ['fnfId', 'empId', 'salaryTillLwd', 'leaveEncash', 'gratuity', 'noticePay', 'loanRecovery', 'total', 'status', 'createdAt'];

// ---------- Document templates ----------

function doc_templates_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'doc.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _readSheet(_openCoreDb(), 'DocTemplates').rows.filter(function (r) { return r.active !== '0'; });
  return _result(true, { rows: rows });
}
function doc_templatesave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'doctemplate.manage', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  return _masterSave('DocTemplates', DOC_TEMPLATE_HEADERS, 'templateId', payload, 'doc.template.save');
}
// default templates seed is in system module

// ---------- Generate letter ----------

function doc_generate_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'doc.generate.employment', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var templateId = payload.templateId;
  var empId = payload.empId;
  var db = _openCoreDb();
  var templates = _readSheet(db, 'DocTemplates').rows;
  var tmpl = null;
  for (var i = 0; i < templates.length; i++) if (String(templates[i].templateId) === String(templateId)) { tmpl = templates[i]; break; }
  if (!tmpl) throw _error(ERR.NOT_FOUND, 'Template not found.');
  var emp = _findEmployeeById(empId);
  if (!emp) throw _error(ERR.NOT_FOUND, 'Employee not found.');
  var content = tmpl.content || '';
  content = content.replace(/\{\{(emp|employee)\.(name|code|designation|department|branch|empId|empCode|doj|salary|gross|basic|joinDate)\}\}/g, function (m, a, b) {
    var v = '';
    if (b === 'name') v = emp.name || '';
    if (b === 'code' || b === 'empCode') v = emp.empCode || '';
    if (b === 'empId') v = emp.empId || '';
    if (b === 'designation') v = emp.designationId || '';
    if (b === 'department') v = emp.departmentId || '';
    if (b === 'branch') v = emp.branchId || '';
    if (b === 'doj' || b === 'joinDate') v = emp.doj || '';
    return v;
  });
  content = content.replace(/\{\{(salary|structure)\.(basic|hra|gross|net)\}\}/g, function (m, a, b) {
    var v = '';
    // simplified: from salary structure latest
    var structs = _readSheet(db, 'SalaryStructures').rows.filter(function (s) { return s.empId === empId; });
    var s = structs[structs.length - 1] || {};
    if (b === 'basic') v = s.basic || '';
    if (b === 'hra') v = s.hra || '';
    if (b === 'gross') v = s.gross || '';
    if (b === 'net') v = s.gross || '';
    return v;
  });
  content = content.replace(/\{\{date\}\}/g, _todayStr());
  var needsApproval = tmpl.needsApproval === '1';
  var status = needsApproval ? 'Draft' : 'Final';
  var docNumber = 'FO/HR/' + _todayStr().slice(0, 4) + '/' + String(Number(_getProp('DOC.COUNTER') || 0) + 1).padStart(4, '0');
  _setProp('DOC.COUNTER', String(Number(_getProp('DOC.COUNTER') || 0) + 1));
  var pdfFileId = '';
  if (!needsApproval) {
    pdfFileId = _saveLetterPdf(db, content, docNumber, empId);
  }
  var docSheet = _getOrCreateSheet(db, 'Documents');
  if (docSheet.getLastRow() === 0) docSheet.getRange(1, 1, 1, DOC_HEADERS.length).setValues([DOC_HEADERS]);
  var now = _nowStr();
  _appendRows(docSheet, [[_uid(), templateId, empId, docNumber, '1', status, pdfFileId, boot.user.userId, now]]);
  delete _rowCache[_sheetKey(db, 'Documents')];
  if (needsApproval) {
    // notify executive
    var sas = String(_getProp(PROP.SUPER_ADMINS) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    sas.forEach(function (sa) { _notify(sa, 'Letter ' + docNumber + ' (' + tmpl.name + ') awaits your approval.', 'document', docNumber); });
    _flushNotifications();
  }
  _audit(boot.user.userId, 'doc.generate', 'Documents', docNumber, {}, { template: tmpl.name, status: status });
  _flushAudit();
  return _result(true, { docId: docNumber, status: status, pdfFileId: pdfFileId, message: needsApproval ? 'Draft created — awaiting approval.' : 'Letter generated.' });
}

function _saveLetterPdf(db, content, docNumber, empId) {
  var rootId = _getProp(PROP.ROOT_FOLDER);
  if (!rootId) return '';
  var root = DriveApp.getFolderById(rootId);
  var folder = _getOrCreateFolder(_getOrCreateFolder(root, 'Letters'), String(_todayStr().slice(0, 4)));
  var html = '<html><body style="font-family:sans-serif">' + content + '</body></html>';
  var blob = Utilities.newBlob(html, 'text/html', 'letter.html');
  var pdf = blob.getAs('application/pdf');
  return folder.createFile(pdf).setName(docNumber + '.pdf').getId();
}

// ---------- Document approval (DRAFT watermark -> final) ----------

function doc_approve_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'doc.approve', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var docNumber = payload.docNumber;
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Documents');
  var rows = _readSheet(db, 'Documents').rows;
  var hdrs = _readSheet(db, 'Documents').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].docNumber) === String(docNumber)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'Document not found.');
  var doc = rows[idx];
  if (doc.status !== 'Draft') throw _error(ERR.VALIDATION, 'Document is not a draft.');
  // regenerate pdf with final (no draft watermark) — simplified: mark final
  sheet.getRange(idx + 2, col['status'], 1, 1).setValue('Final');
  sheet.getRange(idx + 2, col['version'], 1, 1).setValue(String(Number(doc.version || 1) + 1));
  delete _rowCache[_sheetKey(db, 'Documents')];
  _audit(boot.user.userId, 'doc.approve', 'Documents', docNumber, {}, {});
  _notify(doc.generatedBy, 'Your letter ' + docNumber + ' has been approved and finalized.', 'document');
  _flushNotifications();
  _flushAudit();
  return _result(true, { docNumber: docNumber, status: 'Final' });
}

// ---------- Employee document vault ----------

function empdoc_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'employee.docs', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  var rows = _readSheet(_openCoreDb(), 'EmpDocs').rows.filter(function (r) { return r.empId === empId && r.deleted !== '1'; });
  return _result(true, { rows: rows });
}
function empdoc_upload_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'employee.docs', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!payload.fileId) throw _error(ERR.VALIDATION, 'No file.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'EmpDocs');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, EMPDOC_HEADERS.length).setValues([EMPDOC_HEADERS]);
  _appendRows(sheet, [[_uid(), empId, payload.name || 'Document', payload.fileId, payload.type || 'Other', payload.expiryDate || '', payload.verified || '0', _nowStr()]]);
  delete _rowCache[_sheetKey(db, 'EmpDocs')];
  return _result(true, { message: 'Document uploaded.' });
}

// ---------- Recruitment ----------

function recruit_jobs_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'Jobs').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function recruit_jobsave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.create', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('Jobs', JOB_HEADERS, 'jobId', payload, 'recruit.job.save');
}
function recruit_candidates_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'Candidates').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function recruit_candidatesave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.create', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('Candidates', CAND_HEADERS, 'candId', payload, 'recruit.candidate.save');
}
function recruit_interviews_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'Interviews').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function recruit_interviewsave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'recruit.create', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('Interviews', INTERVIEW_HEADERS, 'interviewId', payload, 'recruit.interview.save');
}

// ---------- Onboarding ----------

function onboard_tasks_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'onboarding.manage', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'OnboardTasks').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function onboard_taskssave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'onboarding.manage', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('OnboardTasks', ONBOARD_HEADERS, 'onboardId', payload, 'onboard.task.save');
}

// ---------- Performance ----------

function perf_cycles_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'PerfCycles').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function perf_cyclesave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.cycle.manage', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  return _masterSave('PerfCycles', PERF_CYCLE_HEADERS, 'cycleId', payload, 'perf.cycle.save');
}
function perf_goals_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'PerfGoals').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function perf_goalsave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.goal.set', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('PerfGoals', PERF_GOAL_HEADERS, 'goalId', payload, 'perf.goal.save');
}
function perf_reviews_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'PerfReviews').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function perf_reviewsave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'perf.review', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('PerfReviews', PERF_REVIEW_HEADERS, 'reviewId', payload, 'perf.review.save');
}

// ---------- Exit & F&F ----------

function exit_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'exit.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { rows: _readSheet(_openCoreDb(), 'Exits').rows.filter(function (r) { return r.deleted !== '1'; }) });
}
function exit_save_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'exit.initiate', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  return _masterSave('Exits', EXIT_HEADERS, 'exitId', payload, 'exit.save');
}
function exit_taskssave_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'exit.clearance', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _masterSave('ExitTasks', EXIT_TASK_HEADERS, 'taskId', payload, 'exit.task.save');
}
function fnf_save_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'fnf.prepare', 'company')) throw _error(ERR.FORBIDDEN, 'Accounts/HR only.');
  return _masterSave('FnF', FNF_HEADERS, 'fnfId', payload, 'fnf.save');
}
