/**
 * ============================================================================
 *  FocusHR  —  Code.gs
 *  Web app entry points + the single server API used by the browser.
 *
 *  The browser only ever calls:
 *        api(action, token, payload)
 *  and always receives exactly one of:
 *        { ok: true,  data:  {...} }
 *        { ok: false, error: { code, message, details } }
 * ============================================================================
 */

/* ============================================================== web app == */
function doGet(e) {
  return Code.serve_(e || {}, 'GET');
}

function doPost(e) {
  return Code.serve_(e || {}, 'POST');
}

var Code = {

  serve_: function (e, method) {
    var params = e.parameter || {};
    var wantsJson = !!params.action || (method === 'POST' && !!(e.postData && e.postData.contents));
    if (!wantsJson) {
      try {
        return HtmlService.createHtmlOutputFromFile('Index')
          .setTitle(APP.name + ' — ' + APP.tagline)
          .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      } catch (err) {
        return HtmlService.createHtmlOutput(
          '<h2 style="font-family:sans-serif">' + APP.name + ' is almost ready</h2>' +
          '<p style="font-family:sans-serif">Run <b>setupSystem</b> once from the Apps Script editor, then reload this page.</p>' +
          '<p style="font-family:sans-serif;color:#666">' + escapeHtml_(err.message) + '</p>');
      }
    }
    var envelope = Code.readEnvelope_(e);
    var response = Code.run_(envelope.action, envelope.token, envelope.payload, e);
    if (params.asset === 't') {
      return ContentService.createTextOutput(txt_(response.data && response.data.text)).setMimeType(ContentService.MimeType.TEXT);
    }
    return ContentService.createTextOutput(jsonStr_(response)).setMimeType(ContentService.MimeType.JSON);
  },

  readEnvelope_: function (e) {
    var params = e.parameter || {};
    var action = txt_(params.action);
    var token = txt_(params.token);
    var payload = {};
    if (e.postData && e.postData.contents) {
      var body = safeJson_(e.postData.contents, null);
      if (body) {
        action = txt_(body.action || action);
        token = txt_(body.token || token);
        if (body.payload !== undefined) payload = body.payload;
      }
    }
    // GET style: everything except action/token becomes part of the payload
    Object.keys(params).forEach(function (k) {
      if (k === 'action' || k === 'token') return;
      payload[k] = params[k];
    });
    return { action: action, token: token, payload: payload };
  },

  run_: function (action, token, payload, e) {
    var meta = Auth.requestMeta(e);
    var anon = { userId: '', name: 'Guest', scope: 'PUBLIC', companyId: '', employeeId: '', role_code: '', ip: meta.ip, userAgent: meta.userAgent };
    try {
      if (!txt_(action)) fail_('BAD_REQUEST', 'No action was specified.');
      var spec = ACTION_META[action];
      if (!spec) fail_('UNKNOWN_ACTION', 'This action is not available (' + txt_(action) + '). Please refresh the page.');

      var ctx = null;
      if (!spec.pub) {
        ctx = Auth.contextFromToken(token, meta);
        if (Config.systemBool_('maintenance_mode', false) && ctx.scope !== 'SUPER') {
          fail_('MAINTENANCE', APP.name + ' is under maintenance right now. Please try again in a little while.');
        }
      } else {
        ctx = anon;
      }

      if (spec.p) Perm.require(ctx, spec.p);

      if (ctx && ctx.mustChange && PASSWORD_EXEMPT_ACTIONS.indexOf(action) < 0) {
        fail_('PASSWORD_CHANGE_REQUIRED', 'Please set your own password before using the app.');
      }

      var clean = validatePayload_(action, spec.f, payload);
      var handler = HANDLERS[action];
      if (typeof handler !== 'function') fail_('NOT_IMPLEMENTED', 'This feature is not available yet (' + action + ').');
      var out = handler(ctx, clean, meta) ;
      if (out === undefined) out = {};

      if (spec.w && !MEMO.__audited) {
        Audit.write(ctx, {
          module: txt_(action).split('.')[0],
          action: action,
          entity: '',
          entity_id: '',
          after: clean,
          note: 'Completed',
          severity: 'WRITE'
        });
      }
      return { ok: true, data: out === null ? {} : out, at: nowIso_() };
    } catch (err) {
      if (isApiError_(err)) return Code.envelopeError_(err, action);
      var message = txt_(err && err.message);
      try {
        logEvent_('ERROR', 'api:' + action, message, { stack: txt_(err && err.stack).slice(0, 1500), ip: meta.ip });
      } catch (e2) { /* logging must never mask the original error */ }
      return {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Something went wrong on the server. Please try again — if it keeps happening, share reference ' +
            txt_(err && err.message).slice(0, 120) + ' with support.',
          details: { action: action }
        }
      };
    }
  },

  envelopeError_: function (err, action) {
    try {
      if (SENSITIVE_ACTIONS.indexOf(action) >= 0 || txt_(err.code).indexOf('FORBIDDEN') >= 0) {
        logEvent_('WARN', 'api:' + action, 'blocked/failed: ' + err.code + ' ' + err.message, {});
      }
    } catch (e) { /* noop */ }
    return {
      ok: false,
      error: { code: txt_(err.code || 'ERROR'), message: txt_(err.message || 'Request failed.'), details: err.details || null }
    };
  },

  publicUrl_: function () {
    try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
  }
};

/** Actions allowed while the user still has to change the password. */
var PASSWORD_EXEMPT_ACTIONS = [
  'app.bootstrap', 'app.session.info', 'app.changePassword', 'app.logout', 'app.profile.get',
  'notify.list', 'notify.unreadCount', 'notify.markRead', 'auth.bootstrap', 'files.download', 'files.meta'
];

/** The one function the browser bridge calls. */
function api(action, token, payload) {
  return Code.run_(action, token, payload, {
    parameter: { ip: '' },
    userAgent: 'google.script.run',
    postData: null
  });
}

/* ============================================================== handlers = */
var HANDLERS = {

  /* --------------------------------------------------------------- core -- */
  'app.bootstrap': function (ctx, p) {
    var out = {
      app: { name: APP.name, tagline: APP.tagline, version: APP.version, timezone: APP.timezone },
      server_time: nowIso_(), today: todayIso_(),
      flags: Config.publicFlags(),
      announcement: txt_(Config.systemGet('announcement', '')),
      login_options: { company_login: true, employee_login: true, super_login: true }
    };
    if (ctx && ctx.userId) out.session = Auth.sessionInfo(ctx);
    return out;
  },

  'app.health': function (ctx, p) {
    return {
      ok: !!prop_(PROPS.master),
      app: APP.name, version: APP.version, runtime: 'V8',
      timezone: APP.timezone, server_time: nowIso_(),
      setup_at: prop_(PROPS.setupAt)
    };
  },

  'app.session.info': function (ctx) { return Auth.sessionInfo(ctx); },
  'app.changePassword': function (ctx, p) { return Auth.changePassword(ctx, p); },
  'app.logout': function (ctx) { return Auth.logout(ctx); },
  'app.profile.get': function (ctx) { return Profile.get(ctx); },
  'app.profile.save': function (ctx, p) { return Profile.save(ctx, p); },
  'auth.session.ping': function (ctx) { return { alive: true, at: nowIso_(), unread: Notify.unreadCount(ctx).unread }; },

  /* --------------------------------------------------------------- auth -- */
  'auth.bootstrap': function (ctx, p) { return Auth.bootstrap(p); },
  'auth.signup.start': function (ctx, p) { return Auth.signupStart(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.signup.sendOtp': function (ctx, p) { return Auth.signupSendOtp(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.signup.verify': function (ctx, p) { return Auth.signupVerify(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.signup.status': function (ctx, p) { return Auth.signupStatus(p); },
  'auth.login.company': function (ctx, p) { return Auth.loginCompany(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.login.super': function (ctx, p) { return Auth.loginSuper(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.login.employee': function (ctx, p) { return Auth.loginEmployee(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.employee.checkPhone': function (ctx, p) { return Auth.checkPhone(p); },
  'auth.employee.sendOtp': function (ctx, p) { return Auth.employeeSendOtp(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.employee.activate': function (ctx, p) { return Auth.employeeActivate(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.forgot.sendOtp': function (ctx, p) { return Auth.forgotSendOtp(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'auth.forgot.reset': function (ctx, p) { return Auth.forgotReset(p, { ip: ctx.ip, userAgent: ctx.userAgent }); },

  /* ---------------------------------------------------------- super admin */
  'super.dashboard': function (ctx) { return SuperAdmin.dashboard(ctx); },
  'super.companies.list': function (ctx, p) { return SuperAdmin.companiesList(ctx, p); },
  'super.companies.get': function (ctx, p) { return SuperAdmin.companyGet(ctx, p); },
  'super.companies.listBasics': function (ctx) { return SuperAdmin.companiesBasics(ctx); },
  'super.companies.approve': function (ctx, p) { return SuperAdmin.companyApprove(ctx, p); },
  'super.companies.reject': function (ctx, p) { return SuperAdmin.companyReject(ctx, p); },
  'super.companies.setStatus': function (ctx, p) { return SuperAdmin.companySetStatus(ctx, p); },
  'super.companies.update': function (ctx, p) { return SuperAdmin.companyUpdate(ctx, p); },
  'super.companies.resendCredentials': function (ctx, p) { return SuperAdmin.resendCredentials(ctx, p); },
  'super.companies.resetAdminPassword': function (ctx, p) { return SuperAdmin.resetAdminPassword(ctx, p); },
  'super.companies.reprovision': function (ctx, p) { return SuperAdmin.reprovision(ctx, p); },
  'super.impersonate.start': function (ctx, p) { return Auth.impersonateStart(ctx, p, { ip: ctx.ip, userAgent: ctx.userAgent }); },
  'super.impersonate.stop': function (ctx) { return Auth.impersonateStop(ctx); },
  'super.subscriptions.list': function (ctx, p) { return SuperAdmin.subscriptionsList(ctx, p); },
  'super.subscriptions.save': function (ctx, p) { return SuperAdmin.subscriptionsSave(ctx, p); },
  'super.revenue.list': function (ctx, p) { return SuperAdmin.revenueList(ctx, p); },
  'super.revenue.save': function (ctx, p) { return SuperAdmin.revenueSave(ctx, p); },
  'super.config.list': function (ctx) { return Config.list(); },
  'super.config.save': function (ctx, p) { return SuperAdmin.configSave(ctx, p); },
  'super.tickets.list': function (ctx, p) { return SuperAdmin.ticketsList(ctx, p); },
  'super.tickets.get': function (ctx, p) { return SuperAdmin.ticketGet(ctx, p); },
  'super.tickets.reply': function (ctx, p) { return SuperAdmin.ticketReply(ctx, p); },
  'super.audit.list': function (ctx, p) { return Audit.list(ctx, p); },
  'super.logs.list': function (ctx, p) { return SuperAdmin.logsList(ctx, p); },
  'super.diagnostics': function (ctx) { return SuperAdmin.diagnostics(ctx); },
  'super.demo.seed': function (ctx, p) { return Demo.seed(ctx, p); },
  'super.demo.reset': function (ctx, p) { return Demo.reset(ctx, p); },
  'super.email.queue': function (ctx, p) { return SuperAdmin.emailQueue(ctx, p); },
  'super.email.flush': function (ctx) { return Notify.flushQueue(50); },

  /* -------------------------------------------------------------- company */
  'company.bootstrap': function (ctx) { return Company.bootstrap(ctx); },
  'company.settings.get': function (ctx) { return Company.settingsGet(ctx); },
  'company.settings.save': function (ctx, p) { return Company.settingsSave(ctx, p); },
  'company.profile.save': function (ctx, p) { return Company.profileSave(ctx, p); },
  'company.branches.list': function (ctx, p) { return Company.branchesList(ctx, p); },
  'company.branches.save': function (ctx, p) { return Company.branchesSave(ctx, p); },
  'company.branches.delete': function (ctx, p) { return Company.branchesDelete(ctx, p); },
  'company.roles.list': function (ctx) { return Company.rolesList(ctx); },
  'company.roles.get': function (ctx, p) { return Company.rolesGet(ctx, p); },
  'company.roles.save': function (ctx, p) { return Company.rolesSave(ctx, p); },
  'company.roles.delete': function (ctx, p) { return Company.rolesDelete(ctx, p); },
  'company.overrides.list': function (ctx, p) { return Company.overridesList(ctx, p); },
  'company.overrides.save': function (ctx, p) { return Company.overridesSave(ctx, p); },
  'company.overrides.delete': function (ctx, p) { return Company.overridesDelete(ctx, p); },
  'company.users.list': function (ctx, p) { return Company.usersList(ctx, p); },
  'company.users.save': function (ctx, p) { return Company.usersSave(ctx, p); },
  'company.users.delete': function (ctx, p) { return Company.usersDelete(ctx, p); },
  'company.users.resetPassword': function (ctx, p) { return Company.usersResetPassword(ctx, p); },
  'company.holidays.list': function (ctx, p) { return Company.holidaysList(ctx, p); },
  'company.holidays.save': function (ctx, p) { return Company.holidaysSave(ctx, p); },
  'company.holidays.delete': function (ctx, p) { return Company.holidaysDelete(ctx, p); },
  'company.leavetypes.list': function (ctx) { return Company.leaveTypesList(ctx); },
  'company.leavetypes.save': function (ctx, p) { return Company.leaveTypesSave(ctx, p); },
  'company.leavetypes.delete': function (ctx, p) { return Company.leaveTypesDelete(ctx, p); },
  'company.expensecategories.list': function (ctx) { return Company.expenseCategoriesList(ctx); },
  'company.expensecategories.save': function (ctx, p) { return Company.expenseCategoriesSave(ctx, p); },
  'company.expensecategories.delete': function (ctx, p) { return Company.expenseCategoriesDelete(ctx, p); },
  'company.payrollrates.get': function (ctx) { return Company.payrollRatesGet(ctx); },
  'company.payrollrates.save': function (ctx, p) { return Company.payrollRatesSave(ctx, p); },

  /* ------------------------------------------------------------ employees */
  'employees.list': function (ctx, p) { return Employees.list(ctx, p); },
  'employees.get': function (ctx, p) { return Employees.get(ctx, p); },
  'employees.save': function (ctx, p) { return Employees.save(ctx, p); },
  'employees.delete': function (ctx, p) { return Employees.remove(ctx, p); },
  'employees.exit': function (ctx, p) { return Employees.exit(ctx, p); },
  'employees.import.preview': function (ctx, p) { return Employees.importPreview(ctx, p); },
  'employees.import.commit': function (ctx, p) { return Employees.importCommit(ctx, p); },
  'employees.documents.list': function (ctx, p) { return Employees.documentsList(ctx, p); },
  'employees.documents.save': function (ctx, p) { return Employees.documentsSave(ctx, p); },
  'employees.documents.verify': function (ctx, p) { return Employees.documentsVerify(ctx, p); },
  'employees.documents.delete': function (ctx, p) { return Employees.documentsDelete(ctx, p); },
  'employees.salary.get': function (ctx, p) { return Employees.salaryGet(ctx, p); },
  'employees.salary.save': function (ctx, p) { return Employees.salarySave(ctx, p); },
  'employees.salary.delete': function (ctx, p) { return Employees.salaryDelete(ctx, p); },
  'employees.bulkAssignProject': function (ctx, p) { return Projects.bulkAssign(ctx, p); },
  'employees.directory': function (ctx, p) { return Employees.directory(ctx, p); },

  /* ------------------------------------------------------------- projects */
  'projects.list': function (ctx, p) { return Projects.list(ctx, p); },
  'projects.get': function (ctx, p) { return Projects.get(ctx, p); },
  'projects.save': function (ctx, p) { return Projects.save(ctx, p); },
  'projects.delete': function (ctx, p) { return Projects.remove(ctx, p); },
  'projects.location.lock': function (ctx, p) { return Projects.locationLock(ctx, p); },
  'projects.team': function (ctx, p) { return Projects.team(ctx, p); },
  'projects.assign': function (ctx, p) { return Projects.assign(ctx, p); },
  'projects.unassign': function (ctx, p) { return Projects.unassign(ctx, p); },
  'projects.transfer.create': function (ctx, p) { return Projects.transferCreate(ctx, p); },
  'projects.transfer.list': function (ctx, p) { return Projects.transferList(ctx, p); },
  'projects.transfer.decide': function (ctx, p) { return Projects.transferDecide(ctx, p); },
  'projects.nearby': function (ctx, p) { return Projects.nearby(ctx, p); },

  /* ----------------------------------------------------------- attendance */
  'attendance.context': function (ctx) { return Attendance.context(ctx); },
  'attendance.today': function (ctx) { return Attendance.today(ctx); },
  'attendance.punch.in': function (ctx, p) { return Attendance.punchIn(ctx, p); },
  'attendance.punch.out': function (ctx, p) { return Attendance.punchOut(ctx, p); },
  'attendance.list': function (ctx, p) { return Attendance.list(ctx, p); },
  'attendance.my': function (ctx, p) { return Attendance.my(ctx, p); },
  'attendance.manual.save': function (ctx, p) { return Attendance.manualSave(ctx, p); },
  'attendance.manual.bulk': function (ctx, p) { return Attendance.manualBulk(ctx, p); },
  'attendance.regularize.request': function (ctx, p) { return Attendance.regularizeRequest(ctx, p); },
  'attendance.regularize.list': function (ctx, p) { return Attendance.regularizeList(ctx, p); },
  'attendance.regularize.my': function (ctx, p) { return Attendance.regularizeMy(ctx, p); },
  'attendance.regularize.decide': function (ctx, p) { return Attendance.regularizeDecide(ctx, p); },
  'attendance.summary': function (ctx, p) { return Attendance.summary(ctx, p); },
  'attendance.month': function (ctx, p) { return Attendance.month(ctx, p); },
  'attendance.flag.review': function (ctx, p) { return Attendance.flagReview(ctx, p); },

  /* ---------------------------------------------------------------- leave */
  'leave.types.list': function (ctx) { return Leave.typesList(ctx); },
  'leave.balances.list': function (ctx, p) { return Leave.balancesList(ctx, p); },
  'leave.balances.my': function (ctx, p) { return Leave.balancesMy(ctx, p); },
  'leave.balances.save': function (ctx, p) { return Leave.balancesSave(ctx, p); },
  'leave.balances.accrue': function (ctx, p) { return Leave.balancesAccrue(ctx, p); },
  'leave.requests.list': function (ctx, p) { return Leave.requestsList(ctx, p); },
  'leave.requests.my': function (ctx, p) { return Leave.requestsMy(ctx, p); },
  'leave.apply': function (ctx, p) { return Leave.apply(ctx, p); },
  'leave.decide': function (ctx, p) { return Leave.decide(ctx, p); },
  'leave.cancel': function (ctx, p) { return Leave.cancel(ctx, p); },
  'leave.calendar': function (ctx, p) { return Leave.calendar(ctx, p); },
  'leave.special.list': function (ctx, p) { return Leave.specialList(ctx, p); },
  'leave.special.my': function (ctx, p) { return Leave.specialMy(ctx, p); },
  'leave.special.create': function (ctx, p) { return Leave.specialCreate(ctx, p); },
  'leave.special.decide': function (ctx, p) { return Leave.specialDecide(ctx, p); },
  'leave.holidays.list': function (ctx, p) { return Leave.holidaysList(ctx, p); },

  /* -------------------------------------------------------------- expense */
  'expense.categories.list': function (ctx) { return Expense.categoriesList(ctx); },
  'expense.claims.list': function (ctx, p) { return Expense.claimsList(ctx, p); },
  'expense.claims.my': function (ctx, p) { return Expense.claimsMy(ctx, p); },
  'expense.claims.get': function (ctx, p) { return Expense.claimGet(ctx, p); },
  'expense.claims.save': function (ctx, p) { return Expense.claimSave(ctx, p); },
  'expense.claims.submit': function (ctx, p) { return Expense.claimSubmit(ctx, p); },
  'expense.claims.decide': function (ctx, p) { return Expense.claimDecide(ctx, p); },
  'expense.claims.bulkDecide': function (ctx, p) { return Expense.claimsBulkDecide(ctx, p); },
  'expense.claims.delete': function (ctx, p) { return Expense.claimDelete(ctx, p); },
  'expense.claims.markPaid': function (ctx, p) { return Expense.claimsMarkPaid(ctx, p); },
  'expense.summary': function (ctx, p) { return Expense.summary(ctx, p); },

  /* -------------------------------------------------------------- payroll */
  'payroll.runs.list': function (ctx, p) { return Payroll.runsList(ctx, p); },
  'payroll.runs.get': function (ctx, p) { return Payroll.runGet(ctx, p); },
  'payroll.runs.create': function (ctx, p) { return Payroll.runCreate(ctx, p); },
  'payroll.precheck': function (ctx, p) { return Payroll.precheck(ctx, p); },
  'payroll.calculate.start': function (ctx, p) { return Payroll.calculateStart(ctx, p); },
  'payroll.calculate.progress': function (ctx, p) { return Payroll.calculateProgress(ctx, p); },
  'payroll.calculate.resume': function (ctx, p) { return Payroll.calculateResume(ctx, p); },
  'payroll.runs.items': function (ctx, p) { return Payroll.items(ctx, p); },
  'payroll.item.update': function (ctx, p) { return Payroll.itemUpdate(ctx, p); },
  'payroll.runs.approve': function (ctx, p) { return Payroll.runApprove(ctx, p); },
  'payroll.runs.cancel': function (ctx, p) { return Payroll.runCancel(ctx, p); },
  'payroll.markPaid': function (ctx, p) { return Payroll.markPaid(ctx, p); },
  'payroll.selftest': function () { return PayrollCalc.selfTest(); },
  'payroll.rates.get': function (ctx) { return Company.payrollRatesGet(ctx); },
  'payroll.my.payslips': function (ctx, p) { return Payslip.myPayslips(ctx, p); },
  'payroll.my.summary': function (ctx) { return Payroll.mySummary(ctx); },
  'payroll.payslips.list': function (ctx, p) { return Payslip.list(ctx, p); },
  'payroll.payslip.get': function (ctx, p) { return Payslip.get(ctx, p); },
  'payroll.payslip.generate': function (ctx, p) { return Payslip.generate(ctx, p); },
  'payroll.payslip.bulkGenerate': function (ctx, p) { return Payslip.bulkGenerate(ctx, p); },
  'payroll.payslip.email': function (ctx, p) { return Payslip.email(ctx, p); },
  'payroll.payslip.delete': function (ctx, p) { return Payslip.remove(ctx, p); },

  /* -------------------------------------------------------------- reports */
  'reports.catalog': function (ctx) { return Reports.catalog(ctx); },
  'reports.run': function (ctx, p) { return Reports.run(ctx, p); },
  'reports.export': function (ctx, p) { return Reports.exportReport(ctx, p); },
  'dashboard.company': function (ctx) { return Dashboard.company(ctx); },
  'dashboard.employee': function (ctx) { return Dashboard.employee(ctx); },
  'dashboard.manager': function (ctx) { return Dashboard.manager(ctx); },
  'dashboard.layout.get': function (ctx) { return Dashboard.layoutGet(ctx); },
  'dashboard.layout.save': function (ctx, p) { return Dashboard.layoutSave(ctx, p); },

  /* ------------------------------------------------------------ documents */
  'documents.list': function (ctx, p) { return Documents.list(ctx, p); },
  'documents.save': function (ctx, p) { return Documents.save(ctx, p); },
  'documents.newVersion': function (ctx, p) { return Documents.newVersion(ctx, p); },
  'documents.delete': function (ctx, p) { return Documents.remove(ctx, p); },
  'documents.my': function (ctx, p) { return Documents.my(ctx, p); },
  'documents.templates.list': function (ctx) { return Documents.templatesList(ctx); },
  'documents.templates.save': function (ctx, p) { return Documents.templatesSave(ctx, p); },
  'documents.templates.reset': function (ctx) { return Documents.templatesReset(ctx); },
  'documents.letters.list': function (ctx, p) { return Documents.lettersList(ctx, p); },
  'documents.letters.my': function (ctx, p) { return Documents.lettersMy(ctx, p); },
  'documents.letters.generate': function (ctx, p) { return Documents.letterGenerate(ctx, p); },
  'documents.letters.preview': function (ctx, p) { return Documents.letterPreview(ctx, p); },

  /* -------------------------------------------------------------- support */
  'support.tickets.list': function (ctx, p) { return Support.ticketsList(ctx, p); },
  'support.tickets.get': function (ctx, p) { return Support.ticketGet(ctx, p); },
  'support.tickets.create': function (ctx, p) { return Support.ticketCreate(ctx, p); },
  'support.tickets.reply': function (ctx, p) { return Support.ticketReply(ctx, p); },
  'support.tickets.update': function (ctx, p) { return Support.ticketUpdate(ctx, p); },
  'support.platform.list': function (ctx, p) { return Support.platformList(ctx, p); },
  'support.platform.create': function (ctx, p) { return Support.platformCreate(ctx, p); },
  'support.platform.reply': function (ctx, p) { return Support.platformReply(ctx, p); },

  /* ------------------------------------------------------- notify & files */
  'notify.list': function (ctx, p) { return Notify.list(ctx, p); },
  'notify.markRead': function (ctx, p) { return Notify.markRead(ctx, p); },
  'notify.unreadCount': function (ctx) { return Notify.unreadCount(ctx); },
  'notify.test': function (ctx, p) { return Notify.testSend(ctx, p); },
  'files.upload.begin': function (ctx, p) { return Files.uploadBegin(ctx, p); },
  'files.upload.chunk': function (ctx, p) { return Files.uploadChunk(ctx, p); },
  'files.upload.finish': function (ctx, p) { return Files.uploadFinish(ctx, p); },
  'files.upload.cancel': function (ctx, p) { return Files.uploadCancel(ctx, p); },
  'files.download': function (ctx, p) { return Files.download(ctx, p); },
  'files.meta': function (ctx, p) { return Files.meta(ctx, p); },
  'files.delete': function (ctx, p) { return Files.remove(ctx, p); },
  'files.companyTree': function (ctx) { return Files.companyTree(ctx); },

  /* ---------------------------------------------------------------- audit */
  'audit.list': function (ctx, p) { return Audit.list(ctx, p); },
  'audit.export': function (ctx, p) { return Reports.exportAudit(ctx, p); },
  'audit.sensitive': function (ctx, p) { return Audit.sensitiveList(ctx, p); },

  /* --------------------------------------------------------------- system */
  'system.bootstrapAdmin': function (ctx, p) { return SuperAdmin.bootstrapAdmin(ctx, p); },
  'system.health': function (ctx) {
    var h = Setup.health();
    if (ctx.companyCtx) {
      h.company_sheet = ctx.companyCtx.ss.getUrl();
      h.company_tables = Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'COMPANY'; }).length;
    }
    return h;
  },
  'system.maintenance': function (ctx, p) { return SuperAdmin.maintenance(ctx, p); }
};
