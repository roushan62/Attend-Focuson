/**
 * ============================================================================
 *  FILE: 07_Users.gs
 *  ROLE: Employee / Admin / Sub-Admin lifecycle (§2, §2.1) — creation with the
 *        granular permission builder, updates, activation, password resets and
 *        the device registry admin queue.
 * ============================================================================
 */

/** What each role is allowed to create (§2: Admin cannot create other Admins). */
function creatableRoles_(ctx) {
  if (String(ctx.role) === ROLES.SUPER_ADMIN) return ['Admin', 'SubAdmin', 'Employee'];
  if (String(ctx.role) === ROLES.ADMIN) return ['SubAdmin', 'Employee'];
  if (String(ctx.role) === ROLES.SUB_ADMIN) return can_(ctx, 'createEmployees') ? ['Employee'] : [];
  return [];
}

function validatePermissionsPayload_(role, permissions, scope, ss) {
  var perms = {};
  var incoming = jsonParse_(permissions || {}, {});
  PERMISSIONS.forEach(function (p) {
    if (incoming[p] !== undefined) perms[p] = bool_(incoming[p], false);
  });
  if (role === ROLES.SUPER_ADMIN) perms = { __all: true };
  if (role === ROLES.ADMIN) {
    var base = {};
    (ROLE_DEFAULT_PERMISSIONS.Admin || []).forEach(function (p) { base[p] = true; });
    for (var k in perms) base[k] = perms[k];
    perms = base;
  }

  var scopeList = jsonList_(scope || []);
  if (!scopeList.length) scopeList = role === ROLES.EMPLOYEE ? [] : ['ALL'];
  if (scopeList.indexOf('ALL') < 0) {
    var projects = readTable_(ss, 'Projects');
    var known = {};
    projects.forEach(function (p) { known[String(p.ProjectID)] = true; });
    scopeList = scopeList.filter(function (id) { return known[String(id)]; });
  }
  return { permissions: perms, scope: scopeList };
}

/* -------------------------------------------------------------------------- */
/*  Create                                                                    */
/* -------------------------------------------------------------------------- */

function actionCreateUser(payload, ctx) {
  requireFields_(payload, ['name', 'mobile', 'role']);
  var ss = ctx.ss;
  var role = pickOne_(payload.role, ROLE_LIST, '');
  assert_(role, 'Role must be one of: ' + ROLE_LIST.join(', '), 400);
  assert_(creatableRoles_(ctx).indexOf(role) >= 0,
    'Your role cannot create ' + role + ' accounts', 403);

  var mobile = normaliseMobile_(payload.mobile);
  assert_(mobileOk_(mobile), 'Enter a valid mobile number with country code', 400);
  var email = str_(payload.email, 120).toLowerCase();
  if (email) assert_(emailOk_(email), 'Enter a valid e-mail address', 400);

  var users = readTable_(ss, 'Users');
  for (var i = 0; i < users.length; i++) {
    if (normaliseMobile_(users[i].MobileNumber) === mobile && String(users[i].Status) !== 'Inactive') {
      throw new ApiError_('Another active account already uses this mobile number', 409);
    }
    if (email && String(users[i].Email).toLowerCase() === email) {
      throw new ApiError_('Another account already uses this e-mail address', 409);
    }
  }

  var prefix = role === ROLES.EMPLOYEE ? 'EMP' : (role === ROLES.ADMIN ? 'ADM' : 'SUB');
  var userId = str_(payload.userId, 32).toUpperCase() ||
    (prefix + '-' + shortId_(5));
  assert_(!findRecord_(ss, 'Users', 'UserID', userId), 'UserID already exists: ' + userId, 409);
  assert_(!/[|,$]/.test(userId), 'UserID may not contain | , or $', 400);

  var salaryType = pickOne_(payload.salaryType, ['Daily', 'Monthly', 'Contract'], 'Daily');
  var tempPassword = str_(payload.password, 40);
  var generated = false;
  if (!tempPassword) { tempPassword = randomPassword_(10); generated = true; }
  var strengthErr = passwordStrong_(tempPassword);
  assert_(!strengthErr, strengthErr, 400);

  var validated = validatePermissionsPayload_(role, payload.permissions, payload.projectScope, ss);

  var row = {
    UserID: userId,
    Role: role,
    Name: str_(payload.name, 120),
    MobileNumber: mobile,
    Email: email,
    PasswordHash: hashPassword_(tempPassword),
    PermissionsJSON: jsonString_(validated.permissions),
    ProjectScopeJSON: jsonString_(validated.scope),
    Status: 'Active',
    DeviceID: '',
    CreatedAt: fmtDateTime_(new Date()),
    Designation: str_(payload.designation, 80) || (role === ROLES.EMPLOYEE ? 'Site Staff' : role),
    SalaryType: salaryType,
    DailyWage: num_(payload.dailyWage, 0),
    MonthlySalary: num_(payload.monthlySalary, 0),
    ShiftID: str_(payload.shiftId, 32),
    WeeklyOff: str_(payload.weeklyOff, 12) || str_(ctx.settings.weeklyOff, 12) || '0',
    Address: str_(payload.address, 300),
    EmergencyContact: str_(payload.emergencyContact, 40),
    IdProofMasked: str_(payload.idProofMasked, 60),
    JoinedAt: isIsoDate_(payload.joinedAt) ? payload.joinedAt : fmtDate_(new Date(), ctx.tz),
    MustChangePassword: 'Y',
    DeviceStatus: 'Unbound',
    ReportsTo: str_(payload.reportsTo, 32),
    BankAccount: str_(payload.bankAccount, 40),
    IfscCode: str_(payload.ifscCode, 20),
    Notes: str_(payload.notes, 300)
  };
  assert_(row.Name.length >= 2, 'Name is too short', 400);
  if (salaryType === 'Daily') assert_(num_(row.DailyWage, 0) >= 0, 'Daily wage must be a number', 400);

  appendRecord_(ss, 'Users', row);
  loginIndexUpsert_(row, ctx.companyId);
  audit_(ss, ctx, 'CREATE_USER', 'Users', userId,
    { role: role, mobile: maskString_(mobile, 4), scope: validated.scope.length }, 'OK');

  // Optional immediate project assignment.
  var assignment = null;
  if (payload.projectId && role === ROLES.EMPLOYEE) {
    assertProjectScope_(ctx, payload.projectId);
    assignment = createAssignment_(ss, ctx, {
      projectId: payload.projectId, userId: userId,
      roleOnSite: payload.roleOnSite || 'Worker',
      assignedFrom: row.JoinedAt, dailyWage: row.DailyWage,
      shiftId: row.ShiftID, weeklyOff: row.WeeklyOff
    });
  }
  if (validated.scope.indexOf('ALL') < 0 && validated.scope.length && role !== ROLES.EMPLOYEE) {
    // keep scope + assignments consistent
  }

  // Deliver credentials.
  var message = 'Your SiteTrack account is ready.\n\nCompany: ' + ctx.company.CompanyName +
    '\nUser ID: ' + userId + '\nMobile: ' + mobile +
    '\nTemporary password: ' + tempPassword +
    '\n\nSign in and change your password immediately. Never share these credentials.';
  if (emailOk_(email)) sendEmail_(email, 'Your SiteTrack login credentials', message);
  else sendSmsOrWhatsApp_(mobile, message);

  notify_(ss, userId, 'Welcome to SiteTrack',
    'Your account was created by ' + ctx.userName + '. Please change your temporary password after signing in.', 'Info');

  return {
    userId: userId,
    role: role,
    created: true,
    tempPassword: tempPassword,
    passwordGenerated: generated,
    credentialsSentTo: emailOk_(email) ? email : mobile,
    mustChangePassword: true,
    assignment: assignment
  };
}

/* -------------------------------------------------------------------------- */
/*  Read                                                                      */
/* -------------------------------------------------------------------------- */

function actionListUsers(payload, ctx) {
  var ss = ctx.ss;
  var all = readTable_(ss, 'Users');
  var role = str_(payload.role, 20);
  var status = str_(payload.status, 20);
  var q = str_(payload.query, 60).toLowerCase();
  var projectId = str_(payload.projectId, 40);

  var assignments = readTable_(ss, 'ProjectAssignments');
  var activeAssign = assignments.filter(function (a) { return String(a.Status) === 'Active'; });
  var userProjects = {};
  activeAssign.forEach(function (a) {
    var k = String(a.UserID);
    if (!userProjects[k]) userProjects[k] = [];
    userProjects[k].push(String(a.ProjectID));
  });

  if (String(ctx.role) === ROLES.EMPLOYEE) {
    // Employees see only teammates on projects they share — no sensitive fields.
    var mine = {};
    (userProjects[String(ctx.userId)] || []).forEach(function (p) { mine[p] = true; });
    all = all.filter(function (u) {
      if (String(u.UserID) === String(ctx.userId)) return true;
      var ps = userProjects[String(u.UserID)] || [];
      return ps.some(function (p) { return mine[p]; });
    });
    return {
      count: all.length,
      limited: true,
      users: all.map(function (u) {
        return {
          userId: u.UserID, name: u.Name, role: u.Role, designation: u.Designation || '',
          mobile: u.MobileNumber, status: u.Status,
          projects: userProjects[String(u.UserID)] || []
        };
      })
    };
  }

  // Staff: project scope ALWAYS wins (§9.15) — `viewAllEmployees` widens the
  // fields a Sub-Admin may see inside their scope, never the scope itself.
  if (!scopeIsAll_(ctx)) {
    all = all.filter(function (u) {
      if (String(u.UserID) === String(ctx.userId)) return true;
      var ps = userProjects[String(u.UserID)] || [];
      return ps.some(function (p) { return inScope_(ctx, p); });
    });
  }

  if (role) all = all.filter(function (u) { return String(u.Role) === role; });
  if (status) all = all.filter(function (u) { return String(u.Status) === status; });
  if (q) {
    all = all.filter(function (u) {
      return String(u.Name).toLowerCase().indexOf(q) >= 0 ||
        String(u.UserID).toLowerCase().indexOf(q) >= 0 ||
        String(u.MobileNumber).indexOf(q) >= 0 ||
        String(u.Designation || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  if (projectId) {
    all = all.filter(function (u) {
      return (userProjects[String(u.UserID)] || []).indexOf(projectId) >= 0;
    });
  }

  all = sortBy_(all, function (u) { return String(u.Name); });
  var projectMap = indexBy_(readTable_(ss, 'Projects'), 'ProjectID');

  var limit = Math.min(Math.max(num_(payload.limit, 500), 1), 2000);
  var page = Math.max(num_(payload.page, 1), 1);
  var slice = all.slice((page - 1) * limit, page * limit);

  return {
    count: all.length,
    page: page,
    pageSize: limit,
    limited: false,
    users: slice.map(function (u) {
      var dto = maskUser_(ctx, u);
      dto.Projects = (userProjects[String(u.UserID)] || []).map(function (pid) {
        var p = projectMap[pid] || {};
        return { projectId: pid, name: p.Name || pid, status: p.Status || '' };
      });
      return dto;
    })
  };
}

function actionGetUser(payload, ctx) {
  var userId = str_(payload.userId || ctx.userId, 40);
  var ss = ctx.ss;
  var user = findRecord_(ss, 'Users', 'UserID', userId);
  assert_(user, 'User not found', 404);
  if (String(ctx.role) === ROLES.EMPLOYEE) assertEmployeeSelf_(ctx, userId);
  else if (!scopeIsAll_(ctx)) {
    var ps = findRecords_(ss, 'ProjectAssignments', 'UserID', userId)
      .filter(function (a) { return String(a.Status) === 'Active'; });
    assert_(ps.some(function (a) { return inScope_(ctx, a.ProjectID); }),
      'This employee is outside your project scope', 403);
  }

  var attendance = sortBy_(readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === userId;
  }), function (a) { return String(a.Date); }, true);

  var leaves = sortBy_(findRecords_(ss, 'LeaveRequests', 'UserID', userId),
    function (r) { return String(r.AppliedAt); }, true);
  var expenses = sortBy_(findRecords_(ss, 'ExpenseRequests', 'UserID', userId),
    function (r) { return String(r.AppliedAt); }, true);
  var docs = findRecords_(ss, 'Documents', 'UserID', userId);
  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', userId);
  var projectMap = indexBy_(readTable_(ss, 'Projects'), 'ProjectID');
  var devices = findRecords_(ss, 'DeviceRegistry', 'UserID', userId);

  return {
    user: maskUser_(ctx, user),
    assignments: assignments.map(function (a) {
      var p = projectMap[String(a.ProjectID)] || {};
      return {
        assignmentId: a.AssignmentID, projectId: a.ProjectID, projectName: p.Name || '',
        roleOnSite: a.RoleOnSite, from: a.AssignedFrom, to: a.AssignedTo, status: a.Status
      };
    }),
    recentAttendance: attendance.slice(0, 60).map(function (a) { return attendanceDto_(a, ctx); }),
    leaves: leaves.slice(0, 40).map(function (l) { return leaveDto_(l, ctx); }),
    expenses: expenses.slice(0, 40).map(function (x) { return expenseDto_(x, ctx); }),
    documents: docs.map(function (d) { return documentDto_(d, ctx); }),
    devices: devices.map(function (d) {
      return {
        deviceId: d.DeviceID, label: d.DeviceLabel || '', status: d.Status,
        fingerprint: maskString_(d.DeviceFingerprint, 6), registeredAt: d.RegisteredAt,
        lastUsedAt: d.LastUsedAt, pending: d.PendingFingerprint ? maskString_(d.PendingFingerprint, 6) : ''
      };
    }),
    summary: monthlySummaryFor_(ss, ctx, userId, monthKey_(today_(ctx.tz)), ctx.settings)
  };
}

/* -------------------------------------------------------------------------- */
/*  Update / status / permissions                                             */
/* -------------------------------------------------------------------------- */

function actionUpdateUser(payload, ctx) {
  requireFields_(payload, ['userId']);
  var ss = ctx.ss;
  var user = findRecord_(ss, 'Users', 'UserID', payload.userId);
  assert_(user, 'User not found', 404);
  assertProjectScopeOfUser_(ss, ctx, user);

  var patch = {};
  var simple = {
    name: ['Name', 120], designation: ['Designation', 80], address: ['Address', 300],
    emergencyContact: ['EmergencyContact', 40], idProofMasked: ['IdProofMasked', 60],
    joinedAt: ['JoinedAt', 12], weeklyOff: ['WeeklyOff', 12], shiftId: ['ShiftID', 32],
    salaryType: ['SalaryType', 12], dailyWage: ['DailyWage', 12],
    monthlySalary: ['MonthlySalary', 14], reportsTo: ['ReportsTo', 32],
    bankAccount: ['BankAccount', 40], ifscCode: ['IfscCode', 20], notes: ['Notes', 300]
  };
  for (var k in simple) {
    if (payload[k] === undefined || payload[k] === null) continue;
    var v = str_(payload[k], simple[k][1]);
    if (k === 'joinedAt') assert_(isIsoDate_(v), 'joinedAt must be yyyy-mm-dd', 400);
    if (k === 'dailyWage' || k === 'monthlySalary') v = String(num_(v, 0));
    if (k === 'salaryType') assert_(inList_(v, ['Daily', 'Monthly', 'Contract']), 'Invalid salary type', 400);
    patch[simple[k][0]] = v;
  }
  if (payload.email !== undefined) {
    var email = str_(payload.email, 120).toLowerCase();
    if (email) {
      assert_(emailOk_(email), 'Enter a valid e-mail address', 400);
      var clash = readTable_(ss, 'Users').some(function (u) {
        return String(u.Email).toLowerCase() === email && String(u.UserID) !== String(user.UserID);
      });
      assert_(!clash, 'Another account already uses this e-mail', 409);
    }
    patch.Email = email;
  }
  if (payload.mobile !== undefined) {
    var mobile = normaliseMobile_(payload.mobile);
    assert_(mobileOk_(mobile), 'Enter a valid mobile number', 400);
    var clash2 = readTable_(ss, 'Users').some(function (u) {
      return normaliseMobile_(u.MobileNumber) === mobile && String(u.UserID) !== String(user.UserID);
    });
    assert_(!clash2, 'Another account already uses this mobile number', 409);
    patch.MobileNumber = mobile;
  }
  if (payload.permissions !== undefined || payload.projectScope !== undefined) {
    var targetRole = str_(payload.role, 20) || String(user.Role);
    assert_(canEditPermissions_(ctx, targetRole), 'You may not change permissions for a ' + targetRole, 403);
    var validated = validatePermissionsPayload_(targetRole,
      payload.permissions !== undefined ? payload.permissions : user.PermissionsJSON,
      payload.projectScope !== undefined ? payload.projectScope : user.ProjectScopeJSON, ss);
    patch.PermissionsJSON = jsonString_(validated.permissions);
    patch.ProjectScopeJSON = jsonString_(validated.scope);
    validated.scope.forEach(function (pid) { if (pid !== 'ALL') assertProjectScope_(ctx, pid); });
  }
  if (payload.role !== undefined) {
    var newRole = pickOne_(payload.role, ROLE_LIST, '');
    assert_(newRole, 'Invalid role', 400);
    assert_(creatableRoles_(ctx).indexOf(newRole) >= 0 || newRole === String(user.Role),
      'Your role cannot assign ' + newRole, 403);
    assert_(!(String(user.Role) === ROLES.SUPER_ADMIN && newRole !== ROLES.SUPER_ADMIN),
      'A Super Admin account cannot be downgraded', 403);
    patch.Role = newRole;
  }
  if (!isBlank_(payload.photoBase64)) {
    patch.PhotoLink = storeCompanyUpload_(ctx.company, 'Selfies', 'profile-' + user.UserID,
      String(payload.photoBase64), str_(payload.photoMime, 'image/jpeg'));
  }
  assert_(Object.keys(patch).length, 'Nothing to update', 400);

  var updated = updateRecord_(ss, 'Users', 'UserID', user.UserID, patch);
  loginIndexUpsert_(updated, ctx.companyId);
  audit_(ss, ctx, 'UPDATE_USER', 'Users', user.UserID, Object.keys(patch).join(','), 'OK');
  return { updated: true, user: maskUser_(ctx, updated) };
}

function canEditPermissions_(ctx, targetRole) {
  if (String(ctx.role) === ROLES.SUPER_ADMIN) return true;
  if (String(ctx.role) === ROLES.ADMIN) return [ROLES.SUB_ADMIN, ROLES.EMPLOYEE].indexOf(targetRole) >= 0;
  return false;
}

function assertProjectScopeOfUser_(ss, ctx, user) {
  if (scopeIsAll_(ctx)) return true;
  if (String(user.UserID) === String(ctx.userId)) return true;
  var ps = findRecords_(ss, 'ProjectAssignments', 'UserID', user.UserID)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  assert_(ps.some(function (a) { return inScope_(ctx, a.ProjectID); }),
    'This employee is outside your project scope', 403);
  return true;
}

function actionSetUserStatus(payload, ctx) {
  requireFields_(payload, ['userId', 'status']);
  var ss = ctx.ss;
  var user = findRecord_(ss, 'Users', 'UserID', payload.userId);
  assert_(user, 'User not found', 404);
  var status = pickOne_(payload.status, ['Active', 'Inactive', 'Suspended'], '');
  assert_(status, 'Status must be Active, Inactive or Suspended', 400);
  assert_(String(user.Role) !== ROLES.SUPER_ADMIN || status === 'Active',
    'A Super Admin account cannot be deactivated', 403);
  assert_(String(user.UserID) !== String(ctx.userId), 'You cannot change your own account status', 400);
  assertProjectScopeOfUser_(ss, ctx, user);

  updateRecord_(ss, 'Users', 'UserID', user.UserID, { Status: status });
  var idxKey = normaliseMobile_(user.MobileNumber) + '|Mobile';
  updateRecord_(masterSpreadsheet_(), 'LoginIndex', 'LookupKey', idxKey, { Status: status });
  audit_(ss, ctx, 'SET_USER_STATUS', 'Users', user.UserID, { status: status, reason: str_(payload.reason, 200) }, 'OK');
  notify_(ss, user.UserID, 'Account status changed',
    'Your SiteTrack account status is now ' + status + '.', 'Alert');
  return { userId: user.UserID, status: status };
}

function actionSetUserPermissions(payload, ctx) {
  requireFields_(payload, ['userId']);
  var ss = ctx.ss;
  var user = findRecord_(ss, 'Users', 'UserID', payload.userId);
  assert_(user, 'User not found', 404);
  assert_(canEditPermissions_(ctx, String(user.Role)), 'You may not change permissions for a ' + user.Role, 403);
  var validated = validatePermissionsPayload_(String(user.Role), payload.permissions, payload.projectScope, ss);
  validated.scope.forEach(function (pid) { if (pid !== 'ALL') assertProjectScope_(ctx, pid); });
  var updated = updateRecord_(ss, 'Users', 'UserID', user.UserID, {
    PermissionsJSON: jsonString_(validated.permissions),
    ProjectScopeJSON: jsonString_(validated.scope)
  });
  audit_(ss, ctx, 'SET_PERMISSIONS', 'Users', user.UserID,
    { permissions: Object.keys(validated.permissions).filter(function (k) { return validated.permissions[k]; }),
      scope: validated.scope.length === 1 && validated.scope[0] === 'ALL' ? 'ALL' : validated.scope.length }, 'OK');
  return { userId: user.UserID, permissions: validated.permissions, projectScope: validated.scope,
    user: maskUser_(ctx, updated) };
}

function actionResetUserPassword(payload, ctx) {
  requireFields_(payload, ['userId']);
  var ss = ctx.ss;
  var user = findRecord_(ss, 'Users', 'UserID', payload.userId);
  assert_(user, 'User not found', 404);
  assertProjectScopeOfUser_(ss, ctx, user);
  assert_(String(user.Role) !== ROLES.SUPER_ADMIN || String(ctx.role) === ROLES.SUPER_ADMIN,
    'Only a Super Admin can reset another Super Admin password', 403);

  var tempPassword = str_(payload.tempPassword, 40) || randomPassword_(10);
  var err = passwordStrong_(tempPassword);
  assert_(!err, err, 400);
  updateRecord_(ss, 'Users', 'UserID', user.UserID, {
    PasswordHash: hashPassword_(tempPassword), MustChangePassword: 'Y'
  });
  audit_(ss, ctx, 'RESET_PASSWORD', 'Users', user.UserID, {}, 'OK');

  var message = 'Your SiteTrack password was reset by an administrator.\n\nUser ID: ' +
    user.UserID + '\nTemporary password: ' + tempPassword +
    '\n\nSign in and set a new password immediately.';
  if (emailOk_(user.Email)) sendEmail_(user.Email, 'SiteTrack password reset', message);
  else sendSmsOrWhatsApp_(user.MobileNumber, message);
  notify_(ss, user.UserID, 'Password reset',
    'An administrator reset your password. Use the temporary password sent to you to sign in.', 'Alert');

  return { userId: user.UserID, tempPassword: tempPassword, sentTo: emailOk_(user.Email) ? user.Email : user.MobileNumber };
}

/* -------------------------------------------------------------------------- */
/*  Device registry administration                                            */
/* -------------------------------------------------------------------------- */

function actionListDeviceRegistry(payload, ctx) {
  var ss = ctx.ss;
  var rows = readTable_(ss, 'DeviceRegistry');
  var users = indexBy_(readTable_(ss, 'Users'), 'UserID');
  var statusFilter = str_(payload.status, 20);
  if (statusFilter === 'Pending') rows = rows.filter(function (r) { return String(r.Status) === 'PendingChange'; });
  else if (statusFilter) rows = rows.filter(function (r) { return String(r.Status) === statusFilter; });
  rows = sortBy_(rows, function (r) { return String(r.LastUsedAt || r.RegisteredAt); }, true);
  return {
    count: rows.length,
    devices: rows.map(function (r) {
      var u = users[String(r.UserID)] || {};
      return {
        deviceId: r.DeviceID, userId: r.UserID, userName: u.Name || '', role: u.Role || '',
        mobile: u.MobileNumber || '', label: r.DeviceLabel || '',
        fingerprint: maskString_(r.DeviceFingerprint, 6),
        pendingFingerprint: r.PendingFingerprint ? maskString_(r.PendingFingerprint, 6) : '',
        registeredAt: r.RegisteredAt, lastUsedAt: r.LastUsedAt, status: r.Status,
        requestedAt: r.RequestedAt || '', loginCount: num_(r.LoginCount, 0),
        userAgent: truncate_(r.UserAgent || '', 80)
      };
    })
  };
}

function actionApproveDeviceChange(payload, ctx) {
  requireFields_(payload, ['deviceId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'DeviceRegistry', 'DeviceID', payload.deviceId);
  assert_(row, 'Device record not found', 404);
  var approve = String(payload.decision).toLowerCase() === 'approve';

  if (approve) {
    assert_(!isBlank_(row.PendingFingerprint), 'There is no pending device change for this record', 400);
    updateRecord_(ss, 'DeviceRegistry', 'DeviceID', row.DeviceID, {
      DeviceFingerprint: row.PendingFingerprint,
      Status: 'Active',
      PendingFingerprint: '',
      ApprovedBy: ctx.userId,
      ApprovedAt: fmtDateTime_(new Date()),
      LastUsedAt: fmtDateTime_(new Date())
    });
    updateRecord_(ss, 'Users', 'UserID', row.UserID, { DeviceStatus: 'Bound', DeviceID: row.DeviceID });
    notify_(ss, row.UserID, 'Device change approved',
      'Your new device was approved by ' + ctx.userName + '. You can now mark attendance.', 'Approval');
  } else {
    updateRecord_(ss, 'DeviceRegistry', 'DeviceID', row.DeviceID, {
      Status: 'Active', PendingFingerprint: '', ApprovedBy: ctx.userId, ApprovedAt: fmtDateTime_(new Date())
    });
    updateRecord_(ss, 'Users', 'UserID', row.UserID, { DeviceStatus: 'Bound' });
    notify_(ss, row.UserID, 'Device change rejected',
      'Your device change request was rejected' + (payload.note ? ': ' + str_(payload.note, 200) : '.'), 'Alert');
  }
  audit_(ss, ctx, approve ? 'DEVICE_CHANGE_APPROVED' : 'DEVICE_CHANGE_REJECTED', 'DeviceRegistry', row.DeviceID,
    { userId: row.UserID, note: str_(payload.note, 200) }, 'OK');
  return { deviceId: row.DeviceID, decision: approve ? 'Approved' : 'Rejected' };
}

function actionBlockDevice(payload, ctx) {
  requireFields_(payload, ['deviceId', 'blocked']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'DeviceRegistry', 'DeviceID', payload.deviceId);
  assert_(row, 'Device record not found', 404);
  var blocked = bool_(payload.blocked, true);
  updateRecord_(ss, 'DeviceRegistry', 'DeviceID', row.DeviceID, {
    Status: blocked ? 'Blocked' : 'Active'
  });
  updateRecord_(ss, 'Users', 'UserID', row.UserID, { DeviceStatus: blocked ? 'Blocked' : 'Bound' });
  audit_(ss, ctx, blocked ? 'DEVICE_BLOCKED' : 'DEVICE_UNBLOCKED', 'DeviceRegistry', row.DeviceID,
    { userId: row.UserID, reason: str_(payload.reason, 200) }, 'OK');
  notify_(ss, row.UserID, blocked ? 'Device blocked' : 'Device unblocked',
    blocked ? 'Your registered device was blocked by an administrator.' : 'Your device block was removed.', 'Alert');
  return { deviceId: row.DeviceID, status: blocked ? 'Blocked' : 'Active' };
}
