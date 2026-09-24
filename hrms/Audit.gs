/**
 * ============================================================================
 *  FocusHR  —  Audit.gs
 *  Every write, every approval and every sensitive read is recorded.
 *  Company-scoped entries live in the company sheet, platform entries in the
 *  master sheet (so a company admin can never erase platform history).
 * ============================================================================
 */

var Audit = {

  /** Pick the spreadsheet that should hold the entry for this session. */
  target: function (ctx, opts) {
    var o = opts || {};
    if (o.scope === 'MASTER') return masterCtx_();
    if (!ctx || !ctx.companyId || ctx.scope === 'SUPER' || ctx.scope === 'PUBLIC') return masterCtx_();
    return ctx.companyCtx || companyCtx_(ctx.companyId);
  },

  write: function (ctx, entry) {
    var e = entry || {};
    try {
      var target = Audit.target(ctx, e);
      var actorName = txt_(e.actor_name || ctx.name || 'System');
      if (ctx.impersonatedBy) actorName = actorName + ' (Super Admin session)';
      var rec = Db.insert(target, 'AuditLog', {
        actor_user_id: txt_(ctx.userId),
        actor_name: actorName,
        actor_scope: txt_(ctx.scope),
        company_id: txt_(e.company_id !== undefined ? e.company_id : (ctx.companyId || '')),
        action: txt_(e.action),
        module: txt_(e.module),
        entity: txt_(e.entity),
        entity_id: txt_(e.entity_id),
        before_json: e.before ? jsonStr_(redact_(e.before)).slice(0, 8000) : '',
        after_json: e.after ? jsonStr_(redact_(e.after)).slice(0, 8000) : '',
        note: txt_(e.note).slice(0, 900),
        ip: txt_(ctx.ip),
        user_agent: txt_(ctx.userAgent).slice(0, 200),
        severity: txt_(e.severity || (e.w ? 'WRITE' : 'INFO')).toUpperCase()
      }, { system: true, actor: actorName });
      MEMO.__audited = true;
      return rec;
    } catch (err) {
      Logger.log('Audit write failed: ' + err.message);
      return null;
    }
  },

  info: function (ctx, module, action, entity, entityId, note) {
    return Audit.write(ctx, { module: module, action: action, entity: entity, entity_id: entityId, note: note, severity: 'INFO' });
  },

  /** Record reads of personal / financial data (bank, PAN, documents, payslips). */
  sensitive: function (ctx, module, action, entity, entityId, note) {
    return Audit.write(ctx, {
      module: module, action: action, entity: entity, entity_id: entityId,
      note: note || 'sensitive read', severity: 'SENSITIVE'
    });
  },

  /**
   * Collect audit rows for a session: company workspace entries plus the
   * platform (master) entries that belong to this company — logins, session
   * events and anything the Super Admin did inside the workspace.
   */
  gather_: function (ctx, extraFilter, opts) {
    var o = opts || {};
    var rows = [];
    var collect = function (target, filterFn, source) {
      var list = [];
      try {
        list = Db.all(target, 'AuditLog', filterFn);
      } catch (e) {
        logEvent_('WARN', 'Audit.gather', 'Audit trail unreadable (' + source + '): ' + e.message, {});
      }
      return list.map(function (r) {
        var copy = {};
        Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
        copy.__source = source;
        return copy;
      });
    };

    if (ctx.scope !== 'SUPER' && txt_(ctx.companyId)) {
      rows = rows.concat(collect(ctx.companyCtx || companyCtx_(ctx.companyId), null, 'company'));
      rows = rows.concat(collect(masterCtx_(), function (r) {
        return txt_(r.company_id) === txt_(ctx.companyId) || txt_(r.actor_user_id) === txt_(ctx.userId);
      }, 'platform'));
    } else {
      rows = collect(masterCtx_(), null, 'platform');
    }

    var seen = {};
    rows = rows.filter(function (r) {
      var key = txt_(r.__source) + ':' + txt_(r.audit_id);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    if (extraFilter) rows = rows.filter(extraFilter);
    return rows;
  },

  map_: function (r) {
    return {
      audit_id: txt_(r.audit_id), at: txt_(r.created_at), actor_name: txt_(r.actor_name), actor_scope: txt_(r.actor_scope),
      company_id: txt_(r.company_id), action: txt_(r.action), module: txt_(r.module), entity: txt_(r.entity),
      entity_id: txt_(r.entity_id), note: txt_(r.note), severity: txt_(r.severity), ip: txt_(r.ip),
      before: safeJson_(r.before_json, {}), after: safeJson_(r.after_json, {})
    };
  },

  list: function (ctx, params) {
    var p = params || {};
    var rows = Audit.gather_(ctx, function (r) {
      if (p.module && txt_(r.module) !== txt_(p.module)) return false;
      if (p.action && txt_(r.action).indexOf(txt_(p.action)) !== 0) return false;
      if (p.company_id && txt_(r.company_id) !== txt_(p.company_id)) return false;
      if (p.severity && txt_(r.severity) !== txt_(p.severity).toUpperCase()) return false;
      var day = txt_(r.created_at).slice(0, 10);
      if (p.from && day < txt_(p.from)) return false;
      if (p.to && day > txt_(p.to)) return false;
      if (p.search) {
        var needle = txt_(p.search).toLowerCase();
        var hay = (txt_(r.actor_name) + ' ' + txt_(r.action) + ' ' + txt_(r.entity) + ' ' + txt_(r.entity_id) + ' ' + txt_(r.note)).toLowerCase();
        if (hay.indexOf(needle) < 0) return false;
      }
      return true;
    });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, p.page, p.pageSize);
    var facets = { modules: [], actions: 0 };
    Db.all(masterCtx_(), 'AuditLog').forEach(function () { facets.actions++; });
    facets.modules = uniq_(rows.map(function (r) { return txt_(r.module); })).filter(function (m) { return !!m; }).sort();
    return {
      rows: page.rows.map(Audit.map_),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      modules: facets.modules,
      counts: {
        today: rows.filter(function (r) { return txt_(r.created_at).slice(0, 10) === todayIso_(); }).length,
        sensitive: rows.filter(function (r) { return txt_(r.severity) === 'SENSITIVE'; }).length
      }
    };
  },

  /** Security-sensitive events only, newest first. */
  sensitiveList: function (ctx, params) {
    var p = params || {};
    var rows = Audit.gather_(ctx, function (r) { return txt_(r.severity) === 'SENSITIVE'; });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, p.page, p.pageSize);
    return {
      rows: page.rows.map(Audit.map_),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      note: 'Logins, password changes, salary data, bank details, payslips and document downloads are recorded here.'
    };
  },

  /** Recent activity feed for dashboards (cheap, newest first). */
  recent: function (ctx, limit, filterFn) {
    var rows = Audit.gather_(ctx, filterFn);
    rows = sortRows_(rows, 'created_at', 'DESC');
    return rows.slice(0, limit || 10).map(Audit.map_);
  },

  /* ==================================================== integrity tools == */
  /** Full platform check: tabs, ids, orphan rows and counters. */
  checkIntegrity: function (ctx) {
    if (ctx) Perm.require(ctx, 'settings.manage');
    var checkedAt = nowIso_();
    var issues = [];
    var order = [];

    Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'MASTER'; }).forEach(function (t) {
      if (!masterCtx_().ss.getSheetByName(t)) {
        issues.push({ severity: 'ERROR', company_id: '', company_name: 'Platform', table: t,
          message: 'Platform tab "' + t + '" is missing.', hint: 'Run super.diagnostics with the rebuild action.' });
      }
    });

    var totals = { companies: 0, employees: 0, rows: 0, files: 0 };
    var companies = Db.all(masterCtx_(), 'Companies');
    totals.companies = companies.filter(function (c) { return txt_(c.status) === 'ACTIVE'; }).length;

    companies.forEach(function (row) {
      var companyId = txt_(row.company_id);
      var name = txt_(row.name);
      var cctx;
      try {
        cctx = companyCtx_(companyId, { requireActive: false });
      } catch (e) {
        issues.push({ severity: 'ERROR', company_id: companyId, company_name: name, table: 'Spreadsheet',
          message: 'Workspace cannot be opened: ' + e.message, hint: 'Check the spreadsheet in Drive, then reprovision.' });
        return;
      }
      var ids = {};
      Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'COMPANY'; }).forEach(function (t) {
        var sheet = cctx.ss.getSheetByName(t);
        if (!sheet) {
          issues.push({ severity: 'ERROR', company_id: companyId, company_name: name, table: t,
            message: 'Tab "' + t + '" is missing in this workspace.', hint: 'Open Setup → Repair workspace.' });
          return;
        }
        var rows;
        try { rows = Db.all(cctx, t); } catch (e2) {
          issues.push({ severity: 'WARN', company_id: companyId, company_name: name, table: t,
            message: 'Tab could not be read: ' + e2.message, hint: 'Try again after the sheet finishes loading.' });
          return;
        }
        totals.rows += rows.length;
        var pk = SCHEMA[t].cols[0];
        var seen = {};
        rows.forEach(function (r, idx) {
          var id = txt_(r[pk]);
          if (!id) {
            issues.push({ severity: 'WARN', company_id: companyId, company_name: name, table: t,
              message: 'Row ' + (idx + 2) + ' has no ' + pk + '.', hint: 'Delete the stray row or run the repair tool.' });
            return;
          }
          if (seen[id]) {
            issues.push({ severity: 'ERROR', company_id: companyId, company_name: name, table: t,
              message: 'Duplicate id ' + id + ' in row ' + (idx + 2) + '.', hint: 'Delete the duplicate row and keep the first one.' });
            seen[id] = (seen[id] || 1) + 1;
          } else seen[id] = 1;
          ids[t] = ids[t] || {};
          ids[t][id] = true;
        });
      });

      var employeeIds = ids.Employees || {};
      var employeeCount = Object.keys(employeeIds).length;
      totals.employees += employeeCount;
      if (!employeeCount) {
        issues.push({ severity: 'INFO', company_id: companyId, company_name: name, table: 'Employees',
          message: 'No employees added yet.', hint: 'Add employees or load the demo data from the super admin console.' });
      }

      var linkCheck = function (table, column, label, severity) {
        if (!ids[table]) return;
        var bad = 0;
        Db.all(cctx, table).forEach(function (r) {
          var v = txt_(r[column]);
          if (v && !employeeIds[v]) bad++;
        });
        if (bad) {
          issues.push({ severity: severity || 'WARN', company_id: companyId, company_name: name, table: table,
            message: bad + ' row(s) point to an employee that no longer exists (' + label + ').',
            hint: 'These rows belong to a deleted employee. Soft-deleted rows can stay; hard-deleted ones must be cleaned up.' });
        }
      };
      linkCheck('Attendance', 'employee_id', 'attendance');
      linkCheck('LeaveRequests', 'employee_id', 'leave');
      linkCheck('LeaveBalances', 'employee_id', 'leave balance');
      linkCheck('ExpenseClaims', 'employee_id', 'expense claims');
      linkCheck('SalaryStructures', 'employee_id', 'salary structure', 'ERROR');
      linkCheck('ProjectAssignments', 'employee_id', 'project assignment');
      linkCheck('PayrollItems', 'employee_id', 'payroll items', 'ERROR');

      var structures = (ids.SalaryStructures ? Object.keys(ids.SalaryStructures).length : 0);
      if (employeeCount && structures < employeeCount * 0.5) {
        issues.push({ severity: 'INFO', company_id: companyId, company_name: name, table: 'SalaryStructures',
          message: 'Only ' + structures + ' of ' + employeeCount + ' employees have a salary structure.',
          hint: 'Payroll will skip employees without a structure — add them under Employee → Salary.' });
      }
      if (!(ids.Settings && Object.keys(ids.Settings).length)) {
        issues.push({ severity: 'WARN', company_id: companyId, company_name: name, table: 'Settings',
          message: 'Workspace settings are empty.', hint: 'Open Company → Settings and press Save once.' });
      }
    });

    /* Counters — the next number must be greater than every id already used. */
    var counter = Db.all(masterCtx_(), 'Counters');
    counter.forEach(function (cRow) {
      var key = txt_(cRow.key);
      var parts = key.split(':');
      var prefix = parts[0];
      var companyId = parts.length > 1 ? parts[1] : '';
      var number = intVal_(cRow.next_no, 1);
      var table = null;
      Object.keys(SCHEMA).forEach(function (t) { if (SCHEMA[t].prefix === prefix) table = t; });
      if (!table) {
        issues.push({ severity: 'INFO', company_id: companyId, company_name: '', table: 'Counters',
          message: 'Counter "' + key + '" has no matching table.', hint: 'Safe to delete this counter row.' });
        return;
      }
      var startNo = null;
      try {
        var target = companyId ? companyCtx_(companyId, { requireActive: false }) : masterCtx_();
        Db.all(target, table).forEach(function (r) {
          var id = txt_(r[SCHEMA[table].cols[0]]);
          var m = id.split('-');
          var n = intVal_(m[m.length - 1]);
          if (n >= number && (startNo === null || n >= startNo)) startNo = n + 1;
        });
        if (startNo !== null) {
          Db.update(masterCtx_(), 'Counters', 'key', key, { next_no: startNo }, { system: true });
          issues.push({ severity: 'INFO', company_id: companyId, company_name: '', table: 'Counters',
            message: 'Counter "' + key + '" was behind the used ids and has been moved to ' + startNo + '.',
            hint: 'No action needed — this prevents duplicate ids.' });
        } else if (number < 1) {
          Db.update(masterCtx_(), 'Counters', 'key', key, { next_no: 1 }, { system: true });
        }
      } catch (e3) {
        issues.push({ severity: 'WARN', company_id: companyId, company_name: '', table: 'Counters',
          message: 'Could not verify counter "' + key + '": ' + e3.message, hint: 'Run the check again.' });
      }
    });

    var errors = issues.filter(function (i) { return i.severity === 'ERROR'; }).length;
    var warnings = issues.filter(function (i) { return i.severity === 'WARN'; }).length;
    return {
      checked_at: checkedAt,
      summary: {
        workspace_ok: errors === 0, errors: errors, warnings: warnings,
        notes: issues.length - errors - warnings,
        active_companies: totals.companies, employees: totals.employees, rows: totals.rows
      },
      issues: issues.slice(0, 200),
      message: errors === 0
        ? 'Integrity check finished — no blocking problems found.'
        : 'Integrity check found ' + errors + ' problem(s) that need attention.'
    };
  },

  /** Rebuild every counter from the ids that are actually in use. */
  rebuildCounters: function (ctx) {
    if (ctx) Perm.require(ctx, 'settings.manage');
    var out = [];
    var targets = [{ scope: 'MASTER', ctx: masterCtx_(), company_id: '' }];
    Db.all(masterCtx_(), 'Companies').forEach(function (c) {
      try { targets.push({ scope: 'COMPANY', ctx: companyCtx_(c.company_id, { requireActive: false }), company_id: txt_(c.company_id) }); }
      catch (e) { logEvent_('WARN', 'Audit.rebuildCounters', 'Skipped workspace ' + c.company_id + ': ' + e.message, {}); }
    });
    targets.forEach(function (t) {
      Object.keys(SCHEMA).forEach(function (table) {
        var def = SCHEMA[table];
        if (def.scope !== t.scope || !def.prefix) return;
        var maxNo = 0;
        try {
          Db.all(t.ctx, table).forEach(function (r) {
            var id = txt_(r[def.cols[0]]);
            var m = id.split('-');
            var n = intVal_(m[m.length - 1]);
            if (n > maxNo) maxNo = n;
          });
        } catch (e2) { return; }
        var key = t.company_id ? def.prefix + ':' + t.company_id : def.prefix;
        var existing = Db.find(masterCtx_(), 'Counters', 'key', key);
        var next = maxNo + 1;
        if (existing) {
          if (intVal_(existing.next_no) !== next) Db.update(masterCtx_(), 'Counters', 'key', key, { next_no: next }, { system: true });
        } else {
          Db.insert(masterCtx_(), 'Counters', { key: key, prefix: def.prefix, next_no: next, width: 4, note: table }, { system: true });
        }
        out.push({ table: table, counter: key, next_no: next });
      });
    });
    Audit.info(null, 'system', 'audit.rebuildCounters', 'Counters', '', '', out.length + ' counter(s) verified');
    return { counters: out.length, rows: out, message: out.length + ' counter(s) checked and corrected.' };
  },

  /** Move old log rows into a CSV archive in Drive, then soft-delete them. */
  archiveLogs: function (ctx, payload) {
    if (ctx) Perm.require(ctx, 'settings.manage');
    var days = intVal_((payload && payload.days) || 90, 90);
    if (days < 30) days = 30;
    var cutoff = isoAddDays_(todayIso_(), -days) + 'T00:00:00';
    var oldRows = [];
    var logsTargets = [{ ctx: masterCtx_(), company_id: '', name: 'Platform' }];
    Db.all(masterCtx_(), 'Companies').forEach(function (c) {
      try { logsTargets.push({ ctx: companyCtx_(c.company_id, { requireActive: false }), company_id: txt_(c.company_id), name: txt_(c.name) }); }
      catch (e) { /* workspace unavailable — skip */ }
    });

    logsTargets.forEach(function (t) {
      var rows;
      try { rows = Db.all(t.ctx, 'AuditLog'); } catch (e2) { return; }
      var stale = rows.filter(function (r) { return txt_(r.created_at) && txt_(r.created_at) < cutoff; });
      if (!stale.length) return;
      stale.slice(0, 20000).forEach(function (r) {
        oldRows.push({
          company_id: t.company_id, company_name: t.name, when: txt_(r.created_at), actor: txt_(r.actor_name),
          action: txt_(r.action), module: txt_(r.module), entity: txt_(r.entity), entity_id: txt_(r.entity_id),
          severity: txt_(r.severity), note: txt_(r.note), ip: txt_(r.ip)
        });
      });
      stale.slice(0, 20000).forEach(function (r) {
        Db.softDelete(t.ctx, 'AuditLog', 'audit_id', r.audit_id, { system: true });
      });
    });

    if (!oldRows.length) {
      return { archived: 0, message: 'No audit entries are older than ' + days + ' days — nothing to archive.' };
    }
    var csv = toCsv_(oldRows, ['company_id', 'company_name', 'when', 'actor', 'action', 'module', 'entity', 'entity_id', 'severity', 'note', 'ip']);
    var file = Files.saveGenerated({ companyId: '', scope: 'SUPER', companyCtx: null }, {
      csv: csv, name: 'FocusHR_AuditArchive_' + todayIso() + '.csv', mime: 'csv', folder_key: 'platform', fy: fyOf_(todayIso_())
    });
    Audit.info(null, 'system', 'audit.archiveLogs', 'AuditLog', '', '', oldRows.length + ' audit row(s) archived to ' + file.getName());
    return {
      archived: oldRows.length, file_id: file.getId(), file_name: file.getName(),
      url: file.getUrl(), days: days,
      message: oldRows.length + ' audit row(s) older than ' + days + ' days were saved to Drive and removed from the sheets.'
    };
  }
};
