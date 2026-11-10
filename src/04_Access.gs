/**
 * FocusOn HRMS 2.0 — Access Control / RBAC (04_Access.gs)
 * Default-deny, deny-wins, ceiling rule, maker-checker, scopes S/D/T/P/B/C/X,
 * roles (multi + validity), overrides (ALLOW/DENY + expiry), delegation,
 * authority profiles (ceiling). Super Admin max 2.
 */

var _permCache = {}; // userId -> {perms: {}, ver: ACL_VER, at: ts}
var _scopeRank = { S: 0, D: 1, T: 2, P: 3, B: 4, X: 5, C: 6 };

function _isSuperAdmin(userId) {
  var sas = String(_getProp(PROP.SUPER_ADMINS) || '');
  var list = sas.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  return list.indexOf(String(userId)) >= 0;
}
function _superAdminCount() {
  var sas = String(_getProp(PROP.SUPER_ADMINS) || '');
  return sas.split(',').map(function (x) { return x.trim(); }).filter(Boolean).length;
}

function _rolePerms(roleId) {
  var rows = _readSheet(_openCoreDb(), 'RolePerms').rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].roleId) === String(roleId)) out.push(rows[i]);
  }
  return out;
}
function _userRoles(userId) {
  var now = _nowStr();
  var rows = _readSheet(_openCoreDb(), 'UserRoles').rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.userId) !== String(userId)) continue;
    var from = r.from || '', to = r.to || '';
    if (from && now < from) continue;
    if (to && now > to) continue;
    out.push(r);
  }
  return out;
}
function _overridesForUser(userId) {
  var rows = _readSheet(_openCoreDb(), 'Overrides').rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.userId) !== String(userId)) continue;
    var expiry = r.expiry || '';
    if (expiry && _todayStr() > expiry) continue;
    out.push(r);
  }
  return out;
}
function _activeDelegations(toUserId) {
  // delegations where toUserId is the delegatee and window is active
  var now = _nowStr();
  var rows = _readSheet(_openCoreDb(), 'Delegations').rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.toUserId) !== String(toUserId)) continue;
    if (r.active === '0') continue;
    if (r.from && now < r.from) continue;
    if (r.to && now > r.to) continue;
    out.push(r);
  }
  return out;
}

// ---------- Effective permission map for a user ----------

function _effectivePermissions(userId, forceRefresh) {
  var ver = _getProp(PROP.ACL_VER) || '0';
  var cached = _permCache[userId];
  if (!forceRefresh && cached && cached.ver === ver) return cached.perms;
  var perms = {}; // perm -> {allow: bool, scope: str, limit: str, source: str}
  var isSA = _isSuperAdmin(userId);
  if (isSA) {
    // SA: implicit all, but mark source
    PERM_MODULES.forEach(function (m) {
      // broad strokes; SA gets everything via code checks
    });
    cached = { perms: perms, ver: ver, at: Date.now(), sa: true };
    _permCache[userId] = cached;
    return perms;
  }
  // roles (incl. base EMPLOYEE which applies to everyone)
  var roleIds = [];
  var baseRole = null;
  PRESET_ROLES.forEach(function (r) { if (r.base) baseRole = r.id; });
  roleIds.push(baseRole || 'EMPLOYEE');
  _userRoles(userId).forEach(function (ur) { roleIds.push(ur.roleId); });
  // dedupe
  roleIds = roleIds.filter(function (x, i, a) { return a.indexOf(x) === i; });

  roleIds.forEach(function (rid) {
    _rolePerms(rid).forEach(function (rp) {
      var p = rp.perm;
      var existing = perms[p];
      // union: ALLOW widens scope; DENY wins but we track separately
      if (!existing || _scopeRank[rp.scope || 'S'] > _scopeRank[existing.scope || 'S']) {
        perms[p] = { allow: rp.allowDeny !== 'DENY', scope: rp.scope || 'S', limit: rp.limit || '', source: 'role:' + rid };
      }
    });
  });
  // overrides (DENY wins always; ALLOW can widen)
  _overridesForUser(userId).forEach(function (ov) {
    var p = ov.perm;
    if (ov.allowDeny === 'DENY') {
      perms[p] = { allow: false, scope: ov.scope || 'S', limit: ov.limit || '', source: 'override:DENY' };
    } else {
      var existing = perms[p];
      if (!existing || !existing.allow || _scopeRank[ov.scope || 'S'] > _scopeRank[existing.scope || 'S']) {
        perms[p] = { allow: true, scope: ov.scope || 'S', limit: ov.limit || '', source: 'override:' + ov.userId };
      }
    }
  });
  // delegations: delegatee gains delegator's approval-relevant perms during window
  _activeDelegations(userId).forEach(function (del) {
    var types = [];
    try { types = JSON.parse(del.requestTypes || '[]'); } catch (e) { types = []; }
    types.forEach(function (t) {
      var p = 'request.' + t + '.approve';
      var duser = _getUserById(del.fromUserId);
      var dperms = duser ? _effectivePermissions(duser.userId) : {};
      var dp = dperms[p];
      if (dp && dp.allow) {
        var existing = perms[p];
        if (!existing || _scopeRank[dp.scope] > _scopeRank[existing.scope]) {
          perms[p] = { allow: true, scope: dp.scope, limit: dp.limit, source: 'delegate:' + del.fromUserId };
        }
      }
    });
  });
  cached = { perms: perms, ver: ver, at: Date.now(), sa: false };
  _permCache[userId] = cached;
  return perms;
}
function _clearPermCache(userId) { if (userId) delete _permCache[userId]; else _permCache = {}; }

// ---------- Permission check ----------

function _can(user, perm, scope, amount, days) {
  // scope coverage check: user's granted scope must cover requested scope
  function covers(granted, requested) {
    if (granted === 'C') return true;
    if (granted === 'X') return requested === 'X' || requested === 'S';
    return _scopeRank[granted] >= _scopeRank[requested];
  }
  if (!user) return false;
  if (_isSuperAdmin(user.userId)) {
    // SA: everything implicit EXCEPT payroll stage actions unless break-glass
    if (/^payroll\.(prepare|verify|approve|release|reopen|hold)$/.test(perm)) {
      var db = _openCoreDb();
      var sheet = _getOrCreateSheet(db, 'Settings');
      var rows = _readSheet(db, 'Settings').rows;
      var bg = '0';
      for (var si = 0; si < rows.length; si++) {
        if (rows[si].key === 'SETTINGS.payroll.saBreakGlass') { bg = rows[si].value; break; }
      }
      return bg === '1';
    }
    return true;
  }
  var perms = _effectivePermissions(user.userId);
  var p = perms[perm];
  if (!p || !p.allow) return false;
  if (!covers(p.scope, scope || 'S')) return false;
  // limit checks (amount / days)
  if (amount !== undefined && p.limit) {
    var lim = Number(p.limit);
    if (!isNaN(lim) && Number(amount) > lim) return false;
  }
  if (days !== undefined && p.limit) {
    var lim = Number(p.limit);
    if (!isNaN(lim) && Number(days) > lim) return false;
  }
  return true;
}
function _canAny(user, perms, scope) {
  if (!Array.isArray(perms)) return _can(user, perms, scope);
  for (var i = 0; i < perms.length; i++) if (_can(user, perms[i], scope)) return true;
  return false;
}

// ---------- Maker-checker / self approval ----------

function _isMaker(userId, req) {
  return String(req.createdBy || req.empId) === String(userId);
}
function _checkMakerChecker(user, perm, req) {
  if (_isMaker(user.userId, req)) return false; // cannot approve own request
  return true;
}

// ---------- Authority profile ----------

function _getAuthority(userId) {
  var rows = _readSheet(_openCoreDb(), 'Authorities').rows;
  for (var i = 0; i < rows.length; i++) {
    var a = rows[i];
    if (String(a.userId) !== String(userId)) continue;
    if (a.active === '0') continue;
    var now = _nowStr();
    if (a.validFrom && now < a.validFrom) continue;
    if (a.validTo && now > a.validTo) continue;
    return a;
  }
  return null;
}
function _authorityCanGrant(user, perm, scope) {
  var auth = _getAuthority(user.userId);
  if (!auth) return false;
  var ceilPerms = {};
  try { ceilPerms = JSON.parse(auth.ceilingPerms || '{}'); } catch (e) {}
  var ceilRoles = {};
  try { ceilRoles = JSON.parse(auth.ceilingRoles || '[]'); } catch (e) {}
  // perm must be in ceiling perms (or authority has workflow rights + perm is approval)
  var allowed = ceilPerms[perm] === true || (auth.workflowRights === '1' && /^(request|approval|leave|attendance|payroll|expense|loan|advance|exit|doc)\./.test(perm));
  if (!allowed) return false;
  // scope must be within authority scope
  function covers(granted, requested) {
    if (granted === 'C') return true;
    return _scopeRank[granted] >= _scopeRank[requested];
  }
  return covers(auth.scope || 'S', scope || 'S');
}

// ---------- Public-ish wrappers used by api ----------

function access_effectivepermissions_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var target = payload.targetUserId || boot.user.userId;
  // only SA/HR/Admin can inspect others
  if (target !== boot.user.userId && !_can(boot.user, 'accesslog.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  return _result(true, { perms: _effectivePermissions(target, true), ver: _getProp(PROP.ACL_VER) || '0' });
}
function access_bumpversion_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_isSuperAdmin(boot.user.userId)) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var cur = Number(_getProp(PROP.ACL_VER) || '0') + 1;
  _setProp(PROP.ACL_VER, cur);
  _clearPermCache();
  _audit(boot.user.userId, 'access.bump_acl_version', 'Settings', PROP.ACL_VER, {}, { newVer: cur });
  return _result(true, { version: cur });
}
