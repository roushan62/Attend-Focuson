/**
 * ============================================================================
 *  FILE: 03_Security.gs
 *  ROLE: Password hashing, session tokens, device binding, permission engine,
 *        data masking. This is the security boundary — every mutating action
 *        passes through assertPermission_ / scopedRows_ here (§10, §12.7).
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Password hashing (salted SHA-256 via Utilities.computeDigest — §10)       */
/* -------------------------------------------------------------------------- */

function hashPassword_(password, salt) {
  var s = salt || uuid_().replace(/-/g, '').substring(0, 16);
  var secret = prop_(PROP.TOKEN_SECRET, 'sitetrack-default-secret');
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    s + '|' + String(password) + '|' + secret,
    Utilities.Charset.UTF_8
  );
  return s + '$' + digest.map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function verifyPassword_(password, stored) {
  var raw = String(stored || '');
  if (!raw || raw.indexOf('$') < 0) return false;
  var salt = raw.split('$')[0];
  return timingSafeEqual_(hashPassword_(password, salt), raw);
}

function timingSafeEqual_(a, b) {
  var x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Cheap HMAC over a string using the token secret. */
function hmac_(message) {
  var secret = prop_(PROP.TOKEN_SECRET, 'sitetrack-default-secret');
  var digest = Utilities.computeHmacSha256Signature(String(message), secret, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function b64url_(str) {
  return Utilities.base64Encode(str, Utilities.Charset.UTF_8)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode_(str) {
  var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString();
}

/* -------------------------------------------------------------------------- */
/*  Session tokens                                                            */
/* -------------------------------------------------------------------------- */

var TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Issue a signed session token: base64url(payload).hmac(payload)
 */
function issueToken_(claims) {
  var payload = {
    uid: claims.userId,
    cid: claims.companyId || '',
    role: claims.role || '',
    name: claims.name || '',
    owner: claims.isOwner ? 1 : 0,
    exp: Math.floor(Date.now() / 1000) + (claims.ttl || TOKEN_TTL_SECONDS),
    iat: Math.floor(Date.now() / 1000),
    jti: uuid_().substring(0, 8)
  };
  var body = b64url_(jsonString_(payload));
  return body + '.' + hmac_(body).substring(0, 32);
}

function verifyToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  var body = parts[0];
  var sig = parts[1];
  if (!timingSafeEqual_(hmac_(body).substring(0, 32), sig)) return null;
  var payload = jsonParse_(b64urlDecode_(body), null);
  if (!payload) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* -------------------------------------------------------------------------- */
/*  Permission engine                                                         */
/* -------------------------------------------------------------------------- */

function permissionsFor_(user) {
  if (!user) return {};
  var role = String(user.Role || '');
  if (role === ROLES.SUPER_ADMIN) {
    var all = {};
    PERMISSIONS.forEach(function (p) { all[p] = true; });
    all.__all = true;
    return all;
  }
  if (role === ROLES.ADMIN) {
    var ap = {};
    (ROLE_DEFAULT_PERMISSIONS.Admin || []).forEach(function (p) { ap[p] = true; });
    var extra = jsonParse_(user.PermissionsJSON, {});
    for (var k in extra) if (PERMISSIONS.indexOf(k) >= 0) ap[k] = bool_(extra[k], false);
    return ap;
  }
  if (role === ROLES.SUB_ADMIN) {
    var sp = jsonParse_(user.PermissionsJSON, {});
    var out = {};
    PERMISSIONS.forEach(function (p) { out[p] = bool_(sp[p], false); });
    return out;
  }
  return {}; // Employee
}

function can_(ctx, permission) {
  if (!ctx || !ctx.user) return false;
  var role = String(ctx.user.Role || '');
  if (role === ROLES.SUPER_ADMIN) return true;
  var perms = ctx.permissions || permissionsFor_(ctx.user);
  if (perms.__all) return true;
  return !!perms[permission];
}

/** Project scope: ["ALL"] or a list of project ids (§9.15 server-side masking). */
function projectScope_(ctx) {
  if (!ctx || !ctx.user) return [];
  var role = String(ctx.user.Role || '');
  if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) return ['ALL'];
  var raw = ctx.user.ProjectScopeJSON;
  var list = jsonList_(raw);
  if (!list.length) {
    var fallback = ctx.assignedProjectIds || [];
    return fallback.length ? fallback : [];
  }
  return list.indexOf('ALL') >= 0 ? ['ALL'] : list;
}

function scopeIsAll_(ctx) {
  return projectScope_(ctx).indexOf('ALL') >= 0;
}

/** True when a user may see a given project id under their scope. */
function inScope_(ctx, projectId) {
  if (scopeIsAll_(ctx)) return true;
  var scope = projectScope_(ctx);
  return scope.indexOf(String(projectId)) >= 0;
}

/**
 * Enforce a permission or throw a 403-shaped error (§12.7).
 * `ctx` is built by buildContext_() in the router.
 */
function assertPermission_(ctx, permission, message) {
  if (!ctx || !ctx.user) throw new ApiError_('Authentication required', 401);
  if (can_(ctx, permission)) return true;
  throw new ApiError_(message || ('Not permitted: requires the "' + permission + '" permission'), 403);
}

function assertEmployeeSelf_(ctx, userId) {
  if (String(ctx.user.UserID) === String(userId)) return true;
  if (can_(ctx, 'viewAllEmployees')) return true;
  throw new ApiError_('You may only access your own record', 403);
}

function assertProjectScope_(ctx, projectId) {
  if (!projectId) return true;
  if (inScope_(ctx, projectId)) return true;
  throw new ApiError_('This project is outside your assigned scope', 403);
}

/** Filter an array of row objects down to what the caller may see. */
function scopedRows_(ctx, rows, projectField) {
  if (scopeIsAll_(ctx)) return rows;
  var scope = projectScope_(ctx);
  var field = projectField || 'ProjectID';
  return rows.filter(function (r) {
    var ids = String(r[field] || '');
    if (ids.indexOf(',') >= 0) {
      return ids.split(',').some(function (p) { return scope.indexOf(p.trim()) >= 0; });
    }
    return scope.indexOf(ids) >= 0;
  });
}

/** Mask columns a limited Sub-Admin should never receive (§9.15). */
function maskUser_(ctx, user) {
  var out = {};
  // Credential material is NEVER returned to a client — not even to a Super Admin.
  var never = ['PasswordHash', 'OtpHash', 'OtpExpiry'];
  // Payroll / identity fields are visible only to payroll-capable staff or the owner.
  var sensitive = ['BankAccount', 'IfscCode', 'IdProofMasked', 'MonthlySalary', 'DailyWage'];
  var canSeeSensitive = can_(ctx, 'viewAllEmployees') || String(ctx.user.UserID) === String(user.UserID);
  for (var k in user) {
    if (k === '__row') continue;
    if (never.indexOf(k) >= 0) { continue; }
    if (!canSeeSensitive && sensitive.indexOf(k) >= 0) { out[k] = ''; continue; }
    out[k] = user[k];
  }
  out.Permissions = permissionsFor_(user);
  out.ProjectScope = projectScopeOfUser_(user);
  return out;
}

function projectScopeOfUser_(user) {
  var list = jsonList_(user ? user.ProjectScopeJSON : '');
  if (!list.length) return [];
  return list.indexOf('ALL') >= 0 ? ['ALL'] : list;
}

/* -------------------------------------------------------------------------- */
/*  Device binding (anti-proxy lock — §9.1)                                   */
/* -------------------------------------------------------------------------- */

function deviceFingerprintNorm_(fp) {
  return String(fp || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 64);
}

/**
 * Check / bind the caller's device.
 * Returns { ok, reason, status } — `ok=false` means the action must be blocked.
 */
function checkDevice_(ss, user, fingerprint, ctx) {
  var fp = deviceFingerprintNorm_(fingerprint);
  var requireBinding = String(settingValue_(ss, 'requireDeviceBinding', 'Y')).toUpperCase() === 'Y';
  if (!fp) {
    if (!requireBinding) return { ok: true, status: 'Unbound', reason: '' };
    return { ok: false, status: 'Unbound', reason: 'Device fingerprint missing — open the app in a normal browser (not private mode).' };
  }

  var registry = findRecords_(ss, 'DeviceRegistry', 'UserID', user.UserID);
  var active = null;
  for (var i = 0; i < registry.length; i++) {
    if (String(registry[i].Status) === 'Active') { active = registry[i]; break; }
  }

  if (!active) {
    // First login on any device → bind it.
    var row = {
      DeviceID: id_('DEV'),
      UserID: user.UserID,
      DeviceFingerprint: fp,
      DeviceLabel: truncate_(String((ctx && ctx.deviceLabel) || 'Primary device'), 60),
      UserAgent: truncate_(String((ctx && ctx.userAgent) || ''), 200),
      RegisteredAt: fmtDateTime_(new Date()),
      LastUsedAt: fmtDateTime_(new Date()),
      Status: 'Active',
      LoginCount: 1
    };
    appendRecord_(ss, 'DeviceRegistry', row);
    updateRecord_(ss, 'Users', 'UserID', user.UserID, { DeviceID: row.DeviceID, DeviceStatus: 'Bound' });
    audit_(ss, ctx, 'DEVICE_BOUND', 'Users', user.UserID, { fingerprint: maskString_(fp, 6) }, 'OK');
    return { ok: true, status: 'Bound', deviceId: row.DeviceID, reason: '' };
  }

  if (deviceFingerprintNorm_(active.DeviceFingerprint) === fp) {
    updateRecord_(ss, 'DeviceRegistry', 'DeviceID', active.DeviceID, {
      LastUsedAt: fmtDateTime_(new Date()),
      LoginCount: num_(active.LoginCount, 0) + 1
    });
    return { ok: true, status: 'Bound', deviceId: active.DeviceID, reason: '' };
  }

  // Different device: honour a pending change request, otherwise block.
  if (String(active.Status) === 'PendingChange' &&
      deviceFingerprintNorm_(active.PendingFingerprint) === fp) {
    updateRecord_(ss, 'DeviceRegistry', 'DeviceID', active.DeviceID, {
      DeviceFingerprint: fp,
      Status: 'Active',
      PendingFingerprint: '',
      LastUsedAt: fmtDateTime_(new Date()),
      ApprovedAt: fmtDateTime_(new Date())
    });
    updateRecord_(ss, 'Users', 'UserID', user.UserID, { DeviceStatus: 'Bound' });
    notify_(ss, user.UserID, 'New device approved', 'Your new device was approved. You can now mark attendance from it.', 'Info');
    audit_(ss, ctx, 'DEVICE_CHANGED', 'DeviceRegistry', active.DeviceID, { fingerprint: maskString_(fp, 6) }, 'OK');
    return { ok: true, status: 'Changed', deviceId: active.DeviceID, reason: '' };
  }

  if (String(active.Status) === 'Blocked') {
    return { ok: false, status: 'Blocked', deviceId: active.DeviceID, reason: 'This device is blocked. Contact your administrator.' };
  }

  var pending = false;
  for (var j = 0; j < registry.length; j++) {
    if (String(registry[j].Status) === 'PendingChange' &&
        deviceFingerprintNorm_(registry[j].PendingFingerprint) === fp) pending = true;
  }
  return {
    ok: false,
    status: pending ? 'ChangePending' : 'Mismatch',
    deviceId: active.DeviceID,
    reason: pending
      ? 'Your new device request is awaiting admin approval.'
      : 'Attendance is locked to your registered device. Request a device change from your profile.'
  };
}

/* -------------------------------------------------------------------------- */
/*  OTP                                                                       */
/* -------------------------------------------------------------------------- */

function issueOtp_(ss, user, channel) {
  var code = otp6_();
  var expiry = new Date(Date.now() + 10 * 60 * 1000);
  var hash = hashPassword_(code, 'otp' + user.UserID);
  updateRecord_(ss, 'Users', 'UserID', user.UserID, {
    OtpHash: hash,
    OtpExpiry: fmtDateTime_(expiry)
  });
  var message = 'Your SiteTrack verification code is ' + code + '. It expires in 10 minutes. Never share this code.';
  if (channel !== 'none') {
    if (user.Email && emailOk_(user.Email)) sendEmail_(user.Email, 'SiteTrack verification code', message);
    sendSmsOrWhatsApp_(user.MobileNumber, message);
  }
  return {
    expiresAt: fmtDateTime_(expiry),
    channel: (user.Email && emailOk_(user.Email)) ? 'Email' : 'SMS',
    // Echoed ONLY in dev/demo mode where no real SMS gateway exists (§3 OTP step).
    devCode: devMode_() ? code : undefined
  };
}

function verifyOtpCode_(ss, user, code) {
  if (isBlank_(user.OtpHash)) return false;
  if (toDate_(user.OtpExpiry).getTime() < Date.now()) return false;
  var ok = timingSafeEqual_(hashPassword_(String(code), 'otp' + user.UserID), String(user.OtpHash));
  if (ok) updateRecord_(ss, 'Users', 'UserID', user.UserID, { OtpHash: '', OtpExpiry: '' });
  return ok;
}

/* -------------------------------------------------------------------------- */
/*  Request context                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build the caller context from a token. Throws 401 when invalid.
 * ctx = { userId, companyId, role, user, company, ss, permissions, scope, ... }
 */
function buildContext_(token, meta) {
  var payload = verifyToken_(token);
  if (!payload) throw new ApiError_('Session expired or invalid. Please sign in again.', 401);
  if (tokenRevoked_(token)) throw new ApiError_('This session was signed out. Please sign in again.', 401);

  var ctx = {
    userId: payload.uid || '',
    companyId: payload.cid || '',
    role: payload.role || '',
    userName: payload.name || '',
    isOwner: payload.owner === 1,
    token: token,
    userAgent: (meta && meta.userAgent) || '',
    deviceLabel: (meta && meta.deviceLabel) || '',
    deviceFingerprint: (meta && meta.deviceFingerprint) || '',
    locale: (meta && meta.locale) || 'en'
  };

  if (ctx.isOwner) {
    ctx.permissions = (function () { var o = {}; PERMISSIONS.forEach(function (p) { o[p] = true; }); o.__all = true; return o; })();
    ctx.scope = ['ALL'];
    return ctx;
  }

  if (!ctx.companyId) throw new ApiError_('Token is missing a company scope', 401);

  var company = findCompany_(ctx.companyId);
  if (!company) throw new ApiError_('Company not found for this session', 401);
  if (String(company.Status) === 'Suspended') {
    throw new ApiError_('This company account is suspended.', 403);
  }
  ctx.company = company;
  ctx.ss = companySpreadsheetById_(company.SheetID);

  var user = findRecord_(ctx.ss, 'Users', 'UserID', ctx.userId);
  if (!user) throw new ApiError_('User account not found', 401);
  if (String(user.Status) !== 'Active') throw new ApiError_('This account is ' + String(user.Status).toLowerCase() + '. Contact your administrator.', 403);

  ctx.user = user;
  ctx.role = String(user.Role);
  ctx.userName = String(user.Name || '');
  ctx.permissions = permissionsFor_(user);
  ctx.settings = readSettings_(ctx.ss);
  ctx.tz = ctx.settings.timezone || platformTimezone_();
  ctx.assignedProjectIds = findRecords_(ctx.ss, 'ProjectAssignments', 'UserID', user.UserID)
    .filter(function (a) { return String(a.Status) === 'Active'; })
    .map(function (a) { return String(a.ProjectID); });
  ctx.scope = projectScope_(ctx);
  return ctx;
}

/** Admin-level context guard: employees cannot call management actions. */
function assertStaff_(ctx) {
  if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SUB_ADMIN].indexOf(String(ctx.role)) < 0) {
    throw new ApiError_('This action is restricted to administrators', 403);
  }
  return true;
}

function assertOwner_(ctx) {
  if (!ctx.isOwner) throw new ApiError_('Platform owner access required', 403);
  return true;
}

function isStaffRole_(role) {
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SUB_ADMIN].indexOf(String(role)) >= 0;
}
