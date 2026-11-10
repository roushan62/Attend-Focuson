/**
 * FocusOn HRMS 2.0 — Configuration & Constants (00_Config.gs)
 *
 * Single company (FocusOn) with multiple branches / sites / departments.
 * Everything that can be tuned without editing logic lives here.
 * NOTE: Apps Script has no module system — these are globals (intended).
 */

/** Application identity */
var APP = {
  name: 'FocusOn HRMS 2.0',
  shortName: 'FocusOn',
  version: '2.0.0',
  companyName: 'FocusOn',
  primaryColor: '#4F46E5',   // indigo — overridable via Settings
  logoFileId: ''
};

/** Script Property keys (persisted state) */
var PROP = {
  DB_CORE: 'DB_CORE',           // Core DB spreadsheet ID
  ROOT_FOLDER: 'ROOT_FOLDER',   // Drive root folder ID (attachments, backups)
  DB_ATT_PREFIX: 'DB_ATT_',     // + year -> attendance spreadsheet ID
  DB_LOG_PREFIX: 'DB_LOG_',     // + year -> logs spreadsheet ID
  COUNTER_PREFIX: 'CNT_',       // + counter name -> next sequential number
  ACL_VER: 'ACL_VER',           // permission-map cache version (bump on RBAC change)
  SETUP_DONE: 'SETUP_DONE',
  SUPER_ADMINS: 'SUPER_ADMINS', // comma-separated userIds
  INITIAL_ADMIN_PASSWORD: 'INITIAL_ADMIN_PASSWORD'
};

/** Session / security defaults */
var SEC = {
  sessionHours: 12,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  otpMinutes: 10,
  passwordMinLength: 8,
  maxSessionsPerUser: 5,
  cookieName: 'focuson_token'
};

/** Statutory defaults (editable via Settings; verify with CA before go-live) */
var STATUTORY = {
  pf: { employeeRate: 0.12, employerRate: 0.12, wageCeiling: 15000, epsRate: 0.0833, epsMax: 1250 },
  esi: { employeeRate: 0.0075, employerRate: 0.0325, wageCeiling: 21000 },
  gratuity: { ratePerYear: 15 / 26, eligibleYears: 5, cap: 2000000 },
  tds: { standardDeduction: 75000, rebateLimit: 1200000, rebateMax: 12500, cessRate: 0.04 },
  otMultiplier: 2,
  lateRule: { latesForHalfDay: 3 },
  compOffExpiryDays: 90,
  selfieRetentionDays: 90,
  notificationRetentionDays: 60,
  rejectedCandidateRetentionMonths: 12
};

/** Payroll divisor options */
var DIVISOR_OPTIONS = ['CALENDAR', 'FIXED_30', 'FIXED_26', 'WORKING_DAYS'];

/** Leave year (Financial year April–March) */
var LEAVE_YEAR_START = { month: 4, day: 1 };

/** Attendance codes */
var ATT_CODES = {
  P: 'Present', L: 'Late', H: 'Half day', V: 'Paid leave', U: 'Unpaid leave',
  S: 'On duty / tour', W: 'Weekly off', O: 'Holiday', A: 'Absent', X: 'Unresolved',
  F: 'Flagged', C: 'Comp off'
};

/** Scope levels for permissions */
var SCOPE_LEVELS = ['S', 'D', 'T', 'P', 'B', 'C', 'X']; // Self, Direct, Team, Dept, Branch, Company, Custom
var SCOPE_LABELS = {
  S: 'Self (khud)', D: 'Direct reports (seedhe report karne wale)',
  T: 'Team (poori downline)', P: 'Department (vibhag)',
  B: 'Branch (shakha)', C: 'Company (sabhi)', X: 'Custom list'
};

/** Permission categories -> module prefixes (for catalog & matrix) */
var PERM_MODULES = [
  'employee', 'field', 'org', 'user', 'role', 'override', 'authority', 'approval', 'workflow',
  'request', 'attendance', 'leave', 'payroll', 'advance', 'loan', 'expense', 'doc', 'recruit',
  'perf', 'exit', 'fnf', 'helpdesk', 'announce', 'calendar', 'report', 'settings', 'backup',
  'audit', 'system', 'integration'
];

/** Default request types & their built-in perm keys */
var REQUEST_TYPES = [
  'LEAVE', 'LEAVE_CANCEL', 'LEAVE_ENCASH', 'COMP_OFF', 'ATT_REG', 'ATT_EXCEPTION',
  'ON_DUTY', 'OVERTIME', 'ADVANCE', 'LOAN', 'EXPENSE', 'SALARY_REVISION', 'JOB_OPENING',
  'OFFER', 'RESIGNATION', 'FNF', 'DOC_REQUEST', 'LETTER_APPROVAL', 'PROFILE_CHANGE',
  'TRANSFER', 'PAYROLL_REOPEN', 'ROLE_CHANGE', 'GENERAL'
];

/** Preset roles */
var PRESET_ROLES = [
  { id: 'SUPER_ADMIN', name: 'Super Admin', base: false, desc: 'System owner (max 2)' },
  { id: 'ADMIN', name: 'Admin', base: false, desc: 'Company administrator' },
  { id: 'HR', name: 'HR Manager', base: false, desc: 'HR & people operations' },
  { id: 'ACCOUNTS', name: 'Accounts / Payroll', base: false, desc: 'Payroll verify/release, finance' },
  { id: 'EXEC', name: 'Executive (CEO/Director)', base: false, desc: 'Leadership oversight & approvals' },
  { id: 'MANAGER', name: 'Manager', base: false, desc: 'Department head' },
  { id: 'SUPERVISOR', name: 'Supervisor', base: false, desc: 'Site / team supervisor' },
  { id: 'EMPLOYEE', name: 'Employee (Base)', base: true, desc: 'Self-service — applies to every employee' }
];

/** Default attendance policies */
var DEFAULT_ATT_POLICIES = [
  { id: 'POL_OFFICE', name: 'Office (Geo-fenced)', type: 'Office', geoRadiusM: 100, selfie: false, blockOrFlag: 'flag', graceMins: 15, autoCheckout: true },
  { id: 'POL_SITE', name: 'Site / Field', type: 'Site', geoRadiusM: 0, selfie: false, blockOrFlag: 'none', graceMins: 0, autoCheckout: false },
  { id: 'POL_EXEMPT', name: 'Exempt / Flexible', type: 'Exempt', geoRadiusM: 0, selfie: false, blockOrFlag: 'none', graceMins: 0, autoCheckout: false }
];

/** Default shifts */
var DEFAULT_SHIFTS = [
  { id: 'SH_GEN', name: 'General', start: '09:00', end: '18:00', graceMins: 15, breakMins: 30, weeklyOff: [0] },
  { id: 'SH_NIGHT', name: 'Night', start: '22:00', end: '06:00', graceMins: 15, breakMins: 30, weeklyOff: [0] }
];

/** Error codes */
var ERR = {
  INVALID_ACTION: 'INVALID_ACTION',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  DUPLICATE: 'DUPLICATE',
  LOCKED: 'LOCKED',
  QUOTA: 'QUOTA',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT'
};

/** Row limits for batch reads/writes (quota safety) */
var BATCH = {
  maxReadRows: 50000,
  maxWriteRows: 5000,
  lockSeconds: 20
};

/** Default feature flags */
var DEFAULT_FEATURE_FLAGS = {
  recruitment: true, onboarding: true, performance: true, exit: true,
  expenses: true, loans: true, documents: true, helpdesk: true, announcements: true,
  compOff: true, overtime: true, onDuty: true, selfie: false, simpleMode: true,
  hindiESS: true, emailNotifications: true, payrollCEOApproval: true,
  saBreakGlass: false, rDash: true
};

/** Cron trigger name prefixes (must match installable triggers) */
var CRON = {
  hourly: 'cron_hourly_',
  daily: 'cron_daily_',
  nightly: 'cron_nightly_'
};

/** Cache TTL (seconds) */
var CACHE_TTL = {
  settings: 86400, roles: 3600, perms: 3600, org: 3600, employeeDir: 3600
};

/** RDash integration placeholder */
var RDASH = {
  enabled: false,
  mappingSheetName: 'RDash_Mapping',
  exportColumns: ['empId', 'empCode', 'name', 'designation', 'department', 'branch', 'mobile', 'email', 'status']
};

/** Quota guard: Gmail daily sends (free ~100; Workspace ~1500) */
var EMAIL = { dailyGuard: 90, digestHour: 9, digestMinute: 0 };
