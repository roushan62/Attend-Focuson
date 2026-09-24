/**
 * ============================================================================
 *  FocusHR  —  Payroll.gs
 *  Monthly payroll run: pre-checks, chunked calculation (safe for 1,000+
 *  employees), review, approval, payment marking and payslip generation.
 *
 *  Lifecycle:  DRAFT → PROCESSING → CALCULATED → APPROVED → PAID
 *  Every chunk is idempotent: re-running a chunk updates instead of doubling.
 * ============================================================================
 */

var Payroll = {

  /* ============================================================== rates == */
  rates_: function (ctx) {
    var g = function (key, def) { return getSetting_(ctx, key, def); };
    return {
      pf_employee_pct: numVal_(g('payroll.pf_employee_pct', PAYROLL_DEFAULTS.pf_employee_pct)),
      pf_employer_pct: numVal_(g('payroll.pf_employer_pct', PAYROLL_DEFAULTS.pf_employer_pct)),
      pf_wage_ceiling: numVal_(g('payroll.pf_wage_ceiling', PAYROLL_DEFAULTS.pf_wage_ceiling)),
      pf_ceiling_enabled: boolVal_(g('payroll.pf_ceiling_enabled', 'TRUE')),
      esic_employee_pct: numVal_(g('payroll.esic_employee_pct', PAYROLL_DEFAULTS.esic_employee_pct)),
      esic_employer_pct: numVal_(g('payroll.esic_employer_pct', PAYROLL_DEFAULTS.esic_employer_pct)),
      esic_wage_ceiling: numVal_(g('payroll.esic_wage_ceiling', PAYROLL_DEFAULTS.esic_wage_ceiling)),
      pt_state: txt_(g('payroll.pt_state', PAYROLL_DEFAULTS.pt_state)),
      tds_regime: txt_(g('payroll.tds_regime', PAYROLL_DEFAULTS.tds_regime)).toUpperCase(),
      standard_deduction_new: PAYROLL_DEFAULTS.standard_deduction_new,
      standard_deduction_old: PAYROLL_DEFAULTS.standard_deduction_old,
      rebate_87a_new: PAYROLL_DEFAULTS.rebate_87a_new,
      rebate_87a_old: PAYROLL_DEFAULTS.rebate_87a_old,
      cess_pct: PAYROLL_DEFAULTS.cess_pct,
      ot_multiplier: numVal_(g('payroll.ot_multiplier', PAYROLL_DEFAULTS.ot_multiplier)),
      days_basis: txt_(g('payroll.days_basis', PAYROLL_DEFAULTS.days_basis)).toUpperCase(),
      work_hours_per_day: numVal_(g('attendance.work_hours_per_day', PAYROLL_DEFAULTS.work_hours_per_day)),
      round_off: boolVal_(g('payroll.round_off', 'TRUE'))
    };
  },

  /* =============================================================== runs == */
  runsList: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    if (Perm.isSelfOnly(ctx)) {
      fail_('FORBIDDEN', 'Salary runs are not visible from the employee app. Your payslips are under "My payslips".');
    }
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'PayrollRuns', function (r) {
      if (payload.status && txt_(r.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.fy && txt_(r.fy) !== txt_(payload.fy)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (r) { return matchesSearch_(r, ['code', 'title', 'month', 'status'], payload.search); });
    rows = sortRows_(rows, 'month', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var today = todayIso_();
    return {
      rows: page.rows.map(function (r) {
        return {
          run_id: r.run_id, code: r.code, fy: r.fy, month: r.month, month_label: monthLabel_(r.month),
          period_from: r.period_from, period_to: r.period_to, days_basis: r.days_basis, title: r.title, status: r.status,
          total_employees: intVal_(r.total_employees), total_gross: numVal_(r.total_gross),
          total_deductions: numVal_(r.total_deductions), total_net: numVal_(r.total_net),
          total_employer_cost: numVal_(r.total_employer_cost), calculated_at: r.calculated_at,
          approved_by_name: r.approved_by_name, approved_at: r.approved_at, paid_at: r.paid_at,
          payment_reference: r.payment_reference, payment_mode: r.payment_mode,
          payslips_generated: intVal_(r.payslips_generated), progress: safeJson_(r.progress_json, {}),
          notes: r.notes, is_current_month: txt_(r.month) === monthOfIso_(today)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      fy_options: Leave.fyOptions_(),
      can_create: Perm.has(ctx, 'payroll.create'),
      can_approve: Perm.has(ctx, 'payroll.approve')
    };
  },

  runGet: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var r = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === r.run_id; });
    var byDept = {}, byProject = {};
    items.forEach(function (i) {
      var d = txt_(i.department) || 'Unassigned';
      byDept[d] = byDept[d] || { department: d, employees: 0, net: 0 };
      byDept[d].employees++;
      byDept[d].net += numVal_(i.net_pay);
      var pd = safeJson_(i.project_days_json, {});
      Object.keys(pd).forEach(function (pid) {
        byProject[pid] = byProject[pid] || { project_id: pid, employees: 0, days: 0, net: 0 };
        byProject[pid].days += numVal_(pd[pid]);
      });
    });
    var projectNames = {};
    Db.all(c, 'Projects').forEach(function (p) { projectNames[txt_(p.project_id)] = txt_(p.name); });
    Object.keys(byProject).forEach(function (pid) { byProject[pid].name = projectNames[pid] || 'Unknown site'; });

    return {
      run: {
        run_id: r.run_id, code: r.code, fy: r.fy, month: r.month, month_label: monthLabel_(r.month),
        period_from: r.period_from, period_to: r.period_to, days_basis: r.days_basis, title: r.title, status: r.status,
        total_employees: intVal_(r.total_employees), total_gross: numVal_(r.total_gross),
        total_deductions: numVal_(r.total_deductions), total_net: numVal_(r.total_net),
        total_employer_cost: numVal_(r.total_employer_cost), calculated_at: r.calculated_at,
        approved_by_name: r.approved_by_name, approved_at: r.approved_at, approval_remark: r.approval_remark,
        paid_at: r.paid_at, payment_reference: r.payment_reference, payment_mode: r.payment_mode,
        payslips_generated: intVal_(r.payslips_generated), cancelled_reason: r.cancelled_reason,
        progress: safeJson_(r.progress_json, {}), chunk_index: intVal_(r.chunk_index, 0), chunk_total: intVal_(r.chunk_total, 0),
        notes: r.notes
      },
      stats: {
        employees: items.length,
        held: items.filter(function (i) { return txt_(i.status) === 'HOLD'; }).length,
        with_ot: items.filter(function (i) { return numVal_(i.ot_hours) > 0; }).length,
        reimbursed: items.filter(function (i) { return numVal_(i.reimbursement) > 0; }).length,
        zero_net: items.filter(function (i) { return numVal_(i.net_pay) <= 0; }).length,
        by_department: Object.keys(byDept).map(function (k) { return byDept[k]; }).sort(function (a, b) { return b.net - a.net; }),
        by_project: Object.keys(byProject).map(function (k) { return byProject[k]; }).sort(function (a, b) { return b.days - a.days; }),
        totals: {
          pf_employee: round0_(sum_(items, function (i) { return i.pf_employee; })),
          pf_employer: round0_(sum_(items, function (i) { return i.pf_employer; })),
          esic_employee: round0_(sum_(items, function (i) { return i.esic_employee; })),
          esic_employer: round0_(sum_(items, function (i) { return i.esic_employer; })),
          pt: round0_(sum_(items, function (i) { return i.pt; })),
          tds: round0_(sum_(items, function (i) { return i.tds; })),
          overtime: round0_(sum_(items, function (i) { return numVal_(i.ot_hours) * Payroll.itemOtRate_(i); })),
          reimbursement: round0_(sum_(items, function (i) { return i.reimbursement; }))
        }
      },
      items: sortRows_(items, 'employee_code', 'ASC').slice(0, 500).map(function (i) { return Payroll.itemOut_(i); }),
      can_approve: Perm.has(ctx, 'payroll.approve'),
      can_edit: Perm.has(ctx, 'payroll.edit')
    };
  },

  itemOtRate_: function (item) {
    var snap = safeJson_(item.rates_json, {});
    return numVal_(snap.overtime_rate, numVal_(item.ot_rate, 0));
  },

  itemOut_: function (i) {
    return {
      item_id: i.item_id, run_id: i.run_id, employee_id: i.employee_id, employee_code: i.employee_code,
      employee_name: i.employee_name, department: i.department, project_id: i.project_id,
      status: i.status, hold_reason: i.hold_reason,
      present_days: numVal_(i.present_days), paid_days: numVal_(i.paid_days), lop_days: numVal_(i.lop_days),
      leave_days: numVal_(i.leave_days), holiday_days: numVal_(i.holiday_days), weekly_off_days: numVal_(i.weekly_off_days),
      ot_hours: numVal_(i.ot_hours), basic: numVal_(i.basic), hra: numVal_(i.hra), da: numVal_(i.da),
      conveyance: numVal_(i.conveyance), special_allowance: numVal_(i.special_allowance), other_allowance: numVal_(i.other_allowance),
      bonus: numVal_(i.bonus), incentive: numVal_(i.incentive), gross_earnings: numVal_(i.gross_earnings),
      reimbursement: numVal_(i.reimbursement), pf_employee: numVal_(i.pf_employee), pf_employer: numVal_(i.pf_employer),
      esic_employee: numVal_(i.esic_employee), esic_employer: numVal_(i.esic_employer), pt: numVal_(i.pt), tds: numVal_(i.tds),
      advance_recovery: numVal_(i.advance_recovery), other_deduction: numVal_(i.other_deduction),
      total_deductions: numVal_(i.total_deductions), net_pay: numVal_(i.net_pay), ctc_cost: numVal_(i.ctc_cost),
      project_days: safeJson_(i.project_days_json, {}), claim_ids: safeJson_(i.claim_ids, []),
      calc_notes: i.calc_notes, payslip_id: i.payslip_id
    };
  },

  /* ============================================================= create == */
  runCreate: function (ctx, payload) {
    Perm.require(ctx, 'payroll.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var month = txt_(payload.month).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) fail_('VALIDATION', 'Choose the salary month.', { field: 'month' });
    if (month > monthOfIso_(isoAddDays_(todayIso_(), 40))) fail_('VALIDATION', 'Payroll cannot be created for a future month.');
    var existing = Db.findOne(c, 'PayrollRuns', function (r) {
      return txt_(r.month) === month && txt_(r.status) !== 'CANCELLED';
    });
    if (existing) {
      fail_('DUPLICATE', 'Payroll for ' + monthLabel_(month) + ' already exists (' + txt_(existing.code) + ', ' + txt_(existing.status).toLowerCase() + '). Open that run instead.');
    }
    var daysBasis = txt_(payload.days_basis || getSetting_(ctx, 'payroll.days_basis', 'CALENDAR')).toUpperCase();
    if (['CALENDAR', 'WORKING', 'FIXED_26'].indexOf(daysBasis) < 0) fail_('VALIDATION', 'Payable days basis must be CALENDAR, WORKING or FIXED_26.');
    var run = Db.insert(c, 'PayrollRuns', {
      code: Db.nextId(c, 'PayrollRuns'), fy: fyOf_(monthStart_(month)), month: month,
      period_from: monthStart_(month), period_to: monthEnd_(month), days_basis: daysBasis,
      title: payload.title || ('Salary for ' + monthLabel_(month)), status: 'DRAFT',
      created_note: payload.notes || '', notes: payload.notes || '',
      progress_json: jsonStr_({ cursor: 0, total: 0, chunk_total: 0 })
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.runs.create', entity: 'PayrollRuns', entity_id: run.run_id,
      after: { month: month, days_basis: daysBasis, title: run.title },
      note: 'Payroll run created for ' + monthLabel_(month) + ' (' + txt_(run.code) + ')'
    });
    var pre = Payroll.precheck(ctx, { run_id: run.run_id });
    return { run_id: run.run_id, code: run.code, month: month, month_label: monthLabel_(month), precheck: pre };
  },

  /* ========================================================== pre-check == */
  precheck: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    var periodFrom = txt_(run.period_from), periodTo = txt_(run.period_to);
    var employees = Db.all(c, 'Employees', function (e) {
      var st = txt_(e.status).toUpperCase();
      if (txt_(e.joining_date) && txt_(e.joining_date) > periodTo) return false;
      if (txt_(e.exit_date) && txt_(e.exit_date) < periodFrom) return false;
      return st !== 'EXITED' || (txt_(e.exit_date) >= periodFrom);
    });
    var blockers = [], warnings = [], infos = [];
    var estimatedGross = 0, withStructure = 0;

    employees.forEach(function (e) {
      var structure = Employees.currentStructure_(ctx, e.employee_id);
      if (!structure || numVal_(structure.basic) <= 0) {
        blockers.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'No salary structure', hint: 'Open the employee → Salary tab and enter basic / HRA / allowances.' });
        return;
      }
      withStructure++;
      estimatedGross += numVal_(structure.basic) + numVal_(structure.hra) + numVal_(structure.da) +
        numVal_(structure.conveyance) + numVal_(structure.special_allowance) + numVal_(structure.other_allowance);
      var stats = Attendance.monthStats_(ctx, c, e.employee_id, txt_(run.month));
      if (!stats) {
        warnings.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'Attendance could not be summarised' });
      } else {
        if (stats.days_recorded === 0) warnings.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'No attendance rows for ' + monthLabel_(txt_(run.month)) + ' — days without a record will be treated as absent.' });
        else if (stats.absent >= 5) infos.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: stats.absent + ' absent day(s) detected — please confirm before paying.' });
        if (stats.missing_punch) infos.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: stats.missing_punch + ' incomplete punch(es) will count as loss of pay.' });
      }
      if (!txt_(e.pan)) warnings.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'PAN missing — TDS reporting will be incomplete.' });
      if (boolVal_(e.pf_applicable) !== false && !txt_(e.pf_uan)) infos.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'PF UAN missing.' });
      if (boolVal_(e.esic_applicable) !== false && !txt_(e.esic_ip_no)) infos.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'ESIC IP number missing.' });
      if (!txt_(e.bank_account)) warnings.push({ employee_id: e.employee_id, code: e.code, name: e.name, issue: 'Bank account missing — cannot be paid by NEFT.' });
    });

    var claims = Db.all(c, 'ExpenseClaims', function (cl) {
      return txt_(cl.status) === 'APPROVED' && !txt_(cl.payroll_run_id) && txt_(cl.claim_date) <= periodTo;
    });
    var pendingClaims = Db.all(c, 'ExpenseClaims', function (cl) {
      return txt_(cl.status) === 'SUBMITTED' && txt_(cl.claim_date) <= periodTo;
    });

    return {
      run: { run_id: run.run_id, code: run.code, month: run.month, month_label: monthLabel_(run.month), status: run.status },
      employee_count: employees.length,
      with_structure: withStructure,
      estimated_gross: round0_(estimatedGross),
      blockers: blockers,
      warnings: warnings,
      infos: infos.slice(0, 40),
      claims: {
        approved_ready: claims.length,
        approved_amount: round0_(sum_(claims, function (cl) { return cl.net_amount; })),
        pending_approval: pendingClaims.length,
        pending_amount: round0_(sum_(pendingClaims, function (cl) { return cl.total_amount; })),
        note: 'Approved claims up to ' + fmtDateHuman_(periodTo) + ' are added to this run as reimbursement and locked so they can never be paid twice.'
      },
      can_calculate: blockers.length === 0,
      message: blockers.length
        ? blockers.length + ' employee(s) need a salary structure before payroll can be calculated.'
        : 'All ' + employees.length + ' employee(s) have a salary structure. Ready to calculate.'
    };
  },

  /* ====================================================== calculation ==== */
  calculateStart: function (ctx, payload) {
    Perm.require(ctx, 'payroll.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (['CALCULATED', 'APPROVED', 'PAID'].indexOf(txt_(run.status)) >= 0) {
      fail_('ALREADY_DONE', 'This run is already ' + txt_(run.status).toLowerCase() + '. Recalculate only after cancelling it.');
    }
    var pre = Payroll.precheck(ctx, { run_id: run.run_id });
    if (pre.blockers.length) {
      fail_('PRECHECK_FAILED', pre.blockers.length + ' employee(s) need a salary structure first. Open the checklist below and fix them, then calculate again.', { blockers: pre.blockers.slice(0, 20) });
    }
    var employees = Db.all(c, 'Employees', function (e) {
      var st = txt_(e.status).toUpperCase();
      if (txt_(e.joining_date) && txt_(e.joining_date) > txt_(run.period_to)) return false;
      if (txt_(e.exit_date) && txt_(e.exit_date) < txt_(run.period_from)) return false;
      return st !== 'EXITED' || txt_(e.exit_date) >= txt_(run.period_from);
    });
    if (!employees.length) fail_('VALIDATION', 'No employees are eligible for ' + monthLabel_(run.month) + '.');
    if (employees.length > APP.payrollMonthCap) fail_('VALIDATION', 'This run has more than ' + APP.payrollMonthCap + ' employees, which is beyond what one Apps Script run can hold. Please split the payroll by branch.');

    var chunkSize = APP.payrollChunkSize;
    var progress = {
      cursor: 0, total: employees.length, chunk_total: Math.ceil(employees.length / chunkSize),
      employee_ids: employees.map(function (e) { return txt_(e.employee_id); }),
      started_at: nowIso_(), last_chunk_at: '', errors: []
    };
    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, {
      status: 'PROCESSING', progress_json: jsonStr_(progress), chunk_index: 0, chunk_total: progress.chunk_total,
      total_employees: 0, total_gross: 0, total_deductions: 0, total_net: 0, total_employer_cost: 0
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.calculate.start', entity: 'PayrollRuns', entity_id: run.run_id,
      after: { employees: employees.length, chunk_size: chunkSize, chunk_total: progress.chunk_total },
      note: 'Payroll calculation started for ' + monthLabel_(run.month) + ' — ' + employees.length + ' employee(s) in ' + progress.chunk_total + ' chunk(s)'
    });
    return Payroll.processChunk_(ctx, Db.get(c, 'PayrollRuns', 'run_id', run.run_id), c, chunkSize);
  },

  calculateProgress: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    return Payroll.progressOut_(run);
  },

  calculateResume: function (ctx, payload) {
    Perm.require(ctx, 'payroll.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (txt_(run.status) !== 'PROCESSING') {
      fail_('NOT_ALLOWED', 'This run is ' + txt_(run.status).toLowerCase() + ', so there is nothing left to calculate.');
    }
    return Payroll.processChunk_(ctx, run, c, APP.payrollChunkSize);
  },

  progressOut_: function (run) {
    var p = safeJson_(run.progress_json, { cursor: 0, total: 0 });
    var total = intVal_(p.total, 0), cursor = intVal_(p.cursor, 0);
    return {
      run_id: run.run_id, code: run.code, status: run.status, month: run.month, month_label: monthLabel_(run.month),
      processed: cursor, total: total,
      percent: total ? Math.round(cursor / total * 100) : 0,
      chunk_index: intVal_(run.chunk_index, 0), chunk_total: intVal_(run.chunk_total, 0),
      started_at: p.started_at || '', last_chunk_at: p.last_chunk_at || '',
      errors: p.errors || [],
      totals: {
        employees: intVal_(run.total_employees), gross: numVal_(run.total_gross),
        deductions: numVal_(run.total_deductions), net: numVal_(run.total_net), employer_cost: numVal_(run.total_employer_cost)
      },
      done: txt_(run.status) !== 'PROCESSING'
    };
  },

  /** Calculate (or recalculate) one chunk of a run. Idempotent per employee. */
  processChunk_: function (ctx, run, c, chunkSize) {
    var p = safeJson_(run.progress_json, { cursor: 0, total: 0, employee_ids: [] });
    var ids = p.employee_ids || [];
    var cursor = intVal_(p.cursor, 0);
    var size = chunkSize || APP.payrollChunkSize;
    var slice = ids.slice(cursor, cursor + size);
    var rates = Payroll.rates_(ctx);
    var errors = p.errors || [];
    var processed = 0;

    slice.forEach(function (employeeId) {
      try {
        Payroll.calculateEmployee_(ctx, c, run, employeeId, rates);
        processed++;
      } catch (e) {
        errors.push({ employee_id: employeeId, error: txt_(e.message).slice(0, 200), at: nowIso_() });
        logEvent_('ERROR', 'Payroll.processChunk', 'Employee ' + employeeId + ' failed: ' + e.message, { run: run.run_id });
      }
    });

    var nextCursor = cursor + slice.length;
    var done = nextCursor >= ids.length || slice.length === 0;
    p.cursor = nextCursor;
    p.last_chunk_at = nowIso_();
    p.errors = errors.slice(-40);
    var patch = {
      progress_json: jsonStr_(p),
      chunk_index: Math.min(intVal_(p.chunk_total, 1), Math.ceil(nextCursor / size))
    };
    if (done) {
      var totals = Payroll.recomputeTotals_(c, run.run_id);
      patch.status = 'CALCULATED';
      patch.calculated_at = nowIso_();
      patch.total_employees = totals.employees;
      patch.total_gross = totals.gross;
      patch.total_deductions = totals.deductions;
      patch.total_net = totals.net;
      patch.total_employer_cost = totals.employer_cost;
      Audit.write(ctx, {
        module: 'payroll', action: 'payroll.run.calculated', entity: 'PayrollRuns', entity_id: run.run_id,
        after: totals, note: 'Payroll calculated for ' + monthLabel_(run.month) + ': ' + totals.employees + ' employee(s), net ₹' + totals.net
      });
      if (errors.length) {
        Notify.notifyCompanyAdmins_(ctx.companyId, {
          title: 'Payroll finished with ' + errors.length + ' problem(s)',
          body: monthLabel_(run.month) + ': ' + errors.length + ' employee(s) could not be calculated. Open the run to see the details.',
          kind: 'PAYROLL', link_action: 'payroll.runs', link_payload: { run_id: run.run_id }
        });
      }
    }
    var updated = Db.update(c, 'PayrollRuns', 'run_id', run.run_id, patch, { actor: ctx.userId });
    var out = Payroll.progressOut_(updated);
    out.chunk_processed = processed;
    out.finished = done;
    return out;
  },

  /** Calculate (or refresh) one employee's payroll item for a run. */
  calculateEmployee_: function (ctx, c, run, employeeId, rates) {
    var employee = Db.find(c, 'Employees', 'employee_id', employeeId);
    if (!employee) return null;
    var structure = Employees.currentStructure_(ctx, employeeId);
    if (!structure) fail_('NO_STRUCTURE', 'No salary structure for ' + txt_(employee.name) + '.');
    var stats = Attendance.monthStats_(ctx, c, employeeId, txt_(run.month));
    if (!stats) fail_('NO_ATTENDANCE', 'Attendance could not be summarised for ' + txt_(employee.name) + '.');

    // approved, not yet paid claims up to the end of this period
    var claims = Db.all(c, 'ExpenseClaims', function (cl) {
      return txt_(cl.employee_id) === employeeId && txt_(cl.status) === 'APPROVED' &&
        (!txt_(cl.payroll_run_id) || txt_(cl.payroll_run_id) === txt_(run.run_id)) && txt_(cl.claim_date) <= txt_(run.period_to);
    });
    var reimbursement = round0_(sum_(claims, function (cl) { return cl.net_amount; }));

    var existing = Db.findOne(c, 'PayrollItems', function (i) {
      return txt_(i.run_id) === run.run_id && txt_(i.employee_id) === employeeId;
    });
    var extras = {
      bonus: existing ? numVal_(existing.bonus) : 0,
      incentive: existing ? numVal_(existing.incentive) : 0,
      advance_recovery: existing ? numVal_(existing.advance_recovery) : 0,
      other_deduction: existing ? numVal_(existing.other_deduction) : 0,
      reimbursement: reimbursement
    };
    if (existing && numVal_(existing.ot_hours) > 0) stats.ot_hours = numVal_(existing.ot_hours);

    var result = PayrollCalc.computeItem({
      employee: employee, structure: structure, stats: stats, extras: extras, month: txt_(run.month)
    }, rates);

    var patch = {
      run_id: run.run_id, employee_id: employeeId, employee_code: txt_(employee.code), employee_name: txt_(employee.name),
      department: txt_(employee.department), project_id: txt_(employee.project_id),
      present_days: result.present_days, paid_days: result.paid_days, lop_days: result.lop_days,
      leave_days: result.leave_days, holiday_days: result.holiday_days, weekly_off_days: result.weekly_off_days,
      ot_hours: result.overtime_hours,
      basic: result.basic, hra: result.hra, da: result.da, conveyance: result.conveyance,
      special_allowance: result.special_allowance, other_allowance: result.other_allowance,
      bonus: result.bonus, incentive: result.incentive, gross_earnings: result.gross_earnings,
      reimbursement: result.reimbursement, pf_wage: result.pf_wage, pf_employee: result.pf_employee,
      pf_employer: result.pf_employer, esic_wage: result.esic_wage, esic_employee: result.esic_employee,
      esic_employer: result.esic_employer, pt: result.pt, tds: result.tds,
      advance_recovery: result.advance_recovery, other_deduction: result.other_deduction,
      total_deductions: result.total_deductions, net_pay: result.net_pay, ctc_cost: result.ctc_cost,
      claim_ids: jsonStr_(claims.map(function (cl) { return cl.claim_id; })),
      project_days_json: jsonStr_(stats.project_days),
      status: existing && txt_(existing.status) === 'HOLD' ? 'HOLD' : 'CALCULATED',
      hold_reason: existing ? txt_(existing.hold_reason) : '',
      calc_notes: result.calc_note,
      rates_json: jsonStr_({
        rates: rates,
        overtime_rate: result.overtime_rate,
        month: run.month,
        stats: {
          present: numVal_(stats.present), od: numVal_(stats.od), half_day: numVal_(stats.half_day),
          absent: numVal_(stats.absent), paid_leave: numVal_(stats.paid_leave), unpaid_leave: numVal_(stats.unpaid_leave),
          holiday: numVal_(stats.holiday), weekly_off: numVal_(stats.weekly_off), missing_punch: numVal_(stats.missing_punch),
          ot_hours: numVal_(stats.ot_hours), days_in_month: numVal_(stats.days_in_month),
          working_days: numVal_(stats.working_days), future_days: numVal_(stats.future_days),
          not_employed: numVal_(stats.not_employed), payable_days_basis: txt_(stats.payable_days_basis)
        },
        flags: {
          pf_applicable: employee.pf_applicable, esic_applicable: employee.esic_applicable,
          pt_applicable: employee.pt_applicable, tds_applicable: employee.tds_applicable,
          pf_ceiling_opt: employee.pf_ceiling_opt, work_state: employee.work_state
        },
        structure: {
          basic: numVal_(structure.basic), hra: numVal_(structure.hra), da: numVal_(structure.da),
          conveyance: numVal_(structure.conveyance), special_allowance: numVal_(structure.special_allowance),
          other_allowance: numVal_(structure.other_allowance), overtime_rate: result.overtime_rate,
          pt_state: structure.pt_state, tds_regime: structure.tds_regime
        }
      })
    };
    if (existing) return Db.update(c, 'PayrollItems', 'item_id', existing.item_id, patch, { actor: ctx.userId });
    return Db.insert(c, 'PayrollItems', patch, { actor: ctx.userId });
  },

  recomputeTotals_: function (c, runId) {
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === runId; })
      .filter(function (i) { return txt_(i.status) !== 'HOLD'; });
    return {
      employees: items.length,
      gross: round0_(sum_(items, function (i) { return i.gross_earnings; })),
      deductions: round0_(sum_(items, function (i) { return i.total_deductions; })),
      net: round0_(sum_(items, function (i) { return i.net_pay; })),
      employer_cost: round0_(sum_(items, function (i) { return i.ctc_cost; })),
      reimbursement: round0_(sum_(items, function (i) { return i.reimbursement; }))
    };
  },

  /* ============================================================== items == */
  items: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    var rows = Db.all(c, 'PayrollItems', function (i) {
      if (txt_(i.run_id) !== run.run_id) return false;
      if (payload.status && txt_(i.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.department && txt_(i.department) !== txt_(payload.department)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (i) { return matchesSearch_(i, SCHEMA.PayrollItems.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'employee_code', payload.dir || 'ASC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    Audit.sensitive(ctx, 'payroll', 'payroll.runs.items', 'PayrollItems', run.run_id, 'Viewed payroll items for ' + monthLabel_(run.month));
    return {
      run: { run_id: run.run_id, code: run.code, month: run.month, month_label: monthLabel_(run.month), status: run.status },
      rows: page.rows.map(function (i) { return Payroll.itemOut_(i); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      totals: Payroll.recomputeTotals_(c, run.run_id),
      departments: uniq_(Db.all(c, 'Employees').map(function (e) { return txt_(e.department); }).filter(function (d) { return !!d; })).sort()
    };
  },

  itemUpdate: function (ctx, payload) {
    Perm.require(ctx, 'payroll.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var item = Db.get(c, 'PayrollItems', 'item_id', payload.item_id);
    var run = Db.get(c, 'PayrollRuns', 'run_id', item.run_id);
    if (['APPROVED', 'PAID'].indexOf(txt_(run.status)) >= 0) {
      fail_('LOCKED', 'This run is already ' + txt_(run.status).toLowerCase() + '. Revert it before changing amounts.');
    }
    var snapshot = safeJson_(item.rates_json, {});
    if (!snapshot.rates) fail_('SERVER_ERROR', 'This payroll row is missing its calculation snapshot. Please recalculate the run.');
    var employee = Db.get(c, 'Employees', 'employee_id', item.employee_id);
    var stats = snapshot.stats || {};
    stats.ot_hours = numVal_(payload.ot_hours, numVal_(item.ot_hours));
    var result = PayrollCalc.computeItem({
      employee: Object.assign({}, employee, snapshot.flags || {}),
      structure: Object.assign({}, snapshot.structure || {}, { pt_state: snapshot.structure && snapshot.structure.pt_state, tds_regime: snapshot.structure && snapshot.structure.tds_regime }),
      stats: stats,
      extras: {
        bonus: numVal_(payload.bonus, numVal_(item.bonus)),
        incentive: numVal_(payload.incentive, numVal_(item.incentive)),
        advance_recovery: numVal_(payload.advance_recovery, numVal_(item.advance_recovery)),
        other_deduction: numVal_(payload.other_deduction, numVal_(item.other_deduction)),
        reimbursement: numVal_(item.reimbursement)
      },
      month: run.month
    }, snapshot.rates);
    var hold = payload.hold === true;
    var patch = {
      bonus: result.bonus, incentive: result.incentive, advance_recovery: result.advance_recovery,
      other_deduction: result.other_deduction, ot_hours: result.overtime_hours,
      gross_earnings: result.gross_earnings, pt: result.pt, tds: result.tds,
      total_deductions: result.total_deductions, net_pay: result.net_pay, ctc_cost: result.ctc_cost,
      status: hold ? 'HOLD' : 'CALCULATED',
      hold_reason: hold ? (payload.hold_reason || payload.note || 'Held for review') : '',
      calc_notes: result.calc_note
    };
    if (hold) { patch.net_pay = 0; }
    Db.update(c, 'PayrollItems', 'item_id', item.item_id, patch, { actor: ctx.userId });
    var totals = Payroll.recomputeTotals_(c, run.run_id);
    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, {
      total_employees: totals.employees, total_gross: totals.gross, total_deductions: totals.deductions,
      total_net: totals.net, total_employer_cost: totals.employer_cost
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.item.update', entity: 'PayrollItems', entity_id: item.item_id,
      before: { net_pay: numVal_(item.net_pay), bonus: numVal_(item.bonus), other_deduction: numVal_(item.other_deduction), status: item.status },
      after: { net_pay: patch.net_pay, bonus: patch.bonus, other_deduction: patch.other_deduction, status: patch.status, note: payload.note },
      note: (hold ? 'Payroll row put on hold' : 'Payroll row adjusted') + ' for ' + txt_(item.employee_name) + (payload.note ? ' — ' + payload.note : ''), severity: 'SENSITIVE'
    });
    return { item_id: item.item_id, net_pay: patch.net_pay, status: patch.status, totals: totals };
  },

  /* =========================================================== approve === */
  runApprove: function (ctx, payload) {
    Perm.require(ctx, 'payroll.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (txt_(run.status) === 'APPROVED') fail_('ALREADY_DONE', 'This run is already approved.');
    if (txt_(run.status) !== 'CALCULATED') fail_('NOT_ALLOWED', 'Only a fully calculated run can be approved (current status: ' + txt_(run.status) + ').');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'An approval remark is required.', { field: 'remark' });
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === run.run_id; });
    if (!items.length) fail_('VALIDATION', 'This run has no payroll rows yet. Please calculate it first.');
    if (payload.approve_items !== false) {
      items.forEach(function (i) {
        if (txt_(i.status) !== 'HOLD') {
          Db.update(c, 'PayrollItems', 'item_id', i.item_id, { status: 'APPROVED' }, { actor: ctx.userId });
        }
      });
    }
    var totals = Payroll.recomputeTotals_(c, run.run_id);
    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, {
      status: 'APPROVED', approved_by: ctx.userId, approved_by_name: txt_(ctx.name), approved_at: nowIso_(),
      approval_remark: payload.remark,
      total_employees: totals.employees, total_gross: totals.gross, total_deductions: totals.deductions,
      total_net: totals.net, total_employer_cost: totals.employer_cost
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.runs.approve', entity: 'PayrollRuns', entity_id: run.run_id,
      before: { status: run.status }, after: { status: 'APPROVED', remark: payload.remark, ...totals },
      note: 'Payroll approved for ' + monthLabel_(run.month) + ' — net ₹' + totals.net + '. Remark: ' + payload.remark, severity: 'SENSITIVE'
    });
    Notify.notifyCompanyAdmins_(ctx.companyId, {
      title: 'Payroll approved: ' + monthLabel_(run.month),
      body: totals.employees + ' employee(s), net payable ₹' + totals.net + '. Mark it paid once the bank transfer is done.',
      kind: 'PAYROLL', link_action: 'payroll.run', link_payload: { run_id: run.run_id }
    });
    if (Config.systemBool_('email_sending_enabled', true)) {
      var admins = Db.all(masterCtx_(), 'Users', function (u) {
        return txt_(u.company_id) === ctx.companyId && txt_(u.scope) === 'COMPANY' && !txt_(u.employee_id) && txt_(u.status) === 'ACTIVE';
      });
      admins.slice(0, 5).forEach(function (u) {
        if (!isEmail_(u.email)) return;
        Notify.send({
          to: u.email, template: 'PAYROLL_APPROVED',
          vars: { code: txt_(run.code), month_label: monthLabel_(run.month), employees: totals.employees, net: '₹' + totals.net }
        });
      });
    }
    return { run_id: run.run_id, status: 'APPROVED', totals: totals };
  },

  runCancel: function (ctx, payload) {
    Perm.require(ctx, 'payroll.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (txt_(run.status) === 'PAID') fail_('NOT_ALLOWED', 'A paid run cannot be cancelled. Process a correction or an advance in the next month instead.');
    if (!txt_(payload.reason)) fail_('VALIDATION', 'Please write why this run is being cancelled.', { field: 'reason' });
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === run.run_id; });
    items.forEach(function (i) {
      // release any claims that were reserved by this run
      safeJson_(i.claim_ids, []).forEach(function (claimId) {
        var claim = Db.find(c, 'ExpenseClaims', 'claim_id', claimId);
        if (claim && txt_(claim.payroll_run_id) === run.run_id) {
          Db.update(c, 'ExpenseClaims', 'claim_id', claimId, { payroll_run_id: '', payroll_item_id: '' }, { actor: ctx.userId });
        }
      });
      Db.softDelete(c, 'PayrollItems', 'item_id', i.item_id, { actor: ctx.userId });
    });
    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, {
      status: 'CANCELLED', cancelled_reason: payload.reason, progress_json: jsonStr_({ cursor: 0, total: 0, chunk_total: 0 })
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.runs.cancel', entity: 'PayrollRuns', entity_id: run.run_id,
      before: { status: run.status, net: numVal_(run.total_net) }, after: { status: 'CANCELLED', reason: payload.reason },
      note: 'Payroll cancelled for ' + monthLabel_(run.month) + ' (' + items.length + ' rows removed). Reason: ' + payload.reason, severity: 'SENSITIVE'
    });
    return { run_id: run.run_id, status: 'CANCELLED', items_removed: items.length };
  },

  /* ============================================================== paid === */
  markPaid: function (ctx, payload) {
    Perm.require(ctx, 'payroll.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (txt_(run.status) === 'PAID') fail_('ALREADY_DONE', 'This run is already marked paid.');
    if (txt_(run.status) !== 'APPROVED') fail_('NOT_ALLOWED', 'Only an approved run can be marked paid (current status: ' + txt_(run.status) + ').');
    if (!txt_(payload.payment_reference)) fail_('VALIDATION', 'Enter the payment reference (UTR / cheque number) for the audit trail.', { field: 'payment_reference' });

    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.run_id) === run.run_id && txt_(i.status) !== 'HOLD'; });
    if (!items.length) fail_('VALIDATION', 'There are no approved payroll rows to pay.');

    var claimsPaid = 0, attendanceLocked = 0;
    items.forEach(function (i) {
      Db.update(c, 'PayrollItems', 'item_id', i.item_id, { status: 'PAID' }, { actor: ctx.userId });
      safeJson_(i.claim_ids, []).forEach(function (claimId) {
        var claim = Db.find(c, 'ExpenseClaims', 'claim_id', claimId);
        if (!claim || txt_(claim.status) === 'PAID') return;
        Db.update(c, 'ExpenseClaims', 'claim_id', claimId, {
          status: 'PAID', paid_at: todayIso_(), payroll_run_id: run.run_id, payroll_item_id: i.item_id
        }, { actor: ctx.userId });
        claimsPaid++;
      });
    });
    Db.all(c, 'Attendance', function (a) {
      return txt_(a.date) >= txt_(run.period_from) && txt_(a.date) <= txt_(run.period_to);
    }).forEach(function (a) {
      Db.update(c, 'Attendance', 'attendance_id', a.attendance_id, { payroll_locked: 'TRUE' }, { system: true });
      attendanceLocked++;
    });

    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, {
      status: 'PAID', paid_at: todayIso_(), payment_reference: payload.payment_reference,
      payment_mode: txt_(payload.payment_mode || 'NEFT').toUpperCase()
    }, { actor: ctx.userId });

    var payslips = null;
    if (payload.generate_payslips !== false) {
      payslips = Payslip.bulkGenerate(ctx, { run_id: run.run_id, template: getSetting_(ctx, 'payroll.payslip_template', 'CLASSIC'), batch: 25 });
    }
    items.forEach(function (i) {
      var employee = Db.find(c, 'Employees', 'employee_id', i.employee_id);
      if (employee && txt_(employee.user_id)) {
        Notify.push([employee.user_id], {
          company_id: ctx.companyId, title: 'Salary for ' + monthLabel_(run.month) + ' credited',
          body: 'Net pay ₹' + numVal_(i.net_pay) + ' · reference ' + payload.payment_reference + '. Your payslip is available in the app.',
          kind: 'PAYROLL', link_action: 'payroll.payslips', link_payload: { month: run.month }
        });
      }
    });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.markPaid', entity: 'PayrollRuns', entity_id: run.run_id,
      before: { status: run.status }, after: { status: 'PAID', reference: payload.payment_reference, mode: payload.payment_mode, employees: items.length, claims_paid: claimsPaid },
      note: 'Payroll marked paid for ' + monthLabel_(run.month) + ' — ' + items.length + ' employee(s), ₹' + numVal_(run.total_net) + ' (' + payload.payment_reference + '). ' + claimsPaid + ' reimbursement(s) settled.',
      severity: 'SENSITIVE'
    });
    Notify.notifyCompanyAdmins_(ctx.companyId, {
      title: 'Payroll paid: ' + monthLabel_(run.month),
      body: items.length + ' employee(s) marked paid · reference ' + payload.payment_reference + (payslips ? ' · ' + (payslips.generated || 0) + ' payslip(s) generated' : ''),
      kind: 'PAYROLL', link_action: 'payroll.run', link_payload: { run_id: run.run_id }
    });
    return {
      run_id: run.run_id, status: 'PAID', employees_paid: items.length, claims_paid: claimsPaid,
      attendance_locked: attendanceLocked, payslips: payslips,
      message: 'Payroll marked paid. ' + (payslips && payslips.remaining ? payslips.remaining + ' payslip(s) are still being generated — open the run again to finish them.' : 'Payslips are ready.')
    };
  },

  /** Safety net for a calculation that was interrupted (hourly trigger). */
  sweepStuckRuns: function () {
    var stuck = [];
    Db.all(masterCtx_(), 'Companies', function (c) { return txt_(c.status) === 'ACTIVE' && !!txt_(c.spreadsheet_id); }).forEach(function (company) {
      try {
        var c = companyCtx_(company.company_id, { requireActive: false });
        var staleBefore = Utilities.formatDate(new Date(Date.now() - 15 * 60000), APP.timezone, "yyyy-MM-dd'T'HH:mm:ss");
        Db.all(c, 'PayrollRuns', function (r) {
          return txt_(r.status) === 'PROCESSING' && txt_(r.updated_at) < staleBefore;
        }).forEach(function (r) {
          stuck.push({ company_id: company.company_id, run_id: r.run_id, month: r.month });
          logEvent_('WARN', 'Payroll.sweepStuckRuns', 'Run ' + txt_(r.code) + ' of ' + txt_(company.name) + ' is still PROCESSING; open the payroll screen to resume it.', { run: r.run_id });
        });
      } catch (e) { /* workspace may be broken; ignore here */ }
    });
    return { found: stuck.length, runs: stuck, note: 'Interrupted runs are resumed from the Payroll screen (Resume button) or by re-running calculate.resume.' };
  },

  /* ===================================================== employee view === */
  mySummary: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { available: false };
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.employee_id) === ctx.employeeId; });
    items = sortRows_(items, 'created_at', 'DESC');
    var paid = items.filter(function (i) { return txt_(i.status) === 'PAID' || txt_(i.status) === 'APPROVED'; });
    var fy = fyOf_(todayIso_());
    var ytd = items.filter(function (i) { return txt_(i.payslip_id) || txt_(i.status) === 'PAID'; });
    var runsByMonth = {};
    Db.all(c, 'PayrollRuns').forEach(function (r) { runsByMonth[txt_(r.run_id)] = r; });
    var contribution = function (i) {
      return {
        month_label: i.month_label,
        pf_employee: numVal_(i.pf_employee), pf_employer: numVal_(i.pf_employer),
        esic_employee: numVal_(i.esic_employee), esic_employer: numVal_(i.esic_employer),
        pt: numVal_(i.pt), tds: numVal_(i.tds)
      };
    };
    return {
      available: true,
      recent: paid.slice(0, 6).map(function (i) {
        var run = runsByMonth[txt_(i.run_id)];
        return {
          item_id: i.item_id, month: run ? run.month : '', month_label: run ? monthLabel_(run.month) : '',
          status: i.status, gross: numVal_(i.gross_earnings), deductions: numVal_(i.total_deductions),
          net_pay: numVal_(i.net_pay), reimbursement: numVal_(i.reimbursement), payslip_id: i.payslip_id
        };
      }),
      ytd: {
        fy: fy,
        months_paid: paid.length,
        gross: round0_(sum_(paid, function (i) { return i.gross_earnings; })),
        net: round0_(sum_(paid, function (i) { return i.net_pay; })),
        pf_employee: round0_(sum_(paid, function (i) { return i.pf_employee; })),
        pf_employer: round0_(sum_(paid, function (i) { return i.pf_employer; })),
        esic_employee: round0_(sum_(paid, function (i) { return i.esic_employee; })),
        pt: round0_(sum_(paid, function (i) { return i.pt; })),
        tds: round0_(sum_(paid, function (i) { return i.tds; })),
        reimbursed: round0_(sum_(paid, function (i) { return i.reimbursement; }))
      },
      current_structure: (function () {
        var s = Employees.currentStructure_(ctx, ctx.employeeId);
        return s ? Employees.structureOut_(ctx, s) : null;
      })(),
      contribution_sample: paid.length ? contribution(paid[0]) : null,
      note: 'Figures shown here come from payroll runs. For the official document, open the payslip.'
    };
  }
};
