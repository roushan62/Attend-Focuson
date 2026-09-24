/**
 * ============================================================================
 *  FocusHR  —  Reports.gs
 *  A single reporting engine: every report is described once (columns, rows,
 *  totals, chart) and can be viewed on screen or downloaded as CSV.
 * ============================================================================
 */

var Reports = {

  /* ======================================================= the catalogue = */
  DEFINITIONS: [
    { code: 'attendance_register', name: 'Attendance register', group: 'Attendance', icon: 'calendar-check',
      desc: 'Day by day punch record with worked hours, late marks and overtime.', filters: ['range', 'project', 'department', 'employee'] },
    { code: 'attendance_summary', name: 'Attendance summary', group: 'Attendance', icon: 'clipboard-list',
      desc: 'Present, absent, leave, weekly offs and overtime per employee for any period.', filters: ['range', 'project', 'department', 'employee'] },
    { code: 'overtime_report', name: 'Overtime report', group: 'Attendance', icon: 'clock',
      desc: 'Overtime hours approved through punches, employee and project wise.', filters: ['range', 'project', 'department'] },
    { code: 'late_early_report', name: 'Late coming & early going', group: 'Attendance', icon: 'alarm',
      desc: 'Late arrivals and early departures against each shift.', filters: ['range', 'project', 'department'] },
    { code: 'headcount', name: 'Headcount by department', group: 'People', icon: 'users',
      desc: 'Active and exited people, split by department, branch and employment type.', filters: ['status'] },
    { code: 'employee_master', name: 'Employee master list', group: 'People', icon: 'id-card',
      desc: 'Every employee record with contact, statutory and bank fields (masked).', filters: ['status', 'department', 'project'] },
    { code: 'project_roster', name: 'Project roster', group: 'People', icon: 'hard-hat',
      desc: 'Who is deployed on which site, with role on site and daily wage.', filters: ['project', 'status'] },
    { code: 'transfer_report', name: 'Transfers & movements', group: 'People', icon: 'arrow-right-left',
      desc: 'Project transfer requests with decisions.', filters: ['range', 'status'] },
    { code: 'leave_balances', name: 'Leave balances', group: 'Leave', icon: 'wall-clock',
      desc: 'Opening, accrued, used and closing leave balance per employee.', filters: ['fy', 'department'] },
    { code: 'leave_register', name: 'Leave register', group: 'Leave', icon: 'calendar-days',
      desc: 'Leave applications with status, days and decisions.', filters: ['range', 'fy', 'status', 'department'] },
    { code: 'expense_register', name: 'Expense claims register', group: 'Expense', icon: 'receipt',
      desc: 'Every claim with category, amount, approval and payment status.', filters: ['range', 'status', 'department'] },
    { code: 'expense_summary', name: 'Expense summary', group: 'Expense', icon: 'chart-pie',
      desc: 'Category and month wise expense totals with reimbursement amount.', filters: ['range', 'department', 'project'] },
    { code: 'payroll_summary', name: 'Payroll cost summary', group: 'Payroll', icon: 'wallet', perm: 'payroll.view',
      desc: 'Month wise gross, deductions, net payout and employer cost for the year.', filters: ['fy'], chart: 'line' },
    { code: 'payroll_register', name: 'Salary register', group: 'Payroll', icon: 'table', perm: 'payroll.view',
      desc: 'Printable salary register for a payroll month, employee by employee.', filters: ['month', 'fy', 'department', 'project'], chart: 'none' },
    { code: 'pf_statement', name: 'PF statement (12%)', group: 'Statutory', icon: 'landmark', perm: 'payroll.view',
      desc: 'Provident fund employee and employer share for the month — ready for the portal.', filters: ['month', 'fy'], chart: 'bar' },
    { code: 'esic_statement', name: 'ESIC statement', group: 'Statutory', icon: 'shield', perm: 'payroll.view',
      desc: 'ESIC contribution for eligible employees (0.75% + 3.25%).', filters: ['month', 'fy'], chart: 'bar' },
    { code: 'pt_statement', name: 'Professional tax statement', group: 'Statutory', icon: 'stamp', perm: 'payroll.view',
      desc: 'State wise professional tax deducted for the month.', filters: ['month', 'fy'] },
    { code: 'tds_statement', name: 'TDS statement', group: 'Statutory', icon: 'percent', perm: 'payroll.view',
      desc: 'TDS deducted per employee with PAN — the base for Form 24Q.', filters: ['month', 'fy', 'employee'] },
    { code: 'compliance_summary', name: 'Statutory compliance summary', group: 'Statutory', icon: 'scale', perm: 'payroll.view',
      desc: 'PF, ESIC, professional tax and TDS grouped by month with totals.', filters: ['fy'], chart: 'bar' },
    { code: 'salary_cost_by_project', name: 'Salary cost by project', group: 'Payroll', icon: 'building', perm: 'payroll.view',
      desc: 'Man days, salary cost and cost per man day for each project.', filters: ['month', 'fy', 'project'], chart: 'bar' },
    { code: 'document_expiry', name: 'Document expiry watchlist', group: 'Compliance', icon: 'file-warning',
      desc: 'Licences, certificates and employee documents that expire soon or have expired.', filters: ['range'] }
  ],

  defs_: function () {
    var map = {};
    Reports.DEFINITIONS.forEach(function (d) { map[d.code] = d; });
    return map;
  },

  catalog: function (ctx) {
    Perm.require(ctx, 'reports.view');
    var canPayroll = Perm.has(ctx, 'payroll.view');
    var reports = Reports.DEFINITIONS.filter(function (d) {
      return !d.perm || Perm.has(ctx, d.perm);
    }).map(function (d) {
      return {
        code: d.code, name: d.name, group: d.group, desc: d.desc, filters: d.filters || [],
        chart: d.chart || '', permissions_ok: !d.perm || Perm.has(ctx, d.perm)
      };
    });
    var groups = [];
    reports.forEach(function (r) { if (groups.indexOf(r.group) < 0) groups.push(r.group); });
    return {
      reports: reports, groups: groups,
      can_export: Perm.has(ctx, 'reports.export'),
      payroll_locked: !canPayroll,
      note: canPayroll ? '' : 'Statutory and salary reports need the "View payroll" permission. Ask your admin for access.',
      months: Reports.monthOptions_(), fys: Leave.fyOptions_(),
      projects: Projects.options_ ? Projects.options_(ctx) : [],
      departments: Reports.departmentOptions_(ctx)
    };
  },

  monthOptions_: function () {
    var out = [];
    var cursor = monthOfIso_(todayIso_());
    for (var i = 0; i < 24; i++) {
      out.push({ value: cursor, label: monthLabel_(cursor) });
      cursor = Reports.shiftMonth_(cursor, -1);
    }
    return out;
  },

  shiftMonth_: function (month, delta) {
    var y = intVal_(txt_(month).slice(0, 4));
    var m = intVal_(txt_(month).slice(5, 7)) + delta;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + (m < 10 ? '0' + m : '' + m);
  },

  departmentOptions_: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var seen = [];
    Db.all(c, 'Employees').forEach(function (e) {
      var d = txt_(e.department);
      if (d && seen.indexOf(d) < 0) seen.push(d);
    });
    return seen.sort();
  },

  /* ============================================================== period = */
  period_: function (payload) {
    var today = todayIso_();
    var p = payload || {};
    var fy = txt_(p.fy) || fyOf_(today);
    var startYear = fyStartYear_(fy);
    var first = startYear + '-04';
    var last = (startYear + 1) + '-03';
    var month = txt_(p.month);
    if (!month) {
      var cur = monthOfIso_(today);
      if (cur >= first && cur <= last) month = cur;
      else month = today < monthStart_(first) ? first : last;
    }
    var from = txt_(p.from) || monthStart_(month);
    var to = txt_(p.to) || monthEnd_(month);
    if (from > to) { var t = from; from = to; to = t; }
    return {
      from: from, to: to, month: month, fy: fy,
      month_label: monthLabel_(month),
      label: fmtDateHuman_(from) + ' to ' + fmtDateHuman_(to),
      days: daysBetweenIso_(from, to) + 1
    };
  },

  /* =============================================================== maps == */
  maps_: function (c) {
    var m = { employees: {}, employeeList: [], projects: {}, runs: {} };
    Db.all(c, 'Employees').forEach(function (e) { m.employees[txt_(e.employee_id)] = e; m.employeeList.push(e); });
    Db.all(c, 'Projects').forEach(function (p) { m.projects[txt_(p.project_id)] = p; });
    Db.all(c, 'PayrollRuns').forEach(function (r) { m.runs[txt_(r.run_id)] = r; });
    return m;
  },

  matchEmp_: function (emp, p) {
    if (!emp) return false;
    if (p.department && txt_(emp.department) !== txt_(p.department)) return false;
    if (p.project_id && txt_(emp.project_id) !== txt_(p.project_id)) return false;
    if (p.status && txt_(emp.status) !== txt_(p.status)) return false;
    if (p.employee_id && txt_(emp.employee_id) !== txt_(p.employee_id)) return false;
    return true;
  },

  columns_: function (list) { return list; },

  /* ============================================================== runner = */
  run: function (ctx, payload) {
    Perm.require(ctx, 'reports.view');
    var def = Reports.defs_()[txt_(payload.report)];
    if (!def) fail_('VALIDATION', 'Unknown report: ' + txt_(payload.report), { field: 'report' });
    if (def.perm) Perm.require(ctx, def.perm);
    var period = Reports.period_(payload);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var maps = Reports.maps_(c);
    var out = Reports.build_(def.code, ctx, payload, period, c, maps);
    out.report = { code: def.code, name: def.name, group: def.group, desc: def.desc, chart: def.chart || '' };
    out.period = period;
    out.generated_at = nowIso_();
    out.generated_by = txt_(ctx.name);
    out.can_export = Perm.has(ctx, 'reports.export');
    out.row_count = out.rows.length;
    out.columns = Reports.columns_(out.columns);
    if (!out.chart && def.chart) out.chart = null;
    return out;
  },

  build_: function (code, ctx, payload, period, c, maps) {
    switch (code) {
      case 'attendance_register': return Reports.attendanceRegister_(ctx, payload, period, c, maps);
      case 'attendance_summary': return Reports.attendanceSummary_(ctx, payload, period, c, maps);
      case 'overtime_report': return Reports.overtime_(ctx, payload, period, c, maps);
      case 'late_early_report': return Reports.lateEarly_(ctx, payload, period, c, maps);
      case 'headcount': return Reports.headcount_(ctx, payload, period, c, maps);
      case 'employee_master': return Reports.employeeMaster_(ctx, payload, period, c, maps);
      case 'project_roster': return Reports.roster_(ctx, payload, period, c, maps);
      case 'transfer_report': return Reports.transfers_(ctx, payload, period, c, maps);
      case 'leave_balances': return Reports.leaveBalances_(ctx, payload, period, c, maps);
      case 'leave_register': return Reports.leaveRegister_(ctx, payload, period, c, maps);
      case 'expense_register': return Reports.expenseRegister_(ctx, payload, period, c, maps);
      case 'expense_summary': return Reports.expenseSummary_(ctx, payload, period, c, maps);
      case 'payroll_summary': return Reports.payrollSummary_(ctx, payload, period, c, maps);
      case 'payroll_register': return Reports.payrollRegister_(ctx, payload, period, c, maps);
      case 'pf_statement': return Reports.pfStatement_(ctx, payload, period, c, maps);
      case 'esic_statement': return Reports.esicStatement_(ctx, payload, period, c, maps);
      case 'pt_statement': return Reports.ptStatement_(ctx, payload, period, c, maps);
      case 'tds_statement': return Reports.tdsStatement_(ctx, payload, period, c, maps);
      case 'compliance_summary': return Reports.complianceSummary_(ctx, payload, period, c, maps);
      case 'salary_cost_by_project': return Reports.costByProject_(ctx, payload, period, c, maps);
      case 'document_expiry': return Reports.documentExpiry_(ctx, payload, period, c, maps);
      default: fail_('VALIDATION', 'This report is not available yet.');
    }
    return null;
  },

  tot_: function (rows, key) { return round0_(sum_(rows, function (r) { return r[key]; })); },

  /* ========================================================= attendance = */
  attendanceRows_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    return Db.all(c, 'Attendance', function (a) {
      var d = txt_(a.date);
      if (d < period.from || d > period.to) return false;
      if (payload.project_id && txt_(a.project_id) !== txt_(payload.project_id)) return false;
      if (payload.employee_id && txt_(a.employee_id) !== txt_(payload.employee_id)) return false;
      if (allowed && allowed.indexOf(txt_(a.employee_id)) < 0) return false;
      if (payload.department || payload.status) {
        var emp = maps.employees[txt_(a.employee_id)];
        if (payload.department && (!emp || txt_(emp.department) !== txt_(payload.department))) return false;
        if (payload.status && txt_(a.status) !== txt_(payload.status)) return false;
      }
      return true;
    });
  },

  attendanceRegister_: function (ctx, payload, period, c, maps) {
    var rows = Reports.attendanceRows_(ctx, payload, period, c, maps).map(function (a) {
      var emp = maps.employees[txt_(a.employee_id)] || {};
      return {
        date: txt_(a.date), day: dayName_(txt_(a.date)), employee_code: txt_(a.employee_code),
        employee_name: txt_(a.employee_name || emp.name), department: txt_(emp.department),
        project: txt_(a.project_name), status: txt_(a.status),
        in_time: txt_(a.in_time), out_time: txt_(a.out_time),
        worked_hours: round2_(numVal_(a.worked_minutes) / 60), shift_hours: round2_(numVal_(a.shift_minutes) / 60),
        late_minutes: numVal_(a.late_minutes), early_minutes: numVal_(a.early_minutes),
        ot_hours: round2_(numVal_(a.overtime_minutes) / 60),
        source: txt_(a.source), flagged: boolVal_(a.flagged) ? 'YES' : '', flag_reason: txt_(a.flag_reason)
      };
    });
    rows = sortRows_(rows, 'date', 'DESC');
    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'day', label: 'Day' },
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'project', label: 'Site / project' },
        { key: 'status', label: 'Status', type: 'badge' }, { key: 'in_time', label: 'In' }, { key: 'out_time', label: 'Out' },
        { key: 'worked_hours', label: 'Worked (h)', type: 'number' }, { key: 'late_minutes', label: 'Late (m)', type: 'number' },
        { key: 'ot_hours', label: 'OT (h)', type: 'number' }, { key: 'source', label: 'Source' },
        { key: 'flagged', label: 'Flag' }
      ],
      rows: rows.slice(0, 5000),
      totals: {
        Records: rows.length,
        'Present days': rows.filter(function (r) { return r.status === 'PRESENT' || r.status === 'HALF_DAY'; }).length,
        'Worked hours': round0_(sum_(rows, function (r) { return r.worked_hours; })),
        'Overtime hours': round2_(sum_(rows, function (r) { return r.ot_hours; })),
        'Flagged punches': rows.filter(function (r) { return r.flagged === 'YES'; }).length
      },
      chart: Reports.statusChart_(rows)
    };
  },

  statusChart_: function (rows) {
    var counts = {};
    rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    var labels = Object.keys(counts);
    return labels.length ? { type: 'doughnut', labels: labels, series: [{ label: 'Days', data: labels.map(function (k) { return counts[k]; }) }] } : null;
  },

  attendanceSummary_: function (ctx, payload, period, c, maps) {
    var rows = Reports.attendanceRows_(ctx, payload, period, c, maps);
    var byEmp = {};
    rows.forEach(function (a) {
      var id = txt_(a.employee_id);
      if (!byEmp[id]) {
        var emp = maps.employees[id] || {};
        byEmp[id] = {
          employee_code: txt_(a.employee_code || emp.code), employee_name: txt_(a.employee_name || emp.name),
          department: txt_(emp.department), present: 0, half: 0, absent: 0, leave: 0, holiday: 0, weekly_off: 0,
          worked_hours: 0, ot_hours: 0, late_count: 0, flagged: 0
        };
      }
      var s = txt_(a.status);
      var r = byEmp[id];
      if (s === 'PRESENT') r.present++;
      else if (s === 'HALF_DAY') r.half++;
      else if (s === 'ABSENT') r.absent++;
      else if (s === 'LEAVE') r.leave++;
      else if (s === 'HOLIDAY') r.holiday++;
      else if (s === 'WEEK_OFF') r.weekly_off++;
      r.worked_hours += numVal_(a.worked_minutes) / 60;
      r.ot_hours += numVal_(a.overtime_minutes) / 60;
      if (numVal_(a.late_minutes) > 0) r.late_count++;
      if (boolVal_(a.flagged)) r.flagged++;
    });
    var out = Object.keys(byEmp).map(function (id) {
      var r = byEmp[id];
      r.paid_days = round2_(r.present + r.half * 0.5 + r.leave + r.holiday + r.weekly_off);
      r.worked_hours = round2_(r.worked_hours);
      r.ot_hours = round2_(r.ot_hours);
      r.avg_hours = r.present + r.half > 0 ? round2_(r.worked_hours / (r.present + r.half)) : 0;
      r.lop_days = round2_(r.absent + r.half * 0.5);
      return r;
    });
    out = sortRows_(out, 'employee_name', 'ASC');
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'present', label: 'Present', type: 'number' },
        { key: 'half', label: 'Half day', type: 'number' }, { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'leave', label: 'Leave', type: 'number' }, { key: 'weekly_off', label: 'Weekly off', type: 'number' },
        { key: 'holiday', label: 'Holiday', type: 'number' }, { key: 'paid_days', label: 'Paid days', type: 'number' },
        { key: 'lop_days', label: 'LOP days', type: 'number' }, { key: 'worked_hours', label: 'Worked (h)', type: 'number' },
        { key: 'avg_hours', label: 'Avg (h)', type: 'number' }, { key: 'ot_hours', label: 'OT (h)', type: 'number' },
        { key: 'late_count', label: 'Late marks', type: 'number' }, { key: 'flagged', label: 'Flags', type: 'number' }
      ],
      rows: out,
      totals: {
        Employees: out.length,
        'Present days': Reports.tot_(out, 'present'),
        'Paid days': round2_(sum_(out, function (r) { return r.paid_days; })),
        'LOP days': round2_(sum_(out, function (r) { return r.lop_days; })),
        'Overtime hours': round2_(sum_(out, function (r) { return r.ot_hours; }))
      },
      chart: {
        type: 'bar', labels: out.slice(0, 12).map(function (r) { return r.employee_name; }),
        series: [
          { label: 'Paid days', data: out.slice(0, 12).map(function (r) { return r.paid_days; }) },
          { label: 'LOP days', data: out.slice(0, 12).map(function (r) { return r.lop_days; }) }
        ]
      }
    };
  },

  overtime_: function (ctx, payload, period, c, maps) {
    var rows = Reports.attendanceRows_(ctx, payload, period, c, maps)
      .filter(function (a) { return numVal_(a.overtime_minutes) > 0; });
    var out = rows.map(function (a) {
      var emp = maps.employees[txt_(a.employee_id)] || {};
      var proj = maps.projects[txt_(a.project_id)] || {};
      var rate = numVal_(emp.overtime_rate || 0);
      return {
        date: txt_(a.date), employee_code: txt_(a.employee_code), employee_name: txt_(a.employee_name),
        department: txt_(emp.department), project: txt_(a.project_name || proj.name),
        shift_hours: round2_(numVal_(a.shift_minutes) / 60), worked_hours: round2_(numVal_(a.worked_minutes) / 60),
        ot_hours: round2_(numVal_(a.overtime_minutes) / 60), in_time: txt_(a.in_time), out_time: txt_(a.out_time)
      };
    });
    var byEmp = {};
    out.forEach(function (r) {
      byEmp[r.employee_code] = byEmp[r.employee_code] || { code: r.employee_code, name: r.employee_name, hours: 0, days: 0 };
      byEmp[r.employee_code].hours += r.ot_hours;
      byEmp[r.employee_code].days++;
    });
    var summary = Object.keys(byEmp).map(function (k) {
      return { employee_code: k, employee_name: byEmp[k].name, ot_days: byEmp[k].days, ot_hours: round2_(byEmp[k].hours) };
    });
    summary = sortRows_(summary, 'ot_hours', 'DESC');
    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'employee_code', label: 'Code' },
        { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' },
        { key: 'project', label: 'Site / project' }, { key: 'in_time', label: 'In' }, { key: 'out_time', label: 'Out' },
        { key: 'shift_hours', label: 'Shift (h)', type: 'number' }, { key: 'worked_hours', label: 'Worked (h)', type: 'number' },
        { key: 'ot_hours', label: 'OT (h)', type: 'number' }
      ],
      rows: sortRows_(out, 'date', 'DESC'),
      totals: {
        'OT days': out.length,
        'OT hours': round2_(sum_(out, function (r) { return r.ot_hours; })),
        Employees: summary.length
      },
      chart: {
        type: 'bar', labels: summary.slice(0, 10).map(function (r) { return r.employee_name; }),
        series: [{ label: 'OT hours', data: summary.slice(0, 10).map(function (r) { return r.ot_hours; }) }]
      },
      secondary: { title: 'Overtime by employee', columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'ot_days', label: 'Days', type: 'number' }, { key: 'ot_hours', label: 'OT hours', type: 'number' }], rows: summary }
    };
  },

  lateEarly_: function (ctx, payload, period, c, maps) {
    var rows = Reports.attendanceRows_(ctx, payload, period, c, maps).filter(function (a) {
      return numVal_(a.late_minutes) > 0 || numVal_(a.early_minutes) > 0;
    }).map(function (a) {
      var emp = maps.employees[txt_(a.employee_id)] || {};
      return {
        date: txt_(a.date), employee_code: txt_(a.employee_code), employee_name: txt_(a.employee_name),
        department: txt_(emp.department), project: txt_(a.project_name),
        in_time: txt_(a.in_time), shift_minutes: numVal_(a.shift_minutes),
        late_minutes: numVal_(a.late_minutes), early_minutes: numVal_(a.early_minutes),
        remark: numVal_(a.late_minutes) > 0 ? 'Late by ' + hoursLabel_(numVal_(a.late_minutes)) : 'Left ' + hoursLabel_(numVal_(a.early_minutes)) + ' early'
      };
    });
    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'employee_code', label: 'Code' },
        { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' },
        { key: 'project', label: 'Site / project' }, { key: 'in_time', label: 'In time' },
        { key: 'late_minutes', label: 'Late (m)', type: 'number' }, { key: 'early_minutes', label: 'Early (m)', type: 'number' },
        { key: 'remark', label: 'Remark' }
      ],
      rows: sortRows_(rows, 'date', 'DESC'),
      totals: {
        Occurrences: rows.length,
        'Late minutes': Reports.tot_(rows, 'late_minutes'),
        'Early minutes': Reports.tot_(rows, 'early_minutes'),
        Employees: uniq_(rows.map(function (r) { return r.employee_code; })).length
      }
    };
  },

  /* ============================================================= people = */
  headcount_: function (ctx, payload, period, c, maps) {
    var byDept = {};
    maps.employeeList.forEach(function (e) {
      if (payload.status && txt_(e.status) !== txt_(payload.status)) return;
      var d = txt_(e.department) || 'Not set';
      byDept[d] = byDept[d] || { department: d, active: 0, notice: 0, exited: 0, on_site: 0, office: 0, ctc: 0 };
      var s = txt_(e.status);
      if (s === 'ACTIVE') byDept[d].active++;
      else if (s === 'NOTICE' || s === 'ON_LEAVE') byDept[d].notice++;
      else if (s === 'EXITED') byDept[d].exited++;
      if (txt_(e.project_id)) byDept[d].on_site++; else byDept[d].office++;
      byDept[d].ctc += numVal_(e.ctc_monthly);
    });
    var rows = Object.keys(byDept).map(function (k) {
      var r = byDept[k];
      r.total = r.active + r.notice + r.exited;
      r.ctc = round0_(r.ctc);
      return r;
    });
    rows = sortRows_(rows, 'total', 'DESC');
    var byType = {};
    maps.employeeList.forEach(function (e) {
      if (txt_(e.status) !== 'ACTIVE' && txt_(e.status) !== 'ON_LEAVE' && txt_(e.status) !== 'NOTICE') return;
      var t = txt_(e.employment_type) || 'Not set';
      byType[t] = (byType[t] || 0) + 1;
    });
    return {
      columns: [
        { key: 'department', label: 'Department' }, { key: 'active', label: 'Active', type: 'number' },
        { key: 'notice', label: 'Notice / on leave', type: 'number' }, { key: 'exited', label: 'Exited', type: 'number' },
        { key: 'total', label: 'Total people', type: 'number' }, { key: 'on_site', label: 'Deployed on site', type: 'number' },
        { key: 'office', label: 'Office based', type: 'number' }, { key: 'ctc', label: 'Monthly CTC', type: 'money' }
      ],
      rows: rows,
      totals: {
        Departments: rows.length,
        'Active people': Reports.tot_(rows, 'active'),
        'Deployed on site': Reports.tot_(rows, 'on_site'),
        'Monthly CTC': Reports.tot_(rows, 'ctc')
      },
      chart: {
        type: 'doughnut', labels: Object.keys(byType),
        series: [{ label: 'People', data: Object.keys(byType).map(function (k) { return byType[k]; }) }]
      },
      secondary: {
        title: 'Employment type mix',
        columns: [{ key: 'type', label: 'Employment type' }, { key: 'count', label: 'People', type: 'number' }],
        rows: Object.keys(byType).map(function (k) { return { type: k, count: byType[k] }; })
      }
    };
  },

  employeeMaster_: function (ctx, payload, period, c, maps) {
    var reveal = Perm.has(ctx, 'employees.sensitive');
    var rows = maps.employeeList.filter(function (e) { return Reports.matchEmp_(e, payload); }).map(function (e) {
      var proj = maps.projects[txt_(e.project_id)] || {};
      return {
        code: txt_(e.code), name: txt_(e.name), status: txt_(e.status), department: txt_(e.department),
        designation: txt_(e.designation), employment_type: txt_(e.employment_type),
        joining_date: txt_(e.joining_date), exit_date: txt_(e.exit_date),
        project: txt_(proj.name), work_state: txt_(e.work_state), branch: txt_(e.branch_id),
        phone: txt_(e.phone), email: txt_(e.email), city: txt_(e.city), state: txt_(e.state),
        pan: reveal ? txt_(e.pan) : maskPan_(e.pan),
        bank_account: reveal ? txt_(e.bank_account) : maskAccount_(e.bank_account),
        bank_name: txt_(e.bank_name), ifsc: txt_(e.bank_ifsc),
        pf_uan: txt_(e.pf_uan), esic_ip_no: txt_(e.esic_ip_no),
        ctc_monthly: numVal_(e.ctc_monthly)
      };
    });
    rows = sortRows_(rows, 'name', 'ASC');
    return {
      columns: [
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status', type: 'badge' },
        { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
        { key: 'employment_type', label: 'Type' }, { key: 'joining_date', label: 'Joined', type: 'date' },
        { key: 'project', label: 'Site / project' }, { key: 'work_state', label: 'Work state' },
        { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'pan', label: 'PAN' },
        { key: 'bank_account', label: 'Bank A/c' }, { key: 'bank_name', label: 'Bank' }, { key: 'ifsc', label: 'IFSC' },
        { key: 'pf_uan', label: 'PF UAN' }, { key: 'esic_ip_no', label: 'ESIC IP' },
        { key: 'ctc_monthly', label: 'Monthly CTC', type: 'money' }
      ],
      rows: rows,
      totals: {
        Employees: rows.length,
        Active: rows.filter(function (r) { return r.status === 'ACTIVE'; }).length,
        'Monthly CTC': Reports.tot_(rows, 'ctc_monthly')
      },
      note: reveal ? '' : 'Bank account and PAN are masked because you do not have the "See sensitive employee data" permission.'
    };
  },

  roster_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'ProjectAssignments', function (a) {
      if (payload.project_id && txt_(a.project_id) !== txt_(payload.project_id)) return false;
      if (payload.status && txt_(a.status) !== txt_(payload.status)) return false;
      if (allowed && allowed.indexOf(txt_(a.employee_id)) < 0) return false;
      return true;
    }).map(function (a) {
      var proj = maps.projects[txt_(a.project_id)] || {};
      var emp = maps.employees[txt_(a.employee_id)] || {};
      return {
        project: txt_(proj.name), project_code: txt_(proj.code), city: txt_(proj.city),
        employee_code: txt_(emp.code), employee_name: txt_(a.employee_name || emp.name),
        department: txt_(emp.department), role_on_site: txt_(a.role_on_site), is_primary: boolVal_(a.is_primary) ? 'Primary' : 'Additional',
        from_date: txt_(a.from_date), to_date: txt_(a.to_date), status: txt_(a.status), daily_wage: numVal_(a.daily_wage)
      };
    });
    return {
      columns: [
        { key: 'project', label: 'Project' }, { key: 'project_code', label: 'Code' }, { key: 'city', label: 'City' },
        { key: 'employee_code', label: 'Employee code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'role_on_site', label: 'Role on site' },
        { key: 'is_primary', label: 'Deployment' }, { key: 'from_date', label: 'From', type: 'date' },
        { key: 'to_date', label: 'To', type: 'date' }, { key: 'status', label: 'Status', type: 'badge' },
        { key: 'daily_wage', label: 'Daily wage', type: 'money' }
      ],
      rows: sortRows_(rows, 'project', 'ASC'),
      totals: {
        Assignments: rows.length,
        Projects: uniq_(rows.map(function (r) { return r.project_code; })).length,
        Employees: uniq_(rows.map(function (r) { return r.employee_code; })).length,
        'Active assignments': rows.filter(function (r) { return r.status === 'ACTIVE'; }).length
      }
    };
  },

  transfers_: function (ctx, payload, period, c, maps) {
    var rows = Db.all(c, 'TransferRequests', function (t) {
      if (payload.status && txt_(t.status) !== txt_(payload.status)) return false;
      var d = txt_(t.effective_date) || txt_(t.created_at);
      if (d && (d < period.from || d > period.to)) return false;
      return true;
    }).map(function (t) {
      var from = maps.projects[txt_(t.from_project_id)] || {};
      var to = maps.projects[txt_(t.to_project_id)] || {};
      return {
        employee_name: txt_(t.employee_name), from_project: txt_(from.name), to_project: txt_(to.name),
        effective_date: txt_(t.effective_date), status: txt_(t.status), reason: txt_(t.reason),
        decided_by_name: txt_(t.decided_by_name), decided_at: txt_(t.decided_at), decision_remark: txt_(t.decision_remark)
      };
    });
    return {
      columns: [
        { key: 'employee_name', label: 'Employee' }, { key: 'from_project', label: 'From project' },
        { key: 'to_project', label: 'To project' }, { key: 'effective_date', label: 'Effective', type: 'date' },
        { key: 'status', label: 'Status', type: 'badge' }, { key: 'reason', label: 'Reason' },
        { key: 'decided_by_name', label: 'Decided by' }, { key: 'decision_remark', label: 'Decision remark' }
      ],
      rows: sortRows_(rows, 'effective_date', 'DESC'),
      totals: {
        Requests: rows.length,
        Approved: rows.filter(function (r) { return r.status === 'APPROVED'; }).length,
        Pending: rows.filter(function (r) { return r.status === 'PENDING'; }).length,
        Rejected: rows.filter(function (r) { return r.status === 'REJECTED'; }).length
      }
    };
  },

  /* ============================================================== leave = */
  leaveBalances_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    var fy = period.fy;
    var rows = Db.all(c, 'LeaveBalances', function (b) {
      if (txt_(b.fy) !== fy) return false;
      if (allowed && allowed.indexOf(txt_(b.employee_id)) < 0) return false;
      if (payload.department) {
        var emp = maps.employees[txt_(b.employee_id)];
        if (!emp || txt_(emp.department) !== txt_(payload.department)) return false;
      }
      return true;
    }).map(function (b) {
      var emp = maps.employees[txt_(b.employee_id)] || {};
      return {
        employee_code: txt_(emp.code), employee_name: txt_(b.employee_name || emp.name),
        department: txt_(emp.department), leave_type: txt_(b.leave_type_code),
        opening: round2_(numVal_(b.opening)), accrued: round2_(numVal_(b.accrued)), used: round2_(numVal_(b.used)),
        lapsed: round2_(numVal_(b.lapsed)), closing: round2_(numVal_(b.closing))
      };
    });
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'leave_type', label: 'Leave type' },
        { key: 'opening', label: 'Opening', type: 'number' }, { key: 'accrued', label: 'Accrued', type: 'number' },
        { key: 'used', label: 'Used', type: 'number' }, { key: 'lapsed', label: 'Lapsed', type: 'number' },
        { key: 'closing', label: 'Closing', type: 'number' }
      ],
      rows: sortRows_(rows, 'employee_name', 'ASC'),
      totals: {
        Records: rows.length,
        Accrued: round2_(sum_(rows, function (r) { return r.accrued; })),
        Used: round2_(sum_(rows, function (r) { return r.used; })),
        'Closing balance': round2_(sum_(rows, function (r) { return r.closing; }))
      },
      note: 'Financial year ' + fy + ' (April to March). Negative closing means leave taken in advance.'
    };
  },

  leaveRegister_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'LeaveRequests', function (l) {
      if (allowed && allowed.indexOf(txt_(l.employee_id)) < 0) return false;
      if (payload.status && txt_(l.status) !== txt_(payload.status)) return false;
      if (payload.fy && txt_(l.fy) !== txt_(payload.fy)) return false;
      var d = txt_(l.from_date);
      if (d < period.from || d > period.to) return false;
      if (payload.department) {
        var emp = maps.employees[txt_(l.employee_id)];
        if (!emp || txt_(emp.department) !== txt_(payload.department)) return false;
      }
      return true;
    }).map(function (l) {
      var emp = maps.employees[txt_(l.employee_id)] || {};
      return {
        employee_code: txt_(l.employee_code || emp.code), employee_name: txt_(l.employee_name || emp.name),
        department: txt_(emp.department), leave_type: txt_(l.leave_type_name),
        from_date: txt_(l.from_date), to_date: txt_(l.to_date), days: numVal_(l.days),
        half_day: boolVal_(l.is_half_day) ? txt_(l.half_day_session) : '',
        reason: txt_(l.reason), status: txt_(l.status), applied_at: txt_(l.applied_at),
        decided_by_name: txt_(l.decided_by_name), decision_remark: txt_(l.decision_remark)
      };
    });
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'leave_type', label: 'Leave type' },
        { key: 'from_date', label: 'From', type: 'date' }, { key: 'to_date', label: 'To', type: 'date' },
        { key: 'days', label: 'Days', type: 'number' }, { key: 'half_day', label: 'Half day' },
        { key: 'status', label: 'Status', type: 'badge' }, { key: 'reason', label: 'Reason' },
        { key: 'decided_by_name', label: 'Decided by' }, { key: 'decision_remark', label: 'Remark' }
      ],
      rows: sortRows_(rows, 'from_date', 'DESC'),
      totals: {
        Requests: rows.length,
        'Days applied': round2_(sum_(rows, function (r) { return r.days; })),
        Approved: rows.filter(function (r) { return r.status === 'APPROVED'; }).length,
        Pending: rows.filter(function (r) { return r.status === 'PENDING'; }).length,
        Rejected: rows.filter(function (r) { return r.status === 'REJECTED'; }).length
      }
    };
  },

  /* ============================================================ expense = */
  expenseRegister_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'ExpenseClaims', function (x) {
      if (allowed && allowed.indexOf(txt_(x.employee_id)) < 0) return false;
      if (payload.status && txt_(x.status) !== txt_(payload.status)) return false;
      var d = txt_(x.claim_date);
      if (d < period.from || d > period.to) return false;
      if (payload.department) {
        var emp = maps.employees[txt_(x.employee_id)];
        if (!emp || txt_(emp.department) !== txt_(payload.department)) return false;
      }
      return true;
    }).map(function (x) {
      var emp = maps.employees[txt_(x.employee_id)] || {};
      return {
        code: txt_(x.code), employee_code: txt_(emp.code), employee_name: txt_(x.employee_name || emp.name),
        department: txt_(emp.department), category: txt_(x.category_name), claim_date: txt_(x.claim_date),
        amount: numVal_(x.amount), tax_amount: numVal_(x.tax_amount), advance_amount: numVal_(x.advance_amount),
        net_amount: numVal_(x.net_amount), bill_count: intVal_(x.bill_count), description: txt_(x.description),
        status: txt_(x.status), decided_by_name: txt_(x.decided_by_name), decision_remark: txt_(x.decision_remark),
        paid_at: txt_(x.paid_at)
      };
    });
    return {
      columns: [
        { key: 'code', label: 'Claim no' }, { key: 'employee_code', label: 'Code' },
        { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' },
        { key: 'category', label: 'Category' }, { key: 'claim_date', label: 'Claim date', type: 'date' },
        { key: 'amount', label: 'Amount', type: 'money' }, { key: 'advance_amount', label: 'Advance', type: 'money' },
        { key: 'net_amount', label: 'Payable', type: 'money' }, { key: 'bill_count', label: 'Bills', type: 'number' },
        { key: 'status', label: 'Status', type: 'badge' }, { key: 'description', label: 'Description' },
        { key: 'decided_by_name', label: 'Decided by' }, { key: 'decision_remark', label: 'Remark' }
      ],
      rows: sortRows_(rows, 'claim_date', 'DESC'),
      totals: {
        Claims: rows.length,
        'Claimed amount': Reports.tot_(rows, 'amount'),
        'Approved payable': Reports.tot_(rows, 'net_amount'),
        'Already paid': Reports.tot_(rows.filter(function (r) { return r.status === 'PAID'; }), 'net_amount'),
        Pending: rows.filter(function (r) { return r.status === 'SUBMITTED'; }).length
      }
    };
  },

  expenseSummary_: function (ctx, payload, period, c, maps) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'ExpenseClaims', function (x) {
      if (allowed && allowed.indexOf(txt_(x.employee_id)) < 0) return false;
      var d = txt_(x.claim_date);
      if (d < period.from || d > period.to) return false;
      return true;
    });
    var byCat = {};
    rows.forEach(function (x) {
      var k = txt_(x.category_name) || 'Uncategorised';
      byCat[k] = byCat[k] || { category: k, claims: 0, claimed: 0, payable: 0, paid: 0 };
      byCat[k].claims++;
      byCat[k].claimed += numVal_(x.amount);
      byCat[k].payable += numVal_(x.net_amount);
      if (txt_(x.status) === 'PAID') byCat[k].paid += numVal_(x.net_amount);
    });
    var catRows = Object.keys(byCat).map(function (k) {
      var r = byCat[k];
      r.claimed = round0_(r.claimed); r.payable = round0_(r.payable); r.paid = round0_(r.paid);
      return r;
    });
    catRows = sortRows_(catRows, 'payable', 'DESC');

    var byMonth = {};
    rows.forEach(function (x) {
      var m = monthOfIso_(x.claim_date);
      byMonth[m] = byMonth[m] || { month: m, month_label: monthLabel_(m), claims: 0, claimed: 0, payable: 0 };
      byMonth[m].claims++;
      byMonth[m].claimed += numVal_(x.amount);
      byMonth[m].payable += numVal_(x.net_amount);
    });
    var monthRows = Object.keys(byMonth).sort().map(function (k) {
      var r = byMonth[k];
      r.claimed = round0_(r.claimed); r.payable = round0_(r.payable);
      return r;
    });

    return {
      columns: [
        { key: 'category', label: 'Category' }, { key: 'claims', label: 'Claims', type: 'number' },
        { key: 'claimed', label: 'Claimed', type: 'money' }, { key: 'payable', label: 'Payable', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' }
      ],
      rows: catRows,
      totals: {
        Claims: rows.length,
        'Claimed amount': Reports.tot_(catRows, 'claimed'),
        'Payable amount': Reports.tot_(catRows, 'payable'),
        'Paid amount': Reports.tot_(catRows, 'paid')
      },
      chart: {
        type: 'doughnut', labels: catRows.map(function (r) { return r.category; }),
        series: [{ label: 'Payable', data: catRows.map(function (r) { return r.payable; }) }]
      },
      secondary: {
        title: 'Month wise expense',
        columns: [{ key: 'month_label', label: 'Month' }, { key: 'claims', label: 'Claims', type: 'number' },
          { key: 'claimed', label: 'Claimed', type: 'money' }, { key: 'payable', label: 'Payable', type: 'money' }],
        rows: monthRows
      }
    };
  },

  /* ============================================================ payroll = */
  itemsForPeriod_: function (period, c, maps) {
    var wanted = {};
    Db.all(c, 'PayrollRuns', function (r) {
      return txt_(r.month) === period.month && txt_(r.status) !== 'CANCELLED' && txt_(r.status) !== 'DRAFT';
    }).forEach(function (r) { wanted[txt_(r.run_id)] = r; });
    var out = [];
    Db.all(c, 'PayrollItems', function (i) {
      return !!wanted[txt_(i.run_id)];
    }).forEach(function (i) { out.push({ item: i, run: wanted[txt_(i.run_id)] }); });
    return out;
  },

  payrollSummary_: function (ctx, payload, period, c, maps) {
    var fy = period.fy;
    var runs = Db.all(c, 'PayrollRuns', function (r) {
      return txt_(r.fy) === fy && txt_(r.status) !== 'CANCELLED';
    });
    var rows = sortRows_(runs, 'month', 'ASC').map(function (r) {
      return {
        month: txt_(r.month), month_label: monthLabel_(r.month), status: txt_(r.status),
        employees: intVal_(r.total_employees), gross: round0_(numVal_(r.total_gross)),
        deductions: round0_(numVal_(r.total_deductions)), net: round0_(numVal_(r.total_net)),
        employer_cost: round0_(numVal_(r.total_employer_cost)),
        days_basis: txt_(r.days_basis), paid_at: txt_(r.paid_at)
      };
    });
    var netSeries = rows.map(function (r) { return r.net; });
    return {
      columns: [
        { key: 'month_label', label: 'Month' }, { key: 'status', label: 'Status', type: 'badge' },
        { key: 'employees', label: 'Employees', type: 'number' }, { key: 'gross', label: 'Gross earnings', type: 'money' },
        { key: 'deductions', label: 'Deductions', type: 'money' }, { key: 'net', label: 'Net payout', type: 'money' },
        { key: 'employer_cost', label: 'Employer cost', type: 'money' }, { key: 'days_basis', label: 'Days basis' },
        { key: 'paid_at', label: 'Paid on', type: 'date' }
      ],
      rows: rows,
      totals: {
        'Months processed': rows.length,
        'Gross earnings': Reports.tot_(rows, 'gross'),
        Deductions: Reports.tot_(rows, 'deductions'),
        'Net payout': Reports.tot_(rows, 'net'),
        'Employer cost': Reports.tot_(rows, 'employer_cost')
      },
      chart: {
        type: 'line', labels: rows.map(function (r) { return r.month_label; }),
        series: [
          { label: 'Net payout', data: netSeries },
          { label: 'Employer cost', data: rows.map(function (r) { return r.employer_cost; }) }
        ]
      }
    };
  },

  payrollRegister_: function (ctx, payload, period, c, maps) {
    var pairs = Reports.itemsForPeriod_(period, c, maps);
    var rows = pairs.filter(function (p) {
      var emp = maps.employees[txt_(p.item.employee_id)] || {};
      if (payload.department && txt_(emp.department) !== txt_(payload.department)) return false;
      if (payload.project_id && txt_(p.item.project_id) !== txt_(payload.project_id)) return false;
      return true;
    }).map(function (p) {
      var i = p.item;
      return {
        employee_code: txt_(i.employee_code), employee_name: txt_(i.employee_name), department: txt_(i.department),
        project: txt_(maps.projects[txt_(i.project_id)] ? maps.projects[txt_(i.project_id)].name : ''),
        paid_days: numVal_(i.paid_days), lop_days: numVal_(i.lop_days), ot_hours: numVal_(i.ot_hours),
        basic: numVal_(i.basic), hra: numVal_(i.hra), da: numVal_(i.da), conveyance: numVal_(i.conveyance),
        special_allowance: numVal_(i.special_allowance), other_allowance: numVal_(i.other_allowance),
        bonus: numVal_(i.bonus), incentive: numVal_(i.incentive),
        gross_earnings: numVal_(i.gross_earnings), reimbursement: numVal_(i.reimbursement),
        pf_employee: numVal_(i.pf_employee), esic_employee: numVal_(i.esic_employee), pt: numVal_(i.pt),
        tds: numVal_(i.tds), advance_recovery: numVal_(i.advance_recovery), other_deduction: numVal_(i.other_deduction),
        total_deductions: numVal_(i.total_deductions), net_pay: numVal_(i.net_pay), status: txt_(i.status)
      };
    });
    rows = sortRows_(rows, 'employee_name', 'ASC');
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'department', label: 'Department' }, { key: 'project', label: 'Site / project' },
        { key: 'paid_days', label: 'Paid days', type: 'number' }, { key: 'lop_days', label: 'LOP', type: 'number' },
        { key: 'basic', label: 'Basic', type: 'money' }, { key: 'hra', label: 'HRA', type: 'money' },
        { key: 'da', label: 'DA', type: 'money' }, { key: 'conveyance', label: 'Conveyance', type: 'money' },
        { key: 'special_allowance', label: 'Special', type: 'money' }, { key: 'other_allowance', label: 'Other', type: 'money' },
        { key: 'ot_hours', label: 'OT hours', type: 'number' }, { key: 'bonus', label: 'Bonus', type: 'money' },
        { key: 'gross_earnings', label: 'Gross', type: 'money' }, { key: 'pf_employee', label: 'PF', type: 'money' },
        { key: 'esic_employee', label: 'ESIC', type: 'money' }, { key: 'pt', label: 'PT', type: 'money' },
        { key: 'tds', label: 'TDS', type: 'money' }, { key: 'advance_recovery', label: 'Advance', type: 'money' },
        { key: 'total_deductions', label: 'Deductions', type: 'money' }, { key: 'net_pay', label: 'Net pay', type: 'money' },
        { key: 'status', label: 'Status', type: 'badge' }
      ],
      rows: rows,
      totals: {
        Employees: rows.length,
        'Gross earnings': Reports.tot_(rows, 'gross_earnings'),
        'Total deductions': Reports.tot_(rows, 'total_deductions'),
        'Net payout': Reports.tot_(rows, 'net_pay'),
        'PF collected': Reports.tot_(rows, 'pf_employee'),
        'TDS deducted': Reports.tot_(rows, 'tds')
      },
      note: 'Register for ' + period.month_label + ' (' + period.from + ' to ' + period.to + ').'
    };
  },

  statutoryRows_: function (period, c, maps) {
    return Reports.itemsForPeriod_(period, c, maps).map(function (p) {
      var i = p.item;
      var emp = maps.employees[txt_(i.employee_id)] || {};
      return {
        employeeCode: txt_(i.employee_code), employeeName: txt_(i.employee_name), department: txt_(i.department),
        pfWage: numVal_(i.pf_wage), pfEmployee: numVal_(i.pf_employee), pfEmployer: numVal_(i.pf_employer),
        esicWage: numVal_(i.esic_wage), esicEmployee: numVal_(i.esic_employee), esicEmployer: numVal_(i.esic_employer),
        pt: numVal_(i.pt), tds: numVal_(i.tds), gross: numVal_(i.gross_earnings),
        uan: txt_(emp.pf_uan), ip: txt_(emp.esic_ip_no), pan: txt_(emp.pan),
        state: txt_(emp.work_state), regime: txt_(emp.tds_regime || 'NEW'), status: txt_(i.status)
      };
    }).filter(function (r) { return r.status !== 'HOLD'; });
  },

  pfStatement_: function (ctx, payload, period, c, maps) {
    var rows = Reports.statutoryRows_(period, c, maps).filter(function (r) { return r.pfEmployee > 0 || r.pfEmployer > 0; })
      .map(function (r) {
        return {
          employee_code: r.employeeCode, employee_name: r.employeeName, pf_uan: r.uan, pf_wage: r.pfWage,
          employee_share: r.pfEmployee, employer_share: r.pfEmployer, total: round0_(r.pfEmployee + r.pfEmployer)
        };
      });
    rows = sortRows_(rows, 'employee_name', 'ASC');
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'pf_uan', label: 'PF UAN' }, { key: 'pf_wage', label: 'PF wage', type: 'money' },
        { key: 'employee_share', label: 'Employee 12%', type: 'money' }, { key: 'employer_share', label: 'Employer 12%', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' }
      ],
      rows: rows,
      totals: {
        Employees: rows.length,
        'PF wage': Reports.tot_(rows, 'pf_wage'),
        'Employee share': Reports.tot_(rows, 'employee_share'),
        'Employer share': Reports.tot_(rows, 'employer_share'),
        'Total remittance': Reports.tot_(rows, 'total')
      },
      note: 'Missing UAN rows: ' + rows.filter(function (r) { return !r.pf_uan; }).length +
        '. Add the UAN in the employee profile before filing the ECR.'
    };
  },

  esicStatement_: function (ctx, payload, period, c, maps) {
    var rows = Reports.statutoryRows_(period, c, maps).filter(function (r) { return r.esicEmployee > 0 || r.esicEmployer > 0; })
      .map(function (r) {
        return {
          employee_code: r.employeeCode, employee_name: r.employeeName, esic_ip_no: r.ip, esic_wage: r.esicWage,
          employee_share: r.esicEmployee, employer_share: r.esicEmployer, total: round0_(r.esicEmployee + r.esicEmployer)
        };
      });
    rows = sortRows_(rows, 'employee_name', 'ASC');
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'esic_ip_no', label: 'ESIC IP number' }, { key: 'esic_wage', label: 'ESIC wage', type: 'money' },
        { key: 'employee_share', label: 'Employee 0.75%', type: 'money' }, { key: 'employer_share', label: 'Employer 3.25%', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' }
      ],
      rows: rows,
      totals: {
        Employees: rows.length,
        'ESIC wage': Reports.tot_(rows, 'esic_wage'),
        'Employee share': Reports.tot_(rows, 'employee_share'),
        'Employer share': Reports.tot_(rows, 'employer_share'),
        'Total remittance': Reports.tot_(rows, 'total')
      },
      note: 'ESIC applies up to a gross wage of ₹21,000 per month. ' +
        'Missing IP numbers: ' + rows.filter(function (r) { return !r.esic_ip_no; }).length + '.'
    };
  },

  ptStatement_: function (ctx, payload, period, c, maps) {
    var rows = Reports.statutoryRows_(period, c, maps).filter(function (r) { return r.pt > 0; })
      .map(function (r) {
        return {
          employee_code: r.employeeCode, employee_name: r.employeeName, state: r.state,
          gross: r.gross, pt: r.pt
        };
      });
    var byState = {};
    rows.forEach(function (r) {
      var k = r.state || 'Not set';
      byState[k] = byState[k] || { state: k, employees: 0, pt: 0, gross: 0 };
      byState[k].employees++;
      byState[k].pt += r.pt;
      byState[k].gross += r.gross;
    });
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'state', label: 'Work state' }, { key: 'gross', label: 'Gross', type: 'money' },
        { key: 'pt', label: 'Professional tax', type: 'money' }
      ],
      rows: sortRows_(rows, 'employee_name', 'ASC'),
      totals: {
        Employees: rows.length,
        'Gross wages': Reports.tot_(rows, 'gross'),
        'Professional tax': Reports.tot_(rows, 'pt')
      },
      chart: {
        type: 'bar', labels: Object.keys(byState),
        series: [{ label: 'PT deducted', data: Object.keys(byState).map(function (k) { return round0_(byState[k].pt); }) }]
      },
      secondary: {
        title: 'State wise summary', columns: [
          { key: 'state', label: 'State' }, { key: 'employees', label: 'Employees', type: 'number' },
          { key: 'pt', label: 'PT', type: 'money' }],
        rows: Object.keys(byState).map(function (k) { return { state: k, employees: byState[k].employees, pt: round0_(byState[k].pt) }; })
      }
    };
  },

  tdsStatement_: function (ctx, payload, period, c, maps) {
    var rows = Reports.statutoryRows_(period, c, maps).map(function (r) {
      return {
        employee_code: r.employeeCode, employee_name: r.employeeName, pan: r.pan, regime: r.regime,
        gross: r.gross, pf_employee: r.pfEmployee, tds: r.tds
      };
    }).filter(function (r) { return payload.employee_id ? true : true; });
    var withTax = rows.filter(function (r) { return r.tds > 0; });
    return {
      columns: [
        { key: 'employee_code', label: 'Code' }, { key: 'employee_name', label: 'Employee' },
        { key: 'pan', label: 'PAN' }, { key: 'regime', label: 'Tax regime' },
        { key: 'gross', label: 'Gross earnings', type: 'money' }, { key: 'pf_employee', label: 'PF (employee)', type: 'money' },
        { key: 'tds', label: 'TDS deducted', type: 'money' }
      ],
      rows: sortRows_(rows, 'employee_name', 'ASC'),
      totals: {
        Employees: rows.length,
        'Employees with TDS': withTax.length,
        'Gross earnings': Reports.tot_(rows, 'gross'),
        'TDS deducted': Reports.tot_(rows, 'tds')
      },
      note: 'Rows without a PAN: ' + rows.filter(function (r) { return !r.pan; }).length +
        ' — collect PAN before filing Form 24Q. Regime is taken from the employee salary structure.'
    };
  },

  complianceSummary_: function (ctx, payload, period, c, maps) {
    var fy = period.fy;
    var runs = Db.all(c, 'PayrollRuns', function (r) { return txt_(r.fy) === fy && txt_(r.status) !== 'CANCELLED'; });
    var rows = sortRows_(runs, 'month', 'ASC').map(function (r) {
      var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === r.run_id; });
      return {
        month: txt_(r.month), month_label: monthLabel_(r.month), employees: items.length,
        pf_employee: round0_(sum_(items, function (i) { return i.pf_employee; })),
        pf_employer: round0_(sum_(items, function (i) { return i.pf_employer; })),
        esic_employee: round0_(sum_(items, function (i) { return i.esic_employee; })),
        esic_employer: round0_(sum_(items, function (i) { return i.esic_employer; })),
        pt: round0_(sum_(items, function (i) { return i.pt; })),
        tds: round0_(sum_(items, function (i) { return i.tds; }))
      };
    });
    rows.forEach(function (r) {
      r.pf_total = r.pf_employee + r.pf_employer;
      r.esic_total = r.esic_employee + r.esic_employer;
      r.grand_total = r.pf_total + r.esic_total + r.pt + r.tds;
    });
    return {
      columns: [
        { key: 'month_label', label: 'Month' }, { key: 'employees', label: 'Employees', type: 'number' },
        { key: 'pf_employee', label: 'PF employee', type: 'money' }, { key: 'pf_employer', label: 'PF employer', type: 'money' },
        { key: 'esic_employee', label: 'ESIC employee', type: 'money' }, { key: 'esic_employer', label: 'ESIC employer', type: 'money' },
        { key: 'pt', label: 'Professional tax', type: 'money' }, { key: 'tds', label: 'TDS', type: 'money' },
        { key: 'grand_total', label: 'Total statutory', type: 'money' }
      ],
      rows: rows,
      totals: {
        Months: rows.length,
        'PF (both shares)': Reports.tot_(rows, 'pf_total'),
        'ESIC (both shares)': Reports.tot_(rows, 'esic_total'),
        'Professional tax': Reports.tot_(rows, 'pt'),
        TDS: Reports.tot_(rows, 'tds'),
        'Total statutory liability': Reports.tot_(rows, 'grand_total')
      },
      chart: {
        type: 'bar', labels: rows.map(function (r) { return r.month_label; }),
        series: [
          { label: 'PF', data: rows.map(function (r) { return r.pf_total; }) },
          { label: 'ESIC', data: rows.map(function (r) { return r.esic_total; }) },
          { label: 'PT', data: rows.map(function (r) { return r.pt; }) },
          { label: 'TDS', data: rows.map(function (r) { return r.tds; }) }
        ]
      },
      note: 'Due dates: PF by the 15th, ESIC by the 15th, professional tax as per your state, TDS by the 7th of the next month.'
    };
  },

  costByProject_: function (ctx, payload, period, c, maps) {
    var pairs = Reports.itemsForPeriod_(period, c, maps);
    var byProj = {};
    pairs.forEach(function (p) {
      var i = p.item;
      var pid = txt_(i.project_id) || 'UNASSIGNED';
      var proj = maps.projects[pid] || {};
      byProj[pid] = byProj[pid] || {
        project: txt_(proj.name) || 'Not on a project', project_code: txt_(proj.code), city: txt_(proj.city),
        employees: 0, man_days: 0, gross: 0, employer_cost: 0, ot_hours: 0, reimbursements: 0
      };
      var r = byProj[pid];
      r.employees++;
      r.man_days += numVal_(i.paid_days);
      r.gross += numVal_(i.gross_earnings);
      r.employer_cost += numVal_(i.ctc_cost);
      r.ot_hours += numVal_(i.ot_hours);
      r.reimbursements += numVal_(i.reimbursement);
    });
    var rows = Object.keys(byProj).map(function (k) {
      var r = byProj[k];
      r.man_days = round2_(r.man_days);
      r.gross = round0_(r.gross);
      r.employer_cost = round0_(r.employer_cost);
      r.ot_hours = round2_(r.ot_hours);
      r.reimbursements = round0_(r.reimbursements);
      r.cost_per_man_day = r.man_days > 0 ? round0_(r.employer_cost / r.man_days) : 0;
      return r;
    });
    rows = sortRows_(rows, 'employer_cost', 'DESC');
    return {
      columns: [
        { key: 'project', label: 'Project' }, { key: 'project_code', label: 'Code' }, { key: 'city', label: 'City' },
        { key: 'employees', label: 'Employees', type: 'number' }, { key: 'man_days', label: 'Man days', type: 'number' },
        { key: 'gross', label: 'Gross salary', type: 'money' }, { key: 'reimbursements', label: 'Reimbursements', type: 'money' },
        { key: 'employer_cost', label: 'Total cost', type: 'money' }, { key: 'ot_hours', label: 'OT hours', type: 'number' },
        { key: 'cost_per_man_day', label: 'Cost per man day', type: 'money' }
      ],
      rows: rows,
      totals: {
        Projects: rows.length,
        Employees: Reports.tot_(rows, 'employees'),
        'Man days': round2_(sum_(rows, function (r) { return r.man_days; })),
        'Total cost': Reports.tot_(rows, 'employer_cost')
      },
      chart: {
        type: 'bar', labels: rows.slice(0, 10).map(function (r) { return r.project; }),
        series: [{ label: 'Cost', data: rows.slice(0, 10).map(function (r) { return r.employer_cost; }) }]
      }
    };
  },

  documentExpiry_: function (ctx, payload, period, c, maps) {
    var horizon = txt_(payload.to) || isoAddDays_(todayIso_(), 60);
    var today = todayIso_();
    var rows = [];
    Db.all(c, 'EmployeeDocuments', function (d) {
      if (!txt_(d.expiry_date)) return false;
      return txt_(d.expiry_date) <= horizon;
    }).forEach(function (d) {
      var emp = maps.employees[txt_(d.employee_id)] || {};
      rows.push({
        scope: 'Employee', owner: txt_(emp.name), code: txt_(emp.code),
        document: txt_(d.doc_name || d.doc_type), category: txt_(d.doc_type),
        expiry_date: txt_(d.expiry_date), days_left: daysBetweenIso_(today, txt_(d.expiry_date)),
        status: txt_(d.expiry_date) < today ? 'EXPIRED' : 'EXPIRING', verified: boolVal_(d.verified) ? 'YES' : 'NO',
        file_id: txt_(d.file_id)
      });
    });
    Db.all(c, 'Documents', function (d) {
      if (!txt_(d.expiry_date)) return false;
      return txt_(d.expiry_date) <= horizon;
    }).forEach(function (d) {
      rows.push({
        scope: txt_(d.owner_type), owner: txt_(d.owner_name), code: '',
        document: txt_(d.title), category: txt_(d.category),
        expiry_date: txt_(d.expiry_date), days_left: daysBetweenIso_(today, txt_(d.expiry_date)),
        status: txt_(d.expiry_date) < today ? 'EXPIRED' : 'EXPIRING', verified: '',
        file_id: txt_(d.file_id)
      });
    });
    rows = sortRows_(rows, 'expiry_date', 'ASC');
    return {
      columns: [
        { key: 'scope', label: 'Applies to' }, { key: 'owner', label: 'Name' }, { key: 'code', label: 'Code' },
        { key: 'document', label: 'Document' }, { key: 'category', label: 'Category' },
        { key: 'expiry_date', label: 'Expires on', type: 'date' }, { key: 'days_left', label: 'Days left', type: 'number' },
        { key: 'status', label: 'Status', type: 'badge' }, { key: 'verified', label: 'Verified' }
      ],
      rows: rows,
      totals: {
        Tracked: rows.length,
        Expired: rows.filter(function (r) { return r.status === 'EXPIRED'; }).length,
        'Expiring in 30 days': rows.filter(function (r) { return r.days_left >= 0 && r.days_left <= 30; }).length
      },
      note: 'Watchlist up to ' + fmtDateHuman_(horizon) + '. Renew licences, insurance and certificates before they lapse.'
    };
  },

  /* ============================================================= export = */
  exportReport: function (ctx, payload) {
    Perm.require(ctx, 'reports.export');
    var out = Reports.run(ctx, payload);
    var keys = out.columns.map(function (col) { return col.key; });
    var csv = toCsv_(out.rows, keys);
    var name = 'FocusHR_' + out.report.code + '_' + (out.period.month || out.period.from) + '_' + todayIso_() + '.csv';
    Audit.write(ctx, {
      module: 'reports', action: 'reports.export', entity: 'Reports', entity_id: out.report.code,
      after: { report: out.report.code, rows: out.rows.length, period: out.period.label, filename: name },
      note: out.report.name + ' exported (' + out.rows.length + ' rows)'
    });
    var saved = null;
    if (txt_(payload.format).toUpperCase() === 'DRIVE' && out.rows.length) {
      try {
        var company = (ctx.companyCtx && ctx.companyCtx.company) || companyRow_(ctx.companyId);
        var file = Files.saveGenerated(ctx, {
          html: '', csv: csv, name: name, mime: 'csv', folder_key: 'report',
          fy: out.period.fy, month: out.period.month
        });
        saved = { file_id: file.getId(), file_name: file.getName(), url: file.getUrl() };
        Audit.write(ctx, {
          module: 'reports', action: 'reports.export.file', entity: 'Documents', entity_id: file.getId(),
          after: { report: out.report.code, filename: file.getName(), company: txt_(company.name) },
          note: out.report.name + ' saved to the company Drive folder as ' + file.getName()
        });
      } catch (e) {
        logEvent_('WARN', 'Reports.export', 'Could not save CSV to Drive: ' + e.message, { report: out.report.code });
      }
    }
    return {
      report: out.report, columns: out.columns, rows: out.rows.slice(0, 1000), row_count: out.rows.length,
      csv: out.rows.length > 1000 && !saved ? '' : csv,
      truncated: out.rows.length > 1000 && !saved,
      file: saved, file_name: name, period: out.period, totals: out.totals,
      message: saved
        ? out.report.name + ' saved to Drive as ' + name + '.'
        : out.report.name + ' ready — ' + out.rows.length + ' row(s).'
    };
  },

  exportAudit: function (ctx, payload) {
    Perm.require(ctx, 'reports.export');
    var isSuper = Perm.isSuper(ctx);
    if (!isSuper) Perm.require(ctx, 'audit.view');
    if (isSuper) Perm.require(ctx, 'system.health');
    var rows = Audit.list(ctx, { page: payload.page || 1, pageSize: payload.pageSize || 2000, search: payload.search }).rows;
    rows = rows.map(function (a) {
      return {
        when: txt_(a.at || a.created_at), actor: txt_(a.actor_name), actor_scope: txt_(a.actor_scope),
        action: txt_(a.action), module: txt_(a.module), entity: txt_(a.entity), entity_id: txt_(a.entity_id),
        severity: txt_(a.severity), note: txt_(a.note), ip: txt_(a.ip)
      };
    });
    var name = 'FocusHR_Audit_' + todayIso_() + '.csv';
    Audit.write(ctx, {
      module: 'audit', action: 'audit.export', entity: 'AuditLog', entity_id: '',
      after: { rows: rows.length, filename: name }, note: 'Audit trail exported (' + rows.length + ' rows)'
    });
    return {
      columns: [
        { key: 'when', label: 'When' }, { key: 'actor', label: 'Who' }, { key: 'action', label: 'Action' },
        { key: 'module', label: 'Module' }, { key: 'entity', label: 'Entity' }, { key: 'entity_id', label: 'Reference' },
        { key: 'severity', label: 'Severity' }, { key: 'note', label: 'What happened' }, { key: 'ip', label: 'IP address' }
      ],
      rows: rows.slice(0, 1000), row_count: rows.length,
      csv: toCsv_(rows, ['when', 'actor', 'actor_scope', 'action', 'module', 'entity', 'entity_id', 'severity', 'note', 'ip']),
      file_name: name
    };
  }
};
