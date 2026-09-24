/**
 * ============================================================================
 *  FocusHR  —  Leave.gs
 *  Leave types, balances, applications, approvals, the team leave calendar,
 *  special requests (advance / overtime / comp-off / medical and more) and the
 *  holiday list employees can see on their phone.
 * ============================================================================
 */

var Leave = {

  /* =============================================================== types = */
  typesList: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'LeaveTypes', function (t) { return boolVal_(t.is_active) !== false; });
    return {
      rows: sortRows_(rows.map(function (t) {
        return {
          leave_type_id: t.leave_type_id, code: t.code, name: t.name, is_paid: boolVal_(t.is_paid),
          accrual_per_month: numVal_(t.accrual_per_month), max_balance: numVal_(t.max_balance),
          carry_forward: boolVal_(t.carry_forward), requires_doc: boolVal_(t.requires_doc),
          max_consecutive_days: intVal_(t.max_consecutive_days, 30), color: txt_(t.color) || '#64748b',
          sort_order: intVal_(t.sort_order, 9)
        };
      }), 'sort_order', 'ASC')
    };
  },

  /* ============================================================ balances = */
  balanceKey_: function (employeeId, leaveTypeId, fy) { return txt_(employeeId) + '|' + txt_(leaveTypeId) + '|' + txt_(fy); },

  ensureBalance_: function (ctx, employee, leaveType, fy) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var key = Leave.balanceKey_(employee.employee_id, leaveType.leave_type_id, fy);
    var cached = memoGet_('__lb_' + key);
    if (cached) return cached;
    var row = Db.findOne(c, 'LeaveBalances', function (b) { return Leave.balanceKey_(b.employee_id, b.leave_type_id, b.fy) === key; });
    if (!row) {
      var monthsElapsed = Leave.monthsElapsed_(fy, employee);
      var accrued = round2_(numVal_(leaveType.accrual_per_month) * monthsElapsed);
      if (numVal_(leaveType.max_balance) > 0) accrued = Math.min(accrued, numVal_(leaveType.max_balance));
      row = Db.insert(c, 'LeaveBalances', {
        employee_id: employee.employee_id, employee_name: txt_(employee.name), leave_type_id: leaveType.leave_type_id,
        leave_type_code: txt_(leaveType.code), fy: fy,
        opening: 0, accrued: accrued, used: 0, lapsed: 0, closing: accrued,
        note: 'Created automatically (' + monthsElapsed + ' month accrual credited)'
      }, { actor: ctx.userId });
      memoSet_('__lb_' + key, row);
    }
    return row;
  },

  monthsElapsed_: function (fy, employee) {
    var start = fyStartYear_(fy) + '-04-01';
    var today = todayIso_();
    var join = txt_(employee.joining_date) && txt_(employee.joining_date) > start ? txt_(employee.joining_date) : start;
    if (join > today) return 0;
    var diff = (Number(today.slice(0, 4)) - Number(join.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(join.slice(5, 7)));
    return Math.max(0, Math.min(12, diff + 1));
  },

  balancesList: function (ctx, payload) {
    Perm.require(ctx, 'leave.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var fy = txt_(payload.fy || fyOf_(todayIso_()));
    var allowed = Perm.allowedEmployeeIds(ctx);
    var employees = Perm.filterEmployees(ctx, Db.all(c, 'Employees', function (e) {
      if (txt_(e.status).toUpperCase() === 'EXITED') return false;
      if (payload.department && txt_(e.department) !== txt_(payload.department)) return false;
      return true;
    }));
    if (payload.employee_id) employees = employees.filter(function (e) { return txt_(e.employee_id) === payload.employee_id; });
    if (payload.search) employees = employees.filter(function (e) { return matchesSearch_(e, SCHEMA.Employees.search, payload.search); });

    var types = Db.all(c, 'LeaveTypes', function (t) { return boolVal_(t.is_active) !== false; });
    var all = Db.all(c, 'LeaveBalances', function (b) { return txt_(b.fy) === fy; });
    var map = {};
    all.forEach(function (b) { map[Leave.balanceKey_(b.employee_id, b.leave_type_id, b.fy)] = b; });

    var rows = employees.map(function (e) {
      var balances = {}; var totalClosing = 0;
      types.forEach(function (t) {
        var b = map[Leave.balanceKey_(e.employee_id, t.leave_type_id, fy)];
        var closing = b ? round2_(numVal_(b.opening) + numVal_(b.accrued) - numVal_(b.used) - numVal_(b.lapsed)) : 0;
        balances[txt_(t.code)] = {
          leave_type_id: t.leave_type_id, name: t.name, code: t.code,
          opening: b ? numVal_(b.opening) : 0, accrued: b ? numVal_(b.accrued) : 0,
          used: b ? numVal_(b.used) : 0, lapsed: b ? numVal_(b.lapsed) : 0, closing: closing,
          balance_id: b ? b.employee_id && b.balance_id : ''
        };
        if (boolVal_(t.is_paid)) totalClosing += closing;
      });
      return {
        employee_id: e.employee_id, code: e.code, name: e.name, department: e.department, designation: e.designation,
        joining_date: e.joining_date, status: e.status, balances: balances, paid_balance_total: round2_(totalClosing)
      };
    });
    rows = sortRows_(rows, 'name', 'ASC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows, total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      fy: fy, fy_options: Leave.fyOptions_(),
      types: types.map(function (t) { return { leave_type_id: t.leave_type_id, code: t.code, name: t.name, is_paid: boolVal_(t.is_paid) }; })
    };
  },

  fyOptions_: function () {
    var out = [], current = fyOf_(todayIso_());
    var start = fyStartYear_(current);
    for (var i = -2; i <= 1; i++) out.push((start + i) + '-' + String((start + i + 1) % 100).padStart(2, '0'));
    return out.reverse();
  },

  balancesMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], fy: fyOf_(todayIso_()) };
    var employee = Attendance.employeeRecord_(ctx);
    var fy = txt_(payload.fy || fyOf_(todayIso_()));
    var types = Db.all(c, 'LeaveTypes', function (t) { return boolVal_(t.is_active) !== false; });
    var rows = types.map(function (t) {
      var b = Leave.ensureBalance_(ctx, employee, t, fy);
      var closing = round2_(numVal_(b.opening) + numVal_(b.accrued) - numVal_(b.used) - numVal_(b.lapsed));
      return {
        leave_type_id: t.leave_type_id, code: t.code, name: t.name, color: txt_(t.color) || '#64748b',
        is_paid: boolVal_(t.is_paid), opening: numVal_(b.opening), accrued: numVal_(b.accrued), used: numVal_(b.used),
        closing: closing, max_balance: numVal_(t.max_balance), requires_doc: boolVal_(t.requires_doc),
        max_consecutive_days: intVal_(t.max_consecutive_days, 30)
      };
    });
    var pending = Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.employee_id) === employee.employee_id && txt_(l.status) === 'PENDING';
    });
    return {
      rows: rows, fy: fy, fy_options: Leave.fyOptions_(),
      summary: {
        total_available: round2_(sum_(rows.filter(function (r) { return r.is_paid; }), function (r) { return r.closing; })),
        used_this_fy: round2_(sum_(rows, function (r) { return r.used; })),
        pending_requests: pending.length,
        pending_days: round2_(sum_(pending, function (r) { return r.days; }))
      }
    };
  },

  balancesSave: function (ctx, payload) {
    Perm.require(ctx, 'leave.edit');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var type = Db.get(c, 'LeaveTypes', 'leave_type_id', payload.leave_type_id);
    var patch = {
      employee_id: employee.employee_id, employee_name: txt_(employee.name), leave_type_id: type.leave_type_id,
      leave_type_code: txt_(type.code), fy: payload.fy,
      opening: numVal_(payload.opening), accrued: numVal_(payload.accrued), used: numVal_(payload.used),
      lapsed: numVal_(payload.lapsed), note: payload.note
    };
    patch.closing = round2_(patch.opening + patch.accrued - patch.used - patch.lapsed);
    var key = Leave.balanceKey_(patch.employee_id, patch.leave_type_id, patch.fy);
    var existing = Db.findOne(c, 'LeaveBalances', function (b) { return Leave.balanceKey_(b.employee_id, b.leave_type_id, b.fy) === key; });
    var row;
    if (existing) {
      row = Db.update(c, 'LeaveBalances', 'balance_id', existing.balance_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'leave', action: 'leave.balances.save', entity: 'LeaveBalances', entity_id: row.balance_id,
        before: { opening: numVal_(existing.opening), accrued: numVal_(existing.accrued), used: numVal_(existing.used), lapsed: numVal_(existing.lapsed) },
        after: { opening: patch.opening, accrued: patch.accrued, used: patch.used, lapsed: patch.lapsed },
        note: 'Leave balance adjusted for ' + txt_(employee.name) + ' (' + txt_(type.code) + ', FY ' + patch.fy + ')' + (payload.note ? ' — ' + payload.note : ''), severity: 'SENSITIVE'
      });
    } else {
      row = Db.insert(c, 'LeaveBalances', patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'leave', action: 'leave.balances.save', entity: 'LeaveBalances', entity_id: row.balance_id,
        after: patch, note: 'Leave balance created for ' + txt_(employee.name) + ' (' + txt_(type.code) + ', FY ' + patch.fy + ')', severity: 'SENSITIVE'
      });
    }
    memoDrop_('__lb_' + key);
    return { balance_id: row.balance_id, closing: patch.closing };
  },

  /** Credit one month of accrual to everybody (idempotent per month). */
  balancesAccrue: function (ctx, payload) {
    Perm.require(ctx, 'leave.manage');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var fy = payload.fy;
    var month = txt_(payload.month || monthOfIso_(todayIso_()));
    var guardKey = 'accrual:' + ctx.companyId + ':' + month;
    var guard = Db.findOne(c, 'Counters', function (r) { return txt_(r.key) === guardKey; });
    if (guard) fail_('ALREADY_DONE', 'Leave accrual for ' + monthLabel_(month) + ' has already been run.');
    var employees = Db.all(c, 'Employees', function (e) {
      if (txt_(e.status).toUpperCase() === 'EXITED') return false;
      if (payload.department && txt_(e.department) !== txt_(payload.department)) return false;
      return true;
    });
    var types = Db.all(c, 'LeaveTypes', function (t) {
      return boolVal_(t.is_active) !== false && numVal_(t.accrual_per_month) > 0;
    });
    var credited = 0;
    employees.forEach(function (e) {
      types.forEach(function (t) {
        var b = Leave.ensureBalance_(ctx, e, t, fy);
        var accrued = round2_(numVal_(b.accrued) + numVal_(t.accrual_per_month));
        if (numVal_(t.max_balance) > 0) accrued = Math.min(accrued, numVal_(t.max_balance));
        Db.update(c, 'LeaveBalances', 'balance_id', b.balance_id, {
          accrued: accrued, closing: round2_(numVal_(b.opening) + accrued - numVal_(b.used) - numVal_(b.lapsed))
        }, { actor: ctx.userId });
        memoDrop_('__lb_' + Leave.balanceKey_(e.employee_id, t.leave_type_id, fy));
        credited++;
      });
    });
    Db.insert(c, 'Counters', { key: guardKey, prefix: 'ACR', next_no: credited, width: 4, note: 'leave accrual ' + month }, { system: true });
    Audit.write(ctx, {
      module: 'leave', action: 'leave.balances.accrue', entity: 'LeaveBalances', entity_id: '',
      after: { month: month, fy: fy, employees: employees.length, credits: credited },
      note: 'Monthly leave accrual run for ' + monthLabel_(month)
    });
    return { month: month, fy: fy, employees: employees.length, credits: credited };
  },

  /* ============================================================ requests = */
  workingDays_: function (ctx, c, employee, from, to, halfDay) {
    var weekOff = txt_(getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY'));
    if (txt_(employee.project_id)) {
      var p = Db.find(c, 'Projects', 'project_id', employee.project_id);
      if (p && txt_(p.weekly_off)) weekOff = txt_(p.weekly_off);
    }
    var holidays = {};
    Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= from && txt_(h.date) <= to; })
      .forEach(function (h) { holidays[txt_(h.date)] = txt_(h.name); });
    var days = 0, skipped = [];
    isoRange_(from, to).forEach(function (d) {
      if (holidays[d]) { skipped.push({ date: d, reason: 'Holiday: ' + holidays[d] }); return; }
      if (isWeekOff_(d, weekOff)) { skipped.push({ date: d, reason: 'Weekly off' }); return; }
      days++;
    });
    if (halfDay) days = days > 0 ? 0.5 : 0;
    return { days: round2_(days), skipped: skipped };
  },

  apply: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) fail_('EMPLOYEE_ONLY', 'Leave requests are raised from an employee login. Admins can add leave on the employee\'s behalf from the attendance register.');
    var employee = Attendance.employeeRecord_(ctx);
    var type = Db.get(c, 'LeaveTypes', 'leave_type_id', payload.leave_type_id);
    if (boolVal_(type.is_active) === false) fail_('NOT_ALLOWED', txt_(type.name) + ' is not available right now.');
    if (payload.from_date > payload.to_date) fail_('VALIDATION', 'The "from" date must be before the "to" date.', { field: 'from_date' });
    if (payload.is_half_day && payload.from_date !== payload.to_date) fail_('VALIDATION', 'A half day must be on a single date.');
    var maxConsecutive = intVal_(type.max_consecutive_days, getSettingNum_(ctx, 'leave.max_consecutive_days', 15));
    var span = daysBetweenIso_(payload.from_date, payload.to_date) + 1;
    if (span > maxConsecutive) fail_('VALIDATION', txt_(type.name) + ' can be taken for at most ' + maxConsecutive + ' day(s) at a time. Please split the request.');
    var minNotice = getSettingNum_(ctx, 'leave.min_notice_days', 0);
    if (minNotice > 0 && daysBetweenIso_(todayIso_(), payload.from_date) < minNotice) {
      fail_('VALIDATION', 'Please apply at least ' + minNotice + ' day(s) in advance for ' + txt_(type.name) + '.');
    }
    if (payload.from_date < txt_(employee.joining_date)) fail_('VALIDATION', 'The leave starts before the joining date.', { field: 'from_date' });

    var overlap = Db.findOne(c, 'LeaveRequests', function (l) {
      return txt_(l.employee_id) === employee.employee_id && ['PENDING', 'APPROVED'].indexOf(txt_(l.status)) >= 0 &&
        txt_(l.from_date) <= payload.to_date && txt_(l.to_date) >= payload.from_date;
    });
    if (overlap) fail_('DUPLICATE', 'You already have a ' + txt_(overlap.status).toLowerCase() + ' leave request from ' + fmtDateHuman_(overlap.from_date) + ' to ' + fmtDateHuman_(overlap.to_date) + ' (' + txt_(overlap.leave_type_name) + ').');
    if (boolVal_(type.requires_doc) && !txt_(payload.attachment_file_id)) {
      fail_('VALIDATION', txt_(type.name) + ' needs a supporting document (for example a medical certificate). Please attach it.', { field: 'attachment_file_id' });
    }
    var calc = Leave.workingDays_(ctx, c, employee, payload.from_date, payload.to_date, payload.is_half_day);
    if (calc.days <= 0) fail_('VALIDATION', 'Those dates are all weekly offs or holidays, so no leave needs to be applied.');

    var fy = fyOf_(payload.from_date);
    var balanceRow = boolVal_(type.is_paid) || numVal_(type.max_balance) > 0 ? Leave.ensureBalance_(ctx, employee, type, fy) : null;
    var available = balanceRow ? round2_(numVal_(balanceRow.opening) + numVal_(balanceRow.accrued) - numVal_(balanceRow.used) - numVal_(balanceRow.lapsed)) : 0;
    var allowNegative = getSettingBool_(ctx, 'leave.allow_negative_balance', false);
    if (balanceRow && !allowNegative && calc.days > available) {
      fail_('INSUFFICIENT_BALANCE', 'You have only ' + available + ' day(s) of ' + txt_(type.name) + ' left, but requested ' + calc.days +
        '. You can apply for ' + available + ' day(s) or ask HR to adjust your balance.');
    }

    var row = Db.insert(c, 'LeaveRequests', {
      employee_id: employee.employee_id, employee_code: txt_(employee.code), employee_name: txt_(employee.name),
      leave_type_id: type.leave_type_id, leave_type_name: txt_(type.name),
      from_date: payload.from_date, to_date: payload.to_date, days: calc.days,
      is_half_day: payload.is_half_day ? 'TRUE' : 'FALSE', half_day_session: payload.half_day_session,
      reason: payload.reason, contact_during_leave: payload.contact_during_leave,
      status: 'PENDING', applied_at: nowIso_(), attachment_file_id: payload.attachment_file_id, fy: fy
    }, { actor: ctx.userId });

    Audit.write(ctx, {
      module: 'leave', action: 'leave.apply', entity: 'LeaveRequests', entity_id: row.request_id,
      after: { employee: txt_(employee.name), type: txt_(type.name), from: payload.from_date, to: payload.to_date, days: calc.days, reason: payload.reason },
      note: txt_(employee.name) + ' applied for ' + txt_(type.name) + ' (' + calc.days + ' day(s))'
    });
    Notify.notifyApprovers_(ctx, {
      title: 'Leave request: ' + txt_(employee.name),
      body: txt_(type.name) + ' · ' + fmtDateHuman_(payload.from_date) + ' → ' + fmtDateHuman_(payload.to_date) + ' (' + calc.days + ' day(s)). Reason: ' + payload.reason,
      kind: 'LEAVE', employee_id: employee.employee_id,
      link_action: 'leave.requests', link_payload: { request_id: row.request_id }
    });
    var to = Email.resolve_(ctx, employee);
    if (to) {
      Notify.send({
        to: to, template: 'LEAVE_DECISION',
        vars: {
          employee_name: txt_(employee.name), leave_type: txt_(type.name), from_date: fmtDateHuman_(payload.from_date),
          to_date: fmtDateHuman_(payload.to_date), decision: 'submitted', remark: payload.reason,
          balance_line: balanceRow ? 'Available balance: ' + available + ' → ' + round2_(available - calc.days) + ' day(s) once approved.' : ''
        }
      });
    }
    return {
      request_id: row.request_id, status: 'PENDING', days: calc.days, skipped: calc.skipped,
      balance_after: balanceRow ? round2_(available - calc.days) : null,
      message: 'Leave request sent for approval. ' + calc.days + ' day(s) of ' + txt_(type.name) + '.'
    };
  },

  requestsList: function (ctx, payload) {
    Perm.require(ctx, 'leave.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'LeaveRequests', function (l) {
      if (allowed && allowed.indexOf(txt_(l.employee_id)) < 0) return false;
      if (payload.status && txt_(l.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.employee_id && txt_(l.employee_id) !== txt_(payload.employee_id)) return false;
      if (payload.leave_type_id && txt_(l.leave_type_id) !== txt_(payload.leave_type_id)) return false;
      if (payload.from && txt_(l.to_date) < txt_(payload.from)) return false;
      if (payload.to && txt_(l.from_date) > txt_(payload.to)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (l) { return matchesSearch_(l, SCHEMA.LeaveRequests.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'created_at', payload.dir || 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (l) {
        return {
          request_id: l.request_id, employee_id: l.employee_id, employee_code: l.employee_code, employee_name: l.employee_name,
          leave_type_id: l.leave_type_id, leave_type_name: l.leave_type_name, from_date: l.from_date, to_date: l.to_date,
          days: numVal_(l.days), is_half_day: boolVal_(l.is_half_day), half_day_session: l.half_day_session,
          reason: l.reason, contact_during_leave: l.contact_during_leave, status: l.status, applied_at: l.applied_at,
          decided_by_name: l.decided_by_name, decided_at: l.decided_at, decision_remark: l.decision_remark,
          attachment_file_id: l.attachment_file_id, fy: l.fy, can_decide: Perm.canApprove(ctx, 'leave')
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      counts: (function () {
        var out = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
        Db.all(c, 'LeaveRequests', function (l) { return !allowed || allowed.indexOf(txt_(l.employee_id)) >= 0; })
          .forEach(function (l) { out[txt_(l.status).toUpperCase()] = (out[txt_(l.status).toUpperCase()] || 0) + 1; });
        return out;
      })()
    };
  },

  requestsMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0 };
    var rows = Db.all(c, 'LeaveRequests', function (l) {
      if (txt_(l.employee_id) !== ctx.employeeId) return false;
      if (payload.status && txt_(l.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      return true;
    });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (l) {
        return {
          request_id: l.request_id, leave_type_name: l.leave_type_name, from_date: l.from_date, to_date: l.to_date,
          days: numVal_(l.days), status: l.status, reason: l.reason, applied_at: l.applied_at,
          decided_at: l.decided_at, decided_by_name: l.decided_by_name, decision_remark: l.decision_remark,
          is_half_day: boolVal_(l.is_half_day), attachment_file_id: l.attachment_file_id, fy: l.fy
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  decide: function (ctx, payload) {
    Perm.require(ctx, 'leave.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var l = Db.get(c, 'LeaveRequests', 'request_id', payload.request_id);
    Perm.assertEmployee(ctx, l.employee_id);
    if (txt_(l.status) !== 'PENDING') fail_('ALREADY_DONE', 'This request is already ' + txt_(l.status).toLowerCase() + '.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required to approve or reject — the employee sees it.', { field: 'remark' });
    var decision = txt_(payload.decision).toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) fail_('VALIDATION', 'Decision must be APPROVED or REJECTED.');
    var employee = Db.get(c, 'Employees', 'employee_id', l.employee_id);
    var type = Db.get(c, 'LeaveTypes', 'leave_type_id', l.leave_type_id);
    var balanceLine = '';

    if (decision === 'APPROVED') {
      var balance = Leave.ensureBalance_(ctx, employee, type, txt_(l.fy) || fyOf_(l.from_date));
      var newUsed = round2_(numVal_(balance.used) + numVal_(l.days));
      var closing = round2_(numVal_(balance.opening) + numVal_(balance.accrued) - newUsed - numVal_(balance.lapsed));
      Db.update(c, 'LeaveBalances', 'balance_id', balance.balance_id, {
        used: newUsed, closing: closing, employee_name: txt_(employee.name)
      }, { actor: ctx.userId });
      memoDrop_('__lb_' + Leave.balanceKey_(employee.employee_id, type.leave_type_id, balance.fy));
      balanceLine = txt_(type.name) + ' balance is now ' + closing + ' day(s).';

      // mark the attendance register for the approved days
      isoRange_(l.from_date, l.to_date).forEach(function (d) {
        if (d > todayIso_()) return;
        var existing = Attendance.attendanceFor_(c, employee.employee_id, d);
        if (existing && boolVal_(existing.payroll_locked)) return;
        if (existing) {
          if (txt_(existing.status) === 'PRESENT' || txt_(existing.status) === 'HALF_DAY') return; // already worked
          Db.update(c, 'Attendance', 'attendance_id', existing.attendance_id, {
            status: 'LEAVE', remark: txt_(l.leave_type_name) + ' approved'
          }, { actor: ctx.userId });
        } else if (!isWeekOff_(d, getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY'))) {
          var holiday = Db.findOne(c, 'Holidays', function (h) { return txt_(h.date) === d; });
          if (!holiday) {
            Db.insert(c, 'Attendance', {
              employee_id: employee.employee_id, employee_code: txt_(employee.code), employee_name: txt_(employee.name),
              date: d, project_id: txt_(employee.project_id), status: 'LEAVE', source: 'SYSTEM',
              remark: txt_(l.leave_type_name) + ' approved (' + txt_(l.request_id) + ')'
            }, { actor: ctx.userId });
          }
        }
      });
    }

    Db.update(c, 'LeaveRequests', 'request_id', l.request_id, {
      status: decision, decided_by: ctx.userId, decided_by_name: txt_(ctx.name), decided_at: nowIso_(), decision_remark: payload.remark
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'leave', action: 'leave.decide', entity: 'LeaveRequests', entity_id: l.request_id,
      before: { status: l.status }, after: { status: decision, remark: payload.remark, balance_line: balanceLine },
      note: 'Leave ' + decision + ' for ' + txt_(l.employee_name) + ' (' + txt_(l.days) + ' day(s)) by ' + txt_(ctx.name), severity: 'SENSITIVE'
    });

    if (txt_(employee.user_id)) {
      Notify.push([employee.user_id], {
        company_id: ctx.companyId, title: 'Leave ' + decision.toLowerCase(),
        body: txt_(l.leave_type_name) + ' · ' + fmtDateHuman_(l.from_date) + ' → ' + fmtDateHuman_(l.to_date) + '. ' + payload.remark + (balanceLine ? ' ' + balanceLine : ''),
        kind: 'LEAVE', link_action: 'leave.my', link_payload: { request_id: l.request_id }
      });
      if (getSettingBool_(ctx, 'notify.email_leave', true)) {
        var to = Email.resolve_(ctx, employee);
        if (to) Notify.send({
          to: to, template: 'LEAVE_DECISION',
          vars: {
            employee_name: txt_(l.employee_name), leave_type: txt_(l.leave_type_name), from_date: fmtDateHuman_(l.from_date),
            to_date: fmtDateHuman_(l.to_date), decision: decision, remark: payload.remark, balance_line: balanceLine
          }
        });
      }
    }
    return { request_id: l.request_id, status: decision, balance_line: balanceLine };
  },

  cancel: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var l = Db.get(c, 'LeaveRequests', 'request_id', payload.request_id);
    var isOwner = txt_(l.employee_id) === txt_(ctx.employeeId);
    if (!isOwner) Perm.require(ctx, 'leave.edit');
    if (txt_(l.status) === 'CANCELLED') fail_('ALREADY_DONE', 'This request is already cancelled.');
    if (txt_(l.status) === 'REJECTED') fail_('NOT_ALLOWED', 'A rejected request cannot be cancelled.');
    if (txt_(l.status) === 'APPROVED' && l.from_date < todayIso_() && !Perm.has(ctx, 'leave.approve')) {
      fail_('NOT_ALLOWED', 'Leave that has already started cannot be cancelled by the employee. Please speak to HR.');
    }
    if (!txt_(payload.cancel_reason)) fail_('VALIDATION', 'Please write why this leave is being cancelled.', { field: 'cancel_reason' });
    var employee = Db.get(c, 'Employees', 'employee_id', l.employee_id);
    var type = Db.get(c, 'LeaveTypes', 'leave_type_id', l.leave_type_id);

    if (txt_(l.status) === 'APPROVED') {
      var balance = Leave.ensureBalance_(ctx, employee, type, txt_(l.fy) || fyOf_(l.from_date));
      var newUsed = Math.max(0, round2_(numVal_(balance.used) - numVal_(l.days)));
      Db.update(c, 'LeaveBalances', 'balance_id', balance.balance_id, {
        used: newUsed, closing: round2_(numVal_(balance.opening) + numVal_(balance.accrued) - newUsed - numVal_(balance.lapsed))
      }, { actor: ctx.userId });
      memoDrop_('__lb_' + Leave.balanceKey_(employee.employee_id, type.leave_type_id, balance.fy));
      isoRange_(l.from_date, l.to_date).forEach(function (d) {
        var rec = Attendance.attendanceFor_(c, employee.employee_id, d);
        if (rec && txt_(rec.status) === 'LEAVE' && !boolVal_(rec.payroll_locked)) {
          Db.update(c, 'Attendance', 'attendance_id', rec.attendance_id, {
            status: 'ABSENT', remark: 'Leave cancelled: ' + payload.cancel_reason
          }, { actor: ctx.userId });
        }
      });
    }
    Db.update(c, 'LeaveRequests', 'request_id', l.request_id, {
      status: 'CANCELLED', cancel_reason: payload.cancel_reason, decided_by: ctx.userId,
      decided_by_name: txt_(ctx.name), decided_at: nowIso_(), decision_remark: payload.cancel_reason
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'leave', action: 'leave.cancel', entity: 'LeaveRequests', entity_id: l.request_id,
      before: { status: l.status }, after: { status: 'CANCELLED', reason: payload.cancel_reason },
      note: 'Leave cancelled by ' + txt_(ctx.name) + ' for ' + txt_(l.employee_name), severity: 'SENSITIVE'
    });
    return { request_id: l.request_id, status: 'CANCELLED' };
  },

  calendar: function (ctx, payload) {
    Perm.require(ctx, 'leave.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var month = payload.month;
    var from = monthStart_(month), to = monthEnd_(month);
    var employees = {};
    var deptMatch = {};
    Db.all(c, 'Employees').forEach(function (e) {
      employees[txt_(e.employee_id)] = e;
      deptMatch[txt_(e.employee_id)] = !payload.department || txt_(e.department) === txt_(payload.department);
    });
    var allowed = Perm.allowedEmployeeIds(ctx);
    var days = isoRange_(from, to);
    var grid = {};
    days.forEach(function (d) { grid[d] = []; });

    Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.status) === 'APPROVED' && txt_(l.from_date) <= to && txt_(l.to_date) >= from;
    }).forEach(function (l) {
      var emp = employees[txt_(l.employee_id)];
      if (!emp) return;
      if (!deptMatch[txt_(l.employee_id)]) return;
      if (allowed && allowed.indexOf(txt_(l.employee_id)) < 0) return;
      if (payload.project_id && txt_(emp.project_id) !== txt_(payload.project_id)) return;
      isoRange_(l.from_date < from ? from : l.from_date, l.to_date > to ? to : l.to_date).forEach(function (d) {
        if (grid[d]) grid[d].push({ employee_id: l.employee_id, name: txt_(l.employee_name), code: txt_(l.employee_code), leave_type: txt_(l.leave_type_name), request_id: l.request_id });
      });
    });

    var holidays = {};
    Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= from && txt_(h.date) <= to; })
      .forEach(function (h) { holidays[txt_(h.date)] = txt_(h.name); });

    return {
      month: month, month_label: monthLabel_(month),
      days: days.map(function (d) {
        return {
          date: d, day: Number(d.slice(-2)), dow: dayName_(d).slice(0, 3),
          holiday: holidays[d] || '', weekly_off: isWeekOff_(d, getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY')),
          on_leave: grid[d], count: grid[d].length
        };
      }),
      total_leave_days: sum_(Object.keys(grid), function (k) { return grid[k].length; })
    };
  },

  /* ==================================================== special requests = */
  specialKinds_: ['ADVANCE', 'OVERTIME', 'COMPOFF', 'CONVEYANCE', 'MEDICAL', 'BONUS', 'OTHER'],

  specialList: function (ctx, payload) {
    Perm.require(ctx, 'leave.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'SpecialRequests', function (r) {
      if (allowed && allowed.indexOf(txt_(r.employee_id)) < 0) return false;
      if (payload.status && txt_(r.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.kind && txt_(r.kind).toUpperCase() !== txt_(payload.kind).toUpperCase()) return false;
      if (payload.employee_id && txt_(r.employee_id) !== txt_(payload.employee_id)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (r) { return matchesSearch_(r, SCHEMA.SpecialRequests.search, payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return {
          request_id: r.request_id, employee_id: r.employee_id, employee_name: r.employee_name, kind: r.kind, title: r.title,
          from_date: r.from_date, to_date: r.to_date, amount: numVal_(r.amount), details: safeJson_(r.details_json, {}),
          reason: r.reason, status: r.status, applied_at: r.applied_at, decided_by_name: r.decided_by_name,
          decided_at: r.decided_at, decision_remark: r.decision_remark, can_decide: Perm.canApprove(ctx, 'leave')
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      kinds: Leave.specialKinds_
    };
  },

  specialMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0, kinds: Leave.specialKinds_ };
    var rows = sortRows_(Db.all(c, 'SpecialRequests', function (r) { return txt_(r.employee_id) === ctx.employeeId; }), 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return {
          request_id: r.request_id, kind: r.kind, title: r.title, from_date: r.from_date, to_date: r.to_date,
          amount: numVal_(r.amount), reason: r.reason, status: r.status, applied_at: r.applied_at,
          decision_remark: r.decision_remark, decided_at: r.decided_at
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      kinds: Leave.specialKinds_
    };
  },

  specialCreate: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) fail_('EMPLOYEE_ONLY', 'These requests are raised from an employee login.');
    var employee = Attendance.employeeRecord_(ctx);
    var kind = txt_(payload.kind).toUpperCase();
    if (Leave.specialKinds_.indexOf(kind) < 0) fail_('VALIDATION', 'Choose a valid request type.');
    if (payload.to_date && payload.to_date < payload.from_date) fail_('VALIDATION', 'The end date cannot be before the start date.', { field: 'to_date' });
    if ((kind === 'ADVANCE' || kind === 'BONUS') && !(numVal_(payload.amount) > 0)) fail_('VALIDATION', 'Please enter the amount you need.', { field: 'amount' });
    var row = Db.insert(c, 'SpecialRequests', {
      employee_id: employee.employee_id, employee_name: txt_(employee.name), kind: kind, title: payload.title,
      from_date: payload.from_date, to_date: payload.to_date || '', amount: numVal_(payload.amount),
      details_json: jsonStr_(payload.details || {}), reason: payload.reason, status: 'PENDING', applied_at: nowIso_()
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'leave', action: 'leave.special.create', entity: 'SpecialRequests', entity_id: row.request_id,
      after: { kind: kind, title: payload.title, amount: numVal_(payload.amount), reason: payload.reason },
      note: kind + ' request from ' + txt_(employee.name)
    });
    Notify.notifyApprovers_(ctx, {
      title: kind + ' request: ' + txt_(employee.name),
      body: payload.title + (numVal_(payload.amount) ? ' · ₹' + numVal_(payload.amount) : '') + '. Reason: ' + payload.reason,
      kind: 'REQUEST', employee_id: employee.employee_id,
      link_action: 'leave.special', link_payload: { request_id: row.request_id }
    });
    return { request_id: row.request_id, status: 'PENDING' };
  },

  specialDecide: function (ctx, payload) {
    Perm.require(ctx, 'leave.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var r = Db.get(c, 'SpecialRequests', 'request_id', payload.request_id);
    Perm.assertEmployee(ctx, r.employee_id);
    if (txt_(r.status) !== 'PENDING') fail_('ALREADY_DONE', 'This request is already ' + txt_(r.status).toLowerCase() + '.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required to approve or reject.', { field: 'remark' });
    var decision = txt_(payload.decision).toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) fail_('VALIDATION', 'Decision must be APPROVED or REJECTED.');
    var employee = Db.get(c, 'Employees', 'employee_id', r.employee_id);

    // comp-off approval creates a leave credit in the comp-off leave type if one exists
    var extra = '';
    if (decision === 'APPROVED' && txt_(r.kind) === 'COMPOFF') {
      var compType = Db.findOne(c, 'LeaveTypes', function (t) { return txt_(t.code) === 'COMP' || txt_(t.name).toLowerCase().indexOf('comp') >= 0; });
      if (compType) {
        var days = Math.max(0.5, daysBetweenIso_(r.from_date, r.to_date || r.from_date) + 1);
        var b = Leave.ensureBalance_(ctx, employee, compType, fyOf_(todayIso_()));
        Db.update(c, 'LeaveBalances', 'balance_id', b.balance_id, {
          accrued: round2_(numVal_(b.accrued) + days),
          closing: round2_(numVal_(b.opening) + numVal_(b.accrued) + days - numVal_(b.used) - numVal_(b.lapsed))
        }, { actor: ctx.userId });
        extra = days + ' day(s) credited to ' + txt_(compType.name) + '.';
      }
    }
    Db.update(c, 'SpecialRequests', 'request_id', r.request_id, {
      status: decision, decided_by: ctx.userId, decided_by_name: txt_(ctx.name), decided_at: nowIso_(), decision_remark: payload.remark
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'leave', action: 'leave.special.decide', entity: 'SpecialRequests', entity_id: r.request_id,
      before: { status: r.status }, after: { status: decision, remark: payload.remark, extra: extra },
      note: txt_(r.kind) + ' request ' + decision + ' for ' + txt_(r.employee_name), severity: 'SENSITIVE'
    });
    if (txt_(employee.user_id)) {
      Notify.push([employee.user_id], {
        company_id: ctx.companyId, title: txt_(r.kind) + ' request ' + decision.toLowerCase(),
        body: payload.remark + (extra ? ' ' + extra : ''),
        kind: 'REQUEST', link_action: 'leave.special', link_payload: { request_id: r.request_id }
      });
    }
    return { request_id: r.request_id, status: decision, extra: extra };
  },

  /* ============================================================ holidays = */
  holidaysList: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var year = txt_(payload && payload.year) || todayIso_().slice(0, 4);
    var rows = sortRows_(Db.all(c, 'Holidays', function (h) { return txt_(h.date).slice(0, 4) === year; }), 'date', 'ASC');
    return {
      year: year,
      years: uniq_(Db.all(c, 'Holidays').map(function (h) { return txt_(h.date).slice(0, 4); }).concat([year])).sort(),
      rows: rows.map(function (h) {
        return {
          holiday_id: h.holiday_id, name: h.name, date: h.date, day: dayName_(h.date), kind: h.kind,
          region: h.region, is_paid: boolVal_(h.is_paid), note: h.note
        };
      })
    };
  }
};
