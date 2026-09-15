/**
 * ============================================================================
 *  FILE: 15_Payroll.gs
 *  ROLE: Payroll-ready wage sheet (§7 report 6, §9.13) — combines present days,
 *        half days, paid leave, overtime and approved expenses, minus unpaid
 *        leave / absent days, into a per-employee sheet accounts can use as-is.
 * ============================================================================
 */

function payrollRateFor_(user, assignment, settings) {
  var salaryType = String(user.SalaryType || 'Daily');
  var assignmentWage = assignment ? num_(assignment.DailyWage, 0) : 0;
  var daily = assignmentWage > 0 ? assignmentWage : num_(user.DailyWage, 0);
  var monthly = num_(user.MonthlySalary, 0);
  var perDay = 0;
  if (salaryType === 'Monthly' && monthly > 0) {
    perDay = monthly / num_(settings.payrollDaysBasis || 26, 26);
  } else if (daily > 0) {
    perDay = daily;
  } else if (monthly > 0) {
    perDay = monthly / num_(settings.payrollDaysBasis || 26, 26);
  }
  return {
    salaryType: salaryType,
    dailyWage: daily,
    monthlySalary: monthly,
    perDayRate: Math.round(perDay * 100) / 100
  };
}

/**
 * Build the payroll wage sheet for one month.
 * payload: { month, projectId, userIds?, confirmPayout?, includeVendorLabour? }
 */
function payrollCompute_(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var month = /^\d{4}-\d{2}$/.test(str_(payload.month, 8)) ? str_(payload.month, 8) : monthKey_(today_(ctx.tz));
  var bounds = monthBounds_(month);
  var projectId = str_(payload.projectId, 40);
  if (projectId) assertProjectScope_(ctx, projectId);

  var filters = { month: month, from: bounds.from, to: bounds.to, projectId: projectId, userId: '' };
  var sel = reportUsers_(ss, ctx, filters);
  var pmap = projectMap_(ss);

  var overtimeRate = num_(settings.overtimeRate, 1.5);
  // Stored as Y/N (see the settings form): only an explicit 'N' makes holidays unpaid.
  var paidHolidays = String(settings.paidHolidays === undefined || settings.paidHolidays === '' ? 'Y' : settings.paidHolidays)
    .toUpperCase() === 'N' ? 0 : 1;
  var halfDayFactor = 0.5;

  var rows = sel.users.filter(function (u) { return String(u.Role) !== ROLES.SUPER_ADMIN; }).map(function (u) {
    var summary = monthlySummaryFor_(ss, ctx, u.UserID, month, settings);
    var asgList = (sel.assignmentsByUser[String(u.UserID)] || [])
      .filter(function (a) { return !projectId || a.projectId === projectId; });
    var asg = asgList.filter(function (a) { return a.status === 'Active'; })[0] || asgList[0] || {};
    var rate = payrollRateFor_(u, asg, settings);
    var t = summary.totals;

    var presentDays = t.present;                        // includes late marks
    var halfDays = t.halfDay * halfDayFactor;
    var paidLeaveDays = t.paidLeave + t.sickLeave + t.casualLeave;
    var travelDays = t.travel + t.transfer;
    var holidayDays = t.holiday * paidHolidays;
    var unpaidDays = t.unpaidLeave;
    var absentDays = t.absent;

    var payableDays = Math.round((presentDays + halfDays + paidLeaveDays + travelDays + holidayDays) * 100) / 100;
    var lopDays = Math.round((unpaidDays + absentDays) * 100) / 100;

    var monthlyBase = rate.salaryType === 'Monthly' && rate.monthlySalary > 0 ? rate.monthlySalary : 0;
    var earned = monthlyBase > 0
      ? Math.round((monthlyBase / bounds.days) * payableDays * 100) / 100
      : Math.round(rate.perDayRate * payableDays * 100) / 100;

    var overtimeHours = Math.round(t.overtimeHours * 100) / 100;
    var overtimeAmount = Math.round(overtimeHours * rate.perDayRate / num_(settings.standardHours, 8) *
      overtimeRate * 100) / 100;

    var expenses = readTable_(ss, 'ExpenseRequests').filter(function (x) {
      return String(x.UserID) === String(u.UserID) && String(x.Status) === 'Approved' &&
        String(x.AppliedAt).substring(0, 7) === month &&
        (!projectId || String(x.ProjectID) === projectId);
    });
    var expenseAmount = Math.round(expenses.reduce(function (s, x) { return s + num_(x.Amount, 0); }, 0) * 100) / 100;
    var expenseIds = expenses.map(function (x) { return x.ExpenseID; });

    var lopDeduction = monthlyBase > 0
      ? Math.round((monthlyBase / bounds.days) * lopDays * 100) / 100
      : Math.round(rate.perDayRate * lopDays * 100) / 100;

    var advance = num_(payload.advances ? (payload.advances[String(u.UserID)] || 0) : 0, 0);
    var netPayable = Math.round((earned + overtimeAmount + expenseAmount - advance) * 100) / 100;

    return {
      userId: u.UserID,
      name: u.Name,
      designation: u.Designation || '',
      role: asg.role || '',
      projectId: asg.projectId || summary.projectId || '',
      projectName: pmap[String(asg.projectId || summary.projectId)] ? pmap[String(asg.projectId || summary.projectId)].Name : '',
      salaryType: rate.salaryType,
      dailyWage: rate.dailyWage,
      monthlySalary: rate.monthlySalary,
      perDayRate: rate.perDayRate,
      presentDays: presentDays,
      lateMarks: t.late,
      halfDays: t.halfDay,
      paidLeaveDays: paidLeaveDays,
      travelDays: travelDays,
      holidayDays: t.holiday,
      weekOffDays: t.weekOff,
      unpaidLeaveDays: unpaidDays,
      absentDays: absentDays,
      flaggedDays: t.flagged,
      payableDays: payableDays,
      lopDays: lopDays,
      earned: earned,
      overtimeHours: overtimeHours,
      overtimeAmount: overtimeAmount,
      expenseAmount: expenseAmount,
      expenseIds: expenseIds,
      lopDeduction: lopDeduction,
      advance: advance,
      netPayable: netPayable,
      bankAccount: can_(ctx, 'viewAllEmployees') ? maskString_(u.BankAccount || '', 4) : '',
      ifscCode: can_(ctx, 'viewAllEmployees') ? (u.IfscCode || '') : '',
      mobile: u.MobileNumber || ''
    };
  });

  // Only employees with some activity or assignment appear.
  rows = rows.filter(function (r) {
    return r.payableDays > 0 || r.lopDays > 0 || r.overtimeHours > 0 || r.expenseAmount > 0 || r.projectId;
  });
  rows = sortBy_(rows, function (r) { return String(r.name); });

  var totals = {
    employees: rows.length,
    payableDays: round2_(rows.reduce(function (s, r) { return s + r.payableDays; }, 0)),
    lopDays: round2_(rows.reduce(function (s, r) { return s + r.lopDays; }, 0)),
    overtimeHours: round2_(rows.reduce(function (s, r) { return s + r.overtimeHours; }, 0)),
    earned: round2_(rows.reduce(function (s, r) { return s + r.earned; }, 0)),
    overtimeAmount: round2_(rows.reduce(function (s, r) { return s + r.overtimeAmount; }, 0)),
    expenseAmount: round2_(rows.reduce(function (s, r) { return s + r.expenseAmount; }, 0)),
    advances: round2_(rows.reduce(function (s, r) { return s + r.advance; }, 0)),
    netPayable: round2_(rows.reduce(function (s, r) { return s + r.netPayable; }, 0)),
    flaggedDays: rows.reduce(function (s, r) { return s + r.flaggedDays; }, 0)
  };

  // Optional vendor labour cost for the same month/project.
  var vendorLabour = null;
  if (payload.includeVendorLabour) {
    var vw = scopedRows_(ctx, readTable_(ss, 'VendorWorkers'), 'ProjectID')
      .filter(function (w) { return String(w.Date) >= bounds.from && String(w.Date) <= bounds.to; });
    if (projectId) vw = vw.filter(function (w) { return String(w.ProjectID) === projectId; });
    var vendorMap = indexBy_(readTable_(ss, 'Vendors'), 'VendorID');
    var byVendor = {};
    vw.forEach(function (w) {
      var k = String(w.VendorID);
      if (!byVendor[k]) byVendor[k] = { vendor: (vendorMap[k] || {}).VendorName || k, manDays: 0, amount: 0 };
      byVendor[k].manDays += num_(w.Count, 1);
      byVendor[k].amount += num_(w.AmountPayable, 0);
    });
    vendorLabour = {
      vendors: Object.keys(byVendor).map(function (k) {
        byVendor[k].amount = round2_(byVendor[k].amount);
        return byVendor[k];
      }),
      totalManDays: Object.keys(byVendor).reduce(function (s, k) { return s + byVendor[k].manDays; }, 0),
      totalAmount: round2_(Object.keys(byVendor).reduce(function (s, k) { return s + byVendor[k].amount; }, 0))
    };
    totals.grandTotal = round2_(totals.netPayable + (vendorLabour ? vendorLabour.totalAmount : 0));
  }

  return { month: month, bounds: bounds, rows: rows, totals: totals, vendorLabour: vendorLabour, filters: filters };
}

function round2_(n) { return Math.round(num_(n, 0) * 100) / 100; }

/** Report-shaped payroll (used by generateReport/exportReport type=payroll). */
function payrollReport_(payload, ctx) {
  var computed = payrollCompute_(payload, ctx);
  var settings = ctx.settings;
  var report = {
    type: 'payroll',
    title: 'Payroll-Ready Wage Sheet',
    subtitle: computed.month + (computed.filters.projectId ? ' — project ' + computed.filters.projectId : ' — all projects'),
    period: { from: computed.bounds.from, to: computed.bounds.to, month: computed.month },
    filters: computed.filters,
    company: companyBlock_(ctx, computed.filters),
    generatedAt: fmtDateTime_(new Date(), settings.timezone),
    generatedBy: ctx.userName + ' (' + ctx.userId + ')',
    footer: settings.reportFooterText || DEFAULT_SETTINGS.reportFooterText,
    currency: settings.currency || 'INR',
    columns: [
      { key: 'name', label: 'Employee' }, { key: 'userId', label: 'User ID' },
      { key: 'designation', label: 'Designation' }, { key: 'projectName', label: 'Project' },
      { key: 'salaryType', label: 'Pay type' }, { key: 'perDayRate', label: 'Rate/day' },
      { key: 'presentDays', label: 'Present' }, { key: 'halfDays', label: 'Half' },
      { key: 'paidLeaveDays', label: 'Paid leave' }, { key: 'holidayDays', label: 'Holiday' },
      { key: 'travelDays', label: 'Travel' }, { key: 'unpaidLeaveDays', label: 'Unpaid leave' },
      { key: 'absentDays', label: 'Absent' }, { key: 'payableDays', label: 'Payable days' },
      { key: 'lopDays', label: 'LOP days' }, { key: 'earned', label: 'Earned' },
      { key: 'overtimeHours', label: 'OT hours' }, { key: 'overtimeAmount', label: 'OT amount' },
      { key: 'expenseAmount', label: 'Approved expenses' }, { key: 'advance', label: 'Advance' },
      { key: 'netPayable', label: 'NET PAYABLE' }
    ],
    rows: computed.rows,
    totals: computed.totals,
    vendorLabour: computed.vendorLabour,
    rowCount: computed.rows.length,
    legend: {
      'Payable days': 'Present + half days (0.5) + paid leave + travel + paid holidays',
      'LOP days': 'Unpaid leave + absent (loss of pay)',
      'OT amount': 'OT hours × (rate/day ÷ standard hours) × overtime multiplier (' +
        num_(settings.overtimeRate, 1.5) + ')',
      'NET PAYABLE': 'Earned + OT + approved expenses − advances'
    }
  };
  return report;
}

function actionGeneratePayrollSheet(payload, ctx) {
  var ss = ctx.ss;
  var computed = payrollCompute_(payload, ctx);
  var settings = ctx.settings;

  // Optionally flip approved expenses to "AddedToSalary" once payroll is run.
  if (bool_(payload.confirmPayout, false)) {
    var expenseIds = [];
    computed.rows.forEach(function (r) { expenseIds = expenseIds.concat(r.expenseIds); });
    expenseIds.forEach(function (eid) {
      updateRecord_(ss, 'ExpenseRequests', 'ExpenseID', eid, {
        PayoutStatus: 'AddedToSalary', PaidOn: today_(ctx.tz)
      });
    });
    audit_(ss, ctx, 'PAYROLL_CONFIRMED', 'Payroll', computed.month,
      { employees: computed.rows.length, net: computed.totals.netPayable, expenses: expenseIds.length }, 'OK');
  } else {
    audit_(ss, ctx, 'GENERATE_PAYROLL', 'Payroll', computed.month,
      { employees: computed.rows.length, net: computed.totals.netPayable,
        project: computed.filters.projectId || 'all' }, 'OK');
  }

  return {
    month: computed.month,
    from: computed.bounds.from,
    to: computed.bounds.to,
    currency: settings.currency || 'INR',
    projectName: computed.filters.projectId
      ? ((projectMap_(ss)[computed.filters.projectId] || {}).Name || computed.filters.projectId) : 'All projects',
    employees: computed.rows,
    totals: computed.totals,
    vendorLabour: computed.vendorLabour,
    payoutConfirmed: bool_(payload.confirmPayout, false),
    notes: [
      'Flagged days are NOT counted as payable until an admin reviews them.',
      'Rates come from the employee record (daily wage or monthly salary ÷ ' +
        num_(settings.payrollDaysBasis || 26, 26) + ' payroll days).',
      'Approved expenses are added to net payable; confirm the run to mark them as AddedToSalary.'
    ]
  };
}
