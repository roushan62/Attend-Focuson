/**
 * ============================================================================
 *  FILE: 10_Leave.gs
 *  ROLE: Leave application + approval workflow (§4, §8 Approvals Center).
 * ============================================================================
 */

function leaveDto_(l, ctx) {
  if (!l) return null;
  var umap = ctx && ctx.__userMap ? ctx.__userMap : null;
  var u = umap ? (umap[String(l.UserID)] || {}) : {};
  return {
    leaveId: l.LeaveID, userId: l.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
    fromDate: l.FromDate, toDate: l.ToDate, days: num_(l.Days, daysBetween_(l.FromDate, l.ToDate)),
    type: l.Type, reason: l.Reason || '', status: l.Status,
    approvedBy: l.ApprovedBy || '', appliedAt: l.AppliedAt || '',
    reviewedAt: l.ReviewedAt || '', reviewNote: l.ReviewNote || '',
    attachmentLink: l.AttachmentLink || ''
  };
}

function actionRequestLeave(payload, ctx) {
  requireFields_(payload, ['fromDate', 'toDate', 'type', 'reason']);
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();

  var forUserId = str_(payload.forUserId, 40) || ctx.userId;
  if (forUserId !== ctx.userId) {
    assertStaff_(ctx);
    assert_(can_(ctx, 'approveLeave'), 'Only leave approvers can file leave on someone else\'s behalf', 403);
  }
  var user = findRecord_(ss, 'Users', 'UserID', forUserId);
  assert_(user, 'User not found', 404);

  assert_(isIsoDate_(payload.fromDate) && isIsoDate_(payload.toDate), 'Dates must be yyyy-mm-dd', 400);
  assert_(payload.toDate >= payload.fromDate, 'To-date cannot be before from-date', 400);
  var todayStr = today_(tz);
  assert_(payload.fromDate >= shiftDate_(todayStr, -7),
    'Leave cannot be applied for more than 7 days in the past — use an attendance regularization request instead', 400);
  assert_(payload.fromDate <= shiftDate_(todayStr, 366), 'That date is too far in the future', 400);

  var type = pickOne_(payload.type, LEAVE_TYPES, '');
  assert_(type, 'Type must be one of: ' + LEAVE_TYPES.join(', '), 400);
  var reason = str_(payload.reason, 500);
  assert_(reason.length >= 3, 'Please give a reason', 400);

  var days = num_(payload.days, daysBetween_(payload.fromDate, payload.toDate));
  assert_(days > 0 && days <= 120, 'Leave duration looks incorrect', 400);

  // Overlap guard
  var existing = readTable_(ss, 'LeaveRequests').filter(function (r) {
    return String(r.UserID) === String(user.UserID) &&
      ['Pending', 'Approved'].indexOf(String(r.Status)) >= 0 &&
      !(r.ToDate < payload.fromDate || r.FromDate > payload.toDate);
  });
  if (existing.length) {
    throw new ApiError_('An overlapping leave request already exists (' +
      existing[0].FromDate + ' → ' + existing[0].ToDate + ', ' + existing[0].Status + ')', 409);
  }

  var attachmentLink = '';
  if (!isBlank_(payload.attachmentBase64)) {
    var stored = storeCompanyUpload_(ctx.company, 'Documents',
      'leave-' + user.UserID + '-' + payload.fromDate, String(payload.attachmentBase64),
      str_(payload.attachmentMime, 'image/jpeg'));
    attachmentLink = stored.link;
  }

  // Staff filing for themselves is auto-approved only when explicitly requested.
  var autoApprove = forUserId !== ctx.userId && bool_(payload.autoApprove, false);
  var row = {
    LeaveID: id_('LV'),
    UserID: user.UserID,
    FromDate: payload.fromDate,
    ToDate: payload.toDate,
    Type: type,
    Reason: reason,
    Status: autoApprove ? 'Approved' : 'Pending',
    ApprovedBy: autoApprove ? ctx.userId : '',
    AppliedAt: fmtDateTime_(new Date()),
    Days: String(days),
    AttachmentLink: attachmentLink,
    ReviewedAt: autoApprove ? fmtDateTime_(new Date()) : '',
    ReviewNote: autoApprove ? 'Filed and approved by ' + ctx.userName : ''
  };
  appendRecord_(ss, 'LeaveRequests', row);
  audit_(ss, ctx, 'LEAVE_REQUESTED', 'LeaveRequests', row.LeaveID,
    { user: user.Name, from: row.FromDate, to: row.ToDate, type: type, days: days }, autoApprove ? 'OK' : 'PENDING');

  if (!autoApprove) {
    notifyAdmins_(ss, ctx, 'Leave request — ' + user.Name,
      user.Name + ' applied for ' + type + ' leave from ' + row.FromDate + ' to ' + row.ToDate +
      ' (' + days + ' day' + (days > 1 ? 's' : '') + ').\nReason: ' + reason +
      '\n\nApprove or reject it in the Approvals Centre.', 'Approval');
  }
  notify_(ss, user.UserID, autoApprove ? 'Leave approved' : 'Leave request submitted',
    autoApprove
      ? 'Your leave from ' + row.FromDate + ' to ' + row.ToDate + ' was approved by ' + ctx.userName + '.'
      : 'Your leave request (' + row.FromDate + ' → ' + row.ToDate + ') is pending approval.',
    autoApprove ? 'Approval' : 'Info');

  return { leaveId: row.LeaveID, status: row.Status, days: days,
    message: autoApprove ? 'Leave recorded as approved.' : 'Leave request submitted for approval.' };
}

function actionListLeaves(payload, ctx) {
  var ss = ctx.ss;
  var ctxLocal = ctx;
  ctxLocal.__userMap = userMap_(ss);
  var rows = readTable_(ss, 'LeaveRequests');
  var isEmployee = String(ctx.role) === ROLES.EMPLOYEE;
  if (isEmployee) rows = rows.filter(function (r) { return String(r.UserID) === ctx.userId; });
  else if (!scopeIsAll_(ctx) && !can_(ctx, 'viewAllEmployees')) {
    var allowedUsers = {};
    readTable_(ss, 'ProjectAssignments').forEach(function (a) {
      if (inScope_(ctx, a.ProjectID)) allowedUsers[String(a.UserID)] = true;
    });
    rows = rows.filter(function (r) { return allowedUsers[String(r.UserID)]; });
  }
  var status = str_(payload.status, 20);
  if (status) rows = rows.filter(function (r) { return String(r.Status) === status; });
  var userId = str_(payload.userId, 40);
  if (userId) {
    if (isEmployee && userId !== ctx.userId) throw new ApiError_('Not permitted', 403);
    rows = rows.filter(function (r) { return String(r.UserID) === userId; });
  }
  if (isIsoDate_(payload.from)) rows = rows.filter(function (r) { return String(r.ToDate) >= payload.from; });
  if (isIsoDate_(payload.to)) rows = rows.filter(function (r) { return String(r.FromDate) <= payload.to; });

  rows = sortBy_(rows, function (r) { return String(r.AppliedAt); }, true);
  var limit = Math.min(Math.max(num_(payload.limit, 200), 1), 1000);
  return { count: rows.length, leaves: rows.slice(0, limit).map(function (r) { return leaveDto_(r, ctxLocal); }) };
}

function actionCancelLeave(payload, ctx) {
  requireFields_(payload, ['leaveId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'LeaveRequests', 'LeaveID', payload.leaveId);
  assert_(row, 'Leave request not found', 404);
  assert_(String(row.UserID) === ctx.userId || can_(ctx, 'approveLeave'), 'You cannot cancel this request', 403);
  assert_(String(row.Status) === 'Pending', 'Only a pending request can be cancelled', 409);
  updateRecord_(ss, 'LeaveRequests', 'LeaveID', row.LeaveID, {
    Status: 'Cancelled', CancelledAt: fmtDateTime_(new Date()), ReviewNote: 'Cancelled by ' + ctx.userName
  });
  audit_(ss, ctx, 'LEAVE_CANCELLED', 'LeaveRequests', row.LeaveID, {}, 'OK');
  return { leaveId: row.LeaveID, status: 'Cancelled' };
}

/** decision = approve | reject */
function actionDecideLeave(payload, ctx) {
  requireFields_(payload, ['leaveId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'LeaveRequests', 'LeaveID', payload.leaveId);
  assert_(row, 'Leave request not found', 404);
  assert_(String(row.Status) === 'Pending', 'This request was already ' + String(row.Status).toLowerCase(), 409);
  if (!scopeIsAll_(ctx)) {
    var asg = findRecords_(ss, 'ProjectAssignments', 'UserID', row.UserID);
    assert_(asg.some(function (a) { return inScope_(ctx, a.ProjectID); }),
      'This employee is outside your project scope', 403);
  }

  var approve = String(payload.decision).toLowerCase() === 'approve';
  var note = str_(payload.note, 300);
  var updated = updateRecord_(ss, 'LeaveRequests', 'LeaveID', row.LeaveID, {
    Status: approve ? 'Approved' : 'Rejected',
    ApprovedBy: ctx.userId,
    ReviewedAt: fmtDateTime_(new Date()),
    ReviewNote: note || (approve ? 'Approved by ' + ctx.userName : 'Rejected by ' + ctx.userName)
  });

  // Reflect an approved leave on the affected days so reports agree with payroll.
  if (approve && bool_(payload.writeAttendance, false)) {
    var projectId = str_(payload.projectId, 40);
    if (!projectId) {
      var a = findRecords_(ss, 'ProjectAssignments', 'UserID', row.UserID)
        .filter(function (x) { return String(x.Status) === 'Active'; })[0];
      projectId = a ? String(a.ProjectID) : '';
    }
    if (projectId) {
      dateRange_(row.FromDate, row.ToDate).forEach(function (dateStr) {
        var exists = readTable_(ss, 'Attendance').some(function (m) {
          return String(m.UserID) === String(row.UserID) && String(m.Date) === dateStr;
        });
        if (exists) return;
        appendRecord_(ss, 'Attendance', {
          AttendanceID: id_('ATT'), UserID: row.UserID, ProjectID: projectId, Date: dateStr,
          MarkedAt: fmtDateTime_(new Date()), Status: 'Leave', Source: 'System',
          ReviewedBy: ctx.userId, ReviewNote: 'Auto from leave ' + row.LeaveID,
          CreatedAt: fmtDateTime_(new Date())
        });
      });
    }
  }

  audit_(ss, ctx, approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', 'LeaveRequests', row.LeaveID,
    { user: row.UserID, from: row.FromDate, to: row.ToDate, note: note }, 'OK');
  notify_(ss, row.UserID, approve ? 'Leave approved' : 'Leave rejected',
    'Your ' + row.Type + ' leave (' + row.FromDate + ' → ' + row.ToDate + ') was ' +
    (approve ? 'approved' : 'rejected') + ' by ' + ctx.userName + (note ? '. Note: ' + note : ''),
    approve ? 'Approval' : 'Alert');
  sendStatusMail_(ss, row.UserID, approve ? 'Leave approved' : 'Leave rejected',
    'Your leave request for ' + row.FromDate + ' to ' + row.ToDate + ' (' + row.Type + ') was ' +
    (approve ? 'APPROVED' : 'REJECTED') + ' by ' + ctx.userName + '.' + (note ? '\nNote: ' + note : ''));

  return { leaveId: row.LeaveID, status: approve ? 'Approved' : 'Rejected', leave: leaveDto_(updated, ctx) };
}
