/**
 * ============================================================================
 *  FocusHR  —  Demo.gs
 *  One-click demo data: a fully populated construction company (people, sites,
 *  attendance, leave, expenses, payroll runs with payslips, tickets, letters)
 *  plus the reset that wipes a workspace back to a clean slate.
 * ============================================================================
 */

var Demo = {

  /** The installer (and the spreadsheet menu) call the seeder without a session. */
  systemCtx_: function (ctx) {
    if (ctx && ctx.userId) return ctx;
    return {
      scope: 'SUPER', userId: 'SYSTEM', name: 'FocusHR installer', companyId: '', employeeId: '',
      role_code: 'SUPER_ADMIN', ip: 'setup', userAgent: 'setup', system: true
    };
  },

  DEMO: {
    company_name: 'Sunrise Infra Demo Pvt Ltd',
    admin_name: 'Anita Deshmukh',
    admin_email: 'admin@sunrise-demo.test',
    admin_password: 'Demo#Focus2026',
    admin_phone: '9820011111',
    gstin: '27AAECS1234D1Z9',
    pan: 'AAECS1234D',
    state: 'Maharashtra',
    state_code: '27',
    city: 'Mumbai',
    address: '402, Sunrise Business Park, Andheri East',
    pincode: '400069'
  },

  PROJECT_SEEDS: [
    { code: 'PRJ-SUN-01', name: 'Sunrise Tower — Site A', client: 'Sunrise Realty', city: 'Mumbai', state: 'Maharashtra',
      lat: 19.1136, lng: 72.8697, radius: 120, shift: ['08:30', '17:30'], address: 'Plot 14, MIDC, Andheri East' },
    { code: 'PRJ-SUN-02', name: 'Metro Depot — Package 3', client: 'Metro Rail Corp', city: 'Pune', state: 'Maharashtra',
      lat: 18.5204, lng: 73.8567, radius: 150, shift: ['08:00', '17:00'], address: 'Survey 221, Hinjawadi Road' },
    { code: 'PRJ-SUN-03', name: 'Warehouse Shed — Bhiwandi', client: 'Warehouse One', city: 'Bhiwandi', state: 'Maharashtra',
      lat: 19.2813, lng: 73.0483, radius: 200, shift: ['09:00', '18:00'], address: 'Godown Road, Kalher' },
    { code: 'PRJ-SUN-04', name: 'Corporate Office', client: 'Sunrise Infra', city: 'Mumbai', state: 'Maharashtra',
      lat: 19.1176, lng: 72.8479, radius: 80, shift: ['09:30', '18:30'], address: '402, Sunrise Business Park' }
  ],

  PEOPLE: [
    { name: 'Ravi Sharma', gender: 'MALE', desig: 'Site Engineer', dept: 'Projects', type: 'FULL_TIME', ctc: 45000, state: 'Maharashtra', site: 0, site_role: 'Site Engineer', login: true },
    { name: 'Anita Deshmukh', gender: 'FEMALE', desig: 'HR Manager', dept: 'Human Resources', type: 'FULL_TIME', ctc: 62000, state: 'Maharashtra', site: 3, site_role: 'HR', login: true },
    { name: 'Imran Shaikh', gender: 'MALE', desig: 'Site Supervisor', dept: 'Projects', type: 'FULL_TIME', ctc: 32000, state: 'Maharashtra', site: 0, site_role: 'Supervisor', login: true },
    { name: 'Deepak Yadav', gender: 'MALE', desig: 'Mason', dept: 'Site Work', type: 'CONTRACT', ctc: 21000, state: 'Maharashtra', site: 0, site_role: 'Mason', login: false },
    { name: 'Sunita Pawar', gender: 'FEMALE', desig: 'Helper', dept: 'Site Work', type: 'CONTRACT', ctc: 16500, state: 'Maharashtra', site: 0, site_role: 'Helper', login: false },
    { name: 'Manoj Kumar', gender: 'MALE', desig: 'Bar Bender', dept: 'Site Work', type: 'CONTRACT', ctc: 23000, state: 'Maharashtra', site: 1, site_role: 'Bar Bender', login: false },
    { name: 'Sandeep Patil', gender: 'MALE', desig: 'Electrician', dept: 'Site Work', type: 'CONTRACT', ctc: 24500, state: 'Maharashtra', site: 1, site_role: 'Electrician', login: true },
    { name: 'Farhan Qureshi', gender: 'MALE', desig: 'Crane Operator', dept: 'Site Work', type: 'CONTRACT', ctc: 27500, state: 'Maharashtra', site: 1, site_role: 'Operator', login: false },
    { name: 'Kavita Joshi', gender: 'FEMALE', desig: 'Accountant', dept: 'Finance', type: 'FULL_TIME', ctc: 38000, state: 'Maharashtra', site: 3, site_role: 'Accounts', login: true },
    { name: 'Ramesh Naik', gender: 'MALE', desig: 'Store Keeper', dept: 'Stores', type: 'FULL_TIME', ctc: 26000, state: 'Maharashtra', site: 2, site_role: 'Stores', login: false },
    { name: 'Pooja Mehta', gender: 'FEMALE', desig: 'Junior Engineer', dept: 'Projects', type: 'FULL_TIME', ctc: 34000, state: 'Maharashtra', site: 2, site_role: 'Junior Engineer', login: true },
    { name: 'Ajay Singh', gender: 'MALE', desig: 'Welder', dept: 'Site Work', type: 'CONTRACT', ctc: 22500, state: 'Maharashtra', site: 2, site_role: 'Welder', login: false },
    { name: 'Neha Kulkarni', gender: 'FEMALE', desig: 'Office Assistant', dept: 'Administration', type: 'FULL_TIME', ctc: 19000, state: 'Maharashtra', site: 3, site_role: 'Admin', login: false },
    { name: 'Vikas Rathod', gender: 'MALE', desig: 'Painter', dept: 'Site Work', type: 'CONTRACT', ctc: 21500, state: 'Maharashtra', site: 1, site_role: 'Painter', login: false },
    { name: 'Shalini Rao', gender: 'FEMALE', desig: 'Safety Officer', dept: 'Safety', type: 'FULL_TIME', ctc: 41000, state: 'Maharashtra', site: 0, site_role: 'Safety', login: false },
    { name: 'Ganesh More', gender: 'MALE', desig: 'Plumber', dept: 'Site Work', type: 'CONTRACT', ctc: 20500, state: 'Maharashtra', site: 2, site_role: 'Plumber', login: false }
  ],

  /* =========================================================== seed ==== */
  seed: function (ctx, payload) {
    ctx = Demo.systemCtx_(ctx);
    Perm.require(ctx, 'super.manage');
    var startedAt = new Date().getTime();
    var wantPeople = Math.min(16, Math.max(6, intVal_(payload.employees, 12)));
    var wantMonths = Math.min(4, Math.max(1, intVal_(payload.months, 2)));

    var companyId = txt_(payload.company_id);
    var createdCompany = false;
    if (companyId) {
      companyRow_(companyId);
    } else {
      var found = Db.findOne(masterCtx_(), 'Companies', function (c) { return txt_(c.name) === Demo.DEMO.company_name; });
      if (found) {
        companyId = txt_(found.company_id);
      } else {
        var fresh = Db.insert(masterCtx_(), 'Companies', {
          name: Demo.DEMO.company_name, legal_name: Demo.DEMO.company_name,
          gstin: Demo.DEMO.gstin, pan: Demo.DEMO.pan, state_code: Demo.DEMO.state_code, state: Demo.DEMO.state,
          city: Demo.DEMO.city, address: Demo.DEMO.address, pincode: Demo.DEMO.pincode,
          contact_name: Demo.DEMO.admin_name, contact_email: Demo.DEMO.admin_email, contact_phone: Demo.DEMO.admin_phone,
          industry: 'Construction', company_size: '11-50', plan: 'GROWTH', status: 'ACTIVE',
          verification_mode: 'AUTO', verification_remark: 'Demo tenant created by the platform owner',
          brand_color: '#0f766e', admin_name: Demo.DEMO.admin_name, admin_email: Demo.DEMO.admin_email,
          admin_phone: Demo.DEMO.admin_phone, approved_at: nowIso_(), notes: 'DEMO'
        }, { system: true, actor: 'DEMO' });
        companyId = txt_(fresh.company_id);
        if (!companyId) fail_('SEED_FAILED', 'The demo company could not be created. Check the Logs tab for details.');
        Company.provision_(fresh,
          { admin_email: Demo.DEMO.admin_email, admin_name: Demo.DEMO.admin_name, admin_password: Demo.DEMO.admin_password },
          { admin_password: Demo.DEMO.admin_password, admin_name: Demo.DEMO.admin_name, admin_email: Demo.DEMO.admin_email, source: 'DEMO' });
        createdCompany = true;
      }
    }

    var company = companyRow_(companyId);
    var adminUser = txt_(company.admin_user_id)
      ? Db.find(masterCtx_(), 'Users', 'user_id', company.admin_user_id)
      : Db.findOne(masterCtx_(), 'Users', function (u) {
        return txt_(u.company_id) === companyId && txt_(u.role_code) === 'COMPANY_ADMIN';
      });
    if (!adminUser) fail_('SEED_FAILED', 'The demo company has no administrator login. Re-provision the workspace and try again.');

    /* Always make the demo admin login predictable. */
    var salt = randomSalt_();
    Db.update(masterCtx_(), 'Users', 'user_id', adminUser.user_id, {
      password_salt: salt, password_hash: hashPassword_(Demo.DEMO.admin_password, salt),
      password_set_at: nowIso_(), must_change_password: 'FALSE',
      status: 'ACTIVE', failed_attempts: 0, locked_until: ''
    }, { system: true });

    var c = companyCtx_(companyId, { requireActive: false });
    var actx = {
      scope: 'COMPANY', companyId: companyId, companyCtx: c, company: company,
      userId: txt_(adminUser.user_id), name: txt_(adminUser.name || Demo.DEMO.admin_name),
      employeeId: '', role_code: 'COMPANY_ADMIN', roleCode: 'COMPANY_ADMIN', ip: 'demo-seed', userAgent: 'FocusHR demo seeder'
    };

    var summary = {
      company_id: companyId, company_name: txt_(company.name), created_company: createdCompany,
      admin_email: txt_(adminUser.email), admin_password: Demo.DEMO.admin_password,
      branches: 0, projects: 0, employees: 0, logins: 0, assignments: 0, attendance_rows: 0,
      leave_requests: 0, expense_claims: 0, payroll_runs: [], payslips: 0, letters: 0, tickets: 0,
      warnings: []
    };

    /* ---------------------------------------------------------- branches - */
    var branches = [];
    if (!Db.count(c, 'Branches')) {
      branches = Db.insertMany(c, 'Branches', [
        { name: 'Head Office — Andheri', code: 'HO', address: '402, Sunrise Business Park', city: 'Mumbai', state: 'Maharashtra', pincode: '400069', phone: '02240001111', incharge_name: Demo.DEMO.admin_name, latitude: 19.1176, longitude: 72.8479, is_active: 'TRUE' },
        { name: 'Pune Site Office', code: 'PUN', address: 'Survey 221, Hinjawadi Road', city: 'Pune', state: 'Maharashtra', pincode: '411057', phone: '02040002222', incharge_name: 'Pooja Mehta', latitude: 18.5204, longitude: 73.8567, is_active: 'TRUE' }
      ], { actor: actx.userId });
    } else {
      branches = Db.all(c, 'Branches');
    }
    summary.branches = branches.length;
    var branchIds = branches.map(function (b) { return txt_(b.branch_id); });

    /* ---------------------------------------------------------- projects - */
    var existingProjects = Db.all(c, 'Projects');
    var projects = existingProjects;
    if (existingProjects.length < 2) {
      var projectTests = Math.min(Demo.PROJECT_SEEDS.length, Math.max(2, intVal_(payload.projects, 3)));
      var toCreate = Demo.PROJECT_SEEDS.slice(0, projectTests).map(function (p, idx) {
        return {
          code: p.code, name: p.name, client_name: p.client, site_address: p.address, city: p.city, state: p.state,
          pincode: '400001', latitude: p.lat, longitude: p.lng, radius_m: p.radius, location_locked: 'TRUE',
          start_date: isoAddDays_(todayIso_(), -180 + idx * 15), status: 'ACTIVE', budget_amount: 2500000 + idx * 750000,
          shift_start: p.shift[0], shift_end: p.shift[1], weekly_off: 'SUNDAY',
          notes: 'Demo site — geo fence of ' + p.radius + ' m around the gate.'
        };
      });
      projects = existingProjects.concat(Db.insertMany(c, 'Projects', toCreate, { actor: actx.userId }));
    }
    summary.projects = projects.length;

    /* --------------------------------------------------------- employees - */
    var existingEmployees = Db.all(c, 'Employees');
    var newPeople = Demo.PEOPLE.slice(0, wantPeople);
    var createdEmployees = [];
    if (existingEmployees.length < 3) {
      createdEmployees = newPeople.map(function (person, idx) {
        var phone = '98' + (20000000 + idx * 137) ;
        var email = Demo.loginEmail_(person, idx);
        var project = projects[person.site % projects.length] || null;
        return {
          name: person.name, gender: person.gender, dob: isoAddDays_(todayIso_(), -(9000 + idx * 130)),
          joining_date: isoAddDays_(todayIso_(), -(120 + idx * 7)), status: 'ACTIVE', department: person.dept,
          designation: person.desig, branch_id: branchIds[person.site === 3 ? 0 : Math.min(1, branchIds.length - 1)],
          project_id: project ? txt_(project.project_id) : '', employment_type: person.type, work_state: person.state,
          phone: phone, email: email, address: 'Flat ' + (101 + idx) + ', Shanti Nagar', city: 'Mumbai', state: 'Maharashtra',
          pincode: '4000' + (60 + (idx % 40)), emergency_name: 'Family contact', emergency_phone: '98' + (31000000 + idx * 251),
          blood_group: ['A+', 'B+', 'O+', 'AB+'][idx % 4],
          pan: 'ABCPD' + (1000 + idx) + 'K', aadhaar_last4: String(4000 + idx * 7).slice(-4),
          bank_name: ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank'][idx % 4],
          bank_account: '501' + (10000000 + idx * 913),
          bank_ifsc: ['HDFC0000123', 'ICIC0000456', 'SBIN0000789', 'UTIB0000321'][idx % 4],
          bank_holder: person.name,
          pf_applicable: person.type === 'FULL_TIME' ? 'TRUE' : 'FALSE',
          pf_uan: person.type === 'FULL_TIME' ? '10' + (12345678900 + idx) : '',
          esic_applicable: person.type === 'CONTRACT' ? 'TRUE' : 'FALSE',
          esic_ip_no: person.type === 'CONTRACT' ? '31' + (2345678900 + idx) : '',
          pt_applicable: 'TRUE', tds_applicable: person.type === 'FULL_TIME' ? 'TRUE' : 'FALSE',
          ctc_monthly: person.ctc, remarks: 'Created by the FocusHR demo seeder.'
        };
      });
      createdEmployees = Db.insertMany(c, 'Employees', createdEmployees, { actor: actx.userId });
      summary.warnings.push('Employees were created without linking manager reporting lines first — open a profile to set the reporting manager if you need an approval chain.');
    } else {
      createdEmployees = existingEmployees;
    }
    summary.employees = createdEmployees.length;

    /* Set a reporting manager for everyone (first site engineer / HR manager). */
    var hrPerson = createdEmployees[1];
    var engineer = createdEmployees[0];
    createdEmployees.forEach(function (e, idx) {
      if (idx < 2) return;
      if (txt_(e.manager_id)) return;
      var manager = txt_(e.department) === 'Human Resources' ? engineer : (txt_(e.department) === 'Projects' ? engineer : hrPerson);
      Db.update(c, 'Employees', 'employee_id', e.employee_id, { manager_id: manager ? manager.employee_id : '' }, { actor: actx.userId });
      e.manager_id = manager ? manager.employee_id : '';
    });

    /* -------------------------------------------------- salary structures - */
    var structures = [];
    createdEmployees.forEach(function (e, idx) {
      if (Db.findOne(c, 'SalaryStructures', function (s) { return txt_(s.employee_id) === e.employee_id && boolVal_(s.is_active); })) return;
      var person = newPeople[idx] || newPeople[0];
      var ctc = numVal_(e.ctc_monthly) || numVal_(person.ctc) || 20000;
      var basic = round0_(ctc * 0.5);
      var hra = round0_(basic * 0.4);
      var conveyance = 1600;
      var special = Math.max(0, round0_(ctc - basic - hra - conveyance));
      structures.push({
        employee_id: e.employee_id, effective_from: txt_(e.joining_date) || isoAddDays_(todayIso_(), -120),
        basic: basic, hra: hra, da: 0, conveyance: conveyance, special_allowance: special, other_allowance: 0,
        overtime_rate: round0_(round0_(ctc / 26 / 8) * 2), pf_employee_pct: 12, pf_employer_pct: 12,
        esic_employee_pct: 0.75, esic_employer_pct: 3.25, pt_state: 'Maharashtra',
        tds_regime: idx % 5 === 0 ? 'OLD' : 'NEW', is_active: 'TRUE', note: 'Demo structure'
      });
    });
    if (structures.length) Db.insertMany(c, 'SalaryStructures', structures, { actor: actx.userId });

    /* ------------------------------------------- logins + assignments ---- */
    var logins = 0;
    var assignments = [];
    var assignmentRows = [];
    createdEmployees.forEach(function (e, idx) {
      var person = newPeople[idx] || newPeople[0];
      if (person.login) {
        try {
          var out = Employees.ensureLogin_(actx, e, false);
          if (out && out.user_id) logins++;
        } catch (err) {
          summary.warnings.push('Login for ' + person.name + ' could not be created: ' + err.message);
        }
      }
      var project = projects[(person.site || 0) % projects.length];
      if (!project) return;
      if (Db.findOne(c, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === e.employee_id && txt_(a.project_id) === txt_(project.project_id) && txt_(a.status) === 'ACTIVE';
      })) return;
      assignmentRows.push({
        project_id: txt_(project.project_id), employee_id: e.employee_id, employee_name: txt_(e.name),
        role_on_site: person.site_role, from_date: txt_(e.joining_date), to_date: '', status: 'ACTIVE',
        is_primary: 'TRUE', daily_wage: round0_(numVal_(e.ctc_monthly) / 26), note: 'Demo deployment'
      });
    });
    if (assignmentRows.length) assignments = Db.insertMany(c, 'ProjectAssignments', assignmentRows, { actor: actx.userId });
    summary.logins = logins;
    summary.assignments = assignments.length;

    /* -------------------------------------------------------- attendance - */
    var holidayDates = {};
    Db.all(c, 'Holidays').forEach(function (h) { holidayDates[txt_(h.date)] = txt_(h.name); });
    var attendanceRows = [];
    var days = Math.min(60, 28 * wantMonths);
    for (var d = days; d >= 0; d--) {
      var date = isoAddDays_(todayIso_(), -d);
      if (date > todayIso_()) continue;
      var weekend = isWeekOff_(date);
      var holiday = holidayDates[date];
      createdEmployees.forEach(function (e, idx) {
        if (Db.findOne(c, 'Attendance', function (a) {
          return txt_(a.employee_id) === e.employee_id && txt_(a.date) === date;
        })) return;
        var project = projects[(newPeople[idx] || newPeople[0]).site % projects.length] || projects[0];
        var shiftStart = project ? txt_(project.shift_start) || '09:00' : '09:00';
        var shiftEnd = project ? txt_(project.shift_end) || '18:00' : '18:00';
        var shiftMinutes = Math.max(60, timeToMinutes_(shiftEnd) - timeToMinutes_(shiftStart));
        if (weekend || holiday) {
          attendanceRows.push({
            employee_id: e.employee_id, employee_code: txt_(e.code), employee_name: txt_(e.name), date: date,
            project_id: project ? txt_(project.project_id) : '', project_name: project ? txt_(project.name) : '',
            status: weekend ? 'WEEKLY_OFF' : 'HOLIDAY', source: 'SYSTEM', remark: weekend ? 'Weekly off' : holiday,
            shift_minutes: shiftMinutes
          });
          return;
        }
        var roll = (idx * 7 + d * 13) % 100;
        var status = roll < 82 ? 'PRESENT' : (roll < 88 ? 'HALF_DAY' : (roll < 94 ? 'ABSENT' : 'LEAVE'));
        var inTime = '';
        var outTime = '';
        var worked = 0;
        var late = 0;
        var overtime = 0;
        if (status === 'PRESENT' || status === 'HALF_DAY') {
          var lateRoll = (idx + d) % 6 === 0 ? 12 + ((idx * 3 + d) % 25) : 0;
          var inMinutes = timeToMinutes_(shiftStart) + lateRoll;
          inTime = minutesToTime_(inMinutes);
          late = lateRoll > 10 ? lateRoll : 0;
          var workMinutes = status === 'HALF_DAY' ? Math.round(shiftMinutes / 2) : shiftMinutes + ((idx + d) % 5 === 0 ? 75 : 0);
          outTime = minutesToTime_(inMinutes + workMinutes);
          worked = workMinutes;
          if (status === 'PRESENT' && worked > shiftMinutes + 30) overtime = worked - shiftMinutes;
        }
        attendanceRows.push({
          employee_id: e.employee_id, employee_code: txt_(e.code), employee_name: txt_(e.name), date: date,
          project_id: project ? txt_(project.project_id) : '', project_name: project ? txt_(project.name) : '',
          status: status, in_time: inTime, out_time: outTime, worked_minutes: worked, shift_minutes: shiftMinutes,
          late_minutes: late, early_minutes: 0, overtime_minutes: overtime, source: 'GEO',
          in_lat: project ? numVal_(project.latitude) + 0.0002 : '', in_lng: project ? numVal_(project.longitude) + 0.0002 : '',
          in_accuracy_m: 12 + (idx % 9), in_distance_m: 15 + (idx % 40),
          out_lat: project ? numVal_(project.latitude) + 0.00025 : '', out_lng: project ? numVal_(project.longitude) + 0.00025 : '',
          out_accuracy_m: 14, out_distance_m: 18,
          flagged: (d % 17 === 0 && idx % 5 === 0) ? 'TRUE' : 'FALSE',
          flag_reason: (d % 17 === 0 && idx % 5 === 0) ? 'GPS accuracy was weaker than the site limit on this punch' : '',
          remark: status === 'LEAVE' ? 'Approved leave' : (status === 'ABSENT' ? 'Not reported to the site' : '')
        });
      });
    }
    var insertedAttendance = attendanceRows.length ? Db.insertMany(c, 'Attendance', attendanceRows, { actor: actx.userId }) : [];
    summary.attendance_rows = insertedAttendance.length;

    /* ------------------------------------------------------------- leave - */
    var leaveTypes = Db.all(c, 'LeaveTypes');
    var leaveRows = [];
    var balanceRows = [];
    var fy = fyOf_(todayIso_());
    createdEmployees.forEach(function (e, idx) {
      leaveTypes.forEach(function (t) {
        if (Db.findOne(c, 'LeaveBalances', function (b) {
          return txt_(b.employee_id) === e.employee_id && txt_(b.leave_type_id) === t.leave_type_id && txt_(b.fy) === fy;
        })) return;
        var opening = numVal_(t.code === 'EL' ? 6 : t.code === 'SL' ? 3 : 0);
        var accrued = round2_(numVal_(t.accrual_per_month) * Leave.monthsElapsed_(fy, e));
        var used = (idx + leaveTypes.indexOf(t)) % 4 === 0 ? Math.min(2, accrued) : 0;
        balanceRows.push({
          employee_id: e.employee_id, employee_name: txt_(e.name), leave_type_id: t.leave_type_id,
          leave_type_code: txt_(t.code), fy: fy, opening: opening, accrued: accrued, used: used, lapsed: 0,
          closing: round2_(opening + accrued - used), note: 'Seeded by the demo data tool'
        });
      });
    });
    if (balanceRows.length) Db.insertMany(c, 'LeaveBalances', balanceRows, { actor: actx.userId });

    var pendingLeaveOwner = createdEmployees[3] || createdEmployees[0];
    var approvedLeaveOwner = createdEmployees[4] || createdEmployees[0];
    var casualType = leaveTypes.filter(function (t) { return txt_(t.code) === 'SL'; })[0] || leaveTypes[0];
    var earnType = leaveTypes.filter(function (t) { return txt_(t.code) === 'EL'; })[0] || leaveTypes[0];
    if (casualType && approvedLeaveOwner) {
      leaveRows.push({
        employee_id: approvedLeaveOwner.employee_id, employee_code: txt_(approvedLeaveOwner.code),
        employee_name: txt_(approvedLeaveOwner.name), leave_type_id: txt_(earnType.leave_type_id),
        leave_type_name: txt_(earnType.name), from_date: isoAddDays_(todayIso_(), -9), to_date: isoAddDays_(todayIso_(), -8),
        days: 2, is_half_day: 'FALSE', reason: 'Family function at native place', contact_during_leave: normPhone_(approvedLeaveOwner.phone),
        status: 'APPROVED', applied_at: nowIso_(), decided_by: actx.userId, decided_by_name: txt_(actx.name),
        decided_at: nowIso_(), decision_remark: 'Approved — handover given to supervisor.', fy: fy
      });
    }
    if (casualType && pendingLeaveOwner) {
      leaveRows.push({
        employee_id: pendingLeaveOwner.employee_id, employee_code: txt_(pendingLeaveOwner.code),
        employee_name: txt_(pendingLeaveOwner.name), leave_type_id: txt_(casualType.leave_type_id),
        leave_type_name: txt_(casualType.name), from_date: isoAddDays_(todayIso_(), 3), to_date: isoAddDays_(todayIso_(), 4),
        days: 2, is_half_day: 'FALSE', reason: 'Fever — will share the clinic note', contact_during_leave: normPhone_(pendingLeaveOwner.phone),
        status: 'PENDING', applied_at: nowIso_(), fy: fy
      });
    }
    if (leaveRows.length) {
      Db.insertMany(c, 'LeaveRequests', leaveRows, { actor: actx.userId });
      summary.leave_requests = leaveRows.length;
    }

    /* ------------------------------------------------------- regularize -- */
    var regEmployee = createdEmployees[5] || createdEmployees[0];
    if (regEmployee && !Db.count(c, 'AttendanceRegularization')) {
      Db.insertMany(c, 'AttendanceRegularization', [{
        employee_id: regEmployee.employee_id, employee_name: txt_(regEmployee.name),
        date: isoAddDays_(todayIso_(), -4), requested_status: 'PRESENT', requested_in: '08:45', requested_out: '17:45',
        reason: 'Phone battery died at the site gate so the punch did not register.',
        status: 'PENDING'
      }], { actor: actx.userId });
    }

    /* ------------------------------------------------------------ expense - */
    var categories = Db.all(c, 'ExpenseCategories');
    var travel = categories.filter(function (x) { return txt_(x.code) === 'TRAVEL'; })[0] || categories[0];
    var food = categories.filter(function (x) { return txt_(x.code) === 'FOOD'; })[0] || categories[1] || categories[0];
    var claimRows = [];
    if (travel) {
      [[0, 'SUBMITTED', 1250], [2, 'APPROVED', 860], [6, 'SUBMITTED', 2400], [1, 'PAID', 500], [4, 'REJECTED', 1500]].forEach(function (spec, i) {
        var emp = createdEmployees[spec[0]];
        if (!emp) return;
        var status = spec[1];
        var amount = spec[2];
        claimRows.push({
          employee_id: emp.employee_id, employee_name: txt_(emp.name),
          category_id: travel.category_id, category_name: txt_(travel.name), claim_date: isoAddDays_(todayIso_(), -(i * 3 + 2)),
          from_date: isoAddDays_(todayIso_(), -(i * 3 + 3)), to_date: isoAddDays_(todayIso_(), -(i * 3 + 2)),
          amount: amount, tax_amount: round0_(amount * 0.05), total_amount: amount, advance_amount: 0,
          net_amount: status === 'APPROVED' || status === 'PAID' ? amount : amount,
          description: 'Site visit travel — auto, local train and toll receipts attached.',
          items_json: jsonStr_([{ head: 'Auto', amount: round0_(amount * 0.4) }, { head: 'Local train', amount: round0_(amount * 0.35) }, { head: 'Toll', amount: round0_(amount * 0.25) }]),
          bill_count: 2,
          status: status, submitted_at: nowIso_(),
          decided_by: status === 'SUBMITTED' ? '' : actx.userId,
          decided_by_name: status === 'SUBMITTED' ? '' : txt_(actx.name),
          decided_at: status === 'SUBMITTED' ? '' : nowIso_(),
          decision_remark: status === 'SUBMITTED' ? '' : (status === 'REJECTED' ? 'Bill copies are not readable — please re-upload.' : 'Approved as per policy.'),
          paid_at: status === 'PAID' ? nowIso_() : ''
        });
      });
    }
    if (food && createdEmployees[3]) {
      var foodEmp = createdEmployees[3];
      claimRows.push({
        employee_id: foodEmp.employee_id, employee_name: txt_(foodEmp.name),
        category_id: food.category_id, category_name: txt_(food.name), claim_date: isoAddDays_(todayIso_(), -1),
        amount: 480, tax_amount: 0, total_amount: 480, advance_amount: 0, net_amount: 480,
        description: 'Team refreshments during the night pour.', items_json: jsonStr_([{ head: 'Snacks & tea', amount: 480 }]),
        bill_count: 1, status: 'SUBMITTED', submitted_at: nowIso_()
      });
    }
    if (claimRows.length) {
      Db.insertMany(c, 'ExpenseClaims', claimRows, { actor: actx.userId });
      summary.expense_claims = claimRows.length;
    }

    /* ------------------------------------------------------------ payroll - */
    var monthCursor = monthOfIso_(todayIso_());
    for (var m = wantMonths; m >= 1; m--) {
      var targetMonth = Demo.shiftMonth_(monthCursor, -m);
      var existingRun = Db.findOne(c, 'PayrollRuns', function (r) {
        return txt_(r.month) === targetMonth && txt_(r.status) !== 'CANCELLED';
      });
      if (existingRun) {
        summary.payroll_runs.push({ month: targetMonth, status: txt_(existingRun.status), skipped: true });
        continue;
      }
      try {
        var created = Payroll.runCreate(actx, { fy: fyOf_(monthStart_(targetMonth)), month: targetMonth, days_basis: 'CALENDAR', notes: 'Demo payroll run' });
        var runId = txt_(created.run_id);
        if (!runId) fail_('SEED_FAILED', 'The demo payroll run for ' + targetMonth + ' could not be created.');
        Payroll.calculateStart(actx, { run_id: runId });
        var guard = 0;
        while (guard < 20) {
          guard++;
          var progress = Payroll.calculateProgress(actx, { run_id: runId });
          if (progress.done) break;
          Payroll.calculateResume(actx, { run_id: runId });
        }
        Payroll.runApprove(actx, { run_id: runId, remark: 'Checked against the site register and approved.' });
        Payroll.markPaid(actx, {
          run_id: runId, payment_reference: 'NEFT-DEMO-' + targetMonth.replace('-', ''),
          payment_mode: 'NEFT', remark: 'Salary credit as per bank advice.', generate_payslips: true
        });
        var after = Db.get(c, 'PayrollRuns', 'run_id', runId);
        summary.payroll_runs.push({
          month: targetMonth, status: txt_(after.status), employees: intVal_(after.total_employees),
          net: numVal_(after.total_net), payslips: intVal_(after.payslips_generated)
        });
        summary.payslips += intVal_(after.payslips_generated);
      } catch (e) {
        summary.warnings.push('Payroll for ' + targetMonth + ' could not be seeded: ' + e.message);
        logEvent_('WARN', 'Demo.seed', 'Payroll seed failed for ' + targetMonth, { error: e.message });
      }
    }

    /* ------------------------------------------------------------ tickets - */
    if (!Db.count(c, 'Tickets')) {
      var ticket1 = Db.insertMany(c, 'Tickets', [
        { raised_by_user_id: txt_(adminUser.user_id), raised_by_name: txt_(adminUser.name),
          employee_id: createdEmployees[3] ? createdEmployees[3].employee_id : '',
          subject: 'Punch not registering at the Bhiwandi gate', category: 'ATTENDANCE', priority: 'HIGH',
          status: 'IN_PROGRESS', last_reply_at: nowIso_() },
        { raised_by_user_id: txt_(adminUser.user_id), raised_by_name: txt_(adminUser.name), employee_id: '',
          subject: 'Need PF ECR file format for August', category: 'PAYROLL', priority: 'NORMAL',
          status: 'OPEN', last_reply_at: nowIso_() }
      ], { actor: actx.userId });
      if (ticket1.length) {
        Db.insertMany(c, 'TicketComments', [
          { ticket_id: ticket1[0].ticket_id, author_user_id: txt_(adminUser.user_id), author_name: txt_(adminUser.name),
            body: 'Three workers could not punch in on Monday at the north gate. GPS shows the right site. Please check the radius.', is_internal: 'FALSE' },
          { ticket_id: ticket1[0].ticket_id, author_user_id: txt_(adminUser.user_id), author_name: txt_(adminUser.name),
            body: 'Internal note: increase the radius to 200 m for that site while we verify the gate coordinates.', is_internal: 'TRUE' },
          { ticket_id: ticket1[1].ticket_id, author_user_id: txt_(adminUser.user_id), author_name: txt_(adminUser.name),
            body: 'Please share the ECR text file template we should upload on the EPFO portal.', is_internal: 'FALSE' }
        ], { actor: actx.userId });
        summary.tickets = ticket1.length;
      }
    }

    /* ------------------------------------------------------------ letters - */
    if (createdEmployees[2] && !Db.count(c, 'GeneratedLetters')) {
      try {
        var letter = Documents.letterGenerate(actx, {
          template_id: 'SALARY', employee_id: createdEmployees[2].employee_id, issue_date: todayIso_(),
          extra: { purpose: 'bank account opening', signer_name: txt_(adminUser.name) }, save_file: true
        });
        summary.letters = letter && letter.letter ? 1 : 0;
      } catch (e) {
        summary.warnings.push('Demo salary certificate could not be generated: ' + e.message);
      }
    }

    /* ------------------------------------------------------------- finish - */
    summary.duration_ms = new Date().getTime() - startedAt;
    summary.login_url_hint = txt_(Config.systemGet('app_url', ''));
    summary.message = 'Demo company "' + summary.company_name + '" is ready. Sign in with ' + summary.admin_email +
      ' and the password ' + Demo.DEMO.admin_password + '.';
    summary.warnings.push('Rotate the demo password (or delete the demo company) before you go live with real data.');

    Audit.write({
      scope: 'SUPER', companyId: companyId, userId: ctx.userId, name: ctx.name, ip: ctx.ip, userAgent: ctx.userAgent,
      companyCtx: c
    }, {
      module: 'super', action: 'super.demo.seed', entity: 'Companies', entity_id: companyId,
      after: {
        employees: summary.employees, projects: summary.projects, attendance: summary.attendance_rows,
        claims: summary.expense_claims, payroll_runs: summary.payroll_runs.length, payslips: summary.payslips
      },
      note: 'Demo data loaded for ' + summary.company_name, severity: 'SENSITIVE'
    });

    return summary;
  },

  loginEmail_: function (person, idx) {
    var first = txt_(person.name).split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
    return first + '.demo' + (idx + 1) + '@sunrise-demo.test';
  },

  shiftMonth_: function (month, delta) {
    var y = intVal_(txt_(month).slice(0, 4));
    var m = intVal_(txt_(month).slice(5, 7)) + delta;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + (m < 10 ? '0' + m : '' + m);
  },

  /* ========================================================== reset ==== */
  reset: function (ctx, payload) {
    ctx = Demo.systemCtx_(ctx);
    Perm.require(ctx, 'super.manage');
    if (txt_(payload.confirm).toUpperCase() !== 'DELETE') {
      fail_('VALIDATION', 'Type DELETE in the confirmation box to wipe a workspace.', { field: 'confirm' });
    }
    var companyId = txt_(payload.company_id);
    if (!companyId) {
      var demo = Db.findOne(masterCtx_(), 'Companies', function (c) { return txt_(c.name) === Demo.DEMO.company_name; });
      if (!demo) fail_('NOT_FOUND', 'No demo workspace was found. Pass a company id to reset a specific workspace.');
      companyId = txt_(demo.company_id);
    }
    var company = companyRow_(companyId);
    var c = companyCtx_(companyId, { requireActive: false });
    var companyTables = Object.keys(SCHEMA).filter(function (t) { return SCHEMA[t].scope === 'COMPANY'; });
    var wiped = [];
    var totalRows = 0;

    companyTables.forEach(function (t) {
      var sheet = c.ss.getSheetByName(t);
      if (!sheet) return;
      var rows = Math.max(0, sheet.getLastRow() - 1);
      if (!rows) return;
      var header = headers_(t);
      var lastCol = sheet.getLastColumn() || header.length;
      var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      try {
        sheet.clear();
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      } catch (e) {
        // fall back to clearing just the data range when the sheet has a protected row
        sheet.getRange(2, 1, rows, header.length).clearContent();
      }
      void existing;
      wiped.push({ table: t, rows: rows });
      totalRows += rows;
    });

    // counters for this company start again from 1
    Db.all(masterCtx_(), 'Counters').forEach(function (row) {
      if (txt_(row.key).indexOf(':' + companyId) === txt_(row.key).length - companyId.length - 1) {
        Db.update(masterCtx_(), 'Counters', 'key', row.key, { next_no: 1 }, { system: true });
      }
    });

    // bring back the defaults a fresh workspace has
    var reprovisioned = Company.provision_(company, {}, { source: 'DEMO_RESET' });
    // keep the demo login working after a reset (the whole point of a demo tenant)
    var adminAfter = Db.findOne(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === companyId && txt_(u.role_code) === 'COMPANY_ADMIN';
    });
    if (adminAfter) {
      var demoSalt = randomSalt_();
      Db.update(masterCtx_(), 'Users', 'user_id', adminAfter.user_id, {
        password_salt: demoSalt, password_hash: hashPassword_(Demo.DEMO.admin_password, demoSalt),
        password_set_at: nowIso_(), must_change_password: 'FALSE', status: 'ACTIVE',
        failed_attempts: 0, locked_until: ''
      }, { system: true });
    }
    Db.update(masterCtx_(), 'Companies', 'company_id', companyId, {
      verification_remark: 'Workspace wiped with the demo reset tool', notes: 'DEMO'
    }, { system: true });
    memoClear_();

    var users = Db.all(masterCtx_(), 'Users', function (u) { return txt_(u.company_id) === companyId; });
    users.forEach(function (u) {
      if (txt_(u.role_code) === 'COMPANY_ADMIN') return;
      Db.update(masterCtx_(), 'Users', 'user_id', u.user_id, { status: 'INACTIVE', employee_id: '' }, { system: true });
    });
    Db.all(masterCtx_(), 'Sessions', function (s) { return txt_(s.company_id) === companyId && !txt_(s.ended_at); })
      .forEach(function (s) {
        Db.update(masterCtx_(), 'Sessions', 'session_id', s.session_id,
          { ended_at: nowIso_(), ended_reason: 'WORKSPACE_RESET' }, { system: true });
      });

    Audit.write({
      scope: 'SUPER', companyId: companyId, userId: ctx.userId, name: ctx.name, ip: ctx.ip, userAgent: ctx.userAgent, companyCtx: c
    }, {
      module: 'super', action: 'super.demo.reset', entity: 'Companies', entity_id: companyId,
      before: { tables: wiped.length, rows: totalRows },
      after: { settings_restored: reprovisioned.settings_seeded, roles_restored: reprovisioned.roles_seeded, logins_disabled: users.length - 1 },
      note: 'Workspace of ' + txt_(company.name) + ' wiped clean (' + totalRows + ' rows removed)', severity: 'SENSITIVE'
    });

    return {
      company_id: companyId, company_name: txt_(company.name),
      admin_email: Demo.DEMO.admin_email, admin_password: Demo.DEMO.admin_password,
      tables_cleared: wiped.length, rows_removed: totalRows, tables: wiped,
      logins_disabled: users.length - 1,
      message: txt_(company.name) + ' was cleared: ' + totalRows + ' row(s) removed from ' + wiped.length +
        ' tabs. Settings, roles, leave types, expense categories and holidays are back to their defaults, ready for real data.'
    };
  }
};
