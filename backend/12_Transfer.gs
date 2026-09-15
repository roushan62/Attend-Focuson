/**
 * ============================================================================
 *  FILE: 12_Transfer.gs
 *  ROLE: Site-to-site transfer workflow (moving an employee between projects)
 *        and the unified Approvals Centre queue (§8).
 * ============================================================================
 */

function transferDto_(t, ctx) {
  if (!t) return null;
  var umap = ctx && ctx.__userMap ? ctx.__userMap : null;
  var pmap = ctx && ctx.__projectMap ? ctx.__projectMap : null;
  var u = umap ? (umap[String(t.UserID)] || {}) : {};
  var from = pmap ? (pmap[String(t.FromProjectID)] || {}) : {};
  var to = pmap ? (pmap[String(t.ToProjectID)] || {}) : {};
  return {
    transferId: t.TransferID, userId: t.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
    fromProjectId: t.FromProjectID, fromProjectName: from.Name || '',
    toProjectId: t.ToProjectID, toProjectName: to.Name || '',
    effectiveDate: t.EffectiveDate, travelPaid: t.TravelPaid === 'Y',
    status: t.Status, approvedBy: t.ApprovedBy || '', reason: t.Reason || '',
    roleOnSite: t.RoleOnSite || '', appliedAt: t.AppliedAt || '',
    reviewedAt: t.ReviewedAt || '', reviewNote: t.ReviewNote || ''
  };
}

function actionRequestTransfer(payload, ctx) {
  requireFields_(payload, ['toProjectId', 'effectiveDate']);
  var ss = ctx.ss;
  var forUserId = str_(payload.forUserId, 40) || ctx.userId;
  var self = forUserId === ctx.userId;
  if (!self) {
    assertStaff_(ctx);
    assert_(can_(ctx, 'approveTransfer'), 'Only transfer approvers can move other employees', 403);
  }
  var user = findRecord_(ss, 'Users', 'UserID', forUserId);
  assert_(user, 'User not found', 404);
  assert_(isIsoDate_(payload.effectiveDate), 'effectiveDate must be yyyy-mm-dd', 400);
  assert_(payload.effectiveDate >= shiftDate_(today_(ctx.tz), -30),
    'Transfer date is too far in the past', 400);

  var toProject = findRecord_(ss, 'Projects', 'ProjectID', payload.toProjectId);
  assert_(toProject, 'Destination project not found', 404);
  // Scope is enforced for staff filing on someone's behalf; an employee may ask
  // to move to any active project — the approver's scope is checked on decision.
  if (isStaffRole_(ctx.role)) assertProjectScope_(ctx, toProject.ProjectID);
  assert_(String(toProject.Status) === 'Active', 'The destination project is not active', 400);

  var active = findRecords_(ss, 'ProjectAssignments', 'UserID', user.UserID)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  var fromProjectId = str_(payload.fromProjectId, 40) || (active.length ? String(active[0].ProjectID) : '');
  assert_(fromProjectId !== String(toProject.ProjectID), 'The employee is already on that project', 400);

  var pending = readTable_(ss, 'SiteTransfers').filter(function (t) {
    return String(t.UserID) === String(user.UserID) && String(t.Status) === 'Pending';
  });
  assert_(!pending.length, 'A transfer request for this employee is already pending', 409);

  var row = {
    TransferID: id_('TRF'),
    UserID: user.UserID,
    FromProjectID: fromProjectId,
    ToProjectID: toProject.ProjectID,
    EffectiveDate: payload.effectiveDate,
    TravelPaid: yn_(payload.travelPaid, true),
    Status: 'Pending',
    Reason: str_(payload.reason, 400),
    RoleOnSite: str_(payload.roleOnSite, 40) || (active.length ? active[0].RoleOnSite : 'Worker'),
    AppliedAt: fmtDateTime_(new Date())
  };
  appendRecord_(ss, 'SiteTransfers', row);
  audit_(ss, ctx, 'TRANSFER_REQUESTED', 'SiteTransfers', row.TransferID,
    { user: user.Name, from: fromProjectId, to: toProject.ProjectID, date: row.EffectiveDate }, 'PENDING');
  notifyAdmins_(ss, ctx, 'Site transfer request — ' + user.Name,
    user.Name + ' requested a transfer to ' + toProject.Name + ' effective ' + row.EffectiveDate +
    '.\nReason: ' + (row.Reason || 'not given') + '\nTravel paid: ' + row.TravelPaid +
    '\n\nApprove it in the Approvals Centre.', 'Approval');
  if (!self) notify_(ss, user.UserID, 'Transfer requested for you',
    ctx.userName + ' requested your transfer to ' + toProject.Name + ' from ' + row.EffectiveDate + '.', 'Info');
  return { transferId: row.TransferID, status: 'Pending' };
}

function actionListTransfers(payload, ctx) {
  var ss = ctx.ss;
  var ctxLocal = ctx;
  ctxLocal.__userMap = userMap_(ss);
  ctxLocal.__projectMap = projectMap_(ss);
  var rows = readTable_(ss, 'SiteTransfers');
  if (String(ctx.role) === ROLES.EMPLOYEE) rows = rows.filter(function (t) { return String(t.UserID) === ctx.userId; });
  else rows = scopedRows_(ctx, rows, 'ToProjectID');
  var status = str_(payload.status, 20);
  if (status) rows = rows.filter(function (t) { return String(t.Status) === status; });
  if (payload.userId) rows = rows.filter(function (t) { return String(t.UserID) === String(payload.userId); });
  rows = sortBy_(rows, function (t) { return String(t.AppliedAt); }, true);
  return { count: rows.length, transfers: rows.slice(0, 400).map(function (t) { return transferDto_(t, ctxLocal); }) };
}

function actionDecideTransfer(payload, ctx) {
  requireFields_(payload, ['transferId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'SiteTransfers', 'TransferID', payload.transferId);
  assert_(row, 'Transfer request not found', 404);
  assertProjectScope_(ctx, row.ToProjectID);
  assert_(String(row.Status) === 'Pending', 'This request was already ' + String(row.Status).toLowerCase(), 409);
  var approve = String(payload.decision).toLowerCase() === 'approve';
  var note = str_(payload.note, 300);

  updateRecord_(ss, 'SiteTransfers', 'TransferID', row.TransferID, {
    Status: approve ? 'Approved' : 'Rejected',
    ApprovedBy: ctx.userId,
    ReviewedAt: fmtDateTime_(new Date()),
    ReviewNote: note || (approve ? 'Approved by ' + ctx.userName : 'Rejected by ' + ctx.userName)
  });

  if (approve) {
    var effective = String(row.EffectiveDate);
    // Close the old assignment and open the new one.
    if (row.FromProjectID) {
      findRecords_(ss, 'ProjectAssignments', 'UserID', row.UserID)
        .filter(function (a) {
          return String(a.ProjectID) === String(row.FromProjectID) && String(a.Status) === 'Active';
        })
        .forEach(function (a) {
          updateRecord_(ss, 'ProjectAssignments', 'AssignmentID', a.AssignmentID, {
            Status: 'Ended', AssignedTo: shiftDate_(effective, -1)
          });
        });
    }
    var toProject = findRecord_(ss, 'Projects', 'ProjectID', row.ToProjectID);
    var user = findRecord_(ss, 'Users', 'UserID', row.UserID);
    createAssignment_(ss, ctx, {
      projectId: row.ToProjectID, userId: row.UserID,
      roleOnSite: row.RoleOnSite || 'Worker', assignedFrom: effective,
      dailyWage: user ? user.DailyWage : 0,
      notes: 'Transfer ' + row.TransferID
    });

    // Travel day is a payable attendance state (§5).
    if (effective <= today_(ctx.tz) && String(row.TravelPaid) === 'Y') {
      var exists = readTable_(ss, 'Attendance').some(function (m) {
        return String(m.UserID) === String(row.UserID) && String(m.Date) === effective;
      });
      if (!exists) {
        appendRecord_(ss, 'Attendance', {
          AttendanceID: id_('ATT'), UserID: row.UserID, ProjectID: row.ToProjectID,
          Date: effective, MarkedAt: fmtDateTime_(new Date()),
          Status: 'Transfer', Source: 'System', ReviewedBy: ctx.userId,
          ReviewNote: 'Site transfer travel day (paid)', HoursWorked: String(num_(ctx.settings.standardHours, 8)),
          CreatedAt: fmtDateTime_(new Date())
        });
      }
    }
    audit_(ss, ctx, 'TRANSFER_APPROVED', 'SiteTransfers', row.TransferID,
      { user: row.UserID, to: toProject ? toProject.Name : row.ToProjectID, effective: effective }, 'OK');
  } else {
    audit_(ss, ctx, 'TRANSFER_REJECTED', 'SiteTransfers', row.TransferID, { note: note }, 'OK');
  }

  notify_(ss, row.UserID, approve ? 'Transfer approved' : 'Transfer rejected',
    approve
      ? 'You are transferred to ' + (findRecord_(ss, 'Projects', 'ProjectID', row.ToProjectID) || {}).Name +
        ' from ' + row.EffectiveDate + '. Mark your attendance at the new site.'
      : 'Your transfer request was rejected' + (note ? ': ' + note : ''),
    approve ? 'Approval' : 'Alert');
  return { transferId: row.TransferID, status: approve ? 'Approved' : 'Rejected' };
}

/* -------------------------------------------------------------------------- */
/*  Unified Approvals Centre (§8)                                             */
/* -------------------------------------------------------------------------- */

function actionApprovalsQueue(payload, ctx) {
  var ss = ctx.ss;
  var ctxLocal = ctx;
  ctxLocal.__userMap = userMap_(ss);
  ctxLocal.__projectMap = projectMap_(ss);
  var tab = str_(payload.tab, 20) || 'all';
  var limit = Math.min(Math.max(num_(payload.limit, 50), 1), 300);
  var out = { counts: {}, tabs: {} };

  function include(name) { return tab === 'all' || tab === name; }

  if (include('leave') && can_(ctx, 'approveLeave')) {
    var leaves = scopedUsers_(ss, ctx, readTable_(ss, 'LeaveRequests'))
      .filter(function (r) { return String(r.Status) === 'Pending'; });
    leaves = sortBy_(leaves, function (r) { return String(r.AppliedAt); });
    out.counts.leave = leaves.length;
    out.tabs.leave = leaves.slice(0, limit).map(function (r) { return leaveDto_(r, ctxLocal); });
  } else out.counts.leave = 0;

  if (include('expense') && can_(ctx, 'approveExpense')) {
    var expenses = scopedRows_(ctx, readTable_(ss, 'ExpenseRequests'), 'ProjectID')
      .filter(function (r) { return String(r.Status) === 'Pending'; });
    expenses = sortBy_(expenses, function (r) { return String(r.AppliedAt); });
    out.counts.expense = expenses.length;
    out.tabs.expense = expenses.slice(0, limit).map(function (r) { return expenseDto_(r, ctxLocal); });
  } else out.counts.expense = 0;

  if (include('transfer') && can_(ctx, 'approveTransfer')) {
    var transfers = scopedRows_(ctx, readTable_(ss, 'SiteTransfers'), 'ToProjectID')
      .filter(function (r) { return String(r.Status) === 'Pending'; });
    transfers = sortBy_(transfers, function (r) { return String(r.AppliedAt); });
    out.counts.transfer = transfers.length;
    out.tabs.transfer = transfers.slice(0, limit).map(function (r) { return transferDto_(r, ctxLocal); });
  } else out.counts.transfer = 0;

  if (include('flagged') && can_(ctx, 'reviewAttendance')) {
    var flagged = scopedRows_(ctx, readTable_(ss, 'Attendance'), 'ProjectID')
      .filter(function (r) { return String(r.Status) === 'Flagged'; });
    flagged = sortBy_(flagged, function (r) { return String(r.Date) + String(r.MarkedAt); }, true);
    out.counts.flagged = flagged.length;
    out.tabs.flagged = flagged.slice(0, limit).map(function (r) {
      var dto = attendanceDto_(r, ctxLocal);
      var u = ctxLocal.__userMap[String(r.UserID)] || {};
      var p = ctxLocal.__projectMap[String(r.ProjectID)] || {};
      dto.userName = u.Name || ''; dto.mobile = u.MobileNumber || '';
      dto.projectName = p.Name || '';
      return dto;
    });
  } else out.counts.flagged = 0;

  if (include('regularization') && can_(ctx, 'approveRegularization')) {
    var regs = scopedRows_(ctx, readTable_(ss, 'RegularizationRequests'), 'ProjectID')
      .filter(function (r) { return String(r.Status) === 'Pending'; });
    regs = sortBy_(regs, function (r) { return String(r.AppliedAt); });
    out.counts.regularization = regs.length;
    out.tabs.regularization = regs.slice(0, limit).map(function (r) {
      var u = ctxLocal.__userMap[String(r.UserID)] || {};
      var p = ctxLocal.__projectMap[String(r.ProjectID)] || {};
      return {
        requestId: r.RequestID, userId: r.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
        projectId: r.ProjectID, projectName: p.Name || '', date: r.Date,
        requestedStatus: r.RequestedStatus, reason: r.Reason, proofLink: r.ProofLink || '',
        proofFileId: r.ProofFileId || '', appliedAt: r.AppliedAt, inTime: r.InTime || '', outTime: r.OutTime || ''
      };
    });
  } else out.counts.regularization = 0;

  if (include('device') && can_(ctx, 'editEmployees')) {
    var devices = readTable_(ss, 'DeviceRegistry')
      .filter(function (d) { return String(d.Status) === 'PendingChange'; });
    out.counts.device = devices.length;
    out.tabs.device = devices.slice(0, limit).map(function (d) {
      var u = ctxLocal.__userMap[String(d.UserID)] || {};
      return {
        deviceId: d.DeviceID, userId: d.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
        label: d.DeviceLabel || '', currentFingerprint: maskString_(d.DeviceFingerprint, 6),
        requestedFingerprint: maskString_(d.PendingFingerprint, 6),
        requestedAt: d.RequestedAt || '', status: d.Status
      };
    });
  } else out.counts.device = 0;

  out.total = Object.keys(out.counts).reduce(function (sum, k) { return sum + num_(out.counts[k], 0); }, 0);
  out.serverTime = iso_(new Date());
  return out;
}

/** Filter rows that reference a UserID down to users inside the caller's scope. */
function scopedUsers_(ss, ctx, rows) {
  if (scopeIsAll_(ctx)) return rows;
  var allowed = {};
  readTable_(ss, 'ProjectAssignments').forEach(function (a) {
    if (inScope_(ctx, a.ProjectID)) allowed[String(a.UserID)] = true;
  });
  return rows.filter(function (r) { return allowed[String(r.UserID)]; });
}
