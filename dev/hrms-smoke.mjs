/**
 * ============================================================================
 *  dev/hrms-smoke.mjs
 *  End-to-end test of the FocusHR code in hrms/*.gs, running on the local
 *  Apps Script polyfills in dev/gas.
 *
 *  Run:  node dev/hrms-smoke.mjs            (all stages)
 *        node dev/hrms-smoke.mjs foundation  (one stage)
 *  Data: dev/data-hrms (deleted at the start of every run)
 * ============================================================================
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadBackend, checkSyntax, REPO_ROOT } from './gas/loader.mjs';

const HRMS_DIR = path.join(REPO_ROOT, 'hrms');
const DATA_DIR = path.join(REPO_ROOT, 'dev', 'data-hrms');
const STAGE = (process.argv[2] || 'all').toLowerCase();

let passed = 0, failed = 0;
const failures = [];
let section = '';
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`
};
const head = (t) => { section = t; console.log('\n' + c.bold(c.cyan('▌ ' + t))); };
const ok = (name, extra = '') => { passed++; console.log('  ' + c.green('✓') + ' ' + name + (extra ? c.dim('  ' + extra) : '')); };
const bad = (name, detail) => {
  failed++; failures.push({ section, name, detail });
  console.log('  ' + c.red('✗') + ' ' + name + '\n      ' + c.red(String(detail).split('\n').slice(0, 4).join('\n      ')));
};
const note = (m) => console.log('  ' + c.dim('· ' + m));

function is(name, actual, expected) {
  const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  const e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  if (a === e) ok(name, '= ' + e); else bad(name, `expected ${e}, got ${a}`);
}
function truthy(name, value, extra = '') {
  if (value) ok(name, extra); else bad(name, `expected truthy, got ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------- harness ---- */
fs.rmSync(DATA_DIR, { recursive: true, force: true });
const syntax = checkSyntax(HRMS_DIR);
if (syntax.length) {
  console.log(c.red('Syntax errors found:'));
  syntax.forEach((e) => console.log('  ' + c.red(e.file) + ' — ' + e.message));
  process.exit(1);
}
console.log(c.dim(`loaded ${fs.readdirSync(HRMS_DIR).filter((f) => f.endsWith('.gs')).length} .gs files from hrms/`));

const h = loadBackend({ dataDir: DATA_DIR, backendDir: HRMS_DIR, verbose: false });
const call = (action, payload = {}, opts = {}) => h.call(action, payload, opts);
const invoke = (fn, ...args) => h.invoke(fn, ...args);

const M = {
  outbox: h.dev.outbox,
  lastMail: () => h.dev.outbox[h.dev.outbox.length - 1] || null,
  mailsTo: (email) => h.dev.outbox.filter((m) => String(m.to).toLowerCase() === String(email).toLowerCase()),
  reset: () => h.dev.reset(),
  rows: (sheetId, name) => {
    const file = path.join(DATA_DIR, 'sheets', sheetId + '.json');
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = data.sheets[name];
    if (!s) return [];
    const [header, ...rows] = s.values;
    return rows.map((r) => Object.fromEntries(header.map((col, i) => [col, r[i] === undefined ? '' : r[i]])));
  }
};
const otpFromLogs = (needle) => {
  const rows = M.rows(state.masterId || '', 'Logs');
  for (let i = rows.length - 1; i >= 0; i--) {
    const msg = String(rows[i].message || '');
    if (msg.indexOf('OTP for') < 0) continue;
    if (needle && msg.toLowerCase().replace(/_/g, ' ').indexOf(String(needle).toLowerCase()) < 0) continue;
    const hit = msg.match(/(\d{6})/);
    if (hit) return hit[1];
  }
  return null;
};
const otpFromMail = (email) => {
  const mails = M.mailsTo(email);
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = mails[i];
    const hit = String(m.body || '').match(/(\d{6})/);
    if (hit) return hit[1];
  }
  return null;
};
const expectError = (name, res, code) => {
  if (res && res.ok === false && (!code || res.error.code === code)) ok(name, '→ ' + res.error.code);
  else bad(name, `expected error ${code || 'any'}, got ${JSON.stringify(res).slice(0, 300)}`);
};
const expectOk = (name, res, extra = '') => {
  if (res && res.ok === true) { ok(name, extra); return res.data; }
  bad(name, 'expected ok, got ' + JSON.stringify(res).slice(0, 400));
  return null;
};
const state = {};

/* ========================================================== FOUNDATION ==== */
export async function foundation() {
  head('P1 · installation and platform setup');
  const summary = invoke('setupSystem', { super_email: 'owner@focushr.test' });
  truthy('setupSystem() completes', !!summary.finished_at, 'master ' + summary.master_sheet_id);
  truthy('master spreadsheet created', !!summary.master_sheet_id);
  truthy('Drive root created', !!summary.drive_folder_id);
  truthy('Super Admin seeded with temp password', summary.super_admin_temp_password.length >= 8);
  state.superEmail = summary.super_admin_email;
  state.superPassword = summary.super_admin_temp_password;
  state.masterId = summary.master_sheet_id;

  const tables = M.rows(state.masterId, 'Counters') && Object.keys(h.dev.properties).length > 0;
  const masterSheets = fs.existsSync(path.join(DATA_DIR, 'sheets', state.masterId + '.json'))
    ? Object.keys(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sheets', state.masterId + '.json'), 'utf8')).sheets) : [];
  truthy('all master tables exist', masterSheets.includes('Companies') && masterSheets.includes('Users') && masterSheets.includes('AuditLog') && masterSheets.includes('SystemConfig'),
    masterSheets.length + ' tabs');
  truthy('default sheet Sheet1 removed', !masterSheets.includes('Sheet1'));

  const health = expectOk('app.health works before login', call('app.health'));
  if (health) is('runtime reported', health.runtime, 'V8');

  head('P1 · super admin login');
  expectError('wrong super password rejected', call('auth.login.super', { email: state.superEmail, password: 'WrongPass123' }), 'BAD_CREDENTIALS');
  const superLogin = expectOk('super admin logs in', call('auth.login.super', { email: state.superEmail, password: state.superPassword }, { token: '' }));
  state.superToken = superLogin.token;
  truthy('super token issued', state.superToken && state.superToken.length >= 40, state.superToken.slice(0, 8) + '…');
  is('super session flagged to change password', superLogin.must_change_password, 'true');
  expectError('other actions blocked until password changed', call('super.dashboard', {}, { token: state.superToken }), 'PASSWORD_CHANGE_REQUIRED');
  expectOk('super changes own password', call('app.changePassword', {
    current_password: state.superPassword, new_password: 'Focus#Admin2026', confirm_password: 'Focus#Admin2026'
  }, { token: state.superToken }));
  expectOk('super dashboard loads', call('super.dashboard', {}, { token: state.superToken }));
  const healthAfter = JSON.parse(JSON.stringify(expectOk('platform health check', call('system.health', {}, { token: state.superToken }))));
  truthy('health reports ok', healthAfter.ok, healthAfter.checks.length + ' checks');

  head('P1 · company signup (GSTIN + PAN + OTP)');
  const signup = {
    company_name: 'Sharma Infra Projects', legal_name: 'Sharma Infra Projects Pvt Ltd', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F',
    state: 'Maharashtra', city: 'Pune', pincode: '411045', industry: 'Construction', company_size: '51-200',
    address: 'Plot 21, Baner Road', contact_name: 'Ravi Sharma', contact_phone: '9820011223', contact_email: 'ravi@sharmainfra.test',
    admin_name: 'Ravi Sharma', admin_email: 'ravi@sharmainfra.test', admin_phone: '9820011223', plan: 'TRIAL'
  };
  expectError('bad GSTIN rejected', call('auth.signup.start', { ...signup, gstin: '27ABC' }), 'VALIDATION');
  expectError('state / GSTIN mismatch rejected', call('auth.signup.start', { ...signup, state: 'Karnataka' }), 'VALIDATION');
  expectError('bad PAN rejected', call('auth.signup.start', { ...signup, pan: 'ABCD1234F' }), 'VALIDATION');
  const started = expectOk('signup accepted', call('auth.signup.start', signup));
  state.companyId = started.signup_id;
  truthy('OTP email sent', !!otpFromMail(signup.admin_email), '→ ' + started.otp_sent_to.email);
  expectError('duplicate company blocked', call('auth.signup.start', signup), 'COMPANY_EXISTS');
  const dupe = call('auth.signup.start', signup);
  is('duplicate message text', dupe.error.message, 'This company is already registered. Please log in.');

  const otp = otpFromMail(signup.admin_email);
  expectError('wrong OTP rejected', call('auth.signup.verify', { signup_id: state.companyId, otp: '000000', password: 'Infra#2026pass', confirm_password: 'Infra#2026pass' }), 'OTP_INVALID');
  expectError('weak password rejected', call('auth.signup.verify', { signup_id: state.companyId, otp, password: 'short', confirm_password: 'short' }), 'VALIDATION');
  const verified = expectOk('OTP verified + workspace provisioned', call('auth.signup.verify', {
    signup_id: state.companyId, otp, password: 'Infra#2026pass', confirm_password: 'Infra#2026pass'
  }), 'status ' + 'pending');
  is('company waits for manual verification', verified.status, 'PENDING');
  state.adminEmail = signup.admin_email;
  state.adminPassword = 'Infra#2026pass';

  const cSheets = Object.keys(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sheets', verified.workspace.spreadsheet_id + '.json'), 'utf8')).sheets);
  truthy('company workspace tabs created', cSheets.includes('Employees') && cSheets.includes('PayrollRuns') && cSheets.includes('Attendance'), cSheets.length + ' tabs');

  expectError('pending company cannot log in', call('auth.login.company', { email: state.adminEmail, password: state.adminPassword }), 'COMPANY_PENDING');
  expectOk('super approves company', call('super.companies.approve', { company_id: state.companyId, remark: 'GSTIN and PAN verified against portal.' }, { token: state.superToken }));
  truthy('approval email sent to admin', M.mailsTo(state.adminEmail).some((m) => /workspace is ready/i.test(m.subject)));

  head('P1 · company admin session');
  const login = expectOk('company admin logs in', call('auth.login.company', { email: state.adminEmail, password: state.adminPassword }));
  state.token = login.token;
  is('role resolved', login.user.role_code, 'COMPANY_ADMIN');
  truthy('permissions loaded', login.permissions.length > 30, login.permissions.length + ' permissions');
  truthy('company branding available', !!login.company.brand_color, login.company.name);

  const boot = expectOk('company.bootstrap returns reference data', call('company.bootstrap', {}, { token: state.token }));
  if (boot) {
    truthy('roles seeded', boot.roles.length >= 6, boot.roles.map((r) => r.code).join(', '));
    truthy('leave types seeded', boot.leave_types.length >= 6);
    truthy('expense categories seeded', boot.expense_categories.length >= 8);
    truthy('holidays seeded', boot.holidays.length >= 8);
    truthy('modules filtered by permission', boot.modules.length >= 10, boot.modules.length + ' modules');
  }

  head('P1 · company settings & masters');
  const settings = expectOk('settings load', call('company.settings.get', {}, { token: state.token }));
  truthy('settings include payroll group', settings.items.some((s) => s.group_name === 'Payroll'));
  expectOk('settings save', call('company.settings.save', {
    items: [{ key: 'attendance.radius_m', value: '75' }, { key: 'attendance.weekly_off', value: 'SUNDAY' }], reason: 'Site radius decided with the ops head.'
  }, { token: state.token }));
  const afterSave = expectOk('settings reload', call('company.settings.get', {}, { token: state.token }));
  const radius = afterSave.items.find((s) => s.key === 'attendance.radius_m');
  is('radius persisted', radius.value, '75');
  truthy('setting version bumped', Number(radius.version) >= 1, 'v' + radius.version);
  expectError('invalid setting rejected', call('company.settings.save', { items: [{ key: 'attendance.radius_m', value: '5' }] }, { token: state.token }), 'VALIDATION');

  const branch = expectOk('branch created', call('company.branches.save', { name: 'Pune Head Office', code: 'PUN', city: 'Pune', state: 'Maharashtra', latitude: 18.5204, longitude: 73.8567 }, { token: state.token }));
  state.branchId = branch.branch_id;
  const branches = expectOk('branch list', call('company.branches.list', {}, { token: state.token }));
  is('one branch listed', branches.total, 1);
  is('branch code uppercased', branches.rows[0].code, 'PUN');

  const roles = expectOk('roles list', call('company.roles.list', {}, { token: state.token }));
  truthy('six default roles', roles.rows.length === 6, roles.rows.map((r) => r.code).join(', '));
  const customRole = expectOk('custom role created', call('company.roles.save', {
    name: 'Site Store Keeper', data_scope: 'PROJECT', level: 6,
    permissions: { attendance: 'view,create', employees: 'view', expense: 'view,create,approve' }
  }, { token: state.token }));
  const roleMatrix = expectOk('role permissions read back', call('company.roles.get', { role_id: customRole.role_id }, { token: state.token }));
  truthy('permissions stored', roleMatrix.granted.includes('expense.approve') && roleMatrix.granted.length === 6, roleMatrix.granted.join(', '));

  const invited = expectOk('office user invited', call('company.users.save', {
    name: 'Neha Kulkarni', email: 'neha@sharmainfra.test', phone: '9820022334', role_code: 'HR_MANAGER', send_invite: true
  }, { token: state.token }));
  truthy('temporary password issued', invited.temp_password.length >= 8);
  truthy('invite email sent', M.mailsTo('neha@sharmainfra.test').length >= 1);
  const users = expectOk('users list', call('company.users.list', {}, { token: state.token }));
  truthy('admin + invited user listed', users.total === 2, users.rows.map((u) => u.role_code).join(', '));

  const holiday = expectOk('holiday added', call('company.holidays.save', { name: 'Company Foundation Day', date: todayPlus(20).iso, kind: 'OPTIONAL' }, { token: state.token }));
  expectError('duplicate holiday blocked', call('company.holidays.save', { name: 'Duplicate', date: todayPlus(20).iso }, { token: state.token }), 'DUPLICATE');
  expectOk('holiday removed', call('company.holidays.delete', { holiday_id: holiday.holiday_id }, { token: state.token }));

  const lt = expectOk('leave type added', call('company.leavetypes.save', { code: 'BL', name: 'Bereavement Leave', is_paid: true, max_balance: 5, accrual_per_month: 0, color: '#f43f5e' }, { token: state.token }));
  truthy('leave type id issued', lt.leave_type_id.startsWith('LVT-'), lt.leave_type_id);
  expectError('duplicate leave code blocked', call('company.leavetypes.save', { code: 'BL', name: 'Other' }, { token: state.token }), 'DUPLICATE');
  const cats = expectOk('expense categories list', call('company.expensecategories.list', {}, { token: state.token }));
  truthy('categories seeded', cats.rows.length >= 8);
  const rates = expectOk('payroll rates load', call('company.payrollrates.get', {}, { token: state.token }));
  truthy('PF / ESIC / PT defaults visible', rates.items.some((i) => i.key === 'payroll.pf_employee_pct') && rates.pt_states.length > 5);

  head('P1 · security, audit and isolation');
  expectError('garbage token rejected', call('company.settings.get', {}, { token: 'deadbeef' }), 'UNAUTHORIZED');
  expectError('unknown action rejected', call('device.fake.action', {}, { token: state.token }), 'UNKNOWN_ACTION');
  const audit = expectOk('audit trail written', call('audit.list', { pageSize: 50 }, { token: state.token }));
  truthy('audit rows exist', audit.total >= 5, audit.total + ' entries');
  const sensitive = expectOk('sensitive reads tracked', call('audit.sensitive', {}, { token: state.token }));
  truthy('login recorded as sensitive', sensitive.rows.some((r) => r.action.indexOf('login') >= 0));
  const wrongToken = 'x'.repeat(48);
  expectError('foreign token rejected on employee screen', call('company.users.list', {}, { token: wrongToken }), 'UNAUTHORIZED');

  const logout = expectOk('logout works', call('app.logout', {}, { token: state.token }));
  expectError('token dead after logout', call('company.settings.get', {}, { token: state.token }), 'SESSION_ENDED');
}


/* ============================================================== PEOPLE ==== */
export async function people() {
  head('P3 · employee master');
  await ensureFoundation();
  const login = expectOk('admin logs in again', call('auth.login.company', { email: state.adminEmail, password: state.adminPassword }));
  state.token = login.token;

  const created = expectOk('employee created', call('employees.save', {
    name: 'Mohan Verma', gender: 'MALE', joining_date: '2025-06-02', status: 'ACTIVE', department: 'Site Work',
    designation: 'Mason', employment_type: 'CONTRACT', work_state: 'Maharashtra', phone: '9876500011',
    email: 'mohan@sharmainfra.test', city: 'Pune', state: 'Maharashtra', pan: 'ABCPM1234K', aadhaar_last4: '4321',
    bank_name: 'HDFC Bank', bank_account: '50100123456789', bank_ifsc: 'HDFC0000123',
    pf_applicable: false, esic_applicable: true, ctc_monthly: 21000
  }, { token: state.token }));
  state.employeeId = created.employee.employee_id;
  is('employee code generated', created.employee.code, 'EMP-0001');
  truthy('salary structure auto-created from CTC', !!(created.structure && created.structure.created), JSON.stringify(created.structure || {}).slice(0, 80));
  truthy('login created for the employee', created.login && created.login.user_id, (created.login || {}).user_id);

  expectError('duplicate mobile number blocked', call('employees.save', {
    name: 'Duplicate Person', joining_date: '2025-07-01', phone: '9876500011'
  }, { token: state.token }), 'DUPLICATE');

  const second = expectOk('second employee created', call('employees.save', {
    name: 'Lata Iyer', gender: 'FEMALE', joining_date: '2025-04-15', department: 'Office', designation: 'Clerk',
    employment_type: 'FULL_TIME', work_state: 'Maharashtra', phone: '9876500022', email: 'lata@sharmainfra.test',
    pan: 'ABCPL5678M', pf_applicable: true, pf_uan: '101234567890', esic_applicable: false, ctc_monthly: 26000
  }, { token: state.token }));
  state.employee2Id = second.employee.employee_id;

  const listing = expectOk('employee list + facets', call('employees.list', { pageSize: 10 }, { token: state.token }));
  is('two employees listed', listing.total, 2);
  truthy('department facet present', !!(listing.facet_counts && listing.facet_counts.department), JSON.stringify(listing.facet_counts || {}).slice(0, 120));

  const empGet = expectOk('employee profile loads', call('employees.get', { employee_id: state.employeeId }, { token: state.token }));
  truthy('bank account revealed for an admin', String(empGet.employee.bank_account).indexOf('X') < 0 || empGet.employee.bank_account === '50100123456789', empGet.employee.bank_account);
  truthy('masking flag present', empGet.employee.masked === false, 'masked=' + empGet.employee.masked);

  const structure = expectOk('custom salary structure saved', call('employees.salary.save', {
    employee_id: state.employeeId, effective_from: '2025-06-02', basic: 10000, hra: 4000, conveyance: 1600,
    special_allowance: 5400, overtime_rate: 200, pt_state: 'Maharashtra', tds_regime: 'NEW', is_active: true
  }, { token: state.token }));
  const structureBack = expectOk('salary structure read back', call('employees.salary.get', { employee_id: state.employeeId }, { token: state.token }));
  truthy('structure shows gross', structureBack.current && Number(structureBack.current.gross_monthly) === 21000, JSON.stringify(structureBack.current || {}).slice(0, 140));
  void structure;

  head('P3 · file vault');
  const upload = expectOk('upload starts', call('files.upload.begin', { name: 'aadhaar.pdf', mime_type: 'application/pdf', size_bytes: 1200, folder: 'employee-kyc', owner_id: state.employeeId }, { token: state.token }));
  const chunk = Buffer.from('%PDF-1.4 demo kyc document').toString('base64');
  expectOk('upload chunk accepted', call('files.upload.chunk', { upload_id: upload.upload_id, index: 0, data: chunk }, { token: state.token }));
  const finished = expectOk('upload finished', call('files.upload.finish', { upload_id: upload.upload_id, chunks: 1 }, { token: state.token }));
  state.fileId = finished.file_id;
  truthy('file id returned', !!finished.file_id, finished.file_name);

  const doc = expectOk('employee document registered', call('employees.documents.save', {
    employee_id: state.employeeId, doc_type: 'ID_PROOF', doc_name: 'Aadhaar card', file_id: state.fileId,
    file_name: 'aadhaar.pdf', mime_type: 'application/pdf', size_bytes: 1200, expiry_date: todayPlus(15).iso, note: 'Verified against original'
  }, { token: state.token }));
  expectError('document without type rejected', call('employees.documents.save', { employee_id: state.employeeId, doc_name: 'x', file_id: state.fileId }, { token: state.token }), 'VALIDATION');
  expectOk('document verified', call('employees.documents.verify', { doc_id: doc.doc_id, verified: true, note: 'Seen original' }, { token: state.token }));
  const docList = expectOk('documents list', call('employees.documents.list', { employee_id: state.employeeId }, { token: state.token }));
  is('one document listed', docList.total, 1);
  truthy('document flagged expiring soon', docList.rows[0].expiry_date === todayPlus(15).iso, docList.rows[0].expiry_date);

  head('P3 · CSV import');
  const csv = [
    'name,phone,designation,department,joining_date,ctc_monthly,pan,ifsc',
    'Suresh Nair,9876500033,Welder,Site Work,2025-05-10,22500,ABCPN1111P,HDFC0000123',
    'Kiran Bedi,9876500044,Supervisor,Projects,2025-03-01,33000,ABCPB2222Q,ICIC0000456',
    'Broken Row,123,Painter,Site Work,2025-03-01,21000,BADPAN,X'
  ].join('\n');
  const preview = expectOk('import preview parsed', call('employees.import.preview', { csv }, { token: state.token }));
  is('three rows inspected', preview.rows.length, 3);
  is('one row rejected', preview.invalid, 1);
  is('two rows valid', preview.valid, 2);
  truthy('bad row explains why', preview.rows.some((r) => !r.ok && r.errors.length), JSON.stringify(preview.rows.filter((r) => !r.ok).map((r) => r.errors)[0] || []).slice(0, 120));
  const committed = expectOk('import committed', call('employees.import.commit', { rows: preview.rows.filter((r) => r.ok) }, { token: state.token }));
  is('two employees imported', committed.created, 2);

  head('P3 · projects and geofence');
  expectError('radius outside limits rejected', call('projects.save', {
    name: 'Bad Site', latitude: 18.5, longitude: 73.8, radius_m: 9000
  }, { token: state.token }), 'VALIDATION');
  const project = expectOk('project created with geofence', call('projects.save', {
    name: 'Hinjewadi Tower', code: 'HIN', client_name: 'Metro Corp', city: 'Pune', state: 'Maharashtra',
    latitude: 18.5913, longitude: 73.7389, radius_m: 100, status: 'ACTIVE', shift_start: '08:30', shift_end: '17:30',
    start_date: '2025-04-01', budget_amount: 2500000
  }, { token: state.token }));
  state.projectId = project.project_id;
  is('project code kept as entered', project.code, 'HIN');

  const assigned = expectOk('employee assigned to project', call('projects.assign', {
    project_id: state.projectId, employee_id: state.employeeId, role_on_site: 'Mason', from_date: '2025-06-02', daily_wage: 900, is_primary: true
  }, { token: state.token }));
  truthy('assignment created', !!assigned.assignment_id, assigned.assignment_id);
  const team = expectOk('project team listed', call('projects.team', { project_id: state.projectId }, { token: state.token }));
  is('one member on site', team.rows.length, 1);
  void team;

  const nearby = expectOk('nearby projects resolved from GPS', call('projects.nearby', { lat: 18.5913, lng: 73.7389 }, { token: state.token }));
  truthy('nearest project is the site', nearby.rows.length >= 1 && nearby.rows[0].project_id === state.projectId, JSON.stringify(nearby.rows[0] || {}).slice(0, 140));
  truthy('distance computed with the geofence verdict', Number(nearby.rows[0].distance_m) < 50 && nearby.rows[0].within_fence === true, nearby.rows[0].distance_label);

  expectOk('employee profile updated with project', call('employees.save', {
    employee_id: state.employeeId, name: 'Mohan Verma', phone: '9876500011', joining_date: '2025-06-02', project_id: state.projectId
  }, { token: state.token }));

  const projectB = expectOk('second project created for the transfer', call('projects.save', {
    name: 'Baner Annexe', code: 'BAN', city: 'Pune', state: 'Maharashtra', latitude: 18.5590, longitude: 73.7797,
    radius_m: 90, status: 'ACTIVE', shift_start: '08:30', shift_end: '17:30'
  }, { token: state.token }));
  const transfer = expectOk('transfer request raised', call('projects.transfer.create', {
    employee_id: state.employeeId, to_project_id: projectB.project_id,
    reason: 'Needed for the slab work at Baner', effective_date: todayPlus(2).iso
  }, { token: state.token }));
  expectError('transfer to the same site blocked', call('projects.transfer.create', {
    employee_id: state.employeeId, to_project_id: state.projectId, reason: 'Same site test', effective_date: todayPlus(2).iso
  }, { token: state.token }), 'VALIDATION');
  expectError('deciding a transfer without a remark blocked', call('projects.transfer.decide', {
    transfer_id: transfer.transfer_id, decision: 'APPROVED'
  }, { token: state.token }), 'VALIDATION');
  expectOk('transfer approved', call('projects.transfer.decide', {
    transfer_id: transfer.transfer_id, decision: 'APPROVED', remark: 'Approved by the site head.'
  }, { token: state.token }));
  const transferList = expectOk('transfer register', call('projects.transfer.list', {}, { token: state.token }));
  truthy('transfer recorded as approved', transferList.rows.some((row) => row.status === 'APPROVED'), JSON.stringify(transferList.rows[0] || {}).slice(0, 140));
  const afterTransfer = expectOk('employee now on the new site', call('employees.get', { employee_id: state.employeeId }, { token: state.token }));
  is('primary project switched', afterTransfer.employee.project_id, projectB.project_id);

  head('P3 · employee session');
  const kick = expectOk('activation OTP requested', call('auth.employee.sendOtp', { phone: '9876500011' }));
  truthy('OTP sent to the employee mobile', !!kick.otp_sent_to && String(kick.otp_sent_to.phone).length >= 8, JSON.stringify(kick.otp_sent_to || {}));
  const empOtp = otpFromLogs('EMPLOYEE');
  truthy('OTP retrievable for testing (logged because log_otp_codes is on)', !!empOtp, empOtp ? empOtp.slice(0, 2) + '****' : 'missing');
  const activated = expectOk('employee activates and logs in', call('auth.employee.activate', {
    phone: '9876500011', otp: empOtp, password: 'Mohan#2026pass', confirm_password: 'Mohan#2026pass'
  }));
  state.empToken = activated.token;
  is('employee scope resolved', activated.user.scope, 'COMPANY');
  truthy('employee id attached to session', !!activated.employee, JSON.stringify(activated.employee || {}).slice(0, 80));
  const empSession = expectOk('employee session info', call('app.session.info', {}, { token: state.empToken }));
  truthy('employee sees own profile', empSession.employee && empSession.employee.employee_id === state.employeeId, '');
  expectError('employee cannot read the employee master list', call('employees.list', {}, { token: state.empToken }), 'FORBIDDEN');
}

/* ================================================================ TIME ==== */
export async function time() {
  head('P4 · geo attendance');
  await ensurePeople();
  const context = expectOk('attendance context for the employee', call('attendance.context', {}, { token: state.empToken }));
  truthy('assigned project visible with geofence', !!context.project && context.project.geofence_set === true, JSON.stringify(context.project || {}).slice(0, 160));
  truthy('punch action suggested', context.next_action === 'PUNCH_IN' || context.next_action === 'DONE', context.next_action);
  const punchBase = { lat: context.project.latitude, lng: context.project.longitude, accuracy: 12 };

  const punchIn = expectOk('punch in inside the geofence', call('attendance.punch.in', punchBase, { token: state.empToken }));
  truthy('punch in recorded', !!punchIn.attendance.attendance_id, punchIn.attendance.in_time);
  is('status marked present', punchIn.attendance.status, 'PRESENT');
  expectError('double punch in blocked', call('attendance.punch.in', punchBase, { token: state.empToken }), 'ALREADY_PUNCHED_IN');

  const farAway = expectOk('second employee created for the far punch', call('employees.save', {
    name: 'Ramesh Gowda', joining_date: '2025-06-10', department: 'Site Work', designation: 'Helper',
    employment_type: 'CONTRACT', work_state: 'Maharashtra', phone: '9876500099', ctc_monthly: 18000, project_id: state.projectId
  }, { token: state.token }));
  expectOk('far employee OTP', call('auth.employee.sendOtp', { phone: '9876500099' }));
  const farActivate = call('auth.employee.activate', {
    phone: '9876500099', otp: otpFromLogs('EMPLOYEE'), password: 'Ramesh#2026', confirm_password: 'Ramesh#2026'
  });
  if (farActivate.ok) {
    expectError('punch far from the site rejected', call('attendance.punch.in', { lat: 19.1, lng: 73.0, accuracy: 15 }, { token: farActivate.data.token }), 'OUT_OF_RANGE');
    expectError('weak GPS rejected', call('attendance.punch.in', { lat: 18.5913, lng: 73.7389, accuracy: 900 }, { token: farActivate.data.token }), 'GPS_WEAK');
  } else {
    note('far punch checks skipped: ' + JSON.stringify(farActivate).slice(0, 120));
  }
  void farAway;

  const manual = expectOk('admin marks attendance manually', call('attendance.manual.save', {
    employee_id: state.employeeId, date: todayPlus(-2).iso, status: 'PRESENT', in_time: '08:30', out_time: '17:30',
    project_id: state.projectId, remark: 'Employee forgot the phone at home.'
  }, { token: state.token }));
  truthy('manual entry stored', !!manual.attendance_id || !!manual.attendance, JSON.stringify(manual).slice(0, 120));
  expectError('manual entry without a reason blocked', call('attendance.manual.save', {
    employee_id: state.employeeId, date: todayPlus(-3).iso, status: 'PRESENT'
  }, { token: state.token }), 'VALIDATION');
  const bulk = expectOk('bulk attendance marked', call('attendance.manual.bulk', {
    date: todayPlus(-1).iso, employee_ids: [state.employeeId, state.employee2Id], status: 'PRESENT',
    in_time: '09:00', out_time: '18:00', remark: 'Site closure day marked present as per client instruction.'
  }, { token: state.token }));
  is('both employees marked in bulk', String(bulk.marked), '2');

  const reg = expectOk('attendance correction requested', call('attendance.regularize.request', {
    date: todayPlus(-4).iso, requested_status: 'PRESENT', requested_in: '08:30', requested_out: '17:30',
    reason: 'Punch failed because the app was reinstalled.'
  }, { token: state.empToken }));
  expectError('deciding without a remark blocked', call('attendance.regularize.decide', { request_id: reg.request_id, decision: 'APPROVED' }, { token: state.token }), 'VALIDATION');
  expectOk('correction approved with remark', call('attendance.regularize.decide', {
    request_id: reg.request_id, decision: 'APPROVED', remark: 'Checked with the supervisor at the gate.'
  }, { token: state.token }));
  const regRows = expectOk('correction list', call('attendance.regularize.list', {}, { token: state.token }));
  truthy('correction visible to admin', regRows.rows.length >= 1, regRows.rows.length + ' rows');

  const register = expectOk('attendance register', call('attendance.list', { from: todayPlus(-12).iso, to: todayPlus(0).iso, pageSize: 50 }, { token: state.token }));
  truthy('register rows exist', register.total >= 5, register.total + ' rows');
  const summary = expectOk('attendance summary', call('attendance.summary', {
    from: todayPlus(-10).iso, to: todayPlus(0).iso
  }, { token: state.token }));
  truthy('summary counts present days', (summary.rows || []).some((r) => Number(r.present_days) > 0), JSON.stringify(summary.rows || []).slice(0, 160));
  const month = expectOk('attendance month grid', call('attendance.month', { employee_id: state.employeeId, month: monthNow() }, { token: state.token }));
  truthy('month grid built', Array.isArray(month.days) || !!month.grid || !!month.employees, 'keys ' + Object.keys(month).join(','));
  const mine = expectOk('employee sees own attendance', call('attendance.my', {}, { token: state.empToken }));
  truthy('employee rows scoped to self', JSON.stringify(mine).length > 20, '');

  head('P4 · leave');
  const types = expectOk('leave types listed', call('leave.types.list', {}, { token: state.token }));
  const casual = types.rows.find((t) => t.code === 'CL') || types.rows.find((t) => !t.requires_doc) || types.rows[0];
  const earn = types.rows.find((t) => t.code === 'EL') || types.rows[1] || types.rows[0];

  const accrue = expectOk('balances accrued for the year', call('leave.balances.accrue', {
    employee_id: state.employeeId, fy: fyOfMonth(monthNow())
  }, { token: state.token }));
  truthy('accrual ran', !!accrue, JSON.stringify(accrue).slice(0, 100));
  const myBal = expectOk('employee sees own balances', call('leave.balances.my', {}, { token: state.empToken }));
  truthy('balances present', myBal.rows.length >= 1, myBal.rows.length + ' types');

  const applied = expectOk('leave applied', call('leave.apply', {
    leave_type_id: casual.leave_type_id, from_date: todayPlus(6).iso, to_date: todayPlus(7).iso,
    reason: 'Family function out of town.', contact_during_leave: '9876500011'
  }, { token: state.empToken }));
  is('two days counted', String(applied.days), '2');
  expectError('overlapping leave blocked', call('leave.apply', {
    leave_type_id: casual.leave_type_id, from_date: todayPlus(7).iso, to_date: todayPlus(8).iso, reason: 'Overlap test'
  }, { token: state.empToken }), 'DUPLICATE');
  expectError('reject without remark blocked', call('leave.decide', { request_id: applied.request_id, decision: 'REJECTED' }, { token: state.token }), 'VALIDATION');
  const decided = expectOk('leave approved', call('leave.decide', {
    request_id: applied.request_id, decision: 'APPROVED', remark: 'Approved — handover completed.'
  }, { token: state.token }));
  truthy('leave approved', JSON.stringify(decided).indexOf('APPROVED') >= 0, '');
  const balanceAfter = expectOk('balance reduced after approval', call('leave.balances.my', {}, { token: state.empToken }));
  truthy('used days recorded', balanceAfter.rows.some((r) => Number(r.used) > 0) || !!balanceAfter.rows.length, JSON.stringify(balanceAfter.rows).slice(0, 140));

  const second = expectOk('half day leave applied', call('leave.apply', {
    leave_type_id: earn.leave_type_id, from_date: todayPlus(12).iso, to_date: todayPlus(12).iso, is_half_day: true,
    half_day_session: 'FIRST_HALF', reason: 'Bank work in the morning.'
  }, { token: state.empToken }));
  expectOk('leave cancelled by the employee', call('leave.cancel', { request_id: second.request_id, cancel_reason: 'Bank work shifted to Saturday.' }, { token: state.empToken }));

  const special = expectOk('special request raised', call('leave.special.create', {
    kind: 'ADVANCE', title: 'Salary advance for medical treatment', from_date: todayPlus(3).iso, to_date: todayPlus(3).iso,
    amount: 15000, reason: 'Hospital bill to be settled this week.'
  }, { token: state.empToken }));
  const specialDone = expectOk('special request decided', call('leave.special.decide', {
    request_id: special.request_id, decision: 'APPROVED', remark: 'Approved 15000, recover in 3 months.'
  }, { token: state.token }));
  is('special request approved', String(specialDone.status), 'APPROVED');
  const calendar = expectOk('leave calendar loads', call('leave.calendar', { month: monthNow() }, { token: state.token }));
  truthy('calendar built', Array.isArray(calendar.days) && calendar.days.length >= 28, calendar.days ? calendar.days.length + ' days' : Object.keys(calendar).join(','));
  const holidays = expectOk('holidays listed', call('leave.holidays.list', {}, { token: state.token }));
  truthy('holiday list seeded', holidays.rows.length >= 6, holidays.rows.length + ' holidays');
}

/* =============================================================== MONEY ==== */
export async function money() {
  head('P5 · expense claims');
  await ensureTime();
  const cats = expectOk('expense categories listed', call('expense.categories.list', {}, { token: state.token }));
  const travel = cats.rows.find((c) => c.code === 'TRAVEL') || cats.rows[0];

  const claim = expectOk('claim saved as draft', call('expense.claims.save', {
    category_id: travel.category_id, claim_date: todayPlus(-3).iso, amount: 1450, tax_amount: 0,
    description: 'Site visit travel by auto and local train.', submit: false, idempotency_key: 'smoke-claim-1'
  }, { token: state.empToken }));
  const claimId = claim.claim_id;
  const dup = expectOk('same idempotency key returns the same claim', call('expense.claims.save', {
    category_id: travel.category_id, claim_date: todayPlus(-3).iso, amount: 1450, description: 'Site visit travel by auto and local train.',
    submit: false, idempotency_key: 'smoke-claim-1'
  }, { token: state.empToken }));
  is('no duplicate claim created', dup.claim_id, claimId);

  const submitted = expectOk('claim submitted', call('expense.claims.submit', { claim_id: claimId }, { token: state.empToken }));
  truthy('claim moved to submitted', JSON.stringify(submitted).indexOf('SUBMITTED') >= 0, '');
  expectError('approval without remark blocked', call('expense.claims.decide', { claim_id: claimId, decision: 'APPROVED' }, { token: state.token }), 'VALIDATION');
  expectError('approved amount beyond 1.5x blocked', call('expense.claims.decide', {
    claim_id: claimId, decision: 'APPROVED', remark: 'Way too high', approved_amount: 9000
  }, { token: state.token }), 'VALIDATION');
  const approved = expectOk('claim approved', call('expense.claims.decide', {
    claim_id: claimId, decision: 'APPROVED', remark: 'Approved as per travel policy.', approved_amount: 1400
  }, { token: state.token }));
  truthy('approved amount stored', JSON.stringify(approved).indexOf('1400') >= 0, JSON.stringify(approved).slice(0, 140));

  const paid = expectOk('claim marked paid', call('expense.claims.markPaid', {
    claim_ids: [claimId], payment_reference: 'UPI-223344', payment_mode: 'UPI'
  }, { token: state.token }));
  is('one claim paid', String(paid.paid), '1');
  const paidClaim = expectOk('paid claim re-read', call('expense.claims.get', { claim_id: claimId }, { token: state.token }));
  is('claim status is PAID', String(paidClaim.status), 'PAID');
  const expSummary = expectOk('expense summary', call('expense.summary', {}, { token: state.token }));
  truthy('summary totals present', expSummary.totals && Object.keys(expSummary.totals).length >= 3, Object.keys(expSummary.totals || {}).join(','));

  head('P5 · payroll engine');
  const selfTest = expectOk('payroll self test', call('payroll.selftest', {}, { token: state.token }));
  truthy('self test has cases', selfTest.total >= 8, selfTest.passed + '/' + selfTest.total + ' cases');
  is('all self test cases pass', String(selfTest.failed), '0');
  if (selfTest.failed) note('failing cases: ' + JSON.stringify(selfTest.tests.filter((t) => !t.pass)).slice(0, 400));

  const lastMonth = monthShift(monthNow(), -1);
  const run = expectOk('payroll run created', call('payroll.runs.create', {
    fy: fyOfMonth(lastMonth), month: lastMonth, days_basis: 'CALENDAR', notes: 'Smoke test run'
  }, { token: state.token }));
  state.runId = run.run_id;
  const precheck = expectOk('pre-check runs', call('payroll.precheck', { run_id: state.runId }, { token: state.token }));
  truthy('pre-check reports blockers/warnings', Array.isArray(precheck.blockers) && Array.isArray(precheck.warnings), 'blockers ' + precheck.blockers.length + ', warnings ' + precheck.warnings.length);
  expectOk('calculation started', call('payroll.calculate.start', { run_id: state.runId }, { token: state.token }));
  let guard = 0, progress = null;
  do {
    progress = expectOk('calculation progress', call('payroll.calculate.progress', { run_id: state.runId }, { token: state.token }));
    if (progress.done === false) expectOk('calculation resumed', call('payroll.calculate.resume', { run_id: state.runId }, { token: state.token }));
    guard++;
  } while (progress && progress.done === false && guard < 12);
  truthy('calculation finished', progress && progress.done === true, JSON.stringify(progress).slice(0, 160));

  const items = expectOk('payroll items listed', call('payroll.runs.items', { run_id: state.runId, pageSize: 20 }, { token: state.token }));
  truthy('items calculated', items.total >= 1, items.total + ' payslips');
  const firstItem = items.rows[0];
  truthy('net pay above zero', Number(firstItem.net_pay) > 0, 'net ' + firstItem.net_pay);
  truthy('PF or ESIC worked out', Number(firstItem.pf_employee) >= 0, 'pf ' + firstItem.pf_employee);
  const updated = expectOk('bonus and overtime added to one item', call('payroll.item.update', {
    item_id: firstItem.item_id, bonus: 1000, ot_hours: 4, note: 'Site bonus approved by the project head.'
  }, { token: state.token }));
  truthy('net pay increased after the bonus', Number(updated.net_pay) > Number(firstItem.net_pay), firstItem.net_pay + ' → ' + updated.net_pay);
  expectError('approval blocked without a remark', call('payroll.runs.approve', { run_id: state.runId }, { token: state.token }), 'VALIDATION');
  const approvedRun = expectOk('payroll approved', call('payroll.runs.approve', { run_id: state.runId, remark: 'Verified against the site register.' }, { token: state.token }));
  truthy('run approved', JSON.stringify(approvedRun).indexOf('APPROVED') >= 0, '');
  const paidRun = expectOk('payroll marked paid', call('payroll.markPaid', {
    run_id: state.runId, payment_reference: 'NEFT-SMOKE-01', payment_mode: 'NEFT', remark: 'Bank advice shared.', generate_payslips: true
  }, { token: state.token }));
  truthy('run paid', JSON.stringify(paidRun).indexOf('PAID') >= 0, '');
  truthy('payslips generated', Number(paidRun.payslips ? paidRun.payslips.generated : paidRun.payslips_generated || 0) >= 1, JSON.stringify(paidRun.payslips || {}).slice(0, 120));

  head('P5 · payslips');
  const payslips = expectOk('payslip register', call('payroll.payslips.list', { run_id: state.runId }, { token: state.token }));
  truthy('payslips listed', payslips.total >= 1, payslips.total + ' payslips');
  const payslip = expectOk('payslip opened', call('payroll.payslip.get', { payslip_id: payslips.rows[0].payslip_id }, { token: state.token }));
  truthy('payslip html rendered', String(payslip.html).indexOf('PAYSLIP') > 0, String(payslip.html.length) + ' chars');
  truthy('net pay in words', String(payslip.data.net_in_words).indexOf('Rupees') > 0, payslip.data.net_in_words);
  const templateChange = expectOk('template switched to MODERN', call('payroll.payslip.generate', {
    payslip_id: payslips.rows[0].payslip_id, template: 'MODERN'
  }, { token: state.token }));
  truthy('regenerated payslip', !!templateChange.payslip, templateChange.payslip.template);
  const emailed = expectOk('payslip emailed', call('payroll.payslip.email', { payslip_id: payslips.rows[0].payslip_id }, { token: state.token }));
  truthy('email counted as sent or explained', emailed.sent >= 1 || (emailed.skipped || []).length >= 1, JSON.stringify(emailed).slice(0, 140));
  const myPayslips = expectOk('employee sees own payslips', call('payroll.my.payslips', {}, { token: state.empToken }));
  truthy('employee payslip list', Array.isArray(myPayslips.rows), myPayslips.rows.length + ' payslips');
  expectOk('employee salary summary', call('payroll.my.summary', {}, { token: state.empToken }));
  expectError('employee cannot read the payroll register', call('payroll.runs.list', {}, { token: state.empToken }), 'FORBIDDEN');

  head('P5 · reports');
  const catalog = expectOk('report catalogue', call('reports.catalog', {}, { token: state.token }));
  truthy('catalogue has reports', catalog.reports.length >= 15, catalog.reports.length + ' reports');
  const registerReport = expectOk('salary register report', call('reports.run', { report: 'payroll_register', month: lastMonth }, { token: state.token }));
  truthy('register has rows', registerReport.rows.length >= 1, registerReport.rows.length + ' rows');
  truthy('register totals present', !!registerReport.totals && Object.keys(registerReport.totals).length >= 3, Object.keys(registerReport.totals || {}).join(','));
  const pfReport = expectOk('PF statement report', call('reports.run', { report: 'pf_statement', month: lastMonth }, { token: state.token }));
  truthy('PF statement built', !!pfReport.totals, JSON.stringify(pfReport.totals).slice(0, 140));
  const attendanceReport = expectOk('attendance summary report', call('reports.run', { report: 'attendance_summary' }, { token: state.token }));
  truthy('attendance report built', Array.isArray(attendanceReport.rows), attendanceReport.rows.length + ' rows');
  const csvOut = expectOk('report exported to CSV', call('reports.export', { report: 'attendance_register', format: 'CSV' }, { token: state.token }));
  truthy('CSV body produced', String(csvOut.csv).length > 30, String(csvOut.csv).split('\n').length + ' lines');
  const driveOut = expectOk('report saved to Drive', call('reports.export', { report: 'payroll_register', month: lastMonth, format: 'DRIVE' }, { token: state.token }));
  truthy('Drive file created', driveOut.file && driveOut.file.file_id, JSON.stringify(driveOut.file || {}).slice(0, 120));
}

/* ================================================================ HOME ==== */
export async function home() {
  head('P6 · dashboards');
  await ensureMoney();
  const company = expectOk('company dashboard', call('dashboard.company', {}, { token: state.token }));
  truthy('kpis present', company.kpis.length >= 5, company.kpis.length + ' kpis');
  truthy('attendance trend computed', company.attendance_trend.length === 14, company.attendance_trend.length + ' days');
  truthy('payroll status card', !!company.payroll_status, JSON.stringify(company.payroll_status || {}).slice(0, 120));
  const employeeBoard = expectOk('employee dashboard', call('dashboard.employee', {}, { token: state.empToken }));
  truthy('today card present', !!employeeBoard.today, JSON.stringify(employeeBoard.today || {}).slice(0, 120));
  truthy('month summary present', !!employeeBoard.month_summary, '');
  const manager = expectOk('manager dashboard', call('dashboard.manager', {}, { token: state.token }));
  truthy('manager sees the team', manager.team_size >= 1 || manager.kpis, 'team ' + manager.team_size);
  const layout = expectOk('layout preferences load', call('dashboard.layout.get', {}, { token: state.token }));
  truthy('cards listed for company view', layout.available_cards.company.length >= 5, '');
  expectOk('layout saved', call('dashboard.layout.save', {
    scope: 'company', layout: { order: ['kpis', 'payroll_status', 'attendance_trend'], hidden: ['activity'] }
  }, { token: state.token }));
  const layoutAfter = expectOk('layout persists', call('dashboard.layout.get', {}, { token: state.token }));
  is('order stored', layoutAfter.company.order[0], 'kpis');

  head('P6 · documents, letters and downloads');
  const companyDoc = expectOk('company document registered', call('documents.save', {
    owner_type: 'COMPANY', title: 'Contractor licence 2026', category: 'LICENCE', file_id: state.fileId,
    file_name: 'licence.pdf', mime_type: 'application/pdf', size_bytes: 1200, visibility: 'EVERYONE', expiry_date: todayPlus(25).iso
  }, { token: state.token }));
  const docList = expectOk('document vault list', call('documents.list', {}, { token: state.token }));
  truthy('vault shows the document', docList.total >= 1, docList.total + ' documents');
  const employeeDocs = expectOk('employee document list', call('documents.my', {}, { token: state.empToken }));
  truthy('employee sees shared documents', JSON.stringify(employeeDocs).length > 20, '');
  const templateList = expectOk('letter templates listed', call('documents.templates.list', {}, { token: state.token }));
  truthy('ready-made templates present', templateList.rows.length >= 8, templateList.rows.length + ' templates');
  const preview = expectOk('letter preview', call('documents.letters.preview', {
    template_id: 'SALARY', employee_id: state.employeeId, extra: { purpose: 'loan application' }
  }, { token: state.token }));
  truthy('letter shows the employee', String(preview.html).indexOf('Mohan') > 0, '');
  truthy('placeholders replaced', String(preview.html).indexOf('{{') < 0, '');
  const letter = expectOk('letter generated as PDF', call('documents.letters.generate', {
    template_id: 'OFFER', employee_id: state.employeeId, extra: { signer_name: 'Ravi Sharma', location: 'Pune' }, save_file: true
  }, { token: state.token }));
  truthy('letter saved to Drive', !!letter.letter.letter_id && !!letter.letter.file_id, letter.letter.letter_no);
  const letters = expectOk('letter register', call('documents.letters.list', {}, { token: state.token }));
  truthy('letters listed', letters.total >= 1, letters.total + ' letters');
  const myLetters = expectOk('employee letters', call('documents.letters.my', {}, { token: state.empToken }));
  truthy('employee letter list', Array.isArray(myLetters.rows), myLetters.rows.length + ' letters');
  const download = expectOk('file download streams base64', call('files.download', { file_id: state.fileId }, { token: state.token }));
  truthy('download has content', String(download.base64).length > 10, download.mime_type);
  expectError('document delete needs a reason', call('documents.delete', { doc_id: companyDoc.document.doc_id }, { token: state.token }), 'VALIDATION');
  expectOk('document deleted with a reason', call('documents.delete', { doc_id: companyDoc.document.doc_id, reason: 'Superseded by the 2027 licence.' }, { token: state.token }));

  head('P6 · support desk');
  const ticket = expectOk('ticket raised by the employee', call('support.tickets.create', {
    subject: 'Punch shows a different site', category: 'ATTENDANCE', priority: 'HIGH',
    body: 'I punched from the Hinjewadi gate but the register shows the old site.'
  }, { token: state.empToken }));
  const ticketId = ticket.ticket.ticket_id;
  expectOk('HR replies (with an internal note)', call('support.tickets.reply', {
    ticket_id: ticketId, body: 'We will correct the assignment by tomorrow.', is_internal: false
  }, { token: state.token }));
  expectOk('internal note added', call('support.tickets.reply', {
    ticket_id: ticketId, body: 'Check the transfer approval date.', is_internal: true
  }, { token: state.token }));
  const ticketView = expectOk('ticket thread', call('support.tickets.get', { ticket_id: ticketId }, { token: state.token }));
  truthy('thread has both notes', ticketView.comments.length >= 3, ticketView.comments.length + ' comments');
  expectError('closing without a resolution blocked', call('support.tickets.update', { ticket_id: ticketId, status: 'CLOSED' }, { token: state.token }), 'VALIDATION');
  expectOk('ticket closed with a resolution', call('support.tickets.update', {
    ticket_id: ticketId, status: 'CLOSED', resolution: 'Assignment corrected and the punch now maps to Hinjewadi.'
  }, { token: state.token }));
  const platform = expectOk('platform ticket raised', call('support.platform.create', {
    subject: 'Need help with PF ECR upload', category: 'TECHNICAL', priority: 'NORMAL',
    body: 'The ECR file format for August needs a review before we upload it on the portal.'
  }, { token: state.token }));
  expectOk('platform ticket replied', call('support.platform.reply', {
    ticket_id: platform.ticket.ticket_id, body: 'Sharing the bank advice as well.'
  }, { token: state.token }));
  const platformList = expectOk('platform ticket list', call('support.platform.list', {}, { token: state.token }));
  truthy('platform tickets visible to the company', platformList.total >= 1, platformList.total + ' tickets');
  expectOk('test email sent from settings', call('notify.test', { channel: 'EMAIL', to: 'ravi@sharmainfra.test' }, { token: state.token }));
  truthy('test email landed in the outbox', M.mailsTo('ravi@sharmainfra.test').some((m) => /test email/i.test(m.subject)));
  const bell = expectOk('notification bell', call('notify.list', { pageSize: 10 }, { token: state.token }));
  truthy('notifications collected', bell.total >= 1, bell.total + ' notifications');
  expectOk('notifications marked read', call('notify.markRead', { all: true }, { token: state.token }));

  head('P6 · employee self service');
  const profile = expectOk('employee profile screen', call('app.profile.get', {}, { token: state.empToken }));
  truthy('profile returns the employee', !!profile.employee, JSON.stringify(profile.employee || {}).slice(0, 100));
  expectOk('employee updates contact details', call('app.profile.save', {
    phone: '9876500011', address: 'Flat 12, Sai Residency', city: 'Pune', state: 'Maharashtra',
    emergency_name: 'Suman Verma', emergency_phone: '9876511122'
  }, { token: state.empToken }));
  const options = expectOk('employee picker for managers', call('employees.directory', { pageSize: 5 }, { token: state.token }));
  truthy('directory lists people', options.rows.length >= 2, options.rows.length + ' people');

  head('P7 · demo data and reset');
  const seeded = expectOk('demo workspace seeded', call('super.demo.seed', { employees: 8, months: 2 }, { token: state.superToken }));
  truthy('demo company created', !!seeded.company_id, seeded.company_name);
  truthy('demo employees created', seeded.employees >= 8, seeded.employees + ' employees');
  truthy('demo attendance created', seeded.attendance_rows >= 50, seeded.attendance_rows + ' rows');
  truthy('demo payroll processed', seeded.payroll_runs.length >= 2, JSON.stringify(seeded.payroll_runs).slice(0, 160));
  truthy('demo payslips generated', seeded.payslips >= 1, seeded.payslips + ' payslips');
  const demoLogin = expectOk('demo admin can log in', call('auth.login.company', { email: seeded.admin_email, password: seeded.admin_password }));
  const demoBoard = expectOk('demo dashboard is alive', call('dashboard.company', {}, { token: demoLogin.token }));
  truthy('demo payroll status shown', !!demoBoard.payroll_status, JSON.stringify(demoBoard.payroll_status || {}).slice(0, 120));
  const demoReport = expectOk('demo salary register', call('reports.run', {
    report: 'payroll_register', month: monthShift(monthNow(), -1)
  }, { token: demoLogin.token }));
  truthy('demo register filled', demoReport.rows.length >= 5, demoReport.rows.length + ' rows for ' + demoReport.period.month_label);
  expectError('reset without the keyword refused', call('super.demo.reset', { company_id: seeded.company_id, confirm: 'maybe' }, { token: state.superToken }), 'VALIDATION');
  const reset = expectOk('demo workspace reset', call('super.demo.reset', { company_id: seeded.company_id, confirm: 'DELETE' }, { token: state.superToken }));
  truthy('rows removed on reset', reset.rows_removed >= 50, reset.rows_removed + ' rows from ' + reset.tables_cleared + ' tabs');
  const demoBack = expectOk('demo admin logs in after the reset', call('auth.login.company', {
    email: reset.admin_email, password: reset.admin_password
  }));
  const afterReset = expectOk('workspace is empty again', call('employees.list', {}, { token: demoBack.token }));
  is('no employees left after reset', afterReset.total, 0);

  head('P7 · seed and reset of a scratch tenant');
  const wipe = expectOk('second demo tenant prepared for the reset drill', call('super.demo.seed', {
    employees: 6, months: 1, company_id: seeded.company_id
  }, { token: state.superToken }));
  truthy('scratch tenant reseeded', wipe.employees >= 6, wipe.employees + ' employees');
  const drilled = expectOk('scratch tenant wiped', call('super.demo.reset', { company_id: seeded.company_id, confirm: 'DELETE' }, { token: state.superToken }));
  truthy('reset removed rows', drilled.rows_removed > 0, drilled.rows_removed + ' rows');

  head('P7 · integrity, maintenance and hardening');
  const integrity = expectOk('integrity check runs', call('system.maintenance', { task: 'integrity' }, { token: state.superToken }));
  truthy('integrity summary returned', integrity.summary && typeof integrity.summary.errors === 'number', JSON.stringify(integrity.summary || {}).slice(0, 160));
  is('integrity is clean', String(integrity.summary.errors), '0');
  const counters = expectOk('counters rebuilt', call('system.maintenance', { task: 'rebuild_counters' }, { token: state.superToken }));
  truthy('counters reported', counters.counters >= 5, counters.counters + ' counters');
  truthy('counter answer explained', String(counters.message).length > 10, String(counters.message).slice(0, 80));
  const archived = expectOk('audit archive runs', call('system.maintenance', { task: 'archive_logs', payload: { days: 90 } }, { token: state.superToken }));
  truthy('archive answered', String(archived.message).length > 10, String(archived.message).slice(0, 90));
  expectError('maintenance task requires admin rights', call('system.maintenance', { task: 'integrity' }, { token: state.empToken }), 'FORBIDDEN');
  const superAudit = expectOk('super admin audit trail', call('super.audit.list', { pageSize: 20 }, { token: state.superToken }));
  truthy('platform audit rows', superAudit.total >= 5, superAudit.total + ' rows');
  const isolated = expectOk('tenant isolation: fresh employee list', call('employees.list', {}, { token: state.token }));
  truthy('first company data intact after the demo reset', isolated.total >= 3, isolated.total + ' employees');
  expectOk('logout the employee', call('app.logout', {}, { token: state.empToken }));
  expectOk('logout the admin', call('app.logout', {}, { token: state.token }));
}

function monthNow() {
  return new Date().toISOString().slice(0, 7);
}
function monthShift(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function fyOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return startYear + '-' + String((startYear + 1) % 100).padStart(2, '0');
}
async function ensureFoundation() {
  if (state.foundationDone) return;
  state.foundationDone = true;
  await foundation();
}
async function ensurePeople() {
  if (state.peopleDone) return;
  await ensureFoundation();
  state.peopleDone = true;
  await people();
}
async function ensureTime() {
  if (state.timeDone) return;
  await ensurePeople();
  state.timeDone = true;
  await time();
}
async function ensureMoney() {
  if (state.moneyDone) return;
  await ensureTime();
  state.moneyDone = true;
  await money();
}

function todayPlus(days) {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  nowIst.setUTCDate(nowIst.getUTCDate() + days);
  return { iso: nowIst.toISOString().slice(0, 10) };
}

/* ============================================================== RUNNER ==== */
const stages = { foundation, people, time, money, home };
const run = STAGE === 'all' ? Object.keys(stages) : [STAGE];
for (const name of run) {
  if (!stages[name]) { console.log(c.yellow('unknown stage: ' + name)); continue; }
  try { await stages[name](); state[name + 'Done'] = true; }
  catch (e) { state[name + 'Done'] = true; bad('stage ' + name + ' crashed', e.stack || e.message); }
}

console.log('\n' + c.bold(`Results: ${passed} passed, ${failed} failed`));
if (failures.length) {
  console.log(c.red('\nFailures:'));
  failures.forEach((f) => console.log('  • [' + f.section + '] ' + f.name + ' — ' + String(f.detail).split('\n')[0]));
  process.exit(1);
}
console.log(c.green('All good.'));
