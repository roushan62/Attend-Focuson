/**
 * ============================================================================
 *  dev/smoke-test.mjs
 *  End-to-end test of the real backend code (backend/*.gs) running on the
 *  local Apps Script polyfills. Exercises every phase of the roadmap:
 *  onboarding → users → projects → attendance engine → workflows → vendors →
 *  reports → payroll → exports → permissions → triggers.
 *
 *  Run:  npm test          (or: node dev/smoke-test.mjs)
 * ============================================================================
 */
import { loadBackend, checkSyntax } from './gas/loader.mjs';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.join(process.cwd(), 'dev', 'data-test');
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8YAQAAAoAAcXG9pcAAAAASUVORK5CYII=';

let passed = 0;
let failed = 0;
const failures = [];
let section = '';

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`
};

function head(title) {
  section = title;
  console.log('\n' + c.bold(c.cyan('▌ ' + title)));
}

function ok(name, extra = '') {
  passed++;
  console.log('  ' + c.green('✓') + ' ' + name + (extra ? c.dim('  ' + extra) : ''));
}

function bad(name, detail) {
  failed++;
  failures.push({ section, name, detail });
  console.log('  ' + c.red('✗') + ' ' + name + '\n      ' + c.red(String(detail).slice(0, 600)));
}

function check(name, condition, detail = '') {
  if (condition) ok(name, typeof detail === 'string' ? detail : JSON.stringify(detail));
  else bad(name, detail || 'condition was false');
  return !!condition;
}

/** Call the API and assert success (or assert a specific error code). */
function api(app, action, payload = {}, opts = {}) {
  const res = app.call(action, payload, opts);
  if (opts.expectError) {
    if (res.success) {
      bad(`${action} → expected failure`, JSON.stringify(res.data || {}).slice(0, 300));
      return { ok: false, res };
    }
    if (opts.expectError !== true && res.error.code !== opts.expectError) {
      bad(`${action} → wrong error code`, `expected ${opts.expectError}, got ${res.error.code}: ${res.error.message}`);
    } else {
      ok(`${action} correctly rejected`, `(${res.error.code}) ${res.error.message}`.slice(0, 110));
    }
    return { ok: false, res };
  }
  if (!res.success) {
    bad(`${action} failed`, res.error ? `${res.error.code}: ${res.error.message}` : JSON.stringify(res).slice(0, 400));
    return { ok: false, res };
  }
  return { ok: true, data: res.data, res };
}

/* ---------------------------------------------------------------- helpers */
function istDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Date.now() + offsetDays * 86400000));
}

function istMonth() { return istDate().slice(0, 7); }

function istNow(offsetMinutes = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(Date.now() + offsetMinutes * 60000));
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function main() {
  console.log(c.bold('\n🏗️  SiteTrack backend smoke test'));
  console.log(c.dim('    data dir: ' + DATA_DIR));

  // ---- syntax check -----------------------------------------------------
  head('Phase 0 — Apps Script source checks');
  const syntaxErrors = checkSyntax();
  check('every backend/*.gs file parses', syntaxErrors.length === 0, syntaxErrors);
  if (syntaxErrors.length) process.exit(1);
  const sources = fs.readdirSync(path.join(process.cwd(), 'backend')).filter((f) => f.endsWith('.gs'));
  ok(`loaded ${sources.length} backend modules`, sources.join(', ').slice(0, 200));

  // ---- fresh environment ------------------------------------------------
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const app = loadBackend({ dataDir: DATA_DIR });

  // ---- Phase 1: platform bootstrap + signup -----------------------------
  head('Phase 1 — Platform bootstrap, company signup & approval');
  const boot = api(app, 'bootstrapPlatform', { confirm: 'BOOTSTRAP', devMode: true, ownerEmail: 'owner@sitetrack.local' });
  check('bootstrapPlatform succeeded', boot.ok);
  const ownerKey = boot.data && boot.data.ownerKey;
  check('owner key generated', typeof ownerKey === 'string' && ownerKey.startsWith('STK-OWNER-'), ownerKey);
  check('platform master tabs created', boot.data && boot.data.tabs.length >= 4, boot.data && boot.data.tabs.join(','));

  const ping = api(app, 'ping');
  check('ping reports the API', ping.ok && ping.data.app === 'SiteTrack', ping.data && ping.data.version);

  const otpRes = api(app, 'sendSignupOtp', { mobile: '+919811100001', email: 'founder@acmefitout.example' });
  const signupOtp = otpRes.data && otpRes.data.devCode;
  check('signup OTP issued in dev mode', otpRes.ok && /^\d{6}$/.test(signupOtp || ''), signupOtp);

  const reg = api(app, 'registerCompany', {
    companyName: 'Acme Fitout Pvt Ltd', gst: '27AABCA1234F1Z5',
    address: '12 Site Road, Andheri East, Mumbai 400069',
    contactPerson: 'Asha Menon', designation: 'Director',
    email: 'founder@acmefitout.example', mobile: '+919811100001',
    industryType: 'Interior Fit-out', otp: signupOtp
  });
  check('company registered (pending)', reg.ok && reg.data.status === 'Pending', reg.data && reg.data.requestId);
  const requestId = reg.data && reg.data.requestId;

  api(app, 'registerCompany', {
    companyName: 'Acme Fitout Pvt Ltd', gst: '27AABCA1234F1Z5', address: '12 Site Road',
    contactPerson: 'Asha Menon', email: 'founder@acmefitout.example', mobile: '+919811100001',
    industryType: 'Interior Fit-out'
  }, { expectError: 409 });

  const status = api(app, 'signupStatus', { requestId });
  check('signup status is public & pending', status.ok && status.data.request.status === 'Pending');

  const owner = api(app, 'ownerLogin', { ownerKey });
  check('platform owner login', owner.ok && !!owner.data.token);
  const ownerToken = owner.data.token;
  api(app, 'ownerLogin', { ownerKey: 'wrong-key' }, { expectError: 401 });

  const pendings = api(app, 'listSignupRequests', { status: 'Pending' }, { token: ownerToken });
  check('owner sees pending requests', pendings.ok && pendings.data.count >= 1, `count=${pendings.data && pendings.data.count}`);
  api(app, 'listSignupRequests', {}, { expectError: 401 });

  const approval = api(app, 'approveCompany', { requestId, reviewNote: 'KYC verified' }, { token: ownerToken });
  check('company approved', approval.ok && !!approval.data.companyId, approval.data && approval.data.companyId);
  const companyId = approval.data.companyId;
  const superAdminId = approval.data.superAdminUserId;
  const tempPassword = approval.data.tempPassword;
  check('super admin credentials issued', !!superAdminId && !!tempPassword, `${superAdminId} / ${tempPassword}`);
  check('company spreadsheet created', approval.data.tabsCreated >= 17, `${approval.data.tabsCreated} tabs`);

  const companies = api(app, 'listCompanies', {}, { token: ownerToken });
  check('company registry lists the tenant', companies.ok && companies.data.count >= 1);
  const mail = app.dev.outbox.filter((m) => /Welcome to SiteTrack/.test(m.subject || ''));
  check('credentials e-mail was sent', mail.length >= 1, mail[0] && mail[0].to);

  // ---- Phase 2: login, wizard, projects, users --------------------------
  head('Phase 2 — Login, setup wizard, projects, users & assignments');
  const saLogin = api(app, 'login', {
    identifier: 'founder@acmefitout.example', password: tempPassword,
    deviceFingerprint: 'fp-superadmin-desktop-001', companyId
  });
  check('super admin login', saLogin.ok && !!saLogin.data.token);
  check('forced password reset flagged', saLogin.data.mustChangePassword === true);
  check('device bound on first login', saLogin.data.device.status === 'Bound', saLogin.data.device.status);
  const saToken = saLogin.data.token;

  api(app, 'login', { identifier: superAdminId, password: 'wrong-password', companyId }, { expectError: 401 });

  const pwd = api(app, 'changePassword', { currentPassword: tempPassword, newPassword: 'Acme@2026x' }, { token: saToken });
  check('password changed', pwd.ok && pwd.data.mustChangePassword === false);
  const saLogin2 = api(app, 'login', { identifier: superAdminId, password: 'Acme@2026x', deviceFingerprint: 'fp-superadmin-desktop-001', companyId });
  check('login works with the new password', saLogin2.ok);
  const saToken2 = saLogin2.data.token;

  // Window computed around "now" in IST so the engine marks Present.
  const winStart = istNow(-180);
  const winEnd = istNow(120);
  const wizard = api(app, 'completeSetupWizard', {
    companyName: 'Acme Fitout Pvt Ltd',
    companyAddress: '12 Site Road, Andheri East, Mumbai 400069, Maharashtra, India',
    gst: '27AABCA1234F1Z5', industryType: 'Interior Fit-out',
    defaultGeofenceRadius: 200, requireSelfie: true, requireDeviceBinding: true,
    attendanceWindowStart: winStart, attendanceWindowEnd: winEnd, lateGraceMinutes: 30,
    outWindowStart: istNow(60), outWindowEnd: istNow(480),
    workingDays: '1,2,3,4,5,6', weeklyOff: '0', timezone: 'Asia/Kolkata',
    holidays: [
      { date: istDate(12), name: 'Founding Day', type: 'Company', paid: true }
    ]
  }, { token: saToken2 });
  check('setup wizard completed', wizard.ok && wizard.data.setupCompleted === true);
  check('holiday added by the wizard', wizard.data.holidaysAdded === 1);

  const proj1 = api(app, 'createProject', {
    name: 'Andheri Office Fit-out', clientName: 'Prestige Infra', clientContact: '+919820011223',
    pmcName: 'BuildRight PMC', pmcContact: '+919820044556',
    lat: 19.1197, lng: 72.8464, geofenceRadius: 200, startDate: istDate(-20),
    endDate: istDate(90),
    address: 'Plot 47, MIDC Central Road, Andheri East, Mumbai 400093', codePrefix: 'FOI'
  }, { token: saToken2 });
  check('project 1 created with GPS lock', proj1.ok && /^PRJ-/.test(proj1.data.projectId), proj1.data && proj1.data.project.projectCode);
  const p1 = proj1.data.projectId;

  const proj2 = api(app, 'createProject', {
    name: 'BKC Tower Interior L14', clientName: 'Skyline Developers', clientContact: '+919820077889',
    address: 'G Block, Bandra Kurla Complex, Mumbai 400051',
    startDate: istDate(-10),
    geofenceRadius: 150, windowStart: winStart, windowEnd: winEnd
  }, { token: saToken2 });
  check('project 2 created (geocoded address path)', proj2.ok, proj2.data && proj2.data.project.projectCode);
  const p2 = proj2.data.projectId;

  api(app, 'createProject', { name: 'No client project', lat: 19.1, lng: 72.8, startDate: '2026-01-01' },
    { token: saToken2, expectError: 400 });

  const projects = api(app, 'listProjects', {}, { token: saToken2 });
  check('project list returns both sites', projects.ok && projects.data.count === 2, `count=${projects.data.count}`);

  const admin = api(app, 'createUser', {
    name: 'Rahul Verma', role: 'Admin', mobile: '+919811100010', email: 'rahul@acmefitout.example',
    designation: 'Operations Head', salaryType: 'Monthly', monthlySalary: 85000
  }, { token: saToken2 });
  check('admin created', admin.ok && admin.data.role === 'Admin', admin.data && admin.data.userId);
  const adminId = admin.data.userId;
  const adminPassword = admin.data.tempPassword;

  const sub = api(app, 'createUser', {
    name: 'Priya Nair', role: 'SubAdmin', mobile: '+919811100011', email: 'priya@acmefitout.example',
    designation: 'HR Executive', salaryType: 'Monthly', monthlySalary: 55000,
    permissions: { approveLeave: true, viewReports: true, exportReports: true, viewAllEmployees: true },
    projectScope: [p1]
  }, { token: saToken2 });
  check('sub-admin created with scoped permissions', sub.ok, sub.data && sub.data.userId);
  const subId = sub.data.userId;
  const subPassword = sub.data.tempPassword;

  const employees = [];
  const empSpecs = [
    { name: 'Suresh Kumar', mobile: '+919811100101', designation: 'Site Supervisor', roleOnSite: 'Supervisor', dailyWage: 950, project: p1 },
    { name: 'Imran Shaikh', mobile: '+919811100102', designation: 'Site Incharge', roleOnSite: 'SiteIncharge', dailyWage: 1100, project: p1 },
    { name: 'Anil Pawar', mobile: '+919811100103', designation: 'Carpenter', roleOnSite: 'Carpenter', dailyWage: 850, project: p1 },
    { name: 'Ravi Yadav', mobile: '+919811100104', designation: 'Electrician', roleOnSite: 'Electrician', dailyWage: 900, project: p2 },
    { name: 'Deepak Singh', mobile: '+919811100105', designation: 'Painter', roleOnSite: 'Painter', dailyWage: 800, project: p2 },
    { name: 'Vikram Rathore', mobile: '+919811100106', designation: 'Plumber', roleOnSite: 'Plumber', dailyWage: 870, project: p2 }
  ];
  for (const spec of empSpecs) {
    const r = api(app, 'createUser', {
      name: spec.name, role: 'Employee', mobile: spec.mobile, designation: spec.designation,
      salaryType: 'Daily', dailyWage: spec.dailyWage, projectId: spec.project, roleOnSite: spec.roleOnSite,
      weeklyOff: '0'
    }, { token: saToken2 });
    if (r.ok) employees.push({ ...spec, userId: r.data.userId, password: r.data.tempPassword, project: spec.project });
  }
  check('6 employees created and auto-assigned', employees.length === 6, employees.map((e) => e.userId).join(', '));

  const users = api(app, 'listUsers', { role: 'Employee' }, { token: saToken2 });
  check('employee list visible to super admin', users.ok && users.data.count === 6, `count=${users.data.count}`);

  const assign2 = api(app, 'assignEmployee', { projectId: p2, userId: employees[0].userId, roleOnSite: 'Supervisor' }, { token: saToken2 });
  check('employee assigned to a second project', assign2.ok);

  // ---- Phase 3: attendance engine ---------------------------------------
  head('Phase 3 — Attendance engine (GPS + selfie + geofence + window + device)');
  const empLogin = api(app, 'login', {
    identifier: employees[0].mobile, password: employees[0].password,
    deviceFingerprint: 'fp-suresh-pixel-01'
  });
  check('employee login by mobile number', empLogin.ok && empLogin.data.user.role === 'Employee');
  const empToken = empLogin.data.token;
  check('employee sees the assigned projects', empLogin.data.assignments.length === 2,
    empLogin.data.assignments.map((a) => a.projectName).join(' | '));

  const emp2Login = api(app, 'login', { identifier: employees[1].mobile, password: employees[1].password, deviceFingerprint: 'fp-imran-iphone-02' });
  const emp2Token = emp2Login.data.token;
  const emp3Login = api(app, 'login', { identifier: employees[2].mobile, password: employees[2].password, deviceFingerprint: 'fp-anil-redmi-03' });
  const emp3Token = emp3Login.data.token;
  check('second + third employees logged in', emp2Login.ok && emp3Login.ok);

  const markIn = api(app, 'markAttendance', {
    projectId: p1, lat: 19.11985, lng: 72.84655, accuracy: 12,
    selfieBase64: 'data:image/png;base64,' + TINY_PNG, deviceFingerprint: 'fp-suresh-pixel-01'
  }, { token: empToken });
  check('mark present inside the geofence', markIn.ok && markIn.data.status === 'Present',
    markIn.data && `distance=${markIn.data.distance}m radius=${markIn.data.radius}m`);
  check('selfie stored in Drive', markIn.data && markIn.data.selfieStored === true);
  const selfieFileId = markIn.data && markIn.data.attendance && markIn.data.attendance.selfieFileId;

  const dup = api(app, 'markAttendance', {
    projectId: p1, lat: 19.11985, lng: 72.84655, selfieBase64: TINY_PNG, deviceFingerprint: 'fp-suresh-pixel-01'
  }, { token: empToken });
  check('duplicate mark is refused politely', dup.ok && dup.data.alreadyMarked === true);

  const markFar = api(app, 'markAttendance', {
    projectId: p1, lat: 19.20000, lng: 72.95000, accuracy: 15,
    selfieBase64: TINY_PNG, deviceFingerprint: 'fp-imran-iphone-02'
  }, { token: emp2Token });
  check('mark outside the geofence → Flagged', markFar.ok && markFar.data.status === 'Flagged',
    markFar.data && `${markFar.data.distance}m — ${markFar.data.flagReason}`.slice(0, 120));

  const noSelfie = api(app, 'markAttendance', { projectId: p1, lat: 19.1197, lng: 72.8464, deviceFingerprint: 'fp-anil-redmi-03' },
    { token: emp3Token, expectError: 400 });
  check('selfie is mandatory', !noSelfie.ok);

  const badGps = api(app, 'markAttendance', { projectId: p1, lat: 0, lng: 0, selfieBase64: TINY_PNG, deviceFingerprint: 'fp-anil-redmi-03' },
    { token: emp3Token, expectError: 400 });
  check('0,0 GPS rejected', !badGps.ok);

  const goodMark3 = api(app, 'markAttendance', {
    projectId: p1, lat: 19.11960, lng: 72.84630, accuracy: 9, selfieBase64: TINY_PNG,
    deviceFingerprint: 'fp-anil-redmi-03'
  }, { token: emp3Token });
  check('third employee marked present', goodMark3.ok && goodMark3.data.status === 'Present');

  const markOut = api(app, 'markOut', { lat: 19.11980, lng: 72.84650, deviceFingerprint: 'fp-suresh-pixel-01' }, { token: empToken });
  check('mark out computes hours', markOut.ok && markOut.data.hoursWorked >= 0, markOut.data && `${markOut.data.hoursWorked}h`);

  // time-window violation — tighten PROJECT 2's own window (project overrides company)
  const p2Detail = api(app, 'getProject', { projectId: p2 }, { token: saToken2 });
  const p2Lat = p2Detail.data.project.lat, p2Lng = p2Detail.data.project.lng;
  const narrow = api(app, 'updateProject', {
    projectId: p2, windowStart: '01:00', windowEnd: '01:30'
  }, { token: saToken2 });
  check('project time window can be overridden', narrow.ok && narrow.data.project.windowEnd === '01:30',
    narrow.data && `${narrow.data.project.windowStart}–${narrow.data.project.windowEnd}`);
  api(app, 'saveSettings', { settings: { lateGraceMinutes: 0 } }, { token: saToken2 });
  const emp4Login = api(app, 'login', { identifier: employees[3].mobile, password: employees[3].password, deviceFingerprint: 'fp-ravi-oppo-04' });
  const outsideWindow = api(app, 'markAttendance', {
    projectId: p2, lat: p2Lat, lng: p2Lng, accuracy: 10, selfieBase64: TINY_PNG,
    deviceFingerprint: 'fp-ravi-oppo-04'
  }, { token: emp4Login.data.token });
  check('mark outside the time window → Flagged',
    outsideWindow.ok && outsideWindow.data.status === 'Flagged' && /window/i.test(outsideWindow.data.flagReason || ''),
    outsideWindow.data && outsideWindow.data.flagReason.slice(0, 140));
  api(app, 'updateProject', { projectId: p2, windowStart: winStart, windowEnd: winEnd }, { token: saToken2 });
  api(app, 'saveSettings', { settings: { lateGraceMinutes: 30 } }, { token: saToken2 });

  // device binding (anti-proxy)
  const newDevice = api(app, 'login', { identifier: employees[0].mobile, password: employees[0].password, deviceFingerprint: 'fp-someone-elses-phone' });
  check('login still works from a new device', newDevice.ok && newDevice.data.device.ok === false, newDevice.data && newDevice.data.device.reason.slice(0, 90));
  const proxyToken = newDevice.data.token;
  const proxyMark = api(app, 'markAttendance', {
    projectId: p1, lat: 19.1197, lng: 72.8464, selfieBase64: TINY_PNG, deviceFingerprint: 'fp-someone-elses-phone', force: true
  }, { token: proxyToken, expectError: 403 });
  check('buddy-punching blocked by device binding', !proxyMark.ok);

  const devReq = api(app, 'requestDeviceChange', { deviceFingerprint: 'fp-someone-elses-phone', deviceLabel: 'New Pixel 8', reason: 'Old phone screen broken' }, { token: proxyToken });
  check('device change requested', devReq.ok && devReq.data.status === 'ChangePending', devReq.data && devReq.data.message.slice(0, 80));
  const devices = api(app, 'listDeviceRegistry', { status: 'Pending' }, { token: saToken2 });
  check('admin sees the pending device', devices.ok && devices.data.count >= 1);
  const approveDevice = api(app, 'approveDeviceChange', { deviceId: devices.data.devices[0].deviceId, decision: 'approve' }, { token: saToken2 });
  check('device change approved', approveDevice.ok);
  const afterDevice = api(app, 'login', { identifier: employees[0].mobile, password: employees[0].password, deviceFingerprint: 'fp-someone-elses-phone' });
  check('new device now trusted', afterDevice.ok && afterDevice.data.device.ok === true, afterDevice.data && afterDevice.data.device.status);

  // QR fallback
  const qr = api(app, 'projectQrCode', { projectId: p1 }, { token: saToken2 });
  check('site QR payload issued', qr.ok && qr.data.payload.startsWith('SITETRACK|'), qr.data && qr.data.payload);
  const emp5Login = api(app, 'login', { identifier: employees[4].mobile, password: employees[4].password, deviceFingerprint: 'fp-deepak-vivo-05' });
  const qr2 = api(app, 'projectQrCode', { projectId: p2 }, { token: saToken2 });
  const qrMark = api(app, 'qrCheckin', {
    qrPayload: qr2.data.payload, selfieBase64: TINY_PNG, deviceFingerprint: 'fp-deepak-vivo-05'
  }, { token: emp5Login.data.token });
  check('QR fallback check-in works with selfie', qrMark.ok && qrMark.data.status === 'Present',
    qrMark.data && `${qrMark.data.status || qrMark.data.message} viaQr=${qrMark.data.viaQr}`);
  const qrNoSelfie = api(app, 'qrCheckin', { qrPayload: qr2.data.payload, deviceFingerprint: 'fp-deepak-vivo-05' },
    { token: emp5Login.data.token, expectError: 400 });
  check('QR check-in still requires a selfie', !qrNoSelfie.ok);
  const qrWrongCompany = api(app, 'qrCheckin', { qrPayload: 'SITETRACK|CMP-OTHER|' + p2 + '|X', selfieBase64: TINY_PNG, deviceFingerprint: 'fp-deepak-vivo-05' },
    { token: emp5Login.data.token, expectError: 403 });
  check('QR code from another company rejected', !qrWrongCompany.ok);

  // offline-first batch sync (Vikram is on p2 and gets a second assignment on p1)
  api(app, 'assignEmployee', { projectId: p1, userId: employees[5].userId, roleOnSite: 'Plumber' }, { token: saToken2 });
  const emp6Login = api(app, 'login', { identifier: employees[5].mobile, password: employees[5].password, deviceFingerprint: 'fp-vikram-moto-06' });
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const batch = api(app, 'markAttendance', {
    deviceFingerprint: 'fp-vikram-moto-06',
    batch: [
      { projectId: p1, lat: 19.11972, lng: 72.84642, accuracy: 20, capturedAt: twoHoursAgo, selfieBase64: TINY_PNG, source: 'offline' },
      { projectId: p2, lat: 28.6, lng: 77.2, capturedAt: twoHoursAgo, selfieBase64: TINY_PNG, source: 'offline' }
    ]
  }, { token: emp6Login.data.token });
  check('offline batch sync processed', batch.ok && batch.data.processed === 2,
    batch.data && JSON.stringify(batch.data.results.map((r) => r.ok ? (r.result.status || 'ok') : r.error)));
  check('offline entry inside geofence validated on captured time',
    batch.ok && batch.data.results[0].ok === true, batch.data && JSON.stringify(batch.data.results[0]).slice(0, 200));
  check('offline entry outside geofence flagged, not silently accepted',
    batch.ok && batch.data.results[1].ok === true && batch.data.results[1].result.status === 'Flagged');

  // review + regularization
  const flaggedList = api(app, 'listAttendance', { flaggedOnly: 'true' }, { token: saToken2 });
  check('flagged marks are listed for review', flaggedList.ok && flaggedList.data.count >= 1, `count=${flaggedList.data.count}`);
  const review = api(app, 'reviewAttendance', {
    attendanceId: flaggedList.data.attendance[0].attendanceId, decision: 'approve', status: 'Present',
    note: 'Confirmed on site by supervisor call'
  }, { token: saToken2 });
  check('flagged attendance approved', review.ok && review.data.status === 'Present');

  const regReq = api(app, 'requestRegularization', {
    date: istDate(-1), requestedStatus: 'Present',
    reason: 'Phone battery died before check-in; supervisor Imran can confirm I was on site',
    projectId: p1, inTime: '08:40', outTime: '19:00'
  }, { token: empToken });
  check('regularization request filed', regReq.ok && regReq.data.status === 'Pending');
  const regs = api(app, 'listRegularizations', {}, { token: saToken2 });
  check('regularization queue visible to admin', regs.ok && regs.data.count >= 1);
  const decideReg = api(app, 'decideRegularization', { requestId: regs.data.requests[0].requestId, decision: 'approve', note: 'Verified with supervisor' }, { token: saToken2 });
  check('regularization approved and written', decideReg.ok && decideReg.data.decision === 'Approved');

  const dash = api(app, 'todayDashboard', {}, { token: saToken2 });
  check('live dashboard computed', dash.ok && dash.data.totals.expected >= 5,
    dash.data && `expected=${dash.data.totals.expected} present=${dash.data.totals.present} flagged=${dash.data.totals.flagged} %=${dash.data.attendancePercentage}`);
  const map = api(app, 'liveMap', {}, { token: saToken2 });
  check('live map pins returned', map.ok && map.data.count >= 2, map.data && `pins=${map.data.count}`);

  const fileRes = api(app, 'getFile', { fileId: selfieFileId }, { token: empToken });
  check('selfie readable by its owner through the token gate', fileRes.ok && fileRes.data.dataUrl.startsWith('data:image/png'),
    fileRes.data && `${fileRes.data.size} bytes`);
  const otherEmpToken = emp2Token;
  api(app, 'getFile', { fileId: selfieFileId }, { token: otherEmpToken, expectError: 403 });

  // ---- Phase 4: leave / expense / transfer -------------------------------
  head('Phase 4 — Leave, expense, transfer & the approvals centre');
  const leave = api(app, 'requestLeave', {
    fromDate: istDate(2), toDate: istDate(3),
    type: 'Casual', reason: 'Family function in Nashik'
  }, { token: empToken });
  check('leave requested', leave.ok && leave.data.status === 'Pending', leave.data && `${leave.data.days} days`);
  api(app, 'requestLeave', {
    fromDate: istDate(2), toDate: istDate(3), type: 'Sick', reason: 'Overlap test'
  }, { token: empToken, expectError: 409 });

  const expense = api(app, 'requestExpense', {
    projectId: p1, amount: 1450, category: 'Travel', description: 'Taxi fare for client meeting (2 trips)',
    proofBase64: 'data:image/png;base64,' + TINY_PNG, receiptNo: 'TX-8841'
  }, { token: emp2Token });
  check('expense claimed with proof', expense.ok && expense.data.proofStored === true, expense.data && `${expense.data.amount}`);

  const transfer = api(app, 'requestTransfer', {
    toProjectId: p2, effectiveDate: istDate(4),
    travelPaid: true, reason: 'Carpentry finishing at BKC', roleOnSite: 'Carpenter'
  }, { token: emp3Token });
  check('site transfer requested', transfer.ok && transfer.data.status === 'Pending');

  const queue = api(app, 'approvalsQueue', {}, { token: saToken2 });
  check('approvals centre aggregates all queues', queue.ok && queue.data.total >= 3,
    queue.data && JSON.stringify(queue.data.counts));
  check('leave in the queue', queue.data.tabs.leave.length >= 1);
  check('expense in the queue', queue.data.tabs.expense.length >= 1);
  check('transfer in the queue', queue.data.tabs.transfer.length >= 1);

  const decideLeave = api(app, 'decideLeave', { leaveId: queue.data.tabs.leave[0].leaveId, decision: 'approve', note: 'Approved, plan covered' }, { token: saToken2 });
  check('leave approved', decideLeave.ok && decideLeave.data.status === 'Approved');
  const decideExp = api(app, 'decideExpense', { expenseId: queue.data.tabs.expense[0].expenseId, decision: 'approve', note: 'Bills verified' }, { token: saToken2 });
  check('expense approved', decideExp.ok && decideExp.data.status === 'Approved');
  const decideTr = api(app, 'decideTransfer', { transferId: queue.data.tabs.transfer[0].transferId, decision: 'approve', note: 'Manpower needed at BKC' }, { token: saToken2 });
  check('transfer approved', decideTr.ok && decideTr.data.status === 'Approved');

  const afterTransfer = api(app, 'listAssignments', { userId: employees[2].userId }, { token: saToken2 });
  check('transfer moved the assignment', afterTransfer.ok &&
    afterTransfer.data.assignments.some((a) => a.projectId === p2 && a.status === 'Active'));

  // ---- Phase 5: vendors --------------------------------------------------
  head('Phase 5 — Sub-vendor manpower');
  const vendor = api(app, 'saveVendor', {
    vendorName: 'Shree Labour Contractors', contactPerson: 'Dinesh Pal', mobile: '+919820111222',
    projectIds: [p1, p2], gst: '27AABCS1234C1Z9', ratePerHead: 650, paymentTerms: 'Weekly settlement'
  }, { token: saToken2 });
  check('vendor created', vendor.ok && vendor.data.created === true, vendor.data && vendor.data.vendorId);
  const vendorId = vendor.data.vendorId;

  const supToken = empToken; // Suresh is the Supervisor on p1
  const workerEntry = api(app, 'addVendorWorkerEntry', {
    vendorId, projectId: p1, workers: [
      { name: 'Ramesh Bind', designation: 'Helper', ratePerDay: 620 },
      { name: 'Sunil Koli', designation: 'Mason', ratePerDay: 700 }
    ]
  }, { token: supToken });
  check('supervisor logged vendor workers from mobile', workerEntry.ok && workerEntry.data.headcount === 2,
    workerEntry.data && `${workerEntry.data.headcount} heads, ${workerEntry.data.amountPayable}`);

  const bulkEntry = api(app, 'addVendorWorkerEntry', { vendorId, projectId: p1, count: 12, designation: 'Helper' }, { token: supToken });
  check('bulk headcount entry accepted', bulkEntry.ok && bulkEntry.data.headcount === 12);

  const manpower = api(app, 'vendorManpowerReport', { from: istDate(-7), to: istDate() }, { token: saToken2 });
  check('vendor manpower report built', manpower.ok && manpower.data.totalHeadcount >= 14,
    manpower.data && `heads=${manpower.data.totalHeadcount} amount=${manpower.data.totalAmount}`);

  const unauthorisedVendor = api(app, 'saveVendor', { vendorName: 'Rogue Labour', mobile: '+919820999888', projectIds: [p1] },
    { token: emp2Token, expectError: 403 });
  check('employees cannot create vendors', !unauthorisedVendor.ok);

  // ---- Phase 6: reports, payroll, exports --------------------------------
  head('Phase 6 — Reports, payroll wage sheet & exports');
  for (const type of ['monthlyAttendance', 'dailyAttendance', 'leaveSummary', 'expenseSummary', 'vendorManpower', 'flagged', 'projectSummary']) {
    const r = api(app, 'generateReport', { type, month: istMonth(), projectId: type === 'vendorManpower' ? undefined : undefined }, { token: saToken2 });
    check(`report: ${type}`, r.ok && Array.isArray(r.data.columns) && r.data.columns.length > 0,
      r.data && `rows=${r.data.rowCount}`);
  }
  const empHistory = api(app, 'generateReport', { type: 'employeeHistory', userId: employees[0].userId, month: istMonth() }, { token: saToken2 });
  check('report: employeeHistory', empHistory.ok && empHistory.data.rows.length >= 1, empHistory.data && `rows=${empHistory.data.rowCount}`);
  check('export includes the mandatory site address', empHistory.data.company.address.length > 10, empHistory.data.company.address);

  const payroll = api(app, 'generatePayrollSheet', { month: istMonth(), includeVendorLabour: true }, { token: saToken2 });
  check('payroll wage sheet generated', payroll.ok && payroll.data.employees.length >= 4,
    payroll.data && `employees=${payroll.data.employees.length} net=${payroll.data.totals.netPayable} OT=${payroll.data.totals.overtimeHours}h`);
  const payrollRow = payroll.data.employees.find((e) => e.userId === employees[0].userId);
  check('payroll row has days + wages + expenses', payrollRow && payrollRow.payableDays >= 0 && payrollRow.perDayRate > 0,
    payrollRow && `payable=${payrollRow.payableDays} rate=${payrollRow.perDayRate} net=${payrollRow.netPayable}`);
  check('vendor labour folded into payroll', payroll.data.vendorLabour && payroll.data.vendorLabour.totalManDays >= 14);

  const xlsx = api(app, 'exportReport', { type: 'payroll', format: 'xlsx', month: istMonth() }, { token: saToken2 });
  check('export → xlsx', xlsx.ok && xlsx.data.bytes > 0 && !!xlsx.data.dataUrl, xlsx.data && `${xlsx.data.bytes} bytes`);
  const pdf = api(app, 'exportReport', { type: 'monthlyAttendance', format: 'pdf', month: istMonth(), projectId: p1 }, { token: saToken2 });
  check('export → pdf', pdf.ok && pdf.data.bytes > 0, pdf.data && pdf.data.fileName);
  const csv = api(app, 'exportReport', { type: 'dailyAttendance', format: 'csv' }, { token: saToken2 });
  check('export → csv', csv.ok && csv.data.dataUrl.startsWith('data:text/csv'));

  const payrollReport = api(app, 'generateReport', { type: 'payroll', month: istMonth() }, { token: saToken2 });
  check('payroll also works through generateReport', payrollReport.ok && payrollReport.data.title.includes('Wage Sheet'));

  // ---- Phase 7: permissions, scope, audit --------------------------------
  head('Phase 7 — Role-based data masking & server-side scope enforcement');
  const subLogin = api(app, 'login', { identifier: subId, password: subPassword, deviceFingerprint: 'fp-priya-laptop-01', companyId });
  check('sub-admin login', subLogin.ok);
  const subToken = subLogin.data.token;
  check('sub-admin permission set honoured', subLogin.data.permissions.approveLeave === true && subLogin.data.permissions.createProjects !== true);
  check('sub-admin scope limited to project 1', JSON.stringify(subLogin.data.projectScope) === JSON.stringify([p1]),
    JSON.stringify(subLogin.data.projectScope));

  const subProjects = api(app, 'listProjects', {}, { token: subToken });
  check('sub-admin only sees in-scope projects', subProjects.ok && subProjects.data.count === 1,
    subProjects.data && subProjects.data.projects.map((x) => x.name).join(' | '));
  api(app, 'createProject', { name: 'Out of scope', clientName: 'X', clientContact: '1', lat: 19.1, lng: 72.8, startDate: '2026-01-01' },
    { token: subToken, expectError: 403 });
  api(app, 'saveSettings', { settings: { defaultGeofenceRadius: 500 } }, { token: subToken, expectError: 403 });
  const subUsers = api(app, 'listUsers', {}, { token: subToken });
  check('sub-admin sees only in-scope employees', subUsers.ok && subUsers.data.count >= 1 && subUsers.data.count < 9,
    subUsers.data && `count=${subUsers.data.count}`);
  const subApprove = api(app, 'approvalsQueue', {}, { token: subToken });
  check('sub-admin approvals queue works', subApprove.ok);
  api(app, 'listAuditLog', {}, { token: subToken, expectError: 403 });

  const adminLogin = api(app, 'login', { identifier: adminId, password: adminPassword, deviceFingerprint: 'fp-rahul-laptop-01', companyId });
  const adminToken = adminLogin.data.token;
  api(app, 'createUser', { name: 'Sneaky Admin', role: 'Admin', mobile: '+919811100777' }, { token: adminToken, expectError: 403 });
  check('admin cannot create other admins (§2)', true);

  const empSelfList = api(app, 'listUsers', {}, { token: empToken });
  check('employee sees only teammates (masked list)', empSelfList.ok && empSelfList.data.limited === true);
  api(app, 'createUser', { name: 'Nope', role: 'Employee', mobile: '+919811100888' }, { token: empToken, expectError: 403 });
  api(app, 'todayDashboard', {}, { token: empToken, expectError: 403 });
  api(app, 'listAttendance', { userId: employees[1].userId }, { token: empToken, expectError: 403 });
  const empSelfAttendance = api(app, 'listAttendance', {}, { token: empToken });
  check('employee can read their own history', empSelfAttendance.ok &&
    empSelfAttendance.data.attendance.every((a) => a.userId === employees[0].userId));

  const masked = api(app, 'getUser', { userId: employees[1].userId }, { token: saToken2 });
  check('user detail returned for admin', masked.ok && !!masked.data.user.Name);
  check('password hash never leaks', masked.data.user.PasswordHash === '' || masked.data.user.PasswordHash === undefined,
    String(masked.data.user.PasswordHash).slice(0, 12));

  const audit = api(app, 'listAuditLog', { limit: 20 }, { token: saToken2 });
  check('audit log records every admin action', audit.ok && audit.data.count >= 20, audit.data && `entries=${audit.data.count}`);
  const exportAudit = api(app, 'listAuditLog', { action: 'EXPORT_REPORT' }, { token: saToken2 });
  check('every export is audit-logged (§10)', exportAudit.ok && exportAudit.data.count >= 3,
    exportAudit.data && `${exportAudit.data.count} export log entries`);

  const summary = api(app, 'monthlySummary', { month: istMonth() }, { token: empToken });
  check('monthly summary for the employee', summary.ok && summary.data.summary.days.length >= 28,
    summary.data && `days=${summary.data.summary.days.length} present=${summary.data.summary.totals.present}`);

  const notifs = api(app, 'myNotifications', {}, { token: empToken });
  check('notification inbox populated', notifs.ok && notifs.data.count >= 1, notifs.data && `unread=${notifs.data.unread}`);

  // documents
  const docUp = api(app, 'uploadDocument', {
    docType: 'SafetyCertificate', fileBase64: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 dev').toString('base64'),
    fileName: 'safety-cert.pdf', expiryDate: istDate(10)
  }, { token: empToken });
  check('document uploaded with expiry', docUp.ok && docUp.data.document.status === 'ExpiringSoon',
    docUp.data && docUp.data.document.status);

  // ---- Phase 8: triggers & demo tenant -----------------------------------
  head('Phase 8 — Scheduled jobs, weather flag & demo tenant');
  const expiry = app.invoke('documentExpiryCheck');
  check('documentExpiryCheck ran across companies', expiry && expiry.processed >= 1, JSON.stringify(expiry).slice(0, 120));
  const close = app.invoke('dailyAttendanceClose');
  check('dailyAttendanceClose ran', close && close.processed >= 1);
  const weather = app.invoke('weatherFlagJob');
  check('weatherFlagJob ran', weather && weather.processed >= 1);
  const purge = app.invoke('purgeOldGpsData');
  check('purgeOldGpsData ran', purge && purge.processed >= 1);
  const monthly = app.invoke('monthlyAutoReport');
  check('monthlyAutoReport ran', monthly && monthly.companies >= 1 && monthly.errors.length === 0, JSON.stringify(monthly).slice(0, 160));
  const triggers = api(app, 'installTriggers', {}, { token: ownerToken });
  check('triggers installed', triggers.ok && triggers.data.installed.length === 5, triggers.data && triggers.data.installed.map((t) => t.status).join(','));
  const mailAfter = app.dev.outbox.filter((m) => /monthly report/i.test(m.subject || ''));
  check('monthly report e-mail delivered', mailAfter.length >= 1, mailAfter[0] && mailAfter[0].subject);

  const weatherCheck = api(app, 'checkSiteWeather', {}, { token: saToken2 });
  check('weather check returns site conditions', weatherCheck.ok && weatherCheck.data.sites.length >= 2);

  const demo = api(app, 'seedDemoCompany', { password: 'Demo@1234' }, { token: ownerToken });
  check('demo tenant seeded', demo.ok && demo.data.seeded.attendance > 100,
    demo.data && JSON.stringify(demo.data.seeded));
  const demoLogin = api(app, 'login', { identifier: '+919800000000', password: 'Demo@1234' });
  check('demo super admin can sign in', demoLogin.ok && demoLogin.data.company.companyName === 'Demo Fitout Pvt Ltd');
  const demoDash = api(app, 'todayDashboard', {}, { token: demoLogin.data.token });
  check('demo dashboard has live data', demoDash.ok && demoDash.data.totals.expected >= 5,
    demoDash.data && `projects=${demoDash.data.projects.length} expected=${demoDash.data.totals.expected}`);
  const demoEmp = api(app, 'login', { identifier: '+919800000011', password: 'Demo@1234', deviceFingerprint: 'fp-demo-suresh' });
  check('demo employee can sign in', demoEmp.ok && demoEmp.data.assignments.length >= 1);
  const demoPayroll = api(app, 'generatePayrollSheet', { month: istMonth() }, { token: demoLogin.data.token });
  check('demo payroll sheet computed', demoPayroll.ok && demoPayroll.data.employees.length >= 5,
    demoPayroll.data && `net=${demoPayroll.data.totals.netPayable}`);

  const ownerStats = api(app, 'ownerStats', {}, { token: ownerToken });
  check('platform owner stats', ownerStats.ok && ownerStats.data.totalCompanies >= 2,
    ownerStats.data && JSON.stringify(ownerStats.data.companies));
  const suspend = api(app, 'setCompanyStatus', { companyId, status: 'Suspended', reason: 'Payment default (test)' }, { token: ownerToken });
  check('company suspension works', suspend.ok);
  api(app, 'login', { identifier: superAdminId, password: 'Acme@2026x', companyId }, { expectError: 403 });
  api(app, 'setCompanyStatus', { companyId, status: 'Active' }, { token: ownerToken });
  const revived = api(app, 'login', { identifier: superAdminId, password: 'Acme@2026x', companyId });
  check('company reinstated', revived.ok);

  const health = api(app, 'health');
  check('health check green', health.ok && health.data.ok === true, health.data && JSON.stringify(health.data.checks.map((x) => x.name + ':' + x.ok)));

  // ---- summary ------------------------------------------------------------
  console.log('\n' + c.bold('─'.repeat(64)));
  if (failed === 0) {
    console.log(c.green(c.bold(`  ✅ ${passed} checks passed — backend is fully functional.`)));
  } else {
    console.log(c.red(c.bold(`  ❌ ${failed} failed, ${passed} passed`)));
    failures.forEach((f) => console.log(c.red(`     • [${f.section}] ${f.name}: ${String(f.detail).slice(0, 160)}`)));
  }
  console.log(c.bold('─'.repeat(64)) + '\n');
  console.log(c.dim(`  e-mails sent (mocked): ${app.dev.outbox.length}`));
  console.log(c.dim(`  outbound fetches (mocked): ${app.dev.fetchLog.length}`));
  console.log(c.dim(`  triggers registered: ${app.dev.triggers.length}`));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(c.red('\nSmoke test crashed: ' + (e && e.stack ? e.stack : e)));
  process.exit(1);
});
