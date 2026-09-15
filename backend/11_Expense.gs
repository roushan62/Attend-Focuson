/**
 * ============================================================================
 *  FILE: 11_Expense.gs
 *  ROLE: Site expense claims with proof upload, approval and payroll payout
 *        tracking (§6 ExpenseRequests, §7 report 4).
 * ============================================================================
 */

function expenseDto_(x, ctx) {
  if (!x) return null;
  var umap = ctx && ctx.__userMap ? ctx.__userMap : null;
  var pmap = ctx && ctx.__projectMap ? ctx.__projectMap : null;
  var u = umap ? (umap[String(x.UserID)] || {}) : {};
  var p = pmap ? (pmap[String(x.ProjectID)] || {}) : {};
  return {
    expenseId: x.ExpenseID, userId: x.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
    projectId: x.ProjectID, projectName: p.Name || '',
    amount: num_(x.Amount, 0), category: x.Category, description: x.Description || '',
    proofLink: x.ProofDriveLink || '', proofFileId: x.ProofFileId || '', receiptNo: x.ReceiptNo || '',
    status: x.Status, payoutStatus: x.PayoutStatus || 'Pending',
    approvedBy: x.ApprovedBy || '', appliedAt: x.AppliedAt || '',
    reviewedAt: x.ReviewedAt || '', reviewNote: x.ReviewNote || '', paidOn: x.PaidOn || ''
  };
}

function actionRequestExpense(payload, ctx) {
  requireFields_(payload, ['amount', 'category', 'description']);
  var ss = ctx.ss;
  var amount = num_(payload.amount, 0);
  assert_(amount > 0 && amount <= 10000000, 'Enter a valid amount (1 – 1,00,00,000)', 400);
  var category = pickOne_(payload.category, EXPENSE_CATEGORIES, '');
  assert_(category, 'Category must be one of: ' + EXPENSE_CATEGORIES.join(', '), 400);
  var description = str_(payload.description, 600);
  assert_(description.length >= 3, 'Describe the expense', 400);

  var projectId = str_(payload.projectId, 40);
  if (!projectId) {
    var p = resolveMarkProject_(ss, ctx, {});
    projectId = p ? String(p.ProjectID) : '';
  }
  if (projectId) assertProjectScope_(ctx, projectId);

  var forUserId = str_(payload.forUserId, 40) || ctx.userId;
  if (forUserId !== ctx.userId) {
    assertStaff_(ctx);
    assert_(can_(ctx, 'approveExpense'), 'Only expense approvers can file on someone else\'s behalf', 403);
  }
  var user = findRecord_(ss, 'Users', 'UserID', forUserId);
  assert_(user, 'User not found', 404);

  var proofLink = '', proofFileId = '';
  if (!isBlank_(payload.proofBase64)) {
    var stored = storeCompanyUpload_(ctx.company, 'Expenses',
      'exp-' + user.UserID + '-' + today_(ctx.tz) + '-' + shortId_(4),
      String(payload.proofBase64), str_(payload.proofMime, 'image/jpeg'));
    proofLink = stored.link;
    proofFileId = stored.fileId;
  }
  var requireProof = String(ctx.settings.expenseProofRequired || 'N').toUpperCase() === 'Y';
  if (requireProof && !proofLink) throw new ApiError_('A photo of the bill/receipt is required', 400);

  var incurredOn = isIsoDate_(payload.incurredOn) ? payload.incurredOn : today_(ctx.tz);
  assert_(incurredOn >= shiftDate_(today_(ctx.tz), -90), 'Expenses older than 90 days cannot be claimed', 400);

  var row = {
    ExpenseID: id_('EXP'),
    UserID: user.UserID,
    ProjectID: projectId,
    Amount: String(amount),
    Category: category,
    Description: description,
    ProofDriveLink: proofLink,
    ProofFileId: proofFileId,
    ReceiptNo: str_(payload.receiptNo, 40),
    Status: 'Pending',
    PayoutStatus: 'Pending',
    AppliedAt: fmtDateTime_(new Date()),
    ReviewNote: incurredOn !== today_(ctx.tz) ? ('Incurred on ' + incurredOn) : ''
  };
  appendRecord_(ss, 'ExpenseRequests', row);
  audit_(ss, ctx, 'EXPENSE_REQUESTED', 'ExpenseRequests', row.ExpenseID,
    { user: user.Name, amount: amount, category: category, project: projectId }, 'PENDING');

  notifyAdmins_(ss, ctx, 'Expense request — ' + user.Name,
    user.Name + ' claimed ' + ctx.settings.currency + ' ' + amount + ' (' + category + ').\n' +
    description + '\nProof: ' + (proofLink ? 'attached' : 'not attached') +
    '\n\nApprove or reject it in the Approvals Centre.', 'Approval');
  notify_(ss, user.UserID, 'Expense submitted',
    'Your expense claim of ' + ctx.settings.currency + ' ' + amount + ' is pending approval.', 'Info');

  return { expenseId: row.ExpenseID, status: 'Pending', amount: amount, proofStored: !!proofLink };
}

function actionListExpenses(payload, ctx) {
  var ss = ctx.ss;
  var ctxLocal = ctx;
  ctxLocal.__userMap = userMap_(ss);
  ctxLocal.__projectMap = projectMap_(ss);
  var rows = readTable_(ss, 'ExpenseRequests');
  var isEmployee = String(ctx.role) === ROLES.EMPLOYEE;
  if (isEmployee) rows = rows.filter(function (r) { return String(r.UserID) === ctx.userId; });
  else {
    rows = scopedRows_(ctx, rows, 'ProjectID');
  }
  var status = str_(payload.status, 20);
  if (status) rows = rows.filter(function (r) { return String(r.Status) === status; });
  var payout = str_(payload.payoutStatus, 20);
  if (payout) rows = rows.filter(function (r) { return String(r.PayoutStatus) === payout; });
  if (payload.projectId) rows = rows.filter(function (r) { return String(r.ProjectID) === String(payload.projectId); });
  if (payload.userId) {
    if (isEmployee && String(payload.userId) !== ctx.userId) throw new ApiError_('Not permitted', 403);
    rows = rows.filter(function (r) { return String(r.UserID) === String(payload.userId); });
  }
  if (isIsoDate_(payload.from)) rows = rows.filter(function (r) { return String(r.AppliedAt) >= payload.from; });
  if (isIsoDate_(payload.to)) rows = rows.filter(function (r) { return String(r.AppliedAt) <= payload.to + ' 23:59:59'; });

  rows = sortBy_(rows, function (r) { return String(r.AppliedAt); }, true);
  var limit = Math.min(Math.max(num_(payload.limit, 200), 1), 1000);
  var slice = rows.slice(0, limit).map(function (r) { return expenseDto_(r, ctxLocal); });
  var totals = { pending: 0, approved: 0, rejected: 0, approvedAmount: 0, pendingAmount: 0 };
  rows.forEach(function (r) {
    var amt = num_(r.Amount, 0);
    if (String(r.Status) === 'Pending') { totals.pending++; totals.pendingAmount += amt; }
    else if (String(r.Status) === 'Approved') { totals.approved++; totals.approvedAmount += amt; }
    else totals.rejected++;
  });
  totals.approvedAmount = Math.round(totals.approvedAmount * 100) / 100;
  totals.pendingAmount = Math.round(totals.pendingAmount * 100) / 100;
  return { count: rows.length, expenses: slice, totals: totals };
}

function actionDecideExpense(payload, ctx) {
  requireFields_(payload, ['expenseId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'ExpenseRequests', 'ExpenseID', payload.expenseId);
  assert_(row, 'Expense request not found', 404);
  assertProjectScope_(ctx, row.ProjectID);
  assert_(String(row.Status) === 'Pending', 'This request was already ' + String(row.Status).toLowerCase(), 409);
  var approve = String(payload.decision).toLowerCase() === 'approve';
  var note = str_(payload.note, 300);

  var amount = num_(row.Amount, 0);
  if (approve && payload.amount !== undefined) {
    amount = num_(payload.amount, amount);
    assert_(amount > 0 && amount <= num_(row.Amount, 0), 'The approved amount cannot exceed the claimed amount', 400);
  }

  var updated = updateRecord_(ss, 'ExpenseRequests', 'ExpenseID', row.ExpenseID, {
    Status: approve ? 'Approved' : 'Rejected',
    ApprovedBy: ctx.userId,
    Amount: String(amount),
    PayoutStatus: approve ? (str_(payload.payoutStatus, 20) === 'PaidCash' ? 'PaidCash' : 'Pending') : 'Pending',
    PaidOn: approve && str_(payload.payoutStatus, 20) === 'PaidCash' ? today_(ctx.tz) : '',
    ReviewedAt: fmtDateTime_(new Date()),
    ReviewNote: note || (approve ? 'Approved by ' + ctx.userName : 'Rejected by ' + ctx.userName)
  });

  audit_(ss, ctx, approve ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED', 'ExpenseRequests', row.ExpenseID,
    { amount: amount, user: row.UserID, note: note }, 'OK');
  notify_(ss, row.UserID, approve ? 'Expense approved' : 'Expense rejected',
    'Your ' + row.Category + ' expense of ' + ctx.settings.currency + ' ' + amount + ' was ' +
    (approve ? 'approved' : 'rejected') + ' by ' + ctx.userName +
    (approve ? '. It will be added to your next payroll run.' : '') + (note ? ' Note: ' + note : ''),
    approve ? 'Approval' : 'Alert');
  sendStatusMail_(ss, row.UserID, approve ? 'Expense approved' : 'Expense rejected',
    'Your expense claim (' + row.Category + ', ' + ctx.settings.currency + ' ' + amount + ') was ' +
    (approve ? 'APPROVED' : 'REJECTED') + ' by ' + ctx.userName + '.' + (note ? '\nNote: ' + note : ''));

  return { expenseId: row.ExpenseID, status: approve ? 'Approved' : 'Rejected',
    amount: amount, expense: expenseDto_(updated, ctx) };
}
