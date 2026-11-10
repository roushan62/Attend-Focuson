/**
 * FocusOn HRMS 2.0 — Authentication (03_Auth.gs)
 * Login by Employee Code / Mobile / Email + password; temp password; lockout; OTP.
 */

var _otpStore = {}; // loginId -> {otp, expiry, attempts}

function _hashPassword(password, salt) {
  try {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + '|' + salt).map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
  } catch (e) { return ''; }
}
function _makeSalt() { return _uid(); }

function _failLogin(user) {
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Users');
  var rows = _readSheet(db, 'Users').rows;
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(user.userId)) { idx = i; break; }
  if (idx < 0) return;
  var rowNum = idx + 2;
  var failed = Number(user.failedAttempts || 0) + 1;
  var lockedUntil = '';
  if (failed >= SEC.maxFailedAttempts) {
    var lockUntil = new Date(); lockUntil.setMinutes(lockUntil.getMinutes() + SEC.lockoutMinutes);
    lockedUntil = Utilities.formatDate(lockUntil, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  }
  var headers = _readSheet(db, 'Users').headers;
  var col = {};
  headers.forEach(function (h, j) { col[h] = j + 1; });
  sheet.getRange(rowNum, col['failedAttempts'], 1, 1).setValue(failed);
  sheet.getRange(rowNum, col['lockedUntil'], 1, 1).setValue(lockedUntil);
  delete _rowCache[_sheetKey(db, 'Users')];
  _audit(user.userId, 'auth.fail_login', 'Users', user.userId, { failed: user.failedAttempts }, { failed: failed, locked: !!lockedUntil });
}
function _clearLoginFailures(user) {
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Users');
  var rows = _readSheet(db, 'Users').rows;
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(user.userId)) { idx = i; break; }
  if (idx < 0) return;
  var rowNum = idx + 2;
  var headers = _readSheet(db, 'Users').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  sheet.getRange(rowNum, col['failedAttempts'], 1, 1).setValue(0);
  sheet.getRange(rowNum, col['lockedUntil'], 1, 1).setValue('');
  delete _rowCache[_sheetKey(db, 'Users')];
}

/**
 * action: auth.login
 * payload: { loginId, password }
 */
function auth_login_(payload) {
  if (!payload.loginId || !payload.password) throw _error(ERR.VALIDATION, 'Enter login ID and password.');
  var user = _getUserByLogin(payload.loginId);
  if (!user) throw _error(ERR.FORBIDDEN, 'Invalid login ID or password.', 'loginId');
  if (user.status === 'Locked' || user.status === 'Disabled') throw _error(ERR.LOCKED, 'Account is ' + user.status + '. Contact HR/Super Admin.');
  var lockedUntil = user.lockedUntil || '';
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    throw _error(ERR.LOCKED, 'Account temporarily locked due to multiple failed attempts. Try again later.');
  }
  var ok = (_hashPassword(payload.password, user.salt || '') === (user.passwordHash || ''));
  if (!ok) { _failLogin(user); throw _error(ERR.FORBIDDEN, 'Invalid login ID or password.', 'password'); }
  _clearLoginFailures(user);
  return _createSession(user);
}

/**
 * action: auth.logout
 * payload: { token }
 */
function auth_logout_(payload) {
  if (!payload.token) return _result(true);
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Sessions');
  var rows = _readSheet(db, 'Sessions').rows;
  var headers = _readSheet(db, 'Sessions').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].token) === String(payload.token)) {
      sheet.getRange(i + 2, col['revoked'], 1, 1).setValue('1');
      delete _rowCache[_sheetKey(db, 'Sessions')];
      break;
    }
  }
  _audit('', 'auth.logout', 'Sessions', payload.token, {}, {});
  return _result(true);
}

/**
 * action: auth.changepassword
 * payload: { token, oldPassword, newPassword }
 */
function auth_changepassword_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired. Sign in again.');
  var user = boot.user;
  if (!payload.oldPassword || !payload.newPassword) throw _error(ERR.VALIDATION, 'Enter old and new password.');
  if (payload.newPassword.length < SEC.passwordMinLength) throw _error(ERR.VALIDATION, 'Password too short (min ' + SEC.passwordMinLength + ' chars).');
  if (_hashPassword(payload.oldPassword, user.salt || '') !== (user.passwordHash || '')) throw _error(ERR.FORBIDDEN, 'Current password is incorrect.', 'oldPassword');
  var salt = _makeSalt();
  var hash = _hashPassword(payload.newPassword, salt);
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Users');
  var rows = _readSheet(db, 'Users').rows;
  var headers = _readSheet(db, 'Users').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(user.userId)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'User not found.');
  var rowNum = idx + 2;
  sheet.getRange(rowNum, col['passwordHash'], 1, 1).setValue(hash);
  sheet.getRange(rowNum, col['salt'], 1, 1).setValue(salt);
  sheet.getRange(rowNum, col['mustChangePassword'], 1, 1).setValue('0');
  sheet.getRange(rowNum, col['failedAttempts'], 1, 1).setValue(0);
  sheet.getRange(rowNum, col['lockedUntil'], 1, 1).setValue('');
  // revoke all other sessions (force re-login)
  _revokeSessionsForUser(db, sheet, headers, col, user.userId, { keep: payload.token });
  delete _rowCache[_sheetKey(db, 'Users')];
  _audit(user.userId, 'auth.changepassword', 'Users', user.userId, {}, { mustChange: '0' });
  return _result(true, { message: 'Password changed. All other sessions logged out.' });
}

/**
 * action: auth.resetpassword (admin/HR with user.resetpassword)
 * payload: { token, targetUserId }
 */
function auth_resetpassword_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  if (!_can(boot.user, 'user.resetpassword', 'company')) throw _error(ERR.FORBIDDEN, 'You cannot reset passwords.');
  var target = _getUserById(payload.targetUserId);
  if (!target) throw _error(ERR.NOT_FOUND, 'User not found.');
  var temp = _uid().slice(-8); // 8-char temp password
  var salt = _makeSalt();
  var hash = _hashPassword(temp, salt);
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Users');
  var rows = _readSheet(db, 'Users').rows;
  var headers = _readSheet(db, 'Users').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(target.userId)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'User not found.');
  var rowNum = idx + 2;
  sheet.getRange(rowNum, col['passwordHash'], 1, 1).setValue(hash);
  sheet.getRange(rowNum, col['salt'], 1, 1).setValue(salt);
  sheet.getRange(rowNum, col['mustChangePassword'], 1, 1).setValue('1');
  sheet.getRange(rowNum, col['failedAttempts'], 1, 1).setValue(0);
  sheet.getRange(rowNum, col['lockedUntil'], 1, 1).setValue('');
  delete _rowCache[_sheetKey(db, 'Users')];
  _revokeSessionsForUser(db, sheet, headers, col, target.userId);
  _audit(boot.user.userId, 'auth.resetpassword', 'Users', target.userId, {}, { target: target.empCode || target.userId });
  _notify(target.userId, 'Your password has been reset by HR/Admin. Use the temporary password shared with you and change it on first login.', 'system');
  return _result(true, { tempPassword: temp, mustChangePassword: true });
}

/**
 * action: auth.forgot (request OTP to registered email)
 * payload: { loginId }
 */
function auth_forgot_(payload) {
  var user = _getUserByLogin(payload.loginId);
  if (!user) throw _error(ERR.NOT_FOUND, 'No account found with this login ID.');
  if (!user.email) throw _error(ERR.VALIDATION, 'No email address on this account. Contact HR.');
  var otp = String(Math.floor(100000 + Math.random() * 900000));
  _otpStore[String(user.email).toLowerCase()] = { otp: otp, expiry: Date.now() + SEC.otpMinutes * 60 * 1000, attempts: 0 };
  var sent = _sendEmail(user.email, 'FocusOn HRMS — Password reset OTP', 'Your OTP is ' + otp + '. It expires in ' + SEC.otpMinutes + ' minutes.');
  _audit(user.userId, 'auth.forgot_otp', 'Users', user.userId, {}, { email: user.email, sent: sent.ok });
  if (!sent.ok) throw _error(ERR.SERVER, 'Could not send OTP email. Contact HR.');
  return _result(true, { message: 'OTP sent to your registered email.' });
}

/**
 * action: auth.verifyotp (set new password)
 * payload: { loginId, otp, newPassword }
 */
function auth_verifyotp_(payload) {
  if (!payload.loginId || !payload.otp || !payload.newPassword) throw _error(ERR.VALIDATION, 'Missing fields.');
  if (payload.newPassword.length < SEC.passwordMinLength) throw _error(ERR.VALIDATION, 'Password too short.');
  var user = _getUserByLogin(payload.loginId);
  if (!user || !user.email) throw _error(ERR.NOT_FOUND, 'Account not found.');
  var key = String(user.email).toLowerCase();
  var rec = _otpStore[key];
  if (!rec) throw _error(ERR.VALIDATION, 'No OTP requested. Use Forgot Password first.');
  if (Date.now() > rec.expiry) { delete _otpStore[key]; throw _error(ERR.VALIDATION, 'OTP expired. Request again.'); }
  rec.attempts++;
  if (rec.attempts > 5) { delete _otpStore[key]; throw _error(ERR.LOCKED, 'Too many OTP attempts. Request again.'); }
  if (rec.otp !== String(payload.otp)) throw _error(ERR.VALIDATION, 'Incorrect OTP.');
  delete _otpStore[key];
  var salt = _makeSalt();
  var hash = _hashPassword(payload.newPassword, salt);
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Users');
  var rows = _readSheet(db, 'Users').rows;
  var headers = _readSheet(db, 'Users').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  var idx = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(user.userId)) { idx = i; break; }
  if (idx < 0) throw _error(ERR.NOT_FOUND, 'User not found.');
  var rowNum = idx + 2;
  sheet.getRange(rowNum, col['passwordHash'], 1, 1).setValue(hash);
  sheet.getRange(rowNum, col['salt'], 1, 1).setValue(salt);
  sheet.getRange(rowNum, col['mustChangePassword'], 1, 1).setValue('0');
  sheet.getRange(rowNum, col['failedAttempts'], 1, 1).setValue(0);
  sheet.getRange(rowNum, col['lockedUntil'], 1, 1).setValue('');
  delete _rowCache[_sheetKey(db, 'Users')];
  _revokeSessionsForUser(db, sheet, headers, col, user.userId);
  _audit(user.userId, 'auth.verifyotp_reset', 'Users', user.userId, {}, {});
  return _result(true, { message: 'Password reset successfully. Sign in with your new password.' });
}

// ---------- session creation ----------

function _createSession(user) {
  // revoke old sessions beyond limit
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Sessions');
  var rows = _readSheet(db, 'Sessions').rows;
  var headers = _readSheet(db, 'Sessions').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  var userSessions = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].userId) === String(user.userId) && rows[i].revoked === '0') userSessions.push({ i: i, expiry: rows[i].expiry });
  }
  userSessions.sort(function (a, b) { return new Date(b.expiry) - new Date(a.expiry); });
  for (var k = SEC.maxSessionsPerUser; k < userSessions.length; k++) {
    sheet.getRange(userSessions[k].i + 2, col['revoked'], 1, 1).setValue('1');
  }
  // create new session
  var token = _uid();
  var expiry = new Date(); expiry.setHours(expiry.getHours() + SEC.sessionHours);
  _appendRows(sheet, [[token, user.userId, Utilities.formatDate(expiry, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), _nowStr(), '0']]);
  delete _rowCache[_sheetKey(db, 'Sessions')];
  _audit(user.userId, 'auth.login', 'Users', user.userId, {}, {});
  _flushAudit();
  return _result(true, { token: token, user: _publicUser(user), expiresAt: expiry });
}

function _publicUser(u) {
  return {
    userId: u.userId, empCode: u.empCode, name: u.name, email: u.email, mobile: u.mobile,
    role: u.role, panel: u.panel, status: u.status, mustChangePassword: u.mustChangePassword === '1',
    theme: u.theme || 'light'
  };
}
function _revokeSessionsForUser(db, sheet, headers, col, userId, keep) {
  var rows = _readSheet(db, 'Sessions').rows;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].userId) === String(userId) && rows[i].revoked === '0' && String(rows[i].token) !== keep) {
      sheet.getRange(i + 2, col['revoked'], 1, 1).setValue('1');
    }
  }
  delete _rowCache[_sheetKey(db, 'Sessions')];
}

// expose boot publicly via api (doGet calls boot through api.action 'boot')
function boot_(payload) {
  return _result(true, _boot(payload && payload.token));
}
