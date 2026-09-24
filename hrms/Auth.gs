/**
 * ============================================================================
 *  FocusHR  —  Auth.gs
 *  Signup, OTP verification, company / employee / super-admin login, session
 *  lifecycle, password reset, impersonation and the login-page bootstrap.
 *
 *  Sessions: 48 char random token -> only its SHA-256 hash is stored.
 *  8 hour absolute lifetime, 30 minute sliding idle window.
 * ============================================================================
 */

var Auth = {

  /* ------------------------------------------------------- login page --- */
  bootstrap: function (payload) {
    var out = {
      app: { name: APP.name, tagline: APP.tagline, version: APP.version, setup: !!prop_(PROPS.master) },
      branding: { brand_color: '#2563eb', logo_file_id: '', name: APP.name, tagline: APP.tagline },
      company: null,
      captcha: false,
      demo: false,
      server_time: nowIso_(),
      today: todayIso_()
    };
    var code = txt_(payload && payload.company);
    if (code) {
      var row = Db.findOne(masterCtx_(), 'Companies', function (c) {
        return txt_(c.company_id).toUpperCase() === code.toUpperCase() || txt_(c.name).toLowerCase() === code.toLowerCase();
      });
      if (row) {
        out.branding = {
          brand_color: txt_(row.brand_color) || '#2563eb',
          logo_file_id: txt_(row.logo_file_id),
          name: txt_(row.name),
          tagline: txt_(row.city) ? 'HR & Payroll · ' + row.city : APP.tagline
        };
        out.company = { company_id: row.company_id, name: row.name, status: row.status, city: row.city, state: row.state };
      } else {
        out.company_error = 'No company found for "' + code + '". You can still sign in normally.';
      }
    }
    return out;
  },

  /* ---------------------------------------------------------- sessions --- */
  requestMeta: function (e) {
    var ip = '';
    try {
      ip = txt_(e && e.parameter && (e.parameter.ip || e.parameter.userIp)) ||
        (e && e.headers && (e.headers['X-Forwarded-For'] || e.headers['x-forwarded-for'])) || '';
    } catch (err) { ip = ''; }
    return { ip: txt_(ip).slice(0, 60), userAgent: txt_(e && e.userAgent).slice(0, 200) };
  },

  createSession: function (user, meta, extra) {
    var x = extra || {};
    var token = randomToken_(48);
    var now = new Date();
    var expires = new Date(now.getTime() + APP.sessionAbsoluteHours * 3600 * 1000);
    var rec = Db.insert(masterCtx_(), 'Sessions', {
      token_hash: sha256Hex_(token),
      user_id: user.user_id,
      scope: x.scope || user.scope || 'COMPANY',
      company_id: txt_(user.company_id),
      employee_id: txt_(user.employee_id),
      role_code: txt_(user.role_code),
      name: txt_(user.name),
      ip: txt_(meta && meta.ip),
      user_agent: txt_(meta && meta.userAgent).slice(0, 200),
      issued_at: nowIso_(),
      last_seen_at: nowIso_(),
      expires_at: Utilities.formatDate(expires, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss"),
      impersonated_by: txt_(x.impersonatedBy)
    }, { system: true });
    return { token: token, session_id: rec.session_id };
  },

  /**
   * Resolve a token into the immutable request context used by every handler.
   * Throws UNAUTHORIZED when the token is bad / expired / revoked.
   */
  contextFromToken: function (token, meta) {
    if (!txt_(token)) fail_('UNAUTHORIZED', 'Please sign in to continue.');
    var hash = sha256Hex_(token);
    var session = Db.findOne(masterCtx_(), 'Sessions', function (s) { return txt_(s.token_hash) === hash; });
    if (!session) fail_('UNAUTHORIZED', 'Your session is no longer valid. Please sign in again.');
    if (txt_(session.ended_at)) fail_('SESSION_ENDED', 'This session was signed out or handed back to the Super Admin.');

    var now = nowIso_();
    if (now > txt_(session.expires_at)) fail_('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');

    var idleLimit = new Date(isoToDate_(session.last_seen_at).getTime() + APP.sessionIdleMinutes * 60000);
    if (nowIso_() > Utilities.formatDate(idleLimit, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss")) {
      Db.update(masterCtx_(), 'Sessions', 'session_id', session.session_id, { ended_at: now, ended_reason: 'IDLE_TIMEOUT' }, { system: true });
      fail_('SESSION_EXPIRED', 'You were signed out after ' + APP.sessionIdleMinutes + ' minutes of inactivity.');
    }

    var u = Db.find(masterCtx_(), 'Users', 'user_id', session.user_id);
    if (!u) fail_('UNAUTHORIZED', 'This account no longer exists.');
    if (txt_(u.status).toUpperCase() === 'INACTIVE') fail_('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact your administrator.');
    if (txt_(u.status).toUpperCase() === 'LOCKED' && txt_(u.locked_until) > now) {
      fail_('ACCOUNT_LOCKED', 'Your account is locked until ' + fmtDateHuman_(u.locked_until, 'dd MMM, HH:mm') + '.');
    }

    var ctx = {
      token: token,
      sessionId: session.session_id,
      userId: u.user_id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      scope: txt_(session.scope) || 'COMPANY',
      companyId: txt_(session.company_id),
      employeeId: txt_(session.employee_id) || txt_(u.employee_id),
      role_code: txt_(u.role_code) || txt_(session.role_code),
      mustChange: boolVal_(u.must_change_password),
      impersonatedBy: txt_(session.impersonated_by),
      ip: txt_(meta && meta.ip),
      userAgent: txt_(meta && meta.userAgent),
      __user: u
    };
    if (ctx.scope === 'COMPANY') {
      ctx.companyCtx = companyCtx_(ctx.companyId, { requireActive: !ctx.impersonatedBy });
      ctx.company = ctx.companyCtx.company;
    }

    // sliding window: refresh last_seen (throttled to keep writes low) + expiry
    var lastSeenMs = isoToDate_(session.last_seen_at) ? isoToDate_(session.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeenMs > 45000) {
      var lastSeenIso = isoToDate_(session.last_seen_at);
      var slippedMs = lastSeenIso ? Date.now() - lastSeenIso.getTime() : 0;
      var absoluteEnd = isoToDate_(session.issued_at)
        ? new Date(isoToDate_(session.issued_at).getTime() + APP.sessionAbsoluteHours * 3600 * 1000)
        : new Date(Date.now() + APP.sessionIdleMinutes * 60000);
      var idleEnd = new Date(Date.now() + APP.sessionIdleMinutes * 60000);
      var newEnd = idleEnd.getTime() < absoluteEnd.getTime() ? idleEnd : absoluteEnd;
      Db.update(masterCtx_(), 'Sessions', 'session_id', session.session_id, {
        last_seen_at: nowIso_(),
        expires_at: Utilities.formatDate(newEnd, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss")
      }, { system: true });
      Logger.log('session touched, slipped ' + Math.round(slippedMs / 1000) + 's');
    }
    return ctx;
  },

  sessionInfo: function (ctx) {
    var eff = Perm.load(ctx);
    var employee = Perm.currentEmployee(ctx);
    var out = {
      user: {
        user_id: ctx.userId, name: ctx.name, email: ctx.email, phone: ctx.phone,
        scope: ctx.scope, role_code: eff.roleCode, role_name: eff.roleName, data_scope: eff.dataScope
      },
      must_change_password: ctx.mustChange,
      impersonated: !!ctx.impersonatedBy,
      permissions: eff.isSuper ? ['*'] : Object.keys(eff.permissions),
      is_super: eff.isSuper,
      today: todayIso_(),
      server_time: nowIso_()
    };
    if (ctx.scope === 'COMPANY') {
      out.company = {
        company_id: ctx.companyId,
        name: txt_(ctx.company.name),
        legal_name: txt_(ctx.company.legal_name),
        status: ctx.company.status,
        city: ctx.company.city,
        state: ctx.company.state,
        brand_color: txt_(ctx.company.brand_color) || '#2563eb',
        logo_file_id: txt_(ctx.company.logo_file_id),
        plan: ctx.company.plan
      };
      out.company_settings = {
        date_format: getSetting_(ctx, 'general.date_format', 'dd MMM yyyy'),
        week_start: getSetting_(ctx, 'general.week_start', 'MONDAY'),
        radius_m: getSettingNum_(ctx, 'attendance.radius_m', APP.defaultRadiusM),
        shift_start: getSetting_(ctx, 'attendance.shift_start', '09:00'),
        shift_end: getSetting_(ctx, 'attendance.shift_end', '18:00'),
        weekly_off: getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY'),
        payslip_template: getSetting_(ctx, 'payroll.payslip_template', 'CLASSIC')
      };
    }
    if (employee) {
      out.employee = {
        employee_id: employee.employee_id, code: employee.code, name: employee.name,
        designation: employee.designation, department: employee.department, status: employee.status,
        project_id: employee.project_id, joining_date: employee.joining_date,
        must_punch_project: !txt_(employee.project_id)
      };
    }
    return out;
  },

  logout: function (ctx) {
    if (!ctx) return { ok: true };
    Db.update(masterCtx_(), 'Sessions', 'session_id', ctx.sessionId, {
      ended_at: nowIso_(), ended_reason: 'USER_LOGOUT'
    }, { system: true });
    Audit.info(ctx, 'auth', 'auth.logout', 'Sessions', ctx.sessionId, 'Signed out');
    return { ok: true };
  },

  /* ------------------------------------------------------ password rules - */
  assertPasswordPolicy_: function (pwd, confirm) {
    var p = txt_(pwd);
    if (p.length < APP.passwordMinLength) fail_('VALIDATION', 'Password must be at least ' + APP.passwordMinLength + ' characters long.', { field: 'new_password' });
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail_('VALIDATION', 'Password must contain at least one letter and one number.', { field: 'new_password' });
    if (txt_(confirm) && p !== txt_(confirm)) fail_('VALIDATION', 'The two passwords do not match.', { field: 'confirm_password' });
    return p;
  },

  setPassword_: function (user, password) {
    var salt = randomSalt_();
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
      password_salt: salt,
      password_hash: hashPassword_(password, salt),
      password_set_at: nowIso_(),
      must_change_password: 'FALSE',
      failed_attempts: 0,
      locked_until: ''
    }, { system: true });
  },

  /* -------------------------------------------------------- rate limiting */
  rateLimit_: function (bucket, limit, windowSec) {
    var key = 'rl_' + bucket;
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    var count = raw ? intVal_(raw, 0) : 0;
    if (count >= limit) {
      fail_('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
    }
    cache.put(key, String(count + 1), windowSec || 3600);
    return count + 1;
  },

  /* ------------------------------------------------- login attempt guard - */
  bumpFailure_: function (user, label) {
    var attempts = intVal_(user.failed_attempts, 0) + 1;
    var patch = { failed_attempts: attempts };
    if (attempts >= APP.loginMaxAttempts) {
      var until = new Date(Date.now() + APP.loginLockMinutes * 60000);
      patch.locked_until = Utilities.formatDate(until, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss");
      patch.status = 'LOCKED';
    }
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, patch, { system: true });
    var left = Math.max(0, APP.loginMaxAttempts - attempts);
    if (attempts >= APP.loginMaxAttempts) {
      fail_('ACCOUNT_LOCKED', 'Too many wrong attempts. This account is locked for ' + APP.loginLockMinutes + ' minutes.');
    }
    fail_('BAD_CREDENTIALS', 'Incorrect ' + (label || 'credentials') + '. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before the account is locked.');
  },

  clearFailures_: function (user) {
    if (intVal_(user.failed_attempts, 0) || txt_(user.locked_until)) {
      Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
        failed_attempts: 0, locked_until: '', status: txt_(user.status).toUpperCase() === 'LOCKED' ? 'ACTIVE' : user.status
      }, { system: true });
    }
  },

  checkLoginAllowed_: function (user) {
    if (!user) fail_('BAD_CREDENTIALS', 'Incorrect email or password.');
    var status = txt_(user.status).toUpperCase();
    if (status === 'INACTIVE') fail_('ACCOUNT_DISABLED', 'This account has been deactivated. Please contact your administrator.');
    if (txt_(user.locked_until) && txt_(user.locked_until) > nowIso_()) {
      fail_('ACCOUNT_LOCKED', 'Too many wrong attempts. Try again after ' + fmtDateHuman_(user.locked_until, 'dd MMM, HH:mm') + '.');
    }
  },

  verifyPassword_: function (user, password) {
    if (!txt_(user.password_hash)) {
      fail_('NEEDS_ACTIVATION', 'This account has not been activated yet. Please set your password using the OTP sent to your mobile number.');
    }
    return hashPassword_(password, user.password_salt) === txt_(user.password_hash);
  },

  loginResponse_: function (ctx, user, meta, impersonatedBy) {
    var s = Auth.createSession(user, meta, { impersonatedBy: impersonatedBy, scope: user.scope });
    var sessionCtx = {
      token: s.token, sessionId: s.session_id, userId: user.user_id, name: user.name, email: user.email,
      phone: user.phone, scope: user.scope, companyId: txt_(user.company_id), employeeId: txt_(user.employee_id),
      role_code: txt_(user.role_code), mustChange: boolVal_(user.must_change_password), impersonatedBy: txt_(impersonatedBy),
      ip: txt_(meta && meta.ip), userAgent: txt_(meta && meta.userAgent)
    };
    if (user.scope === 'COMPANY') {
      sessionCtx.companyCtx = companyCtx_(user.company_id);
      sessionCtx.company = sessionCtx.companyCtx.company;
    }
    var info = Auth.sessionInfo(sessionCtx);
    info.token = s.token;
    return info;
  },

  /* -------------------------------------------------------- company login */
  loginCompany: function (payload, meta, e) {
    Auth.rateLimit_('login_' + txt_(meta.ip), APP.rateLimitLoginPerHour, 3600);
    var email = normEmail_(payload.email);
    var user = Db.findOne(masterCtx_(), 'Users', function (u) {
      return normEmail_(u.email) === email && txt_(u.scope) === 'COMPANY';
    });
    if (!user) {
      var emp = Db.findOne(masterCtx_(), 'Users', function (u) { return normEmail_(u.email) === email && txt_(u.scope) === 'EMPLOYEE_ONLY'; });
      if (emp) fail_('BAD_CREDENTIALS', 'This email is registered as an employee login. Please use the Employee tab with your mobile number.');
      fail_('BAD_CREDENTIALS', 'Incorrect email or password.');
    }
    Auth.checkLoginAllowed_(user);
    if (payload.company_id && txt_(user.company_id) !== txt_(payload.company_id)) {
      fail_('WRONG_COMPANY', 'This login belongs to another company. Please use the correct workspace link.');
    }
    if (!Auth.verifyPassword_(user, payload.password)) {
      Audit.write(masterCtx_(), { module: 'auth', action: 'auth.login.failed', entity: 'Users', entity_id: user.user_id, note: 'Wrong password (company login)', severity: 'SENSITIVE', actor_name: email });
      Auth.bumpFailure_(user, 'password');
    }
    var company = companyRow_(user.company_id);
    if (company) {
      var st = txt_(company.status).toUpperCase();
      if (st === 'PENDING') fail_('COMPANY_PENDING', 'Your company registration is still awaiting verification by our team. We will email you as soon as it is approved.');
      if (st === 'SUSPENDED') fail_('COMPANY_SUSPENDED', 'This company account is suspended. Please contact support.');
      if (st === 'REJECTED') fail_('COMPANY_REJECTED', 'This company registration was not approved. Please contact support.');
    }
    Auth.clearFailures_(user);
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, { last_login_at: nowIso_() }, { system: true });
    var result = Auth.loginResponse_(null, user, meta, '');
    Audit.write(masterCtx_(), { module: 'auth', action: 'auth.login.company', entity: 'Users', entity_id: user.user_id, note: 'Company login', actor_name: user.name, company_id: user.company_id, severity: 'SENSITIVE' });
    return result;
  },

  /* ---------------------------------------------------- super admin login */
  loginSuper: function (payload, meta) {
    Auth.rateLimit_('login_' + txt_(meta.ip), APP.rateLimitLoginPerHour, 3600);
    var email = normEmail_(payload.email);
    var user = Db.findOne(masterCtx_(), 'Users', function (u) {
      return normEmail_(u.email) === email && txt_(u.scope) === 'SUPER';
    });
    if (!user) fail_('BAD_CREDENTIALS', 'These credentials do not match any Super Admin account.');
    Auth.checkLoginAllowed_(user);
    if (!Auth.verifyPassword_(user, payload.password)) {
      Auth.bumpFailure_(user, 'password');
    }
    Auth.clearFailures_(user);
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, { last_login_at: nowIso_() }, { system: true });
    var result = Auth.loginResponse_(null, user, meta, '');
    Audit.write(masterCtx_(), { module: 'auth', action: 'auth.login.super', entity: 'Users', entity_id: user.user_id, note: 'Super Admin login', actor_name: user.name, severity: 'SENSITIVE' });
    return result;
  },

  /* ------------------------------------------------------- employee login */
  employeeCandidates_: function (phone) {
    var p = normPhone_(phone);
    if (!isPhoneIn_(p)) fail_('VALIDATION', 'Enter a valid 10-digit mobile number.', { field: 'phone' });
    var users = Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.scope) === 'COMPANY' && normPhone_(u.phone) === p && txt_(u.employee_id);
    });
    return users.map(function (u) {
      var company = companyRow_(u.company_id);
      var emp = null;
      try { emp = Db.find(companyCtx_(u.company_id, { requireActive: false }), 'Employees', 'employee_id', u.employee_id); } catch (err) { emp = null; }
      return {
        user: u,
        company_id: txt_(u.company_id),
        company_name: company ? txt_(company.name) : 'Company',
        employee_code: emp ? txt_(emp.code) : '',
        employee_name: emp ? txt_(emp.name) : txt_(u.name),
        activated: !!txt_(u.password_hash),
        status: txt_(u.status),
        company_status: company ? txt_(company.status) : ''
      };
    });
  },

  loginEmployee: function (payload, meta) {
    Auth.rateLimit_('login_' + txt_(meta.ip), APP.rateLimitLoginPerHour, 3600);
    var candidates = Auth.employeeCandidates_(payload.phone);
    if (!candidates.length) {
      fail_('NOT_REGISTERED', 'This mobile number is not registered with any company on ' + APP.name + '. Please contact your HR team to add your number, then try again.');
    }
    var list = payload.company_id ? candidates.filter(function (c) { return c.company_id === payload.company_id; }) : candidates;
    if (!list.length) fail_('NOT_REGISTERED', 'This mobile number is not registered with that company.');
    if (list.length > 1) {
      return {
        multiple: true,
        options: list.map(function (c) {
          return { company_id: c.company_id, company_name: c.company_name, employee_code: c.employee_code, employee_name: c.employee_name };
        })
      };
    }
    var hit = list[0];
    var user = hit.user;
    Auth.checkLoginAllowed_(user);
    if (txt_(hit.company_status).toUpperCase() === 'SUSPENDED') fail_('COMPANY_SUSPENDED', 'Your company account is currently suspended. Please contact your HR team.');
    if (txt_(hit.company_status).toUpperCase() === 'PENDING') fail_('COMPANY_PENDING', 'Your company registration is still awaiting verification. Please try again once HR confirms.');

    if (!txt_(user.password_hash)) {
      return {
        needs_activation: true,
        phone: normPhone_(payload.phone),
        company_id: hit.company_id,
        company_name: hit.company_name,
        employee_name: hit.employee_name,
        employee_code: hit.employee_code,
        message: 'First time here? We will send a 6-digit code to your mobile number to set your password.'
      };
    }
    if (!txt_(payload.password)) fail_('PASSWORD_REQUIRED', 'Please enter your password.', { field: 'password' });
    if (!Auth.verifyPassword_(user, payload.password)) {
      Audit.write(masterCtx_(), { module: 'auth', action: 'auth.login.failed', entity: 'Users', entity_id: user.user_id, note: 'Wrong password (employee login)', severity: 'SENSITIVE', actor_name: user.name });
      Auth.bumpFailure_(user, 'password');
    }
    Auth.clearFailures_(user);
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, { last_login_at: nowIso_() }, { system: true });
    var result = Auth.loginResponse_(null, user, meta, '');
    result.must_change_password = boolVal_(user.must_change_password);
    Audit.write(masterCtx_(), { module: 'auth', action: 'auth.login.employee', entity: 'Users', entity_id: user.user_id, note: 'Employee login', actor_name: user.name, severity: 'SENSITIVE' });
    return result;
  },

  checkPhone: function (payload) {
    Auth.rateLimit_('phone_' + normPhone_(payload.phone), 30, 3600);
    var candidates = Auth.employeeCandidates_(payload.phone);
    if (payload.company_id) candidates = candidates.filter(function (c) { return c.company_id === payload.company_id; });
    return {
      registered: candidates.length > 0,
      multiple: candidates.length > 1,
      options: candidates.map(function (c) {
        return {
          company_id: c.company_id, company_name: c.company_name, employee_code: c.employee_code,
          employee_name: c.employee_name, needs_activation: !c.activated
        };
      })
    };
  },

  /* ---------------------------------------------------------- OTP issue -- */
  createOtp_: function (purpose, identifier, ctxInfo) {
    var info = ctxInfo || {};
    var code = randomDigits_(6);
    // expire any previous live codes for the same purpose+identifier
    Db.all(masterCtx_(), 'OtpCodes', function (o) {
      return txt_(o.purpose) === purpose && txt_(o.identifier) === txt_(identifier) && !txt_(o.consumed_at) && txt_(o.expires_at) > nowIso_();
    }).forEach(function (o) {
      Db.update(masterCtx_(), 'OtpCodes', 'otp_id', o.otp_id, { consumed_at: nowIso_() }, { system: true });
    });
    var expires = new Date(Date.now() + APP.otpTtlMinutes * 60000);
    Db.insert(masterCtx_(), 'OtpCodes', {
      purpose: purpose,
      identifier: txt_(identifier),
      user_id: txt_(info.userId || ''),
      company_id: txt_(info.companyId || ''),
      code_hash: sha256Hex_(code + '|otp'),
      expires_at: Utilities.formatDate(expires, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss"),
      attempts: 0,
      max_attempts: APP.otpMaxAttempts,
      ip: txt_(info.ip),
      meta_json: jsonStr_(info.meta || {})
    }, { system: true });
    return code;
  },

  consumeOtp_: function (purpose, identifier, code) {
    var rows = Db.all(masterCtx_(), 'OtpCodes', function (o) {
      return txt_(o.purpose) === purpose && txt_(o.identifier) === txt_(identifier);
    });
    if (!rows.length) fail_('OTP_INVALID', 'No code was requested for this contact. Please tap "Send code" again.');
    rows = sortRows_(rows, 'created_at', 'DESC');
    var otp = rows[0];
    if (txt_(otp.consumed_at)) fail_('OTP_INVALID', 'This code was already used. Please request a new one.');
    if (txt_(otp.expires_at) < nowIso_()) fail_('OTP_EXPIRED', 'This code has expired. Please request a new one.');
    if (intVal_(otp.attempts, 0) >= intVal_(otp.max_attempts, APP.otpMaxAttempts)) {
      fail_('OTP_LOCKED', 'Too many wrong codes. Please request a new one.');
    }
    if (sha256Hex_(txt_(code) + '|otp') !== txt_(otp.code_hash)) {
      Db.update(masterCtx_(), 'OtpCodes', 'otp_id', otp.otp_id, { attempts: intVal_(otp.attempts, 0) + 1 }, { system: true });
      var left = Math.max(0, APP.otpMaxAttempts - (intVal_(otp.attempts, 0) + 1));
      fail_('OTP_INVALID', 'That code is not correct. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.');
    }
    Db.update(masterCtx_(), 'OtpCodes', 'otp_id', otp.otp_id, { consumed_at: nowIso_() }, { system: true });
    return otp;
  },

  /* --------------------------------------------------------- signup flow -- */
  signupStart: function (payload, meta) {
    Auth.rateLimit_('signup_' + txt_(meta.ip), 12, 3600);
    var gstin = txt_(payload.gstin).trim().toUpperCase();
    var pan = txt_(payload.pan).trim().toUpperCase();
    var adminEmail = normEmail_(payload.admin_email);
    var adminPhone = normPhone_(payload.admin_phone);
    var contactPhone = normPhone_(payload.contact_phone);

    if (!isGstin_(gstin)) fail_('VALIDATION', 'GSTIN format looks wrong. It should be 15 characters, e.g. 27ABCDE1234F1Z5.', { field: 'gstin' });
    if (!isPan_(pan)) fail_('VALIDATION', 'PAN format looks wrong. It should be 10 characters, e.g. ABCDE1234F.', { field: 'pan' });
    var stateCode = gstinStateCode_(gstin);
    var expectedState = GST_STATE_CODES[stateCode];
    if (!expectedState) fail_('VALIDATION', 'The first two digits of the GSTIN (' + stateCode + ') are not a valid state code.', { field: 'gstin' });
    if (txt_(payload.state) && txt_(payload.state).toLowerCase() !== expectedState.toLowerCase()) {
      fail_('VALIDATION', 'GSTIN starts with ' + stateCode + ' which belongs to ' + expectedState + ', but you selected ' + payload.state + '. Please check both.', { field: 'state' });
    }
    if (!isEmail_(adminEmail) && !isPhoneIn_(adminPhone)) fail_('VALIDATION', 'Enter a valid admin email or mobile number.');

    var nameKey = txt_(payload.company_name).trim().toLowerCase();
    var dupe = Db.findOne(masterCtx_(), 'Companies', function (c) {
      if (txt_(c.status).toUpperCase() === 'REJECTED') return false;
      return txt_(c.name).trim().toLowerCase() === nameKey ||
        txt_(c.gstin).trim().toUpperCase() === gstin ||
        normEmail_(c.admin_email) === adminEmail ||
        normPhone_(c.admin_phone) === adminPhone ||
        normPhone_(c.contact_phone) === contactPhone;
    });
    if (dupe) {
      fail_('COMPANY_EXISTS', 'This company is already registered. Please log in.');
    }

    var company = Db.insert(masterCtx_(), 'Companies', {
      name: txt_(payload.company_name).trim(),
      legal_name: txt_(payload.legal_name || payload.company_name).trim(),
      gstin: gstin,
      pan: pan,
      state_code: stateCode,
      state: expectedState,
      city: txt_(payload.city),
      address: txt_(payload.address),
      pincode: txt_(payload.pincode),
      contact_name: txt_(payload.contact_name),
      contact_email: normEmail_(payload.contact_email) || adminEmail,
      contact_phone: contactPhone,
      industry: txt_(payload.industry),
      company_size: txt_(payload.company_size),
      plan: txt_(payload.plan || 'TRIAL'),
      status: 'PENDING',
      verification_mode: Config.systemBool_('require_company_verification', true) ? 'MANUAL' : 'AUTO',
      admin_name: txt_(payload.admin_name),
      admin_email: adminEmail,
      admin_phone: adminPhone,
      notes: 'Self signup on ' + todayIso_()
    }, { system: true, actor: 'SIGNUP' });

    Audit.write(masterCtx_(), {
      module: 'auth', action: 'auth.signup.start', entity: 'Companies', entity_id: company.company_id,
      note: 'Registration started for ' + company.name, actor_name: company.admin_name, severity: 'SENSITIVE'
    });

    var purpose = 'SIGNUP';
    var otp = Auth.createOtp_(purpose, adminEmail, { companyId: company.company_id, ip: meta.ip, meta: { phone: adminPhone } });
    Notify.sendOtp({ email: adminEmail, phone: adminPhone, code: otp, purpose: purpose, company_id: company.company_id, name: company.admin_name });

    return {
      signup_id: company.company_id,
      company_name: company.name,
      otp_sent_to: { email: maskEmail_(adminEmail), phone: maskPhone_(adminPhone) },
      resend_in: APP.otpResendCooldownSec,
      expires_in_minutes: APP.otpTtlMinutes,
      message: 'We sent a 6-digit verification code to your email and mobile number.'
    };
  },

  signupSendOtp: function (payload, meta) {
    var company = companyRow_(payload.signup_id);
    if (!company) fail_('NOT_FOUND', 'This registration was not found. Please start again.');
    if (txt_(company.status).toUpperCase() !== 'PENDING') fail_('ALREADY_DONE', 'This registration is already verified. Please log in.');
    var id = normEmail_(company.admin_email);
    var last = Db.all(masterCtx_(), 'OtpCodes', function (o) { return txt_(o.purpose) === 'SIGNUP' && txt_(o.identifier) === id; });
    if (last.length) {
      var newest = sortRows_(last, 'created_at', 'DESC')[0];
      var ageSec = (Date.now() - (isoToDate_(newest.created_at) ? isoToDate_(newest.created_at).getTime() : 0)) / 1000;
      if (ageSec < APP.otpResendCooldownSec && !txt_(newest.consumed_at)) {
        fail_('OTP_COOLDOWN', 'Please wait ' + Math.ceil(APP.otpResendCooldownSec - ageSec) + ' seconds before requesting another code.');
      }
    }
    Auth.rateLimit_('otp_' + id, APP.rateLimitOtpPerHour, 3600);
    var otp = Auth.createOtp_('SIGNUP', id, { companyId: company.company_id, ip: meta.ip, meta: { phone: company.admin_phone } });
    Notify.sendOtp({ email: id, phone: company.admin_phone, code: otp, purpose: 'SIGNUP', company_id: company.company_id, name: company.admin_name });
    return { sent: true, otp_sent_to: { email: maskEmail_(id), phone: maskPhone_(company.admin_phone) }, resend_in: APP.otpResendCooldownSec };
  },

  signupVerify: function (payload, meta) {
    var company = companyRow_(payload.signup_id);
    if (!company) fail_('NOT_FOUND', 'This registration was not found. Please start again.');
    var chosen = Auth.assertPasswordPolicy_(payload.password, payload.confirm_password);
    Auth.consumeOtp_('SIGNUP', normEmail_(company.admin_email), payload.otp);
    var prov = Company.provision_(company, meta, {
      admin_email: normEmail_(company.admin_email),
      admin_name: txt_(company.admin_name),
      admin_password: chosen,
      source: 'SIGNUP'
    });
    setProp_('CFG_SUPER_EMAIL', prop_('CFG_SUPER_EMAIL', ''));
    var autoApprove = txt_(company.verification_mode) === 'AUTO' || !Config.systemBool_('require_company_verification', true);
    Db.update(masterCtx_(), 'Companies', 'company_id', company.company_id, {
      status: autoApprove ? 'ACTIVE' : 'PENDING',
      approved_at: autoApprove ? nowIso_() : '',
      verification_remark: autoApprove ? 'Auto-approved: manual verification disabled in system config.' : 'Awaiting Super Admin verification.'
    }, { system: true });

    var updated = companyRow_(company.company_id);
    Notify.send({
      to: normEmail_(company.admin_email),
      template: 'SIGNUP_RECEIVED',
      company_id: company.company_id,
      vars: {
        admin_name: txt_(company.admin_name), company_name: txt_(company.name),
        status: updated.status, login_email: normEmail_(company.admin_email),
        app_name: APP.name, pending: updated.status === 'PENDING'
      }
    });
    if (autoApprove) {
      Notify.notifyCompanyAdmins_(updated.company_id, {
        title: 'Welcome to ' + APP.name,
        body: 'Your workspace for ' + txt_(company.name) + ' is ready. Add your employees to get started.',
        kind: 'SYSTEM'
      });
    }
    Audit.write(masterCtx_(), {
      module: 'auth', action: 'auth.signup.verify', entity: 'Companies', entity_id: company.company_id,
      note: 'OTP verified, workspace provisioned, status ' + updated.status, actor_name: company.admin_name, severity: 'SENSITIVE'
    });
    return {
      verified: true,
      status: updated.status,
      company_id: company.company_id,
      company_name: txt_(company.name),
      email: normEmail_(company.admin_email),
      workspace: { spreadsheet_id: prov.spreadsheet_id, drive_folder_id: prov.drive_folder_id },
      pending: updated.status === 'PENDING',
      message: updated.status === 'PENDING'
        ? 'Your email is verified. Our team will review your company details and activate the account, usually within one working day. We will email you at ' + normEmail_(company.admin_email) + '.'
        : 'Your account is active. You can log in now with the password you chose.'
    };
  },

  signupStatus: function (payload) {
    var c = companyRow_(payload.signup_id);
    if (!c) fail_('NOT_FOUND', 'This registration was not found.');
    return {
      status: txt_(c.status),
      company_name: txt_(c.name),
      verification_remark: txt_(c.verification_remark),
      approved_at: txt_(c.approved_at),
      can_login: txt_(c.status).toUpperCase() === 'ACTIVE'
    };
  },

  /* ------------------------------------------------- employee activation -- */
  employeeSendOtp: function (payload, meta) {
    var candidates = Auth.employeeCandidates_(payload.phone);
    if (payload.company_id) candidates = candidates.filter(function (c) { return c.company_id === payload.company_id; });
    if (candidates.length > 1) {
      return { multiple: true, options: candidates.map(function (c) { return { company_id: c.company_id, company_name: c.company_name, employee_code: c.employee_code, employee_name: c.employee_name }; }) };
    }
    if (!candidates.length) fail_('NOT_REGISTERED', 'This mobile number is not registered with any company on ' + APP.name + '. Please ask your HR team to add it.');
    var hit = candidates[0];
    var purpose = txt_(payload.purpose) || (txt_(hit.user.password_hash) ? 'EMPLOYEE_RESET' : 'EMPLOYEE_ACTIVATE');
    var id = normPhone_(payload.phone);
    Auth.rateLimit_('otp_' + id, APP.rateLimitOtpPerHour, 3600);
    var otp = Auth.createOtp_(purpose, id, { userId: hit.user.user_id, companyId: hit.company_id, ip: meta.ip });
    Notify.sendOtp({ phone: id, code: otp, purpose: purpose, company_id: hit.company_id, name: hit.employee_name });
    return {
      sent: true,
      purpose: purpose,
      company_id: hit.company_id,
      company_name: hit.company_name,
      employee_name: hit.employee_name,
      otp_sent_to: { phone: maskPhone_(id) },
      resend_in: APP.otpResendCooldownSec,
      expires_in_minutes: APP.otpTtlMinutes
    };
  },

  employeeActivate: function (payload, meta) {
    var candidates = Auth.employeeCandidates_(payload.phone);
    if (payload.company_id) candidates = candidates.filter(function (c) { return c.company_id === payload.company_id; });
    if (!candidates.length) fail_('NOT_REGISTERED', 'This mobile number is not registered with any company.');
    if (candidates.length > 1) return { multiple: true, options: candidates.map(function (c) { return { company_id: c.company_id, company_name: c.company_name, employee_code: c.employee_code }; }) };
    var hit = candidates[0];
    var purpose = txt_(hit.user.password_hash) ? 'EMPLOYEE_RESET' : 'EMPLOYEE_ACTIVATE';
    // accept either activation or reset code so the flow always works
    var okPurpose = null;
    try {
      Auth.consumeOtp_(purpose, normPhone_(payload.phone), payload.otp);
      okPurpose = purpose;
    } catch (e) {
      if (isApiError_(e) && e.code.indexOf('OTP_') === 0) {
        Auth.consumeOtp_('EMPLOYEE_ACTIVATE', normPhone_(payload.phone), payload.otp);
        okPurpose = 'EMPLOYEE_ACTIVATE';
      } else throw e;
    }
    var pwd = Auth.assertPasswordPolicy_(payload.password, payload.confirm_password);
    Auth.setPassword_(hit.user, pwd);
    Db.update(masterCtx_(), 'Users', 'user_id', hit.user.user_id, { status: 'ACTIVE', activation_code_hash: '', activation_expires_at: '' }, { system: true });
    var fresh = Db.find(masterCtx_(), 'Users', 'user_id', hit.user.user_id);
    var result = Auth.loginResponse_(null, fresh, meta, '');
    result.activated = true;
    Audit.write(masterCtx_(), {
      module: 'auth', action: 'auth.employee.activate', entity: 'Users', entity_id: fresh.user_id,
      note: 'Employee activated account via OTP (' + okPurpose + ')', actor_name: fresh.name, company_id: fresh.company_id, severity: 'SENSITIVE'
    });
    return result;
  },

  /* ------------------------------------------------------ forgot password */
  forgotSendOtp: function (payload, meta) {
    var loginType = txt_(payload.login_type || 'company');
    var user = null;
    if (loginType === 'employee') {
      var phone = normPhone_(payload.phone);
      if (payload.company_id) {
        user = Db.findOne(masterCtx_(), 'Users', function (u) {
          return txt_(u.scope) === 'COMPANY' && normPhone_(u.phone) === phone && txt_(u.company_id) === txt_(payload.company_id);
        });
      } else {
        user = Db.findOne(masterCtx_(), 'Users', function (u) { return txt_(u.scope) === 'COMPANY' && normPhone_(u.phone) === phone; });
      }
      if (!user) fail_('NOT_FOUND', 'No employee account found for this mobile number.');
      Auth.rateLimit_('otp_' + phone, APP.rateLimitOtpPerHour, 3600);
      var otp = Auth.createOtp_('EMPLOYEE_RESET', phone, { userId: user.user_id, companyId: user.company_id, ip: meta.ip });
      Notify.sendOtp({ phone: phone, code: otp, purpose: 'EMPLOYEE_RESET', company_id: user.company_id, name: user.name });
      return { sent: true, channel: 'sms', to: maskPhone_(phone), resend_in: APP.otpResendCooldownSec };
    }
    var email = normEmail_(payload.email);
    user = Db.findOne(masterCtx_(), 'Users', function (u) {
      return normEmail_(u.email) === email && (txt_(u.scope) === 'COMPANY' || txt_(u.scope) === 'SUPER');
    });
    if (!user) fail_('NOT_FOUND', 'No account found with this email address.');
    Auth.rateLimit_('otp_' + email, APP.rateLimitOtpPerHour, 3600);
    var code = Auth.createOtp_('PASSWORD_RESET', email, { userId: user.user_id, companyId: user.company_id, ip: meta.ip });
    Notify.sendOtp({ email: email, code: code, purpose: 'PASSWORD_RESET', company_id: user.company_id, name: user.name });
    return { sent: true, channel: 'email', to: maskEmail_(email), resend_in: APP.otpResendCooldownSec };
  },

  forgotReset: function (payload, meta) {
    var loginType = txt_(payload.login_type || 'company');
    var identifier = loginType === 'employee' ? normPhone_(payload.phone) : normEmail_(payload.email);
    var purpose = loginType === 'employee' ? 'EMPLOYEE_RESET' : 'PASSWORD_RESET';
    Auth.consumeOtp_(purpose, identifier, payload.otp);
    var user = Db.findOne(masterCtx_(), 'Users', function (u) {
      return loginType === 'employee' ? normPhone_(u.phone) === identifier : normEmail_(u.email) === identifier;
    });
    if (!user) fail_('NOT_FOUND', 'Account not found.');
    var pwd = Auth.assertPasswordPolicy_(payload.password, payload.confirm_password);
    Auth.setPassword_(user, pwd);
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, { failed_attempts: 0, locked_until: '', status: txt_(user.status).toUpperCase() === 'LOCKED' ? 'ACTIVE' : user.status }, { system: true });
    Audit.write(masterCtx_(), {
      module: 'auth', action: 'auth.forgot.reset', entity: 'Users', entity_id: user.user_id,
      note: 'Password reset with OTP', actor_name: user.name, company_id: user.company_id, severity: 'SENSITIVE'
    });
    return { reset: true, message: 'Password updated. You can sign in with your new password now.' };
  },

  /* -------------------------------------------------------- change password */
  changePassword: function (ctx, payload) {
    var user = Db.get(masterCtx_(), 'Users', 'user_id', ctx.userId);
    if (!Auth.verifyPassword_(user, payload.current_password)) {
      fail_('BAD_CREDENTIALS', 'Your current password is not correct.', { field: 'current_password' });
    }
    var pwd = Auth.assertPasswordPolicy_(payload.new_password, payload.confirm_password);
    if (hashPassword_(pwd, user.password_salt) === txt_(user.password_hash)) {
      fail_('VALIDATION', 'Please choose a password different from the current one.', { field: 'new_password' });
    }
    Auth.setPassword_(user, pwd);
    Audit.write(ctx, { module: 'auth', action: 'auth.password.change', entity: 'Users', entity_id: user.user_id, note: 'Password changed by user', severity: 'SENSITIVE' });
    return { changed: true, message: 'Your password has been updated.' };
  },

  /* --------------------------------------------------------- impersonation */
  impersonateStart: function (ctx, payload, meta) {
    Perm.require(ctx, 'super.manage');
    var company = companyRow_(payload.company_id);
    if (!company) fail_('NOT_FOUND', 'Company not found.');
    var target = null;
    if (payload.user_id) {
      target = Db.get(masterCtx_(), 'Users', 'user_id', payload.user_id);
    } else {
      target = Db.findOne(masterCtx_(), 'Users', function (u) {
        return txt_(u.company_id) === txt_(payload.company_id) && txt_(u.scope) === 'COMPANY' && txt_(u.user_id) === txt_(company.admin_user_id);
      }) || Db.findOne(masterCtx_(), 'Users', function (u) {
        return txt_(u.company_id) === txt_(payload.company_id) && txt_(u.scope) === 'COMPANY' && !txt_(u.employee_id);
      });
    }
    if (!target) fail_('NOT_FOUND', 'This company has no admin user to impersonate.');
    if (target.company_id && txt_(target.company_id) !== txt_(company.company_id)) fail_('VALIDATION', 'That user belongs to a different company.');
    var result = Auth.loginResponse_(null, target, meta, ctx.userId);
    var sessRec = Db.findOne(masterCtx_(), 'Sessions', function (s) { return txt_(s.token_hash) === sha256Hex_(result.token); });
    if (sessRec) Db.update(masterCtx_(), 'Sessions', 'session_id', sessRec.session_id, { impersonated_by: ctx.userId }, { system: true });
    result.impersonation = {
      active: true,
      company_id: company.company_id,
      company_name: txt_(company.name),
      reason: txt_(payload.reason),
      started_at: nowIso_()
    };
    Audit.write(ctx, {
      module: 'super', action: 'super.impersonate.start', entity: 'Companies', entity_id: company.company_id,
      note: 'Impersonation started as ' + txt_(target.name) + '. Reason: ' + txt_(payload.reason),
      severity: 'SENSITIVE'
    });
    return result;
  },

  impersonateStop: function (ctx) {
    if (!ctx.impersonatedBy) fail_('BAD_REQUEST', 'This session is not an impersonation session.');
    Db.update(masterCtx_(), 'Sessions', 'session_id', ctx.sessionId, { ended_at: nowIso_(), ended_reason: 'IMPERSONATION_ENDED' }, { system: true });
    Audit.write(masterCtx_(), {
      module: 'super', action: 'super.impersonate.stop', entity: 'Companies', entity_id: ctx.companyId,
      note: 'Impersonation ended', severity: 'SENSITIVE', actor_name: 'Super Admin'
    });
    return { stopped: true };
  },

  /* --------------------------------------------------------- housekeeping */
  /** Close idle / expired sessions. Called by the daily trigger and Setup. */
  pruneSessions: function () {
    var now = nowIso_();
    var open = Db.all(masterCtx_(), 'Sessions', function (s) {
      if (txt_(s.ended_at)) return false;
      if (txt_(s.expires_at) <= now) return true;
      var idle = new Date(isoToDate_(s.last_seen_at).getTime() + APP.sessionIdleMinutes * 60000);
      return Utilities.formatDate(idle, APP.timezone, "yyyy-MM-dd'T'HH:mm:ss") < now;
    });
    open.forEach(function (s) {
      Db.update(masterCtx_(), 'Sessions', 'session_id', s.session_id, { ended_at: now, ended_reason: 'EXPIRED' }, { system: true });
    });
    return open.length;
  }
};
