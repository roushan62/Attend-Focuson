/**
 * ============================================================================
 *  FILE: 18_Settings.gs
 *  ROLE: Company settings (Key/Value tab), the onboarding setup wizard (§3),
 *        the holiday calendar and shift definitions (§9.6).
 * ============================================================================
 */

/** Keys that need the stricter `manageGeofence` permission. */
var GEO_SETTINGS_KEYS = [
  'defaultGeofenceRadius', 'attendanceWindowStart', 'attendanceWindowEnd',
  'cutoffTime', 'outWindowStart', 'outWindowEnd', 'lateGraceMinutes',
  'requireSelfie', 'allowQrFallback', 'qrFallbackRadius', 'requireDeviceBinding',
  'standardHours', 'halfDayHours', 'overtimeAfterHours', 'workingDays', 'weeklyOff',
  'autoRainDayFlag', 'rainThresholdMm', 'maxGpsAccuracy', 'offlineMaxAgeHours'
];

/** Keys a company may edit at all (protects internal fields). */
function editableSettingKeys_() {
  return Object.keys(DEFAULT_SETTINGS).concat([
    'projectCodePrefix', 'overtimeRate', 'breakMinutes', 'paidHolidays',
    'expenseProofRequired', 'notifyOnFlagged', 'notifyChannel', 'reportFooterText',
    'reportIncludeLogo', 'reportIncludeClientPmc', 'gpsRetentionMonths',
    'maxGpsAccuracy', 'offlineMaxAgeHours', 'heatThresholdC', 'currency',
    'paidHolidays', 'payrollDaysBasis', 'autoMonthlyReport', 'reportRecipients'
  ]);
}

function actionGetSettings(payload, ctx) {
  var ss = ctx.ss;
  var settings = readSettings_(ss);
  var isStaff = isStaffRole_(ctx.role);
  if (!isStaff) {
    // Employees only receive what the mobile app needs.
    return {
      settings: {
        timezone: settings.timezone, currency: settings.currency,
        attendanceWindowStart: settings.attendanceWindowStart,
        attendanceWindowEnd: settings.attendanceWindowEnd,
        lateGraceMinutes: settings.lateGraceMinutes,
        requireSelfie: settings.requireSelfie,
        allowQrFallback: settings.allowQrFallback,
        weeklyOff: settings.weeklyOff, standardHours: settings.standardHours,
        halfDayHours: settings.halfDayHours,
        companyLogoLink: settings.companyLogoLink, companyName: settings.companyName
      },
      permissions: ctx.permissions,
      projectScope: ctx.scope,
      canEdit: false
    };
  }
  return {
    settings: settings,
    permissions: ctx.permissions,
    projectScope: ctx.scope,
    canEdit: can_(ctx, 'manageSettings'),
    canEditGeo: can_(ctx, 'manageGeofence') || String(ctx.role) === ROLES.SUPER_ADMIN,
    geoKeys: GEO_SETTINGS_KEYS,
    editableKeys: editableSettingKeys_(),
    company: {
      companyId: ctx.company.CompanyID, companyName: ctx.company.CompanyName,
      sheetId: ctx.company.SheetID, sheetUrl: sheetUrl_(ctx.company.SheetID),
      driveFolderId: ctx.company.DriveFolderID || '', status: ctx.company.Status,
      planTier: ctx.company.PlanTier || 'Free', createdAt: ctx.company.CreatedAt
    },
    enums: {
      roles: ROLE_LIST, permissions: PERMISSIONS, attendanceStatuses: ATT_STATUS,
      leaveTypes: LEAVE_TYPES, expenseCategories: EXPENSE_CATEGORIES,
      docTypes: DOC_TYPES, industries: INDUSTRY_TYPES,
      roleOnSite: COMPANY_TABS.ProjectAssignments.dropdowns.RoleOnSite
    }
  };
}

function actionSaveSettings(payload, ctx) {
  var ss = ctx.ss;
  var incoming = jsonParse_(payload.settings || payload, {});
  var allowed = editableSettingKeys_();
  var patch = {};
  var geoTouched = false;

  Object.keys(incoming).forEach(function (k) {
    if (allowed.indexOf(k) < 0) return;
    if (k === 'setupCompleted') return; // only the wizard sets this
    var v = incoming[k];
    if (v === null || typeof v === 'undefined') return;
    v = String(v).trim();
    if (GEO_SETTINGS_KEYS.indexOf(k) >= 0) geoTouched = true;

    switch (k) {
      case 'defaultGeofenceRadius':
        var r = num_(v, 200);
        assert_(r >= 10 && r <= 50000, 'Geofence radius must be 10–50000 m', 400);
        v = String(Math.round(r)); break;
      case 'qrFallbackRadius':
        var qr = num_(v, 1000);
        assert_(qr >= 50 && qr <= 50000, 'QR fallback radius must be 50–50000 m', 400);
        v = String(Math.round(qr)); break;
      case 'attendanceWindowStart': case 'attendanceWindowEnd':
      case 'cutoffTime': case 'outWindowStart': case 'outWindowEnd':
        assert_(timeToMinutes_(v) >= 0, k + ' must be HH:mm', 400); break;
      case 'lateGraceMinutes':
        assert_(num_(v, 0) >= 0 && num_(v, 0) <= 240, 'Grace must be 0–240 minutes', 400); break;
      case 'standardHours': case 'halfDayHours': case 'overtimeAfterHours': case 'breakMinutes':
        assert_(num_(v, 0) >= 0 && num_(v, 0) <= 24, k + ' must be 0–24 hours', 400); break;
      case 'overtimeRate':
        assert_(num_(v, 1) >= 1 && num_(v, 1) <= 5, 'Overtime rate must be 1–5', 400); break;
      case 'workingDays':
        var wd = v.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
        assert_(wd.length >= 1 && wd.length <= 7, 'Select at least one working day', 400);
        wd.forEach(function (x) { assert_(num_(x, -1) >= 0 && num_(x, -1) <= 6, 'Working days use 0=Sun … 6=Sat', 400); });
        v = uniq_(wd).sort().join(','); break;
      case 'weeklyOff':
        v = uniq_(String(v).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; })).join(',');
        break;
      case 'requireSelfie': case 'allowQrFallback': case 'requireDeviceBinding':
      case 'autoRainDayFlag': case 'reportIncludeLogo': case 'reportIncludeClientPmc':
      case 'notifyOnFlagged': case 'expenseProofRequired': case 'autoMonthlyReport':
      case 'paidHolidays':
        v = yn_(v, false); break;
      case 'maxGpsAccuracy':
        assert_(num_(v, 500) >= 10 && num_(v, 500) <= 5000, 'Max GPS accuracy must be 10–5000 m', 400);
        v = String(Math.round(num_(v, 500))); break;
      case 'offlineMaxAgeHours':
        assert_(num_(v, 26) >= 1 && num_(v, 26) <= 168, 'Offline mark age must be 1–168 hours', 400);
        v = String(Math.round(num_(v, 26))); break;
      case 'payrollDaysBasis':
        assert_(num_(v, 26) >= 1 && num_(v, 26) <= 31, 'Payroll days basis must be 1–31', 400);
        v = String(Math.round(num_(v, 26))); break;
      case 'heatThresholdC':
        assert_(num_(v, 45) >= 0 && num_(v, 45) <= 60, 'Heat threshold must be 0–60 °C', 400);
        v = String(num_(v, 45)); break;
      case 'timezone':
        try { Utilities.formatDate(new Date(), v, 'yyyy'); } catch (e) {
          throw new ApiError_('Unknown timezone: ' + v, 400);
        } break;
      case 'gpsRetentionMonths':
        assert_(num_(v, 12) >= 1 && num_(v, 12) <= 120, 'Retention must be 1–120 months', 400); break;
      case 'companyLogoLink':
        assert_(v === '' || /^https?:\/\//i.test(v) || v.indexOf('drive.google.com') >= 0,
          'Logo link must be a URL', 400); break;
      default:
        assert_(v.length <= 2000, k + ' is too long', 400);
    }
    patch[k] = v;
  });

  if (patch.logoBase64) { delete patch.logoBase64; }
  if (!isBlank_(payload.logoBase64)) {
    patch.companyLogoLink = storeCompanyUpload_(ctx.company, 'Documents',
      'company-logo', String(payload.logoBase64), str_(payload.logoMime, 'image/png')).link;
    delete patch.logoBase64;
  }

  assert_(Object.keys(patch).length, 'No editable settings supplied', 400);
  if (geoTouched) {
    assert_(can_(ctx, 'manageGeofence') || String(ctx.role) === ROLES.SUPER_ADMIN,
      'Only users with "Manage Geofence / Attendance Rules" may change these settings', 403);
  } else {
    assert_(can_(ctx, 'manageSettings') || String(ctx.role) === ROLES.SUPER_ADMIN,
      'You do not have permission to change company settings', 403);
  }

  // Cross-field sanity: window must open before it closes.
  var merged = {};
  var current = readSettings_(ss);
  for (var c in current) merged[c] = current[c];
  for (var p in patch) merged[p] = patch[p];
  assert_(timeToMinutes_(merged.attendanceWindowEnd) > timeToMinutes_(merged.attendanceWindowStart),
    'The attendance window must end after it starts', 400);
  assert_(timeToMinutes_(merged.outWindowEnd) > timeToMinutes_(merged.outWindowStart),
    'The check-out window must end after it starts', 400);

  writeSettings_(ss, patch, ctx.userId);
  if (patch.companyName) {
    updateRecord_(masterSpreadsheet_(), 'CompanyRegistry', 'CompanyID', ctx.companyId,
      { CompanyName: patch.companyName });
  }
  audit_(ss, ctx, 'SAVE_SETTINGS', 'Settings', '', { keys: Object.keys(patch).join(','), geo: geoTouched }, 'OK');
  return { saved: Object.keys(patch), settings: readSettings_(ss) };
}

/**
 * Company Setup Wizard (§3 step 5): profile → geofence → window → calendar.
 * Marks the company as configured once the essentials are present.
 */
function actionCompleteSetupWizard(payload, ctx) {
  var ss = ctx.ss;
  assertStaff_(ctx);
  var patch = {};
  var steps = {};

  // 1. profile
  patch.companyName = str_(payload.companyName || ctx.settings.companyName || ctx.company.CompanyName, 160);
  patch.companyAddress = str_(payload.companyAddress || ctx.settings.companyAddress, 400);
  patch.gst = str_(payload.gst || ctx.settings.gst, 32);
  patch.industryType = str_(payload.industryType || ctx.settings.industryType, 60);
  assert_(patch.companyName.length >= 2, 'Company name is required', 400);
  assert_(patch.companyAddress.length >= 5, 'Registered address is required (it appears on every export)', 400);
  steps.profile = true;

  // 2. geofence
  var radius = num_(payload.defaultGeofenceRadius, ctx.settings.defaultGeofenceRadius || 200);
  assert_(radius >= 10 && radius <= 50000, 'Geofence radius must be 10–50000 m', 400);
  patch.defaultGeofenceRadius = String(Math.round(radius));
  patch.requireSelfie = yn_(payload.requireSelfie !== undefined ? payload.requireSelfie : ctx.settings.requireSelfie, true);
  patch.requireDeviceBinding = yn_(payload.requireDeviceBinding !== undefined ? payload.requireDeviceBinding : true, true);
  steps.geofence = true;

  // 3. attendance window
  var ws = str_(payload.attendanceWindowStart || ctx.settings.attendanceWindowStart || '06:00', 5);
  var we = str_(payload.attendanceWindowEnd || ctx.settings.attendanceWindowEnd || '11:00', 5);
  assert_(timeToMinutes_(ws) >= 0 && timeToMinutes_(we) >= 0, 'Windows must be HH:mm', 400);
  assert_(timeToMinutes_(we) > timeToMinutes_(ws), 'The window must end after it starts', 400);
  patch.attendanceWindowStart = ws;
  patch.attendanceWindowEnd = we;
  patch.cutoffTime = we;
  patch.lateGraceMinutes = String(num_(payload.lateGraceMinutes, ctx.settings.lateGraceMinutes || 15));
  patch.outWindowStart = str_(payload.outWindowStart || ctx.settings.outWindowStart || '16:00', 5);
  patch.outWindowEnd = str_(payload.outWindowEnd || ctx.settings.outWindowEnd || '23:59', 5);
  steps.attendanceWindow = true;

  // 4. calendar
  var workingDays = str_(payload.workingDays || ctx.settings.workingDays || '1,2,3,4,5,6', 20);
  var wd = workingDays.split(',').filter(function (x) { return x.trim() !== ''; });
  assert_(wd.length >= 1, 'Select at least one working day', 400);
  patch.workingDays = uniq_(wd.map(function (x) { return x.trim(); })).sort().join(',');
  patch.weeklyOff = str_(payload.weeklyOff || ctx.settings.weeklyOff || '0', 12);
  patch.timezone = str_(payload.timezone || ctx.settings.timezone || platformTimezone_(), 40);
  steps.calendar = true;

  // 5. optional holidays in the same call
  var holidaysAdded = 0;
  var holidays = jsonList_(payload.holidays);
  if (Object.prototype.toString.call(payload.holidays) === '[object Array]') holidays = payload.holidays;
  holidays.forEach(function (h) {
    if (!h || !isIsoDate_(h.date) || isBlank_(h.name)) return;
    var exists = readTable_(ss, 'Holidays').some(function (x) {
      return String(x.Date) === h.date && String(x.Name) === str_(h.name, 120);
    });
    if (exists) return;
    appendRecord_(ss, 'Holidays', {
      HolidayID: id_('HOL'), Date: h.date, Name: str_(h.name, 120),
      ApplicableProjects: str_(h.applicableProjects, 200) || 'All',
      Type: pickOne_(h.type, ['Company', 'Project', 'Regional'], 'Company'),
      Year: String(h.date).substring(0, 4), Paid: yn_(h.paid, true),
      CreatedAt: fmtDateTime_(new Date()), CreatedBy: ctx.userId
    });
    holidaysAdded++;
  });

  patch.setupCompleted = 'Y';
  writeSettings_(ss, patch, ctx.userId);
  audit_(ss, ctx, 'SETUP_WIZARD_COMPLETED', 'Settings', '',
    { radius: patch.defaultGeofenceRadius, window: ws + '-' + we, holidays: holidaysAdded }, 'OK');
  notify_(ss, ctx.userId, 'Company setup complete',
    'Your SiteTrack company is configured. Create your first project to start capturing live attendance.', 'System');

  return { setupCompleted: true, steps: steps, settings: readSettings_(ss), holidaysAdded: holidaysAdded };
}

/* -------------------------------------------------------------------------- */
/*  Holidays                                                                  */
/* -------------------------------------------------------------------------- */

function actionListHolidays(payload, ctx) {
  var ss = ctx.ss;
  var year = str_(payload.year, 4) || String(new Date().getUTCFullYear());
  var rows = readTable_(ss, 'Holidays');
  if (payload.year) rows = rows.filter(function (h) { return String(h.Date).substring(0, 4) === year; });
  rows = sortBy_(rows, function (h) { return String(h.Date); });
  var projects = indexBy_(readTable_(ss, 'Projects'), 'ProjectID');
  return {
    count: rows.length,
    year: year,
    holidays: rows.map(function (h) {
      return {
        holidayId: h.HolidayID, date: h.Date, name: h.Name,
        applicableProjects: h.ApplicableProjects || 'All',
        projectNames: String(h.ApplicableProjects || '').split(',')
          .map(function (p) { return projects[p.trim()] ? projects[p.trim()].Name : p.trim(); })
          .filter(function (x) { return x; }).join(', '),
        type: h.Type || 'Company', paid: h.Paid === 'Y', weekday: weekdayName_(h.Date),
        createdAt: h.CreatedAt || ''
      };
    })
  };
}

function weekdayName_(dateStr) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekdayOf_(dateStr)];
}

function actionSaveHoliday(payload, ctx) {
  requireFields_(payload, ['date', 'name']);
  var ss = ctx.ss;
  assert_(isIsoDate_(payload.date), 'date must be yyyy-mm-dd', 400);
  var name = str_(payload.name, 120);
  assert_(name.length >= 2, 'Holiday name is required', 400);
  var applicable = str_(payload.applicableProjects, 200) || 'All';
  if (applicable !== 'All') {
    applicable.split(',').forEach(function (p) {
      assertProjectScope_(ctx, p.trim());
      assert_(findRecord_(ss, 'Projects', 'ProjectID', p.trim()), 'Project not found: ' + p, 404);
    });
  }
  var holidayId = str_(payload.holidayId, 40);
  if (holidayId) {
    var existing = findRecord_(ss, 'Holidays', 'HolidayID', holidayId);
    assert_(existing, 'Holiday not found', 404);
    var updated = updateRecord_(ss, 'Holidays', 'HolidayID', holidayId, {
      Date: payload.date, Name: name, ApplicableProjects: applicable,
      Type: pickOne_(payload.type, ['Company', 'Project', 'Regional'], existing.Type || 'Company'),
      Paid: yn_(payload.paid !== undefined ? payload.paid : existing.Paid, true),
      Year: payload.date.substring(0, 4)
    });
    audit_(ss, ctx, 'UPDATE_HOLIDAY', 'Holidays', holidayId, { date: payload.date, name: name }, 'OK');
    return { holidayId: holidayId, updated: true, holiday: updated };
  }
  var dup = readTable_(ss, 'Holidays').some(function (h) {
    return String(h.Date) === payload.date && String(h.Name) === name &&
      String(h.ApplicableProjects || 'All') === applicable;
  });
  assert_(!dup, 'That holiday already exists', 409);
  var row = {
    HolidayID: id_('HOL'), Date: payload.date, Name: name, ApplicableProjects: applicable,
    Type: pickOne_(payload.type, ['Company', 'Project', 'Regional'], 'Company'),
    Year: payload.date.substring(0, 4), Paid: yn_(payload.paid, true),
    CreatedAt: fmtDateTime_(new Date()), CreatedBy: ctx.userId
  };
  appendRecord_(ss, 'Holidays', row);
  audit_(ss, ctx, 'CREATE_HOLIDAY', 'Holidays', row.HolidayID, { date: payload.date, name: name }, 'OK');
  return { holidayId: row.HolidayID, created: true, holiday: row };
}

function actionDeleteHoliday(payload, ctx) {
  requireFields_(payload, ['holidayId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Holidays', 'HolidayID', payload.holidayId);
  assert_(row, 'Holiday not found', 404);
  deleteRecord_(ss, 'Holidays', 'HolidayID', row.HolidayID);
  audit_(ss, ctx, 'DELETE_HOLIDAY', 'Holidays', row.HolidayID, { date: row.Date, name: row.Name }, 'OK');
  return { holidayId: row.HolidayID, deleted: true };
}

/* -------------------------------------------------------------------------- */
/*  Shifts (§9.6)                                                             */
/* -------------------------------------------------------------------------- */

function shiftDto_(s) {
  return {
    shiftId: s.ShiftID, name: s.Name, startTime: s.StartTime, endTime: s.EndTime,
    applicableProjects: s.ApplicableProjects || 'All',
    breakMinutes: num_(s.BreakMinutes, 0), overtimeAfter: num_(s.OvertimeAfter, 9),
    windowStart: s.WindowStart || '', windowEnd: s.WindowEnd || '',
    color: s.Color || '', notes: s.Notes || '', createdAt: s.CreatedAt || ''
  };
}

function actionListShifts(payload, ctx) {
  var rows = sortBy_(readTable_(ctx.ss, 'Shifts'), function (s) { return String(s.StartTime); });
  return { count: rows.length, shifts: rows.map(shiftDto_) };
}

function actionSaveShift(payload, ctx) {
  requireFields_(payload, ['name', 'startTime', 'endTime']);
  var ss = ctx.ss;
  assert_(timeToMinutes_(payload.startTime) >= 0, 'startTime must be HH:mm', 400);
  assert_(timeToMinutes_(payload.endTime) >= 0, 'endTime must be HH:mm', 400);
  var name = str_(payload.name, 60);
  assert_(name.length >= 2, 'Shift name is required', 400);
  var applicable = str_(payload.applicableProjects, 200) || 'All';
  if (applicable !== 'All') {
    applicable.split(',').forEach(function (p) { assertProjectScope_(ctx, p.trim()); });
  }
  var shiftId = str_(payload.shiftId, 40);
  var patch = {
    Name: name, StartTime: str_(payload.startTime, 5), EndTime: str_(payload.endTime, 5),
    ApplicableProjects: applicable,
    BreakMinutes: String(num_(payload.breakMinutes, 0)),
    OvertimeAfter: String(num_(payload.overtimeAfter, ctx.settings.overtimeAfterHours || 9)),
    WindowStart: str_(payload.windowStart, 5), WindowEnd: str_(payload.windowEnd, 5),
    Color: str_(payload.color, 20), Notes: str_(payload.notes, 200)
  };
  if (shiftId) {
    var existing = findRecord_(ss, 'Shifts', 'ShiftID', shiftId);
    assert_(existing, 'Shift not found', 404);
    var updated = updateRecord_(ss, 'Shifts', 'ShiftID', shiftId, patch);
    audit_(ss, ctx, 'UPDATE_SHIFT', 'Shifts', shiftId, patch, 'OK');
    return { shiftId: shiftId, updated: true, shift: shiftDto_(updated) };
  }
  var dup = readTable_(ss, 'Shifts').some(function (s) { return String(s.Name).toLowerCase() === name.toLowerCase(); });
  assert_(!dup, 'A shift with this name already exists', 409);
  patch.ShiftID = id_('SHF');
  patch.CreatedAt = fmtDateTime_(new Date());
  appendRecord_(ss, 'Shifts', patch);
  audit_(ss, ctx, 'CREATE_SHIFT', 'Shifts', patch.ShiftID, patch, 'OK');
  return { shiftId: patch.ShiftID, created: true, shift: shiftDto_(patch) };
}

function actionDeleteShift(payload, ctx) {
  requireFields_(payload, ['shiftId']);
  var ss = ctx.ss;
  var row = findRecord_(ss, 'Shifts', 'ShiftID', payload.shiftId);
  assert_(row, 'Shift not found', 404);
  var inUse = readTable_(ss, 'Users').some(function (u) { return String(u.ShiftID) === row.ShiftID; }) ||
    readTable_(ss, 'Projects').some(function (p) { return String(p.ShiftID) === row.ShiftID; });
  assert_(!inUse, 'This shift is assigned to employees or projects — reassign them first', 409);
  deleteRecord_(ss, 'Shifts', 'ShiftID', row.ShiftID);
  audit_(ss, ctx, 'DELETE_SHIFT', 'Shifts', row.ShiftID, { name: row.Name }, 'OK');
  return { shiftId: row.ShiftID, deleted: true };
}
