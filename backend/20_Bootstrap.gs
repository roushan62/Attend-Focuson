/**
 * ============================================================================
 *  FILE: 20_Bootstrap.gs
 *  ROLE: First-run setup and health diagnostics — nothing else.
 *        `actionBootstrapPlatform` prepares the Platform Master Sheet and
 *        generates the secrets; `setupScript()` is the one-click version you run
 *        from the Apps Script editor; `diagnoseDeployment()` audits an existing
 *        install so you can confirm every step of the guide book worked.
 *
 *        This project ships with ZERO demo/sample data: bootstrap creates empty
 *        structure only, and every company row comes from a real signup request.
 * ============================================================================
 */

/**
 * Public bootstrap action. Safe to expose because it can only create structure
 * — it never returns an existing secret and refuses to run once the platform is
 * configured (unless the caller supplies the owner key).
 */
function actionBootstrapPlatform(payload, ctx) {
  var confirm = str_(payload.confirm, 20).toUpperCase() === 'BOOTSTRAP';
  var masterId = parseSheetId_(prop_(PROP.MASTER_ID, ''));
  var ownerKey = prop_(PROP.OWNER_KEY, '');

  if (masterId && ownerKey && !devMode_()) {
    if (!confirm || str_(payload.ownerKey, 200) !== ownerKey) {
      return {
        alreadyConfigured: true,
        masterSheetId: masterId,
        message: 'Platform is already configured. Pass confirm=BOOTSTRAP plus the owner key to re-run structure checks.'
      };
    }
  }

  var created = { masterSheet: false, ownerKey: false, tokenSecret: false, driveRoot: false };

  if (!masterId) {
    var supplied = parseSheetId_(payload.masterSheetId || '');
    if (supplied) {
      masterId = supplied;
    } else {
      var ssNew = SpreadsheetApp.create('SiteTrack - Platform Master');
      try { ssNew.setSpreadsheetTimeZone(platformTimezone_()); } catch (e) { }
      masterId = ssNew.getId();
      created.masterSheet = true;
    }
    setProp_(PROP.MASTER_ID, masterId);
  }

  var ss = masterSpreadsheet_();
  var tabs = ensureTabs_(ss, PLATFORM_TABS, PLATFORM_TAB_ORDER);

  if (!prop_(PROP.TOKEN_SECRET, '')) {
    setProp_(PROP.TOKEN_SECRET, uuid_() + uuid_());
    created.tokenSecret = true;
  }
  if (!prop_(PROP.OWNER_KEY, '')) {
    var key = 'STK-OWNER-' + uuid_().replace(/-/g, '').substring(0, 16).toUpperCase();
    setProp_(PROP.OWNER_KEY, key);
    created.ownerKey = true;
  }
  if (!prop_(PROP.DRIVE_ROOT_ID, '')) {
    try {
      var root = DriveApp.createFolder('SiteTrack');
      setProp_(PROP.DRIVE_ROOT_ID, root.getId());
      created.driveRoot = true;
    } catch (e2) {
      Logger.log('Drive root creation skipped: ' + e2.message);
    }
  }
  if (!prop_(PROP.TIMEZONE, '')) setProp_(PROP.TIMEZONE, str_(payload.timezone, 40) || 'Asia/Kolkata');
  if (payload.ownerEmail && emailOk_(payload.ownerEmail)) setProp_(PROP.OWNER_EMAIL, str_(payload.ownerEmail, 120));
  if (payload.devMode !== undefined) setProp_(PROP.DEV_MODE, bool_(payload.devMode, false) ? 'true' : 'false');

  platformAudit_('BOOTSTRAP_PLATFORM', { masterId: masterId, tabs: tabs.length, created: created }, 'OK');

  return {
    bootstrapped: true,
    masterSheetId: masterId,
    masterSheetUrl: sheetUrl_(masterId),
    tabs: tabs,
    created: created,
    // Shown ONCE, immediately after generation. Store it now.
    ownerKey: created.ownerKey ? prop_(PROP.OWNER_KEY, '') : '(already set — not shown again)',
    tokenSecretGenerated: created.tokenSecret,
    driveRootId: prop_(PROP.DRIVE_ROOT_ID, ''),
    nextSteps: [
      '1. Store the owner key above in your password manager (the Owner panel at ?page=owner asks for it at runtime — never hard-code it).',
      '2. Deploy the script as a Web App (execute as: me, access: anyone).',
      '3. Open the Web App URL — the same /exec link serves the website, staff console, worker app (?page=mobile) and owner panel (?page=owner). No separate hosting is needed.',
      '4. Run the owner action installTriggers to enable the scheduled jobs.',
      '5. Run diagnoseDeployment() from the editor to verify every step. Full copy-paste checklist: docs/SETUP.md.'
    ]
  };
}

/**
 * Run this once from the Apps Script editor (Run → setupScript) to prepare
 * everything: master sheet, secrets, tabs and triggers.
 */
function setupScript() {
  var res = actionBootstrapPlatform({ confirm: 'BOOTSTRAP', devMode: false }, {});
  Logger.log('Master sheet: ' + res.masterSheetUrl);
  Logger.log('Owner key: ' + res.ownerKey);
  var trig = installTriggers();
  Logger.log('Triggers: ' + jsonString_(trig));
  return res;
}

/* -------------------------------------------------------------------------- */
/*  Deployment diagnostics                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run this from the Apps Script editor (Run → diagnoseDeployment) any time you
 * want a health report for the installation. It never prints a secret — only
 * whether it exists — so the execution log is safe to paste into a support chat.
 *
 * Reads: Platform Master tabs, Script Properties, the company registry, the
 * per-company sheet structure and the scheduled-trigger coverage.
 */
function diagnoseDeployment() {
  var report = { version: SITETRACK_APP.version, timezone: platformTimezone_(), checks: [], warnings: [], failures: [] };

  function add(name, ok, detail) {
    var row = { name: name, ok: !!ok, detail: detail === undefined ? '' : detail };
    report.checks.push(row);
    if (!ok) report.failures.push(name);
    return row;
  }
  function warn(name, detail) { report.warnings.push({ name: name, detail: detail || '' }); }

  /* ---- structure -------------------------------------------------------- */
  var masterId = prop_(PROP.MASTER_ID, '');
  add('PlatformMasterId', !!masterId, masterId ? sheetUrl_(masterId) : 'run setupScript() once');
  var ss = null;
  if (masterId) {
    try { ss = masterSpreadsheet_(); } catch (e) { add('PlatformMasterOpenable', false, e.message); }
  }
  if (ss) {
    var have = ss.getSheets().map(function (s) { return s.getName(); });
    var missingPlatform = Object.keys(PLATFORM_TABS).filter(function (t) { return have.indexOf(t) < 0; });
    add('PlatformTabs', missingPlatform.length === 0,
      missingPlatform.length ? 'missing: ' + missingPlatform.join(', ') : have.length + ' tabs');
  }

  /* ---- secrets (presence only) ------------------------------------------ */
  add('OwnerKeySet', !!prop_(PROP.OWNER_KEY, ''), 'stored in Script Properties');
  add('TokenSecretSet', !!prop_(PROP.TOKEN_SECRET, ''), 'signs every session token');
  var ownerEmail = prop_(PROP.OWNER_EMAIL, '');
  add('OwnerEmailSet', !!ownerEmail, ownerEmail || 'set OWNER_EMAIL so signup alerts are delivered');
  var driveRoot = prop_(PROP.DRIVE_ROOT_ID, '');
  if (!driveRoot) warn('DriveRootId', 'not set — company folders will be created at Drive root');
  if (devMode_()) warn('DevMode', 'DEV_MODE is ON: OTP codes are echoed in API responses. Set DEV_MODE=false for production.');

  /* ---- tenants --------------------------------------------------------- */
  var companies = [];
  try { companies = listCompaniesRaw_(); } catch (e) { add('CompanyRegistryReadable', false, e.message); }
  var active = companies.filter(function (c) { return String(c.Status) === 'Active'; }).length;
  add('Companies', companies.length >= 0, companies.length + ' registered (' + active + ' active)');
  var broken = [];
  companies.slice(0, 25).forEach(function (c) {
    try {
      var css = companySpreadsheetById_(c.SheetID);
      var missing = COMPANY_TAB_ORDER.filter(function (t) { return !css.getSheetByName(t); });
      if (missing.length) broken.push(c.CompanyID + ' missing tabs: ' + missing.join(','));
      var users = readTable_(css, 'Users').filter(function (u) { return String(u.Status) === 'Active'; }).length;
      if (users === 0) broken.push(c.CompanyID + ' has no active user (Super Admin provisioning incomplete)');
    } catch (e2) {
      broken.push(c.CompanyID + ' sheet unreachable: ' + e2.message);
    }
  });
  add('CompanySheets', broken.length === 0, broken.length ? broken.join(' | ') : 'all reachable with the full tab set');

  /* ---- triggers -------------------------------------------------------- */
  var installed = installedTriggers_();
  var missingTriggers = TRIGGER_DEFINITIONS.filter(function (d) {
    return !installed.some(function (t) { return t.handler === d.fn; });
  }).map(function (d) { return d.fn; });
  add('Triggers', missingTriggers.length === 0,
    missingTriggers.length ? 'not installed: ' + missingTriggers.join(', ') + ' — run installTriggers()' : installed.length + ' of ' + TRIGGER_DEFINITIONS.length + ' installed');

  /* ---- quota (best effort) --------------------------------------------- */
  try {
    if (typeof PropertiesService.getScriptProperties().getKeys === 'function') {
      report.scriptPropertyKeys = PropertiesService.getScriptProperties().getKeys().sort();
    }
  } catch (e3) { /* ignore */ }

  report.summary = report.failures.length
    ? '✗ ' + report.failures.length + ' check(s) FAILED, ' + report.warnings.length + ' warning(s).'
    : (report.warnings.length ? '✓ Deployment OK with ' + report.warnings.length + ' advisory warning(s).' : '✓ Deployment OK — every check passed.');

  report.checks.forEach(function (c) { Logger.log((c.ok ? '✓ ' : '✗ ') + c.name + (c.detail ? ' — ' + c.detail : '')); });
  report.warnings.forEach(function (w) { Logger.log('! ' + w.name + (w.detail ? ' — ' + w.detail : '')); });
  Logger.log(report.summary);
  return report;
}
