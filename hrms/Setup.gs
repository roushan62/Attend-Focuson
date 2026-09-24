/**
 * ============================================================================
 *  FocusHR  —  Setup.gs
 *  One-time platform installation.
 *
 *  HOW TO RUN (non-developers: follow the deployment guide in README.md)
 *    1. Open the Apps Script project, pick the function  setupSystem
 *    2. Press Run, accept the Google permission prompt
 *    3. Open "Execution log" — it prints the Super Admin email + temporary
 *       password (also written to the Logs tab of the master spreadsheet).
 * ============================================================================
 */

/**
 * Installs the platform: master spreadsheet, Drive root, platform tables,
 * Super Admin account, default system configuration and housekeeping triggers.
 * Safe to run again — it never deletes existing data.
 */
function setupSystem(options) {
  var o = options && typeof options === 'object' ? options : {};
  var summary = { steps: [], warnings: [], started_at: nowIso_() };
  var step = function (label, detail) { summary.steps.push({ step: label, detail: detail || '' }); Logger.log('• ' + label + (detail ? ' — ' + detail : '')); };
  var warn = function (msg) { summary.warnings.push(msg); Logger.log('! ' + msg); };

  /* 1. master spreadsheet ------------------------------------------------ */
  var masterId = prop_(PROPS.master);
  var master = null;
  if (masterId) {
    try { master = SpreadsheetApp.openById(masterId); } catch (e) { master = null; }
  }
  if (!master && o.master_sheet_id) master = SpreadsheetApp.openById(txt_(o.master_sheet_id));
  if (!master) {
    master = SpreadsheetApp.create(APP.name + ' — Master (' + todayIso_() + ')');
    step('Master spreadsheet created', master.getUrl());
  } else {
    step('Master spreadsheet reused', master.getUrl());
  }
  setProp_(PROPS.master, master.getId());
  try { master.setSpreadsheetTimeZone(APP.timezone); } catch (e) { /* optional */ }

  memoClear_();
  var ctx = masterCtx_();
  var created = createAllTables_(ctx);
  step('Platform tables ready', created.length ? 'created: ' + created.join(', ') : 'all ' + Object.keys(SCHEMA).length + ' tables already existed');

  /* 2. Drive root -------------------------------------------------------- */
  var rootFolder = Files.rootFolder();
  step('Drive root folder', rootFolder.getUrl());

  /* 3. system configuration --------------------------------------------- */
  var cfgItems = SYSTEM_CONFIG_DEFAULTS.map(function (c) { return { key: c.key, value: c.value }; });
  Config.systemSet(cfgItems, 'SETUP');
  step('System configuration seeded', cfgItems.length + ' keys');

  /* 4. Super Admin ------------------------------------------------------- */
  var superEmail = normEmail_(o.super_email || prop_('CFG_SUPER_EMAIL', '') || (Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : ''));
  if (!superEmail) superEmail = 'admin@' + 'focushr.app';
  setProp_('CFG_SUPER_EMAIL', superEmail);
  var existingSuper = Db.findOne(masterCtx_(), 'Users', function (u) { return txt_(u.scope) === 'SUPER' && normEmail_(u.email) === superEmail; });
  var tempPassword = '';
  if (!existingSuper || o.reset_super_password) {
    tempPassword = strongTempPassword_();
    var salt = randomSalt_();
    if (existingSuper) {
      Db.update(masterCtx_(), 'Users', 'user_id', existingSuper.user_id, {
        password_salt: salt, password_hash: hashPassword_(tempPassword, salt), password_set_at: nowIso_(),
        must_change_password: 'TRUE', status: 'ACTIVE', failed_attempts: 0, locked_until: ''
      }, { system: true });
      step('Super Admin password reset', superEmail);
    } else {
      var superUser = Db.insert(masterCtx_(), 'Users', {
        scope: 'SUPER', company_id: '', employee_id: '', name: 'Super Admin', email: superEmail, phone: '',
        password_salt: salt, password_hash: hashPassword_(tempPassword, salt), password_set_at: nowIso_(),
        must_change_password: 'TRUE', status: 'ACTIVE', role_code: 'SUPER_ADMIN', meta_json: jsonStr_({ seeded: nowIso_() })
      }, { system: true });
      step('Super Admin account created', superEmail);
      logEvent_('INFO', 'setup', 'Super Admin created — user_id ' + superUser.user_id, {});
    }
    logEvent_('WARN', 'setup', 'SUPER ADMIN TEMPORARY PASSWORD for ' + superEmail + ' : ' + tempPassword + '  (change it after first login)', { security: true });
    Logger.log('==============================================================');
    Logger.log(' SUPER ADMIN LOGIN');
    Logger.log('   email    : ' + superEmail);
    Logger.log('   password : ' + tempPassword + '   (also saved in the Logs tab)');
    Logger.log('   sign in  : <your web app URL>?admin=1');
    Logger.log('==============================================================');
  } else {
    step('Super Admin already exists', superEmail);
  }

  /* 5. demo company (only when explicitly asked) ------------------------- */
  if (o.create_demo_company) {
    try {
      var demo = Demo.seed(null, { employees: intVal_(o.demo_employees, 12), projects: intVal_(o.demo_projects, 2), months: intVal_(o.demo_months, 2) });
      step('Demo company seeded', txt_(demo.company_name) + ' (' + txt_(demo.company_id) + ')');
    } catch (e) {
      warn('Demo company could not be seeded: ' + e.message);
    }
  }

  /* 6. triggers ---------------------------------------------------------- */
  try {
    var installed = Setup.installTriggers();
    step('Triggers installed', installed.join(', '));
  } catch (e) {
    warn('Triggers could not be installed automatically (' + e.message + '). You can add them later from Triggers → Add trigger → dailyHousekeeping → Time-driven → Day timer.');
  }

  setProp_(PROPS.setupAt, nowIso_());
  setProp_('SETUP_SUMMARY', jsonStr_({ at: nowIso_(), master: master.getId(), root: rootFolder.getId() }));
  summary.master_sheet_id = master.getId();
  summary.master_sheet_url = master.getUrl();
  summary.drive_folder_id = rootFolder.getId();
  summary.drive_folder_url = rootFolder.getUrl();
  summary.super_admin_email = superEmail;
  summary.super_admin_temp_password = tempPassword || '(unchanged — the existing password still works)';
  summary.finished_at = nowIso_();
  Logger.log('\nSetup finished at ' + summary.finished_at + '. You can now deploy the web app (Deploy → New deployment → Web app).');
  return summary;
}

var Setup = {

  /** Time-driven jobs. Idempotent: existing handlers are not duplicated. */
  installTriggers: function () {
    var wanted = ['dailyHousekeeping', 'hourlySweep'];
    var existing = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    var added = [];
    wanted.forEach(function (fn) {
      if (existing.indexOf(fn) >= 0) return;
      try {
        if (fn === 'dailyHousekeeping') ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(2).create();
        else ScriptApp.newTrigger(fn).timeBased().everyHours(1).create();
        added.push(fn);
      } catch (e) {
        logEvent_('WARN', 'Setup.installTriggers', 'Could not create trigger ' + fn + ': ' + e.message, {});
      }
    });
    return added.length ? added : ['already installed'];
  },

  removeTriggers: function () {
    var removed = [];
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var fn = t.getHandlerFunction();
      if (fn === 'dailyHousekeeping' || fn === 'hourlySweep') { ScriptApp.deleteTrigger(t); removed.push(fn); }
    });
    return removed;
  },

  /** Everything a Super Admin needs to know that the platform is healthy. */
  health: function () {
    var h = { at: nowIso_(), app_version: APP.version, ok: true, checks: [] };
    var add = function (name, ok, detail) { h.checks.push({ check: name, ok: !!ok, detail: txt_(detail) }); if (!ok) h.ok = false; };
    var masterId = prop_(PROPS.master);
    add('Setup completed', !!masterId, masterId ? 'master id ' + masterId : 'run setupSystem()');
    if (!masterId) return h;
    try {
      var ctx = masterCtx_();
      var tables = Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'MASTER'; });
      var missing = tables.filter(function (t) { return !ctx.ss.getSheetByName(t); });
      add('Platform tables', missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : tables.length + ' tables');
      var companies = Db.all(ctx, 'Companies');
      add('Companies registered', true, companies.length + ' (active: ' + companies.filter(function (c) { return txt_(c.status) === 'ACTIVE'; }).length + ')');
      var brokenWorkspaces = companies.filter(function (c) {
        if (!txt_(c.spreadsheet_id)) return false;
        try { SpreadsheetApp.openById(c.spreadsheet_id); return false; } catch (e) { return true; }
      });
      add('Company workspaces reachable', brokenWorkspaces.length === 0, brokenWorkspaces.length ? 'broken: ' + brokenWorkspaces.map(function (c) { return c.name; }).join(', ') : 'all reachable');
      var pendingOtp = Auth.pruneSessions ? 'sessions cleaned hourly' : '';
      add('Triggers', ScriptApp.getProjectTriggers().length > 0, ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', ') || 'none installed');
      var quota = 0;
      try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = -1; }
      add('Email quota left today', quota !== 0, quota < 0 ? 'not available' : quota + ' emails');
      add('Drive root', !!prop_(PROPS.driveRoot), prop_(PROPS.driveRoot) || 'missing — run setupSystem()');
      add('Sessions', true, pendingOtp);
    } catch (e) {
      add('Health check ran', false, e.message);
    }
    return h;
  },

  /** Re-run safe installation steps without touching data (used after updates). */
  repair: function () {
    memoClear_();
    var out = [];
    out.push('master tables: ' + createAllTables_(masterCtx_()).length + ' created');
    var companies = Db.all(masterCtx_(), 'Companies');
    companies.forEach(function (c) {
      if (!txt_(c.spreadsheet_id)) return;
      try {
        var cctx = companyCtx_(c.company_id, { requireActive: false });
        var created = createAllTables_(cctx);
        if (created.length) out.push(c.name + ': ' + created.join(', '));
      } catch (e) {
        out.push(c.name + ': ERROR ' + e.message);
      }
    });
    out.push('triggers: ' + Setup.installTriggers().join(', '));
    return { repaired_at: nowIso_(), details: out };
  },

  /** Menu shown when someone opens the master spreadsheet. */
  onOpen: function () {
    try {
      SpreadsheetApp.getUi()
        .createMenu('FocusHR')
        .addItem('Run setup / repair', 'menuSetup')
        .addItem('System health', 'menuHealth')
        .addItem('Seed demo company', 'menuSeedDemo')
        .addToUi();
    } catch (e) { /* not a spreadsheet context */ }
  },

  menuSetup: function () {
    var s = setupSystem();
    SpreadsheetApp.getUi().alert(APP.name + ' setup complete.\n\nMaster sheet: ' + s.master_sheet_url + '\nSuper Admin: ' + s.super_admin_email + '\n\nOpen the web app and sign in.');
  },

  menuHealth: function () {
    var h = Setup.health();
    var lines = h.checks.map(function (c) { return (c.ok ? '✓ ' : '✗ ') + c.check + ' — ' + c.detail; });
    SpreadsheetApp.getUi().alert((h.ok ? 'All good.' : 'Some checks need attention.') + '\n\n' + lines.join('\n'));
  },

  menuSeedDemo: function () {
    var out = Demo.seed(null, { employees: 12, projects: 2, months: 2 });
    SpreadsheetApp.getUi().alert('Demo company ready: ' + out.company_name + ' (' + out.company_id + ')\n\nAdmin login: ' + out.admin_email + '\nPassword: ' + out.admin_password);
  }
};

/* -------------------------------------------------------------- triggers -- */
function dailyHousekeeping() {
  var out = { at: nowIso_(), sessions: 0, emails: null, docAlerts: 0, payrollSweep: null };
  try { out.sessions = Auth.pruneSessions(); } catch (e) { logEvent_('ERROR', 'dailyHousekeeping', e.message, {}); }
  try { out.emails = Notify.flushQueue(25); } catch (e) { logEvent_('ERROR', 'dailyHousekeeping', e.message, {}); }
  try { out.docAlerts = Documents.sendExpiryReminders(); } catch (e) { logEvent_('ERROR', 'dailyHousekeeping', e.message, {}); }
  try { out.payrollSweep = Payroll.sweepStuckRuns(); } catch (e) { logEvent_('ERROR', 'dailyHousekeeping', e.message, {}); }
  logEvent_('INFO', 'dailyHousekeeping', 'done', out);
  return out;
}

function hourlySweep() {
  try { Notify.flushQueue(10); } catch (e) { logEvent_('ERROR', 'hourlySweep', e.message, {}); }
  try { Payroll.sweepStuckRuns(); } catch (e) { logEvent_('ERROR', 'hourlySweep', e.message, {}); }
  return { at: nowIso_() };
}
