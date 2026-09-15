/**
 * ============================================================================
 *  FILE: 05_Platform.gs
 *  ROLE: Multi-tenant control plane (§3) — company signup requests, OTP
 *        verification, Platform Owner approval/rejection, the company registry,
 *        suspension, and script-property management.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Public: company signup                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Send a one-time code to the mobile number entered on the signup form.
 * Delivered by e-mail when an address is supplied; in DEV_MODE the code is also
 * returned in the response so the flow can be exercised without an SMS gateway.
 */
function actionSendSignupOtp(payload, ctx) {
  requireFields_(payload, ['mobile']);
  var mobile = normaliseMobile_(payload.mobile);
  assert_(mobileOk_(mobile), 'Enter a valid mobile number', 400);

  var code = otp6_();
  var cacheKey = ('signupotp:' + mobile).substring(0, 200);
  try {
    CacheService.getScriptCache().put(cacheKey, code, 600);
  } catch (e) {
    Logger.log('OTP cache write failed: ' + e.message);
  }

  var email = str_(payload.email, 120);
  var message = 'Your SiteTrack company-signup verification code is ' + code +
    '. It expires in 10 minutes. If you did not request it, ignore this message.';
  if (emailOk_(email)) sendEmail_(email, 'SiteTrack signup verification code', message);
  sendSmsOrWhatsApp_(mobile, message);

  platformAudit_('SEND_SIGNUP_OTP', { mobile: maskString_(mobile, 4) }, 'OK');
  return {
    sent: true,
    channel: emailOk_(email) ? 'Email' : 'SMS',
    expiresInSeconds: 600,
    devCode: devMode_() ? code : undefined
  };
}

/**
 * Register a new company → row in CompanySignupRequests with Status=Pending (§3).
 */
function actionRegisterCompany(payload, ctx) {
  requireFields_(payload, ['companyName', 'gst', 'address', 'contactPerson', 'email', 'mobile', 'industryType']);

  var email = str_(payload.email, 120).toLowerCase();
  assert_(emailOk_(email), 'Enter a valid official e-mail address', 400);
  var mobile = normaliseMobile_(payload.mobile);
  assert_(mobileOk_(mobile), 'Enter a valid mobile number (with country code)', 400);
  assert_(str_(payload.companyName, 160).length >= 2, 'Company name is too short', 400);
  assert_(str_(payload.gst, 32).length >= 4, 'Enter the GST / registration number', 400);
  assert_(inList_(payload.industryType, INDUSTRY_TYPES), 'Select a valid industry type', 400);

  var ss = masterSpreadsheet_();
  var existing = readTable_(ss, 'CompanySignupRequests');
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].Email).toLowerCase() === email && String(existing[i].Status) === 'Pending') {
      throw new ApiError_('A signup request for this e-mail is already pending review.', 409);
    }
  }
  var registry = listCompaniesRaw_();
  for (var r = 0; r < registry.length; r++) {
    if (String(registry[r].SuperAdminEmail).toLowerCase() === email) {
      throw new ApiError_('This e-mail is already registered as a Super Admin. Please sign in instead.', 409);
    }
  }

  // Mobile OTP verification (mandatory unless explicitly relaxed).
  var otpVerified = 'N';
  var allowUnverified = String(prop_(PROP.ALLOW_UNVERIFIED_SIGNUP, devMode_() ? 'true' : 'false')).toLowerCase() === 'true';
  if (!isBlank_(payload.otp)) {
    var cached = '';
    try { cached = String(CacheService.getScriptCache().get(('signupotp:' + mobile).substring(0, 200)) || ''); } catch (e) { cached = ''; }
    assert_(cached && cached === String(payload.otp).trim(), 'That verification code is incorrect or has expired.', 400);
    otpVerified = 'Y';
  } else if (!allowUnverified) {
    throw new ApiError_('Mobile number verification is required. Enter the OTP sent to ' + mobile, 400);
  }

  var logoLink = '';
  if (!isBlank_(payload.logoBase64)) {
    logoLink = storeTempUpload_(null, 'CompanyLogos', 'signup-logo-' + shortId_(8),
      String(payload.logoBase64), str_(payload.logoMime, 'image/png'));
  }

  var row = {
    RequestID: id_('REQ'),
    CompanyName: str_(payload.companyName, 160),
    GST: str_(payload.gst, 32),
    Address: str_(payload.address, 400),
    ContactPerson: str_(payload.contactPerson, 120),
    Designation: str_(payload.designation, 80),
    Email: email,
    Mobile: mobile,
    IndustryType: pickOne_(payload.industryType, INDUSTRY_TYPES, 'Other'),
    Status: 'Pending',
    SubmittedAt: fmtDateTime_(new Date()),
    ReviewedBy: '',
    ReviewNote: '',
    LogoLink: logoLink,
    CompanyID: '',
    OtpVerified: otpVerified
  };
  appendRecord_(ss, 'CompanySignupRequests', row);
  platformAudit_('REGISTER_COMPANY', { requestId: row.RequestID, company: row.CompanyName, email: email }, 'OK');

  // Notify the platform owner so nothing sits unreviewed.
  var ownerEmail = prop_(PROP.OWNER_EMAIL, '');
  if (emailOk_(ownerEmail)) {
    sendEmail_(ownerEmail, 'SiteTrack — new company signup: ' + row.CompanyName,
      'A new company has requested access.\n\n' +
      'Company: ' + row.CompanyName + '\nGST: ' + row.GST + '\nContact: ' + row.ContactPerson +
      ' (' + row.Designation + ')\nEmail: ' + row.Email + '\nMobile: ' + row.Mobile +
      '\nIndustry: ' + row.IndustryType + '\nMobile OTP verified: ' + row.OtpVerified +
      '\nRequest ID: ' + row.RequestID + '\n\nOpen the Platform Owner panel to approve or reject it.');
  }

  return {
    requestId: row.RequestID,
    status: row.Status,
    message: 'Your request has been submitted. Our team will review it within one working day.',
    trackUrl: 'status.html?requestId=' + row.RequestID
  };
}

/** Public self-service status lookup by request id / e-mail / mobile. */
function actionSignupStatus(payload, ctx) {
  var ss = masterSpreadsheet_();
  var rows = readTable_(ss, 'CompanySignupRequests');
  var key = str_(payload.requestId || payload.email || payload.mobile, 160).toLowerCase();
  assert_(key.length >= 4, 'Enter your request ID, e-mail or mobile number', 400);

  var match = rows.filter(function (r) {
    return String(r.RequestID).toLowerCase() === key ||
      String(r.Email).toLowerCase() === key ||
      String(r.Mobile).toLowerCase().indexOf(key) >= 0;
  });
  if (!match.length) return { found: false, message: 'No signup request found for those details.' };

  var latest = sortBy_(match, function (r) { return String(r.SubmittedAt); }, true)[0];
  return {
    found: true,
    request: {
      requestId: latest.RequestID,
      companyName: latest.CompanyName,
      status: latest.Status,
      submittedAt: latest.SubmittedAt,
      reviewedAt: latest.ReviewedAt || '',
      reviewNote: latest.ReviewNote || '',
      companyId: latest.CompanyID || '',
      nextStep: latest.Status === 'Approved'
        ? 'Your company is live. Check your inbox for the Super Admin credentials.'
        : (latest.Status === 'Rejected'
          ? 'The request was rejected: ' + (latest.ReviewNote || 'no reason recorded')
          : 'Your request is queued for review.')
    }
  };
}

/* -------------------------------------------------------------------------- */
/*  Platform Owner                                                            */
/* -------------------------------------------------------------------------- */

function actionOwnerLogin(payload, ctx) {
  requireFields_(payload, ['ownerKey']);
  var expected = prop_(PROP.OWNER_KEY, '');
  assert_(expected.length >= 8, 'Platform owner key is not configured on this deployment', 500);
  if (!timingSafeEqual_(String(payload.ownerKey).trim(), expected)) {
    platformAudit_('OWNER_LOGIN_FAILED', {}, 'DENIED');
    throw new ApiError_('Invalid platform owner key', 401);
  }
  var token = issueToken_({
    userId: 'owner', companyId: '', role: ROLES.OWNER,
    name: 'Platform Owner', isOwner: true, ttl: 8 * 3600
  });
  platformAudit_('OWNER_LOGIN', {}, 'OK');
  return {
    token: token,
    user: { UserID: 'owner', Name: 'Platform Owner', Role: ROLES.OWNER, Email: prop_(PROP.OWNER_EMAIL, '') },
    expiresIn: 8 * 3600
  };
}

function actionOwnerStats(payload, ctx) {
  assertOwner_(ctx);
  var ss = masterSpreadsheet_();
  var requests = readTable_(ss, 'CompanySignupRequests');
  var registry = listCompaniesRaw_();
  var byStatus = { Pending: 0, Approved: 0, Rejected: 0 };
  requests.forEach(function (r) {
    var s = String(r.Status);
    if (byStatus.hasOwnProperty(s)) byStatus[s]++;
  });
  var companies = { Active: 0, Suspended: 0, other: 0 };
  registry.forEach(function (c) {
    var s = String(c.Status);
    if (companies.hasOwnProperty(s)) companies[s]++; else companies.other++;
  });

  var usage = registry.slice(0, 25).map(function (c) {
    var counts = { users: 0, projects: 0, attendance: 0 };
    try {
      var css = companySpreadsheetById_(c.SheetID);
      counts.users = countRows_(css, 'Users');
      counts.projects = countRows_(css, 'Projects');
      counts.attendance = countRows_(css, 'Attendance');
    } catch (e) { counts.error = e.message; }
    return {
      companyId: c.CompanyID, companyName: c.CompanyName, status: c.Status,
      createdAt: c.CreatedAt, planTier: c.PlanTier || 'Free',
      superAdminEmail: c.SuperAdminEmail, counts: counts
    };
  });

  return {
    requests: byStatus,
    totalRequests: requests.length,
    companies: companies,
    totalCompanies: registry.length,
    platformUsage: usage,
    configured: {
      masterSheet: !!prop_(PROP.MASTER_ID, ''),
      driveRoot: !!prop_(PROP.DRIVE_ROOT_ID, ''),
      tokenSecret: !!prop_(PROP.TOKEN_SECRET, ''),
      ownerEmail: !!prop_(PROP.OWNER_EMAIL, ''),
      devMode: devMode_()
    },
    serverTime: iso_(new Date())
  };
}

function actionListSignupRequests(payload, ctx) {
  assertOwner_(ctx);
  var status = str_(payload.status, 20) || 'Pending';
  var rows = readTable_(masterSpreadsheet_(), 'CompanySignupRequests');
  if (status !== 'All') rows = rows.filter(function (r) { return String(r.Status) === status; });
  rows = sortBy_(rows, function (r) { return String(r.SubmittedAt); }, true);
  return {
    count: rows.length,
    requests: rows.map(function (r) {
      return {
        requestId: r.RequestID, companyName: r.CompanyName, gst: r.GST, address: r.Address,
        contactPerson: r.ContactPerson, designation: r.Designation, email: r.Email,
        mobile: r.Mobile, industryType: r.IndustryType, status: r.Status,
        submittedAt: r.SubmittedAt, reviewedBy: r.ReviewedBy, reviewNote: r.ReviewNote,
        reviewedAt: r.ReviewedAt || '', companyId: r.CompanyID, otpVerified: r.OtpVerified,
        logoLink: r.LogoLink
      };
    })
  };
}

/**
 * Approve a signup request (§3 step 4):
 * create the company spreadsheet, Drive folder, registry row and the first
 * Super Admin with a hashed temporary password, then e-mail the credentials.
 */
function actionApproveCompany(payload, ctx) {
  assertOwner_(ctx);
  requireFields_(payload, ['requestId']);
  var ss = masterSpreadsheet_();
  var req = findRecord_(ss, 'CompanySignupRequests', 'RequestID', payload.requestId);
  assert_(req, 'Signup request not found', 404);
  assert_(String(req.Status) !== 'Approved', 'This request was already approved (' + (req.CompanyID || '') + ')', 409);

  var companyId = str_(payload.companyId, 32) || ('CMP-' + shortId_(6));
  assert_(!findCompany_(companyId), 'CompanyID already in use: ' + companyId, 409);

  var companyName = str_(req.CompanyName, 160);
  var companySS = createCompanySpreadsheet_(companyName, companyId, String(req.Email));
  var folder = companyDriveFolder_({ CompanyID: companyId, CompanyName: companyName }, true);

  var tempPassword = str_(payload.tempPassword, 40) || randomPassword_(10);
  var superAdminId = 'SA-' + companyId.replace(/^CMP-/, '') + '-' + shortId_(4);

  var superAdmin = {
    UserID: superAdminId,
    Role: ROLES.SUPER_ADMIN,
    Name: str_(req.ContactPerson, 120) || 'Super Admin',
    MobileNumber: str_(req.Mobile, 20),
    Email: String(req.Email).toLowerCase(),
    PasswordHash: hashPassword_(tempPassword),
    PermissionsJSON: jsonString_({ __all: true }),
    ProjectScopeJSON: jsonString_(['ALL']),
    Status: 'Active',
    DeviceID: '',
    CreatedAt: fmtDateTime_(new Date()),
    Designation: str_(req.Designation, 80) || 'Super Admin',
    SalaryType: 'Monthly',
    MustChangePassword: 'Y',
    DeviceStatus: 'Unbound',
    JoinedAt: fmtDate_(new Date()),
    Notes: 'Auto-created on company approval'
  };
  appendRecord_(companySS, 'Users', superAdmin);

  writeSettings_(companySS, {
    companyName: companyName,
    gst: str_(req.GST, 32),
    companyAddress: str_(req.Address, 400),
    industryType: str_(req.IndustryType, 60),
    companyLogoLink: str_(req.LogoLink, 400),
    timezone: platformTimezone_(),
    setupCompleted: 'N'
  }, 'platform');

  var registryRow = {
    CompanyID: companyId,
    CompanyName: companyName,
    SheetID: companySS.getId(),
    SuperAdminEmail: superAdmin.Email,
    Status: 'Active',
    CreatedAt: fmtDateTime_(new Date()),
    PlanTier: str_(payload.planTier, 20) || 'Free',
    GST: str_(req.GST, 32),
    Mobile: str_(req.Mobile, 20),
    ContactPerson: str_(req.ContactPerson, 120),
    IndustryType: str_(req.IndustryType, 60),
    DriveFolderID: folder ? folder.getId() : '',
    SuperAdminUserID: superAdminId,
    TimeZone: platformTimezone_(),
    EmployeeCount: 1,
    LastActiveAt: fmtDateTime_(new Date())
  };
  appendRecord_(ss, 'CompanyRegistry', registryRow);

  updateRecord_(ss, 'CompanySignupRequests', 'RequestID', req.RequestID, {
    Status: 'Approved',
    ReviewedBy: 'PlatformOwner',
    ReviewNote: str_(payload.reviewNote, 300) || 'Approved',
    ReviewedAt: fmtDateTime_(new Date()),
    CompanyID: companyId
  });

  audit_(companySS, { userId: 'platform', role: ROLES.OWNER, companyId: companyId },
    'COMPANY_APPROVED', 'Company', companyId,
    { sheetId: companySS.getId(), superAdmin: superAdminId }, 'OK');

  sendEmail_(superAdmin.Email,
    'Welcome to SiteTrack — your Super Admin credentials',
    'Hello ' + superAdmin.Name + ',\n\n' +
    'Your company "' + companyName + '" has been approved on SiteTrack.\n\n' +
    'Company ID: ' + companyId + '\n' +
    'User ID: ' + superAdminId + '\n' +
    'Mobile: ' + superAdmin.MobileNumber + '\n' +
    'Temporary password: ' + tempPassword + '\n\n' +
    'Sign in at the SiteTrack web app and you will be asked to change this password, ' +
    'then guided through the Company Setup Wizard (geofence radius, attendance window, ' +
    'working days and holiday calendar).\n\n' +
    'Never share your password. SiteTrack staff will never ask for it.\n\n— SiteTrack');

  platformAudit_('APPROVE_COMPANY', {
    requestId: req.RequestID, companyId: companyId, sheetId: companySS.getId(), superAdmin: superAdminId
  }, 'OK');

  return {
    companyId: companyId,
    companyName: companyName,
    sheetId: companySS.getId(),
    sheetUrl: companySS.getUrl ? companySS.getUrl() : '',
    superAdminUserId: superAdminId,
    tempPassword: devMode_() ? tempPassword : '(emailed to ' + superAdmin.Email + ')',
    credentialsEmailed: true,
    tabsCreated: COMPANY_TAB_ORDER.length
  };
}

function actionRejectCompany(payload, ctx) {
  assertOwner_(ctx);
  requireFields_(payload, ['requestId', 'reviewNote']);
  var ss = masterSpreadsheet_();
  var req = findRecord_(ss, 'CompanySignupRequests', 'RequestID', payload.requestId);
  assert_(req, 'Signup request not found', 404);
  assert_(String(req.Status) !== 'Approved', 'An approved request cannot be rejected', 409);

  updateRecord_(ss, 'CompanySignupRequests', 'RequestID', req.RequestID, {
    Status: 'Rejected',
    ReviewedBy: 'PlatformOwner',
    ReviewNote: str_(payload.reviewNote, 300),
    ReviewedAt: fmtDateTime_(new Date())
  });
  if (emailOk_(req.Email)) {
    sendEmail_(req.Email, 'SiteTrack signup request — update',
      'Hello ' + (req.ContactPerson || '') + ',\n\nYour signup request for "' + req.CompanyName +
      '" was not approved.\nReason: ' + str_(payload.reviewNote, 300) +
      '\n\nYou can submit a corrected request at any time.\n\n— SiteTrack');
  }
  platformAudit_('REJECT_COMPANY', { requestId: req.RequestID, reason: str_(payload.reviewNote, 200) }, 'OK');
  return { requestId: req.RequestID, status: 'Rejected' };
}

function actionListCompanies(payload, ctx) {
  assertOwner_(ctx);
  var rows = listCompaniesRaw_();
  var q = str_(payload.query, 80).toLowerCase();
  if (q) {
    rows = rows.filter(function (c) {
      return String(c.CompanyName).toLowerCase().indexOf(q) >= 0 ||
        String(c.CompanyID).toLowerCase().indexOf(q) >= 0 ||
        String(c.SuperAdminEmail).toLowerCase().indexOf(q) >= 0;
    });
  }
  rows = sortBy_(rows, function (c) { return String(c.CreatedAt); }, true);
  return {
    count: rows.length,
    companies: rows.map(function (c) {
      return {
        companyId: c.CompanyID, companyName: c.CompanyName, sheetId: c.SheetID,
        sheetUrl: c.SheetID ? sheetUrl_(c.SheetID) : '',
        superAdminEmail: c.SuperAdminEmail, superAdminUserId: c.SuperAdminUserID,
        status: c.Status, createdAt: c.CreatedAt, planTier: c.PlanTier || 'Free',
        gst: c.GST, mobile: c.Mobile, industryType: c.IndustryType,
        driveFolderId: c.DriveFolderID, timeZone: c.TimeZone,
        suspendedReason: c.SuspendedReason || '', lastActiveAt: c.LastActiveAt || '',
        employeeCount: num_(c.EmployeeCount, 0)
      };
    })
  };
}

function actionSetCompanyStatus(payload, ctx) {
  assertOwner_(ctx);
  requireFields_(payload, ['companyId', 'status']);
  var status = pickOne_(payload.status, ['Active', 'Suspended', 'Closed'], '');
  assert_(status, 'Status must be Active, Suspended or Closed', 400);
  var ss = masterSpreadsheet_();
  var co = findCompany_(payload.companyId);
  assert_(co, 'Company not found', 404);
  updateRecord_(ss, 'CompanyRegistry', 'CompanyID', co.CompanyID, {
    Status: status,
    SuspendedReason: status === 'Active' ? '' : str_(payload.reason, 300)
  });
  if (co.SheetID && status !== 'Active') {
    try {
      var css = companySpreadsheetById_(co.SheetID);
      audit_(css, { userId: 'platform', role: ROLES.OWNER, companyId: co.CompanyID },
        'COMPANY_STATUS_CHANGED', 'Company', co.CompanyID, { status: status, reason: str_(payload.reason, 200) }, 'OK');
    } catch (e) { }
  }
  platformAudit_('SET_COMPANY_STATUS', { companyId: co.CompanyID, status: status }, 'OK');
  return { companyId: co.CompanyID, status: status };
}

function actionOpenCompanySheet(payload, ctx) {
  assertOwner_(ctx);
  requireFields_(payload, ['companyId']);
  var co = findCompany_(payload.companyId);
  assert_(co, 'Company not found', 404);
  return { companyId: co.CompanyID, sheetId: co.SheetID, sheetUrl: sheetUrl_(co.SheetID) };
}

function actionPlatformAuditLog(payload, ctx) {
  assertOwner_(ctx);
  var ss = masterSpreadsheet_();
  if (!ss.getSheetByName('PlatformAuditLog')) return { count: 0, entries: [] };
  var rows = readTable_(ss, 'PlatformAuditLog');
  rows = sortBy_(rows, function (r) { return String(r.Timestamp); }, true);
  var limit = Math.min(Math.max(num_(payload.limit, 200), 1), 1000);
  return { count: Math.min(rows.length, limit), entries: rows.slice(0, limit) };
}

function actionSetScriptProperty(payload, ctx) {
  assertOwner_(ctx);
  requireFields_(payload, ['key']);
  var key = str_(payload.key, 64).toUpperCase();
  assert_(PROP_LIST_.indexOf(key) >= 0, 'Unknown property key: ' + key, 400);
  setProp_(key, str_(payload.value, 2000));
  platformAudit_('SET_SCRIPT_PROPERTY', { key: key }, 'OK');
  return { key: key, set: true, value: key === PROP.OWNER_KEY || key === PROP.TOKEN_SECRET ||
    key === PROP.WHATSAPP_TOKEN ? '(hidden)' : str_(payload.value, 200) };
}

function actionListScriptProperties(payload, ctx) {
  assertOwner_(ctx);
  var secretKeys = [PROP.OWNER_KEY, PROP.TOKEN_SECRET, PROP.WHATSAPP_TOKEN];
  return {
    properties: PROP_LIST_.map(function (k) {
      var v = prop_(k, '');
      return { key: k, set: !!v, value: secretKeys.indexOf(k) >= 0 ? (v ? '(hidden, ' + v.length + ' chars)' : '') : v };
    })
  };
}

/** Keys an owner may set through the API. */
var PROP_LIST_ = [
  PROP.MASTER_ID, PROP.OWNER_KEY, PROP.OWNER_EMAIL, PROP.TOKEN_SECRET, PROP.DRIVE_ROOT_ID,
  PROP.TIMEZONE, PROP.DEV_MODE, PROP.WHATSAPP_TOKEN, PROP.WHATSAPP_PHONE_ID, PROP.MAPS_API_KEY,
  PROP.WEATHER_ENABLED, PROP.MAIL_FROM_NAME, PROP.ALLOW_UNVERIFIED_SIGNUP, PROP.SELFIE_MAX_BYTES
];

function sheetUrl_(sheetId) {
  return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit';
}

/* -------------------------------------------------------------------------- */
/*  Demo seeding (owner only)                                                 */
/* -------------------------------------------------------------------------- */

function actionSeedDemoCompany(payload, ctx) {
  assertOwner_(ctx);
  var result = seedDemoCompany_(str_(payload.companyName, 120) || 'Demo Fitout Pvt Ltd',
    str_(payload.superAdminEmail, 120) || 'demo.admin@sitetrack.local',
    str_(payload.password, 40) || 'Demo@1234');
  platformAudit_('SEED_DEMO_COMPANY', { companyId: result.companyId }, 'OK');
  return result;
}
