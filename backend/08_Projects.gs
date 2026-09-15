/**
 * ============================================================================
 *  FILE: 08_Projects.gs
 *  ROLE: Project module (§4) — creation with GPS location lock, geofence and
 *        time-window overrides, client/PMC details, employee assignment,
 *        site transfers into projects, and the QR fallback code (§9.3).
 * ============================================================================
 */

function nextProjectSeq_(ss) {
  var rows = readTable_(ss, 'Projects');
  var year = new Date().getUTCFullYear();
  var max = 0;
  rows.forEach(function (r) {
    var code = String(r.ProjectCode || '');
    var m = code.match(/-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  return max + 1;
}

/**
 * Resolve lat/long for a project.
 *  1. explicit lat/long from the map pin (preferred)
 *  2. Google Geocoding API when MAPS_API_KEY is configured
 *  3. Open-Meteo geocoding (free, key-less) as a fallback
 */
function resolveCoordinates_(payload, settings) {
  var lat = num_(payload.lat, null);
  var lng = num_(payload.lng !== undefined ? payload.lng : payload.long, null);
  if (lat !== null && lng !== null && latOk_(lat) && lngOk_(lng)) {
    return { lat: Number(lat), lng: Number(lng), source: 'pin' };
  }
  var address = str_(payload.address, 400);
  assert_(address, 'Drop a map pin or provide a site address so the GPS location can be locked', 400);
  var geo = geocode_(address);
  assert_(geo, 'Could not convert that address into GPS coordinates. Drop the pin manually on the map.', 422);
  return { lat: geo.lat, lng: geo.lng, source: geo.source };
}

function geocode_(address) {
  var key = prop_(PROP.MAPS_API_KEY, '');
  if (key) {
    try {
      var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
        encodeURIComponent(address) + '&key=' + encodeURIComponent(key);
      var res = jsonParse_(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText(), {});
      if (res && res.results && res.results.length) {
        var loc = res.results[0].geometry.location;
        return { lat: Number(loc.lat), lng: Number(loc.lng), source: 'google', formatted: res.results[0].formatted_address };
      }
    } catch (e) {
      Logger.log('Google geocoding failed: ' + e.message);
    }
  }
  try {
    var url2 = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
      encodeURIComponent(address.replace(/,.*$/, '')) + '&country=' + encodeURIComponent(address);
    var res2 = jsonParse_(UrlFetchApp.fetch(url2, { muteHttpExceptions: true }).getContentText(), {});
    if (res2 && res2.results && res2.results.length) {
      var r = res2.results[0];
      return { lat: Number(r.latitude), lng: Number(r.longitude), source: 'openmeteo', formatted: r.name + ', ' + (r.admin1 || '') + ' ' + (r.country || '') };
    }
  } catch (e2) {
    Logger.log('Open-Meteo geocoding failed: ' + e2.message);
  }
  return null;
}

function actionGeocodeAddress(payload, ctx) {
  requireFields_(payload, ['address']);
  var geo = geocode_(str_(payload.address, 400));
  if (!geo) return { found: false, message: 'No coordinates found for that address. Drop the pin manually.' };
  return { found: true, lat: geo.lat, lng: geo.lng, source: geo.source, formatted: geo.formatted || '' };
}

/* -------------------------------------------------------------------------- */
/*  CRUD                                                                      */
/* -------------------------------------------------------------------------- */

function actionCreateProject(payload, ctx) {
  requireFields_(payload, ['name', 'clientName', 'clientContact', 'startDate']);
  var ss = ctx.ss;
  var settings = ctx.settings;
  var coords = resolveCoordinates_(payload, settings);

  assert_(isIsoDate_(payload.startDate), 'Start date must be yyyy-mm-dd', 400);
  if (!isBlank_(payload.endDate)) assert_(isIsoDate_(payload.endDate), 'End date must be yyyy-mm-dd', 400);
  assert_(isBlank_(payload.endDate) || payload.endDate >= payload.startDate, 'End date cannot be before the start date', 400);

  var radius = num_(payload.geofenceRadius, 0);
  if (radius <= 0) radius = num_(settings.defaultGeofenceRadius, 200);
  assert_(radius >= 10 && radius <= 50000, 'Geofence radius must be between 10 m and 50 km', 400);

  var winStart = str_(payload.windowStart, 5) || settings.attendanceWindowStart;
  var winEnd = str_(payload.windowEnd, 5) || settings.attendanceWindowEnd;
  assert_(timeToMinutes_(winStart) >= 0 && timeToMinutes_(winEnd) >= 0, 'Time windows must be HH:mm', 400);
  assert_(timeToMinutes_(winEnd) > timeToMinutes_(winStart), 'The marking window must end after it starts', 400);

  var outStart = str_(payload.outWindowStart, 5) || settings.outWindowStart;
  var outEnd = str_(payload.outWindowEnd, 5) || settings.outWindowEnd;

  var projects = readTable_(ss, 'Projects');
  var nameDup = projects.some(function (p) {
    return String(p.Name).toLowerCase() === str_(payload.name, 160).toLowerCase() && String(p.Status) !== 'Completed';
  });
  assert_(!nameDup, 'An active project with this name already exists', 409);

  var code = str_(payload.projectCode, 20).toUpperCase() ||
    projectCode_(str_(payload.codePrefix, 4) || settings.projectCodePrefix || 'PRJ', nextProjectSeq_(ss));
  var codeDup = projects.some(function (p) { return String(p.ProjectCode) === code; });
  assert_(!codeDup, 'Project code already used: ' + code, 409);

  var projectId = 'PRJ-' + shortId_(6);
  var qr = makeQrPayload_(ctx.companyId, projectId, shortId_(8));

  var row = {
    ProjectID: projectId,
    ProjectCode: code,
    Name: str_(payload.name, 160),
    Lat: String(coords.lat),
    Long: String(coords.lng),
    GeofenceRadius: String(radius),
    WindowStart: winStart,
    WindowEnd: winEnd,
    ClientName: str_(payload.clientName, 120),
    ClientContact: str_(payload.clientContact, 60),
    PMCName: str_(payload.pmcName, 120),
    PMCContact: str_(payload.pmcContact, 60),
    StartDate: payload.startDate,
    EndDate: str_(payload.endDate, 12),
    Status: pickOne_(payload.status, ['Active', 'OnHold', 'Completed'], 'Active'),
    Address: str_(payload.address, 400),
    OutWindowStart: outStart,
    OutWindowEnd: outEnd,
    ShiftID: str_(payload.shiftId, 32),
    OvertimeAfterHours: String(num_(payload.overtimeAfterHours, num_(settings.overtimeAfterHours, 9))),
    SiteEngineer: str_(payload.siteEngineer, 80),
    Notes: str_(payload.notes, 400),
    CreatedBy: ctx.userId,
    CreatedAt: fmtDateTime_(new Date()),
    QrCode: qr
  };
  if (coords.source !== 'pin') row.Notes = (row.Notes ? row.Notes + ' | ' : '') + 'Coordinates geocoded via ' + coords.source;

  appendRecord_(ss, 'Projects', row);
  audit_(ss, ctx, 'CREATE_PROJECT', 'Projects', projectId,
    { name: row.Name, code: code, lat: coords.lat, lng: coords.lng, radius: radius, source: coords.source }, 'OK');
  notifyAdmins_(ss, ctx, 'New project created',
    ctx.userName + ' created project ' + row.Name + ' (' + code + ').', 'Info');

  if (payload.assignUserIds && jsonList_(payload.assignUserIds).length) {
    jsonList_(payload.assignUserIds).forEach(function (uid) {
      try {
        createAssignment_(ss, ctx, {
          projectId: projectId, userId: uid, roleOnSite: payload.roleOnSite || 'Worker',
          assignedFrom: row.StartDate
        });
      } catch (e) { Logger.log('auto-assign failed for ' + uid + ': ' + e.message); }
    });
  }

  return { projectId: projectId, project: projectDto_(row, ctx, settings) };
}

function actionUpdateProject(payload, ctx) {
  requireFields_(payload, ['projectId']);
  var ss = ctx.ss;
  var settings = ctx.settings;
  var project = findRecord_(ss, 'Projects', 'ProjectID', payload.projectId);
  assert_(project, 'Project not found', 404);
  assertProjectScope_(ctx, project.ProjectID);
  assert_(can_(ctx, 'editProjects'), 'You do not have permission to edit projects', 403);

  var patch = {};
  var simple = {
    name: ['Name', 160], clientName: ['ClientName', 120], clientContact: ['ClientContact', 60],
    pmcName: ['PMCName', 120], pmcContact: ['PMCContact', 60], address: ['Address', 400],
    startDate: ['StartDate', 12], endDate: ['EndDate', 12], siteEngineer: ['SiteEngineer', 80],
    notes: ['Notes', 400], shiftId: ['ShiftID', 32], projectCode: ['ProjectCode', 20]
  };
  for (var k in simple) {
    if (payload[k] === undefined || payload[k] === null) continue;
    var v = str_(payload[k], simple[k][1]);
    if (k === 'startDate' || k === 'endDate') {
      if (v) assert_(isIsoDate_(v), k + ' must be yyyy-mm-dd', 400);
    }
    patch[simple[k][0]] = v;
  }

  // GPS lock + geofence + windows require the manageGeofence permission (§2.1)
  var touchesGeo = payload.lat !== undefined || payload.lng !== undefined || payload.long !== undefined ||
    payload.geofenceRadius !== undefined || payload.windowStart !== undefined || payload.windowEnd !== undefined ||
    payload.outWindowStart !== undefined || payload.outWindowEnd !== undefined;
  if (touchesGeo) {
    assert_(can_(ctx, 'manageGeofence') || String(ctx.role) === ROLES.SUPER_ADMIN,
      'Only users with the "Manage Geofence / Attendance Rules" permission can change the GPS lock or time windows', 403);
  }
  if (payload.lat !== undefined || payload.lng !== undefined || payload.address !== undefined && payload.regeocode) {
    var coords = resolveCoordinates_(payload, settings);
    patch.Lat = String(coords.lat);
    patch.Long = String(coords.lng);
  }
  if (payload.geofenceRadius !== undefined) {
    var radius = num_(payload.geofenceRadius, num_(project.GeofenceRadius, 200));
    assert_(radius >= 10 && radius <= 50000, 'Geofence radius must be between 10 m and 50 km', 400);
    patch.GeofenceRadius = String(radius);
  }
  if (payload.windowStart !== undefined) {
    assert_(timeToMinutes_(payload.windowStart) >= 0, 'windowStart must be HH:mm', 400);
    patch.WindowStart = str_(payload.windowStart, 5);
  }
  if (payload.windowEnd !== undefined) {
    assert_(timeToMinutes_(payload.windowEnd) >= 0, 'windowEnd must be HH:mm', 400);
    patch.WindowEnd = str_(payload.windowEnd, 5);
  }
  if (payload.outWindowStart !== undefined) patch.OutWindowStart = str_(payload.outWindowStart, 5);
  if (payload.outWindowEnd !== undefined) patch.OutWindowEnd = str_(payload.outWindowEnd, 5);
  if (payload.overtimeAfterHours !== undefined) patch.OvertimeAfterHours = String(num_(payload.overtimeAfterHours, 9));
  if (payload.status !== undefined) {
    patch.Status = pickOne_(payload.status, ['Active', 'OnHold', 'Completed'], String(project.Status));
  }

  assert_(Object.keys(patch).length, 'Nothing to update', 400);
  var merged = {};
  for (var a in project) merged[a] = project[a];
  for (var b in patch) merged[b] = patch[b];
  if (patch.WindowStart || patch.WindowEnd) {
    assert_(timeToMinutes_(merged.WindowEnd) > timeToMinutes_(merged.WindowStart),
      'The marking window must end after it starts', 400);
  }
  if (patch.StartDate && patch.EndDate) {
    assert_(patch.EndDate >= patch.StartDate, 'End date cannot be before the start date', 400);
  }

  var updated = updateRecord_(ss, 'Projects', 'ProjectID', project.ProjectID, patch);
  audit_(ss, ctx, 'UPDATE_PROJECT', 'Projects', project.ProjectID,
    { fields: Object.keys(patch).join(','), geoChanged: touchesGeo }, 'OK');
  return { updated: true, project: projectDto_(updated || merged, ctx, settings) };
}

function actionSetProjectStatus(payload, ctx) {
  requireFields_(payload, ['projectId', 'status']);
  var ss = ctx.ss;
  var project = findRecord_(ss, 'Projects', 'ProjectID', payload.projectId);
  assert_(project, 'Project not found', 404);
  assertProjectScope_(ctx, project.ProjectID);
  var status = pickOne_(payload.status, ['Active', 'OnHold', 'Completed'], '');
  assert_(status, 'Status must be Active, OnHold or Completed', 400);
  var updated = updateRecord_(ss, 'Projects', 'ProjectID', project.ProjectID, {
    Status: status,
    EndDate: status === 'Completed' && isBlank_(project.EndDate) ? today_(ctx.tz) : project.EndDate
  });
  audit_(ss, ctx, 'SET_PROJECT_STATUS', 'Projects', project.ProjectID, { status: status }, 'OK');
  return { projectId: project.ProjectID, status: status, project: projectDto_(updated, ctx, ctx.settings) };
}

function actionListProjects(payload, ctx) {
  var ss = ctx.ss;
  var settings = ctx.settings;
  var rows = scopedRows_(ctx, readTable_(ss, 'Projects'), 'ProjectID');
  var status = str_(payload.status, 20);
  if (status) rows = rows.filter(function (p) { return String(p.Status) === status; });
  var q = str_(payload.query, 60).toLowerCase();
  if (q) {
    rows = rows.filter(function (p) {
      return String(p.Name).toLowerCase().indexOf(q) >= 0 ||
        String(p.ProjectCode).toLowerCase().indexOf(q) >= 0 ||
        String(p.ClientName || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  rows = sortBy_(rows, function (p) { return String(p.Name); });

  var assignments = readTable_(ss, 'ProjectAssignments').filter(function (a) { return String(a.Status) === 'Active'; });
  var headcount = {};
  assignments.forEach(function (a) {
    var k = String(a.ProjectID);
    headcount[k] = (headcount[k] || 0) + 1;
  });
  var todayStr = today_(ctx.tz);
  var todays = readTable_(ss, 'Attendance').filter(function (a) { return String(a.Date) === todayStr; });
  var presentToday = {};
  todays.forEach(function (a) {
    if (['Present', 'HalfDay', 'Late'].indexOf(String(a.Status)) < 0) return;
    var k = String(a.ProjectID);
    presentToday[k] = (presentToday[k] || 0) + 1;
  });

  return {
    count: rows.length,
    date: todayStr,
    projects: rows.map(function (p) {
      var dto = projectDto_(p, ctx, settings);
      dto.assignedCount = headcount[String(p.ProjectID)] || 0;
      dto.presentToday = presentToday[String(p.ProjectID)] || 0;
      return dto;
    })
  };
}

function actionGetProject(payload, ctx) {
  var ss = ctx.ss;
  var projectId = str_(payload.projectId, 40);
  var project = findRecord_(ss, 'Projects', 'ProjectID', projectId);
  assert_(project, 'Project not found', 404);
  assertProjectScope_(ctx, projectId);

  var dto = projectDto_(project, ctx, ctx.settings);
  var team = projectTeamRows_(ss, ctx, projectId);
  dto.team = team.members;
  dto.today = team.today;
  return { project: dto };
}

function projectDto_(p, ctx, settings) {
  if (!p) return null;
  settings = settings || (ctx && ctx.settings) || DEFAULT_SETTINGS;
  var canSeeGeo = !ctx || isStaffRole_(ctx.role) || String(ctx.role) === ROLES.OWNER;
  var out = {
    projectId: p.ProjectID, projectCode: p.ProjectCode, name: p.Name,
    status: p.Status, startDate: p.StartDate, endDate: p.EndDate || '',
    clientName: p.ClientName || '', clientContact: p.ClientContact || '',
    pmcName: p.PMCName || '', pmcContact: p.PMCContact || '',
    address: p.Address || '', siteEngineer: p.SiteEngineer || '', notes: p.Notes || '',
    shiftId: p.ShiftID || '', createdBy: p.CreatedBy || '', createdAt: p.CreatedAt || '',
    geofenceRadius: num_(p.GeofenceRadius, num_(settings.defaultGeofenceRadius, 200)),
    windowStart: p.WindowStart || settings.attendanceWindowStart,
    windowEnd: p.WindowEnd || settings.attendanceWindowEnd,
    outWindowStart: p.OutWindowStart || settings.outWindowStart,
    outWindowEnd: p.OutWindowEnd || settings.outWindowEnd,
    overtimeAfterHours: num_(p.OvertimeAfterHours, num_(settings.overtimeAfterHours, 9)),
    lat: num_(p.Lat, 0), lng: num_(p.Long, 0)
  };
  if (canSeeGeo) {
    out.qrPayload = p.QrCode || '';
    out.qrImageUrl = p.QrCode
      ? 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(p.QrCode)
      : '';
  }
  return out;
}

function actionProjectQrCode(payload, ctx) {
  var ss = ctx.ss;
  var project = findRecord_(ss, 'Projects', 'ProjectID', str_(payload.projectId, 40));
  assert_(project, 'Project not found', 404);
  assertProjectScope_(ctx, project.ProjectID);
  var qr = String(project.QrCode || '');
  if (payload.regenerate) {
    qr = makeQrPayload_(ctx.companyId, project.ProjectID, shortId_(8));
    updateRecord_(ss, 'Projects', 'ProjectID', project.ProjectID, { QrCode: qr });
    audit_(ss, ctx, 'PROJECT_QR_REGENERATED', 'Projects', project.ProjectID, {}, 'OK');
  }
  if (!qr) {
    qr = makeQrPayload_(ctx.companyId, project.ProjectID, shortId_(8));
    updateRecord_(ss, 'Projects', 'ProjectID', project.ProjectID, { QrCode: qr });
  }
  return {
    projectId: project.ProjectID,
    projectName: project.Name,
    payload: qr,
    imageUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=' + encodeURIComponent(qr),
    printInstructions: 'Print this QR code and paste it at the site office. Workers scan it when GPS is unavailable; a selfie is still required.'
  };
}

/* -------------------------------------------------------------------------- */
/*  Assignments                                                               */
/* -------------------------------------------------------------------------- */

function createAssignment_(ss, ctx, data) {
  var project = findRecord_(ss, 'Projects', 'ProjectID', data.projectId);
  assert_(project, 'Project not found: ' + data.projectId, 404);
  var user = findRecord_(ss, 'Users', 'UserID', data.userId);
  assert_(user, 'User not found: ' + data.userId, 404);
  assert_(String(user.Status) === 'Active', 'That user account is not active', 400);

  var existing = findRecords_(ss, 'ProjectAssignments', 'UserID', data.userId)
    .filter(function (a) { return String(a.ProjectID) === String(data.projectId) && String(a.Status) === 'Active'; });
  assert_(!existing.length, user.Name + ' is already assigned to ' + project.Name, 409);

  var from = isIsoDate_(data.assignedFrom) ? data.assignedFrom : today_(ctx.tz);
  var row = {
    AssignmentID: id_('ASG'),
    ProjectID: project.ProjectID,
    UserID: user.UserID,
    RoleOnSite: str_(data.roleOnSite, 40) || 'Worker',
    AssignedFrom: from,
    AssignedTo: '',
    Status: 'Active',
    ShiftID: str_(data.shiftId, 32) || user.ShiftID || '',
    WeeklyOff: str_(data.weeklyOff, 12) || user.WeeklyOff || '',
    DailyWage: String(num_(data.dailyWage !== undefined ? data.dailyWage : user.DailyWage, 0)),
    AssignedBy: ctx.userId,
    CreatedAt: fmtDateTime_(new Date()),
    Notes: str_(data.notes, 200)
  };
  appendRecord_(ss, 'ProjectAssignments', row);
  audit_(ss, ctx, 'ASSIGN_EMPLOYEE', 'ProjectAssignments', row.AssignmentID,
    { project: project.Name, user: user.Name, role: row.RoleOnSite }, 'OK');
  notify_(ss, user.UserID, 'Assigned to ' + project.Name,
    'You have been assigned to project ' + project.Name + ' (' + project.ProjectCode + ') as ' + row.RoleOnSite +
    ' from ' + from + '.', 'Info');
  return {
    assignmentId: row.AssignmentID, projectId: row.ProjectID, projectName: project.Name,
    userId: row.UserID, userName: user.Name, roleOnSite: row.RoleOnSite, assignedFrom: from
  };
}

function actionAssignEmployee(payload, ctx) {
  requireFields_(payload, ['projectId', 'userId']);
  assertProjectScope_(ctx, payload.projectId);
  assertProjectScopeOfUser_(ctx.ss, ctx, findRecord_(ctx.ss, 'Users', 'UserID', payload.userId) || {});
  var result = createAssignment_(ctx.ss, ctx, payload);
  // Keep a Sub-Admin's scope in sync when they are assigned to a project.
  var user = findRecord_(ctx.ss, 'Users', 'UserID', payload.userId);
  if (user && String(user.Role) === ROLES.SUB_ADMIN) {
    var scope = projectScopeOfUser_(user);
    if (scope.indexOf('ALL') < 0 && scope.indexOf(String(payload.projectId)) < 0) {
      scope.push(String(payload.projectId));
      updateRecord_(ctx.ss, 'Users', 'UserID', user.UserID, { ProjectScopeJSON: jsonString_(scope) });
    }
  }
  return result;
}

function actionListAssignments(payload, ctx) {
  var ss = ctx.ss;
  var rows = scopedRows_(ctx, readTable_(ss, 'ProjectAssignments'), 'ProjectID');
  var projectId = str_(payload.projectId, 40);
  var userId = str_(payload.userId, 40);
  var status = str_(payload.status, 20) || 'Active';
  if (projectId) rows = rows.filter(function (a) { return String(a.ProjectID) === projectId; });
  if (userId) rows = rows.filter(function (a) { return String(a.UserID) === userId; });
  if (status !== 'All') rows = rows.filter(function (a) { return String(a.Status) === status; });
  var users = indexBy_(readTable_(ss, 'Users'), 'UserID');
  var projects = indexBy_(readTable_(ss, 'Projects'), 'ProjectID');
  rows = sortBy_(rows, function (a) { return String(a.AssignedFrom); }, true);
  return {
    count: rows.length,
    assignments: rows.map(function (a) {
      var u = users[String(a.UserID)] || {};
      var p = projects[String(a.ProjectID)] || {};
      return {
        assignmentId: a.AssignmentID, projectId: a.ProjectID, projectName: p.Name || '',
        projectCode: p.ProjectCode || '', userId: a.UserID, userName: u.Name || '',
        userRole: u.Role || '', mobile: u.MobileNumber || '', roleOnSite: a.RoleOnSite || '',
        assignedFrom: a.AssignedFrom || '', assignedTo: a.AssignedTo || '', status: a.Status,
        dailyWage: num_(a.DailyWage, 0), shiftId: a.ShiftID || '', weeklyOff: a.WeeklyOff || ''
      };
    })
  };
}

function actionEndAssignment(payload, ctx) {
  requireFields_(payload, ['assignmentId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'ProjectAssignments', 'AssignmentID', payload.assignmentId);
  assert_(row, 'Assignment not found', 404);
  assertProjectScope_(ctx, row.ProjectID);
  var to = isIsoDate_(payload.endDate) ? payload.endDate : today_(ctx.tz);
  updateRecord_(ss, 'ProjectAssignments', 'AssignmentID', row.AssignmentID, {
    Status: 'Ended', AssignedTo: to
  });
  audit_(ss, ctx, 'END_ASSIGNMENT', 'ProjectAssignments', row.AssignmentID, { endDate: to }, 'OK');
  notify_(ss, row.UserID, 'Assignment ended',
    'Your assignment to project ' + row.ProjectID + ' ended on ' + to + '.', 'Info');
  return { assignmentId: row.AssignmentID, status: 'Ended', endDate: to };
}

/** Team roster + today's live attendance for one project. */
function projectTeamRows_(ss, ctx, projectId) {
  var users = indexBy_(readTable_(ss, 'Users'), 'UserID');
  var assignments = readTable_(ss, 'ProjectAssignments')
    .filter(function (a) { return String(a.ProjectID) === projectId && String(a.Status) === 'Active'; });
  var todayStr = today_(ctx.tz);
  var todays = indexBy_(readTable_(ss, 'Attendance').filter(function (a) {
    return String(a.Date) === todayStr && String(a.ProjectID) === projectId;
  }), 'UserID');

  var members = assignments.map(function (a) {
    var u = users[String(a.UserID)] || {};
    var att = todays[String(a.UserID)];
    return {
      userId: a.UserID, name: u.Name || '', designation: u.Designation || a.RoleOnSite || '',
      roleOnSite: a.RoleOnSite || '', mobile: u.MobileNumber || '',
      assignedFrom: a.AssignedFrom || '',
      status: att ? String(att.Status) : 'NotMarked',
      markedAt: att ? att.MarkedAt || '' : '',
      markedOutAt: att ? att.MarkedOutAt || '' : '',
      distance: att ? num_(att.DistanceFromSite, 0) : null,
      lateMark: att ? String(att.LateMark) === 'Y' : false,
      source: att ? String(att.Source || '') : ''
    };
  });
  members = sortBy_(members, function (m) { return String(m.name); });

  var counts = { Present: 0, Late: 0, HalfDay: 0, Leave: 0, Flagged: 0, Absent: 0, NotMarked: 0, other: 0 };
  members.forEach(function (m) {
    if (counts.hasOwnProperty(m.status)) counts[m.status]++; else counts.other++;
  });
  return {
    members: members,
    today: {
      date: todayStr,
      total: members.length,
      present: counts.Present + counts.Late + counts.HalfDay,
      counts: counts,
      percentage: members.length ? Math.round(((counts.Present + counts.Late + counts.HalfDay) / members.length) * 100) : 0
    }
  };
}

function actionProjectTeam(payload, ctx) {
  var projectId = str_(payload.projectId, 40);
  assertProjectScope_(ctx, projectId);
  var project = findRecord_(ctx.ss, 'Projects', 'ProjectID', projectId);
  assert_(project, 'Project not found', 404);
  var team = projectTeamRows_(ctx.ss, ctx, projectId);
  team.project = projectDto_(project, ctx, ctx.settings);
  return team;
}
