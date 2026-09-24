/**
 * ============================================================================
 *  FocusHR  —  Notify.gs
 *  One place for every outbound message: in-app bell, email (MailApp, queued
 *  and retryable) and WhatsApp Cloud API (or a click-to-send wa.me link when
 *  the API is not configured yet).
 * ============================================================================
 */

/** Resolve the best email address for an employee (falls back to the login). */
var Email = {
  resolve_: function (ctx, employee) {
    if (!employee) return '';
    if (txt_(employee.email) && isEmail_(employee.email)) return normEmail_(employee.email);
    if (txt_(employee.user_id)) {
      var u = Db.find(masterCtx_(), 'Users', 'user_id', employee.user_id);
      if (u && isEmail_(u.email)) return normEmail_(u.email);
    }
    return '';
  }
};

var Notify = {

  /* ------------------------------------------------------- email bodies -- */
  templates_: function (key, vars) {
    var v = vars || {};
    var c = v.company_name || APP.name;
    var t = {
      OTP_CODE: {
        subject: 'Your ' + APP.name + ' verification code',
        html: '<p>Hi ' + escapeHtml_(v.name || 'there') + ',</p>' +
          '<p>Your verification code is:</p>' +
          '<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">' + escapeHtml_(v.code) + '</p>' +
          '<p>This code is valid for ' + APP.otpTtlMinutes + ' minutes and can be used once. If you did not request it, please ignore this email.</p>'
      },
      OTP_SMS: { subject: '', html: APP.name + ' code: ' + txt_(v.code) + '. Valid ' + APP.otpTtlMinutes + ' min. Do not share.' },
      SIGNUP_RECEIVED: {
        subject: 'We received your ' + APP.name + ' registration',
        html: '<p>Hi ' + escapeHtml_(v.admin_name || 'there') + ',</p>' +
          '<p>Thank you for registering <b>' + escapeHtml_(v.company_name) + '</b>.</p>' +
          (v.pending
            ? '<p>Our team is verifying your company details. You will receive another email as soon as your workspace is activated (usually within one working day).</p>'
            : '<p>Your workspace is now active. Sign in at the ' + APP.name + ' web app with <b>' + escapeHtml_(v.login_email) + '</b> and the password you created.</p>') +
          '<p>— Team ' + APP.name + '</p>'
      },
      COMPANY_APPROVED: {
        subject: 'Your ' + APP.name + ' workspace is ready',
        html: '<p>Hi ' + escapeHtml_(v.admin_name || 'there') + ',</p>' +
          '<p><b>' + escapeHtml_(v.company_name) + '</b> has been verified and activated on ' + APP.name + '.</p>' +
          '<p>Sign in with <b>' + escapeHtml_(v.login_email) + '</b> and the password you set during signup. ' +
          'Add your branches, projects and employees to start using geo attendance and payroll.</p>' +
          '<p>Need a hand? Write to ' + escapeHtml_(v.support_email || '') + '.</p>'
      },
      COMPANY_REJECTED: {
        subject: 'About your ' + APP.name + ' registration',
        html: '<p>Hi ' + escapeHtml_(v.admin_name || 'there') + ',</p>' +
          '<p>We could not verify the details submitted for <b>' + escapeHtml_(v.company_name) + '</b>.</p>' +
          '<p><b>Reason:</b> ' + escapeHtml_(v.remark || 'Details did not match government records.') + '</p>' +
          '<p>Please reply to this email with the corrected details and we will re-open the review.</p>'
      },
      TEMP_PASSWORD: {
        subject: APP.name + ' temporary password',
        html: '<p>Hi ' + escapeHtml_(v.name || 'there') + ',</p>' +
          '<p>A temporary password has been created for your ' + APP.name + ' account.</p>' +
          '<p style="font-size:20px;font-weight:700">' + escapeHtml_(v.password) + '</p>' +
          '<p>Sign in and you will be asked to set your own password immediately.</p>'
      },
      USER_INVITE: {
        subject: 'You have been added to ' + APP.name,
        html: '<p>Hi ' + escapeHtml_(v.name || 'there') + ',</p>' +
          '<p>You have been added to the ' + APP.name + ' workspace of <b>' + escapeHtml_(c) + '</b> as <b>' + escapeHtml_(v.role || 'team member') + '</b>.</p>' +
          '<p>Sign in with your email <b>' + escapeHtml_(v.email || '') + '</b> using the temporary password below, then set your own password.</p>' +
          '<p style="font-size:20px;font-weight:700">' + escapeHtml_(v.password || '') + '</p>'
      },
      LEAVE_APPLIED: {
        subject: 'Leave request from ' + txt_(v.employee_name),
        html: '<p><b>' + escapeHtml_(v.employee_name) + '</b> (' + escapeHtml_(v.employee_code || '') + ') applied for <b>' + escapeHtml_(v.leave_type) + '</b> ' +
          'from <b>' + escapeHtml_(v.from_date) + '</b> to <b>' + escapeHtml_(v.to_date) + '</b> (' + escapeHtml_(v.days) + ' day(s)).</p>' +
          '<p>Reason: ' + escapeHtml_(v.reason || '-') + '</p><p>Please review it in the ' + APP.name + ' approvals screen.</p>'
      },
      LEAVE_DECISION: {
        subject: 'Your leave request was ' + txt_(v.decision).toLowerCase(),
        html: '<p>Hi ' + escapeHtml_(v.employee_name) + ',</p>' +
          '<p>Your <b>' + escapeHtml_(v.leave_type) + '</b> request for <b>' + escapeHtml_(v.from_date) + '</b> to <b>' + escapeHtml_(v.to_date) + '</b> was <b>' + escapeHtml_(v.decision) + '</b>.</p>' +
          '<p>Remark: ' + escapeHtml_(v.remark || '-') + '</p>' + (v.balance_line ? '<p>' + escapeHtml_(v.balance_line) + '</p>' : '')
      },
      REGULARIZATION_DECISION: {
        subject: 'Attendance correction ' + txt_(v.decision).toLowerCase(),
        html: '<p>Hi ' + escapeHtml_(v.employee_name) + ',</p>' +
          '<p>Your attendance correction request for <b>' + escapeHtml_(v.date) + '</b> was <b>' + escapeHtml_(v.decision) + '</b>.</p>' +
          '<p>Remark: ' + escapeHtml_(v.remark || '-') + '</p>'
      },
      CLAIM_DECISION: {
        subject: 'Expense claim ' + txt_(v.code) + ' ' + txt_(v.decision).toLowerCase(),
        html: '<p>Hi ' + escapeHtml_(v.employee_name) + ',</p>' +
          '<p>Your expense claim <b>' + escapeHtml_(v.code) + '</b> for <b>' + escapeHtml_(v.amount) + '</b> was <b>' + escapeHtml_(v.decision) + '</b>.</p>' +
          '<p>Remark: ' + escapeHtml_(v.remark || '-') + '</p>'
      },
      PAYSLIP_READY: {
        subject: 'Payslip for ' + txt_(v.month_label),
        html: '<p>Hi ' + escapeHtml_(v.employee_name) + ',</p>' +
          '<p>Your payslip for <b>' + escapeHtml_(v.month_label) + '</b> is available in the ' + APP.name + ' app' +
          (v.net_pay ? ' (net pay <b>' + escapeHtml_(v.net_pay) + '</b>)' : '') + '.</p>' +
          '<p>Open the app → Payslips to download or print it.</p>'
      },
      TRANSFER_DECISION: {
        subject: 'Project transfer ' + txt_(v.decision).toLowerCase(),
        html: '<p>Hi ' + escapeHtml_(v.employee_name) + ',</p>' +
          '<p>Your transfer to <b>' + escapeHtml_(v.to_project) + '</b> was <b>' + escapeHtml_(v.decision) + '</b>' +
          (v.effective_date ? ' with effect from <b>' + escapeHtml_(v.effective_date) + '</b>' : '') + '.</p>' +
          '<p>Remark: ' + escapeHtml_(v.remark || '-') + '</p>'
      },
      TICKET_REPLY: {
        subject: 'Update on ticket ' + txt_(v.code),
        html: '<p>Hi ' + escapeHtml_(v.name || 'there') + ',</p>' +
          '<p>There is a new reply on your support ticket <b>' + escapeHtml_(v.code) + ' — ' + escapeHtml_(v.subject) + '</b>:</p>' +
          '<blockquote style="border-left:3px solid #cbd5e1;padding-left:12px;color:#475569">' + escapeHtml_(v.body) + '</blockquote>' +
          '<p>Status: <b>' + escapeHtml_(v.status) + '</b></p>'
      },
      SUPPORT_TICKET_ACK: {
        subject: 'We received your ticket ' + txt_(v.code),
        html: '<p>Hi ' + escapeHtml_(v.name || 'there') + ',</p>' +
          '<p>Your ticket <b>' + escapeHtml_(v.code) + ' — ' + escapeHtml_(v.subject) + '</b> has reached the ' + APP.name + ' team. ' +
          'We usually reply within one working day.</p>'
      },
      DOC_EXPIRY: {
        subject: 'Document expiry reminder — ' + txt_(v.employee_name),
        html: '<p><b>' + escapeHtml_(v.employee_name) + '</b> (' + escapeHtml_(v.employee_code || '') + '): ' +
          '<b>' + escapeHtml_(v.doc_name) + '</b> expires on <b>' + escapeHtml_(v.expiry_date) + '</b>. ' +
          'Please collect a renewed copy.</p>'
      },
      PAYROLL_APPROVED: {
        subject: 'Payroll for ' + txt_(v.month_label) + ' approved',
        html: '<p>Payroll run <b>' + escapeHtml_(v.code) + '</b> for <b>' + escapeHtml_(v.month_label) + '</b> has been approved.</p>' +
          '<p>Employees: <b>' + escapeHtml_(v.employees) + '</b>, net payable: <b>' + escapeHtml_(v.net) + '</b>.</p>' +
          '<p>You can now mark it paid and generate payslips.</p>'
      },
      FORMULA_HELP: { subject: APP.name, html: '<p>—</p>' }
    };
    return t[key] || { subject: APP.name + ' notification', html: '<p>' + escapeHtml_(jsonStr_(v)) + '</p>' };
  },

  /* ----------------------------------------------------------- transport -- */
  send: function (msg) {
    var m = msg || {};
    var tpl = Notify.templates_(m.template, m.vars || {});
    var subject = txt_(m.subject || tpl.subject).replace(/\{\{\s*(\w+)\s*\}\}/g, function () { return ''; });
    Object.keys(m.vars || {}).forEach(function (k) {
      subject = subject.split('{{' + k + '}}').join(txt_(m.vars[k]));
    });
    var html = txt_(m.html) || tpl.html;
    Object.keys(m.vars || {}).forEach(function (k) {
      html = html.split('{{' + k + '}}').join(escapeHtml_(m.vars[k]));
    });
    var to = normEmail_(m.to);
    if (!to) return { sent: false, reason: 'no-recipient' };

    var row = Db.insert(masterCtx_(), 'EmailQueue', {
      to_email: to,
      cc: txt_(m.cc),
      subject: subject.slice(0, 240),
      body_html: html,
      status: 'QUEUED',
      attempts: 0,
      related_type: txt_(m.related_type),
      related_id: txt_(m.related_id)
    }, { system: true });

    var enabled = Config.systemBool_('email_sending_enabled', true);
    if (!enabled) return { sent: false, queued: true, queue_id: row.queue_id, reason: 'email-disabled' };
    return Notify.deliver_(row);
  },

  deliver_: function (queueRow) {
    try {
      MailApp.sendEmail({
        to: queueRow.to_email,
        cc: txt_(queueRow.cc) || undefined,
        subject: queueRow.subject,
        htmlBody: queueRow.body_html,
        name: txt_(Config.systemGet('from_name', APP.name))
      });
      Db.update(masterCtx_(), 'EmailQueue', 'queue_id', queueRow.queue_id, {
        status: 'SENT', sent_at: nowIso_(), attempts: intVal_(queueRow.attempts, 0) + 1, last_error: ''
      }, { system: true });
      return { sent: true, queue_id: queueRow.queue_id };
    } catch (e) {
      Db.update(masterCtx_(), 'EmailQueue', 'queue_id', queueRow.queue_id, {
        status: 'FAILED', attempts: intVal_(queueRow.attempts, 0) + 1, last_error: txt_(e.message).slice(0, 300)
      }, { system: true });
      logEvent_('ERROR', 'Notify.send', 'Email failed: ' + e.message, { to: queueRow.to_email });
      return { sent: false, queued: true, queue_id: queueRow.queue_id, error: e.message };
    }
  },

  /** Retry queued / failed emails (daily trigger + Super Admin button). */
  flushQueue: function (limit) {
    var pending = Db.all(masterCtx_(), 'EmailQueue', function (r) {
      var st = txt_(r.status).toUpperCase();
      return st === 'QUEUED' || (st === 'FAILED' && intVal_(r.attempts, 0) < 3);
    });
    pending = sortRows_(pending, 'created_at', 'ASC').slice(0, limit || 25);
    var sent = 0, failed = 0;
    pending.forEach(function (r) {
      var out = Notify.deliver_(r);
      if (out.sent) sent++; else failed++;
    });
    return { processed: pending.length, sent: sent, failed: failed };
  },

  /* -------------------------------------------------------------- OTPs --- */
  sendOtp: function (o) {
    var opts = o || {};
    var purpose = txt_(opts.purpose);
    var pretty = {
      SIGNUP: 'company registration', EMPLOYEE_ACTIVATE: 'account activation',
      EMPLOYEE_RESET: 'password reset', PASSWORD_RESET: 'password reset'
    }[purpose] || 'verification';
    var results = { email: null, whatsapp: null, logged: false };

    if (txt_(opts.email)) {
      results.email = Notify.send({
        to: opts.email, template: 'OTP_CODE',
        vars: { code: txt_(opts.code), name: txt_(opts.name), purpose: pretty },
        related_type: 'OTP', related_id: purpose
      });
    }
    if (txt_(opts.phone)) {
      var text = APP.name + ' ' + pretty + ' code: ' + txt_(opts.code) + '. Valid for ' + APP.otpTtlMinutes + ' minutes. Do not share this code with anyone.';
      results.whatsapp = Notify.sendWhatsApp(txt_(opts.phone), text);
    }
    if (Config.systemBool_('log_otp_codes', true)) {
      try {
        logEvent_('INFO', 'Notify.sendOtp', 'OTP for ' + purpose + ' (' + (txt_(opts.phone) ? maskPhone_(opts.phone) : maskEmail_(opts.email)) + '): ' + txt_(opts.code), { testing: true });
        results.logged = true;
      } catch (e) { /* logging must never break the flow */ }
    }
    return results;
  },

  /* ---------------------------------------------------------- WhatsApp --- */
  waLink: function (phone, text) {
    var cc = txt_(Config.systemGet('whatsapp_country_code', '91'));
    var p = normPhone_(phone);
    return 'https://wa.me/' + cc + p + '?text=' + encodeURIComponent(txt_(text));
  },

  sendWhatsApp: function (phone, text) {
    var enabled = Config.systemBool_('whatsapp_enabled', false);
    var token = txt_(Config.systemGet('whatsapp_token', ''));
    var phoneId = txt_(Config.systemGet('whatsapp_phone_id', ''));
    var link = Notify.waLink(phone, text);
    if (!enabled || !token || !phoneId) {
      return { sent: false, channel: 'LINK', link: link, reason: 'whatsapp-not-configured' };
    }
    try {
      var res = UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + phoneId + '/messages', {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token },
        payload: jsonStr_({
          messaging_product: 'whatsapp',
          to: txt_(Config.systemGet('whatsapp_country_code', '91')) + normPhone_(phone),
          type: 'text',
          text: { preview_url: false, body: txt_(text) }
        })
      });
      var body = safeJson_(res.getContentText(), {});
      var ok = res.getResponseCode() >= 200 && res.getResponseCode() < 300;
      if (!ok) logEvent_('WARN', 'Notify.whatsapp', 'WhatsApp send failed', { code: res.getResponseCode(), body: body });
      return { sent: ok, channel: 'API', link: link, response: ok ? 'queued' : txt_(body.error && body.error.message) };
    } catch (e) {
      logEvent_('WARN', 'Notify.whatsapp', 'WhatsApp error: ' + e.message, {});
      return { sent: false, channel: 'LINK', link: link, error: e.message };
    }
  },

  /* ------------------------------------------------------ in-app bell ---- */
  push: function (userIds, msg) {
    var ids = uniq_(userIds instanceof Array ? userIds : [userIds]).filter(function (x) { return !!txt_(x); });
    var m = msg || {};
    var out = [];
    ids.forEach(function (uid) {
      out.push(Db.insert(masterCtx_(), 'Notifications', {
        user_id: txt_(uid),
        company_id: txt_(m.company_id || ''),
        title: txt_(m.title).slice(0, 160),
        body: txt_(m.body).slice(0, 800),
        kind: txt_(m.kind || 'INFO').toUpperCase(),
        link_action: txt_(m.link_action),
        link_payload_json: m.link_payload ? jsonStr_(m.link_payload) : '',
        is_read: 'FALSE'
      }, { system: true }));
    });
    return out;
  },

  /** Notify the admin users of a company (non-employee logins by default). */
  notifyCompanyAdmins_: function (companyId, msg) {
    var admins = Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === txt_(companyId) && txt_(u.scope) === 'COMPANY' && !txt_(u.employee_id) && txt_(u.status) !== 'INACTIVE';
    });
    return Notify.push(admins.map(function (u) { return u.user_id; }), { company_id: companyId, title: msg.title, body: msg.body, kind: msg.kind, link_action: msg.link_action, link_payload: msg.link_payload });
  },

  /** Notify the managers who should act on something (approvers). */
  notifyApprovers_: function (ctx, msg) {
    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    var targetIds = [];
    var eff = Perm.load(ctx);
    // company admins + HR always see approvals
    Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && txt_(u.scope) === 'COMPANY' &&
        ['COMPANY_ADMIN', 'HR_MANAGER', 'ACCOUNTANT'].indexOf(txt_(u.role_code)) >= 0 && txt_(u.status) !== 'INACTIVE';
    }).forEach(function (u) { targetIds.push(u.user_id); });
    // plus the reporting manager / project incharge of the employee
    if (msg.employee_id) {
      var emp = Db.find(compCtx, 'Employees', 'employee_id', msg.employee_id);
      if (emp) {
        var managerIds = [];
        if (txt_(emp.manager_id)) {
          var mgr = Db.find(compCtx, 'Employees', 'employee_id', emp.manager_id);
          if (mgr && txt_(mgr.user_id)) managerIds.push(mgr.user_id);
        }
        if (txt_(emp.project_id)) {
          var proj = Db.find(compCtx, 'Projects', 'project_id', emp.project_id);
          if (proj && txt_(proj.incharge_employee_id)) {
            var incharge = Db.find(compCtx, 'Employees', 'employee_id', proj.incharge_employee_id);
            if (incharge && txt_(incharge.user_id)) managerIds.push(incharge.user_id);
          }
        }
        managerIds.forEach(function (id) { targetIds.push(id); });
      }
    }
    if (eff.isSuper) targetIds = [];
    return Notify.push(uniq_(targetIds), { company_id: ctx.companyId, title: msg.title, body: msg.body, kind: msg.kind, link_action: msg.link_action, link_payload: msg.link_payload });
  },

  list: function (ctx, params) {
    var p = params || {};
    var mine = Db.all(masterCtx_(), 'Notifications', function (n) { return txt_(n.user_id) === txt_(ctx.userId); });
    if (p.unread_only) mine = mine.filter(function (n) { return !boolVal_(n.is_read); });
    var page = Db.query(masterCtx_(), 'Notifications', {
      page: p.page, pageSize: p.pageSize || 20, sort: 'created_at', dir: 'DESC',
      filter: function (n) { return txt_(n.user_id) === txt_(ctx.userId); }
    });
    return {
      rows: page.rows.map(function (n) {
        return {
          notification_id: n.notification_id, title: n.title, body: n.body, kind: n.kind,
          link_action: n.link_action, link_payload: safeJson_(n.link_payload_json, {}),
          is_read: boolVal_(n.is_read), at: n.created_at
        };
      }),
      total: page.total, unread: mine.filter(function (n) { return !boolVal_(n.is_read); }).length,
      page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  markRead: function (ctx, payload) {
    if (payload.all) {
      Db.all(masterCtx_(), 'Notifications', function (n) { return txt_(n.user_id) === txt_(ctx.userId) && !boolVal_(n.is_read); })
        .forEach(function (n) {
          Db.update(masterCtx_(), 'Notifications', 'notification_id', n.notification_id, { is_read: 'TRUE', read_at: nowIso_() }, { system: true });
        });
      return { marked: 'all' };
    }
    var row = Db.findOne(masterCtx_(), 'Notifications', function (n) {
      return txt_(n.notification_id) === txt_(payload.notification_id) && txt_(n.user_id) === txt_(ctx.userId);
    });
    if (row) Db.update(masterCtx_(), 'Notifications', 'notification_id', row.notification_id, { is_read: 'TRUE', read_at: nowIso_() }, { system: true });
    return { marked: txt_(payload.notification_id) };
  },

  unreadCount: function (ctx) {
    return {
      unread: Db.all(masterCtx_(), 'Notifications', function (n) {
        return txt_(n.user_id) === txt_(ctx.userId) && !boolVal_(n.is_read);
      }).length
    };
  },

  /** Settings screen helper — fire a test message over a chosen channel. */
  testSend: function (ctx, payload) {
    var channel = txt_(payload.channel).toUpperCase().replace('-', '_');
    var to = txt_(payload.to);
    var stamp = fmtDateHuman_(nowIso_(), 'dd MMM yyyy HH:mm');
    var company = txt_(ctx.companyCtx && ctx.companyCtx.company ? ctx.companyCtx.company.name : APP.name);
    var body = 'This is a test message from ' + APP.name + ' for ' + company + ' sent on ' + stamp + '. ' +
      'If you can read this, your ' + channel + ' channel is working.';

    if (channel === 'EMAIL' || channel === 'MAIL') {
      if (!isEmail_(to)) fail_('VALIDATION', 'Enter a valid email address for the test message.', { field: 'to' });
      MailApp.sendEmail({
        to: normEmail_(to),
        subject: '[' + APP.name + '] Test email — ' + company,
        htmlBody: '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">' +
          '<p>' + escapeHtml_(body) + '</p>' +
          '<p style="color:#64748b;font-size:12px">' + escapeHtml_(APP.name) + ' · ' + escapeHtml_(APP.version) + '</p></div>',
        name: company
      });
      Audit.write(ctx, { module: 'settings', action: 'notify.test', entity: 'Settings', entity_id: 'notify',
        after: { channel: 'EMAIL', to: normEmail_(to) }, note: 'Test email sent to ' + normEmail_(to) });
      return { channel: 'EMAIL', sent: true, to: normEmail_(to), message: 'Test email sent to ' + normEmail_(to) + '. Ask the person to check the spam folder too.' };
    }

    if (channel === 'WHATSAPP' || channel === 'WA') {
      if (!isPhoneIn_(to)) fail_('VALIDATION', 'Enter a valid 10 digit Indian mobile number.', { field: 'to' });
      var res = Notify.sendWhatsApp(to, body);
      Audit.write(ctx, { module: 'settings', action: 'notify.test', entity: 'Settings', entity_id: 'notify',
        after: { channel: 'WHATSAPP', to: normPhone_(to), mode: res.channel, sent: res.sent }, note: 'Test WhatsApp attempted for ' + normPhone_(to) });
      return {
        channel: 'WHATSAPP', sent: !!res.sent, to: normPhone_(to), mode: res.channel, link: res.link,
        message: res.sent
          ? 'Test WhatsApp message sent to ' + normPhone_(to) + '.'
          : 'WhatsApp Cloud API is not configured, so open the link below to send it from your own WhatsApp.'
      };
    }

    if (channel === 'INAPP' || channel === 'IN_APP' || channel === 'BELL') {
      var pushed = Notify.push([ctx.userId], {
        company_id: ctx.companyId, title: 'Test notification', body: body, kind: 'INFO'
      });
      return { channel: 'INAPP', sent: true, message: 'Test notification added to the bell menu.', notification_id: pushed.length ? pushed[0].notification_id : '' };
    }

    fail_('VALIDATION', 'Choose a channel: EMAIL, WHATSAPP or INAPP.', { field: 'channel' });
  },

};
