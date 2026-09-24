/**
 * ============================================================================
 *  FocusHR  —  Expense.gs
 *  Expense / reimbursement claims: raise with bills, approve or reject with a
 *  remark, bulk decide, and hand approved amounts to the payroll run exactly
 *  once (protected by idempotency keys).
 * ============================================================================
 */

var Expense = {

  /* ========================================================== categories = */
  categoriesList: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'ExpenseCategories', function (t) { return boolVal_(t.is_active) !== false; });
    return {
      rows: sortRows_(rows.map(function (t) {
        return {
          category_id: t.category_id, code: t.code, name: t.name, max_amount: numVal_(t.max_amount),
          requires_bill: boolVal_(t.requires_bill), is_taxable: boolVal_(t.is_taxable), gl_code: t.gl_code,
          sort_order: intVal_(t.sort_order, 9)
        };
      }), 'sort_order', 'ASC')
    };
  },

  /* ============================================================== claims = */
  out_: function (ctx, cl, c) {
    var employee = c ? Db.find(c, 'Employees', 'employee_id', cl.employee_id) : null;
    return {
      claim_id: cl.claim_id, code: cl.code, employee_id: cl.employee_id, employee_name: cl.employee_name,
      category_id: cl.category_id, category_name: cl.category_name, claim_date: cl.claim_date,
      from_date: cl.from_date, to_date: cl.to_date, amount: numVal_(cl.amount), tax_amount: numVal_(cl.tax_amount),
      total_amount: numVal_(cl.total_amount), advance_amount: numVal_(cl.advance_amount), net_amount: numVal_(cl.net_amount),
      description: cl.description, items: safeJson_(cl.items_json, []), bill_count: intVal_(cl.bill_count),
      bill_file_ids: safeJson_(cl.bill_file_ids, []), status: cl.status, submitted_at: cl.submitted_at,
      decided_by_name: cl.decided_by_name, decided_at: cl.decided_at, decision_remark: cl.decision_remark,
      paid_at: cl.paid_at, payroll_run_id: cl.payroll_run_id, created_at: cl.created_at,
      employee_code: employee ? txt_(employee.code) : '', department: employee ? txt_(employee.department) : '',
      project_id: employee ? txt_(employee.project_id) : ''
    };
  },

  claimsList: function (ctx, payload) {
    Perm.require(ctx, 'expense.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'ExpenseClaims', function (cl) {
      if (allowed && allowed.indexOf(txt_(cl.employee_id)) < 0) return false;
      if (payload.status && txt_(cl.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.employee_id && txt_(cl.employee_id) !== txt_(payload.employee_id)) return false;
      if (payload.category_id && txt_(cl.category_id) !== txt_(payload.category_id)) return false;
      if (payload.from && txt_(cl.claim_date) < txt_(payload.from)) return false;
      if (payload.to && txt_(cl.claim_date) > txt_(payload.to)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (cl) { return matchesSearch_(cl, SCHEMA.ExpenseClaims.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'claim_date', payload.dir || 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (cl) { return Expense.out_(ctx, cl, c); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      totals: {
        submitted_amount: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'SUBMITTED'; }), function (r) { return r.net_amount; })),
        approved_amount: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'APPROVED'; }), function (r) { return r.net_amount; })),
        paid_amount: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'PAID'; }), function (r) { return r.net_amount; })),
        pending_count: rows.filter(function (r) { return txt_(r.status) === 'SUBMITTED'; }).length
      },
      can_approve: Perm.canApprove(ctx, 'expense')
    };
  },

  claimsMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0, totals: {} };
    var rows = Db.all(c, 'ExpenseClaims', function (cl) {
      if (txt_(cl.employee_id) !== ctx.employeeId) return false;
      if (payload.status && txt_(cl.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      return true;
    });
    rows = sortRows_(rows, 'claim_date', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (cl) { return Expense.out_(ctx, cl, c); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      totals: {
        draft: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'DRAFT'; }), function (r) { return r.net_amount; })),
        submitted: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'SUBMITTED'; }), function (r) { return r.net_amount; })),
        approved: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'APPROVED'; }), function (r) { return r.net_amount; })),
        paid: round0_(sum_(rows.filter(function (r) { return txt_(r.status) === 'PAID'; }), function (r) { return r.net_amount; }))
      },
      categories: Expense.categoriesList(ctx).rows
    };
  },

  claimGet: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var cl = Db.get(c, 'ExpenseClaims', 'claim_id', payload.claim_id);
    var mine = txt_(cl.employee_id) === txt_(ctx.employeeId);
    if (!mine) Perm.require(ctx, 'expense.view');
    else Perm.assertEmployee(ctx, cl.employee_id);
    var out = Expense.out_(ctx, cl, c);
    out.history = Audit.recent(ctx, 12, function (r) {
      return txt_(r.entity) === 'ExpenseClaims' && txt_(r.entity_id) === cl.claim_id;
    });
    if (txt_(cl.payroll_run_id)) {
      var run = Db.find(c, 'PayrollRuns', 'run_id', cl.payroll_run_id);
      out.payroll = run ? { run_id: run.run_id, code: run.code, month: run.month, status: run.status } : null;
    }
    return out;
  },

  claimSave: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var isAdminEntry = !!payload.employee_id;
    var employeeId = isAdminEntry ? txt_(payload.employee_id) : txt_(ctx.employeeId);
    if (!employeeId) fail_('EMPLOYEE_ONLY', 'Expense claims are raised from an employee login. Admins can add one on behalf of an employee from the claims screen.');
    if (isAdminEntry) Perm.require(ctx, 'expense.create');
    Perm.assertEmployee(ctx, employeeId);
    var employee = Db.get(c, 'Employees', 'employee_id', employeeId);
    var category = Db.get(c, 'ExpenseCategories', 'category_id', payload.category_id);
    if (boolVal_(category.is_active) === false) fail_('NOT_ALLOWED', txt_(category.name) + ' is not available right now.');

    if (txt_(payload.idempotency_key)) {
      var dupeKey = Db.findOne(c, 'ExpenseClaims', function (cl) { return txt_(cl.idempotency_key) === txt_(payload.idempotency_key); });
      if (dupeKey) {
        return { claim_id: dupeKey.claim_id, code: dupeKey.code, status: dupeKey.status, duplicate: true, message: 'This claim was already saved (' + txt_(dupeKey.code) + ').' };
      }
    }
    if (payload.claim_date > todayIso_()) fail_('VALIDATION', 'The expense date cannot be in the future.', { field: 'claim_date' });
    var window = getSettingNum_(ctx, 'expense.submission_window_days', 60);
    if (daysBetweenIso_(payload.claim_date, todayIso_()) > window) {
      fail_('VALIDATION', 'Expenses older than ' + window + ' days cannot be claimed here. Please speak to your accounts team.');
    }
    var amount = numVal_(payload.amount);
    if (!(amount > 0)) fail_('VALIDATION', 'Please enter the claim amount.', { field: 'amount' });
    if (numVal_(category.max_amount) > 0 && amount > numVal_(category.max_amount)) {
      fail_('VALIDATION', 'The limit for ' + txt_(category.name) + ' is ₹' + numVal_(category.max_amount) + ' per claim. Please split the claim or ask HR to revise the limit.');
    }
    var bills = (payload.bill_file_ids || []).filter(function (x) { return !!txt_(x); });
    if (boolVal_(category.requires_bill) && !bills.length && payload.submit !== false) {
      fail_('VALIDATION', txt_(category.name) + ' claims need a bill or receipt attached. Please upload the photo or PDF.', { field: 'bill_file_ids' });
    }
    if (!bills.length && amount > getSettingNum_(ctx, 'expense.max_without_bill', 500) && payload.submit !== false) {
      fail_('VALIDATION', 'Claims above ₹' + getSettingNum_(ctx, 'expense.max_without_bill', 500) + ' need a bill attached. For smaller amounts you can submit without one.');
    }
    var items = (payload.items || []).map(function (it) {
      return { date: toIsoDate_(it.date) || payload.claim_date, description: txt_(it.description), amount: numVal_(it.amount) };
    }).filter(function (it) { return it.amount !== 0 || it.description; });
    var tax = numVal_(payload.tax_amount);
    var total = round2_(amount + tax);
    var advance = numVal_(payload.advance_amount);
    if (advance > total) fail_('VALIDATION', 'The advance to recover cannot be more than the claim total.', { field: 'advance_amount' });
    var net = round2_(total - advance);

    var patch = {
      employee_id: employee.employee_id, employee_name: txt_(employee.name),
      category_id: category.category_id, category_name: txt_(category.name),
      claim_date: payload.claim_date, from_date: payload.from_date, to_date: payload.to_date,
      amount: amount, tax_amount: tax, total_amount: total, advance_amount: advance, net_amount: net,
      description: payload.description, items_json: jsonStr_(items), bill_count: bills.length,
      bill_file_ids: jsonStr_(bills), idempotency_key: txt_(payload.idempotency_key)
    };
    var row, created = false;
    if (payload.claim_id) {
      var existing = Db.get(c, 'ExpenseClaims', 'claim_id', payload.claim_id);
      if (txt_(existing.status) !== 'DRAFT') fail_('NOT_ALLOWED', 'A ' + txt_(existing.status).toLowerCase() + ' claim cannot be edited. Ask your manager to reject it if a change is needed.');
      if (txt_(existing.employee_id) !== txt_(employeeId)) Perm.require(ctx, 'expense.edit');
      row = Db.update(c, 'ExpenseClaims', 'claim_id', existing.claim_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'expense', action: 'expense.claims.save', entity: 'ExpenseClaims', entity_id: row.claim_id,
        before: { amount: numVal_(existing.amount), category_name: existing.category_name },
        after: { amount: amount, category_name: txt_(category.name) }, note: 'Draft claim updated'
      });
    } else {
      patch.code = Db.nextId(c, 'ExpenseClaims');
      patch.status = 'DRAFT';
      row = Db.insert(c, 'ExpenseClaims', patch, { actor: ctx.userId });
      created = true;
      Audit.write(ctx, {
        module: 'expense', action: 'expense.claims.save', entity: 'ExpenseClaims', entity_id: row.claim_id,
        after: redact_(patch), note: 'Claim created: ' + txt_(category.name) + ' ₹' + total + ' for ' + txt_(employee.name)
      });
    }
    var out = { claim_id: row.claim_id, code: row.code, status: row.status, net_amount: net, total_amount: total, created: created, bill_count: bills.length };
    if (payload.submit) {
      var submitted = Expense.claimSubmit(ctx, { claim_id: row.claim_id });
      out.status = submitted.status;
      out.message = submitted.message;
    }
    return out;
  },

  claimSubmit: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var cl = Db.get(c, 'ExpenseClaims', 'claim_id', payload.claim_id);
    var mine = txt_(cl.employee_id) === txt_(ctx.employeeId);
    if (!mine) Perm.require(ctx, 'expense.create');
    if (txt_(cl.status) !== 'DRAFT') fail_('ALREADY_DONE', 'This claim is already ' + txt_(cl.status).toLowerCase() + '.');
    Db.update(c, 'ExpenseClaims', 'claim_id', cl.claim_id, { status: 'SUBMITTED', submitted_at: nowIso_() }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'expense', action: 'expense.claims.submit', entity: 'ExpenseClaims', entity_id: cl.claim_id,
      before: { status: 'DRAFT' }, after: { status: 'SUBMITTED' },
      note: 'Claim ' + txt_(cl.code) + ' submitted for approval (₹' + numVal_(cl.net_amount) + ')'
    });
    var employee = Db.find(c, 'Employees', 'employee_id', cl.employee_id);
    Notify.notifyApprovers_(ctx, {
      title: 'Claim ' + txt_(cl.code) + ' awaiting approval',
      body: txt_(cl.employee_name) + ' · ' + txt_(cl.category_name) + ' · ₹' + numVal_(cl.net_amount),
      kind: 'EXPENSE', employee_id: cl.employee_id,
      link_action: 'expense.claims', link_payload: { claim_id: cl.claim_id }
    });
    if (employee && txt_(employee.user_id)) {
      Notify.push([employee.user_id], {
        company_id: ctx.companyId, title: 'Claim submitted',
        body: txt_(cl.code) + ' for ₹' + numVal_(cl.net_amount) + ' is with your approver.',
        kind: 'EXPENSE', link_action: 'expense.my', link_payload: { claim_id: cl.claim_id }
      });
    }
    return { claim_id: cl.claim_id, status: 'SUBMITTED', message: 'Claim ' + txt_(cl.code) + ' sent for approval.' };
  },

  claimDecide: function (ctx, payload) {
    Perm.require(ctx, 'expense.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var cl = Db.get(c, 'ExpenseClaims', 'claim_id', payload.claim_id);
    Perm.assertEmployee(ctx, cl.employee_id);
    if (txt_(cl.status) !== 'SUBMITTED') fail_('ALREADY_DONE', 'This claim is already ' + txt_(cl.status).toLowerCase() + '.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required — the employee sees it.', { field: 'remark' });
    var decision = txt_(payload.decision).toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) fail_('VALIDATION', 'Decision must be APPROVED or REJECTED.');
    var approvedAmount = numVal_(payload.approved_amount, numVal_(cl.total_amount));
    if (decision === 'APPROVED' && approvedAmount <= 0) fail_('VALIDATION', 'The approved amount must be more than zero.');
    if (decision === 'APPROVED' && approvedAmount > numVal_(cl.total_amount) * 1.5) {
      fail_('VALIDATION', 'The approved amount cannot be so much higher than the claimed amount.');
    }
    var patch = {
      status: decision, decided_by: ctx.userId, decided_by_name: txt_(ctx.name), decided_at: nowIso_(),
      decision_remark: payload.remark
    };
    if (decision === 'APPROVED') {
      patch.amount = numVal_(cl.amount);
      patch.total_amount = approvedAmount;
      patch.net_amount = round2_(approvedAmount - numVal_(cl.advance_amount));
    }
    Db.update(c, 'ExpenseClaims', 'claim_id', cl.claim_id, patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'expense', action: 'expense.claims.decide', entity: 'ExpenseClaims', entity_id: cl.claim_id,
      before: { status: cl.status, total_amount: numVal_(cl.total_amount) },
      after: { status: decision, total_amount: patch.total_amount !== undefined ? patch.total_amount : numVal_(cl.total_amount), remark: payload.remark },
      note: 'Claim ' + txt_(cl.code) + ' ' + decision + ' by ' + txt_(ctx.name), severity: 'SENSITIVE'
    });
    var employee = Db.find(c, 'Employees', 'employee_id', cl.employee_id);
    if (employee && txt_(employee.user_id)) {
      Notify.push([employee.user_id], {
        company_id: ctx.companyId, title: 'Claim ' + decision.toLowerCase(),
        body: txt_(cl.code) + ' · ₹' + (patch.net_amount !== undefined ? patch.net_amount : numVal_(cl.net_amount)) + '. ' + payload.remark,
        kind: 'EXPENSE', link_action: 'expense.my', link_payload: { claim_id: cl.claim_id }
      });
      var to = Email.resolve_(ctx, employee);
      if (to) Notify.send({
        to: to, template: 'CLAIM_DECISION',
        vars: {
          employee_name: txt_(cl.employee_name), code: txt_(cl.code), amount: '₹' + (patch.net_amount !== undefined ? patch.net_amount : numVal_(cl.net_amount)),
          decision: decision, remark: payload.remark
        }
      });
    }
    return { claim_id: cl.claim_id, status: decision, net_amount: patch.net_amount !== undefined ? patch.net_amount : numVal_(cl.net_amount) };
  },

  claimsBulkDecide: function (ctx, payload) {
    Perm.require(ctx, 'expense.approve');
    var ids = payload.claim_ids || [];
    if (!ids.length) fail_('VALIDATION', 'Select at least one claim.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required for a bulk decision.', { field: 'remark' });
    var done = 0, skipped = [];
    ids.forEach(function (id) {
      try {
        Expense.claimDecide(ctx, { claim_id: id, decision: payload.decision, remark: payload.remark });
        done++;
      } catch (e) {
        skipped.push({ claim_id: id, error: e.message });
      }
    });
    Audit.write(ctx, {
      module: 'expense', action: 'expense.claims.bulkDecide', entity: 'ExpenseClaims', entity_id: '',
      after: { decision: payload.decision, decided: done, skipped: skipped.length },
      note: 'Bulk ' + payload.decision + ' on ' + done + ' claim(s). Remark: ' + payload.remark, severity: 'SENSITIVE'
    });
    return { decided: done, skipped: skipped };
  },

  claimDelete: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var cl = Db.get(c, 'ExpenseClaims', 'claim_id', payload.claim_id);
    var mine = txt_(cl.employee_id) === txt_(ctx.employeeId);
    if (mine) {
      if (['DRAFT', 'SUBMITTED'].indexOf(txt_(cl.status)) < 0) fail_('NOT_ALLOWED', 'Approved or paid claims cannot be deleted. Ask accounts to adjust it.');
      if (txt_(cl.status) === 'SUBMITTED') Db.update(c, 'ExpenseClaims', 'claim_id', cl.claim_id, { status: 'DRAFT' }, { actor: ctx.userId });
    } else {
      Perm.require(ctx, 'expense.edit');
      if (txt_(cl.status) === 'PAID') fail_('NOT_ALLOWED', 'A paid claim cannot be deleted. Record an adjustment instead.');
    }
    if (txt_(cl.payroll_run_id)) fail_('LOCKED', 'This claim is already part of payroll run ' + txt_(cl.payroll_run_id) + '. Remove it from that run first.');
    Db.softDelete(c, 'ExpenseClaims', 'claim_id', cl.claim_id, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'expense', action: 'expense.claims.delete', entity: 'ExpenseClaims', entity_id: cl.claim_id,
      before: { status: cl.status, net_amount: numVal_(cl.net_amount), code: cl.code },
      note: 'Claim ' + txt_(cl.code) + ' removed by ' + txt_(ctx.name), severity: 'SENSITIVE'
    });
    return { deleted: true, claim_id: cl.claim_id };
  },

  claimsMarkPaid: function (ctx, payload) {
    Perm.require(ctx, 'expense.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var ids = payload.claim_ids || [];
    if (!ids.length) fail_('VALIDATION', 'Select at least one claim.');
    var paid = 0, skipped = [], total = 0;
    ids.forEach(function (id) {
      var cl = Db.find(c, 'ExpenseClaims', 'claim_id', id);
      if (!cl) { skipped.push({ claim_id: id, error: 'Not found' }); return; }
      if (txt_(cl.status) === 'PAID') { skipped.push({ claim_id: id, error: 'Already paid' }); return; }
      if (txt_(cl.status) !== 'APPROVED') { skipped.push({ claim_id: id, code: txt_(cl.code), error: 'Only approved claims can be marked paid (current: ' + txt_(cl.status) + ')' }); return; }
      Db.update(c, 'ExpenseClaims', 'claim_id', id, {
        status: 'PAID', paid_at: todayIso_(),
        decision_remark: txt_(cl.decision_remark) + (payload.payment_reference ? ' | Paid via ' + txt_(payload.payment_mode || 'BANK') + ' ref ' + payload.payment_reference : ' | Marked paid outside payroll')
      }, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'expense', action: 'expense.claims.markPaid', entity: 'ExpenseClaims', entity_id: id,
        before: { status: cl.status }, after: { status: 'PAID', reference: txt_(payload.payment_reference) },
        note: 'Claim ' + txt_(cl.code) + ' marked paid (₹' + numVal_(cl.net_amount) + ')', severity: 'SENSITIVE'
      });
      paid++;
      total += numVal_(cl.net_amount);
    });
    return { paid: paid, skipped: skipped, total_amount: round0_(total) };
  },

  /* ============================================================= summary = */
  summary: function (ctx, payload) {
    Perm.require(ctx, 'expense.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var from = payload.from || monthStart_(monthOfIso_(todayIso_()));
    var to = payload.to || monthEnd_(monthOfIso_(todayIso_()));
    var rows = Db.all(c, 'ExpenseClaims', function (cl) {
      if (allowed && allowed.indexOf(txt_(cl.employee_id)) < 0) return false;
      if (txt_(cl.claim_date) < from || txt_(cl.claim_date) > to) return false;
      if (txt_(cl.status) === 'DRAFT') return false;
      return true;
    });
    var byCategory = {}, byStatus = {}, byMonth = {}, byEmployee = {};
    rows.forEach(function (cl) {
      var cat = txt_(cl.category_name) || 'Other';
      byCategory[cat] = byCategory[cat] || { category: cat, count: 0, amount: 0 };
      byCategory[cat].count++;
      byCategory[cat].amount += numVal_(cl.net_amount);
      byStatus[txt_(cl.status)] = round0_((byStatus[txt_(cl.status)] || 0) + numVal_(cl.net_amount));
      var m = monthOfIso_(cl.claim_date);
      byMonth[m] = round0_((byMonth[m] || 0) + numVal_(cl.net_amount));
      var emp = txt_(cl.employee_name);
      byEmployee[emp] = byEmployee[emp] || { employee_name: emp, count: 0, amount: 0 };
      byEmployee[emp].count++;
      byEmployee[emp].amount += numVal_(cl.net_amount);
    });
    return {
      from: from, to: to,
      totals: {
        claims: rows.length,
        claimed: round0_(sum_(rows, function (cl) { return cl.net_amount; })),
        approved: round0_(sum_(rows.filter(function (cl) { return txt_(cl.status) === 'APPROVED'; }), function (cl) { return cl.net_amount; })),
        paid: round0_(sum_(rows.filter(function (cl) { return txt_(cl.status) === 'PAID'; }), function (cl) { return cl.net_amount; })),
        pending: round0_(sum_(rows.filter(function (cl) { return txt_(cl.status) === 'SUBMITTED'; }), function (cl) { return cl.net_amount; })),
        rejected: round0_(sum_(rows.filter(function (cl) { return txt_(cl.status) === 'REJECTED'; }), function (cl) { return cl.net_amount; })),
        reimbursable_from_payroll: round0_(sum_(rows.filter(function (cl) {
          return txt_(cl.status) === 'APPROVED' && !txt_(cl.payroll_run_id);
        }), function (cl) { return cl.net_amount; }))
      },
      by_category: Object.keys(byCategory).map(function (k) { return byCategory[k]; }).sort(function (a, b) { return b.amount - a.amount; }),
      by_status: byStatus,
      by_month: Object.keys(byMonth).sort().map(function (m) { return { month: m, label: monthLabel_(m), amount: byMonth[m] }; }),
      top_employees: Object.keys(byEmployee).map(function (k) { return byEmployee[k]; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 10)
    };
  }
};
