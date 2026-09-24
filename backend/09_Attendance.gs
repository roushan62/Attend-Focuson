/**
 * ============================================================================
 *  FILE: 09_Attendance.gs
 *  ROLE: The attendance engine (§5) — GPS geofence + selfie + time window +
 *        device binding validation, QR fallback, offline batch sync, flag
 *        review, regularization requests, live dashboard/map and the monthly
 *        summary calculator that feeds reports and payroll.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  DTOs                                                                      */
/* -------------------------------------------------------------------------- */

function attendanceDto_(a, ctx) {
  if (!a) return null;
  var projects = ctx && ctx.__projectMap ? ctx.__projectMap : null;
  return {
    attendanceId: a.AttendanceID, userId: a.UserID, projectId: a.ProjectID,
    projectName: projects && projects[String(a.ProjectID)] ? projects[String(a.ProjectID)].Name : '',
    date: a.Date, markedAt: a.MarkedAt || '', markedOutAt: a.MarkedOutAt || '',
    lat: num_(a.Lat, 0), lng: num_(a.Long, 0),
    outLat: num_(a.OutLat, 0), outLng: num_(a.OutLong, 0),
    distance: num_(a.DistanceFromSite, null),
    accuracy: num_(a.AccuracyMeters, null),
    selfieLink: a.SelfieDriveLink || '', selfieFileId: a.SelfieFileId || '',
    status: a.Status, lateMark: String(a.LateMark) === 'Y',
    hoursWorked: num_(a.HoursWorked, 0), overtimeHours: num_(a.OvertimeHours, 0),
    source: a.Source || 'GPS', capturedAt: a.CapturedAt || '', syncedAt: a.SyncedAt || '',
    deviceId: a.DeviceID || '', reviewedBy: a.ReviewedBy || '', reviewNote: a.ReviewNote || '',
    flagReason: a.FlagReason || '', weatherFlag: a.WeatherFlag || '', createdAt: a.CreatedAt || ''
  };
}

function projectMap_(ss) {
  return memo_('pmap:' + ss.getId(), function () {
    return indexBy_(readTable_(ss, 'Projects'), 'ProjectID');
  });
}

function userMap_(ss) {
  return memo_('umap:' + ss.getId(), function () {
    return indexBy_(readTable_(ss, 'Users'), 'UserID');
  });
}

/* -------------------------------------------------------------------------- */
/*  Validation core                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Decide the status of a mark. Everything the spec requires is checked here:
 * time window, geofence (Haversine), GPS accuracy and holiday/week-off context.
 */
function evaluateMark_(opts) {
  var project = opts.project;
  var settings = opts.settings;
  var tz = settings.timezone || platformTimezone_();
  var when = toDate_(opts.when);
  var lat = num_(opts.lat, 0);
  var lng = num_(opts.lng, 0);
  var radius = num_(project.GeofenceRadius, num_(settings.defaultGeofenceRadius, 200));
  if (opts.source === 'QR') radius = Math.max(radius, num_(settings.qrFallbackRadius, 1000));

  var distance = (lat || lng) ? haversineMeters(lat, lng, num_(project.Lat, 0), num_(project.Long, 0)) : null;
  var inside = distance === null ? false : distance <= radius;

  var mins = minutesOfDay_(when, tz);
  var winStart = timeToMinutes_(project.WindowStart || settings.attendanceWindowStart);
  var winEnd = timeToMinutes_(project.WindowEnd || settings.attendanceWindowEnd);
  var grace = num_(settings.lateGraceMinutes, 15);

  var reasons = [];
  if (distance === null) reasons.push('No GPS coordinates were supplied');
  else if (!inside) reasons.push('Outside the site geofence — ' + distance + ' m from the site (limit ' + radius + ' m)');
  if (winStart >= 0 && mins < winStart) reasons.push('Marked before the window opens at ' + hhmm_(winStart));
  var late = false;
  if (winEnd >= 0 && mins > winEnd) {
    if (mins <= winEnd + grace) late = true;
    else reasons.push('Marked after the window closed at ' + hhmm_(winEnd) + ' (grace ' + grace + ' min)');
  }
  var accuracy = num_(opts.accuracy, 0);
  if (accuracy && accuracy > num_(settings.maxGpsAccuracy, 500)) {
    reasons.push('GPS accuracy too poor (±' + Math.round(accuracy) + ' m)');
  }
  if (opts.source !== 'QR' && opts.requireSelfie && !opts.hasSelfie) {
    reasons.push('A live selfie is required');
  }

  var holiday = isHolidayFor_(opts.holidays, fmtDate_(when, tz), project.ProjectID);
  var weekOff = isWeekOffFor_(opts.user, settings, when);

  // Lateness is a marker on a Present day (LateMark), never a separate status.
  var status = reasons.length ? 'Flagged' : 'Present';
  return {
    status: status,
    lateMark: late,
    distance: distance,
    insideGeofence: inside,
    insideWindow: reasons.length === 0,
    flagReason: reasons.join('; '),
    holiday: holiday,
    weekOff: weekOff,
    radius: radius,
    timeMinutes: mins
  };
}

function hhmm_(minutes) {
  var h = Math.floor(minutes / 60), m = minutes % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

function isHolidayFor_(holidays, dateStr, projectId) {
  for (var i = 0; i < (holidays || []).length; i++) {
    var h = holidays[i];
    if (String(h.Date) !== dateStr) continue;
    var applicable = String(h.ApplicableProjects || 'All');
    if (!applicable || applicable === 'All' || applicable === 'ALL') return h;
    if (applicable.split(',').indexOf(String(projectId)) >= 0) return h;
  }
  return null;
}

function isWeekOffFor_(user, settings, when) {
  var weekly = String((user && user.WeeklyOff) || settings.weeklyOff || '0');
  if (!weekly) return false;
  var day = when.getUTCDay();
  // weekly can be "0" or "0,6"
  return weekly.split(',').indexOf(String(day)) >= 0;
}

/** Working-day test used by the auto-absent job and summaries. */
function isWorkingDay_(settings, dateStr, holidays, projectId, user) {
  var d = weekdayOf_(dateStr);
  var working = String(settings.workingDays || '1,2,3,4,5,6').split(',');
  if (working.indexOf(String(d)) < 0) return false;
  if (isWeekOffFor_(user, settings, toDate_(dateStr))) return false;
  if (isHolidayFor_(holidays, dateStr, projectId)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Mark IN                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * actionMarkAttendance — the core write path (§12.3).
 * Also accepts `payload.batch` for offline-first sync (§9.2): each entry is
 * validated against its CAPTURED timestamp, not the sync time.
 */
function actionMarkAttendance(payload, ctx) {
  var ss = ctx.ss;

  if (payload.batch && Object.prototype.toString.call(payload.batch) === '[object Array]') {
    var batch = payload.batch.slice(0, 20);
    var results = batch.map(function (entry) {
      try {
        var single = {};
        for (var k in entry) single[k] = entry[k];
        single.__batch = true;
        var r = markAttendanceInternal_(single, ctx);
        return { ok: true, capturedAt: entry.capturedAt || '', result: r };
      } catch (err) {
        return { ok: false, capturedAt: entry.capturedAt || '', error: err.message, code: err.code || 400 };
      }
    });
    audit_(ss, ctx, 'ATTENDANCE_BATCH_SYNC', 'Attendance', ctx.userId,
      { entries: batch.length, ok: results.filter(function (r) { return r.ok; }).length }, 'OK');
    return { batch: true, processed: results.length, results: results };
  }
  return markAttendanceInternal_(payload, ctx);
}

function markAttendanceInternal_(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();

  var user = findRecord_(ss, 'Users', 'UserID', ctx.userId);
  assert_(user, 'User not found', 404);

  // ---- resolve project ---------------------------------------------------
  var project = resolveMarkProject_(ss, ctx, payload);
  assert_(project, 'You are not assigned to any active project. Ask your administrator to assign you.', 400);
  assertProjectScope_(ctx, project.ProjectID);
  if (String(project.Status) === 'Completed') {
    throw new ApiError_('Project ' + project.Name + ' is completed and no longer accepts attendance', 400);
  }

  // ---- timestamps --------------------------------------------------------
  var capturedAt = isBlank_(payload.capturedAt) ? new Date() : toDate_(payload.capturedAt);
  var syncedNow = new Date();
  var driftMs = syncedNow.getTime() - capturedAt.getTime();
  assert_(driftMs > -5 * 60 * 1000, 'The captured time is in the future — check your device clock', 400);
  var maxAge = num_(settings.offlineMaxAgeHours, 26) * 3600 * 1000;
  assert_(driftMs < maxAge, 'This entry is older than ' + Math.round(maxAge / 3600000) +
    ' hours and can no longer be synced. Ask your administrator to regularize it.', 400);
  var dateStr = fmtDate_(capturedAt, tz);
  var isOffline = String(payload.source || '').toLowerCase() === 'offline' || driftMs > 2 * 60 * 1000;

  // ---- coordinates -------------------------------------------------------
  var lat = num_(payload.lat, 0);
  var lng = num_(payload.lng !== undefined ? payload.lng : payload.long, 0);
  var accuracy = num_(payload.accuracy, 0);
  assert_(latOk_(lat) && lngOk_(lng) && (lat !== 0 || lng !== 0),
    'Valid GPS coordinates are required to mark attendance', 400);
  assert_(!(lat === 0 && lng === 0), 'GPS returned 0,0 — move to an open area and retry, or use the QR fallback', 400);

  // ---- device binding (§9.1) --------------------------------------------
  var device = checkDevice_(ss, user, payload.deviceFingerprint || ctx.meta.deviceFingerprint, ctx.meta);
  if (!device.ok) {
    audit_(ss, ctx, 'ATTENDANCE_BLOCKED_DEVICE', 'Attendance', ctx.userId,
      { reason: device.reason, project: project.ProjectID }, 'DENIED');
    throw new ApiError_(device.reason, 403);
  }

  // ---- selfie ------------------------------------------------------------
  var requireSelfie = String(settings.requireSelfie || 'Y').toUpperCase() === 'Y';
  var selfieBase64 = str_(payload.selfieBase64 || payload.selfie || '', 0);
  if (requireSelfie && !selfieBase64.length) {
    throw new ApiError_('A live selfie is required to mark attendance', 400);
  }
  var maxBytes = num_(prop_(PROP.SELFIE_MAX_BYTES, ''), 4000000);
  assert_(selfieBase64.length <= maxBytes,
    'The selfie is too large (' + Math.round(selfieBase64.length / 1024) + ' KB). Retake it in better light.', 413);

  // ---- duplicate guard ---------------------------------------------------
  var existing = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === String(user.UserID) && String(a.Date) === dateStr &&
      String(a.ProjectID) === String(project.ProjectID);
  });
  if (existing.length && !payload.force) {
    var first = existing[0];
    return {
      alreadyMarked: true,
      message: 'You have already marked attendance at ' + project.Name + ' today.',
      attendance: attendanceDto_(first, ctx),
      project: { projectId: project.ProjectID, projectName: project.Name }
    };
  }

  // ---- evaluate ----------------------------------------------------------
  var holidays = readTable_(ss, 'Holidays');
  var evaluation = evaluateMark_({
    project: project, settings: settings, lat: lat, lng: lng, accuracy: accuracy,
    when: capturedAt, source: payload.source || 'GPS', hasSelfie: !!selfieBase64.length,
    requireSelfie: requireSelfie, holidays: holidays, user: user
  });

  var selfieLink = '';
  var selfieFileId = '';
  if (selfieBase64.length) {
    var stored = storeSelfie_(ctx.company, ctx.userId, project.ProjectID, capturedAt, selfieBase64,
      str_(payload.selfieMime, 'image/jpeg'));
    selfieLink = stored.link;
    selfieFileId = stored.fileId;
  }

  var status = evaluation.status;
  if (status === 'Present' && evaluation.holiday) {
    // Physically present on a declared holiday — allowed, but recorded for audit.
    evaluation.flagReason = (evaluation.flagReason ? evaluation.flagReason + '; ' : '') +
      'Marked on declared holiday: ' + (evaluation.holiday.Name || '');
  }

  var row = {
    AttendanceID: id_('ATT'),
    UserID: user.UserID,
    ProjectID: project.ProjectID,
    Date: dateStr,
    MarkedAt: fmtDateTime_(capturedAt, tz),
    Lat: String(lat),
    Long: String(lng),
    DistanceFromSite: evaluation.distance === null ? '' : String(evaluation.distance),
    SelfieDriveLink: selfieLink,
    SelfieFileId: selfieFileId,
    Status: status,
    DeviceID: device.deviceId || user.DeviceID || '',
    ReviewedBy: '',
    ReviewNote: '',
    MarkedOutAt: '',
    LateMark: evaluation.lateMark ? 'Y' : 'N',
    Source: isOffline ? 'Offline' : (String(payload.source || 'GPS').toUpperCase() === 'QR' ? 'QR' : 'GPS'),
    CapturedAt: iso_(capturedAt, tz),
    SyncedAt: iso_(syncedNow, tz),
    FlagReason: truncate_(evaluation.flagReason, 400),
    WeatherFlag: '',
    AccuracyMeters: accuracy ? String(Math.round(accuracy)) : '',
    CreatedAt: fmtDateTime_(new Date())
  };
  appendRecord_(ss, 'Attendance', row);

  audit_(ss, ctx, status === 'Present' ? 'ATTENDANCE_MARKED' : 'ATTENDANCE_FLAGGED', 'Attendance',
    row.AttendanceID, {
      project: project.Name, status: status, distance: evaluation.distance,
      radius: evaluation.radius, lat: lat, lng: lng, offline: isOffline,
      late: evaluation.lateMark, reason: truncate_(evaluation.flagReason, 200)
    }, status === 'Present' ? 'OK' : 'FLAGGED');

  if (status === 'Flagged') {
    var msg = row.FlagReason || 'Attendance needs manual approval';
    notify_(ss, user.UserID, 'Attendance flagged for review',
      'Your mark at ' + project.Name + ' was flagged: ' + truncate_(msg, 200) +
      '. It has been sent to your administrator for manual approval.', 'Flagged', 'High');
    if (String(settings.notifyOnFlagged || 'Y').toUpperCase() === 'Y') {
      notifyAdmins_(ss, ctx, 'Flagged attendance — ' + user.Name,
        user.Name + ' (' + user.UserID + ') marked at ' + project.Name + ' on ' + dateStr +
        '.\nReason: ' + truncate_(msg, 300) + '\nDistance: ' +
        (evaluation.distance === null ? 'n/a' : evaluation.distance + ' m') +
        '\nTime: ' + row.MarkedAt + '\n\nReview it in the Approvals Centre.', 'Flagged', 'High');
    }
  }

  return {
    alreadyMarked: false,
    status: status,
    late: evaluation.lateMark,
    distance: evaluation.distance,
    radius: evaluation.radius,
    insideGeofence: evaluation.insideGeofence,
    flagReason: evaluation.flagReason,
    message: status === 'Present'
      ? (evaluation.lateMark
        ? 'Attendance marked (late). You were ' + evaluation.distance + ' m from the site.'
        : 'Attendance marked. You are ' + evaluation.distance + ' m from the site centre.')
      : 'Outside allowed range — your request has been sent for manual approval.',
    synced: !isOffline,
    selfieStored: !!selfieLink,
    attendance: attendanceDto_(row, ctx),
    project: { projectId: project.ProjectID, projectName: project.Name, projectCode: project.ProjectCode }
  };
}

/**
 * Pick the project a mark belongs to: explicit projectId, else the user's only
 * active assignment, else the assignment whose site is nearest to the GPS point.
 */
function resolveMarkProject_(ss, ctx, payload) {
  var pmap = projectMap_(ss);
  var requested = str_(payload.projectId, 40);
  if (requested) {
    var p = pmap[requested];
    assert_(p, 'Project not found: ' + requested, 404);
    return p;
  }
  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', ctx.userId)
    .filter(function (a) { return String(a.Status) === 'Active'; });
  var candidates = assignments.map(function (a) { return pmap[String(a.ProjectID)]; })
    .filter(function (p) { return p && String(p.Status) !== 'Completed'; });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  var lat = num_(payload.lat, 0), lng = num_(payload.lng !== undefined ? payload.lng : payload.long, 0);
  if (!lat && !lng) return candidates[0];
  var best = null, bestD = Infinity;
  candidates.forEach(function (p) {
    var d = haversineMeters(lat, lng, num_(p.Lat, 0), num_(p.Long, 0));
    var radius = num_(p.GeofenceRadius, num_(ctx.settings.defaultGeofenceRadius, 200));
    var score = d / Math.max(radius, 1);
    if (d < bestD) { bestD = d; best = p; best.__score = score; }
  });
  return best;
}

/* -------------------------------------------------------------------------- */
/*  Mark OUT                                                                  */
/* -------------------------------------------------------------------------- */

function actionMarkOut(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var capturedAt = isBlank_(payload.capturedAt) ? new Date() : toDate_(payload.capturedAt);
  var dateStr = fmtDate_(capturedAt, tz);

  var today = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === ctx.userId && String(a.Date) === dateStr;
  });
  assert_(today.length, 'You have not marked attendance in today. Mark IN first.', 400);
  var row = sortBy_(today, function (a) { return String(a.MarkedAt); }, true)[0];

  var project = projectMap_(ss)[String(row.ProjectID)] || {};
  var lat = num_(payload.lat, num_(row.Lat, 0));
  var lng = num_(payload.lng !== undefined ? payload.lng : payload.long, num_(row.Long, 0));
  var distance = (lat || lng) ? haversineMeters(lat, lng, num_(project.Lat, 0), num_(project.Long, 0)) : null;

  var inMinutes = row.MarkedAt ? minutesOfDay_(toDate_(row.MarkedAt), tz) : 0;
  var outMinutes = minutesOfDay_(capturedAt, tz);
  var hours = Math.max(0, (outMinutes - inMinutes) / 60);
  if (hours > 24) hours = 0; // clock anomaly → let an admin correct it

  var breakMinutes = num_(settings.breakMinutes, 0);
  var payable = Math.max(0, hours - (hours > 4 ? breakMinutes / 60 : 0));
  var otThreshold = num_(project.OvertimeAfterHours || settings.overtimeAfterHours, 9);
  var overtime = Math.max(0, Math.round((payable - otThreshold) * 2) / 2);

  var halfDayHours = num_(settings.halfDayHours, 4);
  var status = String(row.Status);
  if (status === 'Present' && payable > 0 && payable < halfDayHours) status = 'HalfDay';

  var updated = updateRecord_(ss, 'Attendance', 'AttendanceID', row.AttendanceID, {
    MarkedOutAt: fmtDateTime_(capturedAt, tz),
    OutLat: String(lat),
    OutLong: String(lng),
    HoursWorked: String(Math.round(payable * 100) / 100),
    OvertimeHours: String(overtime),
    Status: status
  });

  audit_(ss, ctx, 'ATTENDANCE_MARK_OUT', 'Attendance', row.AttendanceID,
    { hours: payable, overtime: overtime, distance: distance, project: project.Name }, 'OK');

  return {
    markedOut: true,
    status: status,
    hoursWorked: num_(updated ? updated.HoursWorked : payable, 0),
    overtimeHours: overtime,
    distanceFromSite: distance,
    message: 'Checked out after ' + (Math.round(payable * 10) / 10) + ' hours' +
      (overtime > 0 ? ' (including ' + overtime + ' h overtime)' : '') + '.',
    attendance: attendanceDto_(updated || row, ctx)
  };
}

/* -------------------------------------------------------------------------- */
/*  QR fallback (§9.3)                                                        */
/* -------------------------------------------------------------------------- */

function actionQrCheckin(payload, ctx) {
  requireFields_(payload, ['qrPayload']);
  var ss = ctx.ss;
  var settings = ctx.settings;
  assert_(String(settings.allowQrFallback || 'Y').toUpperCase() === 'Y',
    'QR fallback check-in is disabled for this company', 403);

  var parts = String(payload.qrPayload).split('|');
  assert_(parts.length >= 3 && parts[0] === 'SITETRACK', 'This is not a valid SiteTrack site QR code', 400);
  assert_(parts[1] === ctx.companyId, 'This QR code belongs to a different company', 403);
  var project = findRecord_(ss, 'Projects', 'ProjectID', parts[2]);
  assert_(project, 'The project on this QR code no longer exists', 404);
  assertProjectScope_(ctx, project.ProjectID);
  if (parts[3] && String(project.QrCode).split('|')[3] !== parts[3]) {
    throw new ApiError_('This QR code has been re-generated and is no longer valid. Ask the site office for the current one.', 400);
  }

  // A selfie is still mandatory for QR check-ins.
  var selfieBase64 = str_(payload.selfieBase64 || payload.selfie || '', 0);
  assert_(selfieBase64.length > 0, 'A live selfie is required even for QR check-in', 400);

  var merged = {};
  for (var k in payload) merged[k] = payload[k];
  merged.projectId = project.ProjectID;
  merged.source = 'QR';
  // Use the site centre so the geofence test passes, but keep the device GPS for audit.
  if (!num_(merged.lat, 0)) merged.lat = num_(project.Lat, 0);
  if (!num_(merged.lng, 0)) merged.lng = num_(project.Long, 0);
  merged.accuracy = num_(merged.accuracy, 0);

  var result = markAttendanceInternal_(merged, ctx);
  if (result.attendance) result.attendance.source = 'QR';
  result.viaQr = true;
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

function actionMyAttendanceToday(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var dateStr = isIsoDate_(payload.date) ? payload.date : today_(tz);

  var marks = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === ctx.userId && String(a.Date) === dateStr;
  });
  var pmap = projectMap_(ss);
  var assignments = findRecords_(ss, 'ProjectAssignments', 'UserID', ctx.userId)
    .filter(function (a) { return String(a.Status) === 'Active'; });

  var projects = assignments.map(function (a) {
    var p = pmap[String(a.ProjectID)];
    if (!p) return null;
    var mark = null;
    marks.forEach(function (m) { if (String(m.ProjectID) === String(p.ProjectID)) mark = m; });
    return {
      project: projectDto_(p, ctx, settings),
      roleOnSite: a.RoleOnSite,
      mark: mark ? attendanceDto_(mark, ctx) : null,
      marked: !!mark
    };
  }).filter(function (x) { return x; });

  var holidays = readTable_(ss, 'Holidays');
  var holiday = isHolidayFor_(holidays, dateStr, projects.length ? projects[0].project.projectId : '');
  var weekOff = isWeekOffFor_(ctx.user, settings, toDate_(dateStr));

  return {
    date: dateStr,
    serverTime: iso_(new Date(), tz),
    timezone: tz,
    marks: marks.map(function (m) { return attendanceDto_(m, ctx); }),
    projects: projects,
    holiday: holiday ? { date: holiday.Date, name: holiday.Name } : null,
    weekOff: weekOff,
    settings: {
      requireSelfie: bool_(settings.requireSelfie, true),
      allowQrFallback: bool_(settings.allowQrFallback, true),
      windowStart: settings.attendanceWindowStart,
      windowEnd: settings.attendanceWindowEnd,
      lateGraceMinutes: num_(settings.lateGraceMinutes, 15)
    }
  };
}

function actionListAttendance(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var ctxLocal = ctx;
  ctxLocal.__projectMap = projectMap_(ss);

  var rows = readTable_(ss, 'Attendance');
  var isEmployee = String(ctx.role) === ROLES.EMPLOYEE;

  if (isEmployee) {
    rows = rows.filter(function (a) { return String(a.UserID) === ctx.userId; });
  } else {
    rows = scopedRows_(ctx, rows, 'ProjectID');
    if (!can_(ctx, 'viewAllEmployees') && !scopeIsAll_(ctx)) {
      // already scope-filtered above; additionally limit to own id when no view-all right
    }
  }

  var from = isIsoDate_(payload.from) ? payload.from : '';
  var to = isIsoDate_(payload.to) ? payload.to : '';
  if (!from && !to) { from = shiftDate_(today_(tz), -29); to = today_(tz); }
  if (from) rows = rows.filter(function (a) { return String(a.Date) >= from; });
  if (to) rows = rows.filter(function (a) { return String(a.Date) <= to; });
  if (payload.projectId) rows = rows.filter(function (a) { return String(a.ProjectID) === String(payload.projectId); });
  if (payload.userId) {
    if (isEmployee && String(payload.userId) !== ctx.userId) throw new ApiError_('Not permitted', 403);
    rows = rows.filter(function (a) { return String(a.UserID) === String(payload.userId); });
  }
  if (payload.status) {
    var statuses = String(payload.status).split(',');
    rows = rows.filter(function (a) { return statuses.indexOf(String(a.Status)) >= 0; });
  }
  if (payload.source) rows = rows.filter(function (a) { return String(a.Source) === String(payload.source); });
  if (String(payload.flaggedOnly || '').toLowerCase() === 'true') {
    rows = rows.filter(function (a) { return String(a.Status) === 'Flagged'; });
  }

  rows = sortBy_(rows, function (a) { return String(a.Date) + String(a.MarkedAt); }, true);

  var limit = Math.min(Math.max(num_(payload.limit, 300), 1), 2000);
  var page = Math.max(num_(payload.page, 1), 1);
  var slice = rows.slice((page - 1) * limit, page * limit);
  var umap = userMap_(ss);

  return {
    count: rows.length,
    page: page,
    pageSize: limit,
    from: from,
    to: to,
    attendance: slice.map(function (a) {
      var dto = attendanceDto_(a, ctxLocal);
      var u = umap[String(a.UserID)] || {};
      dto.userName = u.Name || '';
      dto.userRole = u.Role || '';
      dto.designation = u.Designation || '';
      dto.mobile = u.MobileNumber || '';
      return dto;
    })
  };
}

function shiftDate_(dateStr, days) {
  var d = new Date(toDate_(dateStr).getTime() + days * 86400000);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/* -------------------------------------------------------------------------- */
/*  Review / manual marking                                                   */
/* -------------------------------------------------------------------------- */

function actionReviewAttendance(payload, ctx) {
  requireFields_(payload, ['attendanceId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Attendance', 'AttendanceID', payload.attendanceId);
  assert_(row, 'Attendance record not found', 404);
  assertProjectScope_(ctx, row.ProjectID);

  var decision = String(payload.decision).toLowerCase();
  var patch = { ReviewedBy: ctx.userId, ReviewNote: str_(payload.note, 300) };
  var newStatus = '';

  if (decision === 'approve') {
    newStatus = pickOne_(payload.status, ['Present', 'HalfDay', 'Late', 'Travel', 'Leave'], 'Present');
    patch.Status = newStatus;
    patch.FlagReason = '';
  } else if (decision === 'reject') {
    newStatus = pickOne_(payload.status, ['Absent', 'Flagged'], 'Absent');
    patch.Status = newStatus;
  } else if (decision === 'change') {
    newStatus = pickOne_(payload.status, ATT_STATUS, '');
    assert_(newStatus, 'Provide a valid target status', 400);
    patch.Status = newStatus;
  } else {
    throw new ApiError_('Decision must be approve, reject or change', 400);
  }
  if (payload.lateMark !== undefined) patch.LateMark = yn_(payload.lateMark, false);
  if (payload.hoursWorked !== undefined) patch.HoursWorked = String(num_(payload.hoursWorked, 0));
  if (payload.overtimeHours !== undefined) patch.OvertimeHours = String(num_(payload.overtimeHours, 0));
  if (!patch.ReviewNote) patch.ReviewNote = 'Reviewed by ' + ctx.userName + ' (' + decision + ')';

  var updated = updateRecord_(ss, 'Attendance', 'AttendanceID', row.AttendanceID, patch);
  audit_(ss, ctx, 'REVIEW_ATTENDANCE', 'Attendance', row.AttendanceID,
    { from: row.Status, to: newStatus, decision: decision, note: patch.ReviewNote }, 'OK');
  notify_(ss, row.UserID, 'Attendance ' + (decision === 'reject' ? 'rejected' : 'approved'),
    'Your attendance on ' + row.Date + ' at project ' + row.ProjectID + ' is now "' + newStatus + '".' +
    (patch.ReviewNote ? ' Note: ' + patch.ReviewNote : ''), decision === 'reject' ? 'Alert' : 'Approval');

  return { attendanceId: row.AttendanceID, status: newStatus, decision: decision,
    attendance: attendanceDto_(updated || row, ctx) };
}

function actionManualMark(payload, ctx) {
  requireFields_(payload, ['userId', 'projectId', 'date', 'status']);
  var ss = ctx.ss;
  var settings = ctx.settings;
  assertProjectScope_(ctx, payload.projectId);
  assert_(isIsoDate_(payload.date), 'date must be yyyy-mm-dd', 400);
  var status = pickOne_(payload.status, ATT_STATUS, '');
  assert_(status, 'Invalid status', 400);
  var user = findRecord_(ss, 'Users', 'UserID', payload.userId);
  assert_(user, 'User not found', 404);
  var project = findRecord_(ss, 'Projects', 'ProjectID', payload.projectId);
  assert_(project, 'Project not found', 404);

  var existing = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === String(user.UserID) && String(a.Date) === String(payload.date) &&
      String(a.ProjectID) === String(project.ProjectID);
  });
  if (existing.length && !payload.overwrite) {
    throw new ApiError_('A record already exists for that day (status ' + existing[0].Status +
      '). Pass overwrite=true to replace it.', 409);
  }

  var row = {
    AttendanceID: existing.length ? existing[0].AttendanceID : id_('ATT'),
    UserID: user.UserID,
    ProjectID: project.ProjectID,
    Date: payload.date,
    MarkedAt: str_(payload.markedAt, 30) || fmtDateTime_(toDate_(payload.date + 'T09:00:00'), settings.timezone),
    Lat: String(num_(payload.lat, num_(project.Lat, 0))),
    Long: String(num_(payload.lng !== undefined ? payload.lng : payload.long, num_(project.Long, 0))),
    DistanceFromSite: '0',
    SelfieDriveLink: '',
    Status: status,
    DeviceID: '',
    ReviewedBy: ctx.userId,
    ReviewNote: str_(payload.note, 300) || ('Manually marked by ' + ctx.userName),
    LateMark: yn_(payload.lateMark, false),
    Source: 'Manual',
    CapturedAt: iso_(toDate_(payload.date + 'T09:00:00'), settings.timezone),
    SyncedAt: iso_(new Date(), settings.timezone),
    HoursWorked: String(num_(payload.hoursWorked, status === 'Present' ? num_(settings.standardHours, 8) : 0)),
    OvertimeHours: String(num_(payload.overtimeHours, 0)),
    CreatedAt: fmtDateTime_(new Date())
  };
  if (existing.length) {
    updateRecord_(ss, 'Attendance', 'AttendanceID', existing[0].AttendanceID, row);
  } else {
    appendRecord_(ss, 'Attendance', row);
  }
  audit_(ss, ctx, 'MANUAL_MARK', 'Attendance', row.AttendanceID,
    { user: user.Name, project: project.Name, date: row.Date, status: status }, 'OK');
  notify_(ss, user.UserID, 'Attendance updated by admin',
    'Your attendance for ' + row.Date + ' was set to "' + status + '" by ' + ctx.userName + '.', 'Info');
  return { attendanceId: row.AttendanceID, status: status, overwritten: !!existing.length };
}

/* -------------------------------------------------------------------------- */
/*  Regularization requests (§9.4)                                            */
/* -------------------------------------------------------------------------- */

function actionRequestRegularization(payload, ctx) {
  requireFields_(payload, ['date', 'requestedStatus', 'reason']);
  var ss = ctx.ss;
  assert_(isIsoDate_(payload.date), 'date must be yyyy-mm-dd', 400);
  assert_(payload.date <= today_(ctx.tz), 'You cannot regularize a future date', 400);
  assert_(payload.date >= shiftDate_(today_(ctx.tz), -62), 'Regularization is allowed only for the last 62 days', 400);
  var status = pickOne_(payload.requestedStatus, ATT_STATUS, '');
  assert_(status, 'Invalid requested status', 400);
  assert_(str_(payload.reason, 500).length >= 5, 'Please explain why this correction is needed', 400);

  var projectId = str_(payload.projectId, 40);
  if (!projectId) {
    var project = resolveMarkProject_(ss, ctx, {});
    projectId = project ? String(project.ProjectID) : '';
  }
  if (projectId) assertProjectScope_(ctx, projectId);

  var existingPending = readTable_(ss, 'RegularizationRequests').filter(function (r) {
    return String(r.UserID) === ctx.userId && String(r.Date) === payload.date && String(r.Status) === 'Pending';
  });
  assert_(!existingPending.length, 'A regularization request for that date is already pending', 409);

  var original = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === ctx.userId && String(a.Date) === payload.date;
  })[0] || null;

  var proofLink = '', proofFileId = '';
  if (!isBlank_(payload.proofBase64)) {
    var stored = storeCompanyUpload_(ctx.company, 'Documents', 'reg-' + ctx.userId + '-' + payload.date,
      String(payload.proofBase64), str_(payload.proofMime, 'image/jpeg'));
    proofLink = stored.link;
    proofFileId = stored.fileId;
  }

  var row = {
    RequestID: id_('REG'),
    UserID: ctx.userId,
    ProjectID: projectId,
    Date: payload.date,
    RequestedStatus: status,
    Reason: str_(payload.reason, 500),
    ProofLink: proofLink,
    ProofFileId: proofFileId,
    Status: 'Pending',
    AppliedAt: fmtDateTime_(new Date()),
    InTime: str_(payload.inTime, 20),
    OutTime: str_(payload.outTime, 20),
    OriginalAttendanceID: original ? original.AttendanceID : ''
  };
  appendRecord_(ss, 'RegularizationRequests', row);
  audit_(ss, ctx, 'REGULARIZATION_REQUESTED', 'RegularizationRequests', row.RequestID,
    { date: payload.date, status: status }, 'PENDING');
  notifyAdmins_(ss, ctx, 'Attendance regularization request',
    ctx.userName + ' requested to change ' + payload.date + ' to "' + status + '".\nReason: ' +
    row.Reason + '\n\nReview it in the Approvals Centre.', 'Approval');
  return { requestId: row.RequestID, status: 'Pending', message: 'Request submitted for admin approval.' };
}

function actionListRegularizations(payload, ctx) {
  var ss = ctx.ss;
  var staff = isStaffRole_(ctx.role);
  var rows = scopedRows_(ctx, readTable_(ss, 'RegularizationRequests'), 'ProjectID');
  if (!staff) {
    // A worker may follow their own requests — never the company queue.
    rows = readTable_(ss, 'RegularizationRequests').filter(function (r) {
      return String(r.UserID) === String(ctx.userId);
    });
  }
  // Staff default to the pending queue; a worker wants the whole history.
  var status = str_(payload.status, 20) || (staff ? 'Pending' : 'All');
  if (status !== 'All') rows = rows.filter(function (r) { return String(r.Status) === status; });
  rows = sortBy_(rows, function (r) { return String(r.AppliedAt); }, true);
  var umap = userMap_(ss);
  var pmap = projectMap_(ss);
  return {
    count: rows.length,
    requests: rows.map(function (r) {
      var u = umap[String(r.UserID)] || {};
      var p = pmap[String(r.ProjectID)] || {};
      return {
        requestId: r.RequestID, userId: r.UserID, userName: u.Name || '', mobile: u.MobileNumber || '',
        projectId: r.ProjectID, projectName: p.Name || '', date: r.Date,
        requestedStatus: r.RequestedStatus, reason: r.Reason, proofLink: r.ProofLink || '',
        proofFileId: r.ProofFileId || '', status: r.Status, appliedAt: r.AppliedAt,
        reviewedAt: r.ReviewedAt || '', reviewedBy: r.ApprovedBy || '', reviewNote: r.ReviewNote || '',
        inTime: r.InTime || '', outTime: r.OutTime || ''
      };
    })
  };
}

function actionDecideRegularization(payload, ctx) {
  requireFields_(payload, ['requestId', 'decision']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'RegularizationRequests', 'RequestID', payload.requestId);
  assert_(row, 'Request not found', 404);
  assertProjectScope_(ctx, row.ProjectID);
  assert_(String(row.Status) === 'Pending', 'This request was already ' + String(row.Status).toLowerCase(), 409);
  var approve = String(payload.decision).toLowerCase() === 'approve';

  updateRecord_(ss, 'RegularizationRequests', 'RequestID', row.RequestID, {
    Status: approve ? 'Approved' : 'Rejected',
    ApprovedBy: ctx.userId,
    ReviewedAt: fmtDateTime_(new Date()),
    ReviewNote: str_(payload.note, 300)
  });

  var attendanceId = row.OriginalAttendanceID || '';
  if (approve) {
    if (attendanceId) {
      updateRecord_(ss, 'Attendance', 'AttendanceID', attendanceId, {
        Status: row.RequestedStatus,
        ReviewedBy: ctx.userId,
        ReviewNote: 'Regularized: ' + truncate_(row.Reason, 200),
        FlagReason: '',
        MarkedOutAt: row.OutTime ? fmtDateTime_(toDate_(row.Date + 'T' + row.OutTime), ctx.tz) : undefined,
        HoursWorked: payload.hoursWorked !== undefined ? String(num_(payload.hoursWorked, 0)) : undefined
      });
    } else {
      var manual = actionManualMark({
        userId: row.UserID, projectId: row.ProjectID, date: row.Date,
        status: row.RequestedStatus, note: 'Regularized: ' + truncate_(row.Reason, 200),
        inTime: row.InTime, outTime: row.OutTime
      }, ctx);
      attendanceId = manual.attendanceId;
    }
  }
  audit_(ss, ctx, approve ? 'REGULARIZATION_APPROVED' : 'REGULARIZATION_REJECTED',
    'RegularizationRequests', row.RequestID, { date: row.Date, status: row.RequestedStatus }, 'OK');
  notify_(ss, row.UserID, approve ? 'Regularization approved' : 'Regularization rejected',
    'Your correction request for ' + row.Date + ' was ' + (approve ? 'approved' : 'rejected') +
    (payload.note ? '. Note: ' + str_(payload.note, 200) : ''), approve ? 'Approval' : 'Alert');
  return { requestId: row.RequestID, decision: approve ? 'Approved' : 'Rejected', attendanceId: attendanceId };
}

/* -------------------------------------------------------------------------- */
/*  Dashboard / live map (§9.5)                                               */
/* -------------------------------------------------------------------------- */

function actionTodayDashboard(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var dateStr = isIsoDate_(payload.date) ? payload.date : today_(tz);
  var pmap = projectMap_(ss);
  var umap = userMap_(ss);

  var projects = scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID')
    .filter(function (p) { return String(p.Status) !== 'Completed'; });
  var projectIds = {};
  projects.forEach(function (p) { projectIds[String(p.ProjectID)] = true; });

  var assignments = readTable_(ss, 'ProjectAssignments').filter(function (a) {
    return String(a.Status) === 'Active' && projectIds[String(a.ProjectID)];
  });
  var marks = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.Date) === dateStr && projectIds[String(a.ProjectID)];
  });

  var byProject = {};
  var byUser = {};
  marks.forEach(function (m) {
    byUser[String(m.UserID) + '|' + String(m.ProjectID)] = m;
    if (!byProject[String(m.ProjectID)]) byProject[String(m.ProjectID)] = [];
    byProject[String(m.ProjectID)].push(m);
  });

  var totals = {
    expected: 0, present: 0, late: 0, halfDay: 0, absent: 0, leave: 0,
    flagged: 0, travel: 0, holiday: 0, weekOff: 0, notMarked: 0
  };
  var projectRows = projects.map(function (p) {
    var team = assignments.filter(function (a) { return String(a.ProjectID) === String(p.ProjectID); });
    var counts = { present: 0, late: 0, halfDay: 0, leave: 0, flagged: 0, travel: 0, absent: 0, notMarked: 0 };
    var people = team.map(function (a) {
      var m = byUser[String(a.UserID) + '|' + String(p.ProjectID)];
      var u = umap[String(a.UserID)] || {};
      var status = m ? String(m.Status) : 'NotMarked';
      if (status === 'Present') counts.present++;
      else if (status === 'Late') { counts.late++; }
      else if (status === 'HalfDay') counts.halfDay++;
      else if (status === 'Leave') counts.leave++;
      else if (status === 'Flagged') counts.flagged++;
      else if (status === 'Travel' || status === 'Transfer') counts.travel++;
      else if (status === 'Holiday' || status === 'WeekOff') { }
      else counts.notMarked++;
      return {
        userId: a.UserID, name: u.Name || '', roleOnSite: a.RoleOnSite || '',
        mobile: u.MobileNumber || '', status: status,
        markedAt: m ? m.MarkedAt || '' : '', markedOutAt: m ? m.MarkedOutAt || '' : '',
        distance: m ? num_(m.DistanceFromSite, null) : null,
        lateMark: m ? String(m.LateMark) === 'Y' : false,
        attendanceId: m ? m.AttendanceID : '', selfieFileId: m ? m.SelfieFileId || '' : ''
      };
    });
    totals.expected += team.length;
    totals.present += counts.present;
    totals.late += counts.late;
    totals.halfDay += counts.halfDay;
    totals.leave += counts.leave;
    totals.flagged += counts.flagged;
    totals.travel += counts.travel;
    totals.notMarked += counts.notMarked;
    var onSite = counts.present + counts.late + counts.halfDay;
    return {
      project: projectDto_(p, ctx, settings),
      headcount: team.length,
      onSite: onSite,
      percentage: team.length ? Math.round((onSite / team.length) * 100) : 0,
      counts: counts,
      people: sortBy_(people, function (x) { return String(x.name); })
    };
  });

  var flaggedMarks = marks.filter(function (m) { return String(m.Status) === 'Flagged'; })
    .map(function (m) {
      var u = umap[String(m.UserID)] || {};
      var p = pmap[String(m.ProjectID)] || {};
      return {
        attendanceId: m.AttendanceID, userId: m.UserID, userName: u.Name || '',
        mobile: u.MobileNumber || '', projectId: m.ProjectID, projectName: p.Name || '',
        date: m.Date, markedAt: m.MarkedAt, distance: num_(m.DistanceFromSite, null),
        reason: m.FlagReason || '', selfieFileId: m.SelfieFileId || '', source: m.Source || ''
      };
    });

  var pending = {
    leave: readTable_(ss, 'LeaveRequests').filter(function (r) {
      return String(r.Status) === 'Pending' && (scopeIsAll_(ctx) || true);
    }).length,
    expense: readTable_(ss, 'ExpenseRequests').filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    transfer: readTable_(ss, 'SiteTransfers').filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    regularization: readTable_(ss, 'RegularizationRequests').filter(function (r) { return String(r.Status) === 'Pending'; }).length,
    flagged: flaggedMarks.length,
    deviceChanges: readTable_(ss, 'DeviceRegistry').filter(function (d) { return String(d.Status) === 'PendingChange'; }).length
  };

  var holidays = readTable_(ss, 'Holidays');
  return {
    date: dateStr,
    serverTime: iso_(new Date(), tz),
    timezone: tz,
    totals: totals,
    attendancePercentage: totals.expected
      ? Math.round(((totals.present + totals.late + totals.halfDay) / totals.expected) * 100) : 0,
    projects: projectRows,
    flagged: flaggedMarks,
    pending: pending,
    holidayToday: isHolidayFor_(holidays, dateStr, '') ? isHolidayFor_(holidays, dateStr, '').Name : '',
    recentActivity: sortBy_(marks, function (m) { return String(m.MarkedAt); }, true).slice(0, 25)
      .map(function (m) {
        var u = umap[String(m.UserID)] || {};
        var p = pmap[String(m.ProjectID)] || {};
        return {
          time: m.MarkedAt, userName: u.Name || '', projectName: p.Name || '',
          status: m.Status, distance: num_(m.DistanceFromSite, null), source: m.Source || 'GPS'
        };
      })
  };
}

function actionLiveMap(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var tz = settings.timezone || platformTimezone_();
  var dateStr = isIsoDate_(payload.date) ? payload.date : today_(tz);
  var projects = scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID');
  var marks = readTable_(ss, 'Attendance').filter(function (a) { return String(a.Date) === dateStr; });
  var umap = userMap_(ss);

  var pins = projects.map(function (p) {
    var siteMarks = marks.filter(function (m) { return String(m.ProjectID) === String(p.ProjectID); });
    var onSite = siteMarks.filter(function (m) {
      return ['Present', 'Late', 'HalfDay'].indexOf(String(m.Status)) >= 0;
    });
    return {
      projectId: p.ProjectID, name: p.Name, code: p.ProjectCode,
      lat: num_(p.Lat, 0), lng: num_(p.Long, 0),
      radius: num_(p.GeofenceRadius, num_(settings.defaultGeofenceRadius, 200)),
      status: p.Status, address: p.Address || '',
      clientName: p.ClientName || '', pmcName: p.PMCName || '',
      headcount: siteMarks.length,
      present: onSite.length,
      flagged: siteMarks.filter(function (m) { return String(m.Status) === 'Flagged'; }).length,
      people: onSite.slice(0, 40).map(function (m) {
        var u = umap[String(m.UserID)] || {};
        return {
          userId: m.UserID, name: u.Name || '', status: m.Status,
          markedAt: m.MarkedAt || '', lat: num_(m.Lat, 0), lng: num_(m.Long, 0),
          distance: num_(m.DistanceFromSite, null)
        };
      })
    };
  }).filter(function (p) { return p.lat || p.lng; });

  return { date: dateStr, count: pins.length, pins: pins, mapTiles: MAP_TILE_URL };
}

var MAP_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/* -------------------------------------------------------------------------- */
/*  Monthly summary (§5 auto-calculation)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build the monthly grid for one employee: a day-by-day code plus totals.
 * Codes: P present, L late, H half-day, A absent, LV leave (paid),
 *        UL unpaid leave, T travel, TR transfer, HD holiday, WO week-off,
 *        F flagged, "" no record yet.
 */
function monthlySummaryFor_(ss, ctx, userId, month, settings) {
  settings = settings || readSettings_(ss);
  var bounds = monthBounds_(month);
  var tz = settings.timezone || platformTimezone_();
  var todayStr = today_(tz);
  var user = findRecord_(ss, 'Users', 'UserID', userId) || {};
  var holidays = readTable_(ss, 'Holidays');

  var marks = readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.UserID) === String(userId) && String(a.Date) >= bounds.from && String(a.Date) <= bounds.to;
  });
  var byDate = {};
  marks.forEach(function (m) {
    var k = String(m.Date);
    if (!byDate[k] || String(m.MarkedAt) > String(byDate[k].MarkedAt)) byDate[k] = m;
  });

  var leaves = readTable_(ss, 'LeaveRequests').filter(function (l) {
    return String(l.UserID) === String(userId) && String(l.Status) === 'Approved' &&
      String(l.ToDate) >= bounds.from && String(l.FromDate) <= bounds.to;
  });
  var transfers = readTable_(ss, 'SiteTransfers').filter(function (t) {
    return String(t.UserID) === String(userId) && String(t.Status) === 'Approved' &&
      String(t.EffectiveDate) >= bounds.from && String(t.EffectiveDate) <= bounds.to;
  });
  var transferDates = {};
  transfers.forEach(function (t) { transferDates[String(t.EffectiveDate)] = t; });

  var assignments = readTable_(ss, 'ProjectAssignments').filter(function (a) {
    return String(a.UserID) === String(userId);
  });
  var primaryProjectId = '';
  assignments.forEach(function (a) {
    if (String(a.Status) === 'Active') primaryProjectId = String(a.ProjectID);
  });
  if (!primaryProjectId && assignments.length) primaryProjectId = String(assignments[assignments.length - 1].ProjectID);

  var totals = {
    present: 0, late: 0, halfDay: 0, absent: 0, paidLeave: 0, unpaidLeave: 0,
    sickLeave: 0, casualLeave: 0, travel: 0, transfer: 0, holiday: 0, weekOff: 0,
    flagged: 0, overtimeHours: 0, hoursWorked: 0, workingDays: 0, notMarked: 0,
    paidDays: 0, unpaidDays: 0, lwp: 0
  };
  var days = [];
  dateRange_(bounds.from, bounds.to).forEach(function (dateStr) {
    var mark = byDate[dateStr];
    var code = '';
    var note = '';
    var holiday = isHolidayFor_(holidays, dateStr, primaryProjectId);
    var weekOff = isWeekOffFor_(user, settings, toDate_(dateStr));
    var isFuture = dateStr > todayStr;

    if (mark) {
      var s = String(mark.Status);
      if (s === 'Present') { code = String(mark.LateMark) === 'Y' ? 'L' : 'P'; }
      else if (s === 'Late') code = 'L';
      else if (s === 'HalfDay') code = 'H';
      else if (s === 'Absent') code = 'A';
      else if (s === 'Leave') code = 'LV';
      else if (s === 'Travel') code = 'T';
      else if (s === 'Transfer') code = 'TR';
      else if (s === 'Holiday') code = 'HD';
      else if (s === 'WeekOff') code = 'WO';
      else if (s === 'Flagged') code = 'F';
      note = mark.ReviewNote || mark.FlagReason || '';
    } else if (holiday) {
      code = 'HD'; note = holiday.Name || '';
    } else if (weekOff) {
      code = 'WO';
    } else if (transferDates[dateStr]) {
      code = 'TR';
    } else if (!isFuture) {
      var leaveHit = null;
      for (var i = 0; i < leaves.length; i++) {
        if (leaves[i].FromDate <= dateStr && leaves[i].ToDate >= dateStr) { leaveHit = leaves[i]; break; }
      }
      if (leaveHit) {
        var lt = String(leaveHit.Type);
        code = lt === 'Unpaid' ? 'UL' : (lt === 'Sick' ? 'SL' : (lt === 'Casual' ? 'CL' : 'LV'));
        note = truncate_(leaveHit.Reason || '', 60);
      } else {
        code = 'A';
        note = 'No mark recorded';
      }
    }

    // Totals
    switch (code) {
      case 'P': totals.present++; break;
      case 'L': totals.present++; totals.late++; break;
      case 'H': totals.halfDay++; break;
      case 'A': totals.absent++; break;
      case 'LV': totals.paidLeave++; break;
      case 'SL': totals.sickLeave++; break;
      case 'CL': totals.casualLeave++; break;
      case 'UL': totals.unpaidLeave++; break;
      case 'T': totals.travel++; break;
      case 'TR': totals.transfer++; break;
      case 'HD': totals.holiday++; break;
      case 'WO': totals.weekOff++; break;
      case 'F': totals.flagged++; break;
      default: if (!isFuture) totals.notMarked++;
    }
    if (!isFuture && ['P', 'L', 'H', 'LV', 'SL', 'CL', 'T', 'TR', 'HD'].indexOf(code) >= 0) totals.workingDays++;
    if (mark) {
      totals.hoursWorked += num_(mark.HoursWorked, 0);
      totals.overtimeHours += num_(mark.OvertimeHours, 0);
    }

    days.push({
      date: dateStr, code: code, status: mark ? mark.Status : (code === 'HD' ? 'Holiday' : (code === 'WO' ? 'WeekOff' : '')),
      note: note, markedAt: mark ? mark.MarkedAt || '' : '', markedOutAt: mark ? mark.MarkedOutAt || '' : '',
      hours: mark ? num_(mark.HoursWorked, 0) : 0, overtime: mark ? num_(mark.OvertimeHours, 0) : 0,
      projectId: mark ? mark.ProjectID : primaryProjectId, attendanceId: mark ? mark.AttendanceID : '',
      future: isFuture
    });
  });

  totals.hoursWorked = Math.round(totals.hoursWorked * 100) / 100;
  totals.overtimeHours = Math.round(totals.overtimeHours * 100) / 100;
  totals.paidDays = totals.present + totals.late + (totals.halfDay * 0.5) +
    totals.paidLeave + totals.sickLeave + totals.casualLeave + (totals.holiday * num_(settings.paidHolidays, 1));
  totals.lwp = totals.unpaidLeave + totals.absent;
  totals.unpaidDays = totals.lwp;

  return {
    userId: userId,
    userName: user.Name || '',
    month: month,
    from: bounds.from,
    to: bounds.to,
    daysInMonth: bounds.days,
    projectId: primaryProjectId,
    days: days,
    totals: totals
  };
}

function actionMonthlySummary(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var month = /^\d{4}-\d{2}$/.test(str_(payload.month, 8)) ? str_(payload.month, 8) : monthKey_(today_(ctx.tz));
  var userId = str_(payload.userId, 40);

  if (userId && String(userId) !== ctx.userId) {
    if (String(ctx.role) === ROLES.EMPLOYEE) throw new ApiError_('You can only view your own summary', 403);
    if (!can_(ctx, 'viewAllEmployees') && !scopeIsAll_(ctx)) {
      var asg = findRecords_(ss, 'ProjectAssignments', 'UserID', userId);
      assert_(asg.some(function (a) { return inScope_(ctx, a.ProjectID); }),
        'This employee is outside your project scope', 403);
    }
    return { summary: monthlySummaryFor_(ss, ctx, userId, month, settings) };
  }

  if (String(ctx.role) === ROLES.EMPLOYEE) {
    return { summary: monthlySummaryFor_(ss, ctx, ctx.userId, month, settings) };
  }

  // Staff: every employee in scope.
  var projectId = str_(payload.projectId, 40);
  if (projectId) assertProjectScope_(ctx, projectId);
  var users = readTable_(ss, 'Users').filter(function (u) {
    return String(u.Role) === ROLES.EMPLOYEE && String(u.Status) === 'Active';
  });
  var assignments = readTable_(ss, 'ProjectAssignments').filter(function (a) { return String(a.Status) === 'Active'; });
  var userProjects = {};
  assignments.forEach(function (a) {
    var k = String(a.UserID);
    if (!userProjects[k]) userProjects[k] = [];
    userProjects[k].push(String(a.ProjectID));
  });

  users = users.filter(function (u) {
    var ps = userProjects[String(u.UserID)] || [];
    if (projectId) return ps.indexOf(projectId) >= 0;
    if (scopeIsAll_(ctx)) return true;
    return ps.some(function (p) { return inScope_(ctx, p); });
  });

  var summaries = users.slice(0, 300).map(function (u) {
    return monthlySummaryFor_(ss, ctx, u.UserID, month, settings);
  });

  var grid = summaries.map(function (s) {
    var codes = {};
    s.days.forEach(function (d) { codes[d.date] = d.code; });
    return { userId: s.userId, userName: s.userName, projectId: s.projectId, codes: codes, totals: s.totals };
  });

  return { month: month, count: grid.length, grid: grid,
    summaries: payload.includeDetails ? summaries : undefined };
}

/* -------------------------------------------------------------------------- */
/*  Weather-aware rain-day flag (§9.14)                                       */
/* -------------------------------------------------------------------------- */

function fetchWeather_(lat, lng) {
  if (String(prop_(PROP.WEATHER_ENABLED, 'true')).toLowerCase() === 'false') return null;
  try {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
      '&daily=precipitation_sum,temperature_2m_max,windspeed_10m_max&timezone=auto&forecast_days=1';
    var res = jsonParse_(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText(), {});
    if (!res || !res.daily) return null;
    return {
      rainMm: num_(res.daily.precipitation_sum && res.daily.precipitation_sum[0], 0),
      maxTempC: num_(res.daily.temperature_2m_max && res.daily.temperature_2m_max[0], 0),
      windKmph: num_(res.daily.windspeed_10m_max && res.daily.windspeed_10m_max[0], 0),
      date: res.daily.time && res.daily.time[0] ? res.daily.time[0] : today_()
    };
  } catch (e) {
    Logger.log('weather fetch failed: ' + e.message);
    return null;
  }
}

function actionCheckSiteWeather(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var projects = scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID')
    .filter(function (p) { return String(p.Status) === 'Active'; });
  var threshold = num_(settings.rainThresholdMm, 20);
  var out = projects.slice(0, 20).map(function (p) {
    var w = fetchWeather_(num_(p.Lat, 0), num_(p.Long, 0));
    if (!w) return { projectId: p.ProjectID, name: p.Name, weather: null };
    var flag = w.rainMm >= threshold ? 'RainDay' : (w.maxTempC >= num_(settings.heatThresholdC, 45) ? 'ExtremeHeat' : '');
    return {
      projectId: p.ProjectID, name: p.Name, lat: num_(p.Lat, 0), lng: num_(p.Long, 0),
      weather: w, suggestedFlag: flag, thresholdMm: threshold
    };
  });
  if (payload.applyFlag) {
    assert_(can_(ctx, 'reviewAttendance'), 'You need attendance review rights to apply a weather flag', 403);
    var dateStr = isIsoDate_(payload.date) ? payload.date : today_(ctx.tz);
    var applied = 0;
    out.forEach(function (o) {
      if (!o.suggestedFlag) return;
      var marks = readTable_(ss, 'Attendance').filter(function (a) {
        return String(a.ProjectID) === o.projectId && String(a.Date) === dateStr;
      });
      marks.forEach(function (m) {
        updateRecord_(ss, 'Attendance', 'AttendanceID', m.AttendanceID, { WeatherFlag: o.suggestedFlag });
        applied++;
      });
    });
    audit_(ss, ctx, 'WEATHER_FLAG_APPLIED', 'Attendance', dateStr, { marks: applied }, 'OK');
    return { date: dateStr, sites: out, appliedToMarks: applied };
  }
  return { date: today_(ctx.tz), sites: out };
}
