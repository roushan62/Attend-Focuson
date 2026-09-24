/**
 * ============================================================================
 *  FocusHR  —  Projects.gs
 *  Sites / projects with geo-fences, team assignments, transfers between
 *  sites and the "nearby site" helper used by the punch screen.
 * ============================================================================
 */

var Projects = {

  /* =============================================================== list == */
  list: function (ctx, payload) {
    Perm.require(ctx, 'projects.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'Projects', function (p) {
      if (payload.status && txt_(p.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (p) { return matchesSearch_(p, SCHEMA.Projects.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'name', payload.dir || 'ASC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var today = todayIso_();

    return {
      rows: page.rows.map(function (p) {
        var team = Db.all(c, 'ProjectAssignments', function (a) {
          return txt_(a.project_id) === p.project_id && txt_(a.status) === 'ACTIVE' &&
            (!a.to_date || txt_(a.to_date) >= today);
        });
        var attendanceToday = Db.all(c, 'Attendance', function (a) {
          return txt_(a.project_id) === p.project_id && txt_(a.date) === today;
        });
        return {
          project_id: p.project_id, code: p.code, name: p.name, client_name: p.client_name, city: p.city, state: p.state,
          site_address: p.site_address, latitude: numVal_(p.latitude), longitude: numVal_(p.longitude),
          radius_m: intVal_(p.radius_m, APP.defaultRadiusM), location_locked: boolVal_(p.location_locked),
          start_date: p.start_date, end_date: p.end_date, status: p.status, incharge_employee_id: p.incharge_employee_id,
          incharge_name: p.incharge_name, budget_amount: numVal_(p.budget_amount), shift_start: p.shift_start,
          shift_end: p.shift_end, weekly_off: p.weekly_off, notes: p.notes, created_at: p.created_at,
          team_size: team.length,
          present_today: attendanceToday.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
          geofence_set: numVal_(p.latitude) !== 0 && numVal_(p.longitude) !== 0
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      counts: (function () {
        var out = {};
        STATUS.PROJECT.forEach(function (s) { out[s] = 0; });
        Db.all(c, 'Projects').forEach(function (p) { out[txt_(p.status).toUpperCase()] = (out[txt_(p.status).toUpperCase()] || 0) + 1; });
        return out;
      })()
    };
  },

  options_: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    return sortRows_(Db.all(c, 'Projects', function (p) { return txt_(p.status).toUpperCase() !== 'CANCELLED'; }), 'name', 'ASC')
      .map(function (p) {
        return {
          project_id: p.project_id, code: p.code, name: p.name, city: p.city, status: p.status,
          latitude: numVal_(p.latitude), longitude: numVal_(p.longitude), radius_m: intVal_(p.radius_m, APP.defaultRadiusM),
          shift_start: p.shift_start, shift_end: p.shift_end, weekly_off: p.weekly_off, incharge_name: p.incharge_name,
          location_locked: boolVal_(p.location_locked)
        };
      });
  },

  get: function (ctx, payload) {
    Perm.require(ctx, 'projects.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    var team = Db.all(c, 'ProjectAssignments', function (a) { return txt_(a.project_id) === p.project_id && txt_(a.status) === 'ACTIVE'; });
    var month = monthOfIso_(todayIso_());
    var monthAttendance = Db.all(c, 'Attendance', function (a) {
      return txt_(a.project_id) === p.project_id && txt_(a.date) >= monthStart_(month) && txt_(a.date) <= monthEnd_(month);
    });
    var claims = Db.all(c, 'ExpenseClaims', function (cl) {
      return txt_(cl.employee_id) && monthOfIso_(cl.claim_date) === month;
    });
    return {
      project: {
        project_id: p.project_id, code: p.code, name: p.name, client_name: p.client_name, site_address: p.site_address,
        city: p.city, state: p.state, pincode: p.pincode, latitude: numVal_(p.latitude), longitude: numVal_(p.longitude),
        radius_m: intVal_(p.radius_m, APP.defaultRadiusM), location_locked: boolVal_(p.location_locked),
        start_date: p.start_date, end_date: p.end_date, status: p.status, incharge_employee_id: p.incharge_employee_id,
        incharge_name: p.incharge_name, budget_amount: numVal_(p.budget_amount), shift_start: p.shift_start,
        shift_end: p.shift_end, weekly_off: p.weekly_off, notes: p.notes, created_at: p.created_at, updated_at: p.updated_at
      },
      team: team.map(function (a) {
        var e = Db.find(c, 'Employees', 'employee_id', a.employee_id);
        return {
          assignment_id: a.assignment_id, employee_id: a.employee_id, employee_name: a.employee_name || (e ? txt_(e.name) : ''),
          employee_code: e ? txt_(e.code) : '', designation: e ? txt_(e.designation) : '', phone: e ? maskPhone_(e.phone) : '',
          role_on_site: a.role_on_site, from_date: a.from_date, to_date: a.to_date, is_primary: boolVal_(a.is_primary),
          daily_wage: numVal_(a.daily_wage), status: a.status,
          present_today: Db.count(c, 'Attendance', function (att) {
            return txt_(att.project_id) === p.project_id && txt_(att.employee_id) === a.employee_id && txt_(att.date) === todayIso_() &&
              (txt_(att.status) === 'PRESENT' || txt_(att.status) === 'OD');
          }) > 0
        };
      }),
      stats: {
        team_size: team.length,
        month_label: monthLabel_(month),
        present_days: monthAttendance.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
        absent_days: monthAttendance.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
        half_days: monthAttendance.filter(function (a) { return txt_(a.status) === 'HALF_DAY'; }).length,
        overtime_hours: round2_(sum_(monthAttendance, function (a) { return a.overtime_minutes; }) / 60),
        flagged_punches: monthAttendance.filter(function (a) { return boolVal_(a.flagged); }).length,
        claims_this_month: round0_(sum_(claims, function (cl) { return cl.total_amount; }))
      },
      pending_transfers: Db.all(c, 'TransferRequests', function (t) {
        return txt_(t.status) === 'PENDING' && (txt_(t.from_project_id) === p.project_id || txt_(t.to_project_id) === p.project_id);
      }).map(function (t) {
        return { transfer_id: t.transfer_id, employee_name: t.employee_name, effective_date: t.effective_date, direction: txt_(t.to_project_id) === p.project_id ? 'IN' : 'OUT' };
      })
    };
  },

  /* =============================================================== save == */
  save: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var isNew = !payload.project_id;
    Perm.require(ctx, isNew ? 'projects.create' : 'projects.edit');

    var lat = numVal_(payload.latitude), lng = numVal_(payload.longitude);
    var radius = intVal_(payload.radius_m, getSettingNum_(ctx, 'attendance.radius_m', APP.defaultRadiusM));
    if (radius < 10 || radius > 5000) fail_('VALIDATION', 'Geo-fence radius should be between 10 and 5000 metres.', { field: 'radius_m' });
    if ((lat !== 0 && !lng) || (lng !== 0 && !lat)) fail_('VALIDATION', 'Please capture both latitude and longitude, or leave both empty.', { field: 'latitude' });
    if (!isNew) {
      var existing = Db.get(c, 'Projects', 'project_id', payload.project_id);
      var moved = Math.abs(numVal_(existing.latitude) - lat) > 0.00001 || Math.abs(numVal_(existing.longitude) - lng) > 0.00001;
      if (moved && boolVal_(existing.location_locked) && !Perm.has(ctx, 'settings.manage')) {
        fail_('LOCATION_LOCKED', 'The site location is locked. Unlock it first (Site → Location lock) or ask a Company Admin to change it.');
      }
      if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
        fail_('VALIDATION', 'End date cannot be before the start date.', { field: 'end_date' });
      }
    }
    var incharge = txt_(payload.incharge_employee_id) ? Db.find(c, 'Employees', 'employee_id', payload.incharge_employee_id) : null;
    if (payload.incharge_employee_id && !incharge) fail_('VALIDATION', 'The selected site in-charge was not found.', { field: 'incharge_employee_id' });

    var dupe = Db.findOne(c, 'Projects', function (p) {
      return txt_(p.name).toLowerCase() === txt_(payload.name).toLowerCase() && txt_(p.project_id) !== txt_(payload.project_id);
    });
    if (dupe) fail_('DUPLICATE', 'A site named "' + txt_(dupe.name) + '" already exists.', { field: 'name' });

    var patch = {
      name: txt_(payload.name).trim(), code: txt_(payload.code).toUpperCase(), client_name: payload.client_name,
      site_address: payload.site_address, city: payload.city, state: payload.state, pincode: payload.pincode,
      latitude: lat, longitude: lng, radius_m: radius,
      start_date: payload.start_date, end_date: payload.end_date,
      status: txt_(payload.status || 'ACTIVE').toUpperCase(), incharge_employee_id: payload.incharge_employee_id,
      incharge_name: incharge ? txt_(incharge.name) : '', budget_amount: numVal_(payload.budget_amount),
      shift_start: txt_(payload.shift_start || getSetting_(ctx, 'attendance.shift_start', '09:00')),
      shift_end: txt_(payload.shift_end || getSetting_(ctx, 'attendance.shift_end', '18:00')),
      weekly_off: txt_(payload.weekly_off || getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY')).toUpperCase(),
      notes: payload.notes
    };
    var row;
    if (isNew) {
      if (!patch.code) patch.code = Db.nextId(c, 'Projects');
      var codeDupe = Db.findOne(c, 'Projects', function (p) { return txt_(p.code).toUpperCase() === patch.code; });
      if (codeDupe) fail_('DUPLICATE', 'Site code ' + patch.code + ' is already used.', { field: 'code' });
      patch.location_locked = lat !== 0 && lng !== 0 ? 'TRUE' : 'FALSE';
      row = Db.insert(c, 'Projects', patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'projects', action: 'projects.save', entity: 'Projects', entity_id: row.project_id,
        after: patch, note: 'Site created: ' + patch.name + (lat ? ' with geo-fence of ' + radius + ' m' : ' without geo-fence')
      });
    } else {
      var before = Db.get(c, 'Projects', 'project_id', payload.project_id);
      row = Db.update(c, 'Projects', 'project_id', payload.project_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'projects', action: 'projects.save', entity: 'Projects', entity_id: row.project_id,
        before: { name: before.name, latitude: before.latitude, longitude: before.longitude, radius_m: before.radius_m, status: before.status, incharge_employee_id: before.incharge_employee_id },
        after: { name: patch.name, latitude: patch.latitude, longitude: patch.longitude, radius_m: patch.radius_m, status: patch.status, incharge_employee_id: patch.incharge_employee_id },
        note: 'Site updated: ' + patch.name
      });
    }
    return { project_id: row.project_id, code: row.code, created: isNew, geofence_set: lat !== 0 && lng !== 0, radius_m: radius };
  },

  remove: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.delete');
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    var team = Db.count(c, 'ProjectAssignments', function (a) { return txt_(a.project_id) === p.project_id && txt_(a.status) === 'ACTIVE'; });
    if (team) fail_('IN_USE', 'This site still has ' + team + ' team member(s). Move them to another site first.');
    var attendance = Db.count(c, 'Attendance', function (a) { return txt_(a.project_id) === p.project_id; });
    if (attendance) {
      Db.update(c, 'Projects', 'project_id', p.project_id, { status: 'COMPLETED' }, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'projects', action: 'projects.delete', entity: 'Projects', entity_id: p.project_id,
        before: { status: p.status }, after: { status: 'COMPLETED' },
        note: 'Site had ' + attendance + ' attendance rows so it was marked COMPLETED instead of deleted'
      });
      return { deleted: false, status: 'COMPLETED', message: 'This site has attendance history, so it was closed (COMPLETED) instead of deleted.' };
    }
    Db.softDelete(c, 'Projects', 'project_id', p.project_id, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'projects', action: 'projects.delete', entity: 'Projects', entity_id: p.project_id,
      before: { name: p.name, code: p.code }, note: 'Site removed'
    });
    return { deleted: true };
  },

  locationLock: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.edit');
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    if (txt_(payload.reason).length < 4) fail_('VALIDATION', 'Please write the reason for changing the location lock.', { field: 'reason' });
    var lock = payload.location_locked === false ? 'FALSE' : 'TRUE';
    Db.update(c, 'Projects', 'project_id', p.project_id, { location_locked: lock }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'projects', action: 'projects.location.lock', entity: 'Projects', entity_id: p.project_id,
      before: { location_locked: boolVal_(p.location_locked) }, after: { location_locked: lock === 'TRUE' },
      note: 'Location ' + (lock === 'TRUE' ? 'locked' : 'unlocked') + '. Reason: ' + payload.reason, severity: 'SENSITIVE'
    });
    return { project_id: p.project_id, location_locked: lock === 'TRUE', message: lock === 'TRUE' ? 'Location locked — punches will be verified against this point.' : 'Location unlocked — you can now edit the coordinates.' };
  },

  /* =============================================================== team == */
  team: function (ctx, payload) {
    Perm.require(ctx, 'projects.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    var rows = Db.all(c, 'ProjectAssignments', function (a) {
      if (txt_(a.project_id) !== p.project_id) return false;
      if (!payload.include_past && txt_(a.status) !== 'ACTIVE') return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (a) { return matchesSearch_(a, ['employee_name', 'employee_id', 'role_on_site'], payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var month = monthOfIso_(todayIso_());
    return {
      rows: page.rows.map(function (a) {
        var e = Db.find(c, 'Employees', 'employee_id', a.employee_id);
        var attendance = Db.all(c, 'Attendance', function (att) {
          return txt_(att.employee_id) === a.employee_id && txt_(att.project_id) === p.project_id &&
            txt_(att.date) >= monthStart_(month) && txt_(att.date) <= monthEnd_(month);
        });
        return {
          assignment_id: a.assignment_id, employee_id: a.employee_id, employee_name: a.employee_name || (e ? txt_(e.name) : ''),
          employee_code: e ? txt_(e.code) : '', designation: e ? txt_(e.designation) : '', status: a.status,
          role_on_site: a.role_on_site, from_date: a.from_date, to_date: a.to_date, is_primary: boolVal_(a.is_primary),
          daily_wage: numVal_(a.daily_wage), phone: e ? maskPhone_(e.phone) : '', employee_status: e ? e.status : '',
          present_days: attendance.filter(function (x) { return txt_(x.status) === 'PRESENT' || txt_(x.status) === 'OD'; }).length,
          half_days: attendance.filter(function (x) { return txt_(x.status) === 'HALF_DAY'; }).length,
          absent_days: attendance.filter(function (x) { return txt_(x.status) === 'ABSENT'; }).length,
          overtime_hours: round2_(sum_(attendance, function (x) { return x.overtime_minutes; }) / 60)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      month_label: monthLabel_(month)
    };
  },

  assign: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.edit');
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    Perm.assertEmployee(ctx, payload.employee_id);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    if (txt_(e.status).toUpperCase() === 'EXITED') fail_('NOT_ALLOWED', 'This employee has exited and cannot be assigned to a site.');

    var dupe = Db.findOne(c, 'ProjectAssignments', function (a) {
      return txt_(a.project_id) === p.project_id && txt_(a.employee_id) === e.employee_id && txt_(a.status) === 'ACTIVE';
    });
    if (dupe) fail_('DUPLICATE', txt_(e.name) + ' is already on this site.');
    var overlap = Db.findOne(c, 'ProjectAssignments', function (a) {
      return txt_(a.employee_id) === e.employee_id && txt_(a.status) === 'ACTIVE' &&
        (payload.is_primary === true) && txt_(a.project_id) !== p.project_id;
    });
    if (overlap && payload.is_primary) {
      Db.update(c, 'ProjectAssignments', 'assignment_id', overlap.assignment_id, { status: 'ENDED', to_date: isoAddDays_(payload.from_date || todayIso_(), -1) }, { actor: ctx.userId });
    }
    var row = Db.insert(c, 'ProjectAssignments', {
      project_id: p.project_id, employee_id: e.employee_id, employee_name: txt_(e.name),
      role_on_site: payload.role_on_site, from_date: payload.from_date || todayIso_(), to_date: payload.to_date || '',
      status: 'ACTIVE', is_primary: payload.is_primary === false ? 'FALSE' : 'TRUE', daily_wage: numVal_(payload.daily_wage)
    }, { actor: ctx.userId });
    if (!txt_(e.project_id) || payload.is_primary !== false) {
      Db.update(c, 'Employees', 'employee_id', e.employee_id, { project_id: p.project_id }, { actor: ctx.userId });
    }
    Audit.write(ctx, {
      module: 'projects', action: 'projects.assign', entity: 'ProjectAssignments', entity_id: row.assignment_id,
      after: { project: txt_(p.name), employee: txt_(e.name), role_on_site: payload.role_on_site, is_primary: payload.is_primary !== false },
      note: txt_(e.name) + ' assigned to ' + txt_(p.name)
    });
    Notify.push([e.user_id], {
      company_id: ctx.companyId, title: 'You have been assigned to ' + txt_(p.name),
      body: 'Site: ' + txt_(p.name) + (payload.role_on_site ? ' as ' + payload.role_on_site : '') + '. Effective ' + fmtDateHuman_(row.from_date) + '.',
      kind: 'PROJECT', link_action: 'projects.get', link_payload: { project_id: p.project_id }
    });
    return { assignment_id: row.assignment_id, project_id: p.project_id, employee_id: e.employee_id };
  },

  unassign: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.edit');
    var a = Db.get(c, 'ProjectAssignments', 'assignment_id', payload.assignment_id);
    var e = Db.find(c, 'Employees', 'employee_id', a.employee_id);
    var endDate = payload.to_date || todayIso_();
    Db.update(c, 'ProjectAssignments', 'assignment_id', a.assignment_id, { status: 'ENDED', to_date: endDate }, { actor: ctx.userId });
    if (e && txt_(e.project_id) === txt_(a.project_id)) {
      var other = Db.findOne(c, 'ProjectAssignments', function (x) {
        return txt_(x.employee_id) === a.employee_id && txt_(x.status) === 'ACTIVE' && txt_(x.assignment_id) !== txt_(a.assignment_id);
      });
      Db.update(c, 'Employees', 'employee_id', e.employee_id, { project_id: other ? other.project_id : '' }, { actor: ctx.userId });
    }
    Audit.write(ctx, {
      module: 'projects', action: 'projects.unassign', entity: 'ProjectAssignments', entity_id: a.assignment_id,
      before: { status: a.status, to_date: a.to_date }, after: { status: 'ENDED', to_date: endDate },
      note: (e ? txt_(e.name) : txt_(a.employee_name)) + ' removed from the site' + (payload.reason ? '. Reason: ' + payload.reason : '')
    });
    return { assignment_id: a.assignment_id, status: 'ENDED', to_date: endDate };
  },

  bulkAssign: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.edit');
    var p = Db.get(c, 'Projects', 'project_id', payload.project_id);
    var done = [], skipped = [];
    (payload.employee_ids || []).forEach(function (id) {
      try {
        var res = Projects.assign(ctx, {
          project_id: p.project_id, employee_id: id, role_on_site: payload.role_on_site,
          from_date: payload.from_date, daily_wage: payload.daily_wage, is_primary: true
        });
        done.push(res.assignment_id);
      } catch (e) {
        skipped.push({ employee_id: id, error: e.message });
      }
    });
    Audit.write(ctx, {
      module: 'projects', action: 'projects.assign', entity: 'Projects', entity_id: p.project_id,
      after: { assigned: done.length, skipped: skipped.length },
      note: 'Bulk assignment to ' + txt_(p.name) + ': ' + done.length + ' added, ' + skipped.length + ' skipped'
    });
    return { assigned: done.length, skipped: skipped, project_name: txt_(p.name) };
  },

  /* =========================================================== transfers = */
  transferCreate: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.create');
    Perm.assertEmployee(ctx, payload.employee_id);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var to = Db.get(c, 'Projects', 'project_id', payload.to_project_id);
    var from = txt_(payload.from_project_id) ? Db.find(c, 'Projects', 'project_id', payload.from_project_id) : (txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null);
    if (from && txt_(from.project_id) === txt_(to.project_id)) fail_('VALIDATION', 'The employee is already on that site.');
    var pending = Db.findOne(c, 'TransferRequests', function (t) {
      return txt_(t.employee_id) === e.employee_id && txt_(t.status) === 'PENDING';
    });
    if (pending) fail_('ALREADY_PENDING', 'There is already a transfer request pending for ' + txt_(e.name) + '. Please decide that one first.');
    var row = Db.insert(c, 'TransferRequests', {
      employee_id: e.employee_id, employee_name: txt_(e.name),
      from_project_id: from ? from.project_id : '', to_project_id: to.project_id,
      reason: payload.reason, effective_date: payload.effective_date, status: 'PENDING'
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'projects', action: 'projects.transfer.create', entity: 'TransferRequests', entity_id: row.transfer_id,
      after: { employee: txt_(e.name), from: from ? txt_(from.name) : '-', to: txt_(to.name), effective_date: payload.effective_date, reason: payload.reason },
      note: 'Transfer requested for ' + txt_(e.name) + ' → ' + txt_(to.name)
    });
    Notify.notifyApprovers_(ctx, {
      title: 'Transfer request: ' + txt_(e.name),
      body: (from ? txt_(from.name) : 'Current site') + ' → ' + txt_(to.name) + ' from ' + fmtDateHuman_(payload.effective_date) + '.',
      kind: 'PROJECT', employee_id: e.employee_id,
      link_action: 'projects.transfer', link_payload: { transfer_id: row.transfer_id }
    });
    if (txt_(e.user_id)) {
      Notify.send({
        to: Email.resolve_(ctx, e), template: 'TRANSFER_DECISION',
        vars: { employee_name: txt_(e.name), to_project: txt_(to.name), decision: 'submitted for approval', effective_date: fmtDateHuman_(payload.effective_date), remark: payload.reason }
      });
    }
    return { transfer_id: row.transfer_id, status: 'PENDING' };
  },

  transferList: function (ctx, payload) {
    Perm.require(ctx, 'projects.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'TransferRequests', function (t) {
      if (allowed && allowed.indexOf(txt_(t.employee_id)) < 0) return false;
      if (payload.status && txt_(t.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.employee_id && txt_(t.employee_id) !== txt_(payload.employee_id)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (t) { return matchesSearch_(t, ['employee_name', 'reason', 'status'], payload.search); });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var names = {};
    Db.all(c, 'Projects').forEach(function (p) { names[txt_(p.project_id)] = txt_(p.name); });
    return {
      rows: page.rows.map(function (t) {
        return {
          transfer_id: t.transfer_id, employee_id: t.employee_id, employee_name: t.employee_name,
          from_project_id: t.from_project_id, from_project_name: names[txt_(t.from_project_id)] || '—',
          to_project_id: t.to_project_id, to_project_name: names[txt_(t.to_project_id)] || '—',
          reason: t.reason, effective_date: t.effective_date, status: t.status,
          decided_by_name: t.decided_by_name, decided_at: t.decided_at, decision_remark: t.decision_remark,
          created_at: t.created_at, can_decide: Perm.canApprove(ctx, 'projects')
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  transferDecide: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'projects.approve');
    var t = Db.get(c, 'TransferRequests', 'transfer_id', payload.transfer_id);
    if (txt_(t.status) !== 'PENDING') fail_('ALREADY_DONE', 'This transfer request is already ' + txt_(t.status).toLowerCase() + '.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required to approve or reject.', { field: 'remark' });
    var decision = txt_(payload.decision).toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) fail_('VALIDATION', 'Decision must be APPROVED or REJECTED.');
    var effective = payload.effective_date || t.effective_date || todayIso_();
    Db.update(c, 'TransferRequests', 'transfer_id', t.transfer_id, {
      status: decision, decided_by: ctx.userId, decided_by_name: txt_(ctx.name), decided_at: nowIso_(),
      decision_remark: payload.remark, effective_date: effective
    }, { actor: ctx.userId });

    if (decision === 'APPROVED') {
      var to = Db.get(c, 'Projects', 'project_id', t.to_project_id);
      Db.all(c, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === t.employee_id && txt_(a.status) === 'ACTIVE';
      }).forEach(function (a) {
        Db.update(c, 'ProjectAssignments', 'assignment_id', a.assignment_id, {
          status: 'ENDED', to_date: isoAddDays_(effective, -1)
        }, { actor: ctx.userId });
      });
      Db.insert(c, 'ProjectAssignments', {
        project_id: to.project_id, employee_id: t.employee_id, employee_name: txt_(t.employee_name),
        role_on_site: 'Transferred', from_date: effective, status: 'ACTIVE', is_primary: 'TRUE'
      }, { actor: ctx.userId });
      Db.update(c, 'Employees', 'employee_id', t.employee_id, { project_id: to.project_id }, { actor: ctx.userId });
    }

    var employee = Db.find(c, 'Employees', 'employee_id', t.employee_id);
    Audit.write(ctx, {
      module: 'projects', action: 'projects.transfer.decide', entity: 'TransferRequests', entity_id: t.transfer_id,
      before: { status: t.status }, after: { status: decision, effective_date: effective, remark: payload.remark },
      note: 'Transfer ' + decision + ' for ' + txt_(t.employee_name) + '. Remark: ' + payload.remark, severity: 'SENSITIVE'
    });
    if (employee && txt_(employee.user_id)) {
      Notify.push([employee.user_id], {
        company_id: ctx.companyId, title: 'Transfer ' + decision.toLowerCase(),
        body: 'Your transfer was ' + decision.toLowerCase() + ' effective ' + fmtDateHuman_(effective) + '. ' + payload.remark,
        kind: 'PROJECT', link_action: 'projects.get', link_payload: { project_id: t.to_project_id }
      });
      Notify.send({
        to: Email.resolve_(ctx, employee), template: 'TRANSFER_DECISION',
        vars: {
          employee_name: txt_(t.employee_name), to_project: txt_(to_name_(c, t.to_project_id)), decision: decision,
          effective_date: fmtDateHuman_(effective), remark: payload.remark
        }
      });
    }
    return { transfer_id: t.transfer_id, status: decision, effective_date: effective };
  },

  /* ============================================================ nearby === */
  /** Sites sorted by distance from the phone's position (punch screen). */
  nearby: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.has(ctx, 'projects.view') ? null : (function () {
      var mine = Db.all(c, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === txt_(ctx.employeeId) && txt_(a.status) === 'ACTIVE';
      }).map(function (a) { return txt_(a.project_id); });
      if (txt_(ctx.employeeId)) {
        var e = Db.find(c, 'Employees', 'employee_id', ctx.employeeId);
        if (e && txt_(e.project_id)) mine.push(txt_(e.project_id));
      }
      return uniq_(mine);
    })();
    var rows = Db.all(c, 'Projects', function (p) {
      if (txt_(p.status).toUpperCase() !== 'ACTIVE') return false;
      if (allowed && allowed.indexOf(txt_(p.project_id)) < 0) return false;
      return numVal_(p.latitude) !== 0 && numVal_(p.longitude) !== 0;
    }).map(function (p) {
      var d = haversineM_(payload.lat, payload.lng, p.latitude, p.longitude);
      return {
        project_id: p.project_id, code: p.code, name: p.name, city: p.city,
        distance_m: d, distance_label: distanceLabel_(d),
        radius_m: intVal_(p.radius_m, APP.defaultRadiusM),
        within_fence: d <= intVal_(p.radius_m, APP.defaultRadiusM),
        latitude: numVal_(p.latitude), longitude: numVal_(p.longitude),
        shift_start: p.shift_start, shift_end: p.shift_end, incharge_name: p.incharge_name
      };
    });
    rows.sort(function (a, b) { return a.distance_m - b.distance_m; });
    return { rows: rows.slice(0, 12), user_lat: numVal_(payload.lat), user_lng: numVal_(payload.lng) };
  }
};

function to_name_(c, projectId) {
  var p = Db.find(c, 'Projects', 'project_id', projectId);
  return p ? txt_(p.name) : 'the new site';
}
