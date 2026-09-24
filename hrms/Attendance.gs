/**
 * ============================================================================
 *  FocusHR  —  Attendance.gs
 *  Geo-verified punch in / punch out, attendance register, manual marking,
 *  regularisation requests, anti-spoof flags and the monthly day maths that
 *  payroll relies on.
 * ============================================================================
 */

var Attendance = {

  /* =========================================================== helpers === */
  employeeRecord_: function (ctx) {
    if (!ctx.employeeId) {
      fail_('EMPLOYEE_ONLY', 'This screen is for employees. Sign in with your mobile number on the Employee tab to punch attendance.');
    }
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Db.find(c, 'Employees', 'employee_id', ctx.employeeId);
    if (!e) fail_('NOT_FOUND', 'Your employee record was not found. Please contact HR.');
    if (txt_(e.status).toUpperCase() === 'EXITED') fail_('EMPLOYEE_EXITED', 'Your employment has been marked as ended, so attendance is closed.');
    return e;
  },

  attendanceFor_: function (c, employeeId, date) {
    return Db.findOne(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === txt_(employeeId) && txt_(a.date) === txt_(date);
    });
  },

  geoVerdict_: function (ctx, project, payload) {
    var accuracy = numVal_(payload.accuracy, 0);
    var maxAccuracy = getSettingNum_(ctx, 'attendance.max_accuracy_m', APP.maxGpsAccuracyM);
    var spoofLimit = getSettingNum_(ctx, 'attendance.spoof_accuracy_m', APP.spoofMaxAccuracyM);
    var hasFence = project && numVal_(project.latitude) !== 0 && numVal_(project.longitude) !== 0;
    var radius = project ? intVal_(project.radius_m, getSettingNum_(ctx, 'attendance.radius_m', APP.defaultRadiusM)) : 0;
    var distance = hasFence ? haversineM_(payload.lat, payload.lng, project.latitude, project.longitude) : 0;
    var flagged = false, reason = '';

    if (accuracy > maxAccuracy) {
      fail_('GPS_WEAK', 'Your phone reports a GPS accuracy of about ' + Math.round(accuracy) + ' m, which is too rough to verify your location. ' +
        'Please step outside or near a window, turn on "High accuracy" location and try again.');
    }
    if (accuracy > spoofLimit || (accuracy > 0 && accuracy <= 1)) {
      flagged = true;
      reason = (accuracy <= 1 ? 'Suspiciously perfect GPS accuracy (' + accuracy + ' m) — possible mock location app. ' : 'Very poor GPS accuracy (' + Math.round(accuracy) + ' m). ');
    }
    if (hasFence && distance > radius) {
      fail_('OUT_OF_RANGE', 'You are ' + distanceLabel_(distance) + ' away from ' + txt_(project.name) +
        ' — the allowed radius is ' + radius + ' m. Please move closer to the site and try again, or ask your supervisor for manual attendance.');
    }
    if (hasFence && distance > radius * 0.9) {
      reason = (reason ? reason + ' ' : '') + 'Punched very close to the geo-fence boundary (' + distanceLabel_(distance) + ').';
    }
    return { distance: distance, radius: radius, accuracy: accuracy, flagged: flagged, reason: reason, has_fence: hasFence };
  },

  resolveProject_: function (ctx, c, employee, payload) {
    var project = null;
    if (payload.project_id) {
      project = Db.find(c, 'Projects', 'project_id', payload.project_id);
      if (!project) fail_('NOT_FOUND', 'That site was not found.');
      if (txt_(project.status).toUpperCase() !== 'ACTIVE') fail_('NOT_ALLOWED', txt_(project.name) + ' is not an active site right now.');
    } else if (txt_(employee.project_id)) {
      project = Db.find(c, 'Projects', 'project_id', employee.project_id);
    }
    if (!project) {
      var assignments = Db.all(c, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === employee.employee_id && txt_(a.status) === 'ACTIVE';
      });
      if (assignments.length) project = Db.find(c, 'Projects', 'project_id', assignments[0].project_id);
    }
    if (!project) {
      fail_('NO_PROJECT', 'You are not assigned to any site yet, so attendance cannot be recorded with a location. Please contact HR to assign you to a project.');
    }
    return project;
  },

  shiftWindows_: function (ctx, project) {
    var start = timeToMinutes_(txt_(project && project.shift_start) || getSetting_(ctx, 'attendance.shift_start', '09:00'));
    var end = timeToMinutes_(txt_(project && project.shift_end) || getSetting_(ctx, 'attendance.shift_end', '18:00'));
    if (start < 0) start = 9 * 60;
    if (end < 0) end = 18 * 60;
    if (end <= start) end = start + 9 * 60;
    return { start: start, end: end, minutes: end - start, grace: getSettingNum_(ctx, 'attendance.late_grace_minutes', 10) };
  },

  out_: function (ctx, a, extra) {
    return Object.assign({
      attendance_id: a.attendance_id, employee_id: a.employee_id, employee_code: a.employee_code, employee_name: a.employee_name,
      date: a.date, project_id: a.project_id, project_name: a.project_name, status: a.status,
      in_time: a.in_time, out_time: a.out_time, worked_minutes: intVal_(a.worked_minutes), shift_minutes: intVal_(a.shift_minutes),
      late_minutes: intVal_(a.late_minutes), early_minutes: intVal_(a.early_minutes), overtime_minutes: intVal_(a.overtime_minutes),
      source: a.source, in_lat: numVal_(a.in_lat), in_lng: numVal_(a.in_lng), in_distance_m: intVal_(a.in_distance_m),
      out_lat: numVal_(a.out_lat), out_lng: numVal_(a.out_lng), out_distance_m: intVal_(a.out_distance_m),
      flagged: boolVal_(a.flagged), flag_reason: a.flag_reason, remark: a.remark,
      payroll_locked: boolVal_(a.payroll_locked), updated_at: a.updated_at
    }, extra || {});
  },

  /* =========================================================== context === */
  context: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var out = {
      today: todayIso_(), now: nowIso_(), server_time: nowTime_(),
      settings: {
        radius_m: getSettingNum_(ctx, 'attendance.radius_m', APP.defaultRadiusM),
        max_accuracy_m: getSettingNum_(ctx, 'attendance.max_accuracy_m', APP.maxGpsAccuracyM),
        shift_start: getSetting_(ctx, 'attendance.shift_start', '09:00'),
        shift_end: getSetting_(ctx, 'attendance.shift_end', '18:00'),
        weekly_off: getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY'),
        work_hours_per_day: getSettingNum_(ctx, 'attendance.work_hours_per_day', 8),
        regularization_days: getSettingNum_(ctx, 'attendance.allow_regularization_days', 7),
        punch_out_required: getSettingBool_(ctx, 'attendance.punch_out_required', true)
      },
      is_holiday: null,
      can_mark_manual: Perm.has(ctx, 'attendance.edit') || Perm.has(ctx, 'attendance.create'),
      can_approve: Perm.canApprove(ctx, 'attendance'),
      can_view_team: !Perm.isSelfOnly(ctx)
    };
    var holiday = Db.findOne(c, 'Holidays', function (h) { return txt_(h.date) === todayIso_(); });
    if (holiday) out.is_holiday = { name: txt_(holiday.name), kind: txt_(holiday.kind) };
    if (ctx.employeeId) {
      var e = Attendance.employeeRecord_(ctx);
      var project = txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null;
      out.employee = { employee_id: e.employee_id, code: e.code, name: e.name, designation: e.designation, project_id: e.project_id };
      out.project = project ? {
        project_id: project.project_id, name: project.name, city: project.city,
        latitude: numVal_(project.latitude), longitude: numVal_(project.longitude),
        radius_m: intVal_(project.radius_m, out.settings.radius_m),
        shift_start: project.shift_start, shift_end: project.shift_end,
        geofence_set: numVal_(project.latitude) !== 0
      } : null;
      var rec = Attendance.attendanceFor_(c, e.employee_id, todayIso_());
      out.today_record = rec ? Attendance.out_(ctx, rec) : null;
      out.next_action = !rec || !txt_(rec.in_time) ? 'PUNCH_IN' : (!txt_(rec.out_time) ? 'PUNCH_OUT' : 'DONE');
      out.pending_regularization = Db.count(c, 'AttendanceRegularization', function (r) {
        return txt_(r.employee_id) === e.employee_id && txt_(r.status) === 'PENDING';
      });
      out.recent = sortRows_(Db.all(c, 'Attendance', function (a) { return txt_(a.employee_id) === e.employee_id; }), 'date', 'DESC')
        .slice(0, 7).map(function (a) { return Attendance.out_(ctx, a); });
    }
    return out;
  },

  today: function (ctx) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { today_record: null, message: 'Sign in as an employee to see today\'s attendance.' };
    var e = Attendance.employeeRecord_(ctx);
    var rec = Attendance.attendanceFor_(c, e.employee_id, todayIso_());
    return { today_record: rec ? Attendance.out_(ctx, rec) : null, employee: { employee_id: e.employee_id, code: e.code, name: e.name }, today: todayIso_() };
  },

  /* ============================================================= punch === */
  punchIn: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Attendance.employeeRecord_(ctx);
    var date = todayIso_();
    var existing = Attendance.attendanceFor_(c, e.employee_id, date);
    if (existing && txt_(existing.in_time)) {
      fail_('ALREADY_PUNCHED_IN', 'You already punched in at ' + txt_(existing.in_time) + ' today' + (txt_(existing.out_time) ? ' and punched out at ' + txt_(existing.out_time) + '.' : '. Punch out when you leave the site.'));
    }
    if (existing && txt_(existing.status) === 'LEAVE') {
      fail_('ON_LEAVE', 'Today is marked as approved leave, so you cannot punch in. If you have returned early, ask HR to cancel the leave or mark manual attendance.');
    }
    var project = Attendance.resolveProject_(ctx, c, e, payload);
    var verdict = Attendance.geoVerdict_(ctx, project, payload);
    var shift = Attendance.shiftWindows_(ctx, project);
    var nowMin = timeToMinutes_(nowTime_());
    var late = Math.max(0, nowMin - shift.start - shift.grace);
    var payloadDevice = payload.device && typeof payload.device === 'object' ? payload.device : {};

    var patch = {
      employee_id: e.employee_id, employee_code: txt_(e.code), employee_name: txt_(e.name), date: date,
      project_id: project.project_id, project_name: txt_(project.name), status: 'PRESENT',
      in_time: nowTime_(), shift_minutes: shift.minutes, late_minutes: late, source: 'GEO',
      in_lat: numVal_(payload.lat), in_lng: numVal_(payload.lng), in_accuracy_m: numVal_(payload.accuracy, 0),
      in_distance_m: verdict.distance,
      device_json: jsonStr_({ platform: payloadDevice.platform || '', ua: txt_(ctx.userAgent).slice(0, 120), selfie: txt_(payload.selfie_file_id) }),
      flagged: verdict.flagged ? 'TRUE' : 'FALSE', flag_reason: verdict.reason,
      remark: verdict.has_fence ? '' : 'No geo-fence configured for this site, location only recorded.'
    };
    var row;
    if (existing) {
      row = Db.update(c, 'Attendance', 'attendance_id', existing.attendance_id, patch, { actor: ctx.userId });
    } else {
      row = Db.insert(c, 'Attendance', patch, { actor: ctx.userId });
    }
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.punch.in', entity: 'Attendance', entity_id: row.attendance_id,
      after: { date: date, time: patch.in_time, project: txt_(project.name), distance_m: verdict.distance, accuracy_m: patch.in_accuracy_m, flagged: verdict.flagged },
      note: 'Punch in at ' + txt_(project.name) + (verdict.distance ? ' (' + distanceLabel_(verdict.distance) + ' from site centre)' : '')
    });

    var message = 'Punched in at ' + patch.in_time + '. Have a good day!';
    if (late > 0) message = 'Punched in at ' + patch.in_time + ' — ' + late + ' minutes late as per the shift start ' + txt_(project.shift_start || getSetting_(ctx, 'attendance.shift_start', '09:00')) + '.';
    if (verdict.flagged) message += ' This punch is marked for review because the location signal looked unusual.';
    return {
      attendance: Attendance.out_(ctx, row),
      message: message,
      distance_label: distanceLabel_(verdict.distance),
      flagged: verdict.flagged,
      late_minutes: late
    };
  },

  punchOut: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Attendance.employeeRecord_(ctx);
    var date = todayIso_();
    var existing = Attendance.attendanceFor_(c, e.employee_id, date);
    if (!existing || !txt_(existing.in_time)) {
      fail_('NOT_PUNCHED_IN', 'You have not punched in today. Please punch in first, or ask your supervisor to mark manual attendance.');
    }
    if (txt_(existing.out_time)) {
      fail_('ALREADY_PUNCHED_OUT', 'You already punched out at ' + txt_(existing.out_time) + ' today.');
    }
    var project = txt_(existing.project_id) ? Db.find(c, 'Projects', 'project_id', existing.project_id) : Attendance.resolveProject_(ctx, c, e, payload);
    var verdict = Attendance.geoVerdict_(ctx, project, payload);
    var shift = Attendance.shiftWindows_(ctx, project);
    var inMin = timeToMinutes_(existing.in_time);
    var nowMin = timeToMinutes_(nowTime_());
    var worked = Math.max(0, nowMin - inMin);
    var halfDayHours = getSettingNum_(ctx, 'attendance.half_day_hours', 4) * 60;
    var overtime = worked > shift.minutes + 30 ? worked - shift.minutes : 0;
    var early = Math.max(0, shift.end - nowMin);

    var patch = {
      out_time: nowTime_(), worked_minutes: worked,
      early_minutes: worked < shift.minutes ? early : 0,
      overtime_minutes: overtime,
      out_lat: numVal_(payload.lat), out_lng: numVal_(payload.lng), out_accuracy_m: numVal_(payload.accuracy, 0),
      out_distance_m: verdict.distance,
      status: worked < halfDayHours ? 'HALF_DAY' : (txt_(existing.status) === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT'),
      flagged: (boolVal_(existing.flagged) || verdict.flagged) ? 'TRUE' : 'FALSE',
      flag_reason: [txt_(existing.flag_reason), verdict.reason].filter(function (x) { return !!x; }).join(' ').slice(0, 400)
    };
    var row = Db.update(c, 'Attendance', 'attendance_id', existing.attendance_id, patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.punch.out', entity: 'Attendance', entity_id: row.attendance_id,
      after: { time: patch.out_time, worked_minutes: worked, overtime_minutes: overtime, status: patch.status, distance_m: verdict.distance },
      note: 'Punch out at ' + txt_(project ? project.name : '') + ' — ' + hoursLabel_(worked) + ' worked'
    });

    var message = 'Punched out at ' + patch.out_time + '. You worked ' + hoursLabel_(worked) + '.';
    if (patch.status === 'HALF_DAY') message += ' This will be treated as a half day.';
    if (overtime > 0) message += ' ' + hoursLabel_(overtime) + ' of overtime recorded for payroll.';
    return { attendance: Attendance.out_(ctx, row), message: message, worked_minutes: worked, overtime_minutes: overtime };
  },

  /* ============================================================== lists == */
  list: function (ctx, payload) {
    Perm.require(ctx, 'attendance.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var from = payload.from || monthStart_(monthOfIso_(todayIso_()));
    var to = payload.to || monthEnd_(monthOfIso_(todayIso_()));
    var rows = Db.all(c, 'Attendance', function (a) {
      if (allowed && allowed.indexOf(txt_(a.employee_id)) < 0) return false;
      if (txt_(a.date) < from || txt_(a.date) > to) return false;
      if (payload.employee_id && txt_(a.employee_id) !== txt_(payload.employee_id)) return false;
      if (payload.project_id && txt_(a.project_id) !== txt_(payload.project_id)) return false;
      if (payload.status && txt_(a.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.source && txt_(a.source).toUpperCase() !== txt_(payload.source).toUpperCase()) return false;
      if (payload.flagged === 'TRUE' && !boolVal_(a.flagged)) return false;
      if (payload.flagged === 'FALSE' && boolVal_(a.flagged)) return false;
      return true;
    });
    if (payload.department) {
      var dept = {};
      Db.all(c, 'Employees').forEach(function (e) { dept[txt_(e.employee_id)] = txt_(e.department); });
      rows = rows.filter(function (a) { return dept[txt_(a.employee_id)] === txt_(payload.department); });
    }
    if (payload.search) rows = rows.filter(function (a) { return matchesSearch_(a, SCHEMA.Attendance.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'date', payload.dir || 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (a) { return Attendance.out_(ctx, a); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      from: from, to: to,
      totals: {
        present: rows.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
        absent: rows.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
        half_day: rows.filter(function (a) { return txt_(a.status) === 'HALF_DAY'; }).length,
        leave: rows.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length,
        flagged: rows.filter(function (a) { return boolVal_(a.flagged); }).length,
        overtime_hours: round2_(sum_(rows, function (a) { return a.overtime_minutes; }) / 60),
        late_count: rows.filter(function (a) { return intVal_(a.late_minutes, 0) > 0; }).length
      }
    };
  },

  my: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) fail_('EMPLOYEE_ONLY', 'Attendance history is available to employee logins.');
    var from = payload.from || monthStart_(monthOfIso_(todayIso_()));
    var to = payload.to || monthEnd_(monthOfIso_(todayIso_()));
    var rows = sortRows_(Db.all(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === ctx.employeeId && txt_(a.date) >= from && txt_(a.date) <= to;
    }), 'date', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize || 31);
    return {
      rows: page.rows.map(function (a) { return Attendance.out_(ctx, a); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      from: from, to: to,
      summary: Attendance.summarise_(rows),
      holidays: Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= from && txt_(h.date) <= to; })
        .map(function (h) { return { date: h.date, name: h.name, kind: h.kind }; })
    };
  },

  summarise_: function (rows) {
    var out = {
      present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0, weekly_off: 0, od: 0, missing_punch: 0,
      ot_hours: 0, late_count: 0, worked_hours: 0, days_recorded: rows.length
    };
    rows.forEach(function (a) {
      var key = txt_(a.status).toLowerCase();
      if (out[key] === undefined) out[key] = 0;
      out[key]++;
      out.ot_hours += numVal_(a.overtime_minutes) / 60;
      out.worked_hours += numVal_(a.worked_minutes) / 60;
      if (intVal_(a.late_minutes, 0) > 0) out.late_count++;
    });
    out.ot_hours = round2_(out.ot_hours);
    out.worked_hours = round2_(out.worked_hours);
    out.paid_days = round2_(out.present + out.od + out.half_day * 0.5 + out.leave + out.holiday + out.weekly_off);
    return out;
  },

  /* ===================================================== manual marking == */
  manualSave: function (ctx, payload) {
    Perm.require(ctx, 'attendance.edit');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    if (txt_(payload.remark).length < 5) fail_('VALIDATION', 'Please give a reason for this manual entry (it is stored in the audit trail).', { field: 'remark' });
    if (payload.date > todayIso_()) fail_('VALIDATION', 'Attendance cannot be marked for a future date.', { field: 'date' });
    if (txt_(e.joining_date) && payload.date < txt_(e.joining_date)) fail_('VALIDATION', 'This date is before the employee joined.');
    var project = txt_(payload.project_id) ? Db.find(c, 'Projects', 'project_id', payload.project_id)
      : (txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null);
    var status = txt_(payload.status).toUpperCase();
    if (STATUS.ATTENDANCE.indexOf(status) < 0) fail_('VALIDATION', 'Choose a valid attendance status.');

    var inTime = txt_(payload.in_time), outTime = txt_(payload.out_time);
    var worked = 0, late = 0, early = 0, overtime = intVal_(payload.overtime_minutes, 0);
    if (inTime && outTime) {
      var inMin = timeToMinutes_(inTime), outMin = timeToMinutes_(outTime);
      if (outMin <= inMin) fail_('VALIDATION', 'Punch out time must be after punch in time.', { field: 'out_time' });
      worked = outMin - inMin;
      var shift = Attendance.shiftWindows_(ctx, project);
      late = Math.max(0, inMin - shift.start - shift.grace);
      early = Math.max(0, shift.end - outMin);
      if (!overtime && worked > shift.minutes + 30) overtime = worked - shift.minutes;
    }
    if (status === 'PRESENT' && (!inTime || !outTime)) {
      fail_('VALIDATION', 'For PRESENT, please enter both punch in and punch out times (or choose another status such as MISSING_PUNCH).');
    }
    var existing = Attendance.attendanceFor_(c, e.employee_id, payload.date);
    var patch = {
      employee_id: e.employee_id, employee_code: txt_(e.code), employee_name: txt_(e.name), date: payload.date,
      project_id: project ? project.project_id : '', project_name: project ? txt_(project.name) : '',
      status: status, in_time: inTime, out_time: outTime, worked_minutes: worked, shift_minutes: Attendance.shiftWindows_(ctx, project).minutes,
      late_minutes: late, early_minutes: early, overtime_minutes: overtime,
      source: 'ADMIN', remark: payload.remark, payroll_locked: boolVal_(existing && existing.payroll_locked) ? 'TRUE' : 'FALSE'
    };
    var row;
    if (existing) {
      if (boolVal_(existing.payroll_locked)) fail_('LOCKED', 'This day is already included in a paid payroll run. Reverse the payroll first before changing attendance.');
      row = Db.update(c, 'Attendance', 'attendance_id', existing.attendance_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'attendance', action: 'attendance.manual.save', entity: 'Attendance', entity_id: row.attendance_id,
        before: { status: existing.status, in_time: existing.in_time, out_time: existing.out_time, source: existing.source },
        after: { status: status, in_time: inTime, out_time: outTime, source: 'ADMIN' },
        note: 'Manual attendance changed by ' + txt_(ctx.name) + '. Reason: ' + payload.remark, severity: 'SENSITIVE'
      });
    } else {
      row = Db.insert(c, 'Attendance', patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'attendance', action: 'attendance.manual.save', entity: 'Attendance', entity_id: row.attendance_id,
        after: redact_(patch), note: 'Manual attendance marked by ' + txt_(ctx.name) + '. Reason: ' + payload.remark, severity: 'SENSITIVE'
      });
    }
    if (txt_(e.user_id) && inTime) {
      Notify.push([e.user_id], {
        company_id: ctx.companyId, title: 'Attendance updated for ' + fmtDateHuman_(payload.date),
        body: 'Marked ' + status + (inTime ? ' (' + inTime + ' - ' + outTime + ')' : '') + ' by ' + txt_(ctx.name) + '. Reason: ' + payload.remark,
        kind: 'ATTENDANCE', link_action: 'attendance.my', link_payload: { date: payload.date }
      });
    }
    return { attendance: Attendance.out_(ctx, row), created: !existing };
  },

  manualBulk: function (ctx, payload) {
    Perm.require(ctx, 'attendance.create');
    if (payload.date > todayIso_()) fail_('VALIDATION', 'Attendance cannot be marked for a future date.');
    if (txt_(payload.remark).length < 5) fail_('VALIDATION', 'Please give a reason for this bulk entry.', { field: 'remark' });
    var ids = payload.employee_ids || [];
    if (!ids.length) fail_('VALIDATION', 'Select at least one employee.');
    if (ids.length > 200) fail_('VALIDATION', 'Please mark at most 200 employees at a time.');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var done = 0, skipped = [];
    ids.forEach(function (id) {
      try {
        Attendance.manualSave(ctx, {
          employee_id: id, date: payload.date, status: payload.status, remark: payload.remark,
          project_id: payload.project_id,
          in_time: payload.in_time, out_time: payload.out_time,
          overtime_minutes: payload.overtime_minutes, leave_type_id: payload.leave_type_id
        });
        done++;
      } catch (e) {
        var emp = Db.find(c, 'Employees', 'employee_id', id);
        skipped.push({ employee_id: id, name: emp ? txt_(emp.name) : id, error: e.message });
      }
    });
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.manual.bulk', entity: 'Attendance', entity_id: payload.date,
      after: { date: payload.date, status: payload.status, marked: done, skipped: skipped.length },
      note: 'Bulk attendance ' + payload.status + ' for ' + payload.date + '. Reason: ' + payload.remark, severity: 'SENSITIVE'
    });
    return { marked: done, skipped: skipped, date: payload.date, status: payload.status };
  },

  flagReview: function (ctx, payload) {
    Perm.require(ctx, 'attendance.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var a = Db.get(c, 'Attendance', 'attendance_id', payload.attendance_id);
    Perm.assertEmployee(ctx, a.employee_id);
    Db.update(c, 'Attendance', 'attendance_id', a.attendance_id, {
      flagged: payload.flagged === false ? 'FALSE' : 'TRUE',
      flag_reason: payload.flagged === false ? '' : (txt_(a.flag_reason) + ' | Reviewed: ' + payload.remark),
      remark: txt_(a.remark) + (payload.remark ? ' | ' + payload.remark : '')
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.flag.review', entity: 'Attendance', entity_id: a.attendance_id,
      before: { flagged: boolVal_(a.flagged), flag_reason: a.flag_reason },
      after: { flagged: payload.flagged !== false, remark: payload.remark },
      note: 'Anti-spoof flag reviewed by ' + txt_(ctx.name), severity: 'SENSITIVE'
    });
    return { attendance_id: a.attendance_id, flagged: payload.flagged !== false };
  },

  /* ====================================================== regularisation == */
  regularizeRequest: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) fail_('EMPLOYEE_ONLY', 'Attendance correction can be requested from an employee login.');
    var e = Attendance.employeeRecord_(ctx);
    if (payload.date > todayIso_()) fail_('VALIDATION', 'You cannot request a correction for a future date.', { field: 'date' });
    var window = getSettingNum_(ctx, 'attendance.allow_regularization_days', 7);
    if (daysBetweenIso_(payload.date, todayIso_()) > window) {
      fail_('NOT_ALLOWED', 'Corrections can be requested only for the last ' + window + ' day(s). Please speak to HR for older dates.');
    }
    var existing = Attendance.attendanceFor_(c, e.employee_id, payload.date);
    if (existing && txt_(existing.status) === 'LEAVE') fail_('NOT_ALLOWED', 'That day is approved leave. Cancel the leave request first if you actually worked.');
    var pending = Db.findOne(c, 'AttendanceRegularization', function (r) {
      return txt_(r.employee_id) === e.employee_id && txt_(r.date) === payload.date && txt_(r.status) === 'PENDING';
    });
    if (pending) fail_('ALREADY_PENDING', 'You already have a pending correction request for ' + fmtDateHuman_(payload.date) + '.');
    var row = Db.insert(c, 'AttendanceRegularization', {
      employee_id: e.employee_id, employee_name: txt_(e.name), date: payload.date,
      requested_status: txt_(payload.requested_status).toUpperCase(),
      requested_in: txt_(payload.requested_in), requested_out: txt_(payload.requested_out),
      reason: payload.reason, status: 'PENDING', attendance_id: existing ? existing.attendance_id : ''
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.regularize.request', entity: 'AttendanceRegularization', entity_id: row.request_id,
      after: { date: payload.date, requested_status: payload.requested_status, in: payload.requested_in, out: payload.requested_out, reason: payload.reason },
      note: 'Correction requested by ' + txt_(e.name)
    });
    Notify.notifyApprovers_(ctx, {
      title: 'Attendance correction: ' + txt_(e.name),
      body: fmtDateHuman_(payload.date) + ' → ' + payload.requested_status + (payload.requested_in ? ' (' + payload.requested_in + ' - ' + payload.requested_out + ')' : '') + '. Reason: ' + payload.reason,
      kind: 'ATTENDANCE', employee_id: e.employee_id,
      link_action: 'attendance.regularizations', link_payload: { request_id: row.request_id }
    });
    return { request_id: row.request_id, status: 'PENDING' };
  },

  regularizeList: function (ctx, payload) {
    Perm.require(ctx, 'attendance.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'AttendanceRegularization', function (r) {
      if (allowed && allowed.indexOf(txt_(r.employee_id)) < 0) return false;
      if (payload.status && txt_(r.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.employee_id && txt_(r.employee_id) !== txt_(payload.employee_id)) return false;
      if (payload.from && txt_(r.date) < txt_(payload.from)) return false;
      if (payload.to && txt_(r.date) > txt_(payload.to)) return false;
      return true;
    });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return {
          request_id: r.request_id, employee_id: r.employee_id, employee_name: r.employee_name, date: r.date,
          requested_status: r.requested_status, requested_in: r.requested_in, requested_out: r.requested_out,
          reason: r.reason, status: r.status, decided_by_name: r.decided_by_name, decided_at: r.decided_at,
          decision_remark: r.decision_remark, created_at: r.created_at, can_decide: Perm.canApprove(ctx, 'attendance'),
          has_record: !!txt_(r.attendance_id)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      pending_count: Db.count(c, 'AttendanceRegularization', function (r) {
        return txt_(r.status) === 'PENDING' && (!allowed || allowed.indexOf(txt_(r.employee_id)) >= 0);
      })
    };
  },

  regularizeMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0 };
    var rows = sortRows_(Db.all(c, 'AttendanceRegularization', function (r) { return txt_(r.employee_id) === ctx.employeeId; }), 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (r) {
        return {
          request_id: r.request_id, date: r.date, requested_status: r.requested_status, requested_in: r.requested_in,
          requested_out: r.requested_out, reason: r.reason, status: r.status, decision_remark: r.decision_remark,
          created_at: r.created_at, decided_at: r.decided_at, decided_by_name: r.decided_by_name
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  regularizeDecide: function (ctx, payload) {
    Perm.require(ctx, 'attendance.approve');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var r = Db.get(c, 'AttendanceRegularization', 'request_id', payload.request_id);
    Perm.assertEmployee(ctx, r.employee_id);
    if (txt_(r.status) !== 'PENDING') fail_('ALREADY_DONE', 'This request is already ' + txt_(r.status).toLowerCase() + '.');
    if (!txt_(payload.remark)) fail_('VALIDATION', 'A remark is required to approve or reject.', { field: 'remark' });
    var decision = txt_(payload.decision).toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) < 0) fail_('VALIDATION', 'Decision must be APPROVED or REJECTED.');

    if (decision === 'APPROVED') {
      var e = Db.get(c, 'Employees', 'employee_id', r.employee_id);
      var existing = Attendance.attendanceFor_(c, r.employee_id, r.date);
      if (existing && boolVal_(existing.payroll_locked)) fail_('LOCKED', 'That day is already part of a paid payroll run, so attendance cannot be changed now.');
      var project = txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null;
      var inTime = txt_(r.requested_in), outTime = txt_(r.requested_out);
      var worked = 0, late = 0, overtime = 0;
      var shift = Attendance.shiftWindows_(ctx, project);
      if (inTime && outTime && timeToMinutes_(outTime) > timeToMinutes_(inTime)) {
        worked = timeToMinutes_(outTime) - timeToMinutes_(inTime);
        late = Math.max(0, timeToMinutes_(inTime) - shift.start - shift.grace);
        overtime = worked > shift.minutes + 30 ? worked - shift.minutes : 0;
      }
      var patch = {
        employee_id: r.employee_id, employee_code: txt_(e.code), employee_name: txt_(e.name), date: r.date,
        project_id: project ? project.project_id : '', project_name: project ? txt_(project.name) : '',
        status: txt_(r.requested_status).toUpperCase(), in_time: inTime, out_time: outTime,
        worked_minutes: worked, shift_minutes: shift.minutes, late_minutes: late, overtime_minutes: overtime,
        source: 'REGULARIZED', regularization_id: r.request_id,
        remark: 'Approved correction: ' + r.reason + ' | ' + payload.remark
      };
      if (existing) Db.update(c, 'Attendance', 'attendance_id', existing.attendance_id, patch, { actor: ctx.userId });
      else Db.insert(c, 'Attendance', patch, { actor: ctx.userId });
    }

    Db.update(c, 'AttendanceRegularization', 'request_id', r.request_id, {
      status: decision, decided_by: ctx.userId, decided_by_name: txt_(ctx.name), decided_at: nowIso_(), decision_remark: payload.remark
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'attendance', action: 'attendance.regularize.decide', entity: 'AttendanceRegularization', entity_id: r.request_id,
      before: { status: r.status }, after: { status: decision, remark: payload.remark },
      note: 'Correction ' + decision + ' for ' + txt_(r.employee_name) + ' (' + r.date + ')', severity: 'SENSITIVE'
    });
    var emp = Db.find(c, 'Employees', 'employee_id', r.employee_id);
    if (emp && txt_(emp.user_id)) {
      Notify.push([emp.user_id], {
        company_id: ctx.companyId, title: 'Attendance correction ' + decision.toLowerCase(),
        body: 'Your request for ' + fmtDateHuman_(r.date) + ' was ' + decision.toLowerCase() + '. ' + payload.remark,
        kind: 'ATTENDANCE', link_action: 'attendance.my', link_payload: { date: r.date }
      });
      var to = Email.resolve_(ctx, emp);
      if (to) Notify.send({
        to: to, template: 'REGULARIZATION_DECISION',
        vars: { employee_name: txt_(r.employee_name), date: fmtDateHuman_(r.date), decision: decision, remark: payload.remark }
      });
    }
    return { request_id: r.request_id, status: decision };
  },

  /* ========================================================== summaries == */
  summary: function (ctx, payload) {
    Perm.require(ctx, 'attendance.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var employees = Perm.filterEmployees(ctx, Db.all(c, 'Employees', function (e) {
      if (txt_(e.status).toUpperCase() === 'EXITED') return false;
      if (payload.department && txt_(e.department) !== txt_(payload.department)) return false;
      return true;
    }));
    if (payload.employee_id) employees = employees.filter(function (e) { return txt_(e.employee_id) === payload.employee_id; });
    if (payload.project_id) employees = employees.filter(function (e) { return txt_(e.project_id) === txt_(payload.project_id); });

    var byEmployee = {};
    Db.all(c, 'Attendance', function (a) {
      return txt_(a.date) >= payload.from && txt_(a.date) <= payload.to && (!allowed || allowed.indexOf(txt_(a.employee_id)) >= 0);
    }).forEach(function (a) {
      if (!byEmployee[txt_(a.employee_id)]) byEmployee[txt_(a.employee_id)] = [];
      byEmployee[txt_(a.employee_id)].push(a);
    });

    var rows = employees.map(function (e) {
      var list = byEmployee[txt_(e.employee_id)] || [];
      var s = Attendance.summarise_(list);
      return {
        employee_id: e.employee_id, code: e.code, name: e.name, department: e.department, designation: e.designation,
        project_id: e.project_id, present_days: s.present + s.od, half_days: s.half_day, absent_days: s.absent,
        leave_days: s.leave, holiday_days: s.holiday, weekly_off_days: s.weekly_off, ot_hours: s.ot_hours,
        late_count: s.late_count, worked_hours: s.worked_hours, paid_days: s.paid_days, days_recorded: s.days_recorded
      };
    });
    rows = sortRows_(rows, 'name', 'ASC');
    return {
      rows: rows,
      from: payload.from, to: payload.to,
      totals: {
        employees: rows.length,
        present_days: sum_(rows, function (r) { return r.present_days; }),
        half_days: sum_(rows, function (r) { return r.half_days; }),
        absent_days: sum_(rows, function (r) { return r.absent_days; }),
        leave_days: sum_(rows, function (r) { return r.leave_days; }),
        ot_hours: round2_(sum_(rows, function (r) { return r.ot_hours; })),
        late_count: sum_(rows, function (r) { return r.late_count; })
      }
    };
  },

  month: function (ctx, payload) {
    Perm.require(ctx, 'attendance.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var month = payload.month;
    var from = monthStart_(month), to = monthEnd_(month);
    var days = isoRange_(from, to);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var employees = Perm.filterEmployees(ctx, Db.all(c, 'Employees', function (e) {
      if (txt_(e.status).toUpperCase() === 'EXITED' && txt_(e.exit_date) < from) return false;
      if (payload.department && txt_(e.department) !== txt_(payload.department)) return false;
      if (payload.project_id && txt_(e.project_id) !== txt_(payload.project_id)) return false;
      return true;
    }));
    var att = {};
    Db.all(c, 'Attendance', function (a) {
      return txt_(a.date) >= from && txt_(a.date) <= to && (!allowed || allowed.indexOf(txt_(a.employee_id)) >= 0);
    }).forEach(function (a) {
      if (!att[txt_(a.employee_id)]) att[txt_(a.employee_id)] = {};
      att[txt_(a.employee_id)][txt_(a.date)] = {
        status: txt_(a.status), in_time: txt_(a.in_time), out_time: txt_(a.out_time),
        ot: intVal_(a.overtime_minutes), late: intVal_(a.late_minutes), flagged: boolVal_(a.flagged),
        project_id: txt_(a.project_id), source: txt_(a.source)
      };
    });
    var holidays = {};
    Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= from && txt_(h.date) <= to; })
      .forEach(function (h) { holidays[txt_(h.date)] = txt_(h.name); });

    return {
      month: month, month_label: monthLabel_(month), days: days,
      day_meta: days.map(function (d) {
        return { date: d, day: Number(d.slice(-2)), dow: dayName_(d).slice(0, 3), holiday: holidays[d] || '', weekly_off: isWeekOff_(d, getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY')) };
      }),
      rows: employees.map(function (e) {
        var map = att[txt_(e.employee_id)] || {};
        var s = Attendance.summarise_(Object.keys(map).map(function (k) { return map[k]; }));
        return {
          employee_id: e.employee_id, code: e.code, name: e.name, department: e.department, designation: e.designation,
          days: map, summary: s
        };
      })
    };
  },

  /**
   * Per-employee day-by-day facts for a month — the single source of truth
   * for payroll. Missing days are inferred (holiday / weekly off / leave / absent).
   */
  monthStats_: function (ctx, c, employeeId, month) {
    var from = monthStart_(month), to = monthEnd_(month);
    var employee = Db.find(c, 'Employees', 'employee_id', employeeId);
    if (!employee) return null;
    var holidayMap = {};
    Db.all(c, 'Holidays', function (h) { return txt_(h.date) >= from && txt_(h.date) <= to && (txt_(h.branch_id) === '' || txt_(h.branch_id) === txt_(employee.branch_id)); })
      .forEach(function (h) { holidayMap[txt_(h.date)] = txt_(h.name); });
    var rows = Db.all(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === employeeId && txt_(a.date) >= from && txt_(a.date) <= to;
    });
    var byDate = {};
    rows.forEach(function (a) { byDate[txt_(a.date)] = a; });
    var leaveDates = {};
    Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.employee_id) === employeeId && txt_(l.status) === 'APPROVED' && txt_(l.from_date) <= to && txt_(l.to_date) >= from;
    }).forEach(function (l) {
      isoRange_(l.from_date > from ? l.from_date : from, l.to_date < to ? l.to_date : to).forEach(function (d) { leaveDates[d] = txt_(l.leave_type_name); });
    });

    var weeklyOff = txt_(getSetting_(ctx, 'attendance.weekly_off', 'SUNDAY'));
    var project = txt_(employee.project_id) ? Db.find(c, 'Projects', 'project_id', employee.project_id) : null;
    var projectWeeklyOff = project && txt_(project.weekly_off) ? txt_(project.weekly_off) : weeklyOff;

    var out = {
      employee_id: employeeId, employee: employee, month: month, from: from, to: to,
      present: 0, half_day: 0, absent: 0, leave: 0, paid_leave: 0, unpaid_leave: 0, holiday: 0, weekly_off: 0, od: 0,
      missing_punch: 0, ot_minutes: 0, late_minutes: 0, late_days: 0, worked_minutes: 0,
      not_employed: 0, future_days: 0,
      days: [], project_days: {}
    };
    var leaveTypes = {};
    Db.all(c, 'LeaveTypes').forEach(function (t) { leaveTypes[txt_(t.leave_type_id)] = boolVal_(t.is_paid); });

    isoRange_(from, to).forEach(function (d) {
      var rec = byDate[d];
      var isBeforeJoining = txt_(employee.joining_date) && d < txt_(employee.joining_date);
      var isAfterExit = txt_(employee.exit_date) && d > txt_(employee.exit_date);
      var entry = { date: d, status: '', in_time: '', out_time: '', ot_minutes: 0, source: '', project_id: '', remark: '' };
      if (isBeforeJoining || isAfterExit) {
        entry.status = 'NOT_EMPLOYED';
        out.not_employed = (out.not_employed || 0) + 1;
      } else if (rec) {
        entry.status = txt_(rec.status);
        entry.in_time = txt_(rec.in_time);
        entry.out_time = txt_(rec.out_time);
        entry.ot_minutes = intVal_(rec.overtime_minutes, 0);
        entry.source = txt_(rec.source);
        entry.project_id = txt_(rec.project_id);
        entry.remark = txt_(rec.remark);
        entry.flagged = boolVal_(rec.flagged);
        entry.late_minutes = intVal_(rec.late_minutes, 0);
      } else if (holidayMap[d]) {
        entry.status = 'HOLIDAY';
        entry.remark = holidayMap[d];
      } else if (leaveDates[d]) {
        entry.status = 'LEAVE';
        entry.remark = leaveDates[d];
      } else if (isWeekOff_(d, projectWeeklyOff)) {
        entry.status = 'WEEKLY_OFF';
      } else if (d > todayIso_()) {
        entry.status = 'FUTURE';
        out.future_days = (out.future_days || 0) + 1;
      } else {
        entry.status = 'ABSENT';
        entry.remark = 'No attendance record';
      }

      switch (entry.status) {
        case 'PRESENT': out.present++; break;
        case 'HALF_DAY': out.half_day++; break;
        case 'ABSENT': out.absent++; break;
        case 'OD': out.od++; break;
        case 'LEAVE':
          out.leave++;
          var isPaid = leaveDates[d] ? true : false;
          if (isPaid) out.paid_leave++; else out.unpaid_leave++;
          break;
        case 'HOLIDAY': out.holiday++; break;
        case 'WEEKLY_OFF': out.weekly_off++; break;
        case 'MISSING_PUNCH': out.missing_punch++; break;
        default: break;
      }
      out.ot_minutes += entry.ot_minutes;
      out.late_minutes += entry.late_minutes || 0;
      if (entry.late_minutes) out.late_days++;
      if (entry.project_id) {
        if (!out.project_days[entry.project_id]) out.project_days[entry.project_id] = 0;
        if (entry.status === 'PRESENT' || entry.status === 'OD' || entry.status === 'HALF_DAY') out.project_days[entry.project_id] += entry.status === 'HALF_DAY' ? 0.5 : 1;
      }
      out.days.push(entry);
    });

    // leave split by paid/unpaid uses the leave type of each approved request
    var leaveDays = 0, unpaidLeave = 0;
    Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.employee_id) === employeeId && txt_(l.status) === 'APPROVED' && txt_(l.from_date) <= to && txt_(l.to_date) >= from;
    }).forEach(function (l) {
      var overlap = isoRange_(l.from_date > from ? l.from_date : from, l.to_date < to ? l.to_date : to);
      var paid = leaveTypes[txt_(l.leave_type_id)] !== false;
      overlap.forEach(function () { if (paid) leaveDays++; else unpaidLeave++; });
    });
    out.paid_leave = leaveDays;
    out.unpaid_leave = unpaidLeave;

    var monthDays = daysInMonth_(month);
    var payableBasis = txt_(getSetting_(ctx, 'payroll.days_basis', 'CALENDAR')).toUpperCase();
    out.days_in_month = monthDays;
    out.payable_days_basis = payableBasis;
    out.working_days = monthDays - out.weekly_off - out.holiday;
    out.payable_days = round2_(out.present + out.od + out.half_day * 0.5 + out.paid_leave + out.holiday + out.weekly_off);
    out.lop_days = round2_(out.absent + out.unpaid_leave + out.missing_punch + (out.half_day * 0.5));
    if (out.payable_days > monthDays) out.payable_days = monthDays;
    out.ot_hours = round2_(out.ot_minutes / 60);
    return out;
  }
};
