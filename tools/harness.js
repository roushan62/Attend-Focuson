/**
 * FocusOn HRMS 2.0 — Node smoke test harness.
 * Loads src/*.gs (with GAS mocks), runs setupSystem -> seed -> api calls.
 * Usage: node tools/harness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('./gas-mock.js');

const ROOT = path.join(__dirname, '..', 'src');
const ORDER = [
  '00_Config.gs', '01_Core.gs', '02_DB.gs', '03_Auth.gs', '04_Access.gs',
  '05_Org.gs', '06_Workflow.gs', '07_Attendance.gs', '08_Leave.gs',
  '09_Payroll.gs', '10_People.gs', '11_Comms.gs', '12_Reports.gs',
  '13_System.gs', '14_Api.gs'
];

let failures = 0;
function ok(cond, msg) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg); if (!cond) failures++; }

// Load all .gs files into the global context (so `var`/`function` become global)
ORDER.forEach((file) => {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  try {
    vm.runInThisContext(code, { filename: file });
  } catch (e) {
    console.log('LOAD ERROR', file, e.message);
    process.exit(1);
  }
}
);

// globalThis points to global in Node
global.globalThis = global;

const api = global.api;

function show(label, res) {
  var err = (res && res.data && res.data.error) ? res.data.error : (res && res.error);
  console.log('  -->', label, res.ok ? 'OK' : 'ERR', res.ok ? '' : JSON.stringify(err));
  return res;
}

async function main() {
  console.log('===== FocusOn HRMS 2.0 smoke harness =====\n');

  // 1. setupSystem
  let res = show('setupSystem', await api('setupSystem', { force: true }));
  ok(res.ok, 'setupSystem initializes DB');

  // 2. login as Super Admin (FO-0001 / FocusOn@2026)
  res = show('auth.login (SA)', await api('auth.login', { mode: 'super', loginId: 'FO-0001', password: 'FocusOn@2026' }));
  const token = res.ok && res.data && res.data.token ? res.data.token : null;
  ok(!!token, 'Super Admin login returns token');

  if (token) {
    // 3. health (requires session)
    res = show('system.health', await api('system.health', { token }));
    ok(res.ok && res.data.setupDone === true, 'health reports setup done');

    // 4. boot
    res = show('boot', await api('boot', { token }));
    ok(res.ok && res.data && res.data.loggedIn === true, 'boot returns loggedIn');

    // 5. employee list (SA scope = company)
    res = show('org.employee.list', await api('org.employee.list', { token }));
    ok(res.ok && Array.isArray(res.data.rows), 'org.employee.list returns rows');

    // 6. create an employee via api
    res = show('org.employee.save (create)', await api('org.employee.save', {
      token, empCode: 'FO-9001', name: 'Test User', phone: '9000000001', email: 'test@focuson.in',
      departmentId: 'DP_ENG', branchId: 'BR_HO', designationId: '', doj: '2026-01-01',
      employmentType: 'Full-time', status: 'Active'
    }));
    ok(res.ok && res.data.empId, 'create employee via api');
    var newEmpId = res.data.empId;

    // 7. attendance check-in
    res = show('att.checkin', await api('att.checkin', { token, empId: newEmpId, lat: 28.6304, lng: 77.2177, acc: 10 }));
    ok(res.ok && (res.data.status === 'Present' || res.data.status === 'Flagged'), 'check-in works (status: ' + res.data.status + ')');

    // 8. leave apply
    res = show('lv.apply', await api('lv.apply', {
      token, empId: newEmpId, typeId: 'LV_CL', fromDate: '2026-11-15', toDate: '2026-11-15',
      days: 1, reason: 'Personal', attachment: ''
    }));
    ok(res.ok && res.data.reqId, 'leave apply creates request');

    // 9. payroll precheck + calculate
    res = show('pay.precheck', await api('pay.precheck', { token, yearMonth: '2026-11' }));
    ok(res.ok, 'payroll precheck');

    // 10. reports
    res = show('report.run (headcount)', await api('report.run', { token, kind: 'headcount' }));
    ok(res.ok, 'report.run headcount');

    // 11. backup
    res = show('system.backup', await api('system.backup', { token }));
    ok(res.ok && res.data.fileId, 'system.backup creates file');

    // 12. settings
    res = show('system.settings (get)', await api('system.settings', { token }));
    ok(res.ok, 'system.settings get');

    // 13. cron hourly
    res = show('cron.hourly', await api('cron.hourly', { token }));
    ok(res.ok, 'cron hourly runs');
  }

  console.log('\n===== ' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)') + ' =====');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
