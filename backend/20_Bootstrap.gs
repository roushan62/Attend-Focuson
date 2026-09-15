/**
 * ============================================================================
 *  FILE: 20_Bootstrap.gs
 *  ROLE: First-run setup. `bootstrapPlatform` prepares the Platform Master
 *        Sheet and generates the secrets; `setupScript()` is the one-click
 *        version you run from the Apps Script editor; `seedDemoCompany_`
 *        creates a fully populated demo tenant for evaluation and local dev.
 * ============================================================================
 */

/**
 * Public bootstrap action. Safe to expose because it can only create structure
 * — it never returns an existing secret and refuses to run once the platform is
 * configured (unless the caller supplies the owner key).
 */
function actionBootstrapPlatform(payload, ctx) {
  var confirm = str_(payload.confirm, 20).toUpperCase() === 'BOOTSTRAP';
  var masterId = parseSheetId_(prop_(PROP.MASTER_ID, ''));
  var ownerKey = prop_(PROP.OWNER_KEY, '');

  if (masterId && ownerKey && !devMode_()) {
    if (!confirm || str_(payload.ownerKey, 200) !== ownerKey) {
      return {
        alreadyConfigured: true,
        masterSheetId: masterId,
        message: 'Platform is already configured. Pass confirm=BOOTSTRAP plus the owner key to re-run structure checks.'
      };
    }
  }

  var created = { masterSheet: false, ownerKey: false, tokenSecret: false, driveRoot: false };

  if (!masterId) {
    var supplied = parseSheetId_(payload.masterSheetId || '');
    if (supplied) {
      masterId = supplied;
    } else {
      var ssNew = SpreadsheetApp.create('SiteTrack - Platform Master');
      try { ssNew.setSpreadsheetTimeZone(platformTimezone_()); } catch (e) { }
      masterId = ssNew.getId();
      created.masterSheet = true;
    }
    setProp_(PROP.MASTER_ID, masterId);
  }

  var ss = masterSpreadsheet_();
  var tabs = ensureTabs_(ss, PLATFORM_TABS, PLATFORM_TAB_ORDER);

  if (!prop_(PROP.TOKEN_SECRET, '')) {
    setProp_(PROP.TOKEN_SECRET, uuid_() + uuid_());
    created.tokenSecret = true;
  }
  if (!prop_(PROP.OWNER_KEY, '')) {
    var key = 'STK-OWNER-' + uuid_().replace(/-/g, '').substring(0, 16).toUpperCase();
    setProp_(PROP.OWNER_KEY, key);
    created.ownerKey = true;
  }
  if (!prop_(PROP.DRIVE_ROOT_ID, '')) {
    try {
      var root = DriveApp.createFolder('SiteTrack');
      setProp_(PROP.DRIVE_ROOT_ID, root.getId());
      created.driveRoot = true;
    } catch (e2) {
      Logger.log('Drive root creation skipped: ' + e2.message);
    }
  }
  if (!prop_(PROP.TIMEZONE, '')) setProp_(PROP.TIMEZONE, str_(payload.timezone, 40) || 'Asia/Kolkata');
  if (payload.ownerEmail && emailOk_(payload.ownerEmail)) setProp_(PROP.OWNER_EMAIL, str_(payload.ownerEmail, 120));
  if (payload.devMode !== undefined) setProp_(PROP.DEV_MODE, bool_(payload.devMode, false) ? 'true' : 'false');

  platformAudit_('BOOTSTRAP_PLATFORM', { masterId: masterId, tabs: tabs.length, created: created }, 'OK');

  return {
    bootstrapped: true,
    masterSheetId: masterId,
    masterSheetUrl: sheetUrl_(masterId),
    tabs: tabs,
    created: created,
    // Shown ONCE, immediately after generation. Store it now.
    ownerKey: created.ownerKey ? prop_(PROP.OWNER_KEY, '') : '(already set — not shown again)',
    tokenSecretGenerated: created.tokenSecret,
    driveRootId: prop_(PROP.DRIVE_ROOT_ID, ''),
    nextSteps: [
      '1. Copy the owner key above into frontend/config.js (or the Owner panel login).',
      '2. Deploy the script as a Web App (execute as: me, access: anyone).',
      '3. Paste the Web App URL into frontend/config.js as API_URL.',
      '4. Run the owner action installTriggers to enable the scheduled jobs.',
      '5. Optionally run seedDemoCompany to create a demo tenant.'
    ]
  };
}

/**
 * Run this once from the Apps Script editor (Run → setupScript) to prepare
 * everything: master sheet, secrets, tabs and triggers.
 */
function setupScript() {
  var res = actionBootstrapPlatform({ confirm: 'BOOTSTRAP', devMode: false }, {});
  Logger.log('Master sheet: ' + res.masterSheetUrl);
  Logger.log('Owner key: ' + res.ownerKey);
  var trig = installTriggers();
  Logger.log('Triggers: ' + jsonString_(trig));
  return res;
}

/* -------------------------------------------------------------------------- */
/*  Demo tenant                                                               */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random generator so demo data is reproducible. */
function rng_(seed) {
  var s = seed || 42;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/**
 * Create a demo company with realistic data: projects, staff, a month of
 * attendance, leave/expense/transfer/vendor records, holidays, shifts and
 * documents. Used by the local dev harness and by the owner "seed demo" action.
 */
function seedDemoCompany_(companyName, superAdminEmail, password) {
  companyName = companyName || 'Demo Fitout Pvt Ltd';
  superAdminEmail = (superAdminEmail || 'demo.admin@sitetrack.local').toLowerCase();
  password = password || 'Demo@1234';
  var rand = rng_(7);

  var ss = masterSpreadsheet_();
  ensureTabs_(ss, PLATFORM_TABS, PLATFORM_TAB_ORDER);

  // Existing demo tenant? Reuse it instead of duplicating.
  var existing = listCompaniesRaw_().filter(function (c) {
    return String(c.CompanyName) === companyName;
  })[0];
  var companyId, companySS;
  if (existing) {
    companyId = existing.CompanyID;
    companySS = companySpreadsheetById_(existing.SheetID);
  } else {
    companyId = 'CMP-DEMO' + shortId_(3);
    companySS = createCompanySpreadsheet_(companyName, companyId, superAdminEmail);
    var folder = companyDriveFolder_({ CompanyID: companyId, CompanyName: companyName }, true);
    appendRecord_(ss, 'CompanyRegistry', {
      CompanyID: companyId, CompanyName: companyName, SheetID: companySS.getId(),
      SuperAdminEmail: superAdminEmail, Status: 'Active', CreatedAt: fmtDateTime_(new Date()),
      PlanTier: 'Free', GST: '27AAACD1234F1Z5', Mobile: '+919800000000',
      ContactPerson: 'Demo Super Admin', IndustryType: 'Interior Fit-out',
      DriveFolderID: folder ? folder.getId() : '', SuperAdminUserID: 'SA-DEMO-001',
      TimeZone: 'Asia/Kolkata', EmployeeCount: 12, LastActiveAt: fmtDateTime_(new Date())
    });
    appendRecord_(ss, 'CompanySignupRequests', {
      RequestID: id_('REQ'), CompanyName: companyName, GST: '27AAACD1234F1Z5',
      Address: '302, Skyline Business Park, Andheri East, Mumbai 400069',
      ContactPerson: 'Demo Super Admin', Designation: 'Director', Email: superAdminEmail,
      Mobile: '+919800000000', IndustryType: 'Interior Fit-out', Status: 'Approved',
      SubmittedAt: fmtDateTime_(new Date()), ReviewedBy: 'PlatformOwner',
      ReviewNote: 'Demo tenant', CompanyID: companyId, OtpVerified: 'Y',
      ReviewedAt: fmtDateTime_(new Date())
    });
  }

  var settings = clone_(DEFAULT_SETTINGS);
  settings.companyName = companyName;
  settings.gst = '27AAACD1234F1Z5';
  settings.companyAddress = '302, Skyline Business Park, Andheri East, Mumbai 400069, Maharashtra, India';
  settings.industryType = 'Interior Fit-out';
  settings.timezone = 'Asia/Kolkata';
  settings.setupCompleted = 'Y';
  settings.projectCodePrefix = 'FOI';
  settings.currency = 'INR';
  settings.overtimeRate = '1.5';
  settings.payrollDaysBasis = '26';
  writeSettings_(companySS, settings, 'seed');

  /* ---- shifts ---------------------------------------------------------- */
  var shifts = [
    { ShiftID: 'SHF-DAY', Name: 'Day Shift', StartTime: '09:00', EndTime: '18:00',
      ApplicableProjects: 'All', BreakMinutes: '60', OvertimeAfter: '9',
      WindowStart: '06:00', WindowEnd: '11:00', Color: '#2563eb', CreatedAt: fmtDateTime_(new Date()) },
    { ShiftID: 'SHF-NIGHT', Name: 'Night Shift', StartTime: '20:00', EndTime: '05:00',
      ApplicableProjects: 'All', BreakMinutes: '45', OvertimeAfter: '9',
      WindowStart: '18:00', WindowEnd: '22:00', Color: '#7c3aed', CreatedAt: fmtDateTime_(new Date()) }
  ];
  appendRecords_(companySS, 'Shifts', shifts);

  /* ---- projects -------------------------------------------------------- */
  var projectSeeds = [
    {
      id: 'PRJ-DEMO01', code: 'FOI-' + new Date().getUTCFullYear() + '-001',
      name: 'Andheri Office Fit-out — Wing B', lat: 19.1197, lng: 72.8464, radius: 220,
      client: 'Prestige Infra Pvt Ltd', clientContact: '+919820011223',
      pmc: 'BuildRight PMC', pmcContact: '+919820044556',
      address: 'Plot 47, MIDC Central Road, Andheri East, Mumbai 400093',
      status: 'Active'
    },
    {
      id: 'PRJ-DEMO02', code: 'FOI-' + new Date().getUTCFullYear() + '-002',
      name: 'BKC Tower Interior — Level 14', lat: 19.0662, lng: 72.8683, radius: 180,
      client: 'Skyline Developers', clientContact: '+919820077889',
      pmc: '', pmcContact: '',
      address: 'G Block, Bandra Kurla Complex, Mumbai 400051',
      status: 'Active'
    },
    {
      id: 'PRJ-DEMO03', code: 'FOI-' + new Date().getUTCFullYear() + '-003',
      name: 'Powai Retail Shell & Core', lat: 19.1176, lng: 72.9060, radius: 250,
      client: 'Metro Retail Group', clientContact: '+919820099001',
      pmc: 'UrbanCheck Consultants', pmcContact: '+919820099002',
      address: 'Hiranandani Gardens, Powai, Mumbai 400076',
      status: 'OnHold'
    }
  ];
  appendRecords_(companySS, 'Projects', projectSeeds.map(function (p) {
    return {
      ProjectID: p.id, ProjectCode: p.code, Name: p.name, Lat: String(p.lat), Long: String(p.lng),
      GeofenceRadius: String(p.radius), WindowStart: '06:00', WindowEnd: '11:00',
      ClientName: p.client, ClientContact: p.clientContact, PMCName: p.pmc, PMCContact: p.pmcContact,
      StartDate: shiftDate_(today_(), -45), EndDate: shiftDate_(today_(), 60), Status: p.status,
      Address: p.address, OutWindowStart: '16:00', OutWindowEnd: '23:59', ShiftID: 'SHF-DAY',
      OvertimeAfterHours: '9', SiteEngineer: '', Notes: 'Demo project',
      CreatedBy: 'SA-DEMO-001', CreatedAt: fmtDateTime_(new Date()),
      QrCode: makeQrPayload_(companyId, p.id, 'DEMOQR' + p.id.slice(-2))
    };
  }));

  /* ---- users ----------------------------------------------------------- */
  var userSeeds = [
    { id: 'SA-DEMO-001', role: 'SuperAdmin', name: 'Demo Super Admin', mobile: '+919800000000',
      email: superAdminEmail, designation: 'Director', wage: 0, monthly: 120000, type: 'Monthly' },
    { id: 'ADM-DEMO-001', role: 'Admin', name: 'Rahul Verma', mobile: '+919800000001',
      email: 'demo.admin1@sitetrack.local', designation: 'Operations Head', wage: 0, monthly: 85000, type: 'Monthly' },
    { id: 'SUB-DEMO-001', role: 'SubAdmin', name: 'Priya Nair', mobile: '+919800000002',
      email: 'demo.hr@sitetrack.local', designation: 'HR Executive', wage: 0, monthly: 55000, type: 'Monthly',
      perms: { approveLeave: true, approveExpense: true, viewReports: true, exportReports: true,
        manageDocuments: true, viewAllEmployees: true }, scope: ['PRJ-DEMO01'] },
    { id: 'EMP-DEMO-001', role: 'Employee', name: 'Suresh Kumar', mobile: '+919800000011',
      email: '', designation: 'Site Supervisor', wage: 950, role2: 'Supervisor', project: 'PRJ-DEMO01' },
    { id: 'EMP-DEMO-002', role: 'Employee', name: 'Imran Shaikh', mobile: '+919800000012',
      email: '', designation: 'Site Incharge', wage: 1100, role2: 'SiteIncharge', project: 'PRJ-DEMO01' },
    { id: 'EMP-DEMO-003', role: 'Employee', name: 'Anil Pawar', mobile: '+919800000013',
      email: '', designation: 'Carpenter', wage: 850, role2: 'Carpenter', project: 'PRJ-DEMO01' },
    { id: 'EMP-DEMO-004', role: 'Employee', name: 'Ravi Yadav', mobile: '+919800000014',
      email: '', designation: 'Electrician', wage: 900, role2: 'Electrician', project: 'PRJ-DEMO02' },
    { id: 'EMP-DEMO-005', role: 'Employee', name: 'Deepak Singh', mobile: '+919800000015',
      email: '', designation: 'Painter', wage: 800, role2: 'Painter', project: 'PRJ-DEMO02' },
    { id: 'EMP-DEMO-006', role: 'Employee', name: 'Mahesh Gaikwad', mobile: '+919800000016',
      email: '', designation: 'Helper', wage: 550, role2: 'Helper', project: 'PRJ-DEMO02' },
    { id: 'EMP-DEMO-007', role: 'Employee', name: 'Sanjay Mishra', mobile: '+919800000017',
      email: '', designation: 'Project Manager', wage: 0, monthly: 78000, type: 'Monthly',
      role2: 'ProjectManager', project: 'PRJ-DEMO03' },
    { id: 'EMP-DEMO-008', role: 'Employee', name: 'Vikram Rathore', mobile: '+919800000018',
      email: '', designation: 'Plumber', wage: 870, role2: 'Plumber', project: 'PRJ-DEMO03' }
  ];

  var users = userSeeds.map(function (u) {
    return {
      UserID: u.id, Role: u.role, Name: u.name, MobileNumber: u.mobile, Email: u.email,
      PasswordHash: hashPassword_(password),
      PermissionsJSON: jsonString_(u.role === 'SuperAdmin' ? { __all: true } : (u.perms || {})),
      ProjectScopeJSON: jsonString_(u.scope || (u.role === 'Employee' ? [] : ['ALL'])),
      Status: 'Active', DeviceID: '', CreatedAt: fmtDateTime_(new Date()),
      Designation: u.designation, SalaryType: u.type || 'Daily', DailyWage: String(u.wage || 0),
      MonthlySalary: String(u.monthly || 0), ShiftID: 'SHF-DAY', WeeklyOff: '0',
      Address: 'Mumbai, Maharashtra', EmergencyContact: '+9198' + String(10000000 + Math.floor(rand() * 89999999)).slice(0, 8),
      IdProofMasked: 'XXXX' + String(1000 + Math.floor(rand() * 8999)),
      JoinedAt: shiftDate_(today_(), -120), LastLoginAt: '', MustChangePassword: u.role === 'SuperAdmin' ? 'N' : 'N',
      DeviceStatus: 'Unbound', BankAccount: 'XXXX' + String(1000 + Math.floor(rand() * 8999)),
      IfscCode: 'HDFC0001234', Notes: 'Demo user'
    };
  });
  appendRecords_(companySS, 'Users', users);
  users.forEach(function (u) { loginIndexUpsert_(u, companyId); });

  /* ---- assignments ----------------------------------------------------- */
  var assignments = [];
  userSeeds.forEach(function (u) {
    if (!u.project) return;
    assignments.push({
      AssignmentID: id_('ASG'), ProjectID: u.project, UserID: u.id,
      RoleOnSite: u.role2 || 'Worker', AssignedFrom: shiftDate_(today_(), -40), AssignedTo: '',
      Status: 'Active', ShiftID: 'SHF-DAY', WeeklyOff: '0', DailyWage: String(u.wage || 0),
      AssignedBy: 'SA-DEMO-001', CreatedAt: fmtDateTime_(new Date()), Notes: 'Demo assignment'
    });
  });
  // A couple of shared-site workers so the dashboard shows realistic overlap.
  assignments.push({
    AssignmentID: id_('ASG'), ProjectID: 'PRJ-DEMO02', UserID: 'EMP-DEMO-001', RoleOnSite: 'Supervisor',
    AssignedFrom: shiftDate_(today_(), -10), AssignedTo: '', Status: 'Active', ShiftID: 'SHF-DAY',
    WeeklyOff: '0', DailyWage: '950', AssignedBy: 'SA-DEMO-001', CreatedAt: fmtDateTime_(new Date()),
    Notes: 'Overseeing two sites'
  });
  appendRecords_(companySS, 'ProjectAssignments', assignments);

  /* ---- attendance for the last 34 days --------------------------------- */
  var projectById = {};
  projectSeeds.forEach(function (p) { projectById[p.id] = p; });
  var holidays = [
    { HolidayID: id_('HOL'), Date: shiftDate_(today_(), -12), Name: 'Founding Day',
      ApplicableProjects: 'All', Type: 'Company', Year: String(new Date().getUTCFullYear()), Paid: 'Y',
      CreatedAt: fmtDateTime_(new Date()), CreatedBy: 'SA-DEMO-001' },
    { HolidayID: id_('HOL'), Date: shiftDate_(today_(), 9), Name: 'Ganesh Chaturthi',
      ApplicableProjects: 'All', Type: 'Company', Year: String(new Date().getUTCFullYear()), Paid: 'Y',
      CreatedAt: fmtDateTime_(new Date()), CreatedBy: 'SA-DEMO-001' }
  ];
  appendRecords_(companySS, 'Holidays', holidays);
  var holidayDates = {};
  holidays.forEach(function (h) { holidayDates[h.Date] = h.Name; });

  var attendanceRows = [];
  var days = dateRange_(shiftDate_(today_(), -33), today_());
  assignments.forEach(function (a) {
    var userSeed = null;
    userSeeds.forEach(function (u) { if (u.id === a.UserID) userSeed = u; });
    if (!userSeed) return;
    var project = projectById[String(a.ProjectID)];
    if (!project) return;
    days.forEach(function (dateStr) {
      if (weekdayOf_(dateStr) === 0) return; // Sunday week-off
      var roll = rand();
      var status = 'Present';
      var note = '';
      var distance = Math.round(rand() * (project.radius * 0.8));
      if (holidayDates[dateStr]) return;
      if (roll > 0.94) return;                                  // no record at all
      if (roll > 0.90) { status = 'Absent'; note = 'Auto-marked absent at day close'; }
      else if (roll > 0.86) { status = 'Leave'; note = 'Approved casual leave'; }
      else if (roll > 0.83) { status = 'Flagged'; distance = project.radius + 200 + Math.round(rand() * 900);
        note = 'Outside the site geofence — ' + distance + ' m from the site (limit ' + project.radius + ' m)'; }
      else if (roll > 0.80) { status = 'HalfDay'; note = 'Left early for medical reason'; }

      var inHour = 6 + Math.floor(rand() * 4);
      var inMin = Math.floor(rand() * 60);
      var late = inHour >= 10 && inMin > 30;
      var markedAt = dateStr + ' ' + ('0' + inHour).slice(-2) + ':' + ('0' + inMin).slice(-2) + ':00';
      var outHour = status === 'HalfDay' ? 14 : 18 + Math.floor(rand() * 3);
      var outMin = Math.floor(rand() * 60);
      var markedOut = (status === 'Present' || status === 'HalfDay' || late) && rand() > 0.25
        ? dateStr + ' ' + ('0' + outHour).slice(-2) + ':' + ('0' + outMin).slice(-2) + ':00' : '';
      var hours = markedOut ? Math.max(0, (outHour + outMin / 60) - (inHour + inMin / 60)) : 0;
      var ot = Math.max(0, Math.round((hours - 9) * 2) / 2);

      attendanceRows.push({
        AttendanceID: id_('ATT'), UserID: a.UserID, ProjectID: a.ProjectID, Date: dateStr,
        MarkedAt: markedAt,
        Lat: String(project.lat + (rand() - 0.5) * 0.002), Long: String(project.lng + (rand() - 0.5) * 0.002),
        DistanceFromSite: status === 'Absent' || status === 'Leave' ? '' : String(distance),
        SelfieDriveLink: '', SelfieFileId: '', Status: status, DeviceID: '',
        ReviewedBy: status === 'Flagged' ? '' : (status === 'Absent' ? 'system' : ''),
        ReviewNote: note, MarkedOutAt: markedOut, OutLat: '', OutLong: '',
        HoursWorked: hours ? String(Math.round(hours * 100) / 100) : '',
        OvertimeHours: ot ? String(ot) : '', LateMark: late && status === 'Present' ? 'Y' : 'N',
        Source: status === 'Absent' ? 'System' : 'GPS',
        CapturedAt: dateStr + 'T' + ('0' + inHour).slice(-2) + ':' + ('0' + inMin).slice(-2) + ':00+05:30',
        SyncedAt: markedAt, FlagReason: status === 'Flagged' ? note : '',
        AccuracyMeters: String(5 + Math.round(rand() * 25)), CreatedAt: fmtDateTime_(new Date())
      });
    });
  });
  appendRecords_(companySS, 'Attendance', attendanceRows);

  /* ---- leave / expense / transfer / regularization --------------------- */
  appendRecords_(companySS, 'LeaveRequests', [
    { LeaveID: id_('LV'), UserID: 'EMP-DEMO-003', FromDate: shiftDate_(today_(), 2),
      ToDate: shiftDate_(today_(), 3), Type: 'Casual', Reason: 'Family function in Nashik',
      Status: 'Pending', AppliedAt: fmtDateTime_(new Date()), Days: '2' },
    { LeaveID: id_('LV'), UserID: 'EMP-DEMO-005', FromDate: shiftDate_(today_(), -8),
      ToDate: shiftDate_(today_(), -6), Type: 'Sick', Reason: 'Viral fever, doctor advised rest',
      Status: 'Approved', ApprovedBy: 'ADM-DEMO-001', AppliedAt: fmtDateTime_(new Date()),
      Days: '3', ReviewedAt: fmtDateTime_(new Date()), ReviewNote: 'Approved — medical certificate received' },
    { LeaveID: id_('LV'), UserID: 'EMP-DEMO-006', FromDate: shiftDate_(today_(), -3),
      ToDate: shiftDate_(today_(), -3), Type: 'Unpaid', Reason: 'Personal work',
      Status: 'Rejected', ApprovedBy: 'ADM-DEMO-001', AppliedAt: fmtDateTime_(new Date()),
      Days: '1', ReviewedAt: fmtDateTime_(new Date()), ReviewNote: 'Critical pour scheduled that day' }
  ]);

  appendRecords_(companySS, 'ExpenseRequests', [
    { ExpenseID: id_('EXP'), UserID: 'EMP-DEMO-001', ProjectID: 'PRJ-DEMO01', Amount: '1450',
      Category: 'Travel', Description: 'Taxi fare — client meeting at Andheri site, 2 trips',
      Status: 'Pending', PayoutStatus: 'Pending', AppliedAt: fmtDateTime_(new Date()), ReceiptNo: 'TX-8841' },
    { ExpenseID: id_('EXP'), UserID: 'EMP-DEMO-004', ProjectID: 'PRJ-DEMO02', Amount: '3200',
      Category: 'Material', Description: 'Emergency purchase of MCBs and wiring from local vendor',
      Status: 'Approved', PayoutStatus: 'Pending', ApprovedBy: 'ADM-DEMO-001',
      AppliedAt: fmtDateTime_(new Date()), ReviewedAt: fmtDateTime_(new Date()), ReceiptNo: 'INV-2290' },
    { ExpenseID: id_('EXP'), UserID: 'EMP-DEMO-002', ProjectID: 'PRJ-DEMO01', Amount: '860',
      Category: 'Food', Description: 'Overtime dinner for 6 workers during night shift',
      Status: 'Approved', PayoutStatus: 'Pending', ApprovedBy: 'SA-DEMO-001',
      AppliedAt: fmtDateTime_(new Date()), ReviewedAt: fmtDateTime_(new Date()), ReceiptNo: 'BL-771' }
  ]);

  appendRecords_(companySS, 'SiteTransfers', [
    { TransferID: id_('TRF'), UserID: 'EMP-DEMO-006', FromProjectID: 'PRJ-DEMO02',
      ToProjectID: 'PRJ-DEMO01', EffectiveDate: shiftDate_(today_(), 3), TravelPaid: 'Y',
      Status: 'Pending', Reason: 'Carpentry work finishing at BKC; manpower needed at Andheri',
      RoleOnSite: 'Helper', AppliedAt: fmtDateTime_(new Date()) }
  ]);

  appendRecords_(companySS, 'RegularizationRequests', [
    { RequestID: id_('REG'), UserID: 'EMP-DEMO-003', ProjectID: 'PRJ-DEMO01',
      Date: shiftDate_(today_(), -2), RequestedStatus: 'Present',
      Reason: 'Phone battery died before check-out; I was on site till 7 PM (supervisor can confirm)',
      Status: 'Pending', AppliedAt: fmtDateTime_(new Date()), InTime: '08:40', OutTime: '19:00' }
  ]);

  /* ---- vendors + worker entries ---------------------------------------- */
  var vendors = [
    { VendorID: 'VND-DEMO01', VendorName: 'Shree Labour Contractors', ContactPerson: 'Dinesh Pal',
      Mobile: '+919820111222', ProjectIDs: 'PRJ-DEMO01,PRJ-DEMO02', Status: 'Active',
      GST: '27AABCS1234C1Z9', Address: 'Kurla West, Mumbai', Email: 'shree.labour@example.com',
      RatePerHead: '650', PaymentTerms: 'Weekly settlement', CreatedAt: fmtDateTime_(new Date()) },
    { VendorID: 'VND-DEMO02', VendorName: 'Apex Scaffolding Works', ContactPerson: 'Farukh Ali',
      Mobile: '+919820333444', ProjectIDs: 'PRJ-DEMO03', Status: 'Active',
      GST: '27AACCA5678D1Z2', Address: 'Bhiwandi, Thane', Email: 'apex.scaffold@example.com',
      RatePerHead: '780', PaymentTerms: 'Monthly against bill', CreatedAt: fmtDateTime_(new Date()) }
  ];
  appendRecords_(companySS, 'Vendors', vendors);

  var workerRows = [];
  var workerNames = ['Ramesh Bind', 'Sunil Koli', 'Arjun Paswan', 'Nitin Jadhav', 'Karan Bhatia',
    'Manoj Tiwari', 'Santosh Wagh', 'Pintu Das'];
  dateRange_(shiftDate_(today_(), -9), today_()).forEach(function (dateStr) {
    if (weekdayOf_(dateStr) === 0) return;
    workerNames.slice(0, 3 + Math.floor(rand() * 4)).forEach(function (nm, i) {
      var vendorId = i % 3 === 0 ? 'VND-DEMO02' : 'VND-DEMO01';
      var projectId = vendorId === 'VND-DEMO02' ? 'PRJ-DEMO03' : (i % 2 === 0 ? 'PRJ-DEMO01' : 'PRJ-DEMO02');
      workerRows.push({
        EntryID: id_('VW'), VendorID: vendorId, ProjectID: projectId, WorkerName: nm,
        Designation: i % 2 === 0 ? 'Helper' : 'Mason', Date: dateStr, Count: '1',
        MarkedBy: 'EMP-DEMO-001', Mobile: '+9198' + String(20000000 + Math.floor(rand() * 79999999)).slice(0, 8),
        RatePerDay: vendorId === 'VND-DEMO02' ? '780' : '650',
        AmountPayable: vendorId === 'VND-DEMO02' ? '780' : '650',
        Status: 'Active', CreatedAt: fmtDateTime_(new Date())
      });
    });
  });
  appendRecords_(companySS, 'VendorWorkers', workerRows);

  /* ---- documents ------------------------------------------------------- */
  appendRecords_(companySS, 'Documents', [
    { DocID: id_('DOC'), UserID: 'EMP-DEMO-001', DocType: 'SafetyCertificate', DriveLink: '',
      FileId: '', FileName: 'safety-cert-suresh.pdf', ExpiryDate: shiftDate_(today_(), 9),
      Status: 'ExpiringSoon', UploadedBy: 'SA-DEMO-001', UploadedAt: fmtDateTime_(new Date()),
      ExpiryAlertDays: '15', Notes: 'Renewal reminder active' },
    { DocID: id_('DOC'), UserID: 'EMP-DEMO-004', DocType: 'MedicalFitness', DriveLink: '',
      FileId: '', FileName: 'medical-ravi.pdf', ExpiryDate: shiftDate_(today_(), -4),
      Status: 'Expired', UploadedBy: 'SA-DEMO-001', UploadedAt: fmtDateTime_(new Date()),
      ExpiryAlertDays: '15', Notes: 'Worker must renew before electrical work' },
    { DocID: id_('DOC'), UserID: 'EMP-DEMO-002', DocType: 'AadhaarCard', DriveLink: '',
      FileId: '', FileName: 'aadhaar-imran.jpg', ExpiryDate: '', Status: 'Valid',
      UploadedBy: 'SA-DEMO-001', UploadedAt: fmtDateTime_(new Date()), ExpiryAlertDays: '15' },
    { DocID: id_('DOC'), UserID: 'EMP-DEMO-005', DocType: 'SkillCertificate', DriveLink: '',
      FileId: '', FileName: 'skill-deepak.pdf', ExpiryDate: shiftDate_(today_(), 180),
      Status: 'Valid', UploadedBy: 'SA-DEMO-001', UploadedAt: fmtDateTime_(new Date()), ExpiryAlertDays: '30' }
  ]);

  /* ---- notifications + audit trail ------------------------------------- */
  appendRecords_(companySS, 'Notifications', [
    { NotifID: id_('NTF'), UserID: 'SA-DEMO-001', Title: 'Welcome to SiteTrack',
      Message: 'Your demo tenant is ready. Explore the dashboard, approvals centre and payroll sheet.',
      Type: 'System', Read: 'N', CreatedAt: fmtDateTime_(new Date()), Priority: 'Normal' },
    { NotifID: id_('NTF'), UserID: 'ADM-DEMO-001', Title: '3 approvals pending',
      Message: 'Leave, expense and transfer requests are waiting in the Approvals Centre.',
      Type: 'Approval', Read: 'N', CreatedAt: fmtDateTime_(new Date()), Priority: 'High' },
    { NotifID: id_('NTF'), UserID: 'EMP-DEMO-001', Title: 'Safety certificate expiring',
      Message: 'Your safety certificate expires in 9 days. Submit the renewed copy.',
      Type: 'Expiry', Read: 'N', CreatedAt: fmtDateTime_(new Date()), Priority: 'High' }
  ]);

  appendRecord_(companySS, 'AuditLog', {
    LogID: id_('LOG'), ActorUserID: 'seed', ActorName: 'Seed Script', ActorRole: 'System',
    CompanyID: companyId, Action: 'DEMO_SEEDED', TargetEntity: 'Company', EntityID: companyId,
    Timestamp: fmtDateTime_(new Date()),
    Details: jsonString_({ projects: projectSeeds.length, users: users.length,
      attendance: attendanceRows.length, vendors: vendors.length, vendorWorkers: workerRows.length }),
    Result: 'OK'
  });

  setProp_(PROP.DEMO_SEEDED, companyId);

  return {
    companyId: companyId,
    companyName: companyName,
    sheetId: companySS.getId(),
    sheetUrl: sheetUrl_(companySS.getId()),
    seeded: {
      projects: projectSeeds.length, users: users.length, assignments: assignments.length,
      attendance: attendanceRows.length, leaves: 3, expenses: 3, transfers: 1,
      vendors: vendors.length, vendorWorkers: workerRows.length, holidays: holidays.length,
      shifts: shifts.length, documents: 4
    },
    credentials: [
      { role: 'SuperAdmin', userId: 'SA-DEMO-001', mobile: '+919800000000',
        email: superAdminEmail, password: password },
      { role: 'Admin', userId: 'ADM-DEMO-001', mobile: '+919800000001', password: password },
      { role: 'SubAdmin (HR, project 1 only)', userId: 'SUB-DEMO-001', mobile: '+919800000002', password: password },
      { role: 'Employee (Supervisor)', userId: 'EMP-DEMO-001', mobile: '+919800000011', password: password },
      { role: 'Employee (Helper)', userId: 'EMP-DEMO-006', mobile: '+919800000016', password: password }
    ]
  };
}
