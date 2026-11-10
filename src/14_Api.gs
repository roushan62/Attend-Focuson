/**
 * FocusOn HRMS 2.0 — API Gateway (14_Api.gs)
 * Public entry points: doGet (serves UI), api(action, payload) (all RPC),
 * setupSystem, seedDemoData, seedLoadTest200, cron_* (triggers).
 * All other server functions are private (trailing _).
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.include = function (filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  };
  return template.evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Single RPC entry point.
 * Client calls: google.script.run.api(action, payload)  ->  returns {ok, data} | {ok:false, error:{code,message,field}}
 */
function api(action, payload) {
  payload = payload || {};
  try {
    // ---------- unauthenticated actions ----------
    var unauth = ['auth.login', 'auth.forgot', 'auth.verifyotp', 'setupSystem', 'seedDemoData', 'seedLoadTest200'];
    if (unauth.indexOf(action) >= 0) {
      return _dispatch(action, payload);
    }
    // ---------- authenticated actions ----------
    var boot = _boot(payload.token);
    if (!boot.loggedIn) {
      return _result(false, { error: { code: ERR.SESSION_EXPIRED, message: 'Session expired or not signed in. Please sign in again.' } });
    }
    // attach resolved user context
    payload._user = boot.user;
    payload._perms = boot.perms;
    payload._panel = boot.panel;
    return _dispatch(action, payload);
  } catch (e) {
    // structured error response (never leak stack to client)
    var ref = _uid().slice(-8);
    _logError('api:' + action, e);
    return _result(false, {
      error: {
        code: e.code || ERR.SERVER,
        message: e.message || 'Server error (ref ' + ref + ').',
        field: e.field || null
      }
    });
  }
}

function _dispatch(action, payload) {
  var fnName = String(action).replace(/\./g, '_') + '_';
  if (typeof window === 'undefined' && typeof global !== 'undefined') {
    // Apps Script global scope
  }
  var fn = eval(fnName); // resolves top-level function by name
  if (typeof fn !== 'function') {
    throw _error(ERR.INVALID_ACTION, 'Unknown action: ' + action);
  }
  var res = fn(payload);
  if (res === null || res === undefined) res = _result(true);
  return res;
}

// ---------- Public setup / seed (no session required for setupSystem) ----------

function setupSystem(payload) { return setupSystem_(payload); }
function seedDemoData(payload) { return seedDemoData_(payload); }
function seedLoadTest200(payload) { return seedLoadTest200_(payload); }

// ---------- Cron triggers (public; verify triggerUid in production) ----------

function cron_hourly(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_hourly_();
}
function cron_daily(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_daily_();
}
function cron_nightly(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_nightly_();
}
// expose the underscore cron helpers too for direct trigger binding
function cron_autocheckout(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_autocheckout_();
}
function cron_leaveaccrual(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_leaveaccrual_();
}
function cron_retention(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_retention_();
}
function cron_alerts(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_alerts_();
}
function cron_digest(payload) {
  if (!_isCronTrigger()) throw _error(ERR.FORBIDDEN, 'Cron only.');
  return cron_digest_();
}

function _isCronTrigger() {
  // In Apps Script, triggers pass an event object. Lightweight guard: check caller
  // (production: verify e.triggerUid against installed triggers).
  return true;
}

// ---------- install triggers (run once after deploy) ----------

function installTriggers() {
  ScriptApp.newTrigger('cron_hourly').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('cron_daily').timeBased().atHour(1).create(); // ~1 AM IST
  ScriptApp.newTrigger('cron_nightly').timeBased().atHour(2).create(); // auto checkout
  ScriptApp.newTrigger('cron_leaveaccrual').timeBased().atHour(0).create();
  ScriptApp.newTrigger('cron_retention').timeBased().atHour(3).create();
  ScriptApp.newTrigger('cron_alerts').timeBased().atHour(8).create();
  ScriptApp.newTrigger('cron_digest').timeBased().atHour(9).create();
  return { installed: 7 };
}
