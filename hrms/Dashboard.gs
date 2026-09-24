/**
 * ============================================================================
 *  FocusHR  —  Dashboard.gs
 *  Three home screens (company, manager, employee) plus the personal layout
 *  preferences that remember how each user likes their dashboard arranged.
 * ============================================================================
 */

var DASHBOARD_CARDS = {
  company: ['kpis', 'attendance_trend', 'pending_approvals', 'project_coverage', 'payroll_status', 'alerts', 'activity', 'quick_actions'],
  manager: ['team_today', 'pending_approvals', 'team_attendance', 'team_leaves', 'quick_actions'],
  employee: ['today', 'month_summary', 'leave_balance', 'latest_payslip', 'my_requests', 'holidays', 'quick_actions']
};

var Dashboard = {

  /* ============================================================ company == */
  company: function (ctx) {
    Perm.require(ctx, 'dashboard.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var today = todayIso_();
    var month = monthOfIso_(today);
    var employees = Db.all(c, 'Employees');
    var active = employees.filter(function (e) { return txt_(e.status) === 'ACTIVE' || txt_(e.status) === 'PROBATION'; });
    var attendanceToday = Db.all(c, 'Attendance', function (a) { return txt_(a.date) === today; });
    var projects = Db.all(c, 'Projects', function (p) { return txt_(p.status) === 'ACTIVE'; });
    var pendingLeaves = Db.all(c, 'LeaveRequests', function (l) { return txt_(l.status) === 'PENDING'; });
    var pendingRegs = Db.all(c, 'AttendanceRegularization', function (r) { return txt_(r.status) === 'PENDING'; });
    var pendingClaims = Db.all(c, 'ExpenseClaims', function (x) { return txt_(x.status) === 'SUBMITTED'; });
    var run = Db.findOne(c, 'PayrollRuns', function (r) { return txt_(r.month) === month && txt_(r.status) !== 'CANCELLED'; });
    var runIsCurrent = !!run;
    if (!run) {
      // Nothing started for this month yet — show the most recent run so the card is never empty.
      run = sortRows_(Db.all(c, 'PayrollRuns', function (r) { return txt_(r.status) !== 'CANCELLED'; }), 'month', 'DESC')[0] || null;
    }
    var openTickets = Db.all(c, 'Tickets', function (t) { return ['OPEN', 'IN_PROGRESS', 'WAITING'].indexOf(txt_(t.status)) >= 0; });

    /* Attendance trend — last 14 days. */
    var trend = [];
    for (var i = 13; i >= 0; i--) {
      var day = isoAddDays_(today, -i);
      var rows = Db.all(c, 'Attendance', function (a) { return txt_(a.date) === day; });
      trend.push({
        date: day, label: dayName_(day).slice(0, 3) + ' ' + day.slice(8, 10),
        present: rows.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
        absent: rows.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
        leave: rows.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length,
        ot_hours: round2_(sum_(rows, function (a) { return numVal_(a.overtime_minutes) / 60; }))
      });
    }

    /* Project coverage for today. */
    var coverage = projects.map(function (p) {
      var roster = Db.all(c, 'ProjectAssignments', function (a) {
        return txt_(a.project_id) === p.project_id && txt_(a.status) === 'ACTIVE';
      });
      var punched = attendanceToday.filter(function (a) { return txt_(a.project_id) === p.project_id; }).length;
      var present = attendanceToday.filter(function (a) {
        return txt_(a.project_id) === p.project_id && ['PRESENT', 'OD', 'HALF_DAY'].indexOf(txt_(a.status)) >= 0;
      }).length;
      return {
        project_id: txt_(p.project_id), name: txt_(p.name), city: txt_(p.city), code: txt_(p.code),
        deployed: roster.length, punched: punched, present: present,
        absent: Math.max(0, roster.length - present - attendanceToday.filter(function (a) {
          return txt_(a.project_id) === p.project_id && ['LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].indexOf(txt_(a.status)) >= 0;
        }).length),
        health: roster.length ? (present / roster.length >= 0.8 ? 'GOOD' : present / roster.length >= 0.5 ? 'WATCH' : 'LOW') : 'NA'
      };
    }).sort(function (a, b) { return b.deployed - a.deployed; });

    /* Compliance alerts. */
    var alerts = [];
    var noStructure = active.filter(function (e) {
      return !Db.findOne(c, 'SalaryStructures', function (s) { return txt_(s.employee_id) === e.employee_id && boolVal_(s.is_active); });
    });
    if (noStructure.length) {
      alerts.push({
        severity: 'WARN', title: noStructure.length + ' employee(s) have no salary structure',
        body: 'Payroll will skip them until a structure is added.', action: 'employees.list',
        payload: { filter: 'NO_STRUCTURE' }
      });
    }
    var expiring = Documents.expiring_(c, 30);
    if (expiring.length) {
      alerts.push({
        severity: expiring.filter(function (e) { return e.expiry_date < today; }).length ? 'ERROR' : 'WARN',
        title: expiring.length + ' document(s) expire in the next 30 days',
        body: expiring.slice(0, 3).map(function (e) { return e.title + ' (' + e.expiry_date + ')'; }).join(', '),
        action: 'reports.run', payload: { report: 'document_expiry' }
      });
    }
    var unverified = Db.all(c, 'EmployeeDocuments', function (d) { return !boolVal_(d.verified); });
    if (unverified.length) {
      alerts.push({
        severity: 'INFO', title: unverified.length + ' employee document(s) not verified yet',
        body: 'Open the employee profile → Documents and mark them verified.', action: 'employees.list', payload: {}
      });
    }
    var noPan = active.filter(function (e) { return !txt_(e.pan); });
    if (noPan.length) {
      alerts.push({
        severity: 'WARN', title: noPan.length + ' employee(s) have no PAN',
        body: 'TDS cannot be deducted correctly without a PAN.', action: 'employees.list', payload: {}
      });
    }

    var headcountByDept = {};
    active.forEach(function (e) {
      var d = txt_(e.department) || 'Unassigned';
      headcountByDept[d] = (headcountByDept[d] || 0) + 1;
    });

    var paidDaysMonth = Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.status) === 'APPROVED' && monthOfIso_(l.from_date) === month;
    });

    return {
      scope: 'COMPANY',
      generated_at: nowIso_(),
      today: today, month: month, month_label: monthLabel_(month),
      cards: Dashboard.layoutFor_(ctx, 'company'),
      kpis: [
        { key: 'headcount', label: 'Active employees', value: active.length, sub: employees.length - active.length + ' not active', icon: 'users', tone: 'blue' },
        { key: 'present', label: 'Present today', value: attendanceToday.filter(function (a) { return ['PRESENT', 'OD'].indexOf(txt_(a.status)) >= 0; }).length, sub: 'out of ' + active.length, icon: 'check', tone: 'green' },
        { key: 'absent', label: 'Absent today', value: attendanceToday.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length, sub: 'unplanned absence', icon: 'x', tone: 'red' },
        { key: 'on_leave', label: 'On leave today', value: attendanceToday.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length, sub: paidDaysMonth.length + ' applications this month', icon: 'calendar', tone: 'amber' },
        { key: 'pending', label: 'Pending approvals', value: pendingLeaves.length + pendingRegs.length + pendingClaims.length, sub: pendingLeaves.length + ' leave · ' + pendingRegs.length + ' attendance · ' + pendingClaims.length + ' claims', icon: 'hourglass', tone: 'violet' },
        { key: 'payroll', label: 'Payroll ' + monthLabel_(month), value: run ? txt_(run.status) : 'NOT STARTED', sub: run ? intVal_(run.total_employees) + ' employees · ₹' + Number(round0_(run.total_net)).toLocaleString('en-IN') : 'Create the run when attendance is closed', icon: 'wallet', tone: run && txt_(run.status) === 'PAID' ? 'green' : 'amber' }
      ],
      attendance_trend: trend,
      trend_totals: {
        avg_present: trend.length ? Math.round(sum_(trend, function (t) { return t.present; }) / trend.length) : 0,
        avg_absent: trend.length ? Math.round(sum_(trend, function (t) { return t.absent; }) / trend.length) : 0,
        ot_hours: round2_(sum_(trend, function (t) { return t.ot_hours; }))
      },
      pending_approvals: {
        leave: pendingLeaves.slice(0, 6).map(function (l) {
          return { id: l.request_id, title: txt_(l.employee_name), detail: txt_(l.leave_type_name) + ' · ' + numVal_(l.days) + ' day(s)', from: txt_(l.from_date), to: txt_(l.to_date), at: txt_(l.applied_at), link: 'leave.requests.list' };
        }),
        regularization: pendingRegs.slice(0, 6).map(function (r) {
          return { id: r.request_id, title: txt_(r.employee_name), detail: 'Attendance fix for ' + fmtDateHuman_(r.date) + ' → ' + txt_(r.requested_status), from: txt_(r.date), to: txt_(r.date), at: txt_(r.created_at), link: 'attendance.regularize.list' };
        }),
        expense: pendingClaims.slice(0, 6).map(function (x) {
          return { id: x.claim_id, title: txt_(x.employee_name), detail: txt_(x.category_name) + ' · ₹' + Number(round0_(x.net_amount)).toLocaleString('en-IN'), from: txt_(x.claim_date), to: txt_(x.claim_date), at: txt_(x.submitted_at), link: 'expense.claims.list' };
        })
      },
      project_coverage: coverage,
      headcount_by_department: Object.keys(headcountByDept).map(function (k) { return { department: k, count: headcountByDept[k] }; })
        .sort(function (a, b) { return b.count - a.count; }),
      payroll_status: run ? {
        run_id: txt_(run.run_id), code: txt_(run.code), status: txt_(run.status), month_label: monthLabel_(run.month),
        is_current_month: runIsCurrent, month: txt_(run.month),
        employees: intVal_(run.total_employees), gross: numVal_(run.total_gross), net: numVal_(run.total_net),
        deductions: numVal_(run.total_deductions), employer_cost: numVal_(run.total_employer_cost),
        calculated_at: txt_(run.calculated_at), approved_at: txt_(run.approved_at), paid_at: txt_(run.paid_at),
        payslips: intVal_(run.payslips_generated)
      } : null,
      alerts: alerts,
      activity: Audit.recent(ctx, 12),
      open_tickets: openTickets.length,
      quick_actions: Dashboard.quickActions_(ctx, 'company'),
      upcoming_holidays: Db.all(c, 'Holidays', function (h) {
        return txt_(h.date) >= today;
      }).sort(function (a, b) { return txt_(a.date) < txt_(b.date) ? -1 : 1; }).slice(0, 4).map(function (h) {
        return { name: txt_(h.name), date: txt_(h.date), label: fmtDateHuman_(h.date), kind: txt_(h.kind) };
      })
    };
  },

  /* ============================================================ employee = */
  employee: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) {
      return { scope: 'EMPLOYEE', not_linked: true, cards: Dashboard.layoutFor_(ctx, 'employee'),
        message: 'This login is not linked to an employee record yet. Ask HR to link your profile to start punching attendance.' };
    }
    var employee = Db.get(c, 'Employees', 'employee_id', ctx.employeeId);
    var today = todayIso_();
    var month = monthOfIso_(today);
    var todayRow = Db.findOne(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === ctx.employeeId && txt_(a.date) === today;
    });
    var myAttendance = Db.all(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === ctx.employeeId && txt_(a.date) >= monthStart_(month) && txt_(a.date) <= monthEnd_(month);
    });
    var balances = Db.all(c, 'LeaveBalances', function (b) {
      return txt_(b.employee_id) === ctx.employeeId && txt_(b.fy) === fyOf_(today);
    }).map(function (b) {
      return {
        leave_type_id: txt_(b.leave_type_id), code: txt_(b.leave_type_code),
        closing: round2_(numVal_(b.closing)), accrued: round2_(numVal_(b.accrued)), used: round2_(numVal_(b.used))
      };
    });
    var latestPayslip = (function () {
      var rows = sortRows_(Db.all(c, 'Payslips', function (p) { return txt_(p.employee_id) === ctx.employeeId; }), 'month', 'DESC');
      return rows.length ? {
        payslip_id: txt_(rows[0].payslip_id), code: txt_(rows[0].code), month: txt_(rows[0].month),
        month_label: monthLabel_(rows[0].month), net_pay: numVal_(rows[0].net_pay), file_id: txt_(rows[0].file_id),
        has_file: !!txt_(rows[0].file_id)
      } : null;
    })();
    var pending = {
      leave: Db.all(c, 'LeaveRequests', function (l) { return txt_(l.employee_id) === ctx.employeeId && txt_(l.status) === 'PENDING'; }).length,
      regularization: Db.all(c, 'AttendanceRegularization', function (r) { return txt_(r.employee_id) === ctx.employeeId && txt_(r.status) === 'PENDING'; }).length,
      expense: Db.all(c, 'ExpenseClaims', function (x) { return txt_(x.employee_id) === ctx.employeeId && ['DRAFT', 'SUBMITTED'].indexOf(txt_(x.status)) >= 0; }).length
    };
    var project = txt_(employee.project_id) ? Db.find(c, 'Projects', 'project_id', employee.project_id) : null;

    return {
      scope: 'EMPLOYEE',
      generated_at: nowIso_(),
      employee: {
        employee_id: txt_(employee.employee_id), name: txt_(employee.name), code: txt_(employee.code),
        designation: txt_(employee.designation), department: txt_(employee.department),
        project_name: project ? txt_(project.name) : '', project_city: project ? txt_(project.city) : '',
        photo_file_id: txt_(employee.photo_file_id), phone: maskPhone_(employee.phone),
        status: txt_(employee.status), joining_date: txt_(employee.joining_date)
      },
      today: {
        date: today, label: fmtDateHuman_(today), day: dayName_(today),
        attendance_id: todayRow ? txt_(todayRow.attendance_id) : '',
        status: todayRow ? txt_(todayRow.status) : '',
        in_time: todayRow ? txt_(todayRow.in_time) : '', out_time: todayRow ? txt_(todayRow.out_time) : '',
        worked_minutes: todayRow ? intVal_(todayRow.worked_minutes) : 0,
        worked_label: todayRow ? hoursLabel_(todayRow.worked_minutes) : '',
        project_name: todayRow ? txt_(todayRow.project_name) : (project ? txt_(project.name) : ''),
        can_punch_in: !todayRow || !txt_(todayRow.in_time),
        can_punch_out: !!todayRow && !!txt_(todayRow.in_time) && !txt_(todayRow.out_time),
        late_minutes: todayRow ? intVal_(todayRow.late_minutes) : 0,
        overtime_label: todayRow && intVal_(todayRow.overtime_minutes) > 0 ? hoursLabel_(todayRow.overtime_minutes) : '',
        is_holiday: (function () {
          var h = Db.findOne(c, 'Holidays', function (x) { return txt_(x.date) === today; });
          return h ? txt_(h.name) : '';
        })()
      },
      month_summary: {
        month: month, month_label: monthLabel_(month),
        present: myAttendance.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
        half_day: myAttendance.filter(function (a) { return txt_(a.status) === 'HALF_DAY'; }).length,
        absent: myAttendance.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
        leave: myAttendance.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length,
        weekly_off: myAttendance.filter(function (a) { return txt_(a.status) === 'WEEKLY_OFF'; }).length,
        holiday: myAttendance.filter(function (a) { return txt_(a.status) === 'HOLIDAY'; }).length,
        worked_hours: round2_(sum_(myAttendance, function (a) { return numVal_(a.worked_minutes) / 60; })),
        ot_hours: round2_(sum_(myAttendance, function (a) { return numVal_(a.overtime_minutes) / 60; })),
        late_marks: myAttendance.filter(function (a) { return intVal_(a.late_minutes) > 0; }).length
      },
      leave_balance: balances,
      latest_payslip: latestPayslip,
      pending: pending,
      my_requests: {
        leave: sortRows_(Db.all(c, 'LeaveRequests', function (l) { return txt_(l.employee_id) === ctx.employeeId; }), 'applied_at', 'DESC').slice(0, 5).map(function (l) {
          return { request_id: txt_(l.request_id), kind: 'LEAVE', title: txt_(l.leave_type_name), detail: fmtDateHuman_(l.from_date) + ' → ' + fmtDateHuman_(l.to_date), status: txt_(l.status), days: numVal_(l.days) };
        }),
        expense: sortRows_(Db.all(c, 'ExpenseClaims', function (x) { return txt_(x.employee_id) === ctx.employeeId; }), 'created_at', 'DESC').slice(0, 5).map(function (x) {
          return { claim_id: txt_(x.claim_id), kind: 'EXPENSE', title: txt_(x.category_name), detail: '₹' + Number(round0_(x.net_amount)).toLocaleString('en-IN') + ' · ' + fmtDateHuman_(x.claim_date), status: txt_(x.status) };
        })
      },
      holidays: Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= today; })
        .sort(function (a, b) { return txt_(a.date) < txt_(b.date) ? -1 : 1; }).slice(0, 5)
        .map(function (h) { return { name: txt_(h.name), date: txt_(h.date), label: fmtDateHuman_(h.date), kind: txt_(h.kind) }; }),
      notifications: Notify.list(ctx, { page: 1, pageSize: 6 }).rows,
      unread: Notify.unreadCount(ctx).unread,
      cards: Dashboard.layoutFor_(ctx, 'employee'),
      quick_actions: Dashboard.quickActions_(ctx, 'employee')
    };
  },

  /* ============================================================= manager = */
  manager: function (ctx) {
    Perm.require(ctx, 'dashboard.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var today = todayIso_();
    var allowed = Perm.allowedEmployeeIds(ctx);
    var team = Db.all(c, 'Employees', function (e) {
      if (allowed) return allowed.indexOf(txt_(e.employee_id)) >= 0;
      return txt_(e.manager_id) === ctx.employeeId;
    });
    var teamIds = team.map(function (e) { return txt_(e.employee_id); });
    var attendanceToday = Db.all(c, 'Attendance', function (a) {
      return txt_(a.date) === today && teamIds.indexOf(txt_(a.employee_id)) >= 0;
    });
    var byEmp = {};
    attendanceToday.forEach(function (a) { byEmp[txt_(a.employee_id)] = a; });
    var pendingLeaves = Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.status) === 'PENDING' && teamIds.indexOf(txt_(l.employee_id)) >= 0;
    });
    var pendingRegs = Db.all(c, 'AttendanceRegularization', function (r) {
      return txt_(r.status) === 'PENDING' && teamIds.indexOf(txt_(r.employee_id)) >= 0;
    });
    var pendingClaims = Db.all(c, 'ExpenseClaims', function (x) {
      return txt_(x.status) === 'SUBMITTED' && teamIds.indexOf(txt_(x.employee_id)) >= 0;
    });
    return {
      scope: 'MANAGER',
      generated_at: nowIso_(),
      today: today,
      cards: Dashboard.layoutFor_(ctx, 'manager'),
      team_size: team.length,
      team_today: team.map(function (e) {
        var a = byEmp[txt_(e.employee_id)];
        return {
          employee_id: txt_(e.employee_id), code: txt_(e.code), name: txt_(e.name),
          designation: txt_(e.designation), department: txt_(e.department),
          status: a ? txt_(a.status) : 'NOT_MARKED',
          in_time: a ? txt_(a.in_time) : '', out_time: a ? txt_(a.out_time) : '',
          project_name: a ? txt_(a.project_name) : '',
          flagged: a ? boolVal_(a.flagged) : false,
          ot_label: a && intVal_(a.overtime_minutes) > 0 ? hoursLabel_(a.overtime_minutes) : ''
        };
      }),
      kpis: [
        { key: 'team', label: 'Team size', value: team.length, sub: 'active reporting lines' },
        { key: 'present', label: 'Present today', value: attendanceToday.filter(function (a) { return ['PRESENT', 'OD'].indexOf(txt_(a.status)) >= 0; }).length, sub: '' },
        { key: 'absent', label: 'Absent today', value: attendanceToday.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length, sub: '' },
        { key: 'pending', label: 'Waiting for you', value: pendingLeaves.length + pendingRegs.length + pendingClaims.length, sub: pendingLeaves.length + ' leave · ' + pendingRegs.length + ' attendance · ' + pendingClaims.length + ' claims' }
      ],
      pending_approvals: {
        leave: pendingLeaves.map(function (l) {
          return { id: l.request_id, title: txt_(l.employee_name), detail: txt_(l.leave_type_name) + ' · ' + numVal_(l.days) + ' day(s)', from: txt_(l.from_date), to: txt_(l.to_date), at: txt_(l.applied_at), link: 'leave.requests.list' };
        }),
        regularization: pendingRegs.map(function (r) {
          return { id: r.request_id, title: txt_(r.employee_name), detail: txt_(r.requested_status) + ' for ' + fmtDateHuman_(r.date), from: txt_(r.date), to: txt_(r.date), at: txt_(r.created_at), link: 'attendance.regularize.list' };
        }),
        expense: pendingClaims.map(function (x) {
          return { id: x.claim_id, title: txt_(x.employee_name), detail: txt_(x.category_name) + ' · ₹' + Number(round0_(x.net_amount)).toLocaleString('en-IN'), from: txt_(x.claim_date), to: txt_(x.claim_date), at: txt_(x.submitted_at), link: 'expense.claims.list' };
        })
      },
      team_attendance: (function () {
        var rows = [];
        for (var i = 6; i >= 0; i--) {
          var day = isoAddDays_(today, -i);
          var dayRows = Db.all(c, 'Attendance', function (a) {
            return txt_(a.date) === day && teamIds.indexOf(txt_(a.employee_id)) >= 0;
          });
          rows.push({
            date: day, label: dayName_(day).slice(0, 3) + ' ' + day.slice(8, 10),
            present: dayRows.filter(function (a) { return ['PRESENT', 'OD'].indexOf(txt_(a.status)) >= 0; }).length,
            absent: dayRows.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
            leave: dayRows.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length
          });
        }
        return rows;
      })(),
      quick_actions: Dashboard.quickActions_(ctx, 'manager'),
      activity: Audit.recent(ctx, 8, function (r) { return teamIds.indexOf(txt_(r.entity_id)) >= 0; })
    };
  },

  /* ============================================================ layout == */
  layoutFor_: function (ctx, scope) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var row = Db.findOne(c, 'DashboardLayouts', function (l) {
      return txt_(l.user_id) === ctx.userId && txt_(l.scope) === scope && boolVal_(l.is_default);
    });
    var custom = row ? safeJson_(row.layout_json, null) : null;
    var defaults = DASHBOARD_CARDS[scope] || DASHBOARD_CARDS.company;
    return {
      scope: scope,
      order: custom && custom.order && custom.order.length ? custom.order : defaults,
      hidden: custom && custom.hidden ? custom.hidden : [],
      available: defaults,
      is_custom: !!custom
    };
  },

  layoutGet: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'DashboardLayouts', function (l) { return txt_(l.user_id) === ctx.userId; });
    return {
      company: Dashboard.layoutFor_(ctx, 'company'),
      manager: Dashboard.layoutFor_(ctx, 'manager'),
      employee: Dashboard.layoutFor_(ctx, 'employee'),
      saved_scopes: rows.map(function (l) { return { scope: txt_(l.scope), is_default: boolVal_(l.is_default), updated_at: txt_(l.updated_at) }; }),
      available_cards: DASHBOARD_CARDS
    };
  },

  layoutSave: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var scope = txt_(payload.scope).toLowerCase();
    if (!DASHBOARD_CARDS[scope]) fail_('VALIDATION', 'Unknown dashboard: ' + scope, { field: 'scope' });
    var layout = payload.layout || {};
    var allowed = DASHBOARD_CARDS[scope];
    var order = (layout.order || []).filter(function (k) { return allowed.indexOf(k) >= 0; });
    allowed.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    var hidden = (layout.hidden || []).filter(function (k) { return allowed.indexOf(k) >= 0; });
    var existing = Db.findOne(c, 'DashboardLayouts', function (l) {
      return txt_(l.user_id) === ctx.userId && txt_(l.scope) === scope;
    });
    var patch = {
      user_id: ctx.userId, scope: scope, is_default: 'TRUE',
      layout_json: jsonStr_({ order: order, hidden: hidden, saved_at: nowIso_() })
    };
    var row = existing
      ? Db.update(c, 'DashboardLayouts', 'layout_id', existing.layout_id, patch, { actor: ctx.userId })
      : Db.insert(c, 'DashboardLayouts', patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'dashboard', action: 'dashboard.layout.save', entity: 'DashboardLayouts', entity_id: row.layout_id,
      after: { scope: scope, order: order, hidden: hidden },
      note: 'Dashboard layout saved for ' + scope
    });
    return { layout: Dashboard.layoutFor_(ctx, scope), message: 'Dashboard layout saved.' };
  },

  quickActions_: function (ctx, scope) {
    var out = [];
    var can = function (p) { return !p || Perm.has(ctx, p); };
    if (scope === 'company') {
      if (can('employees.create')) out.push({ action: 'employees.save', label: 'Add employee', icon: 'user-plus', kind: 'primary' });
      if (can('projects.create')) out.push({ action: 'projects.save', label: 'Add project', icon: 'hard-hat' });
      if (can('attendance.create')) out.push({ action: 'attendance.manual.save', label: 'Mark attendance', icon: 'calendar-check' });
      if (can('payroll.create')) out.push({ action: 'payroll.runs.create', label: 'Run payroll', icon: 'wallet' });
      if (can('reports.view')) out.push({ action: 'reports.catalog', label: 'Reports', icon: 'chart' });
      if (can('settings.manage')) out.push({ action: 'company.settings.get', label: 'Settings', icon: 'cog' });
    } else if (scope === 'manager') {
      if (can('attendance.create')) out.push({ action: 'attendance.manual.save', label: 'Mark attendance', icon: 'calendar-check', kind: 'primary' });
      if (can('attendance.approve')) out.push({ action: 'attendance.regularize.list', label: 'Attendance requests', icon: 'clock' });
      if (can('leave.approve')) out.push({ action: 'leave.requests.list', label: 'Leave requests', icon: 'calendar' });
      if (can('reports.view')) out.push({ action: 'reports.run', label: 'Attendance summary', icon: 'chart' });
    } else {
      out.push({ action: 'attendance.punch.in', label: 'Punch In', icon: 'log-in', kind: 'primary' });
      out.push({ action: 'attendance.punch.out', label: 'Punch Out', icon: 'log-out' });
      out.push({ action: 'leave.apply', label: 'Leave request', icon: 'calendar' });
      out.push({ action: 'expense.claims.save', label: 'Expense claim', icon: 'receipt' });
      out.push({ action: 'payroll.my.payslips', label: 'My payslips', icon: 'file-text' });
    }
    return out;
  }
};
