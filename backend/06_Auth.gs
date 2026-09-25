/**
 * ============================================================================
 *  FILE: 06_Auth.gs
 *  ROLE: Sign-in for every role (web admins + mobile site staff), OTP login,
 *        sessions, password changes, profile self-service and device-change
 *        requests. Includes the global LoginIndex that resolves a tenant from a
 *        mobile number / e-mail without opening every company spreadsheet.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Login index                                                               */
/* -------------------------------------------------------------------------- */

function loginIndexUpsert_(user, companyId) {
  var ss = masterSpreadsheet_();
  ensureTabs_(ss, PLATFORM_TABS, ['LoginIndex']);
  var keys = [
    { key: String(user.UserID), type: 'UserID' },
    { key: normaliseMobile_(user.MobileNumber), type: 'Mobile' },
    { key: String(user.Email || '').toLowerCase(), type: 'Email' }
  ];
  keys.forEach(function (k) {
    if (!k.key) return;
    var existing = findRecord_(ss, 'LoginIndex', 'LookupKey', k.key + '|' + k.type);
    var row = {
      LookupKey: k.key + '|' + k.type,
      KeyType: k.type,
      UserID: user.UserID,
      CompanyID: companyId,
      Role: String(user.Role || ''),
      Status: String(user.Status || 'Active'),
      UpdatedAt: fmtDateTime_(new Date())
    };
    if (existing) updateRecord_(ss, 'LoginIndex', 'LookupKey', row.LookupKey, row);
    else appendRecord_(ss, 'LoginIndex', row);
  });
}

/**
 * Resolve which company a login identifier belongs to.
 * Order: explicit companyId → LoginIndex → (fallback) registry scan.
 */
function resolveLogin_(identifier, companyIdHint) {
  var ident = String(identifier || '').trim();
  assert_(ident.length >= 3, 'Enter your user ID, mobile number or e-mail', 400);

  var candidates = [ident];
  if (mobileOk_(ident)) candidates.push(normaliseMobile_(ident));
  if (emailOk_(ident)) candidates.push(ident.toLowerCase());
  candidates = uniq_(candidates);

  // 1. explicit company
  if (companyIdHint) {
    var co = findCompany_(companyIdHint);
    if (co) {
      var css = companySpreadsheetById_(co.SheetID);
      var users = readTable_(css, 'Users');
      for (var i = 0; i < users.length; i++) {
        if (userMatchesIdentifier_(users[i], candidates)) {
          return { company: co, user: users[i], ss: css };
        }
      }
    }
  }

  // 2. LoginIndex (fast path)
  var ss = masterSpreadsheet_();
  var index = ss.getSheetByName('LoginIndex') ? readTable_(ss, 'LoginIndex') : [];
  for (var c = 0; c < candidates.length; c++) {
    for (var j = 0; j < index.length; j++) {
      var row = index[j];
      var rawKey = String(row.LookupKey || '');
      var keyPart = rawKey.indexOf('|') > 0 ? rawKey.substring(0, rawKey.lastIndexOf('|')) : rawKey;
      if (keyPart.toLowerCase() === candidates[c].toLowerCase() ||
          String(row.UserID).toLowerCase() === candidates[c].toLowerCase()) {
        var company = findCompany_(row.CompanyID);
        if (!company) continue;
        var css2 = companySpreadsheetById_(company.SheetID);
        var user = findRecord_(css2, 'Users', 'UserID', row.UserID);
        if (user) return { company: company, user: user, ss: css2 };
      }
    }
  }

  // 3. fallback scan (only when the platform is small)
  var registry = listCompaniesRaw_();
  if (registry.length <= 50) {
    for (var r = 0; r < registry.length; r++) {
      if (String(registry[r].Status) === 'Closed') continue;
      try {
        var css3 = companySpreadsheetById_(registry[r].SheetID);
        var users3 = readTable_(css3, 'Users');
        for (var u = 0; u < users3.length; u++) {
          if (userMatchesIdentifier_(users3[u], candidates)) {
            return { company: registry[r], user: users3[u], ss: css3 };
          }
        }
      } catch (e) { /* skip unreachable sheets */ }
    }
  }
  throw new ApiError_('No account found for those sign-in details.', 404);
}

function userMatchesIdentifier_(user, candidates) {
  var hay = [
    String(user.UserID || '').toLowerCase(),
    normaliseMobile_(user.MobileNumber).toLowerCase(),
    String(user.Email || '').toLowerCase()
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (hay.indexOf(String(candidates[i]).toLowerCase()) >= 0) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Portal sign-in — the company console and the employee app are separate    */
/* -------------------------------------------------------------------------- */

/**
 * SiteTrack has exactly two sign-in doors and both check the SAME database
 * (the company sheet created when the platform admin approved the signup):
 *
 *   portal = 'company'   →  ?page=company   SuperAdmin / Admin / SubAdmin only
 *   portal = 'employee'  →  ?page=employee  Employee (site worker) only
 *
 * A credential from the wrong door is refused with a pointer to the right one,
 * so an employee can never land in the admin console and vice-versa.
 */
var PORTALS = { COMPANY: 'company', EMPLOYEE: 'employee' };

/** Which door a user record belongs to. */
function portalOfUser_(user) {
  return isStaffRole_(String(user && user.Role)) ? PORTALS.COMPANY : PORTALS.EMPLOYEE;
}

function assertPortal_(user, portal) {
  if (!portal) return true;
  var actual = portalOfUser_(user);
  if (actual === portal) return true;

  if (portal === PORTALS.COMPANY) {
    throw new ApiError_('This is the company (HR/Admin) sign-in. This account is a site employee account — ' +
      'please sign in from the Employee Login page.', 403);
  }
  throw new ApiError_('This is the employee sign-in. This account is a company (HR/Admin) account — ' +
    'please sign in from the Company Login page.', 403);
}

/* ---- company portal ------------------------------------------------------ */

/** ?page=company → password OR one-time code (payload.otp), HR/Admin only. */
function actionCompanyLogin(payload, ctx) {
  return portalSignIn_(payload, ctx, PORTALS.COMPANY);
}

function actionCompanySendOtp(payload, ctx) {
  return sendPortalOtp_(payload, ctx, PORTALS.COMPANY);
}

/* ---- employee portal ----------------------------------------------------- */

/** ?page=employee → one-time code OR password, site workers only. */
function actionEmployeeLogin(payload, ctx) {
  return portalSignIn_(payload, ctx, PORTALS.EMPLOYEE);
}

function actionEmployeeSendOtp(payload, ctx) {
  return sendPortalOtp_(payload, ctx, PORTALS.EMPLOYEE);
}

/**
 * One door, two credentials: an `otp` in the payload means the visitor used the
 * one-time-code tab, anything else is treated as a password sign-in. Either way
 * the same portal guard, the same company sheet and the same session run.
 */
function portalSignIn_(payload, ctx, portal) {
  return isBlank_(payload.otp) ? passwordLogin_(payload, ctx, portal) : otpLogin_(payload, ctx, portal);
}

/* ---- shared implementation ---------------------------------------------- */

/**
 * Password sign-in used by both portals.
 * `identifier` = User ID / e-mail / mobile. `companyId` is optional; when the
 * caller supplies it (the company login page does) the tenant sheet is opened
 * directly instead of walking the global login index.
 */
function passwordLogin_(payload, ctx, portal) {
  requireFields_(payload, ['identifier', 'password']);
  var resolved = resolveLogin_(payload.identifier, payload.companyId);
  var user = resolved.user;
  var ss = resolved.ss;
  var company = resolved.company;

  assertPortal_(user, portal);

  if (!verifyPassword_(payload.password, user.PasswordHash)) {
    audit_(ss, { userId: String(user.UserID), role: String(user.Role), companyId: company.CompanyID,
      userAgent: ctx.meta.userAgent }, 'LOGIN_FAILED', 'Users', user.UserID,
      { reason: 'bad password', identifier: maskString_(payload.identifier, 3), portal: portal }, 'DENIED');
    throw new ApiError_('Incorrect password. Please try again.', 401);
  }
  if (String(user.Status) !== 'Active') {
    throw new ApiError_('This account is ' + String(user.Status).toLowerCase() + '. Contact your administrator.', 403);
  }
  if (String(company.Status) === 'Suspended') {
    throw new ApiError_('Your company account is suspended: ' + (company.SuspendedReason || 'contact the platform administrator'), 403);
  }

  var device = checkDevice_(ss, user, ctx.meta.deviceFingerprint, ctx.meta);
  loginIndexUpsert_(user, company.CompanyID);
  updateRecord_(ss, 'Users', 'UserID', user.UserID, { LastLoginAt: fmtDateTime_(new Date()) });
  audit_(ss, { userId: String(user.UserID), userName: user.Name, role: String(user.Role),
    companyId: company.CompanyID, userAgent: ctx.meta.userAgent }, 'LOGIN', 'Users', user.UserID,
    { device: device.status, fingerprint: maskString_(ctx.meta.deviceFingerprint, 6),
      portal: portal, door: 'password' }, 'OK');

  var token = issueToken_({
    userId: user.UserID, companyId: company.CompanyID, role: user.Role, name: user.Name, portal: portalOfUser_(user)
  });
  return buildSessionPayload_(ss, user, company, token, device, ctx);
}

/**
 * OTP login for site staff (§1: "OTP-less mobile-number login" = no password to
 * remember). The code is delivered by SMS/WhatsApp when a gateway is
 * configured, otherwise by e-mail; in DEV_MODE it is echoed in the response.
 */
function sendPortalOtp_(payload, ctx, portal) {
  requireFields_(payload, ['identifier']);
  var resolved = resolveLogin_(payload.identifier, payload.companyId);
  var user = resolved.user;
  assertPortal_(user, portal);
  if (String(user.Status) !== 'Active') throw new ApiError_('Account is not active', 403);
  var info = issueOtp_(resolved.ss, user, 'auto');
  audit_(resolved.ss, { userId: String(user.UserID), companyId: resolved.company.CompanyID },
    'OTP_SENT', 'Users', user.UserID, { channel: info.channel, portal: portal }, 'OK');
  return {
    sent: true,
    portal: portal,
    channel: info.channel,
    expiresAt: info.expiresAt,
    maskedIdentifier: maskString_(payload.identifier, 3),
    devCode: info.devCode
  };
}

/** OTP sign-in used by both portals. */
function otpLogin_(payload, ctx, portal) {
  requireFields_(payload, ['identifier', 'otp']);
  var resolved = resolveLogin_(payload.identifier, payload.companyId);
  var user = resolved.user;
  var ss = resolved.ss;
  var company = resolved.company;

  assertPortal_(user, portal);

  if (!verifyOtpCode_(ss, user, payload.otp)) {
    audit_(ss, { userId: String(user.UserID), companyId: company.CompanyID }, 'OTP_LOGIN_FAILED',
      'Users', user.UserID, { identifier: maskString_(payload.identifier, 3), portal: portal }, 'DENIED');
    throw new ApiError_('That OTP is incorrect or has expired. Request a new one.', 401);
  }
  if (String(user.Status) !== 'Active') throw new ApiError_('Account is not active', 403);
  if (String(company.Status) === 'Suspended') throw new ApiError_('Company account suspended', 403);

  var device = checkDevice_(ss, user, ctx.meta.deviceFingerprint, ctx.meta);
  loginIndexUpsert_(user, company.CompanyID);
  updateRecord_(ss, 'Users', 'UserID', user.UserID, { LastLoginAt: fmtDateTime_(new Date()) });
  audit_(ss, { userId: String(user.UserID), userName: user.Name, role: String(user.Role),
    companyId: company.CompanyID }, 'LOGIN_OTP', 'Users', user.UserID,
    { device: device.status, portal: portal, door: 'otp' }, 'OK');

  var token = issueToken_({
    userId: user.UserID, companyId: company.CompanyID, role: user.Role, name: user.Name, portal: portalOfUser_(user)
  });
  return buildSessionPayload_(ss, user, company, token, device, ctx);
}

/** Assemble everything the frontends need immediately after sign-in. */
function buildSessionPayload_(ss, user, company, token, device, ctx) {
  var settings = readSettings_(ss);
  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', user.UserID)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  var projects = readTable_(ss, 'Projects');
  var projectMap = indexBy_(projects, 'ProjectID');

  return {
    token: token,
    expiresIn: TOKEN_TTL_SECONDS,
    portal: portalOfUser_(user),
    mustChangePassword: bool_(user.MustChangePassword, false),
    user: {
      userId: user.UserID, name: user.Name, role: user.Role,
      mobile: user.MobileNumber, email: user.Email,
      designation: user.Designation || '', photoLink: user.PhotoLink || '',
      status: user.Status, joinedAt: user.JoinedAt || '',
      weeklyOff: user.WeeklyOff || '', shiftId: user.ShiftID || '',
      salaryType: user.SalaryType || 'Daily',
      deviceStatus: user.DeviceStatus || 'Unbound'
    },
    permissions: permissionsFor_(user),
    projectScope: projectScopeOfUser_(user),
    company: {
      companyId: company.CompanyID, companyName: company.CompanyName,
      logoLink: settings.companyLogoLink || '', status: company.Status,
      planTier: company.PlanTier || 'Free', timezone: settings.timezone || platformTimezone_(),
      setupCompleted: bool_(settings.setupCompleted, false)
    },
    settings: settings,
    device: {
      status: device.status, ok: device.ok, reason: device.reason || '',
      deviceId: device.deviceId || ''
    },
    assignments: assignments.map(function (a) {
      var p = projectMap[String(a.ProjectID)] || {};
      return {
        assignmentId: a.AssignmentID, projectId: a.ProjectID,
        projectName: p.Name || '', projectCode: p.ProjectCode || '',
        projectStatus: p.Status || '', roleOnSite: a.RoleOnSite || '',
        assignedFrom: a.AssignedFrom || '', lat: num_(p.Lat, 0), lng: num_(p.Long, 0),
        address: p.Address || '', geofenceRadius: num_(p.GeofenceRadius, 0)
      };
    })
  };
}

function actionMe(payload, ctx) {
  var ss = ctx.ss;
  var user = ctx.user;
  var settings = ctx.settings;
  var todayStr = today_(ctx.tz);

  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', user.UserID)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  var projectMap = indexBy_(readTable_(ss, 'Projects'), 'ProjectID');

  var todays = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === String(user.UserID) && String(a.Date) === todayStr;
  });

  var pendingCounts = {
    leave: findRecords_(ss, 'LeaveRequests', 'UserID', user.UserID)
      .filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    expense: findRecords_(ss, 'ExpenseRequests', 'UserID', user.UserID)
      .filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    transfer: findRecords_(ss, 'SiteTransfers', 'UserID', user.UserID)
      .filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    regularization: findRecords_(ss, 'RegularizationRequests', 'UserID', user.UserID)
      .filter(function (r) { return String(r.Status) === 'Pending'; }).length
  };

  var unread = readTable_(ss, 'Notifications').filter(function (n) {
    return String(n.UserID) === String(user.UserID) && String(n.Read) !== 'Y';
  }).length;

  var deviceRows = findRecords_(ss, 'DeviceRegistry', 'UserID', user.UserID);

  return {
    user: maskUser_(ctx, user),
    permissions: ctx.permissions,
    projectScope: ctx.scope,
    company: {
      companyId: ctx.company.CompanyID, companyName: ctx.company.CompanyName,
      sheetId: ctx.company.SheetID, timezone: settings.timezone,
      setupCompleted: bool_(settings.setupCompleted, false), planTier: ctx.company.PlanTier || 'Free'
    },
    settings: settings,
    today: {
      date: todayStr,
      marks: todays.map(function (a) { return attendanceDto_(a, ctx); })
    },
    assignments: assignments.map(function (a) {
      var p = projectMap[String(a.ProjectID)] || {};
      return {
        assignmentId: a.AssignmentID, projectId: a.ProjectID, projectName: p.Name || '',
        projectCode: p.ProjectCode || '', projectStatus: p.Status || '',
        roleOnSite: a.RoleOnSite || '', assignedFrom: a.AssignedFrom || '',
        lat: num_(p.Lat, 0), lng: num_(p.Long, 0), address: p.Address || '',
        geofenceRadius: num_(p.GeofenceRadius, num_(settings.defaultGeofenceRadius, 200)),
        windowStart: p.WindowStart || settings.attendanceWindowStart,
        windowEnd: p.WindowEnd || settings.attendanceWindowEnd
      };
    }),
    pending: pendingCounts,
    unreadNotifications: unread,
    devices: deviceRows.map(function (d) {
      return {
        deviceId: d.DeviceID, label: d.DeviceLabel || 'Registered device',
        fingerprint: maskString_(d.DeviceFingerprint, 6), registeredAt: d.RegisteredAt,
        lastUsedAt: d.LastUsedAt, status: d.Status, loginCount: num_(d.LoginCount, 0)
      };
    }),
    serverTime: iso_(new Date()),
    isStaff: isStaffRole_(ctx.role)
  };
}

function actionLogout(payload, ctx) {
  revokeToken_(ctx.token);
  if (ctx.ss) {
    audit_(ctx.ss, ctx, 'LOGOUT', 'Users', ctx.userId, {}, 'OK');
  }
  return { loggedOut: true };
}

/** Blacklist a stateless token for its remaining lifetime. */
function revokeToken_(token) {
  try {
    var payload = verifyToken_(token);
    if (!payload) return false;
    var remaining = Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
    CacheService.getScriptCache().put('revoked:' + payload.jti, '1', Math.min(remaining, 21600));
    return true;
  } catch (e) {
    return false;
  }
}

function tokenRevoked_(token) {
  try {
    var payload = verifyToken_(token);
    if (!payload || !payload.jti) return false;
    return !!CacheService.getScriptCache().get('revoked:' + payload.jti);
  } catch (e) {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Passwords                                                                 */
/* -------------------------------------------------------------------------- */

function passwordStrong_(pw) {
  var s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters long';
  if (!/[A-Za-z]/.test(s)) return 'Password must contain at least one letter';
  if (!/[0-9]/.test(s)) return 'Password must contain at least one number';
  if (s.length > 64) return 'Password must be 64 characters or fewer';
  return '';
}

function actionChangePassword(payload, ctx) {
  requireFields_(payload, ['newPassword']);
  var err = passwordStrong_(payload.newPassword);
  assert_(!err, err, 400);
  var ss = ctx.ss;
  var user = ctx.user;

  // Current password is required unless the user is mid forced-reset with a
  // freshly issued temporary password (they must still supply it).
  if (!verifyPassword_(payload.currentPassword || payload.tempPassword || '', user.PasswordHash)) {
    throw new ApiError_('Your current password is incorrect', 401);
  }
  if (String(payload.newPassword) === String(payload.currentPassword)) {
    throw new ApiError_('The new password must be different from the current one', 400);
  }
  updateRecord_(ss, 'Users', 'UserID', user.UserID, {
    PasswordHash: hashPassword_(payload.newPassword),
    MustChangePassword: 'N'
  });
  audit_(ss, ctx, 'CHANGE_PASSWORD', 'Users', user.UserID, {}, 'OK');
  if (user.Email && emailOk_(user.Email)) {
    sendEmail_(user.Email, 'SiteTrack password changed',
      'Your SiteTrack password was changed on ' + fmtDateTime_(new Date()) +
      '. If this was not you, contact your administrator immediately.');
  }
  return { changed: true, mustChangePassword: false };
}

function actionUpdateMyProfile(payload, ctx) {
  var ss = ctx.ss;
  var patch = {};
  var allowed = {
    name: ['Name', 120], designation: ['Designation', 80], address: ['Address', 300],
    emergencyContact: ['EmergencyContact', 40], bankAccount: ['BankAccount', 40],
    ifscCode: ['IfscCode', 20], weeklyOff: ['WeeklyOff', 12]
  };
  for (var k in allowed) {
    if (payload[k] !== undefined && payload[k] !== null) {
      var v = str_(payload[k], allowed[k][1]);
      if (k === 'emergencyContact' && v && !/^[+\d\s()-]{6,20}$/.test(v)) {
        throw new ApiError_('Emergency contact must be a valid phone number', 400);
      }
      patch[allowed[k][0]] = v;
    }
  }
  if (!isBlank_(payload.photoBase64)) {
    patch.PhotoLink = storeCompanyUpload_(ctx.company, 'Selfies', 'profile-' + ctx.userId,
      String(payload.photoBase64), str_(payload.photoMime, 'image/jpeg'));
  }
  assert_(Object.keys(patch).length, 'Nothing to update', 400);
  var updated = updateRecord_(ss, 'Users', 'UserID', ctx.userId, patch);
  audit_(ss, ctx, 'UPDATE_PROFILE', 'Users', ctx.userId, Object.keys(patch).join(','), 'OK');
  return { updated: true, user: maskUser_(ctx, updated || ctx.user) };
}

/* -------------------------------------------------------------------------- */
/*  Device change requests (§9.1)                                             */
/* -------------------------------------------------------------------------- */

function actionRequestDeviceChange(payload, ctx) {
  var ss = ctx.ss;
  var fp = deviceFingerprintNorm_(payload.deviceFingerprint || ctx.meta.deviceFingerprint);
  assert_(fp.length >= 8, 'Could not read a device fingerprint from this browser', 400);

  var registry = findRecords_(ss, 'DeviceRegistry', 'UserID', ctx.userId);
  var active = null;
  for (var i = 0; i < registry.length; i++) {
    if (String(registry[i].Status) === 'Active') { active = registry[i]; break; }
  }
  if (!active) {
    var created = {
      DeviceID: id_('DEV'), UserID: ctx.userId, DeviceFingerprint: fp,
      DeviceLabel: str_(payload.deviceLabel || ctx.meta.deviceLabel, 60) || 'New device',
      UserAgent: truncate_(ctx.meta.userAgent, 200),
      RegisteredAt: fmtDateTime_(new Date()), LastUsedAt: fmtDateTime_(new Date()),
      Status: 'Active', LoginCount: 1
    };
    appendRecord_(ss, 'DeviceRegistry', created);
    updateRecord_(ss, 'Users', 'UserID', ctx.userId, { DeviceID: created.DeviceID, DeviceStatus: 'Bound' });
    audit_(ss, ctx, 'DEVICE_BOUND', 'DeviceRegistry', created.DeviceID, {}, 'OK');
    return { status: 'Bound', message: 'This device is now registered to your account.' };
  }
  if (deviceFingerprintNorm_(active.DeviceFingerprint) === fp) {
    return { status: 'AlreadyBound', message: 'You are already using your registered device.' };
  }
  if (String(active.Status) === 'PendingChange' && deviceFingerprintNorm_(active.PendingFingerprint) === fp) {
    return { status: 'ChangePending', message: 'Your device change request is already awaiting approval.' };
  }

  updateRecord_(ss, 'DeviceRegistry', 'DeviceID', active.DeviceID, {
    Status: 'PendingChange',
    PendingFingerprint: fp,
    RequestedAt: fmtDateTime_(new Date()),
    DeviceLabel: str_(payload.deviceLabel || ctx.meta.deviceLabel, 60) || active.DeviceLabel
  });
  updateRecord_(ss, 'Users', 'UserID', ctx.userId, { DeviceStatus: 'ChangePending' });
  audit_(ss, ctx, 'DEVICE_CHANGE_REQUESTED', 'DeviceRegistry', active.DeviceID,
    { fingerprint: maskString_(fp, 6), reason: str_(payload.reason, 200) }, 'PENDING');

  notifyAdmins_(ss, ctx, 'Device change request',
    ctx.userName + ' (' + ctx.userId + ') requested to switch to a new device.' +
    (payload.reason ? ' Reason: ' + str_(payload.reason, 200) : ''), 'Approval');

  return {
    status: 'ChangePending',
    message: 'Request sent to your administrator. You can browse the app, but attendance stays locked until it is approved.'
  };
}
