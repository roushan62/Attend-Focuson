/**
 * ============================================================================
 *  FILE: 04_Router.gs
 *  ROLE: Web-App entry points (doGet / doPost / doOptions), the action table,
 *        request parsing, authentication, rate limiting and the single JSON
 *        response envelope: { success, data, error, meta } (§12.1, §12.8).
 * ============================================================================
 */

/**
 * Action registry.
 *   auth : 'none' | 'user' | 'staff' | 'owner'
 *   perm : optional permission key checked for staff callers
 *   rate : optional throttle key (protects login/OTP against brute force)
 */
var ACTIONS = {
  /* --- system / public --------------------------------------------------- */
  ping: { fn: 'actionPing', auth: 'none' },
  health: { fn: 'actionHealth', auth: 'none' },
  registerCompany: { fn: 'actionRegisterCompany', auth: 'none', rate: 'register' },
  signupStatus: { fn: 'actionSignupStatus', auth: 'none', rate: 'lookup' },
  sendOtp: { fn: 'actionSendOtp', auth: 'none', rate: 'otp' },
  sendSignupOtp: { fn: 'actionSendSignupOtp', auth: 'none', rate: 'otp' },
  verifyOtp: { fn: 'actionVerifyOtp', auth: 'none', rate: 'lookup' },
  login: { fn: 'actionLogin', auth: 'none', rate: 'login' },
  loginWithOtp: { fn: 'actionLoginWithOtp', auth: 'none', rate: 'login' },
  ownerLogin: { fn: 'actionOwnerLogin', auth: 'none', rate: 'login' },
  bootstrapPlatform: { fn: 'actionBootstrapPlatform', auth: 'none' },

  /* --- platform owner ---------------------------------------------------- */
  ownerStats: { fn: 'actionOwnerStats', auth: 'owner' },
  listSignupRequests: { fn: 'actionListSignupRequests', auth: 'owner' },
  approveCompany: { fn: 'actionApproveCompany', auth: 'owner' },
  rejectCompany: { fn: 'actionRejectCompany', auth: 'owner' },
  listCompanies: { fn: 'actionListCompanies', auth: 'owner' },
  setCompanyStatus: { fn: 'actionSetCompanyStatus', auth: 'owner' },
  platformAuditLog: { fn: 'actionPlatformAuditLog', auth: 'owner' },
  installTriggers: { fn: 'actionInstallTriggers', auth: 'owner' },
  removeTriggers: { fn: 'actionRemoveTriggers', auth: 'owner' },
  setScriptProperty: { fn: 'actionSetScriptProperty', auth: 'owner' },
  listScriptProperties: { fn: 'actionListScriptProperties', auth: 'owner' },

  /* --- session / profile ------------------------------------------------- */
  me: { fn: 'actionMe', auth: 'user' },
  logout: { fn: 'actionLogout', auth: 'user' },
  changePassword: { fn: 'actionChangePassword', auth: 'user' },
  updateMyProfile: { fn: 'actionUpdateMyProfile', auth: 'user' },
  requestDeviceChange: { fn: 'actionRequestDeviceChange', auth: 'user' },
  myNotifications: { fn: 'actionMyNotifications', auth: 'user' },
  markNotificationRead: { fn: 'actionMarkNotificationRead', auth: 'user' },

  /* --- settings / company setup ----------------------------------------- */
  getSettings: { fn: 'actionGetSettings', auth: 'staff' },
  saveSettings: { fn: 'actionSaveSettings', auth: 'staff', perm: 'manageSettings' },
  completeSetupWizard: { fn: 'actionCompleteSetupWizard', auth: 'staff' },
  listHolidays: { fn: 'actionListHolidays', auth: 'user' },
  saveHoliday: { fn: 'actionSaveHoliday', auth: 'staff', perm: 'manageHolidays' },
  deleteHoliday: { fn: 'actionDeleteHoliday', auth: 'staff', perm: 'manageHolidays' },
  listShifts: { fn: 'actionListShifts', auth: 'user' },
  saveShift: { fn: 'actionSaveShift', auth: 'staff', perm: 'manageShifts' },
  deleteShift: { fn: 'actionDeleteShift', auth: 'staff', perm: 'manageShifts' },

  /* --- users / employees ------------------------------------------------- */
  listUsers: { fn: 'actionListUsers', auth: 'user' },
  getUser: { fn: 'actionGetUser', auth: 'user' },
  createUser: { fn: 'actionCreateUser', auth: 'staff', perm: 'createEmployees' },
  updateUser: { fn: 'actionUpdateUser', auth: 'staff', perm: 'editEmployees' },
  setUserStatus: { fn: 'actionSetUserStatus', auth: 'staff', perm: 'deactivateEmployees' },
  setUserPermissions: { fn: 'actionSetUserPermissions', auth: 'staff' },
  resetUserPassword: { fn: 'actionResetUserPassword', auth: 'staff', perm: 'editEmployees' },
  listDeviceRegistry: { fn: 'actionListDeviceRegistry', auth: 'staff', perm: 'editEmployees' },
  approveDeviceChange: { fn: 'actionApproveDeviceChange', auth: 'staff', perm: 'editEmployees' },
  blockDevice: { fn: 'actionBlockDevice', auth: 'staff', perm: 'editEmployees' },

  /* --- projects ---------------------------------------------------------- */
  listProjects: { fn: 'actionListProjects', auth: 'user' },
  getProject: { fn: 'actionGetProject', auth: 'user' },
  createProject: { fn: 'actionCreateProject', auth: 'staff', perm: 'createProjects' },
  updateProject: { fn: 'actionUpdateProject', auth: 'staff', perm: 'editProjects' },
  setProjectStatus: { fn: 'actionSetProjectStatus', auth: 'staff', perm: 'editProjects' },
  geocodeAddress: { fn: 'actionGeocodeAddress', auth: 'staff' },
  assignEmployee: { fn: 'actionAssignEmployee', auth: 'staff', perm: 'createEmployees' },
  listAssignments: { fn: 'actionListAssignments', auth: 'user' },
  endAssignment: { fn: 'actionEndAssignment', auth: 'staff', perm: 'createEmployees' },
  projectTeam: { fn: 'actionProjectTeam', auth: 'user' },
  projectQrCode: { fn: 'actionProjectQrCode', auth: 'staff' },

  /* --- attendance -------------------------------------------------------- */
  markAttendance: { fn: 'actionMarkAttendance', auth: 'user' },
  markOut: { fn: 'actionMarkOut', auth: 'user' },
  qrCheckin: { fn: 'actionQrCheckin', auth: 'user' },
  myAttendanceToday: { fn: 'actionMyAttendanceToday', auth: 'user' },
  listAttendance: { fn: 'actionListAttendance', auth: 'user' },
  reviewAttendance: { fn: 'actionReviewAttendance', auth: 'staff', perm: 'reviewAttendance' },
  manualMark: { fn: 'actionManualMark', auth: 'staff', perm: 'reviewAttendance' },
  requestRegularization: { fn: 'actionRequestRegularization', auth: 'user' },
  listRegularizations: { fn: 'actionListRegularizations', auth: 'user' },  // staff: the queue · worker: own requests
  decideRegularization: { fn: 'actionDecideRegularization', auth: 'staff', perm: 'approveRegularization' },
  todayDashboard: { fn: 'actionTodayDashboard', auth: 'staff' },
  liveMap: { fn: 'actionLiveMap', auth: 'staff' },
  monthlySummary: { fn: 'actionMonthlySummary', auth: 'user' },
  checkSiteWeather: { fn: 'actionCheckSiteWeather', auth: 'staff' },

  /* --- leave / expense / transfer --------------------------------------- */
  requestLeave: { fn: 'actionRequestLeave', auth: 'user' },
  listLeaves: { fn: 'actionListLeaves', auth: 'user' },
  cancelLeave: { fn: 'actionCancelLeave', auth: 'user' },
  decideLeave: { fn: 'actionDecideLeave', auth: 'staff', perm: 'approveLeave' },

  requestExpense: { fn: 'actionRequestExpense', auth: 'user' },
  listExpenses: { fn: 'actionListExpenses', auth: 'user' },
  decideExpense: { fn: 'actionDecideExpense', auth: 'staff', perm: 'approveExpense' },

  requestTransfer: { fn: 'actionRequestTransfer', auth: 'user' },
  listTransfers: { fn: 'actionListTransfers', auth: 'user' },
  decideTransfer: { fn: 'actionDecideTransfer', auth: 'staff', perm: 'approveTransfer' },

  approvalsQueue: { fn: 'actionApprovalsQueue', auth: 'staff' },

  /* --- vendors ----------------------------------------------------------- */
  listVendors: { fn: 'actionListVendors', auth: 'staff', perm: 'manageVendors' },
  saveVendor: { fn: 'actionSaveVendor', auth: 'staff', perm: 'manageVendors' },
  setVendorStatus: { fn: 'actionSetVendorStatus', auth: 'staff', perm: 'manageVendors' },
  addVendorWorkerEntry: { fn: 'actionAddVendorWorkerEntry', auth: 'user' },
  listVendorWorkers: { fn: 'actionListVendorWorkers', auth: 'user' },
  vendorManpowerReport: { fn: 'actionVendorManpowerReport', auth: 'staff', perm: 'viewReports' },

  /* --- documents --------------------------------------------------------- */
  listDocuments: { fn: 'actionListDocuments', auth: 'user' },
  uploadDocument: { fn: 'actionUploadDocument', auth: 'user' },
  updateDocument: { fn: 'actionUpdateDocument', auth: 'staff', perm: 'manageDocuments' },
  deleteDocument: { fn: 'actionDeleteDocument', auth: 'staff', perm: 'manageDocuments' },

  /* --- reports / payroll ------------------------------------------------- */
  generateReport: { fn: 'actionGenerateReport', auth: 'staff', perm: 'viewReports' },
  exportReport: { fn: 'actionExportReport', auth: 'staff', perm: 'exportReports' },
  generatePayrollSheet: { fn: 'actionGeneratePayrollSheet', auth: 'staff', perm: 'runPayroll' },

  /* --- files ------------------------------------------------------------- */
  getFile: { fn: 'actionGetFile', auth: 'user' },

  /* --- audit ------------------------------------------------------------- */
  listAuditLog: { fn: 'actionListAuditLog', auth: 'staff', perm: 'viewAuditLog' }
};

/* -------------------------------------------------------------------------- */
/*  Web-App entry points                                                      */
/* -------------------------------------------------------------------------- */

function doGet(e) {
  var params = {};
  if (e && e.parameter) for (var k in e.parameter) params[k] = e.parameter[k];

  // A plain browser hit with no ?action → tiny self-documenting landing page.
  if (!params.action) {
    return HtmlService.createHtmlOutput(landingHtml_())
      .setTitle('SiteTrack API')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return handleApi_(params, { method: 'GET', e: e });
}

function doPost(e) {
  var params = {};
  var body = {};
  if (e && e.parameter) for (var k in e.parameter) params[k] = e.parameter[k];

  if (e && e.postData && e.postData.contents) {
    var raw = String(e.postData.contents);
    var ct = String((e.postData && e.postData.type) || '');
    if (ct.indexOf('application/json') >= 0 || /^\s*[\{\[]/.test(raw)) {
      body = jsonParse_(raw, {});
    } else if (ct.indexOf('x-www-form-urlencoded') >= 0) {
      raw.split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        params[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      });
    } else {
      body = jsonParse_(raw, {});
    }
  }
  // Merge: explicit query params win for `action`, body supplies the payload.
  var merged = {};
  for (var b in body) merged[b] = body[b];
  for (var p in params) merged[p] = params[p];
  if (!merged.payload && body.payload) merged.payload = body.payload;

  return handleApi_(merged, { method: 'POST', e: e });
}

/**
 * CORS pre-flight (§12.9). Apps Script web apps are fronted by Google, which
 * answers most pre-flights itself; this handler exists for completeness and for
 * self-hosted/proxied deployments. The frontend deliberately POSTs with
 * `Content-Type: text/plain` so no pre-flight is required in the common case.
 */
function doOptions(e) {
  return jsonResponse_({
    success: true,
    data: { app: SITETRACK_APP.name, methods: ['GET', 'POST', 'OPTIONS'] },
    meta: { serverTime: iso_(new Date()) }
  });
}

/* -------------------------------------------------------------------------- */
/*  Dispatcher                                                                */
/* -------------------------------------------------------------------------- */

function handleApi_(params, meta) {
  var started = Date.now();
  var requestId = uuid_().substring(0, 12);
  var actionName = str_(params.action || params.act || '');

  if (!actionName) return fail_('Missing "action" parameter', 400, requestId, actionName, started);

  var def = ACTIONS[actionName];
  if (!def || typeof def.fn !== 'string') {
    return fail_('Unknown action: ' + actionName, 404, requestId, actionName, started);
  }

  var handler = null;
  try {
    handler = resolveHandler_(def.fn);
  } catch (e) {
    return fail_('Action handler not available: ' + actionName, 501, requestId, actionName, started);
  }

  var payload = params.payload;
  if (typeof payload === 'string') payload = jsonParse_(payload, {});
  if (!payload || typeof payload !== 'object') {
    payload = {};
    for (var k in params) {
      if (['action', 'act', 'token', 'companyId', 'payload'].indexOf(k) >= 0) continue;
      payload[k] = params[k];
    }
  }

  var ctxMeta = {
    userAgent: str_(meta && meta.e && meta.e.userAgent ? meta.e.userAgent : '', 300),
    deviceFingerprint: str_(payload.deviceFingerprint || params.deviceFingerprint || '', 64),
    deviceLabel: str_(payload.deviceLabel || '', 80),
    locale: str_(payload.locale || params.locale || 'en', 8)
  };

  try {
    // ---- rate limiting on sensitive endpoints -----------------------------
    if (def.rate) {
      var rl = rateLimit_(def.rate, str_(payload.mobile || payload.identifier || payload.email || '', 40) +
        '|' + str_(payload.companyId || '', 24));
      if (!rl.ok) throw new ApiError_(rl.message, 429);
    }

    // ---- authentication ---------------------------------------------------
    var token = str_(params.token || payload.token || extractBearer_(meta), '');
    var ctx = null;

    if (def.auth === 'owner') {
      ctx = token ? buildContext_(token, ctxMeta) : null;
      if (!ctx || !ctx.isOwner) throw new ApiError_('Platform owner authentication required', 401);
    } else if (def.auth === 'user' || def.auth === 'staff') {
      if (!token) throw new ApiError_('Authentication required', 401);
      ctx = buildContext_(token, ctxMeta);
      if (def.auth === 'staff') assertStaff_(ctx);
      if (def.perm) assertPermission_(ctx, def.perm);
    } else {
      ctx = { userId: 'anonymous', role: 'anonymous', permissions: {}, scope: [], userAgent: ctxMeta.userAgent };
    }

    ctx.meta = ctxMeta;
    ctx.requestId = requestId;

    var data = handler(payload, ctx);
    if (data === undefined) data = {};

    return jsonResponse_({
      success: true,
      data: data,
      meta: {
        requestId: requestId,
        action: actionName,
        serverTime: iso_(new Date()),
        ms: Date.now() - started,
        role: ctx.role || '',
        companyId: ctx.companyId || ''
      }
    });
  } catch (err) {
    var code = err && err.code ? Number(err.code) : 500;
    var message = err && err.message ? err.message : 'Unexpected server error';
    if (code >= 500) Logger.log('[' + actionName + '] ' + message + '\n' + (err.stack || ''));
    return fail_(message, code, requestId, actionName, started);
  }
}

/** Resolve a handler by name across the concatenated script globals. */
function resolveHandler_(name) {
  var scope = (typeof globalThis !== 'undefined') ? globalThis : this;
  var fn = scope[name];
  if (typeof fn !== 'function') throw new Error('handler missing: ' + name);
  return fn;
}

function extractBearer_(meta) {
  try {
    var headers = meta && meta.e && meta.e.headers;
    if (headers && headers.Authorization) return String(headers.Authorization).replace(/^Bearer\s+/i, '');
  } catch (e) { }
  return '';
}

/* -------------------------------------------------------------------------- */
/*  Response envelope                                                         */
/* -------------------------------------------------------------------------- */

function fail_(message, code, requestId, actionName, started) {
  return jsonResponse_({
    success: false,
    data: null,
    error: { message: message, code: code || 400 },
    meta: {
      requestId: requestId || '',
      action: actionName || '',
      serverTime: iso_(new Date()),
      ms: started ? Date.now() - started : 0
    }
  });
}

function jsonResponse_(obj) {
  var out = ContentService.createTextOutput(jsonString_(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function landingHtml_() {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>SiteTrack API</title>',
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;',
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}',
    '.card{max-width:640px;background:#111c33;border:1px solid #22314f;border-radius:18px;padding:34px 30px}',
    'h1{margin:0 0 6px;font-size:26px}code{background:#0b1220;padding:2px 6px;border-radius:6px;color:#7dd3fc}',
    'p{line-height:1.6;color:#a9b7cf;font-size:14px}</style></head><body><div class="card">',
    '<h1>🏗️ SiteTrack API</h1>',
    '<p>Construction site live attendance &amp; workforce management backend.</p>',
    '<p>Version <code>' + SITETRACK_APP.version + '</code> · Schema v' + SITETRACK_APP.schemaVersion + '</p>',
    '<p>Call it as <code>?action=ping</code> or POST <code>{"action":"login","payload":{…}}</code>.',
    ' Full action list: see <code>docs/API.md</code> in the repository.</p>',
    '</div></body></html>'
  ].join('');
}

/* -------------------------------------------------------------------------- */
/*  Rate limiting (CacheService backed)                                       */
/* -------------------------------------------------------------------------- */

var RATE_LIMITS = {
  login: { windowSeconds: 60, max: 8, message: 'Too many sign-in attempts. Try again in a minute.' },
  otp: { windowSeconds: 300, max: 5, message: 'Too many OTP requests. Try again in 5 minutes.' },
  register: { windowSeconds: 3600, max: 5, message: 'Too many signup submissions from this device.' },
  lookup: { windowSeconds: 60, max: 20, message: 'Too many lookups. Slow down.' }
};

function rateLimit_(bucket, key) {
  var rule = RATE_LIMITS[bucket];
  if (!rule) return { ok: true };
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = ('rl:' + bucket + ':' + key).substring(0, 240);
    var hits = Number(cache.get(cacheKey) || 0) + 1;
    if (hits === 1) cache.put(cacheKey, '1', rule.windowSeconds);
    else cache.put(cacheKey, String(hits), rule.windowSeconds);
    if (hits > rule.max) return { ok: false, message: rule.message };
    return { ok: true, remaining: Math.max(0, rule.max - hits) };
  } catch (e) {
    return { ok: true }; // never lock users out because the cache is unavailable
  }
}

/* -------------------------------------------------------------------------- */
/*  System actions                                                            */
/* -------------------------------------------------------------------------- */

function actionPing(payload, ctx) {
  return {
    app: SITETRACK_APP.name,
    version: SITETRACK_APP.version,
    schemaVersion: SITETRACK_APP.schemaVersion,
    serverTime: iso_(new Date()),
    timezone: platformTimezone_(),
    devMode: devMode_(),
    configured: !!prop_(PROP.MASTER_ID, ''),
    actions: Object.keys(ACTIONS).length
  };
}

function actionHealth(payload, ctx) {
  var out = { app: SITETRACK_APP.version, checks: [] };
  try {
    var ss = masterSpreadsheet_();
    out.checks.push({ name: 'PlatformMasterSheet', ok: true, id: ss.getId(), tabs: ss.getSheets().length });
    var registry = listCompaniesRaw_();
    out.checks.push({ name: 'CompanyRegistry', ok: true, companies: registry.length });
    var openable = 0;
    registry.slice(0, 10).forEach(function (c) {
      try { companySpreadsheetById_(c.SheetID); openable++; } catch (e) { }
    });
    out.checks.push({ name: 'CompanySheetsReachable', ok: openable > 0 || registry.length === 0, reached: openable });
  } catch (e) {
    out.checks.push({ name: 'PlatformMasterSheet', ok: false, error: e.message });
  }
  out.ok = out.checks.every(function (c) { return c.ok; });
  return out;
}
