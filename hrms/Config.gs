/**
 * ============================================================================
 *  FocusHR  —  Config.gs
 *  Application constants, sheet schema, permission presets, statutory defaults
 *  and the action registry (validation + permission metadata for every API).
 * ============================================================================
 */

var APP = {
  name: 'FocusHR',
  tagline: 'HR, Attendance & Payroll for Indian teams',
  version: '1.0.0',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  locale: 'en-IN',
  // security / session
  sessionAbsoluteHours: 8,
  sessionIdleMinutes: 30,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendCooldownSec: 45,
  passwordMinLength: 8,
  passwordIterations: 600,
  loginMaxAttempts: 5,
  loginLockMinutes: 15,
  rateLimitLoginPerHour: 30,
  rateLimitOtpPerHour: 10,
  // geo attendance
  defaultRadiusM: 50,
  maxGpsAccuracyM: 100,
  spoofMaxAccuracyM: 1500,
  // files
  maxUploadBytes: 8 * 1024 * 1024,
  chunkBytes: 60000,
  chunkCharsBase64: 80000,
  maxUploadChunks: 200,
  // payroll
  payrollChunkSize: 50,
  payrollMonthCap: 2000,
  // lists
  defaultPageSize: 25,
  pageSizes: [10, 25, 50, 100],
  maxPageSize: 200
};

// Sheet columns appended to every table.
var AUD_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted', 'deleted_by', 'deleted_at'];

var STATUS = {
  COMPANY: ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'],
  USER: ['ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING'],
  EMPLOYEE: ['ACTIVE', 'PROBATION', 'NOTICE', 'EXITED', 'INACTIVE'],
  PROJECT: ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  APPROVAL: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  ATTENDANCE: ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'OD', 'MISSING_PUNCH'],
  PAYROLL_RUN: ['DRAFT', 'PROCESSING', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED'],
  PAYROLL_ITEM: ['CALCULATED', 'APPROVED', 'HOLD', 'PAID'],
  CLAIM: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'],
  TICKET: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
  DOC_VISIBILITY: ['PRIVATE', 'HR', 'COMPANY', 'PUBLIC_LINK'],
  TRANSFER: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'],
  DATA_SCOPE: ['ALL', 'PROJECT', 'TEAM', 'SELF']
};

/* ---------------------------------------------------------------- schema ---
 * Every table: which spreadsheet it lives in (MASTER = one platform sheet,
 * COMPANY = one sheet per tenant), its business columns (AUD columns are
 * appended automatically) and the columns used by global search.
 * ------------------------------------------------------------------------ */
var SCHEMA = {
  /* ============================ MASTER (platform) sheet ================= */
  Companies: {
    scope: 'MASTER', prefix: 'CMP', search: ['name', 'legal_name', 'gstin', 'city', 'contact_email', 'contact_phone'],
    cols: ['company_id', 'name', 'legal_name', 'gstin', 'pan', 'state_code', 'state', 'city', 'address', 'pincode',
      'contact_name', 'contact_email', 'contact_phone', 'industry', 'company_size', 'plan', 'status', 'verification_mode',
      'verification_remark', 'spreadsheet_id', 'drive_folder_id', 'logo_file_id', 'brand_color', 'admin_name',
      'admin_email', 'admin_phone', 'admin_user_id', 'approved_at', 'trial_ends_at', 'subscription_ends_at', 'notes']
  },
  Users: {
    scope: 'MASTER', prefix: 'USR', search: ['name', 'email', 'phone'],
    cols: ['user_id', 'scope', 'company_id', 'employee_id', 'name', 'email', 'phone', 'password_hash', 'password_salt',
      'password_set_at', 'must_change_password', 'status', 'failed_attempts', 'locked_until', 'last_login_at',
      'activation_code_hash', 'activation_expires_at', 'activation_attempts', 'role_code', 'meta_json']
  },
  Sessions: {
    scope: 'MASTER', search: [],
    cols: ['session_id', 'token_hash', 'user_id', 'scope', 'company_id', 'employee_id', 'role_code', 'name', 'ip',
      'user_agent', 'issued_at', 'last_seen_at', 'expires_at', 'ended_at', 'ended_reason', 'impersonated_by']
  },
  OtpCodes: {
    scope: 'MASTER', search: ['identifier'],
    cols: ['otp_id', 'purpose', 'identifier', 'user_id', 'company_id', 'code_hash', 'expires_at', 'attempts',
      'max_attempts', 'consumed_at', 'ip', 'meta_json']
  },
  Subscriptions: {
    scope: 'MASTER', prefix: 'SUB', search: ['company_id', 'plan', 'status'],
    cols: ['subscription_id', 'company_id', 'plan', 'seats', 'price_per_seat', 'billing_cycle', 'started_at', 'ends_at',
      'status', 'auto_renew', 'notes']
  },
  Revenue: {
    scope: 'MASTER', prefix: 'INV', search: ['company_id', 'invoice_no', 'reference'],
    cols: ['revenue_id', 'company_id', 'invoice_no', 'amount', 'tax_amount', 'total_amount', 'period_from', 'period_to',
      'paid_at', 'payment_mode', 'reference', 'status', 'notes']
  },
  SystemConfig: {
    scope: 'MASTER', search: ['config_key', 'label'],
    cols: ['config_key', 'config_value', 'value_type', 'group_name', 'label', 'description', 'is_secret']
  },
  SuperTickets: {
    scope: 'MASTER', prefix: 'STK', search: ['subject', 'company_id', 'raised_by_name'],
    cols: ['ticket_id', 'company_id', 'raised_by_user_id', 'raised_by_name', 'subject', 'category', 'priority',
      'status', 'assigned_to', 'last_reply_at', 'closed_at', 'resolution']
  },
  SuperTicketComments: {
    scope: 'MASTER', prefix: 'SCM', search: ['ticket_id'],
    cols: ['comment_id', 'ticket_id', 'author_user_id', 'author_name', 'author_scope', 'body', 'is_internal']
  },
  EmailQueue: {
    scope: 'MASTER', prefix: 'EMQ', search: ['to_email', 'subject'],
    cols: ['queue_id', 'to_email', 'cc', 'subject', 'body_html', 'status', 'attempts', 'last_error', 'sent_at',
      'related_type', 'related_id']
  },
  AuditLog: {
    scope: 'MASTER', prefix: 'SAU', search: ['action', 'module', 'entity', 'actor_name', 'company_id'],
    cols: ['audit_id', 'actor_user_id', 'actor_name', 'actor_scope', 'company_id', 'action', 'module', 'entity',
      'entity_id', 'before_json', 'after_json', 'note', 'ip', 'user_agent', 'severity']
  },
  Logs: {
    scope: 'MASTER', prefix: 'LOG', search: ['level', 'source', 'message'],
    cols: ['log_id', 'level', 'source', 'message', 'context_json']
  },
  Notifications: {
    scope: 'MASTER', prefix: 'SNT', search: ['title', 'user_id'],
    cols: ['notification_id', 'user_id', 'company_id', 'title', 'body', 'kind', 'link_action', 'link_payload_json',
      'is_read', 'read_at']
  },
  Counters: {
    scope: 'MASTER', search: ['key'],
    cols: ['key', 'prefix', 'next_no', 'width', 'note']
  },

  /* ============================ per-company sheet ====================== */
  Settings: {
    scope: 'COMPANY', search: ['key', 'group_name', 'label'],
    cols: ['setting_id', 'key', 'value', 'value_type', 'group_name', 'label', 'description', 'effective_from', 'version']
  },
  Branches: {
    scope: 'COMPANY', prefix: 'BRN', search: ['name', 'code', 'city', 'state', 'incharge_name'],
    cols: ['branch_id', 'name', 'code', 'address', 'city', 'state', 'pincode', 'phone', 'incharge_name', 'latitude',
      'longitude', 'is_active', 'note']
  },
  Roles: {
    scope: 'COMPANY', prefix: 'ROL', search: ['code', 'name'],
    cols: ['role_id', 'code', 'name', 'description', 'data_scope', 'is_system', 'level', 'is_active']
  },
  RolePermissions: {
    scope: 'COMPANY', search: ['role_id', 'module'],
    cols: ['perm_id', 'role_id', 'role_code', 'module', 'action', 'allowed', 'limit_value']
  },
  UserPermissionOverrides: {
    scope: 'COMPANY', prefix: 'OVR', search: ['user_id', 'module', 'status'],
    cols: ['override_id', 'user_id', 'employee_id', 'module', 'action', 'allowed', 'reason', 'requested_by',
      'granted_by', 'granted_at', 'expires_at', 'status']
  },
  Employees: {
    scope: 'COMPANY', prefix: 'EMP', search: ['name', 'code', 'phone', 'email', 'department', 'designation', 'city'],
    cols: ['employee_id', 'code', 'user_id', 'name', 'gender', 'dob', 'joining_date', 'exit_date', 'exit_reason',
      'fnf_flag', 'status', 'department', 'designation', 'branch_id', 'project_id', 'manager_id', 'employment_type',
      'work_state', 'phone', 'alt_phone', 'email', 'address', 'city', 'state', 'pincode', 'emergency_name',
      'emergency_phone', 'blood_group', 'pan', 'aadhaar_last4', 'aadhaar_file_id', 'bank_name', 'bank_account',
      'bank_ifsc', 'bank_holder', 'pf_applicable', 'pf_uan', 'pf_ceiling_opt', 'esic_applicable', 'esic_ip_no',
      'pt_applicable', 'tds_applicable', 'ctc_monthly', 'photo_file_id', 'remarks']
  },
  EmployeeDocuments: {
    scope: 'COMPANY', prefix: 'EDC', search: ['employee_id', 'doc_type', 'doc_name'],
    cols: ['doc_id', 'employee_id', 'doc_type', 'doc_name', 'file_id', 'file_name', 'mime_type', 'size_bytes',
      'issued_date', 'expiry_date', 'verified', 'verified_by', 'verified_at', 'note']
  },
  SalaryStructures: {
    scope: 'COMPANY', prefix: 'SAL', search: ['employee_id'],
    cols: ['structure_id', 'employee_id', 'effective_from', 'basic', 'hra', 'da', 'conveyance', 'special_allowance',
      'other_allowance', 'overtime_rate', 'pf_employee_pct', 'pf_employer_pct', 'esic_employee_pct', 'esic_employer_pct',
      'pt_state', 'tds_regime', 'is_active', 'note']
  },
  Projects: {
    scope: 'COMPANY', prefix: 'PRJ', search: ['name', 'code', 'client_name', 'city', 'incharge_name'],
    cols: ['project_id', 'code', 'name', 'client_name', 'site_address', 'city', 'state', 'pincode', 'latitude',
      'longitude', 'radius_m', 'location_locked', 'start_date', 'end_date', 'status', 'incharge_employee_id',
      'incharge_name', 'budget_amount', 'shift_start', 'shift_end', 'weekly_off', 'notes']
  },
  ProjectAssignments: {
    scope: 'COMPANY', prefix: 'ASG', search: ['employee_id', 'project_id', 'role_on_site'],
    cols: ['assignment_id', 'project_id', 'employee_id', 'employee_name', 'role_on_site', 'from_date', 'to_date',
      'status', 'is_primary', 'daily_wage', 'note']
  },
  TransferRequests: {
    scope: 'COMPANY', prefix: 'TRF', search: ['employee_id', 'status'],
    cols: ['transfer_id', 'employee_id', 'employee_name', 'from_project_id', 'to_project_id', 'reason',
      'effective_date', 'status', 'decided_by', 'decided_by_name', 'decided_at', 'decision_remark']
  },
  Attendance: {
    scope: 'COMPANY', prefix: 'ATT', search: ['employee_id', 'employee_name', 'date', 'status', 'source', 'project_id'],
    cols: ['attendance_id', 'employee_id', 'employee_code', 'employee_name', 'date', 'project_id', 'project_name',
      'status', 'in_time', 'out_time', 'worked_minutes', 'shift_minutes', 'late_minutes', 'early_minutes',
      'overtime_minutes', 'source', 'in_lat', 'in_lng', 'in_accuracy_m', 'in_distance_m', 'out_lat', 'out_lng',
      'out_accuracy_m', 'out_distance_m', 'device_json', 'flagged', 'flag_reason', 'remark', 'regularization_id',
      'payroll_locked']
  },
  AttendanceRegularization: {
    scope: 'COMPANY', prefix: 'REG', search: ['employee_id', 'employee_name', 'date', 'status'],
    cols: ['request_id', 'employee_id', 'employee_name', 'date', 'requested_status', 'requested_in', 'requested_out',
      'reason', 'status', 'decided_by', 'decided_by_name', 'decided_at', 'decision_remark', 'attendance_id']
  },
  LeaveTypes: {
    scope: 'COMPANY', prefix: 'LVT', search: ['code', 'name'],
    cols: ['leave_type_id', 'code', 'name', 'is_paid', 'accrual_per_month', 'max_balance', 'carry_forward',
      'requires_doc', 'max_consecutive_days', 'color', 'is_active', 'sort_order', 'note']
  },
  LeaveBalances: {
    scope: 'COMPANY', prefix: 'LVB', search: ['employee_id', 'fy'],
    cols: ['balance_id', 'employee_id', 'employee_name', 'leave_type_id', 'leave_type_code', 'fy', 'opening', 'accrued',
      'used', 'lapsed', 'closing', 'note']
  },
  LeaveRequests: {
    scope: 'COMPANY', prefix: 'LVR', search: ['employee_id', 'employee_name', 'status', 'from_date'],
    cols: ['request_id', 'employee_id', 'employee_code', 'employee_name', 'leave_type_id', 'leave_type_name',
      'from_date', 'to_date', 'days', 'is_half_day', 'half_day_session', 'reason', 'contact_during_leave', 'status',
      'applied_at', 'decided_by', 'decided_by_name', 'decided_at', 'decision_remark', 'attachment_file_id',
      'cancel_reason', 'fy']
  },
  SpecialRequests: {
    scope: 'COMPANY', prefix: 'SPR', search: ['employee_id', 'employee_name', 'kind', 'status'],
    cols: ['request_id', 'employee_id', 'employee_name', 'kind', 'title', 'from_date', 'to_date', 'amount',
      'details_json', 'reason', 'status', 'applied_at', 'decided_by', 'decided_by_name', 'decided_at',
      'decision_remark']
  },
  Holidays: {
    scope: 'COMPANY', prefix: 'HOL', search: ['name', 'date', 'region'],
    cols: ['holiday_id', 'name', 'date', 'kind', 'region', 'branch_id', 'is_paid', 'note']
  },
  ExpenseCategories: {
    scope: 'COMPANY', prefix: 'EXC', search: ['code', 'name'],
    cols: ['category_id', 'code', 'name', 'max_amount', 'requires_bill', 'is_taxable', 'is_active', 'sort_order',
      'gl_code', 'note']
  },
  ExpenseClaims: {
    scope: 'COMPANY', prefix: 'CLM', search: ['code', 'employee_name', 'status', 'claim_date'],
    cols: ['claim_id', 'code', 'employee_id', 'employee_name', 'category_id', 'category_name', 'claim_date',
      'from_date', 'to_date', 'amount', 'tax_amount', 'total_amount', 'advance_amount', 'net_amount', 'description',
      'items_json', 'bill_count', 'bill_file_ids', 'status', 'submitted_at', 'decided_by', 'decided_by_name',
      'decided_at', 'decision_remark', 'paid_at', 'payroll_run_id', 'payroll_item_id', 'idempotency_key']
  },
  PayrollRuns: {
    scope: 'COMPANY', prefix: 'PYR', search: ['code', 'fy', 'month', 'status', 'title'],
    cols: ['run_id', 'code', 'fy', 'month', 'period_from', 'period_to', 'days_basis', 'title', 'status', 'created_note',
      'total_employees', 'total_gross', 'total_deductions', 'total_net', 'total_employer_cost', 'chunk_index',
      'chunk_total', 'progress_json', 'calculated_at', 'approved_by', 'approved_by_name', 'approved_at',
      'approval_remark', 'paid_at', 'payment_reference', 'payment_mode', 'payslips_generated', 'cancelled_reason',
      'notes']
  },
  PayrollItems: {
    scope: 'COMPANY', prefix: 'PYI', search: ['run_id', 'employee_name', 'employee_code', 'status'],
    cols: ['item_id', 'run_id', 'employee_id', 'employee_code', 'employee_name', 'department', 'project_id',
      'present_days', 'paid_days', 'lop_days', 'leave_days', 'holiday_days', 'weekly_off_days', 'ot_hours',
      'basic', 'hra', 'da', 'conveyance', 'special_allowance', 'other_allowance', 'bonus', 'incentive',
      'gross_earnings', 'reimbursement', 'pf_wage', 'pf_employee', 'pf_employer', 'esic_wage', 'esic_employee',
      'esic_employer', 'pt', 'tds', 'advance_recovery', 'other_deduction', 'total_deductions', 'net_pay', 'ctc_cost',
      'claim_ids', 'project_days_json', 'status', 'hold_reason', 'payslip_id', 'calc_notes', 'rates_json']
  },
  Payslips: {
    scope: 'COMPANY', prefix: 'PSL', search: ['code', 'employee_name', 'fy', 'month'],
    cols: ['payslip_id', 'code', 'run_id', 'employee_id', 'employee_code', 'employee_name', 'fy', 'month', 'template',
      'gross', 'deductions', 'net_pay', 'file_id', 'file_name', 'html_file_id', 'generated_at', 'emailed_at',
      'viewed_at', 'note']
  },
  Documents: {
    scope: 'COMPANY', prefix: 'DOC', search: ['title', 'owner_type', 'category', 'file_name'],
    cols: ['doc_id', 'parent_doc_id', 'owner_type', 'owner_id', 'owner_name', 'category', 'title', 'file_id',
      'file_name', 'mime_type', 'size_bytes', 'version', 'is_latest', 'visibility', 'expiry_date', 'note']
  },
  LetterTemplates: {
    scope: 'COMPANY', prefix: 'LTP', search: ['code', 'name', 'category'],
    cols: ['template_id', 'code', 'name', 'category', 'subject', 'body_html', 'is_active', 'note']
  },
  GeneratedLetters: {
    scope: 'COMPANY', prefix: 'LTR', search: ['letter_no', 'employee_name', 'subject'],
    cols: ['letter_id', 'template_id', 'employee_id', 'employee_name', 'letter_no', 'subject', 'body_html', 'file_id',
      'file_name', 'issued_date', 'issued_by', 'issued_by_name', 'status', 'note']
  },
  Tickets: {
    scope: 'COMPANY', prefix: 'TKT', search: ['code', 'subject', 'status', 'raised_by_name'],
    cols: ['ticket_id', 'code', 'raised_by_user_id', 'raised_by_name', 'employee_id', 'subject', 'category', 'priority',
      'status', 'assigned_to', 'assigned_name', 'last_reply_at', 'closed_at', 'resolution']
  },
  TicketComments: {
    scope: 'COMPANY', prefix: 'TCM', search: ['ticket_id'],
    cols: ['comment_id', 'ticket_id', 'author_user_id', 'author_name', 'body', 'is_internal']
  },
  DashboardLayouts: {
    scope: 'COMPANY', prefix: 'DSL', search: ['user_id', 'scope'],
    cols: ['layout_id', 'user_id', 'scope', 'layout_json', 'is_default']
  }
};

/* ------------------------------------------------------- ID prefixes ----- */
var ID_PREFIX = (function () {
  var map = {};
  Object.keys(SCHEMA).forEach(function (t) {
    var s = SCHEMA[t];
    if (s.prefix) map[t] = s.prefix;
  });
  return map;
})();

/* --------------------------------------------------------- permissions --- */
var PERM_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'];

var MODULES = [
  { key: 'dashboard', label: 'Dashboard', actions: ['view', 'export'] },
  { key: 'employees', label: 'Employees', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'projects', label: 'Projects & Sites', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { key: 'attendance', label: 'Attendance', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { key: 'leave', label: 'Leave & Special Requests', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { key: 'expense', label: 'Expense Claims', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { key: 'payroll', label: 'Payroll & Payslips', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { key: 'documents', label: 'Documents & Letters', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'reports', label: 'Reports', actions: ['view', 'export'] },
  { key: 'support', label: 'Support Tickets', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'audit', label: 'Audit & Activity', actions: ['view', 'export'] },
  { key: 'settings', label: 'Company Settings', actions: ['view', 'edit', 'manage'] },
  { key: 'branches', label: 'Branches', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users', label: 'Users, Roles & Access', actions: ['view', 'create', 'edit', 'delete', 'manage'] }
];

/**
 * Default role presets. perms: '*' (everything) or { module: 'view,create,...' }.
 * data_scope: ALL | PROJECT | TEAM | SELF
 */
var ROLE_PRESETS = [
  {
    code: 'COMPANY_ADMIN', name: 'Company Admin', level: 1, data_scope: 'ALL', is_system: true,
    description: 'Full control of this company account, employees, payroll and settings.',
    perms: '*'
  },
  {
    code: 'HR_MANAGER', name: 'HR Manager', level: 2, data_scope: 'ALL', is_system: true,
    description: 'People operations: employees, attendance, leave, documents, reports.',
    perms: {
      dashboard: 'view,export', employees: 'view,create,edit,delete,export', projects: 'view,export',
      attendance: 'view,create,edit,delete,approve,export', leave: 'view,create,edit,approve,export',
      expense: 'view,approve,export', documents: 'view,create,edit,delete,export', reports: 'view,export',
      support: 'view,create,edit', audit: 'view', branches: 'view', users: 'view'
    }
  },
  {
    code: 'PROJECT_MANAGER', name: 'Project Manager', level: 3, data_scope: 'PROJECT', is_system: true,
    description: 'Runs sites: team attendance, leave approval, project documents.',
    perms: {
      dashboard: 'view', employees: 'view', projects: 'view,create,edit,export',
      attendance: 'view,create,edit,approve,export', leave: 'view,approve', expense: 'view,approve',
      documents: 'view,create', reports: 'view,export', support: 'view,create'
    }
  },
  {
    code: 'SUPERVISOR', name: 'Site Supervisor', level: 4, data_scope: 'TEAM', is_system: true,
    description: 'Marks attendance and shares site updates for the assigned team.',
    perms: {
      dashboard: 'view', employees: 'view', projects: 'view', attendance: 'view,create,edit,approve',
      leave: 'view,create', expense: 'view,create', support: 'view,create'
    }
  },
  {
    code: 'ACCOUNTANT', name: 'Accountant', level: 3, data_scope: 'ALL', is_system: true,
    description: 'Expenses, payroll run, statutory reports and export.',
    perms: {
      dashboard: 'view,export', employees: 'view,export', projects: 'view', attendance: 'view,export',
      leave: 'view', expense: 'view,create,edit,approve,export', payroll: 'view,create,edit,approve,export',
      reports: 'view,export', documents: 'view,create,export', support: 'view,create'
    }
  },
  {
    code: 'EMPLOYEE', name: 'Employee', level: 9, data_scope: 'SELF', is_system: true,
    description: 'Self service: punch in/out, leave, claims, payslips and profile.',
    perms: {
      dashboard: 'view', attendance: 'view,create', leave: 'view,create', expense: 'view,create',
      documents: 'view', payroll: 'view', support: 'view,create'
    }
  }
];

/* --------------------------------------------------- statutory defaults -- */
var PAYROLL_DEFAULTS = {
  pf_employee_pct: 12,
  pf_employer_pct: 12,
  pf_wage_ceiling: 15000,
  pf_ceiling_enabled: true,
  esic_employee_pct: 0.75,
  esic_employer_pct: 3.25,
  esic_wage_ceiling: 21000,
  pt_state: 'Maharashtra',
  tds_regime: 'NEW',
  standard_deduction_new: 75000,
  standard_deduction_old: 50000,
  rebate_87a_new: 1200000,
  rebate_87a_old: 500000,
  cess_pct: 4,
  ot_multiplier: 2,
  days_basis: 'CALENDAR',
  half_day_hours: 4,
  work_hours_per_day: 8
};

// Professional tax (monthly, simplified slab model). null upto = no upper limit.
var PT_SLABS = {
  'Maharashtra': [{ upto: 7500, amount: 0 }, { upto: 10000, amount: 175 }, { upto: null, amount: 200, feb_amount: 300 }],
  'Karnataka': [{ upto: 24999, amount: 0 }, { upto: null, amount: 200 }],
  'West Bengal': [{ upto: 10000, amount: 0 }, { upto: 15000, amount: 110 }, { upto: 25000, amount: 130 }, { upto: 40000, amount: 150 }, { upto: null, amount: 200 }],
  'Tamil Nadu': [{ upto: 21000, amount: 0 }, { upto: 30000, amount: 135 }, { upto: 45000, amount: 315 }, { upto: 60000, amount: 690 }, { upto: 75000, amount: 1025 }, { upto: null, amount: 1250 }],
  'Telangana': [{ upto: 15000, amount: 0 }, { upto: 20000, amount: 150 }, { upto: null, amount: 200 }],
  'Andhra Pradesh': [{ upto: 15000, amount: 0 }, { upto: 20000, amount: 150 }, { upto: null, amount: 200 }],
  'Gujarat': [{ upto: 12000, amount: 0 }, { upto: null, amount: 200 }],
  'Odisha': [{ upto: 13304, amount: 0 }, { upto: 25000, amount: 125 }, { upto: null, amount: 200 }],
  'Kerala': [{ upto: 11999, amount: 0 }, { upto: 17999, amount: 20 }, { upto: 29999, amount: 30 }, { upto: null, amount: 50 }],
  'Bihar': [{ upto: 300000, amount: 0 }, { upto: 500000, amount: 1000 }, { upto: 1000000, amount: 1500 }, { upto: null, amount: 2500, annual: true }],
  'Jharkhand': [{ upto: 25000, amount: 0 }, { upto: 41666, amount: 100 }, { upto: null, amount: 150 }],
  'Assam': [{ upto: 10000, amount: 0 }, { upto: 15000, amount: 150 }, { upto: 25000, amount: 180 }, { upto: null, amount: 208 }],
  'Madhya Pradesh': [{ upto: 18750, amount: 0 }, { upto: 25000, amount: 125 }, { upto: 33333, amount: 167 }, { upto: null, amount: 208 }],
  'Chhattisgarh': [{ upto: 12500, amount: 0 }, { upto: 16666, amount: 100 }, { upto: 25000, amount: 150 }, { upto: null, amount: 200 }],
  'Haryana': [{ upto: 1000, amount: 0 }, { upto: null, amount: 0 }],
  'Punjab': [{ upto: 20833, amount: 0 }, { upto: null, amount: 200 }],
  'Delhi': [{ upto: null, amount: 0 }]
};

var INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
  'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'];

/* --------------------------------------------------- company settings ---- */
var DEFAULT_SETTINGS = [
  { key: 'company.display_name', value: '', group_name: 'Company', value_type: 'string', label: 'Display name' },
  { key: 'company.legal_name', value: '', group_name: 'Company', value_type: 'string', label: 'Legal name' },
  { key: 'company.gstin', value: '', group_name: 'Company', value_type: 'string', label: 'GSTIN' },
  { key: 'company.pan', value: '', group_name: 'Company', value_type: 'string', label: 'PAN' },
  { key: 'company.address', value: '', group_name: 'Company', value_type: 'string', label: 'Registered address' },
  { key: 'company.city', value: '', group_name: 'Company', value_type: 'string', label: 'City' },
  { key: 'company.state', value: '', group_name: 'Company', value_type: 'string', label: 'State' },
  { key: 'company.pincode', value: '', group_name: 'Company', value_type: 'string', label: 'PIN code' },
  { key: 'company.brand_color', value: '#2563eb', group_name: 'Company', value_type: 'string', label: 'Brand colour' },
  { key: 'company.logo_file_id', value: '', group_name: 'Company', value_type: 'string', label: 'Logo file id' },
  { key: 'company.hr_contact_email', value: '', group_name: 'Company', value_type: 'string', label: 'HR contact email' },
  { key: 'attendance.radius_m', value: '50', group_name: 'Attendance', value_type: 'number', label: 'Default geo-fence radius (m)' },
  { key: 'attendance.max_accuracy_m', value: '100', group_name: 'Attendance', value_type: 'number', label: 'Max acceptable GPS accuracy (m)' },
  { key: 'attendance.spoof_accuracy_m', value: '1500', group_name: 'Attendance', value_type: 'number', label: 'Flag punches worse than (m)' },
  { key: 'attendance.work_hours_per_day', value: '8', group_name: 'Attendance', value_type: 'number', label: 'Standard hours per day' },
  { key: 'attendance.half_day_hours', value: '4', group_name: 'Attendance', value_type: 'number', label: 'Half day threshold (hours)' },
  { key: 'attendance.late_grace_minutes', value: '10', group_name: 'Attendance', value_type: 'number', label: 'Late grace (minutes)' },
  { key: 'attendance.shift_start', value: '09:00', group_name: 'Attendance', value_type: 'string', label: 'Default shift start' },
  { key: 'attendance.shift_end', value: '18:00', group_name: 'Attendance', value_type: 'string', label: 'Default shift end' },
  { key: 'attendance.weekly_off', value: 'SUNDAY', group_name: 'Attendance', value_type: 'string', label: 'Weekly off day' },
  { key: 'attendance.allow_regularization_days', value: '7', group_name: 'Attendance', value_type: 'number', label: 'Regularization window (days)' },
  { key: 'attendance.punch_out_required', value: 'TRUE', group_name: 'Attendance', value_type: 'boolean', label: 'Punch out required' },
  { key: 'leave.allow_negative_balance', value: 'FALSE', group_name: 'Leave', value_type: 'boolean', label: 'Allow negative leave balance' },
  { key: 'leave.min_notice_days', value: '0', group_name: 'Leave', value_type: 'number', label: 'Minimum notice (days)' },
  { key: 'leave.max_consecutive_days', value: '15', group_name: 'Leave', value_type: 'number', label: 'Maximum consecutive days' },
  { key: 'expense.max_without_bill', value: '500', group_name: 'Expense', value_type: 'number', label: 'Claim limit without bill (Rs)' },
  { key: 'expense.auto_approve_below', value: '0', group_name: 'Expense', value_type: 'number', label: 'Auto approve claims below (Rs, 0 = off)' },
  { key: 'expense.submission_window_days', value: '60', group_name: 'Expense', value_type: 'number', label: 'Claim back-dating window (days)' },
  { key: 'payroll.days_basis', value: 'CALENDAR', group_name: 'Payroll', value_type: 'string', label: 'Payable days basis (CALENDAR|WORKING|FIXED_26)' },
  { key: 'payroll.pf_employee_pct', value: '12', group_name: 'Payroll', value_type: 'number', label: 'PF employee %' },
  { key: 'payroll.pf_employer_pct', value: '12', group_name: 'Payroll', value_type: 'number', label: 'PF employer %' },
  { key: 'payroll.pf_wage_ceiling', value: '15000', group_name: 'Payroll', value_type: 'number', label: 'PF wage ceiling' },
  { key: 'payroll.pf_ceiling_enabled', value: 'TRUE', group_name: 'Payroll', value_type: 'boolean', label: 'Apply PF ceiling' },
  { key: 'payroll.esic_employee_pct', value: '0.75', group_name: 'Payroll', value_type: 'number', label: 'ESIC employee %' },
  { key: 'payroll.esic_employer_pct', value: '3.25', group_name: 'Payroll', value_type: 'number', label: 'ESIC employer %' },
  { key: 'payroll.esic_wage_ceiling', value: '21000', group_name: 'Payroll', value_type: 'number', label: 'ESIC wage ceiling' },
  { key: 'payroll.pt_state', value: 'Maharashtra', group_name: 'Payroll', value_type: 'string', label: 'Professional tax state' },
  { key: 'payroll.tds_regime', value: 'NEW', group_name: 'Payroll', value_type: 'string', label: 'TDS regime (NEW|OLD)' },
  { key: 'payroll.ot_multiplier', value: '2', group_name: 'Payroll', value_type: 'number', label: 'Overtime multiplier' },
  { key: 'payroll.round_off', value: 'TRUE', group_name: 'Payroll', value_type: 'boolean', label: 'Round off net pay' },
  { key: 'payroll.payslip_template', value: 'CLASSIC', group_name: 'Payroll', value_type: 'string', label: 'Payslip template' },
  { key: 'payroll.payslip_email_subject', value: 'Payslip for {month} - {company}', group_name: 'Payroll', value_type: 'string', label: 'Payslip email subject' },
  { key: 'payroll.pay_day', value: '7', group_name: 'Payroll', value_type: 'number', label: 'Salary pay day of month' },
  { key: 'payroll.auto_reimburse_claims', value: 'TRUE', group_name: 'Payroll', value_type: 'boolean', label: 'Add approved claims to payroll' },
  { key: 'notify.email_leave', value: 'TRUE', group_name: 'Notifications', value_type: 'boolean', label: 'Email on leave decisions' },
  { key: 'notify.email_payroll', value: 'TRUE', group_name: 'Notifications', value_type: 'boolean', label: 'Email payslips' },
  { key: 'notify.whatsapp_enabled', value: 'FALSE', group_name: 'Notifications', value_type: 'boolean', label: 'Send WhatsApp messages' },
  { key: 'general.date_format', value: 'dd MMM yyyy', group_name: 'General', value_type: 'string', label: 'Date display format' },
  { key: 'general.week_start', value: 'MONDAY', group_name: 'General', value_type: 'string', label: 'Week starts on' },
  { key: 'general.fy_start_month', value: '4', group_name: 'General', value_type: 'number', label: 'Financial year starts in month' }
];

var DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual Leave', is_paid: 'TRUE', accrual_per_month: 1, max_balance: 12, carry_forward: 'FALSE', requires_doc: 'FALSE', max_consecutive_days: 3, color: '#38bdf8', sort_order: 1 },
  { code: 'SL', name: 'Sick Leave', is_paid: 'TRUE', accrual_per_month: 1, max_balance: 12, carry_forward: 'FALSE', requires_doc: 'TRUE', max_consecutive_days: 7, color: '#f97316', sort_order: 2 },
  { code: 'EL', name: 'Earned Leave', is_paid: 'TRUE', accrual_per_month: 1.25, max_balance: 45, carry_forward: 'TRUE', requires_doc: 'FALSE', max_consecutive_days: 30, color: '#22c55e', sort_order: 3 },
  { code: 'LWP', name: 'Leave Without Pay', is_paid: 'FALSE', accrual_per_month: 0, max_balance: 0, carry_forward: 'FALSE', requires_doc: 'FALSE', max_consecutive_days: 60, color: '#94a3b8', sort_order: 4 },
  { code: 'ML', name: 'Maternity Leave', is_paid: 'TRUE', accrual_per_month: 0, max_balance: 182, carry_forward: 'FALSE', requires_doc: 'TRUE', max_consecutive_days: 182, color: '#e879f9', sort_order: 5 },
  { code: 'PL', name: 'Paternity Leave', is_paid: 'TRUE', accrual_per_month: 0, max_balance: 5, carry_forward: 'FALSE', requires_doc: 'FALSE', max_consecutive_days: 5, color: '#a78bfa', sort_order: 6 }
];

var DEFAULT_EXPENSE_CATEGORIES = [
  { code: 'TRAVEL', name: 'Travel (bus/train/flight)', requires_bill: 'TRUE', max_amount: 25000, is_taxable: 'FALSE', sort_order: 1 },
  { code: 'LOCAL', name: 'Local conveyance', requires_bill: 'FALSE', max_amount: 5000, is_taxable: 'FALSE', sort_order: 2 },
  { code: 'FOOD', name: 'Food & refreshments', requires_bill: 'FALSE', max_amount: 2000, is_taxable: 'FALSE', sort_order: 3 },
  { code: 'STAY', name: 'Hotel & stay', requires_bill: 'TRUE', max_amount: 20000, is_taxable: 'FALSE', sort_order: 4 },
  { code: 'MATERIAL', name: 'Site material', requires_bill: 'TRUE', max_amount: 200000, is_taxable: 'TRUE', sort_order: 5 },
  { code: 'FUEL', name: 'Fuel', requires_bill: 'TRUE', max_amount: 15000, is_taxable: 'FALSE', sort_order: 6 },
  { code: 'MOBILE', name: 'Mobile & internet', requires_bill: 'TRUE', max_amount: 3000, is_taxable: 'FALSE', sort_order: 7 },
  { code: 'MEDICAL', name: 'Medical reimbursement', requires_bill: 'TRUE', max_amount: 50000, is_taxable: 'FALSE', sort_order: 8 },
  { code: 'OTHER', name: 'Other expenses', requires_bill: 'FALSE', max_amount: 10000, is_taxable: 'FALSE', sort_order: 9 }
];

var DEFAULT_LETTER_TEMPLATES = [
  {
    code: 'OFFER', name: 'Offer Letter', category: 'HIRING',
    subject: 'Offer of employment - {{designation}}',
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>We are pleased to offer you the position of <b>{{designation}}</b> in the <b>{{department}}</b> department at {{company_name}}. ' +
      'Your annual cost to company will be <b>{{ctc_annual}}</b> as per the enclosed salary structure.</p>' +
      '<p>Your date of joining will be <b>{{joining_date}}</b> and your reporting location will be {{location}}. ' +
      'This offer is valid for 7 days from the date of issue.</p>' +
      '<p>Warm regards,<br>{{signer_name}}<br>{{company_name}}</p>'
  },
  {
    code: 'CONFIRM', name: 'Confirmation Letter', category: 'LIFECYCLE',
    subject: 'Confirmation of employment',
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>With reference to your appointment dated {{joining_date}}, we are pleased to confirm your services as ' +
      '<b>{{designation}}</b> with effect from <b>{{effective_date}}</b>.</p>' +
      '<p>We wish you a long and successful association with {{company_name}}.</p>' +
      '<p>For {{company_name}},<br>{{signer_name}}</p>'
  },
  {
    code: 'SALARY', name: 'Salary Certificate', category: 'COMPLIANCE',
    subject: 'Salary certificate - {{employee_name}}',
    body_html: '<p>This is to certify that <b>{{employee_name}}</b> (employee code {{employee_code}}) is employed with ' +
      '{{company_name}} as <b>{{designation}}</b> since {{joining_date}}.</p>' +
      '<p>Current monthly gross salary: <b>{{monthly_gross}}</b><br>Annual CTC: <b>{{ctc_annual}}</b></p>' +
      '<p>This certificate is issued on the specific request of the employee for {{purpose}}.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'EXPERIENCE', name: 'Experience Letter', category: 'EXIT',
    subject: 'Experience certificate - {{employee_name}}',
    body_html: '<p>To whomsoever it may concern</p>' +
      '<p>This is to certify that <b>{{employee_name}}</b> worked with {{company_name}} as <b>{{designation}}</b> from ' +
      '{{joining_date}} to {{exit_date}}.</p>' +
      '<p>During the tenure, their conduct and performance were found satisfactory. We wish them success in future endeavours.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'RELIEVING', name: 'Relieving Letter', category: 'EXIT',
    subject: 'Relieving letter - {{employee_name}}',
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>With reference to your resignation, we accept your separation from {{company_name}} effective ' +
      '<b>{{exit_date}}</b>. You are relieved from your duties at the close of business on that date.</p>' +
      '<p>Your full and final settlement will be processed as per company policy. We thank you for your contribution.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'WARNING', name: 'Warning Letter', category: 'DISCIPLINE',
    subject: 'Warning letter - {{employee_name}}',
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>This letter is a formal warning regarding <b>{{incident}}</b> observed on {{incident_date}}.</p>' +
      '<p>{{details}}</p>' +
      '<p>You are advised to improve immediately. Repeated instances may lead to disciplinary action as per company policy.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'PROMOTION', name: 'Promotion Letter', category: 'EMPLOYMENT',
    subject: 'Promotion - {{employee_name}}', 
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>In recognition of your performance and commitment, you are promoted to the position of ' +
      '<b>{{new_designation}}</b> with effect from <b>{{effective_date}}</b>.</p>' +
      '<p>Your revised monthly gross salary will be {{new_ctc}} and all other terms of employment remain unchanged.</p>' +
      '<p>Congratulations and best wishes for the new role.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'TRANSFER', name: 'Site Transfer Letter', category: 'EMPLOYMENT',
    subject: 'Transfer order - {{employee_name}}',
    body_html: '<p>Dear {{employee_name}},</p>' +
      '<p>You are hereby transferred from <b>{{from_project}}</b> to <b>{{to_project}}</b> with effect from ' +
      '<b>{{effective_date}}</b>.</p>' +
      '<p>Reporting time and shift will be {{shift_timing}}. Your existing salary structure and entitlements stay the same.</p>' +
      '<p>Please collect the site handover from your current site in-charge before moving.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  },
  {
    code: 'EXPERIENCE_INTERNSHIP', name: 'Internship Certificate', category: 'CERTIFICATE',
    subject: 'Internship certificate - {{employee_name}}',
    body_html: '<p>To whomsoever it may concern</p>' +
      '<p>This is to certify that <b>{{employee_name}}</b> completed an internship with {{company_name}} as ' +
      '<b>{{designation}}</b> from {{from_date}} to {{to_date}} at our {{project_name}} site.</p>' +
      '<p>During the internship, the candidate worked on {{work_summary}}. Conduct and punctuality were satisfactory.</p>' +
      '<p>{{company_name}}<br>{{signer_name}}</p>'
  }
];

/* ------------------------------------------------------------ helpers ---- */
function A_(module, perm, write, fields) {
  return { m: module, p: perm || (module + '.view'), w: !!write, f: fields || {} };
}
function PUB_(fields) { return { m: 'auth', p: null, w: false, f: fields || {}, pub: true }; }

/* ==========================================================================
 *  ACTION REGISTRY
 *  p  = permission required ('module.action') | null for public actions
 *  w  = write action (router writes a fallback audit entry)
 *  f  = payload validators. Field spec shorthand:
 *       'string!'            -> required string
 *       'string'             -> optional string
 *       { t:'int', r:true }  -> typed field
 * ======================================================================== */
var ACTION_META = {
  /* ------------------------------------------------------------- core --- */
  'app.bootstrap': PUB_({}),
  'app.health': { m: 'core', p: null, w: false, f: {} , pub: true },
  'app.session.info': { m: 'core', p: null, w: false, f: {} },
  'app.changePassword': { m: 'core', p: null, w: true, f: { current_password: 'string!', new_password: 'string!', confirm_password: 'string!' } },
  'app.logout': { m: 'core', p: null, w: true, f: {} },
  'app.profile.get': { m: 'core', p: null, w: false, f: {} },
  'app.profile.save': { m: 'core', p: null, w: true, f: { name: 'string', phone: 'phone', alt_phone: 'phone', address: 'string', city: 'string', state: 'string', pincode: 'string', blood_group: 'string', emergency_name: 'string', emergency_phone: 'phone', photo_file_id: 'string' } },

  /* ------------------------------------------------------------- auth --- */
  'auth.bootstrap': PUB_({ company: 'string' }),
  'auth.signup.start': PUB_({ company_name: 'string!', legal_name: 'string', gstin: 'string!', pan: 'string!', state: 'string!', city: 'string!', pincode: 'string', industry: 'string', company_size: 'string', address: 'string', contact_name: 'string!', contact_phone: 'phone!', contact_email: 'email!', admin_name: 'string!', admin_email: 'email!', admin_phone: 'phone!', plan: 'string' }),
  'auth.signup.sendOtp': PUB_({ signup_id: 'string!', channel: 'string' }),
  'auth.signup.verify': PUB_({ signup_id: 'string!', otp: 'string!', password: 'string!', confirm_password: 'string!' }),
  'auth.signup.status': PUB_({ signup_id: 'string!' }),
  'auth.login.company': PUB_({ email: 'email!', password: 'string!', company_id: 'string' }),
  'auth.login.super': PUB_({ email: 'email!', password: 'string!' }),
  'auth.login.employee': PUB_({ phone: 'phone!', password: 'string', company_id: 'string' }),
  'auth.employee.checkPhone': PUB_({ phone: 'phone!', company_id: 'string' }),
  'auth.employee.sendOtp': PUB_({ phone: 'phone!', company_id: 'string', purpose: 'string' }),
  'auth.employee.activate': PUB_({ phone: 'phone!', otp: 'string!', password: 'string!', confirm_password: 'string!', company_id: 'string' }),
  'auth.forgot.sendOtp': PUB_({ email: 'email', phone: 'phone', company_id: 'string', login_type: 'string' }),
  'auth.forgot.reset': PUB_({ email: 'email', phone: 'phone', otp: 'string!', password: 'string!', confirm_password: 'string!', company_id: 'string', login_type: 'string' }),
  'auth.session.ping': { m: 'core', p: null, w: false, f: {} },

  /* ------------------------------------------------------ super admin --- */
  'super.dashboard': A_('super', 'super.view', false, {}),
  'super.companies.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', search: 'string', status: 'string', sort: 'string', dir: 'string' }),
  'super.companies.get': A_('super', 'super.view', false, { company_id: 'string!' }),
  'super.companies.listBasics': A_('super', 'super.view', false, {}),
  'super.companies.approve': A_('super', 'super.manage', true, { company_id: 'string!', remark: 'string', plan: 'string', seats: 'int', welcome_email: 'bool' }),
  'super.companies.reject': A_('super', 'super.manage', true, { company_id: 'string!', remark: 'string!' }),
  'super.companies.setStatus': A_('super', 'super.manage', true, { company_id: 'string!', status: 'string!', remark: 'string' }),
  'super.companies.update': A_('super', 'super.manage', true, { company_id: 'string!', name: 'string', legal_name: 'string', gstin: 'string', pan: 'string', state: 'string', city: 'string', address: 'string', pincode: 'string', contact_name: 'string', contact_email: 'email', contact_phone: 'phone', industry: 'string', company_size: 'string', plan: 'string', verification_mode: 'string', notes: 'string' }),
  'super.companies.resendCredentials': A_('super', 'super.manage', true, { company_id: 'string!', to: 'email' }),
  'super.companies.resetAdminPassword': A_('super', 'super.manage', true, { company_id: 'string!', mode: 'string' }),
  'super.companies.reprovision': A_('super', 'super.manage', true, { company_id: 'string!' }),
  'super.impersonate.start': A_('super', 'super.manage', true, { company_id: 'string!', user_id: 'string', reason: 'string!' }),
  'super.impersonate.stop': A_('super', 'super.manage', true, {}),
  'super.subscriptions.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', search: 'string', company_id: 'string' }),
  'super.subscriptions.save': A_('super', 'super.manage', true, { subscription_id: 'string', company_id: 'string!', plan: 'string!', seats: 'int', price_per_seat: 'number', billing_cycle: 'string', started_at: 'date', ends_at: 'date', status: 'string', auto_renew: 'bool', notes: 'string' }),
  'super.revenue.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', search: 'string', company_id: 'string' }),
  'super.revenue.save': A_('super', 'super.manage', true, { revenue_id: 'string', company_id: 'string!', invoice_no: 'string', amount: 'number!', tax_amount: 'number', total_amount: 'number', period_from: 'date', period_to: 'date', paid_at: 'date', payment_mode: 'string', reference: 'string', status: 'string', notes: 'string' }),
  'super.config.list': A_('super', 'super.manage', false, {}),
  'super.config.save': A_('super', 'super.manage', true, { items: 'array' }),
  'super.tickets.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', search: 'string', status: 'string' }),
  'super.tickets.get': A_('super', 'super.view', false, { ticket_id: 'string!' }),
  'super.tickets.reply': A_('super', 'super.manage', true, { ticket_id: 'string!', body: 'string!', status: 'string', is_internal: 'bool' }),
  'super.audit.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', search: 'string', module: 'string', from: 'date', to: 'date', company_id: 'string' }),
  'super.logs.list': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', level: 'string', search: 'string' }),
  'super.diagnostics': A_('super', 'super.manage', false, {}),
  'super.demo.seed': A_('super', 'super.manage', true, { company_id: 'string', employees: 'int', projects: 'int', months: 'int' }),
  'super.demo.reset': A_('super', 'super.manage', true, { company_id: 'string', confirm: 'string!' }),
  'super.email.queue': A_('super', 'super.view', false, { page: 'int', pageSize: 'int', status: 'string' }),
  'super.email.flush': A_('super', 'super.manage', true, {}),

  /* ---------------------------------------------------------- company --- */
  'company.bootstrap': { m: 'core', p: null, w: false, f: {} },
  'company.settings.get': A_('settings', 'settings.view', false, {}),
  'company.settings.save': A_('settings', 'settings.edit', true, { items: 'array', reason: 'string' }),
  'company.profile.save': A_('settings', 'settings.edit', true, { name: 'string', address: 'string', city: 'string', state: 'string', pincode: 'string', phone: 'phone', email: 'email', brand_color: 'string', logo_file_id: 'string' }),
  'company.branches.list': A_('branches', 'branches.view', false, { page: 'int', pageSize: 'int', search: 'string', sort: 'string', dir: 'string', is_active: 'string' }),
  'company.branches.save': A_('branches', 'branches.create', true, { branch_id: 'string', name: 'string!', code: 'string', address: 'string', city: 'string', state: 'string', pincode: 'string', phone: 'phone', incharge_name: 'string', latitude: 'lat', longitude: 'lng', is_active: 'bool', note: 'string' }),
  'company.branches.delete': A_('branches', 'branches.delete', true, { branch_id: 'string!' }),
  'company.roles.list': A_('users', 'users.view', false, {}),
  'company.roles.get': A_('users', 'users.view', false, { role_id: 'string' }),
  'company.roles.save': A_('users', 'users.manage', true, { role_id: 'string', code: 'string', name: 'string!', description: 'string', data_scope: 'string!', level: 'int', permissions: 'object' }),
  'company.roles.delete': A_('users', 'users.manage', true, { role_id: 'string!' }),
  'company.overrides.list': A_('users', 'users.view', false, { user_id: 'string', page: 'int', pageSize: 'int' }),
  'company.overrides.save': A_('users', 'users.manage', true, { override_id: 'string', user_id: 'string!', module: 'string!', action: 'string!', allowed: 'bool', reason: 'string!', expires_at: 'date' }),
  'company.overrides.delete': A_('users', 'users.manage', true, { override_id: 'string!' }),
  'company.users.list': A_('users', 'users.view', false, { page: 'int', pageSize: 'int', search: 'string', role_code: 'string' }),
  'company.users.save': A_('users', 'users.manage', true, { user_id: 'string', name: 'string!', email: 'email!', phone: 'phone', role_code: 'string!', status: 'string', send_invite: 'bool' }),
  'company.users.delete': A_('users', 'users.delete', true, { user_id: 'string!' }),
  'company.users.resetPassword': A_('users', 'users.manage', true, { user_id: 'string!', mode: 'string' }),
  'company.holidays.list': A_('settings', 'settings.view', false, { year: 'string', page: 'int', pageSize: 'int' }),
  'company.holidays.save': A_('settings', 'settings.edit', true, { holiday_id: 'string', name: 'string!', date: 'date!', kind: 'string', region: 'string', branch_id: 'string', is_paid: 'bool', note: 'string' }),
  'company.holidays.delete': A_('settings', 'settings.edit', true, { holiday_id: 'string!' }),
  'company.leavetypes.list': A_('settings', 'settings.view', false, {}),
  'company.leavetypes.save': A_('settings', 'settings.edit', true, { leave_type_id: 'string', code: 'string!', name: 'string!', is_paid: 'bool', accrual_per_month: 'number', max_balance: 'number', carry_forward: 'bool', requires_doc: 'bool', max_consecutive_days: 'int', color: 'string', is_active: 'bool', sort_order: 'int', note: 'string' }),
  'company.leavetypes.delete': A_('settings', 'settings.edit', true, { leave_type_id: 'string!' }),
  'company.expensecategories.list': A_('settings', 'settings.view', false, {}),
  'company.expensecategories.save': A_('settings', 'settings.edit', true, { category_id: 'string', code: 'string!', name: 'string!', max_amount: 'number', requires_bill: 'bool', is_taxable: 'bool', is_active: 'bool', sort_order: 'int', gl_code: 'string', note: 'string' }),
  'company.expensecategories.delete': A_('settings', 'settings.edit', true, { category_id: 'string!' }),
  'company.payrollrates.get': A_('payroll', 'payroll.view', false, {}),
  'company.payrollrates.save': A_('payroll', 'payroll.edit', true, { items: 'array', reason: 'string' }),

  /* -------------------------------------------------------- employees --- */
  'employees.list': A_('employees', 'employees.view', false, { page: 'int', pageSize: 'int', search: 'string', sort: 'string', dir: 'string', status: 'string', department: 'string', project_id: 'string', branch_id: 'string', employment_type: 'string' }),
  'employees.get': A_('employees', 'employees.view', false, { employee_id: 'string!' }),
  'employees.save': A_('employees', 'employees.create', true, {
    employee_id: 'string', name: 'string!', gender: 'string', dob: 'date', joining_date: 'date!', status: 'string',
    department: 'string', designation: 'string', branch_id: 'string', project_id: 'string', manager_id: 'string',
    employment_type: 'string', work_state: 'string', phone: 'phone!', alt_phone: 'phone', email: 'email',
    address: 'string', city: 'string', state: 'string', pincode: 'string', emergency_name: 'string',
    emergency_phone: 'phone', blood_group: 'string', pan: 'string', aadhaar_last4: 'string', aadhaar_file_id: 'string',
    bank_name: 'string', bank_account: 'string', bank_ifsc: 'string', bank_holder: 'string', pf_applicable: 'bool',
    pf_uan: 'string', pf_ceiling_opt: 'string', esic_applicable: 'bool', esic_ip_no: 'string', pt_applicable: 'bool',
    tds_applicable: 'bool', ctc_monthly: 'number', photo_file_id: 'string', remarks: 'string'
  }),
  'employees.delete': A_('employees', 'employees.delete', true, { employee_id: 'string!', reason: 'string!' }),
  'employees.exit': A_('employees', 'employees.edit', true, { employee_id: 'string!', exit_date: 'date!', exit_reason: 'string!', fnf_flag: 'bool', remarks: 'string' }),
  'employees.import.preview': A_('employees', 'employees.create', false, { csv: 'string!', mode: 'string' }),
  'employees.import.commit': A_('employees', 'employees.create', true, { rows: 'array!', mode: 'string', default_project_id: 'string' }),
  'employees.documents.list': A_('employees', 'employees.view', false, { employee_id: 'string!', page: 'int', pageSize: 'int' }),
  'employees.documents.save': A_('employees', 'employees.edit', true, { doc_id: 'string', employee_id: 'string!', doc_type: 'string!', doc_name: 'string!', file_id: 'string!', file_name: 'string', mime_type: 'string', size_bytes: 'int', issued_date: 'date', expiry_date: 'date', note: 'string' }),
  'employees.documents.verify': A_('employees', 'employees.edit', true, { doc_id: 'string!', verified: 'bool', note: 'string' }),
  'employees.documents.delete': A_('employees', 'employees.delete', true, { doc_id: 'string!' }),
  'employees.salary.get': A_('employees', 'employees.view', false, { employee_id: 'string!' }),
  'employees.salary.save': A_('employees', 'employees.edit', true, { structure_id: 'string', employee_id: 'string!', effective_from: 'date!', basic: 'number!', hra: 'number', da: 'number', conveyance: 'number', special_allowance: 'number', other_allowance: 'number', overtime_rate: 'number', pf_employee_pct: 'number', pf_employer_pct: 'number', esic_employee_pct: 'number', esic_employer_pct: 'number', pt_state: 'string', tds_regime: 'string', is_active: 'bool', note: 'string' }),
  'employees.salary.delete': A_('employees', 'employees.edit', true, { structure_id: 'string!' }),
  'employees.bulkAssignProject': A_('projects', 'projects.edit', true, { employee_ids: 'array!', project_id: 'string!', role_on_site: 'string', from_date: 'date', daily_wage: 'number' }),
  'employees.directory': A_('employees', 'employees.view', false, { page: 'int', pageSize: 'int', search: 'string' }),

  /* --------------------------------------------------------- projects --- */
  'projects.list': A_('projects', 'projects.view', false, { page: 'int', pageSize: 'int', search: 'string', sort: 'string', dir: 'string', status: 'string' }),
  'projects.get': A_('projects', 'projects.view', false, { project_id: 'string!' }),
  'projects.save': A_('projects', 'projects.create', true, { project_id: 'string', name: 'string!', code: 'string', client_name: 'string', site_address: 'string', city: 'string', state: 'string', pincode: 'string', latitude: 'lat', longitude: 'lng', radius_m: 'int', start_date: 'date', end_date: 'date', status: 'string', incharge_employee_id: 'string', budget_amount: 'number', shift_start: 'time', shift_end: 'time', weekly_off: 'string', notes: 'string' }),
  'projects.delete': A_('projects', 'projects.delete', true, { project_id: 'string!' }),
  'projects.location.lock': A_('projects', 'projects.edit', true, { project_id: 'string!', location_locked: 'bool', reason: 'string!' }),
  'projects.team': A_('projects', 'projects.view', false, { project_id: 'string!', page: 'int', pageSize: 'int', include_past: 'bool' }),
  'projects.assign': A_('projects', 'projects.edit', true, { project_id: 'string!', employee_id: 'string!', role_on_site: 'string', from_date: 'date', to_date: 'date', daily_wage: 'number', is_primary: 'bool' }),
  'projects.unassign': A_('projects', 'projects.edit', true, { assignment_id: 'string!', reason: 'string', to_date: 'date' }),
  'projects.transfer.create': A_('projects', 'projects.create', true, { employee_id: 'string!', from_project_id: 'string', to_project_id: 'string!', reason: 'string!', effective_date: 'date!' }),
  'projects.transfer.list': A_('projects', 'projects.view', false, { page: 'int', pageSize: 'int', status: 'string', employee_id: 'string', search: 'string' }),
  'projects.transfer.decide': A_('projects', 'projects.approve', true, { transfer_id: 'string!', decision: 'string!', remark: 'string!', effective_date: 'date' }),
  'projects.nearby': A_('projects', 'projects.view', false, { lat: 'lat!', lng: 'lng!' }),

  /* ------------------------------------------------------- attendance --- */
  'attendance.context': { m: 'attendance', p: null, w: false, f: {} },
  'attendance.today': { m: 'attendance', p: null, w: false, f: {} },
  'attendance.punch.in': { m: 'attendance', p: null, w: true, f: { lat: 'lat!', lng: 'lng!', accuracy: 'number', project_id: 'string', device: 'object', selfie_file_id: 'string' } },
  'attendance.punch.out': { m: 'attendance', p: null, w: true, f: { lat: 'lat!', lng: 'lng!', accuracy: 'number', project_id: 'string', device: 'object' } },
  'attendance.list': A_('attendance', 'attendance.view', false, { page: 'int', pageSize: 'int', search: 'string', sort: 'string', dir: 'string', from: 'date', to: 'date', employee_id: 'string', project_id: 'string', status: 'string', source: 'string', flagged: 'string', department: 'string' }),
  'attendance.my': { m: 'attendance', p: null, w: false, f: { from: 'date', to: 'date', page: 'int', pageSize: 'int' } },
  'attendance.manual.save': A_('attendance', 'attendance.edit', true, { attendance_id: 'string', employee_id: 'string!', date: 'date!', status: 'string!', in_time: 'time', out_time: 'time', project_id: 'string', overtime_minutes: 'int', remark: 'string!' }),
  'attendance.manual.bulk': A_('attendance', 'attendance.create', true, { date: 'date!', project_id: 'string', employee_ids: 'array!', status: 'string!', remark: 'string!' }),
  'attendance.regularize.request': { m: 'attendance', p: null, w: true, f: { date: 'date!', requested_status: 'string!', requested_in: 'time', requested_out: 'time', reason: 'string!' } },
  'attendance.regularize.list': A_('attendance', 'attendance.view', false, { page: 'int', pageSize: 'int', status: 'string', employee_id: 'string', from: 'date', to: 'date' }),
  'attendance.regularize.my': { m: 'attendance', p: null, w: false, f: { page: 'int', pageSize: 'int' } },
  'attendance.regularize.decide': A_('attendance', 'attendance.approve', true, { request_id: 'string!', decision: 'string!', remark: 'string!' }),
  'attendance.summary': A_('attendance', 'attendance.view', false, { from: 'date!', to: 'date!', employee_id: 'string', project_id: 'string', department: 'string' }),
  'attendance.month': A_('attendance', 'attendance.view', false, { month: 'string!', employee_id: 'string', project_id: 'string', department: 'string' }),
  'attendance.flag.review': A_('attendance', 'attendance.approve', true, { attendance_id: 'string!', flagged: 'bool', remark: 'string!' }),

  /* ------------------------------------------------------------ leave --- */
  'leave.types.list': { m: 'leave', p: null, w: false, f: {} },
  'leave.balances.list': A_('leave', 'leave.view', false, { fy: 'string', employee_id: 'string', department: 'string', page: 'int', pageSize: 'int', search: 'string' }),
  'leave.balances.my': { m: 'leave', p: null, w: false, f: { fy: 'string' } },
  'leave.balances.save': A_('leave', 'leave.edit', true, { balance_id: 'string', employee_id: 'string!', leave_type_id: 'string!', fy: 'string!', opening: 'number', accrued: 'number', used: 'number', lapsed: 'number', note: 'string' }),
  'leave.balances.accrue': A_('leave', 'leave.manage', true, { fy: 'string!', month: 'string', department: 'string' }),
  'leave.requests.list': A_('leave', 'leave.view', false, { page: 'int', pageSize: 'int', search: 'string', status: 'string', employee_id: 'string', from: 'date', to: 'date', leave_type_id: 'string', sort: 'string', dir: 'string' }),
  'leave.requests.my': { m: 'leave', p: null, w: false, f: { page: 'int', pageSize: 'int', status: 'string' } },
  'leave.apply': { m: 'leave', p: null, w: true, f: { leave_type_id: 'string!', from_date: 'date!', to_date: 'date!', is_half_day: 'bool', half_day_session: 'string', reason: 'string!', contact_during_leave: 'string', attachment_file_id: 'string' } },
  'leave.decide': A_('leave', 'leave.approve', true, { request_id: 'string!', decision: 'string!', remark: 'string!' }),
  'leave.cancel': { m: 'leave', p: null, w: true, f: { request_id: 'string!', cancel_reason: 'string!' } },
  'leave.calendar': A_('leave', 'leave.view', false, { month: 'string!', department: 'string', project_id: 'string' }),
  'leave.special.list': A_('leave', 'leave.view', false, { page: 'int', pageSize: 'int', status: 'string', kind: 'string', employee_id: 'string', search: 'string' }),
  'leave.special.my': { m: 'leave', p: null, w: false, f: { page: 'int', pageSize: 'int' } },
  'leave.special.create': { m: 'leave', p: null, w: true, f: { kind: 'string!', title: 'string!', from_date: 'date!', to_date: 'date', amount: 'number', details: 'object', reason: 'string!' } },
  'leave.special.decide': A_('leave', 'leave.approve', true, { request_id: 'string!', decision: 'string!', remark: 'string!' }),
  'leave.holidays.list': { m: 'leave', p: null, w: false, f: { year: 'string' } },

  /* ---------------------------------------------------------- expense --- */
  'expense.categories.list': { m: 'expense', p: null, w: false, f: {} },
  'expense.claims.list': A_('expense', 'expense.view', false, { page: 'int', pageSize: 'int', search: 'string', status: 'string', employee_id: 'string', category_id: 'string', from: 'date', to: 'date', sort: 'string', dir: 'string' }),
  'expense.claims.my': { m: 'expense', p: null, w: false, f: { page: 'int', pageSize: 'int', status: 'string' } },
  'expense.claims.get': { m: 'expense', p: null, w: false, f: { claim_id: 'string!' } },
  'expense.claims.save': { m: 'expense', p: null, w: true, f: { claim_id: 'string', category_id: 'string!', claim_date: 'date!', from_date: 'date', to_date: 'date', amount: 'number!', tax_amount: 'number', advance_amount: 'number', description: 'string!', items: 'array', bill_file_ids: 'array', submit: 'bool', employee_id: 'string', idempotency_key: 'string' } },
  'expense.claims.submit': { m: 'expense', p: null, w: true, f: { claim_id: 'string!' } },
  'expense.claims.decide': A_('expense', 'expense.approve', true, { claim_id: 'string!', decision: 'string!', remark: 'string!', approved_amount: 'number' }),
  'expense.claims.bulkDecide': A_('expense', 'expense.approve', true, { claim_ids: 'array!', decision: 'string!', remark: 'string!' }),
  'expense.claims.delete': { m: 'expense', p: null, w: true, f: { claim_id: 'string!' } },
  'expense.claims.markPaid': A_('expense', 'expense.approve', true, { claim_ids: 'array!', payment_reference: 'string', payment_mode: 'string' }),
  'expense.summary': A_('expense', 'expense.view', false, { from: 'date', to: 'date', department: 'string', project_id: 'string' }),

  /* ---------------------------------------------------------- payroll --- */
  'payroll.runs.list': A_('payroll', 'payroll.view', false, { page: 'int', pageSize: 'int', status: 'string', fy: 'string', search: 'string' }),
  'payroll.runs.get': A_('payroll', 'payroll.view', false, { run_id: 'string!' }),
  'payroll.runs.create': A_('payroll', 'payroll.create', true, { fy: 'string!', month: 'string!', days_basis: 'string', title: 'string', notes: 'string', include_reimbursements: 'bool' }),
  'payroll.precheck': A_('payroll', 'payroll.view', false, { run_id: 'string!' }),
  'payroll.calculate.start': A_('payroll', 'payroll.create', true, { run_id: 'string!' }),
  'payroll.calculate.progress': A_('payroll', 'payroll.view', false, { run_id: 'string!' }),
  'payroll.calculate.resume': A_('payroll', 'payroll.create', true, { run_id: 'string!' }),
  'payroll.runs.items': A_('payroll', 'payroll.view', false, { run_id: 'string!', page: 'int', pageSize: 'int', search: 'string', status: 'string', department: 'string', sort: 'string', dir: 'string' }),
  'payroll.item.update': A_('payroll', 'payroll.edit', true, { item_id: 'string!', bonus: 'number', incentive: 'number', other_deduction: 'number', advance_recovery: 'number', ot_hours: 'number', hold: 'bool', hold_reason: 'string', note: 'string' }),
  'payroll.runs.approve': A_('payroll', 'payroll.approve', true, { run_id: 'string!', remark: 'string!', approve_items: 'bool' }),
  'payroll.runs.cancel': A_('payroll', 'payroll.approve', true, { run_id: 'string!', reason: 'string!' }),
  'payroll.markPaid': A_('payroll', 'payroll.approve', true, { run_id: 'string!', payment_reference: 'string!', payment_mode: 'string', remark: 'string', generate_payslips: 'bool' }),
  'payroll.selftest': A_('payroll', 'payroll.view', false, {}),
  'payroll.rates.get': A_('payroll', 'payroll.view', false, {}),
  'payroll.my.payslips': { m: 'payroll', p: null, w: false, f: { page: 'int', pageSize: 'int', fy: 'string' } },
  'payroll.my.summary': { m: 'payroll', p: null, w: false, f: {} },
  'payroll.payslips.list': A_('payroll', 'payroll.view', false, { page: 'int', pageSize: 'int', run_id: 'string', employee_id: 'string', month: 'string', fy: 'string', search: 'string', emailed: 'string' }),
  'payroll.payslip.get': { m: 'payroll', p: null, w: false, f: { payslip_id: 'string!' } },
  'payroll.payslip.generate': A_('payroll', 'payroll.edit', true, { payslip_id: 'string', run_id: 'string', employee_id: 'string', template: 'string' }),
  'payroll.payslip.bulkGenerate': A_('payroll', 'payroll.edit', true, { run_id: 'string!', template: 'string', force: 'bool' }),
  'payroll.payslip.email': A_('payroll', 'payroll.edit', true, { payslip_id: 'string', run_id: 'string', employee_id: 'string' }),
  'payroll.payslip.delete': A_('payroll', 'payroll.delete', true, { payslip_id: 'string!' }),

  /* ---------------------------------------------------------- reports --- */
  'reports.catalog': A_('reports', 'reports.view', false, {}),
  'reports.run': A_('reports', 'reports.view', false, { report: 'string!', from: 'date', to: 'date', month: 'string', fy: 'string', project_id: 'string', department: 'string', employee_id: 'string', status: 'string', page: 'int', pageSize: 'int' }),
  'reports.export': A_('reports', 'reports.export', false, { report: 'string!', from: 'date', to: 'date', month: 'string', fy: 'string', project_id: 'string', department: 'string', employee_id: 'string', status: 'string', format: 'string' }),
  'dashboard.company': A_('dashboard', 'dashboard.view', false, {}),
  'dashboard.employee': { m: 'dashboard', p: null, w: false, f: {} },
  'dashboard.manager': A_('dashboard', 'dashboard.view', false, {}),
  'dashboard.layout.save': { m: 'dashboard', p: null, w: true, f: { scope: 'string!', layout: 'object!' } },
  'dashboard.layout.get': { m: 'dashboard', p: null, w: false, f: {} },

  /* -------------------------------------------------------- documents --- */
  'documents.list': A_('documents', 'documents.view', false, { page: 'int', pageSize: 'int', search: 'string', owner_type: 'string', owner_id: 'string', category: 'string', page_size: 'int' }),
  'documents.save': A_('documents', 'documents.create', true, { doc_id: 'string', owner_type: 'string!', owner_id: 'string', category: 'string', title: 'string!', file_id: 'string!', file_name: 'string', mime_type: 'string', size_bytes: 'int', visibility: 'string', expiry_date: 'date', note: 'string' }),
  'documents.newVersion': A_('documents', 'documents.edit', true, { doc_id: 'string!', file_id: 'string!', file_name: 'string', mime_type: 'string', size_bytes: 'int', note: 'string' }),
  'documents.delete': A_('documents', 'documents.delete', true, { doc_id: 'string!', reason: 'string!' }),
  'documents.my': { m: 'documents', p: null, w: false, f: { page: 'int', pageSize: 'int' } },
  'documents.templates.list': A_('documents', 'documents.view', false, {}),
  'documents.templates.save': A_('documents', 'documents.edit', true, { template_id: 'string', code: 'string!', name: 'string!', category: 'string', subject: 'string!', body_html: 'string!', is_active: 'bool', note: 'string' }),
  'documents.templates.reset': A_('documents', 'documents.manage', true, {}),
  'documents.letters.list': A_('documents', 'documents.view', false, { page: 'int', pageSize: 'int', employee_id: 'string', search: 'string' }),
  'documents.letters.my': { m: 'documents', p: null, w: false, f: { page: 'int', pageSize: 'int' } },
  'documents.letters.generate': A_('documents', 'documents.create', true, { template_id: 'string!', employee_id: 'string!', extra: 'object', issue_date: 'date', save_file: 'bool' }),
  'documents.letters.preview': A_('documents', 'documents.view', false, { template_id: 'string!', employee_id: 'string!', extra: 'object' }),

  /* ---------------------------------------------------------- support --- */
  'support.tickets.list': A_('support', 'support.view', false, { page: 'int', pageSize: 'int', search: 'string', status: 'string', priority: 'string', mine: 'bool' }),
  'support.tickets.get': { m: 'support', p: null, w: false, f: { ticket_id: 'string!' } },
  'support.tickets.create': { m: 'support', p: null, w: true, f: { subject: 'string!', category: 'string', priority: 'string', body: 'string!', employee_id: 'string' } },
  'support.tickets.reply': { m: 'support', p: null, w: true, f: { ticket_id: 'string!', body: 'string!', is_internal: 'bool' } },
  'support.tickets.update': A_('support', 'support.edit', true, { ticket_id: 'string!', status: 'string', priority: 'string', assigned_to: 'string', resolution: 'string' }),
  'support.platform.list': A_('support', 'support.view', false, { page: 'int', pageSize: 'int' }),
  'support.platform.create': A_('settings', 'settings.manage', true, { subject: 'string!', category: 'string', priority: 'string', body: 'string!' }),
  'support.platform.reply': A_('settings', 'settings.manage', true, { ticket_id: 'string!', body: 'string!' }),

  /* ------------------------------------------------------- notify/file --- */
  'notify.list': { m: 'core', p: null, w: false, f: { page: 'int', pageSize: 'int', unread_only: 'bool' } },
  'notify.markRead': { m: 'core', p: null, w: false, f: { notification_id: 'string', all: 'bool' } },
  'notify.unreadCount': { m: 'core', p: null, w: false, f: {} },
  'notify.test': A_('settings', 'settings.manage', true, { channel: 'string!', to: 'string!' }),
  'files.upload.begin': { m: 'core', p: null, w: false, f: { name: 'string!', mime_type: 'string', size_bytes: 'int', folder: 'string', scope: 'string', owner_id: 'string' } },
  'files.upload.chunk': { m: 'core', p: null, w: false, f: { upload_id: 'string!', index: 'int!', data: 'string!' } },
  'files.upload.finish': { m: 'core', p: null, w: true, f: { upload_id: 'string!', chunks: 'int!' } },
  'files.upload.cancel': { m: 'core', p: null, w: false, f: { upload_id: 'string!' } },
  'files.download': { m: 'core', p: null, w: false, f: { file_id: 'string!' } },
  'files.meta': { m: 'core', p: null, w: false, f: { file_id: 'string!' } },
  'files.delete': { m: 'core', p: null, w: true, f: { file_id: 'string!' } },
  'files.companyTree': A_('settings', 'settings.view', false, {}),

  /* ------------------------------------------------------------ audit --- */
  'audit.list': A_('audit', 'audit.view', false, { page: 'int', pageSize: 'int', search: 'string', module: 'string', from: 'date', to: 'date', action: 'string' }),
  'audit.export': A_('audit', 'audit.export', false, { from: 'date', to: 'date', module: 'string' }),
  'audit.sensitive': A_('audit', 'audit.view', false, { page: 'int', pageSize: 'int' }),

  /* ----------------------------------------------------------- system --- */
  'system.bootstrapAdmin': { m: 'core', p: null, w: false, f: { setup_key: 'string' } },
  'system.health': A_('settings', 'settings.manage', false, {}),
  'system.maintenance': A_('settings', 'settings.manage', true, { task: 'string!', payload: 'object' })
};

/* -------------------------------------------------- redaction on audit -- */
var SECRET_FIELDS = ['password', 'new_password', 'confirm_password', 'current_password', 'otp', 'token', 'code_hash',
  'password_hash', 'password_salt', 'activation_code_hash', 'bank_account', 'pan', 'aadhaar_last4', 'aadhaar_file_id'];

var SENSITIVE_ACTIONS = ['employees.get', 'employees.salary.get', 'payroll.runs.items', 'payroll.payslip.get',
  'expense.claims.get', 'documents.list', 'files.download', 'super.companies.get', 'auth.login.company',
  'auth.login.super', 'auth.login.employee'];

/* ------------------------------------------------------ platform config -- */
var SYSTEM_CONFIG_DEFAULTS = [
  { key: 'require_company_verification', label: 'Require manual verification of new companies', value_type: 'boolean', group_name: 'Onboarding', value: 'TRUE', description: 'When ON, every new signup waits for Super Admin approval.' },
  { key: 'signup_open', label: 'Allow new company signups', value_type: 'boolean', group_name: 'Onboarding', value: 'TRUE' },
  { key: 'trial_days', label: 'Trial period (days)', value_type: 'number', group_name: 'Onboarding', value: '14' },
  { key: 'default_plan', label: 'Default plan for new companies', value_type: 'string', group_name: 'Onboarding', value: 'TRIAL' },
  { key: 'support_email', label: 'Platform support email', value_type: 'string', group_name: 'Notifications', value: 'support@focushr.app' },
  { key: 'from_name', label: 'Outgoing email sender name', value_type: 'string', group_name: 'Notifications', value: 'FocusHR' },
  { key: 'email_sending_enabled', label: 'Send emails automatically', value_type: 'boolean', group_name: 'Notifications', value: 'TRUE' },
  { key: 'log_otp_codes', label: 'Write OTP codes to the platform log (testing only)', value_type: 'boolean', group_name: 'Notifications', value: 'TRUE', description: 'Turn OFF before going live. While ON, every OTP is also written to the Logs tab so you can test without SMS/email.' },
  { key: 'whatsapp_enabled', label: 'Send WhatsApp messages', value_type: 'boolean', group_name: 'WhatsApp', value: 'FALSE' },
  { key: 'whatsapp_phone_id', label: 'WhatsApp phone number id', value_type: 'string', group_name: 'WhatsApp', value: '' },
  { key: 'whatsapp_token', label: 'WhatsApp Cloud API token', value_type: 'secret', group_name: 'WhatsApp', value: '', is_secret: true, description: 'Stored in Script Properties, never in the spreadsheet.' },
  { key: 'whatsapp_country_code', label: 'WhatsApp country code', value_type: 'string', group_name: 'WhatsApp', value: '91' },
  { key: 'maps_api_key', label: 'Google Maps API key (optional)', value_type: 'secret', group_name: 'Maps', value: '', is_secret: true, description: 'When set, the app shows Google Maps instead of offline Leaflet tiles.' },
  { key: 'maintenance_mode', label: 'Maintenance mode', value_type: 'boolean', group_name: 'Platform', value: 'FALSE', description: 'When ON, only Super Admins can log in.' },
  { key: 'announcement', label: 'Login page announcement', value_type: 'string', group_name: 'Platform', value: '' },
  { key: 'demo_mode', label: 'Show demo / seed tools', value_type: 'boolean', group_name: 'Platform', value: 'TRUE' }
];

var Config = {

  row_: function (key) {
    return Db.findOne(masterCtx_(), 'SystemConfig', function (r) { return txt_(r.config_key) === txt_(key); });
  },

  defaults_: function (key) {
    var d = null;
    SYSTEM_CONFIG_DEFAULTS.forEach(function (c) { if (c.key === key) d = c; });
    return d;
  },

  /** Raw value: secrets live in Script Properties, the rest in SystemConfig. */
  systemGet: function (key, def) {
    var meta = Config.defaults_(key);
    if (meta && meta.is_secret) {
      var v = prop_('CFG_' + key);
      return v === '' ? (def !== undefined ? def : (meta.value || '')) : v;
    }
    var row = Config.row_(key);
    if (row && txt_(row.config_value) !== '') return row.config_value;
    if (def !== undefined) return def;
    return meta ? meta.value : '';
  },

  systemBool_: function (key, def) {
    var v = Config.systemGet(key, def === undefined ? undefined : (def ? 'TRUE' : 'FALSE'));
    if (v === undefined || v === null || v === '') return !!def;
    return boolVal_(v);
  },

  systemNum_: function (key, def) { return numVal_(Config.systemGet(key, def), def); },

  systemSet: function (items, actor) {
    var list = items instanceof Array ? items : [items];
    var applied = [];
    list.forEach(function (item) {
      var key = txt_(item.key || item.config_key);
      if (!key) return;
      var meta = Config.defaults_(key) || { value_type: txt_(item.value_type || 'string'), group_name: 'Platform', label: key };
      var value = item.value === undefined ? '' : item.value;
      if (meta.is_secret || item.is_secret) {
        setProp_('CFG_' + key, value);
      } else {
        var row = Config.row_(key);
        var patch = {
          config_key: key, config_value: value,
          value_type: meta.value_type || 'string', group_name: meta.group_name || 'Platform',
          label: meta.label || key, description: meta.description || '', is_secret: 'FALSE'
        };
        if (row) Db.update(masterCtx_(), 'SystemConfig', 'config_key', key, patch, { system: true });
        else Db.insert(masterCtx_(), 'SystemConfig', patch, { system: true });
      }
      applied.push(key);
    });
    return { saved: applied.length, keys: applied };
  },

  /** Full config list for the Super Admin screen (secrets masked). */
  list: function () {
    var rows = Db.all(masterCtx_(), 'SystemConfig').map(function (r) {
      return {
        key: txt_(r.config_key), value: txt_(r.config_value), value_type: txt_(r.value_type),
        group_name: txt_(r.group_name), label: txt_(r.label), description: txt_(r.description),
        is_secret: boolVal_(r.is_secret), has_value: txt_(r.config_value) !== ''
      };
    });
    var known = {};
    rows.forEach(function (r) { known[r.key] = true; });
    SYSTEM_CONFIG_DEFAULTS.forEach(function (d) {
      if (known[d.key]) return;
      var secret = !!d.is_secret;
      var current = secret ? prop_('CFG_' + d.key) : '';
      rows.push({
        key: d.key, value: secret ? '' : d.value, value_type: d.value_type, group_name: d.group_name,
        label: d.label, description: d.description || '', is_secret: secret, has_value: secret ? !!current : txt_(d.value) !== ''
      });
    });
    return { items: sortRows_(rows, 'key', 'ASC'), groups: uniq_(rows.map(function (r) { return r.group_name; })) };
  },

  /** Public snapshot used by the web app (no secrets). */
  publicFlags: function () {
    return {
      require_company_verification: Config.systemBool_('require_company_verification', true),
      signup_open: Config.systemBool_('signup_open', true),
      maintenance_mode: Config.systemBool_('maintenance_mode', false),
      announcement: txt_(Config.systemGet('announcement', '')),
      demo_mode: Config.systemBool_('demo_mode', true),
      trial_days: Config.systemNum_('trial_days', 14),
      maps_api_key_set: !!Config.systemGet('maps_api_key', ''),
      whatsapp_enabled: Config.systemBool_('whatsapp_enabled', false),
      support_email: txt_(Config.systemGet('support_email', 'support@focushr.app'))
    };
  }
};

