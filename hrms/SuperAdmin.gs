/**
 * ============================================================================
 *  FocusHR  —  SuperAdmin.gs
 *  The platform owner's console: companies and approvals, impersonation,
 *  subscriptions & revenue, system configuration, support tickets escalated
 *  to the platform, logs, diagnostics and maintenance tools.
 * ============================================================================
 */

var SuperAdmin = {

  /* ============================================================ helpers == */
  stats_: function (companyId) {
    var out = { employees: 0, active_employees: 0, projects: 0, users: 0, last_activity: '', storage_note: '' };
    try {
      var cctx = companyCtx_(companyId, { requireActive: false });
      var emps = Db.all(cctx, 'Employees');
      out.employees = emps.length;
      out.active_employees = emps.filter(function (e) {
        var st = txt_(e.status).toUpperCase();
        return st === 'ACTIVE' || st === 'PROBATION' || st === 'NOTICE';
      }).length;
      out.projects = Db.count(cctx, 'Projects');
      var last = sortRows_(Db.all(cctx, 'AuditLog'), 'created_at', 'DESC')[0];
      out.last_activity = last ? last.created_at : '';
    } catch (e) {
      out.error = e.message;
    }
    out.users = Db.count(masterCtx_(), 'Users', function (u) { return txt_(u.company_id) === companyId; });
    return out;
  },

  companyCard_: function (c) {
    var s = SuperAdmin.stats_(c.company_id);
    return {
      company_id: c.company_id,
      name: c.name,
      legal_name: c.legal_name,
      gstin: c.gstin,
      pan: c.pan,
      state: c.state,
      city: c.city,
      status: c.status,
      plan: c.plan,
      verification_mode: c.verification_mode,
      verification_remark: c.verification_remark,
      admin_name: c.admin_name,
      admin_email: c.admin_email,
      admin_phone: c.admin_phone,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
      industry: c.industry,
      company_size: c.company_size,
      created_at: c.created_at,
      approved_at: c.approved_at,
      brand_color: txt_(c.brand_color) || '#2563eb',
      logo_file_id: c.logo_file_id,
      spreadsheet_url: txt_(c.spreadsheet_id) ? 'https://docs.google.com/spreadsheets/d/' + c.spreadsheet_id + '/edit' : '',
      drive_folder_url: txt_(c.drive_folder_id) ? 'https://drive.google.com/drive/folders/' + c.drive_folder_id : '',
      stats: s
    };
  },

  /* ========================================================== dashboard == */
  dashboard: function (ctx) {
    Perm.require(ctx, 'super.view');
    var companies = Db.all(masterCtx_(), 'Companies');
    var byStatus = {};
    STATUS.COMPANY.forEach(function (s) { byStatus[s] = 0; });
    companies.forEach(function (c) { byStatus[txt_(c.status).toUpperCase()] = (byStatus[txt_(c.status).toUpperCase()] || 0) + 1; });

    var users = Db.all(masterCtx_(), 'Users');
    var employeeLogins = users.filter(function (u) { return txt_(u.scope) === 'COMPANY' && txt_(u.employee_id); });
    var sessions = Db.all(masterCtx_(), 'Sessions', function (s) { return !txt_(s.ended_at) && txt_(s.expires_at) > nowIso_(); });

    var revenue = Db.all(masterCtx_(), 'Revenue');
    var paid = revenue.filter(function (r) { return txt_(r.status).toUpperCase() === 'PAID'; });
    var pendingRevenue = revenue.filter(function (r) { return txt_(r.status).toUpperCase() !== 'PAID'; });
    var subs = Db.all(masterCtx_(), 'Subscriptions', function (s) { return txt_(s.status).toUpperCase() === 'ACTIVE'; });

    var since = isoAddDays_(todayIso_(), -29);
    var signups30 = companies.filter(function (c) { return txt_(c.created_at).slice(0, 10) >= since; }).length;

    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(isoToDate_(todayIso_()).getTime());
      d.setMonth(d.getMonth() - i);
      var key = Utilities.formatDate(d, APP.timezone, 'yyyy-MM');
      months.push({
        month: key,
        label: monthLabel_(key).slice(0, 3) + ' ' + key.slice(2, 4),
        signups: companies.filter(function (c) { return txt_(c.created_at).slice(0, 7) === key; }).length,
        revenue: round0_(sum_(paid.filter(function (r) { return txt_(r.paid_at).slice(0, 7) === key; }), function (r) { return r.total_amount; }))
      });
    }

    var errorsToday = Db.all(masterCtx_(), 'Logs', function (l) {
      return txt_(l.level) === 'ERROR' && txt_(l.created_at).slice(0, 10) === todayIso_();
    });

    return {
      kpis: {
        companies_total: companies.length,
        companies_active: byStatus.ACTIVE || 0,
        companies_pending: byStatus.PENDING || 0,
        companies_suspended: byStatus.SUSPENDED || 0,
        companies_rejected: byStatus.REJECTED || 0,
        signups_last_30_days: signups30,
        users_total: users.length,
        employee_logins: employeeLogins.length,
        active_sessions: sessions.length,
        revenue_collected: round0_(sum_(paid, function (r) { return r.total_amount; })),
        revenue_pending: round0_(sum_(pendingRevenue, function (r) { return r.total_amount; })),
        active_subscriptions: subs.length,
        open_tickets: Db.count(masterCtx_(), 'SuperTickets', function (t) {
          var st = txt_(t.status).toUpperCase();
          return st === 'OPEN' || st === 'IN_PROGRESS';
        }),
        errors_today: errorsToday.length,
        emails_queued: Db.count(masterCtx_(), 'EmailQueue', function (r) { return txt_(r.status) !== 'SENT'; })
      },
      monthly: months,
      status_split: byStatus,
      pending_companies: sortRows_(companies.filter(function (c) { return txt_(c.status) === 'PENDING'; }), 'created_at', 'ASC')
        .map(SuperAdmin.companyCard_), 
      recent_companies: sortRows_(companies, 'created_at', 'DESC').slice(0, 6).map(function (c) {
        return { company_id: c.company_id, name: c.name, status: c.status, city: c.city, created_at: c.created_at, plan: c.plan };
      }),
      recent_activity: Audit.recent(ctx, 12),
      health: Setup.health()
    };
  },

  /* ========================================================== companies == */
  companiesList: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var all = Db.all(masterCtx_(), 'Companies');
    if (payload.status) all = all.filter(function (c) { return txt_(c.status).toUpperCase() === txt_(payload.status).toUpperCase(); });
    if (payload.search) all = all.filter(function (c) { return matchesSearch_(c, SCHEMA.Companies.search, payload.search); });
    all = sortRows_(all, payload.sort || 'created_at', payload.dir || 'DESC');
    var page = paginate_(all, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(SuperAdmin.companyCard_),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      status_counts: (function () {
        var counts = {};
        Db.all(masterCtx_(), 'Companies').forEach(function (c) { counts[txt_(c.status).toUpperCase()] = (counts[txt_(c.status).toUpperCase()] || 0) + 1; });
        return counts;
      })()
    };
  },

  companiesBasics: function (ctx) {
    Perm.require(ctx, 'super.view');
    return {
      rows: sortRows_(Db.all(masterCtx_(), 'Companies').map(function (c) {
        return { company_id: c.company_id, name: c.name, status: c.status, city: c.city, admin_email: c.admin_email };
      }), 'name', 'ASC')
    };
  },

  companyGet: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var card = SuperAdmin.companyCard_(c);
    card.notes = c.notes;
    card.subscription = null;
    var sub = Db.findOne(masterCtx_(), 'Subscriptions', function (s) { return txt_(s.company_id) === c.company_id && txt_(s.status) === 'ACTIVE'; });
    if (sub) {
      card.subscription = {
        subscription_id: sub.subscription_id, plan: sub.plan, seats: intVal_(sub.seats), price_per_seat: numVal_(sub.price_per_seat),
        billing_cycle: sub.billing_cycle, started_at: sub.started_at, ends_at: sub.ends_at, status: sub.status, auto_renew: boolVal_(sub.auto_renew)
      };
    }
    card.admin_user = null;
    if (txt_(c.admin_user_id)) {
      var u = Db.find(masterCtx_(), 'Users', 'user_id', c.admin_user_id);
      if (u) {
        card.admin_user = {
          user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, status: u.status,
          last_login_at: u.last_login_at, must_change_password: boolVal_(u.must_change_password),
          locked_until: u.locked_until
        };
      }
    }
    card.employees_sample = [];
    try {
      var cctx = companyCtx_(c.company_id, { requireActive: false });
      card.employees_sample = sortRows_(Db.all(cctx, 'Employees'), 'created_at', 'DESC').slice(0, 5).map(function (e) {
        return { employee_id: e.employee_id, code: e.code, name: e.name, designation: e.designation, status: e.status, joining_date: e.joining_date };
      });
      card.recent_audit = Audit.recent({ scope: 'COMPANY', companyId: c.company_id, companyCtx: cctx, name: 'Super Admin', userId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent }, 8);
      card.tables_ready = Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'COMPANY'; })
        .every(function (t) { return !!cctx.ss.getSheetByName(t); });
    } catch (e) {
      card.workspace_error = e.message;
    }
    Audit.sensitive(ctx, 'super', 'super.companies.get', 'Companies', c.company_id, 'Viewed company workspace details');
    return card;
  },

  companyApprove: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    if (txt_(c.status).toUpperCase() === 'ACTIVE') fail_('ALREADY_DONE', 'This company is already active.');
    var prov = null;
    if (!txt_(c.spreadsheet_id)) {
      prov = Company.provision_(c, { ip: ctx.ip, userAgent: ctx.userAgent }, { source: 'SUPER_APPROVAL', admin_email: c.admin_email });
    }
    var plan = txt_(payload.plan || c.plan || Config.systemGet('default_plan', 'TRIAL'));
    Db.update(masterCtx_(), 'Companies', 'company_id', c.company_id, {
      status: 'ACTIVE',
      plan: plan,
      approved_at: nowIso_(),
      verification_remark: txt_(payload.remark) || 'Approved by Super Admin.',
      trial_ends_at: txt_(c.trial_ends_at) || isoAddDays_(todayIso_(), Config.systemNum_('trial_days', 14))
    }, { actor: ctx.userId });
    Db.update(masterCtx_(), 'Users', 'user_id', c.admin_user_id, { status: 'ACTIVE' }, { system: true });

    if (payload.seats) {
      SuperAdmin.subscriptionsSave(ctx, {
        company_id: c.company_id, plan: plan, seats: payload.seats,
        price_per_seat: 0, billing_cycle: 'MONTHLY', started_at: todayIso_(), status: 'ACTIVE'
      });
    }
    if (payload.welcome_email !== false) {
      Notify.send({
        to: normEmail_(c.admin_email), template: 'COMPANY_APPROVED',
        vars: { admin_name: txt_(c.admin_name), company_name: txt_(c.name), login_email: normEmail_(c.admin_email), support_email: Config.systemGet('support_email', '') },
        related_type: 'Company', related_id: c.company_id
      });
    }
    Notify.notifyCompanyAdmins_(c.company_id, {
      title: 'Your workspace is live',
      body: 'Welcome to ' + APP.name + '! Start by adding branches, projects and employees.',
      kind: 'SYSTEM'
    });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.approve', entity: 'Companies', entity_id: c.company_id,
      before: { status: c.status }, after: { status: 'ACTIVE', plan: plan, remark: payload.remark },
      note: 'Company approved' + (prov ? ' and workspace provisioned' : ''), severity: 'SENSITIVE'
    });
    return { company_id: c.company_id, status: 'ACTIVE', provisioned: !!prov, provision: prov };
  },

  companyReject: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    if (txt_(payload.remark).length < 5) fail_('VALIDATION', 'Please write the reason — it is emailed to the applicant.', { field: 'remark' });
    Db.update(masterCtx_(), 'Companies', 'company_id', c.company_id, {
      status: 'REJECTED', verification_remark: txt_(payload.remark)
    }, { actor: ctx.userId });
    Db.all(masterCtx_(), 'Users', function (u) { return txt_(u.company_id) === c.company_id; })
      .forEach(function (u) { Db.update(masterCtx_(), 'Users', 'user_id', u.user_id, { status: 'INACTIVE' }, { system: true }); });
    Notify.send({
      to: normEmail_(c.admin_email), template: 'COMPANY_REJECTED',
      vars: { admin_name: txt_(c.admin_name), company_name: txt_(c.name), remark: payload.remark },
      related_type: 'Company', related_id: c.company_id
    });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.reject', entity: 'Companies', entity_id: c.company_id,
      before: { status: c.status }, after: { status: 'REJECTED', remark: payload.remark }, note: 'Company rejected', severity: 'SENSITIVE'
    });
    return { company_id: c.company_id, status: 'REJECTED' };
  },

  companySetStatus: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var status = txt_(payload.status).toUpperCase();
    if (STATUS.COMPANY.indexOf(status) < 0) fail_('VALIDATION', 'Unknown status.');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    if (status === 'SUSPENDED') {
      Db.all(masterCtx_(), 'Sessions', function (s) { return txt_(s.company_id) === c.company_id && !txt_(s.ended_at); })
        .forEach(function (s) { Db.update(masterCtx_(), 'Sessions', 'session_id', s.session_id, { ended_at: nowIso_(), ended_reason: 'COMPANY_SUSPENDED' }, { system: true }); });
    }
    Db.update(masterCtx_(), 'Companies', 'company_id', c.company_id, { status: status, verification_remark: txt_(payload.remark) || c.verification_remark }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.setStatus', entity: 'Companies', entity_id: c.company_id,
      before: { status: c.status }, after: { status: status, remark: payload.remark },
      note: 'Status changed to ' + status, severity: 'SENSITIVE'
    });
    return { company_id: c.company_id, status: status };
  },

  companyUpdate: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var patch = {};
    ['name', 'legal_name', 'gstin', 'pan', 'state', 'city', 'address', 'pincode', 'contact_name', 'contact_email',
      'contact_phone', 'industry', 'company_size', 'plan', 'verification_mode', 'notes'].forEach(function (k) {
      if (payload[k] !== undefined) patch[k] = payload[k];
    });
    if (patch.gstin && !isGstin_(patch.gstin)) fail_('VALIDATION', 'GSTIN format looks wrong.', { field: 'gstin' });
    if (patch.pan && !isPan_(patch.pan)) fail_('VALIDATION', 'PAN format looks wrong.', { field: 'pan' });
    Db.update(masterCtx_(), 'Companies', 'company_id', c.company_id, patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.update', entity: 'Companies', entity_id: c.company_id,
      before: { name: c.name, gstin: c.gstin, pan: c.pan, plan: c.plan, verification_mode: c.verification_mode },
      after: patch, note: 'Company profile updated'
    });
    return { company_id: c.company_id, updated: Object.keys(patch).length };
  },

  resendCredentials: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var to = normEmail_(payload.to || c.admin_email);
    var user = txt_(c.admin_user_id) ? Db.find(masterCtx_(), 'Users', 'user_id', c.admin_user_id) : null;
    if (!user) fail_('NOT_FOUND', 'This company has no admin user yet.');
    var temp = strongTempPassword_();
    var salt = randomSalt_();
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
      password_salt: salt, password_hash: hashPassword_(temp, salt), password_set_at: nowIso_(),
      must_change_password: 'TRUE', failed_attempts: 0, locked_until: '', status: 'ACTIVE'
    }, { actor: ctx.userId });
    Notify.send({ to: to, template: 'TEMP_PASSWORD', vars: { name: txt_(user.name), password: temp }, related_type: 'Company', related_id: c.company_id });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.resendCredentials', entity: 'Users', entity_id: user.user_id,
      note: 'New temporary password emailed to ' + maskEmail_(to), severity: 'SENSITIVE'
    });
    return { sent_to: maskEmail_(to), temp_password: temp };
  },

  resetAdminPassword: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var user = txt_(c.admin_user_id) ? Db.find(masterCtx_(), 'Users', 'user_id', c.admin_user_id) : null;
    if (!user) fail_('NOT_FOUND', 'This company has no admin user yet.');
    var out = { user_id: user.user_id, email: maskEmail_(user.email) };
    if (txt_(payload.mode) === 'OTP') {
      var otp = Auth.createOtp_('PASSWORD_RESET', normEmail_(user.email), { userId: user.user_id, companyId: c.company_id, ip: ctx.ip });
      Notify.sendOtp({ email: user.email, code: otp, purpose: 'PASSWORD_RESET', name: user.name, company_id: c.company_id });
      out.mode = 'OTP';
      out.sent = true;
    } else {
      var temp = strongTempPassword_();
      var salt = randomSalt_();
      Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
        password_salt: salt, password_hash: hashPassword_(temp, salt), password_set_at: nowIso_(),
        must_change_password: 'TRUE', failed_attempts: 0, locked_until: '', status: 'ACTIVE'
      }, { actor: ctx.userId });
      Notify.send({ to: user.email, template: 'TEMP_PASSWORD', vars: { name: user.name, password: temp } });
      out.mode = 'TEMP';
      out.temp_password = temp;
    }
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.resetAdminPassword', entity: 'Users', entity_id: user.user_id,
      note: 'Admin password reset (' + out.mode + ')', severity: 'SENSITIVE'
    });
    return out;
  },

  reprovision: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var res = Company.provision_(c, { ip: ctx.ip, userAgent: ctx.userAgent }, { source: 'SUPER_REPAIR', admin_email: c.admin_email });
    Audit.write(ctx, {
      module: 'super', action: 'super.companies.reprovision', entity: 'Companies', entity_id: c.company_id,
      note: 'Workspace tables/folders verified (' + res.tables_created.length + ' tables created)', severity: 'SENSITIVE'
    });
    return res;
  },

  /* ==================================================== subscriptions ==== */
  subscriptionsList: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var rows = Db.all(masterCtx_(), 'Subscriptions');
    if (payload.company_id) rows = rows.filter(function (r) { return txt_(r.company_id) === txt_(payload.company_id); });
    if (payload.search) {
      rows = rows.filter(function (r) {
        var company = companyRow_(r.company_id);
        return matchesSearch_(r, ['plan', 'status', 'company_id'], payload.search) ||
          (company && matchesSearch_(company, ['name'], payload.search));
      });
    }
    var page = paginate_(sortRows_(rows, 'created_at', 'DESC'), payload.page, payload.pageSize);
    var names = {};
    Db.all(masterCtx_(), 'Companies').forEach(function (c) { names[txt_(c.company_id)] = txt_(c.name); });
    return {
      rows: page.rows.map(function (r) {
        return {
          subscription_id: r.subscription_id, company_id: r.company_id, company_name: names[txt_(r.company_id)] || '',
          plan: r.plan, seats: intVal_(r.seats), price_per_seat: numVal_(r.price_per_seat), billing_cycle: r.billing_cycle,
          started_at: r.started_at, ends_at: r.ends_at, status: r.status, auto_renew: boolVal_(r.auto_renew), notes: r.notes,
          monthly_value: round0_(numVal_(r.seats) * numVal_(r.price_per_seat))
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      plans: ['TRIAL', 'STARTER', 'GROWTH', 'ENTERPRISE'],
      totals: {
        active: Db.count(masterCtx_(), 'Subscriptions', function (r) { return txt_(r.status) === 'ACTIVE'; }),
        mrr: round0_(sum_(Db.all(masterCtx_(), 'Subscriptions', function (r) { return txt_(r.status) === 'ACTIVE'; }), function (r) {
          return numVal_(r.seats) * numVal_(r.price_per_seat);
        }))
      }
    };
  },

  subscriptionsSave: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var patch = {
      company_id: c.company_id, plan: txt_(payload.plan).toUpperCase(), seats: intVal_(payload.seats, 0),
      price_per_seat: numVal_(payload.price_per_seat, 0), billing_cycle: txt_(payload.billing_cycle || 'MONTHLY').toUpperCase(),
      started_at: payload.started_at || todayIso_(), ends_at: payload.ends_at || '',
      status: txt_(payload.status || 'ACTIVE').toUpperCase(),
      auto_renew: payload.auto_renew === false ? 'FALSE' : 'TRUE', notes: payload.notes
    };
    if (patch.status === 'ACTIVE') {
      Db.all(masterCtx_(), 'Subscriptions', function (r) {
        return txt_(r.company_id) === c.company_id && txt_(r.status) === 'ACTIVE' && txt_(r.subscription_id) !== txt_(payload.subscription_id);
      }).forEach(function (r) {
        Db.update(masterCtx_(), 'Subscriptions', 'subscription_id', r.subscription_id, { status: 'SUPERSEDED' }, { actor: ctx.userId });
      });
    }
    var row;
    if (payload.subscription_id) {
      row = Db.update(masterCtx_(), 'Subscriptions', 'subscription_id', payload.subscription_id, patch, { actor: ctx.userId });
    } else {
      row = Db.insert(masterCtx_(), 'Subscriptions', patch, { actor: ctx.userId });
    }
    Db.update(masterCtx_(), 'Companies', 'company_id', c.company_id, { plan: patch.plan }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'super', action: 'super.subscriptions.save', entity: 'Subscriptions', entity_id: row.subscription_id,
      after: patch, note: 'Subscription ' + patch.plan + ' for ' + txt_(c.name)
    });
    return { subscription_id: row.subscription_id };
  },

  /* =========================================================== revenue === */
  revenueList: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var rows = Db.all(masterCtx_(), 'Revenue');
    if (payload.company_id) rows = rows.filter(function (r) { return txt_(r.company_id) === payload.company_id; });
    if (payload.search) rows = rows.filter(function (r) { return matchesSearch_(r, SCHEMA.Revenue.search, payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var names = {};
    Db.all(masterCtx_(), 'Companies').forEach(function (c) { names[txt_(c.company_id)] = txt_(c.name); });
    return {
      rows: page.rows.map(function (r) {
        return {
          revenue_id: r.revenue_id, company_id: r.company_id, company_name: names[txt_(r.company_id)] || '',
          invoice_no: r.invoice_no, amount: numVal_(r.amount), tax_amount: numVal_(r.tax_amount),
          total_amount: numVal_(r.total_amount), period_from: r.period_from, period_to: r.period_to,
          paid_at: r.paid_at, payment_mode: r.payment_mode, reference: r.reference, status: r.status, notes: r.notes
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      totals: {
        collected: round0_(sum_(Db.all(masterCtx_(), 'Revenue', function (r) { return txt_(r.status) === 'PAID'; }), function (r) { return r.total_amount; })),
        pending: round0_(sum_(Db.all(masterCtx_(), 'Revenue', function (r) { return txt_(r.status) !== 'PAID'; }), function (r) { return r.total_amount; }))
      }
    };
  },

  revenueSave: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var c = Db.get(masterCtx_(), 'Companies', 'company_id', payload.company_id);
    var amount = numVal_(payload.amount);
    var tax = numVal_(payload.tax_amount);
    var patch = {
      company_id: c.company_id,
      invoice_no: txt_(payload.invoice_no) || 'INV-' + todayIso_().replace(/-/g, '') + '-' + randomDigits_(3),
      amount: amount, tax_amount: tax, total_amount: numVal_(payload.total_amount, amount + tax),
      period_from: payload.period_from || '', period_to: payload.period_to || '',
      paid_at: payload.paid_at || (txt_(payload.status) === 'PAID' ? todayIso_() : ''),
      payment_mode: txt_(payload.payment_mode || 'BANK'), reference: payload.reference,
      status: txt_(payload.status || 'PENDING').toUpperCase(), notes: payload.notes
    };
    var row = payload.revenue_id
      ? Db.update(masterCtx_(), 'Revenue', 'revenue_id', payload.revenue_id, patch, { actor: ctx.userId })
      : Db.insert(masterCtx_(), 'Revenue', patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'super', action: 'super.revenue.save', entity: 'Revenue', entity_id: row.revenue_id,
      after: patch, note: 'Revenue entry ' + patch.invoice_no + ' (' + patch.status + ')'
    });
    return { revenue_id: row.revenue_id, invoice_no: patch.invoice_no };
  },

  /* ==================================================== system config ==== */
  configSave: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var items = payload.items || [];
    var before = {};
    items.forEach(function (i) { before[txt_(i.key)] = Config.systemGet(txt_(i.key), ''); });
    var res = Config.systemSet(items, ctx.userId);
    var after = {};
    items.forEach(function (i) { after[txt_(i.key)] = Config.systemGet(txt_(i.key), ''); });
    var masked = function (o) {
      var copy = {};
      Object.keys(o).forEach(function (k) { copy[k] = /token|secret|key/i.test(k) ? '***' : o[k]; });
      return copy;
    };
    Audit.write(ctx, {
      module: 'super', action: 'super.config.save', entity: 'SystemConfig', entity_id: '',
      before: masked(before), after: masked(after), note: 'System configuration updated (' + res.saved + ' keys)', severity: 'SENSITIVE'
    });
    return res;
  },

  /* =========================================================== tickets === */
  ticketsList: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var rows = Db.all(masterCtx_(), 'SuperTickets');
    if (payload.status) rows = rows.filter(function (t) { return txt_(t.status).toUpperCase() === txt_(payload.status).toUpperCase(); });
    if (payload.search) rows = rows.filter(function (t) { return matchesSearch_(t, SCHEMA.SuperTickets.search, payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var names = {};
    Db.all(masterCtx_(), 'Companies').forEach(function (c) { names[txt_(c.company_id)] = txt_(c.name); });
    var commentCounts = {};
    Db.all(masterCtx_(), 'SuperTicketComments').forEach(function (cm) {
      commentCounts[txt_(cm.ticket_id)] = (commentCounts[txt_(cm.ticket_id)] || 0) + 1;
    });
    return {
      rows: page.rows.map(function (t) {
        return {
          ticket_id: t.ticket_id, code: t.ticket_id, company_id: t.company_id, company_name: names[txt_(t.company_id)] || '',
          raised_by_name: t.raised_by_name, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
          assigned_to: t.assigned_to, last_reply_at: t.last_reply_at, created_at: t.created_at,
          comments: commentCounts[txt_(t.ticket_id)] || 0, resolution: t.resolution
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      counts: (function () {
        var out = {};
        STATUS.TICKET.forEach(function (s) { out[s] = 0; });
        Db.all(masterCtx_(), 'SuperTickets').forEach(function (t) { out[txt_(t.status).toUpperCase()] = (out[txt_(t.status).toUpperCase()] || 0) + 1; });
        return out;
      })()
    };
  },

  ticketGet: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var t = Db.get(masterCtx_(), 'SuperTickets', 'ticket_id', payload.ticket_id);
    var company = companyRow_(t.company_id);
    return {
      ticket: {
        ticket_id: t.ticket_id, company_id: t.company_id, company_name: company ? txt_(company.name) : '',
        raised_by_name: t.raised_by_name, subject: t.subject, category: t.category, priority: t.priority,
        status: t.status, created_at: t.created_at, last_reply_at: t.last_reply_at, resolution: t.resolution
      },
      comments: sortRows_(Db.all(masterCtx_(), 'SuperTicketComments', function (cm) { return txt_(cm.ticket_id) === t.ticket_id; }), 'created_at', 'ASC')
        .map(function (cm) {
          return {
            comment_id: cm.comment_id, author_name: cm.author_name, author_scope: cm.author_scope,
            body: cm.body, is_internal: boolVal_(cm.is_internal), at: cm.created_at
          };
        })
    };
  },

  ticketReply: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var t = Db.get(masterCtx_(), 'SuperTickets', 'ticket_id', payload.ticket_id);
    Db.insert(masterCtx_(), 'SuperTicketComments', {
      ticket_id: t.ticket_id, author_user_id: ctx.userId, author_name: txt_(ctx.name) + ' (Platform)',
      author_scope: 'SUPER', body: payload.body, is_internal: payload.is_internal ? 'TRUE' : 'FALSE'
    }, { actor: ctx.userId });
    var status = txt_(payload.status || (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status)).toUpperCase();
    Db.update(masterCtx_(), 'SuperTickets', 'ticket_id', t.ticket_id, { status: status, last_reply_at: nowIso_() }, { actor: ctx.userId });
    if (!payload.is_internal) {
      var admins = Db.all(masterCtx_(), 'Users', function (u) {
        return txt_(u.company_id) === t.company_id && txt_(u.scope) === 'COMPANY' && !txt_(u.employee_id) && txt_(u.status) === 'ACTIVE';
      });
      admins.forEach(function (u) {
        Notify.send({
          to: u.email, template: 'TICKET_REPLY',
          vars: { name: u.name, code: t.ticket_id, subject: t.subject, body: payload.body, status: status }
        });
      });
      Notify.notifyCompanyAdmins_(t.company_id, {
        title: 'Reply on ticket ' + t.ticket_id,
        body: txt_(payload.body).slice(0, 180),
        kind: 'SUPPORT',
        link_action: 'support.tickets.get',
        link_payload: { ticket_id: t.ticket_id }
      });
    }
    Audit.write(ctx, {
      module: 'super', action: 'super.tickets.reply', entity: 'SuperTickets', entity_id: t.ticket_id,
      after: { status: status, internal: !!payload.is_internal }, note: 'Platform replied to escalated ticket'
    });
    return { ticket_id: t.ticket_id, status: status };
  },

  /* ============================================================== logs === */
  logsList: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var rows = Db.all(masterCtx_(), 'Logs');
    if (payload.level) rows = rows.filter(function (r) { return txt_(r.level).toUpperCase() === txt_(payload.level).toUpperCase(); });
    if (payload.search) rows = rows.filter(function (r) { return matchesSearch_(r, SCHEMA.Logs.search, payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return { log_id: r.log_id, level: r.level, source: r.source, message: r.message, context: safeJson_(r.context_json, {}), at: r.created_at };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      counts: (function () {
        var out = { INFO: 0, WARN: 0, ERROR: 0 };
        Db.all(masterCtx_(), 'Logs').forEach(function (r) { out[txt_(r.level).toUpperCase()] = (out[txt_(r.level).toUpperCase()] || 0) + 1; });
        return out;
      })()
    };
  },

  emailQueue: function (ctx, payload) {
    Perm.require(ctx, 'super.view');
    var rows = Db.all(masterCtx_(), 'EmailQueue');
    if (payload.status) rows = rows.filter(function (r) { return txt_(r.status).toUpperCase() === txt_(payload.status).toUpperCase(); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return {
          queue_id: r.queue_id, to: r.to_email, subject: r.subject, status: r.status, attempts: intVal_(r.attempts),
          last_error: r.last_error, sent_at: r.sent_at, at: r.created_at
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      quota: (function () { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; } })()
    };
  },

  /* ======================================================= diagnostics === */
  diagnostics: function (ctx) {
    Perm.require(ctx, 'super.manage');
    var out = { at: nowIso_(), app: { name: APP.name, version: APP.version, timezone: APP.timezone }, checks: [], tables: [], sessions: [], triggers: [] };

    var masterId = prop_(PROPS.master);
    out.master = { spreadsheet_id: masterId, url: masterId ? 'https://docs.google.com/spreadsheets/d/' + masterId + '/edit' : '' };
    out.drive_root = { folder_id: prop_(PROPS.driveRoot), url: prop_(PROPS.driveRoot) ? 'https://drive.google.com/drive/folders/' + prop_(PROPS.driveRoot) : '' };
    out.setup_at = prop_(PROPS.setupAt);

    var ctxMaster = masterCtx_();
    Object.keys(SCHEMA).forEach(function (t) {
      if (SCHEMA[t].scope !== 'MASTER') return;
      var sheet = ctxMaster.ss.getSheetByName(t);
      out.tables.push({
        table: t, scope: 'MASTER', exists: !!sheet,
        rows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
        columns: sheet ? sheet.getLastColumn() : 0,
        expected_columns: headers_(t).length
      });
    });
    var companies = Db.all(masterCtx_(), 'Companies');
    companies.forEach(function (c) {
      var entry = { company_id: c.company_id, name: c.name, status: c.status, tables: [], error: '' };
      try {
        var cctx = companyCtx_(c.company_id, { requireActive: false });
        Object.keys(SCHEMA).forEach(function (t) {
          if (SCHEMA[t].scope !== 'COMPANY') return;
          if (entry.tables.length >= 6) return;
          var sheet = cctx.ss.getSheetByName(t);
          entry.tables.push({ table: t, rows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0, exists: !!sheet });
        });
        entry.total_tables = Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'COMPANY'; }).length;
        entry.spreadsheet_url = 'https://docs.google.com/spreadsheets/d/' + c.spreadsheet_id + '/edit';
      } catch (e) {
        entry.error = e.message;
      }
      out.companies = (out.companies || []).concat([entry]);
    });

    var openSessions = Db.all(masterCtx_(), 'Sessions', function (s) { return !txt_(s.ended_at) && txt_(s.expires_at) > nowIso_(); });
    out.sessions = openSessions.slice(0, 20).map(function (s) {
      return { user_id: s.user_id, name: s.name, scope: s.scope, company_id: s.company_id, ip: s.ip, issued_at: s.issued_at, last_seen_at: s.last_seen_at, expires_at: s.expires_at };
    });
    out.open_sessions = openSessions.length;

    out.triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    try { out.mail_quota = MailApp.getRemainingDailyQuota(); } catch (e) { out.mail_quota = -1; }
    out.otp_codes_live = Db.count(masterCtx_(), 'OtpCodes', function (o) { return !txt_(o.consumed_at) && txt_(o.expires_at) > nowIso_(); });
    out.logs = {
      info: Db.count(masterCtx_(), 'Logs', function (l) { return txt_(l.level) === 'INFO'; }),
      warn: Db.count(masterCtx_(), 'Logs', function (l) { return txt_(l.level) === 'WARN'; }),
      error: Db.count(masterCtx_(), 'Logs', function (l) { return txt_(l.level) === 'ERROR'; })
    };
    out.integrity = Audit.checkIntegrity();
    return out;
  },

  /* ======================================================== maintenance === */
  maintenance: function (ctx, payload) {
    Perm.require(ctx, 'super.manage');
    var task = txt_(payload.task);
    var out = { task: task, at: nowIso_(), ok: true, message: '', summary: {}, details: {} };
    if (task === 'prune_sessions') {
      var closed = Auth.pruneSessions();
      var open = Db.count(masterCtx_(), 'Sessions', function (s) { return !txt_(s.ended_at); });
      var kept = Db.count(masterCtx_(), 'Sessions');
      out.closed = closed; out.open = open; out.kept = kept;
      out.summary = { closed: closed, open: open, kept: kept };
      out.message = closed + ' expired session(s) closed. ' + open + ' session(s) are still active.';
    } else if (task === 'flush_emails') {
      var sent = Notify.flushQueue(50);
      out.emails = sent;
      out.summary = { emails: sent };
      out.message = sent ? sent + ' queued email(s) were sent.' : 'The email queue is empty.';
    } else if (task === 'repair_tables') {
      var repair = Setup.repair();
      out.repair = repair;
      out.summary = repair;
      out.message = 'Table repair finished — missing tabs and columns were recreated.';
    } else if (task === 'rebuild_counters') {
      var counters = Audit.rebuildCounters(ctx);
      out.counters = counters.counters; out.highest_ids = counters.rows;
      out.summary = { counters: counters.counters };
      out.message = counters.message;
    } else if (task === 'archive_logs') {
      var days = intVal_(payload.payload && payload.payload.days, 90);
      var archive = Audit.archiveLogs(ctx, days);
      out.archived = archive.archived; out.file = archive.file_id ? { file_id: archive.file_id, file_name: archive.file_name, url: archive.url } : null;
      out.summary = { archived: archive.archived, days: days };
      out.message = archive.message;
    } else if (task === 'integrity') {
      var check = Audit.checkIntegrity();
      out.integrity = { checked_at: check.checked_at, issues: check.issues };
      out.summary = check.summary;
      out.message = check.message;
    } else if (task === 'rebuild_counters_and_check') {
      var both = Audit.rebuildCounters(ctx);
      var check2 = Audit.checkIntegrity();
      out.counters = both.counters; out.summary = check2.summary; out.message = both.message + ' ' + check2.message;
    } else {
      fail_('VALIDATION', 'Unknown maintenance task: ' + task + '. Use prune_sessions, flush_emails, repair_tables, rebuild_counters, integrity or archive_logs.');
    }
    Audit.write(ctx, {
      module: 'super', action: 'system.maintenance', entity: 'Maintenance', entity_id: task,
      after: { task: task, summary: out.summary, payload: payload.payload },
      note: 'Maintenance: ' + task + ' — ' + out.message, severity: 'SENSITIVE'
    });
    return out;
  },

  /** Recovery path when the Super Admin password is lost. */
  bootstrapAdmin: function (ctx, payload) {
    var key = prop_('SETUP_KEY');
    if (payload.setup_key && key && txt_(payload.setup_key) === key) {
      var email = normEmail_(Config.systemGet('support_email', 'admin@' + 'focushr.app'));
      var user = Db.findOne(masterCtx_(), 'Users', function (u) { return txt_(u.scope) === 'SUPER'; });
      if (!user) fail_('NOT_FOUND', 'No Super Admin exists. Run setupSystem() from the Apps Script editor.');
      var temp = strongTempPassword_();
      var salt = randomSalt_();
      Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
        password_salt: salt, password_hash: hashPassword_(temp, salt), must_change_password: 'TRUE',
        failed_attempts: 0, locked_until: '', status: 'ACTIVE'
      }, { system: true });
      logEvent_('WARN', 'SuperAdmin.bootstrapAdmin', 'Super Admin password reset via setup key for ' + user.email, {});
      return { email: user.email, temp_password: temp, message: 'Use this password to sign in, then set your own.' };
    }
    return {
      available: !!key,
      hint: key
        ? 'The one-time setup key is shown in the Logs tab (search for SETUP_KEY). Call this action with setup_key to reset the Super Admin password.'
        : 'No setup key is stored. Run setupSystem({reset_super_password: true}) from the Apps Script editor to issue a new password.'
    };
  }
};
