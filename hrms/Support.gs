/**
 * ============================================================================
 *  FocusHR  —  Support.gs
 *  Two helpdesks in one file:
 *    • Company helpdesk  — employees raise HR questions, HR answers them.
 *    • Platform helpdesk — the company raises billing / technical tickets that
 *                          land in the Super Admin console.
 * ============================================================================
 */

var SupportCategories = ['ATTENDANCE', 'LEAVE', 'PAYROLL', 'EXPENSE', 'DOCUMENTS', 'LOGIN', 'PROJECT', 'OTHER'];
var SupportPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

var Support = {

  /* ============================================== company helpdesk ======= */
  ticketOut_: function (t, replies, canSeeInternal) {
    return {
      ticket_id: t.ticket_id, code: txt_(t.code), subject: txt_(t.subject), category: txt_(t.category),
      priority: txt_(t.priority), status: txt_(t.status), raised_by_name: txt_(t.raised_by_name),
      raised_by_user_id: txt_(t.raised_by_user_id), employee_id: txt_(t.employee_id),
      assigned_to: txt_(t.assigned_to), assigned_name: txt_(t.assigned_name),
      created_at: txt_(t.created_at), last_reply_at: txt_(t.last_reply_at), closed_at: txt_(t.closed_at),
      resolution: txt_(t.resolution), replies: intVal_(replies, 0),
      age_label: Support.age_(t.created_at, t.closed_at),
      can_see_internal: !!canSeeInternal
    };
  },

  age_: function (createdAt, closedAt) {
    if (!txt_(createdAt)) return '';
    var end = txt_(closedAt) || nowIso_();
    var mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(createdAt).getTime()) / 60000));
    if (mins < 60) return mins + ' min';
    if (mins < 60 * 24) return Math.round(mins / 60) + ' h';
    return Math.round(mins / 1440) + ' days';
  },

  ticketsList: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var canManage = Perm.has(ctx, 'support.edit');
    var rows = Db.all(c, 'Tickets', function (t) {
      if (payload.mine && txt_(t.raised_by_user_id) !== ctx.userId) return false;
      if (!canManage && !payload.mine) {
        var mine = txt_(t.raised_by_user_id) === ctx.userId;
        var teamTicket = ctx.employeeId && txt_(t.employee_id) && Support.isMyTeam_(ctx, c, txt_(t.employee_id));
        if (!mine && !teamTicket) return false;
      }
      if (payload.status && txt_(t.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.priority && txt_(t.priority).toUpperCase() !== txt_(payload.priority).toUpperCase()) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (t) { return matchesSearch_(t, SCHEMA.Tickets.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'created_at', payload.dir || 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var counts = {};
    STATUS.TICKET.forEach(function (s) { counts[s] = 0; });
    Db.all(c, 'Tickets', function (t) {
      return canManage || txt_(t.raised_by_user_id) === ctx.userId;
    }).forEach(function (t) { counts[txt_(t.status).toUpperCase()] = (counts[txt_(t.status).toUpperCase()] || 0) + 1; });
    var replyCounts = {};
    Db.all(c, 'TicketComments').forEach(function (cm) {
      replyCounts[txt_(cm.ticket_id)] = (replyCounts[txt_(cm.ticket_id)] || 0) + 1;
    });
    return {
      rows: page.rows.map(function (t) { return Support.ticketOut_(t, replyCounts[txt_(t.ticket_id)] || 0, canManage); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      counts: counts, categories: SupportCategories, priorities: SupportPriorities,
      can_manage: canManage,
      help: [
        { title: 'Attendance problems', body: 'Raise a ticket with the date and the punch details. HR can correct the record after checking the site log.' },
        { title: 'Salary or payslip questions', body: 'Attach the payslip month. Payroll queries are answered within two working days.' },
        { title: 'Cannot log in', body: 'Call HR if you changed your phone number — the login ID is your registered mobile number.' }
      ]
    };
  },

  isMyTeam_: function (ctx, c, employeeId) {
    var emp = Db.find(c, 'Employees', 'employee_id', employeeId);
    if (!emp) return false;
    if (txt_(ctx.employeeId) && txt_(emp.manager_id) === txt_(ctx.employeeId)) return true;
    return false;
  },

  ticketGet: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var t = Db.get(c, 'Tickets', 'ticket_id', payload.ticket_id);
    var canManage = Perm.has(ctx, 'support.edit');
    var isMine = txt_(t.raised_by_user_id) === ctx.userId;
    if (!canManage && !isMine) fail_('NOT_ALLOWED', 'You can only open tickets you raised.');
    var comments = sortRows_(Db.all(c, 'TicketComments', function (cm) { return txt_(cm.ticket_id) === t.ticket_id; }), 'created_at', 'ASC');
    return {
      ticket: Support.ticketOut_(t, comments.length, canManage),
      comments: comments.filter(function (cm) {
        return canManage || !boolVal_(cm.is_internal);
      }).map(function (cm) {
        return {
          comment_id: cm.comment_id, author_name: txt_(cm.author_name), body: txt_(cm.body),
          is_internal: boolVal_(cm.is_internal), at: txt_(cm.created_at),
          is_me: txt_(cm.author_user_id) === ctx.userId
        };
      }),
      can_manage: canManage,
      can_reply: txt_(t.status) !== 'CLOSED' || canManage,
      assignees: Support.assignees_(ctx, c),
      statuses: STATUS.TICKET, priorities: SupportPriorities
    };
  },

  assignees_: function (ctx, c) {
    var roles = ['COMPANY_ADMIN', 'HR_MANAGER'];
    return Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && txt_(u.status) === 'ACTIVE' && roles.indexOf(txt_(u.role_code)) >= 0;
    }).map(function (u) { return { user_id: txt_(u.user_id), name: txt_(u.name), role_code: txt_(u.role_code) }; });
  },

  ticketCreate: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var canManage = Perm.has(ctx, 'support.edit');
    var employeeId = ctx.employeeId;
    if (canManage && payload.employee_id) {
      var emp = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
      employeeId = txt_(emp.employee_id);
    }
    var code = Db.nextId(c, 'Tickets');
    var row = Db.insert(c, 'Tickets', {
      code: code, raised_by_user_id: ctx.userId, raised_by_name: txt_(ctx.name),
      employee_id: txt_(employeeId), subject: txt_(payload.subject).slice(0, 200),
      category: txt_(payload.category || 'OTHER').toUpperCase().slice(0, 30),
      priority: txt_(payload.priority || 'NORMAL').toUpperCase(),
      status: 'OPEN', last_reply_at: nowIso_()
    }, { actor: ctx.userId });
    Db.insert(c, 'TicketComments', {
      ticket_id: row.ticket_id, author_user_id: ctx.userId, author_name: txt_(ctx.name),
      body: txt_(payload.body), is_internal: 'FALSE'
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'support', action: 'support.tickets.create', entity: 'Tickets', entity_id: row.ticket_id,
      after: { code: code, subject: row.subject, category: row.category, priority: row.priority },
      note: 'Ticket ' + code + ' raised: ' + row.subject
    });
    Support.notifyHr_(ctx, {
      title: 'New ticket ' + code + ' from ' + txt_(ctx.name),
      body: row.subject + ' — ' + txt_(payload.body).slice(0, 200),
      ticketId: row.ticket_id
    });
    return {
      ticket: Support.ticketOut_(row, 1, canManage),
      message: 'Ticket ' + code + ' created. HR will reply on this screen and by email.'
    };
  },

  ticketReply: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var t = Db.get(c, 'Tickets', 'ticket_id', payload.ticket_id);
    var canManage = Perm.has(ctx, 'support.edit');
    var isMine = txt_(t.raised_by_user_id) === ctx.userId;
    if (!canManage && !isMine) fail_('NOT_ALLOWED', 'You can only reply to your own tickets.');
    if (txt_(t.status) === 'CLOSED' && !canManage) fail_('NOT_ALLOWED', 'This ticket is closed. Raise a new ticket if the problem is back.');
    var internal = canManage && boolVal_(payload.is_internal);
    Db.insert(c, 'TicketComments', {
      ticket_id: t.ticket_id, author_user_id: ctx.userId, author_name: txt_(ctx.name),
      body: txt_(payload.body).slice(0, 4000), is_internal: internal ? 'TRUE' : 'FALSE'
    }, { actor: ctx.userId });
    var status = t.status;
    if (canManage && !internal && ['OPEN', 'WAITING'].indexOf(txt_(t.status)) >= 0) status = 'IN_PROGRESS';
    if (!canManage) status = txt_(t.status) === 'CLOSED' ? 'CLOSED' : 'OPEN';
    Db.update(c, 'Tickets', 'ticket_id', t.ticket_id, { status: status, last_reply_at: nowIso_() }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'support', action: 'support.tickets.reply', entity: 'Tickets', entity_id: t.ticket_id,
      after: { internal: internal, status: status },
      note: (internal ? 'Internal note added to ' : 'Reply added to ') + txt_(t.code) + ' by ' + txt_(ctx.name)
    });
    if (!internal) {
      var targetUser = txt_(t.raised_by_user_id);
      if (canManage) {
        Notify.push([targetUser], {
          company_id: ctx.companyId, title: 'HR replied to your ticket ' + txt_(t.code),
          body: txt_(payload.body).slice(0, 300), kind: 'INFO',
          link_action: 'support.tickets.get', link_payload: { ticket_id: t.ticket_id }
        });
        Support.mail_(ctx, targetUser, 'HR replied to ticket ' + txt_(t.code), txt_(payload.body));
      } else {
        Support.notifyHr_(ctx, {
          title: txt_(ctx.name) + ' replied on ticket ' + txt_(t.code),
          body: txt_(payload.body).slice(0, 300), ticketId: t.ticket_id
        });
      }
    }
    return {
      replied: true, internal: internal, status: status,
      message: internal ? 'Internal note saved — the employee cannot see it.' : 'Reply sent.'
    };
  },

  ticketUpdate: function (ctx, payload) {
    Perm.require(ctx, 'support.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var t = Db.get(c, 'Tickets', 'ticket_id', payload.ticket_id);
    var patch = {};
    if (payload.status) {
      var st = txt_(payload.status).toUpperCase();
      if (STATUS.TICKET.indexOf(st) < 0) fail_('VALIDATION', 'Unknown ticket status.', { field: 'status' });
      patch.status = st;
      if (st === 'CLOSED') patch.closed_at = txt_(t.closed_at) || nowIso_();
      if (st !== 'CLOSED') patch.closed_at = '';
    }
    if (payload.priority) patch.priority = txt_(payload.priority).toUpperCase();
    if (payload.assigned_to) {
      var user = Db.find(masterCtx_(), 'Users', 'user_id', payload.assigned_to);
      if (!user || txt_(user.company_id) !== ctx.companyId) fail_('VALIDATION', 'Choose a person from this company.', { field: 'assigned_to' });
      patch.assigned_to = txt_(payload.assigned_to);
      patch.assigned_name = txt_(user.name);
      if (!payload.status && txt_(t.status) === 'OPEN') patch.status = 'IN_PROGRESS';
    }
    if (payload.resolution) patch.resolution = txt_(payload.resolution).slice(0, 1000);
    if (!Object.keys(patch).length) fail_('VALIDATION', 'Nothing to update — change the status, priority, owner or resolution.');
    if (txt_(patch.status) === 'CLOSED' && !txt_(payload.resolution) && !txt_(t.resolution)) {
      fail_('VALIDATION', 'Write a short resolution note before closing the ticket.', { field: 'resolution' });
    }
    var row = Db.update(c, 'Tickets', 'ticket_id', t.ticket_id, patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'support', action: 'support.tickets.update', entity: 'Tickets', entity_id: t.ticket_id,
      before: { status: t.status, priority: t.priority, assigned_to: t.assigned_to },
      after: patch, note: 'Ticket ' + txt_(t.code) + ' updated by ' + txt_(ctx.name)
    });
    if (patch.status === 'CLOSED') {
      Notify.push([txt_(t.raised_by_user_id)], {
        company_id: ctx.companyId, title: 'Ticket ' + txt_(t.code) + ' is closed',
        body: txt_(patch.resolution || 'Your ticket has been closed.'), kind: 'SUCCESS',
        link_action: 'support.tickets.get', link_payload: { ticket_id: t.ticket_id }
      });
      Support.mail_(ctx, txt_(t.raised_by_user_id), 'Ticket ' + txt_(t.code) + ' closed',
        txt_(patch.resolution || 'Your ticket has been closed.'));
    }
    return { ticket: Support.ticketOut_(row, 0, true), message: 'Ticket updated.' };
  },

  notifyHr_: function (ctx, msg) {
    var users = Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && txt_(u.status) === 'ACTIVE' &&
        ['COMPANY_ADMIN', 'HR_MANAGER', 'SUPERVISOR', 'PROJECT_MANAGER'].indexOf(txt_(u.role_code)) >= 0;
    });
    users.forEach(function (u) {
      Notify.push([txt_(u.user_id)], {
        company_id: ctx.companyId, title: msg.title, body: msg.body, kind: 'INFO',
        link_action: 'support.tickets.get', link_payload: { ticket_id: msg.ticketId }
      });
    });
  },

  mail_: function (ctx, userId, subject, body) {
    try {
      var user = Db.find(masterCtx_(), 'Users', 'user_id', userId);
      if (!user || !isEmail_(user.email)) return;
      Notify.send({
        to: txt_(user.email), user_id: userId, company_id: ctx.companyId,
        subject: '[' + APP.name + '] ' + subject,
        html: '<p>Hello ' + escapeHtml_(txt_(user.name)) + ',</p><p>' + escapeHtml_(body).replace(/\n/g, '<br>') + '</p>' +
          '<p style="color:#64748b">Open ' + escapeHtml_(APP.name) + ' → Support to see the full conversation.</p>',
        related_type: 'Tickets', related_id: ''
      });
    } catch (e) {
      logEvent_('WARN', 'Support.mail', 'Email skipped: ' + e.message, {});
    }
  },

  /* ============================================== platform helpdesk ===== */
  platformList: function (ctx, payload) {
    var canManage = Perm.has(ctx, 'settings.manage');
    var rows = Db.all(masterCtx_(), 'SuperTickets', function (t) {
      if (txt_(t.company_id) !== ctx.companyId) return false;
      if (!canManage && txt_(t.raised_by_user_id) !== ctx.userId) return false;
      return true;
    });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var replies = {};
    Db.all(masterCtx_(), 'SuperTicketComments').forEach(function (cm) {
      replies[txt_(cm.ticket_id)] = (replies[txt_(cm.ticket_id)] || 0) + 1;
    });
    return {
      rows: page.rows.map(function (t) {
        return {
          ticket_id: t.ticket_id, subject: txt_(t.subject), category: txt_(t.category), priority: txt_(t.priority),
          status: txt_(t.status), raised_by_name: txt_(t.raised_by_name), created_at: txt_(t.created_at),
          last_reply_at: txt_(t.last_reply_at), replies: replies[txt_(t.ticket_id)] || 0, resolution: txt_(t.resolution),
          age_label: Support.age_(t.created_at, t.closed_at)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      can_manage: canManage, categories: ['BILLING', 'TECHNICAL', 'FEATURE', 'DATA', 'OTHER'],
      contact: Config.systemGet('support_email', ''),
      sla_note: txt_(Config.systemGet('support_sla_note', 'Critical issues are answered within one working day.'))
    };
  },

  platformCreate: function (ctx, payload) {
    Perm.require(ctx, 'settings.manage');
    var row = Db.insert(masterCtx_(), 'SuperTickets', {
      company_id: ctx.companyId, raised_by_user_id: ctx.userId, raised_by_name: txt_(ctx.name),
      subject: txt_(payload.subject).slice(0, 200),
      category: txt_(payload.category || 'OTHER').toUpperCase(),
      priority: txt_(payload.priority || 'NORMAL').toUpperCase(),
      status: 'OPEN', last_reply_at: nowIso_()
    }, { actor: ctx.userId });
    Db.insert(masterCtx_(), 'SuperTicketComments', {
      ticket_id: row.ticket_id, author_user_id: ctx.userId, author_name: txt_(ctx.name),
      author_scope: 'COMPANY', body: txt_(payload.body), is_internal: 'FALSE'
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'support', action: 'support.platform.create', entity: 'SuperTickets', entity_id: row.ticket_id,
      after: { subject: row.subject, category: row.category, priority: row.priority },
      note: 'Platform ticket raised: ' + row.subject
    });
    var platformTeam = Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.scope) === 'SUPER' && txt_(u.status) === 'ACTIVE';
    });
    platformTeam.forEach(function (u) {
      Notify.push([txt_(u.user_id)], {
        title: 'New platform ticket from ' + txt_(ctx.companyCtx && ctx.companyCtx.company ? ctx.companyCtx.company.name : 'a company'),
        body: row.subject, kind: 'WARNING', link_action: 'super.tickets.get', link_payload: { ticket_id: row.ticket_id }
      });
    });
    return { ticket: { ticket_id: row.ticket_id, subject: row.subject, status: row.status }, message: 'Ticket sent to the FocusHR support team.' };
  },

  platformReply: function (ctx, payload) {
    Perm.require(ctx, 'settings.manage');
    var t = Db.get(masterCtx_(), 'SuperTickets', 'ticket_id', payload.ticket_id);
    if (txt_(t.company_id) !== ctx.companyId) fail_('NOT_ALLOWED', 'This ticket belongs to another company.');
    Db.insert(masterCtx_(), 'SuperTicketComments', {
      ticket_id: t.ticket_id, author_user_id: ctx.userId, author_name: txt_(ctx.name),
      author_scope: 'COMPANY', body: txt_(payload.body).slice(0, 4000), is_internal: 'FALSE'
    }, { actor: ctx.userId });
    Db.update(masterCtx_(), 'SuperTickets', 'ticket_id', t.ticket_id, { last_reply_at: nowIso_(), status: 'OPEN' }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'support', action: 'support.platform.reply', entity: 'SuperTickets', entity_id: t.ticket_id,
      note: 'Reply added to platform ticket ' + txt_(t.subject)
    });
    return { replied: true, message: 'Reply sent to the support team.' };
  }
};
