/**
 * ============================================================================
 *  FILE: 14_Reports.gs
 *  ROLE: Reporting module (§7) — filtered report builders, Excel (.xlsx) and
 *        PDF export rendered with company logo, mandatory site address and
 *        optional client/PMC details. Every export is audit-logged (§10).
 * ============================================================================
 */

var REPORT_TYPES = [
  'monthlyAttendance', 'employeeHistory', 'dailyAttendance', 'leaveSummary',
  'expenseSummary', 'vendorManpower', 'payroll', 'flagged', 'projectSummary'
];

function actionGenerateReport(payload, ctx) {
  var type = str_(payload.type || payload.reportType, 40);
  assert_(REPORT_TYPES.indexOf(type) >= 0,
    'Unknown report type. Use one of: ' + REPORT_TYPES.join(', '), 400);
  var report = buildReport_(type, payload, ctx);
  if (type === 'payroll') report = payrollReport_(payload, ctx);
  audit_(ctx.ss, ctx, 'GENERATE_REPORT', 'Reports', type,
    { filters: report.filters, rows: report.rows.length }, 'OK');
  return report;
}

/** Normalise + validate the shared filter block. */
function reportFilters_(payload, ctx) {
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var month = /^\d{4}-\d{2}$/.test(str_(payload.month, 8)) ? str_(payload.month, 8) : '';
  var from = isIsoDate_(payload.from) ? payload.from : (month ? monthBounds_(month).from : shiftDate_(today_(tz), -29));
  var to = isIsoDate_(payload.to) ? payload.to : (month ? monthBounds_(month).to : today_(tz));
  assert_(to >= from, 'To-date cannot be before from-date', 400);
  assert_(daysBetween_(from, to) <= 366, 'Limit the report range to 366 days', 400);

  var projectId = str_(payload.projectId, 40);
  if (projectId) assertProjectScope_(ctx, projectId);

  var userId = str_(payload.userId, 40);
  if (userId && String(ctx.role) === ROLES.EMPLOYEE && userId !== ctx.userId) {
    throw new ApiError_('You can only report on yourself', 403);
  }
  return {
    month: month || monthKey_(from), from: from, to: to, projectId: projectId,
    userId: userId, status: str_(payload.status, 40),
    includeClientPmc: String(settings.reportIncludeClientPmc || 'Y').toUpperCase() === 'Y',
    includeLogo: String(settings.reportIncludeLogo || 'Y').toUpperCase() === 'Y'
  };
}

/** Employees visible to this caller, optionally narrowed to one project. */
function reportUsers_(ss, ctx, filters) {
  var users = readTable_(ss, 'Users').filter(function (u) { return String(u.Status) !== 'Inactive'; });
  var assignments = readTable_(ss, 'ProjectAssignments');
  var byUser = {};
  assignments.forEach(function (a) {
    var k = String(a.UserID);
    if (!byUser[k]) byUser[k] = [];
    byUser[k].push({
      projectId: String(a.ProjectID), status: String(a.Status), role: a.RoleOnSite,
      from: a.AssignedFrom, to: a.AssignedTo, DailyWage: a.DailyWage, ShiftID: a.ShiftID
    });
  });
  users = users.filter(function (u) {
    var asg = byUser[String(u.UserID)] || [];
    if (filters.projectId) {
      return asg.some(function (a) {
        return a.projectId === filters.projectId &&
          (a.status === 'Active' || (a.from <= filters.to && (!a.to || a.to >= filters.from)));
      });
    }
    if (!scopeIsAll_(ctx) && !can_(ctx, 'viewAllEmployees')) {
      return asg.some(function (a) { return inScope_(ctx, a.projectId); });
    }
    return true;
  });
  if (filters.userId) users = users.filter(function (u) { return String(u.UserID) === filters.userId; });
  if (String(ctx.role) === ROLES.EMPLOYEE) users = users.filter(function (u) { return String(u.UserID) === ctx.userId; });
  return { users: sortBy_(users, function (u) { return String(u.Name); }), assignmentsByUser: byUser };
}

function buildReport_(type, payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var filters = reportFilters_(payload, ctx);
  var pmap = projectMap_(ss);
  var umap = userMap_(ss);
  var report = {
    type: type,
    title: '',
    subtitle: '',
    period: { from: filters.from, to: filters.to, month: filters.month },
    filters: filters,
    columns: [],
    rows: [],
    totals: {},
    company: companyBlock_(ctx, filters),
    generatedAt: fmtDateTime_(new Date(), settings.timezone),
    generatedBy: ctx.userName + ' (' + ctx.userId + ')',
    footer: settings.reportFooterText || DEFAULT_SETTINGS.reportFooterText,
    currency: settings.currency || 'INR'
  };

  var attendance = scopedRows_(ctx, readTable_(ss, 'Attendance'), 'ProjectID')
    .filter(function (a) { return String(a.Date) >= filters.from && String(a.Date) <= filters.to; });
  if (filters.projectId) attendance = attendance.filter(function (a) { return String(a.ProjectID) === filters.projectId; });
  if (filters.userId) attendance = attendance.filter(function (a) { return String(a.UserID) === filters.userId; });
  if (filters.status) {
    var st = filters.status.split(',');
    attendance = attendance.filter(function (a) { return st.indexOf(String(a.Status)) >= 0; });
  }

  if (type === 'monthlyAttendance') {
    var sel = reportUsers_(ss, ctx, filters);
    var dates = dateRange_(filters.from, filters.to);
    report.title = 'Monthly Attendance Sheet';
    report.subtitle = (filters.projectId ? (pmap[filters.projectId] || {}).Name + ' — ' : 'All projects — ') +
      filters.month;
    report.columns = [{ key: 'employee', label: 'Employee' }, { key: 'userId', label: 'User ID' },
      { key: 'role', label: 'Site Role' }, { key: 'project', label: 'Project' }]
      .concat(dates.map(function (d) { return { key: d, label: d.substring(8) + '/' + d.substring(5, 7) }; }))
      .concat([
        { key: 'present', label: 'P' }, { key: 'late', label: 'L' }, { key: 'half', label: 'H' },
        { key: 'absent', label: 'A' }, { key: 'leave', label: 'LV' }, { key: 'unpaid', label: 'UL' },
        { key: 'ot', label: 'OT(h)' }, { key: 'hours', label: 'Hours' }
      ]);
    report.dateColumns = dates;
    sel.users.forEach(function (u) {
      var summary = monthlySummaryFor_(ss, ctx, u.UserID, filters.month, settings);
      var asg = (sel.assignmentsByUser[String(u.UserID)] || [])
        .filter(function (a) { return !filters.projectId || a.projectId === filters.projectId; })[0] || {};
      var codes = {};
      summary.days.forEach(function (d) { codes[d.date] = d.code; });
      var row = {
        employee: u.Name, userId: u.UserID, role: asg.role || u.Designation || '',
        project: pmap[asg.projectId || summary.projectId] ? (pmap[asg.projectId || summary.projectId].Name || '') : '',
        present: summary.totals.present, late: summary.totals.late, half: summary.totals.halfDay,
        absent: summary.totals.absent,
        leave: summary.totals.paidLeave + summary.totals.sickLeave + summary.totals.casualLeave,
        unpaid: summary.totals.unpaidLeave,
        ot: summary.totals.overtimeHours, hours: summary.totals.hoursWorked
      };
      dates.forEach(function (d) { row[d] = codes[d] || ''; });
      report.rows.push(row);
    });
    report.legend = {
      P: 'Present', L: 'Late', H: 'Half day', A: 'Absent', LV: 'Paid leave', SL: 'Sick leave',
      CL: 'Casual leave', UL: 'Unpaid leave', T: 'Travel day', TR: 'Transfer', HD: 'Holiday',
      WO: 'Week off', F: 'Flagged (pending review)'
    };
    report.totals = {
      employees: report.rows.length,
      present: report.rows.reduce(function (s, r) { return s + num_(r.present, 0); }, 0),
      absent: report.rows.reduce(function (s, r) { return s + num_(r.absent, 0); }, 0),
      overtime: Math.round(report.rows.reduce(function (s, r) { return s + num_(r.ot, 0); }, 0) * 10) / 10
    };
  }

  if (type === 'employeeHistory') {
    assert_(filters.userId, 'Select an employee for the history report', 400);
    var u = umap[filters.userId] || {};
    report.title = 'Employee Attendance History';
    report.subtitle = (u.Name || filters.userId) + ' — ' + filters.from + ' to ' + filters.to;
    report.columns = [
      { key: 'date', label: 'Date' }, { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status' }, { key: 'in', label: 'Check-in' },
      { key: 'out', label: 'Check-out' }, { key: 'hours', label: 'Hours' },
      { key: 'ot', label: 'OT (h)' }, { key: 'distance', label: 'Distance (m)' },
      { key: 'source', label: 'Source' }, { key: 'late', label: 'Late' },
      { key: 'review', label: 'Reviewed by / note' }
    ];
    sortBy_(attendance, function (a) { return String(a.Date); }, false).forEach(function (a) {
      report.rows.push({
        date: a.Date, project: (pmap[String(a.ProjectID)] || {}).Name || a.ProjectID,
        status: a.Status, in: String(a.MarkedAt || '').substring(11, 19),
        out: String(a.MarkedOutAt || '').substring(11, 19),
        hours: num_(a.HoursWorked, ''), ot: num_(a.OvertimeHours, ''),
        distance: a.DistanceFromSite === '' ? '' : num_(a.DistanceFromSite, ''),
        source: a.Source || '', late: a.LateMark === 'Y' ? 'Y' : '',
        review: [a.ReviewedBy || '', a.ReviewNote || a.FlagReason || ''].filter(function (x) { return x; }).join(' — ')
      });
    });
    var summary = monthlySummaryFor_(ss, ctx, filters.userId, filters.month, settings);
    report.totals = summary.totals;
    report.employee = {
      userId: u.UserID, name: u.Name, role: u.Role, designation: u.Designation,
      mobile: u.MobileNumber, joinedAt: u.JoinedAt
    };
  }

  if (type === 'dailyAttendance') {
    report.title = 'Daily Attendance Register';
    report.subtitle = filters.from + (filters.from === filters.to ? '' : ' to ' + filters.to);
    report.columns = [
      { key: 'date', label: 'Date' }, { key: 'employee', label: 'Employee' },
      { key: 'userId', label: 'User ID' }, { key: 'project', label: 'Project' },
      { key: 'siteAddress', label: 'Site address' }, { key: 'status', label: 'Status' },
      { key: 'in', label: 'Check-in' }, { key: 'out', label: 'Check-out' },
      { key: 'distance', label: 'Distance (m)' }, { key: 'lat', label: 'Lat' },
      { key: 'lng', label: 'Long' }, { key: 'source', label: 'Source' },
      { key: 'selfie', label: 'Selfie' }
    ];
    sortBy_(attendance, function (a) { return String(a.Date) + String(a.MarkedAt); }, true).forEach(function (a) {
      var p = pmap[String(a.ProjectID)] || {};
      report.rows.push({
        date: a.Date, employee: (umap[String(a.UserID)] || {}).Name || a.UserID,
        userId: a.UserID, project: p.Name || a.ProjectID, siteAddress: p.Address || '',
        status: a.Status, in: String(a.MarkedAt || '').substring(11, 19),
        out: String(a.MarkedOutAt || '').substring(11, 19),
        distance: a.DistanceFromSite === '' ? '' : num_(a.DistanceFromSite, ''),
        lat: num_(a.Lat, ''), lng: num_(a.Long, ''), source: a.Source || '',
        selfie: a.SelfieDriveLink ? 'yes' : ''
      });
    });
    report.totals = { records: report.rows.length };
  }

  if (type === 'flagged') {
    report.title = 'Flagged Attendance — Review Log';
    report.subtitle = filters.from + ' to ' + filters.to;
    report.columns = [
      { key: 'date', label: 'Date' }, { key: 'employee', label: 'Employee' },
      { key: 'mobile', label: 'Mobile' }, { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status' }, { key: 'distance', label: 'Distance (m)' },
      { key: 'radius', label: 'Geofence (m)' }, { key: 'reason', label: 'Reason' },
      { key: 'source', label: 'Source' }, { key: 'reviewedBy', label: 'Reviewed by' },
      { key: 'reviewNote', label: 'Review note' }
    ];
    readTable_(ss, 'Attendance')
      .filter(function (a) {
        return String(a.Date) >= filters.from && String(a.Date) <= filters.to &&
          (!filters.projectId || String(a.ProjectID) === filters.projectId) &&
          (String(a.Status) === 'Flagged' || String(a.ReviewedBy) !== '');
      })
      .forEach(function (a) {
        var p = pmap[String(a.ProjectID)] || {};
        var u = umap[String(a.UserID)] || {};
        report.rows.push({
          date: a.Date, employee: u.Name || a.UserID, mobile: u.MobileNumber || '',
          project: p.Name || '', status: a.Status,
          distance: a.DistanceFromSite === '' ? '' : num_(a.DistanceFromSite, ''),
          radius: num_(p.GeofenceRadius, ''), reason: a.FlagReason || '',
          source: a.Source || '', reviewedBy: a.ReviewedBy || '', reviewNote: a.ReviewNote || ''
        });
      });
    report.rows = sortBy_(report.rows, function (r) { return String(r.date); }, true);
    report.totals = { records: report.rows.length };
  }

  if (type === 'leaveSummary') {
    report.title = 'Leave Summary Report';
    report.subtitle = filters.from + ' to ' + filters.to;
    report.columns = [
      { key: 'employee', label: 'Employee' }, { key: 'userId', label: 'User ID' },
      { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'days', label: 'Days' },
      { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' }, { key: 'approvedBy', label: 'Approved by' },
      { key: 'applied', label: 'Applied at' }
    ];
    var leaves = readTable_(ss, 'LeaveRequests').filter(function (l) {
      return String(l.ToDate) >= filters.from && String(l.FromDate) <= filters.to;
    });
    leaves = scopedUsers_(ss, ctx, leaves);
    if (filters.userId) leaves = leaves.filter(function (l) { return String(l.UserID) === filters.userId; });
    sortBy_(leaves, function (l) { return String(l.AppliedAt); }, true).forEach(function (l) {
      report.rows.push({
        employee: (umap[String(l.UserID)] || {}).Name || l.UserID, userId: l.UserID,
        from: l.FromDate, to: l.ToDate, days: num_(l.Days, daysBetween_(l.FromDate, l.ToDate)),
        type: l.Type, status: l.Status, reason: l.Reason || '',
        approvedBy: l.ApprovedBy || '', applied: l.AppliedAt || ''
      });
    });
    var byType = {};
    report.rows.forEach(function (r) {
      if (String(r.status) !== 'Approved') return;
      byType[r.type] = num_(byType[r.type], 0) + num_(r.days, 0);
    });
    report.totals = { requests: report.rows.length, approvedDaysByType: byType,
      approvedDays: Object.keys(byType).reduce(function (s, k) { return s + byType[k]; }, 0) };
  }

  if (type === 'expenseSummary') {
    report.title = 'Expense Summary Report (payroll add-on)';
    report.subtitle = filters.from + ' to ' + filters.to;
    report.columns = [
      { key: 'date', label: 'Applied' }, { key: 'employee', label: 'Employee' },
      { key: 'project', label: 'Project' }, { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' }, { key: 'payout', label: 'Payout' },
      { key: 'approvedBy', label: 'Approved by' }, { key: 'proof', label: 'Proof' }
    ];
    var expenses = scopedRows_(ctx, readTable_(ss, 'ExpenseRequests'), 'ProjectID')
      .filter(function (x) { return String(x.AppliedAt) >= filters.from; });
    if (filters.projectId) expenses = expenses.filter(function (x) { return String(x.ProjectID) === filters.projectId; });
    if (filters.userId) expenses = expenses.filter(function (x) { return String(x.UserID) === filters.userId; });
    sortBy_(expenses, function (x) { return String(x.AppliedAt); }, true).forEach(function (x) {
      report.rows.push({
        date: String(x.AppliedAt || '').substring(0, 10),
        employee: (umap[String(x.UserID)] || {}).Name || x.UserID,
        project: (pmap[String(x.ProjectID)] || {}).Name || x.ProjectID || '',
        category: x.Category, description: x.Description || '', amount: num_(x.Amount, 0),
        status: x.Status, payout: x.PayoutStatus || 'Pending', approvedBy: x.ApprovedBy || '',
        proof: x.ProofDriveLink ? 'yes' : ''
      });
    });
    report.totals = {
      claims: report.rows.length,
      approved: report.rows.filter(function (r) { return r.status === 'Approved'; }).length,
      approvedAmount: Math.round(report.rows.filter(function (r) { return r.status === 'Approved'; })
        .reduce(function (s, r) { return s + num_(r.amount, 0); }, 0) * 100) / 100,
      pendingAmount: Math.round(report.rows.filter(function (r) { return r.status === 'Pending'; })
        .reduce(function (s, r) { return s + num_(r.amount, 0); }, 0) * 100) / 100,
      byCategory: (function () {
        var m = {};
        report.rows.filter(function (r) { return r.status === 'Approved'; }).forEach(function (r) {
          m[r.category] = Math.round((num_(m[r.category], 0) + num_(r.amount, 0)) * 100) / 100;
        });
        return m;
      })()
    };
  }

  if (type === 'vendorManpower') {
    var vr = actionVendorManpowerReport({ from: filters.from, to: filters.to, projectId: filters.projectId,
      groupBy: payload.groupBy || 'vendor' }, ctx);
    report.title = 'Vendor Manpower Report';
    report.subtitle = filters.from + ' to ' + filters.to;
    report.columns = [{ key: 'vendor', label: vr.groupBy === 'project' ? 'Project' : 'Vendor' },
      { key: 'contact', label: 'Contact' }, { key: 'mobile', label: 'Mobile' }]
      .concat(vr.dates.map(function (d) { return { key: d, label: d.substring(8) + '/' + d.substring(5, 7) }; }))
      .concat([{ key: 'total', label: 'Total man-days' }, { key: 'average', label: 'Avg/day' },
        { key: 'amount', label: 'Amount payable' }]);
    report.dateColumns = vr.dates;
    vr.groups.forEach(function (g) {
      var row = { vendor: g.label, contact: g.contact || '', mobile: g.mobile || '',
        total: g.total, average: g.average, amount: g.amount };
      vr.dates.forEach(function (d) { row[d] = g.byDate[d] || 0; });
      report.rows.push(row);
    });
    report.totals = { vendors: vr.vendorCount, manDays: vr.totalHeadcount, amount: vr.totalAmount };
  }

  if (type === 'projectSummary') {
    report.title = 'Project-wise Attendance Summary';
    report.subtitle = filters.from + ' to ' + filters.to;
    report.columns = [
      { key: 'project', label: 'Project' }, { key: 'code', label: 'Code' },
      { key: 'siteAddress', label: 'Site address' }, { key: 'client', label: 'Client' },
      { key: 'pmc', label: 'PMC' }, { key: 'headcount', label: 'Assigned' },
      { key: 'present', label: 'Present man-days' }, { key: 'absent', label: 'Absent' },
      { key: 'leave', label: 'Leave' }, { key: 'flagged', label: 'Flagged' },
      { key: 'ot', label: 'OT hours' }, { key: 'avg', label: 'Avg daily %' }
    ];
    scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID').forEach(function (p) {
      var marks = attendance.filter(function (a) { return String(a.ProjectID) === String(p.ProjectID); });
      var team = readTable_(ss, 'ProjectAssignments')
        .filter(function (a) { return String(a.ProjectID) === String(p.ProjectID) && String(a.Status) === 'Active'; });
      var days = dateRange_(filters.from, filters.to).length || 1;
      var present = marks.filter(function (m) {
        return ['Present', 'Late', 'HalfDay'].indexOf(String(m.Status)) >= 0;
      }).length;
      report.rows.push({
        project: p.Name, code: p.ProjectCode, siteAddress: p.Address || '',
        client: p.ClientName || '', pmc: p.PMCName || '', headcount: team.length,
        present: present,
        absent: marks.filter(function (m) { return String(m.Status) === 'Absent'; }).length,
        leave: marks.filter(function (m) { return String(m.Status) === 'Leave'; }).length,
        flagged: marks.filter(function (m) { return String(m.Status) === 'Flagged'; }).length,
        ot: Math.round(marks.reduce(function (s, m) { return s + num_(m.OvertimeHours, 0); }, 0) * 10) / 10,
        avg: team.length ? Math.round((present / (team.length * days)) * 100) : 0
      });
    });
    report.totals = { projects: report.rows.length };
  }

  report.rowCount = report.rows.length;
  return report;
}

/** Header block printed on every export (§7: site address is mandatory). */
function companyBlock_(ctx, filters) {
  var settings = ctx.settings;
  var ss = ctx.ss;
  var projects = filters && filters.projectId
    ? [findRecord_(ss, 'Projects', 'ProjectID', filters.projectId)].filter(function (p) { return p; })
    : scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID').slice(0, 12);
  return {
    companyName: settings.companyName || ctx.company.CompanyName,
    companyId: ctx.company.CompanyID,
    logoLink: filters && filters.includeLogo ? (settings.companyLogoLink || '') : '',
    address: settings.companyAddress || '',           // MANDATORY on every export
    gst: settings.gst || '',
    industry: settings.industryType || '',
    timezone: settings.timezone || platformTimezone_(),
    sites: projects.map(function (p) {
      var site = { name: p.Name, code: p.ProjectCode, address: p.Address || '',
        lat: num_(p.Lat, 0), lng: num_(p.Long, 0) };
      if (filters && filters.includeClientPmc) {
        site.client = p.ClientName || ''; site.clientContact = p.ClientContact || '';
        site.pmc = p.PMCName || ''; site.pmcContact = p.PMCContact || '';
      }
      return site;
    })
  };
}

/* -------------------------------------------------------------------------- */
/*  Export (XLSX / PDF)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Render a report into a temporary spreadsheet, then export it as .xlsx or .pdf
 * through Google's own export endpoint (no paid API needed), upload the result
 * to the company's private Reports folder and return a download link.
 */
function actionExportReport(payload, ctx) {
  var format = String(payload.format || 'xlsx').toLowerCase();
  assert_(['xlsx', 'pdf', 'csv'].indexOf(format) >= 0, 'format must be xlsx, pdf or csv', 400);

  var type = str_(payload.type || payload.reportType, 40);
  assert_(REPORT_TYPES.indexOf(type) >= 0, 'Unknown report type: ' + type, 400);
  var report = type === 'payroll' ? payrollReport_(payload, ctx) : buildReport_(type, payload, ctx);

  var settings = ctx.settings;
  var fileName = 'SiteTrack-' + report.type + '-' + report.period.from + '_' + report.period.to +
    '-' + shortId_(4);
  var bytes = null;
  var mime = format === 'pdf' ? 'application/pdf'
    : (format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  var tempId = '';

  try {
    var temp = SpreadsheetApp.create(fileName);
    tempId = temp.getId();
    try { temp.setSpreadsheetTimeZone(settings.timezone || platformTimezone_()); } catch (e) { }
    renderReportToSpreadsheet_(temp, report, ctx, settings);

    if (format === 'csv') {
      var sh = temp.getSheets()[0];
      var values = sh.getDataRange().getValues();
      var csv = values.map(function (row) {
        return row.map(function (cell) {
          var s = String(cell === null || typeof cell === 'undefined' ? '' : cell);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
      }).join('\n');
      bytes = Utilities.newBlob(csv, 'text/csv', fileName + '.csv').getBytes();
    } else {
      var url = 'https://docs.google.com/spreadsheets/export?id=' + temp.getId() + '&format=' + format;
      if (format === 'pdf') {
        url += '&portrait=false&paperSize=A4&fitw=true&size=A4&fzr=false&fzc=false&gid=' +
          temp.getSheets()[0].getSheetId();
      }
      var token = '';
      try { token = ScriptApp.getOAuthToken(); } catch (e2) { token = ''; }
      var opts = { muteHttpExceptions: true };
      if (token) opts.headers = { Authorization: 'Bearer ' + token };
      var res = UrlFetchApp.fetch(url, opts);
      if (res.getResponseCode() !== 200) {
        throw new ApiError_('Google export failed (HTTP ' + res.getResponseCode() +
          '). Use the on-screen report and Print → Save as PDF instead.', 502);
      }
      bytes = res.getBlob().getBytes();
    }
  } finally {
    if (tempId) { try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e3) { } }
  }

  assert_(bytes && bytes.length, 'Export produced an empty file', 500);

  var folder = companySubFolder_(ctx.company, 'Reports', true);
  var fileId = '', link = '';
  if (folder) {
    var ext = format === 'pdf' ? '.pdf' : (format === 'csv' ? '.csv' : '.xlsx');
    var file = folder.createFile(Utilities.newBlob(bytes, mime, fileName + ext));
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e4) { }
    fileId = file.getId();
    link = 'https://drive.google.com/uc?export=download&id=' + fileId;
  }

  audit_(ctx.ss, ctx, 'EXPORT_REPORT', 'Reports', report.type,
    { format: format, rows: report.rowCount, period: report.period.from + '..' + report.period.to,
      projectId: report.filters.projectId || 'all', fileId: fileId, bytes: bytes.length }, 'OK');

  return {
    fileName: fileName + (format === 'pdf' ? '.pdf' : (format === 'csv' ? '.csv' : '.xlsx')),
    format: format,
    bytes: bytes.length,
    fileId: fileId,
    downloadUrl: link,
    // Included so a GitHub-Pages frontend can trigger the download directly
    // without needing Drive access.
    dataUrl: bytes.length <= 6 * 1024 * 1024
      ? 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes) : '',
    title: report.title,
    subtitle: report.subtitle,
    rowCount: report.rowCount,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy
  };
}

/** Write the branded header block + data table into a spreadsheet. */
function renderReportToSpreadsheet_(temp, report, ctx, settings) {
  var sh = temp.getSheets()[0];
  sh.setName(report.title.substring(0, 90));
  var columns = report.columns || [];
  var width = Math.max(columns.length, 6);
  var r = 1;

  function put(row, values, bold) {
    var line = [];
    for (var i = 0; i < width; i++) line.push(values[i] === undefined ? '' : values[i]);
    sh.getRange(row, 1, 1, width).setValues([line]);
    if (bold) { try { sh.getRange(row, 1, 1, width).setFontWeight('bold'); } catch (e) { } }
    return row + 1;
  }

  r = put(r, [report.company.companyName], true);
  r = put(r, [report.title + ' — ' + report.subtitle]);
  // MANDATORY: site address on every export (§7)
  r = put(r, ['Registered address: ' + (report.company.address || 'not set')]);
  if (report.company.gst) r = put(r, ['GST / Reg. no: ' + report.company.gst]);
  r = put(r, ['Period: ' + report.period.from + ' to ' + report.period.to +
    (report.period.month ? '  (month ' + report.period.month + ')' : '')]);
  r = put(r, ['Company ID: ' + report.company.companyId + '   Timezone: ' + report.company.timezone]);

  if (report.company.sites && report.company.sites.length) {
    r = put(r, ['Sites covered:'], true);
    report.company.sites.forEach(function (s) {
      var line = '  • ' + s.name + ' (' + s.code + ') — ' + (s.address || 'address not set') +
        '  [' + s.lat + ', ' + s.lng + ']';
      if (s.client) line += '  Client: ' + s.client + (s.clientContact ? ' / ' + s.clientContact : '');
      if (s.pmc) line += '  PMC: ' + s.pmc + (s.pmcContact ? ' / ' + s.pmcContact : '');
      r = put(r, [line]);
    });
  }
  r = put(r, ['Generated by: ' + report.generatedBy + ' at ' + report.generatedAt]);
  r++;

  // Column headers
  r = put(r, columns.map(function (c) { return c.label; }), true);
  try { sh.setFrozenRows(r - 1); } catch (e) { }

  var keys = columns.map(function (c) { return c.key; });
  var dataRows = report.rows.map(function (row) {
    return keys.map(function (k) {
      var v = row[k];
      if (v === null || typeof v === 'undefined') return '';
      if (typeof v === 'object') return jsonString_(v);
      return v;
    });
  });
  if (dataRows.length) {
    // Sheets accepts up to ~10k cells per write comfortably; chunk to be safe.
    chunk_(dataRows, 200).forEach(function (block) {
      var startRow = r;
      sh.getRange(startRow, 1, block.length, width).setValues(block.map(function (row) {
        var line = [];
        for (var i = 0; i < width; i++) line.push(row[i] === undefined ? '' : row[i]);
        return line;
      }));
      r = startRow + block.length;
    });
  } else {
    r = put(r, ['No records matched these filters']);
  }

  r++;
  r = put(r, ['Summary'], true);
  Object.keys(report.totals || {}).forEach(function (k) {
    var v = report.totals[k];
    r = put(r, ['  ' + k + ': ' + (typeof v === 'object' ? jsonString_(v) : v)]);
  });
  if (report.legend) {
    r = put(r, ['Legend'], true);
    Object.keys(report.legend).forEach(function (k) { r = put(r, ['  ' + k + ' = ' + report.legend[k]]); });
  }
  r++;
  r = put(r, [report.footer || '']);
  r = put(r, ['This is a system-generated, GPS-verified record. Tampering with attendance data is logged.']);

  try {
    sh.autoResizeColumns(1, Math.min(width, 30));
  } catch (e) { }
  return sh;
}

function actionListAuditLog(payload, ctx) {
  var ss = ctx.ss;
  var rows = readTable_(ss, 'AuditLog');
  var q = str_(payload.query, 60).toLowerCase();
  var action = str_(payload.action, 60);
  var userId = str_(payload.userId, 40);
  if (action) rows = rows.filter(function (r) { return String(r.Action) === action; });
  if (userId) rows = rows.filter(function (r) { return String(r.ActorUserID) === userId; });
  if (q) {
    rows = rows.filter(function (r) {
      return (String(r.Action) + String(r.Details) + String(r.ActorName) + String(r.TargetEntity))
        .toLowerCase().indexOf(q) >= 0;
    });
  }
  if (isIsoDate_(payload.from)) rows = rows.filter(function (r) { return String(r.Timestamp) >= payload.from; });
  if (isIsoDate_(payload.to)) rows = rows.filter(function (r) { return String(r.Timestamp) <= payload.to + ' 23:59:59'; });
  rows = sortBy_(rows, function (r) { return String(r.Timestamp); }, true);
  var limit = Math.min(Math.max(num_(payload.limit, 300), 1), 2000);
  return {
    count: rows.length,
    entries: rows.slice(0, limit).map(function (r) {
      return {
        logId: r.LogID, at: r.Timestamp, action: r.Action, entity: r.TargetEntity,
        entityId: r.EntityID || '', actorId: r.ActorUserID, actorName: r.ActorName || '',
        actorRole: r.ActorRole || '', details: r.Details || '', result: r.Result || 'OK'
      };
    })
  };
}
