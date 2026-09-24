/**
 * ============================================================================
 *  FocusHR  —  Employees.gs
 *  Employee master data, logins, KYC documents, salary structures, CSV import,
 *  exits, the employee self-service profile and the shared employee picker.
 * ============================================================================
 */

var EmployeeMask = {
  /** Who may see unmasked bank / PAN / Aadhaar details. */
  canReveal: function (ctx) {
    if (ctx.scope === 'SUPER') return false; // even the platform owner sees masked values
    return Perm.has(ctx, 'employees.edit') || Perm.has(ctx, 'payroll.edit') || Perm.has(ctx, 'payroll.approve');
  },
  isSelf_: function (ctx, employee) {
    return !!ctx.employeeId && txt_(ctx.employeeId) === txt_(employee.employee_id);
  },
  row: function (ctx, e) {
    var reveal = EmployeeMask.canReveal(ctx) || EmployeeMask.isSelf_(ctx, e);
    var panFull = txt_(e.pan).toUpperCase();
    return Object.assign({}, e, {
      pan: panFull ? (reveal ? panFull : maskPan_(panFull)) : '',
      bank_account: txt_(e.bank_account) ? (reveal ? txt_(e.bank_account) : maskAccount_(e.bank_account)) : '',
      aadhaar_last4: txt_(e.aadhaar_last4) ? aadhaarLast4_(e.aadhaar_last4) : '',
      masked: !reveal,
      can_reveal: reveal
    });
  }
};

var Employees = {

  /* =============================================================== list == */
  list: function (ctx, payload) {
    Perm.require(ctx, 'employees.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var filter = function (e) {
      if (allowed && allowed.indexOf(txt_(e.employee_id)) < 0) return false;
      if (payload.status && txt_(e.status).toUpperCase() !== txt_(payload.status).toUpperCase()) return false;
      if (payload.department && txt_(e.department) !== txt_(payload.department)) return false;
      if (payload.project_id && txt_(e.project_id) !== txt_(payload.project_id)) return false;
      if (payload.branch_id && txt_(e.branch_id) !== txt_(payload.branch_id)) return false;
      if (payload.employment_type && txt_(e.employment_type) !== txt_(payload.employment_type)) return false;
      return true;
    };
    var rows = Db.all(c, 'Employees', filter);
    if (payload.search) rows = rows.filter(function (e) { return matchesSearch_(e, SCHEMA.Employees.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'code', payload.dir || 'ASC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    var projectNames = {}, branchNames = {};
    Db.all(c, 'Projects').forEach(function (p) { projectNames[txt_(p.project_id)] = txt_(p.name); });
    Db.all(c, 'Branches').forEach(function (b) { branchNames[txt_(b.branch_id)] = txt_(b.name); });

    return {
      rows: page.rows.map(function (e) {
        return {
          employee_id: e.employee_id, code: e.code, name: e.name, status: e.status, department: e.department,
          designation: e.designation, phone: txt_(e.phone) ? maskPhone_(e.phone) : '', email: e.email,
          project_id: e.project_id, project_name: projectNames[txt_(e.project_id)] || '',
          branch_id: e.branch_id, branch_name: branchNames[txt_(e.branch_id)] || '',
          joining_date: e.joining_date, employment_type: e.employment_type, work_state: e.work_state,
          ctc_monthly: numVal_(e.ctc_monthly), has_login: !!txt_(e.user_id), photo_file_id: e.photo_file_id,
          pf_applicable: boolVal_(e.pf_applicable), esic_applicable: boolVal_(e.esic_applicable),
          gender: e.gender, city: e.city, exit_date: e.exit_date
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      facet_counts: (function () {
        var all = Db.all(c, 'Employees', filter === null ? null : function (e) { return allowed ? allowed.indexOf(txt_(e.employee_id)) >= 0 : true; });
        var byStatus = {}, byDept = {};
        all.forEach(function (e) {
          byStatus[txt_(e.status)] = (byStatus[txt_(e.status)] || 0) + 1;
          var d = txt_(e.department) || 'Unassigned';
          byDept[d] = (byDept[d] || 0) + 1;
        });
        return { status: byStatus, department: byDept, total_visible: all.length };
      })(),
      departments: uniq_(Db.all(c, 'Employees').map(function (e) { return txt_(e.department); }).filter(function (d) { return !!d; })).sort()
    };
  },

  /* ================================================================ get == */
  get: function (ctx, payload) {
    Perm.require(ctx, 'employees.view');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var masked = EmployeeMask.row(ctx, e);

    var manager = txt_(e.manager_id) ? Db.find(c, 'Employees', 'employee_id', e.manager_id) : null;
    var project = txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null;
    var branch = txt_(e.branch_id) ? Db.find(c, 'Branches', 'branch_id', e.branch_id) : null;
    var structure = Employees.currentStructure_(ctx, e.employee_id);
    var documents = Db.all(c, 'EmployeeDocuments', function (d) { return txt_(d.employee_id) === e.employee_id; });

    Audit.sensitive(ctx, 'employees', 'employees.get', 'Employees', e.employee_id, 'Viewed employee profile of ' + txt_(e.name));

    var attendance30 = Db.all(c, 'Attendance', function (a) {
      return txt_(a.employee_id) === e.employee_id && txt_(a.date) >= isoAddDays_(todayIso_(), -30);
    });
    var leaves = Db.all(c, 'LeaveRequests', function (l) {
      return txt_(l.employee_id) === e.employee_id && txt_(l.status) === 'APPROVED' && txt_(l.fy) === fyOf_(todayIso_());
    });

    return {
      employee: masked,
      manager_name: manager ? txt_(manager.name) : '',
      project_name: project ? txt_(project.name) : '',
      branch_name: branch ? txt_(branch.name) : '',
      salary_structure: structure ? Employees.structureOut_(ctx, structure) : null,
      documents: documents.map(function (d) {
        return {
          doc_id: d.doc_id, doc_type: d.doc_type, doc_name: d.doc_name, file_id: d.file_id, file_name: d.file_name,
          mime_type: d.mime_type, size_bytes: intVal_(d.size_bytes), issued_date: d.issued_date, expiry_date: d.expiry_date,
          verified: boolVal_(d.verified), verified_at: d.verified_at, note: d.note, uploaded_at: d.created_at,
          expired: !!d.expiry_date && txt_(d.expiry_date) < todayIso_()
        };
      }),
      stats: {
        attendance_last_30_days: {
          present: attendance30.filter(function (a) { return txt_(a.status) === 'PRESENT' || txt_(a.status) === 'OD'; }).length,
          absent: attendance30.filter(function (a) { return txt_(a.status) === 'ABSENT'; }).length,
          half_day: attendance30.filter(function (a) { return txt_(a.status) === 'HALF_DAY'; }).length,
          leave: attendance30.filter(function (a) { return txt_(a.status) === 'LEAVE'; }).length,
          late: attendance30.filter(function (a) { return intVal_(a.late_minutes, 0) > 0; }).length
        },
        leave_days_this_fy: numVal_(sum_(leaves, function (l) { return l.days; })),
        pending_regularizations: Db.count(c, 'AttendanceRegularization', function (r) {
          return txt_(r.employee_id) === e.employee_id && txt_(r.status) === 'PENDING';
        }),
        open_claims: Db.count(c, 'ExpenseClaims', function (cl) {
          return txt_(cl.employee_id) === e.employee_id && txt_(cl.status) === 'SUBMITTED';
        }),
        last_payslip: (function () {
          var ps = Db.all(c, 'Payslips', function (p) { return txt_(p.employee_id) === e.employee_id; });
          ps = sortRows_(ps, 'month', 'DESC');
          return ps.length ? { payslip_id: ps[0].payslip_id, month: ps[0].month, net_pay: numVal_(ps[0].net_pay), code: ps[0].code } : null;
        })()
      },
      assignments: Db.all(c, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === e.employee_id && txt_(a.status) === 'ACTIVE';
      }).map(function (a) {
        var p = Db.find(c, 'Projects', 'project_id', a.project_id);
        return {
          assignment_id: a.assignment_id, project_id: a.project_id, project_name: p ? txt_(p.name) : '',
          role_on_site: a.role_on_site, from_date: a.from_date, to_date: a.to_date, is_primary: boolVal_(a.is_primary)
        };
      }),
      timeline: EmployeeTimeline.build(c, e, 12)
    };
  },

  /* ============================================================== save === */
  save: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var isNew = !payload.employee_id;
    Perm.require(ctx, isNew ? 'employees.create' : 'employees.edit');

    var phone = normPhone_(payload.phone);
    if (!isPhoneIn_(phone)) fail_('VALIDATION', 'A valid 10-digit mobile number is required (it is the employee login id).', { field: 'phone' });
    var joinDate = toIsoDate_(payload.joining_date) || todayIso_();
    if (joinDate > isoAddDays_(todayIso_(), 365)) fail_('VALIDATION', 'Joining date cannot be more than a year in the future.', { field: 'joining_date' });
    var dob = toIsoDate_(payload.dob);
    if (dob && dob > todayIso_()) fail_('VALIDATION', 'Date of birth cannot be in the future.', { field: 'dob' });
    if (dob && daysBetweenIso_(dob, joinDate) < 14 * 365) fail_('VALIDATION', 'The employee appears to be under 14 years old. Please check the dates.', { field: 'joining_date' });
    if (payload.pan && !isPan_(payload.pan)) fail_('VALIDATION', 'PAN should look like ABCDE1234F.', { field: 'pan' });
    if (payload.bank_ifsc && !isIfsc_(payload.bank_ifsc)) fail_('VALIDATION', 'IFSC code should look like HDFC0001234.', { field: 'bank_ifsc' });
    if (payload.aadhaar_last4 && !/^\d{4}$/.test(aadhaarLast4_(payload.aadhaar_last4))) fail_('VALIDATION', 'Enter only the last 4 digits of Aadhaar.', { field: 'aadhaar_last4' });

    var dupePhone = Db.findOne(c, 'Employees', function (e) {
      return normPhone_(e.phone) === phone && txt_(e.employee_id) !== txt_(payload.employee_id) && txt_(e.status).toUpperCase() !== 'EXITED';
    });
    if (dupePhone) fail_('DUPLICATE', 'This mobile number is already used by ' + txt_(dupePhone.name) + ' (' + txt_(dupePhone.code) + '). Every employee needs a unique number because it is their login id.', { field: 'phone' });
    if (payload.email) {
      var dupeEmail = Db.findOne(c, 'Employees', function (e) {
        return txt_(e.email).toLowerCase() === normEmail_(payload.email) && txt_(e.employee_id) !== txt_(payload.employee_id);
      });
      if (dupeEmail) fail_('DUPLICATE', 'This email is already used by ' + txt_(dupeEmail.name) + '.', { field: 'email' });
    }

    var managerId = txt_(payload.manager_id);
    if (managerId === txt_(payload.employee_id) && managerId) fail_('VALIDATION', 'An employee cannot be their own reporting manager.', { field: 'manager_id' });

    var patch = {
      name: txt_(payload.name).trim(), gender: txt_(payload.gender), dob: dob, joining_date: joinDate,
      status: txt_(payload.status || (isNew ? 'ACTIVE' : 'ACTIVE')).toUpperCase(),
      department: payload.department, designation: payload.designation, branch_id: payload.branch_id,
      project_id: payload.project_id, manager_id: managerId, employment_type: txt_(payload.employment_type || 'FULL_TIME').toUpperCase(),
      work_state: payload.work_state, phone: phone, alt_phone: payload.alt_phone ? normPhone_(payload.alt_phone) : '', email: normEmail_(payload.email),
      address: payload.address, city: payload.city, state: payload.state, pincode: payload.pincode,
      emergency_name: payload.emergency_name, emergency_phone: payload.emergency_phone ? normPhone_(payload.emergency_phone) : '',
      blood_group: payload.blood_group, pan: txt_(payload.pan).toUpperCase(), aadhaar_last4: payload.aadhaar_last4 ? aadhaarLast4_(payload.aadhaar_last4) : '',
      aadhaar_file_id: payload.aadhaar_file_id,
      bank_name: payload.bank_name, bank_account: payload.bank_account, bank_ifsc: txt_(payload.bank_ifsc).toUpperCase(),
      bank_holder: payload.bank_holder || txt_(payload.name),
      pf_applicable: payload.pf_applicable === false ? 'FALSE' : 'TRUE',
      pf_uan: payload.pf_uan, pf_ceiling_opt: txt_(payload.pf_ceiling_opt || 'CEILING').toUpperCase(),
      esic_applicable: payload.esic_applicable === false ? 'FALSE' : 'TRUE', esic_ip_no: payload.esic_ip_no,
      pt_applicable: payload.pt_applicable === false ? 'FALSE' : 'TRUE',
      tds_applicable: payload.tds_applicable ? 'TRUE' : 'FALSE',
      ctc_monthly: numVal_(payload.ctc_monthly), photo_file_id: payload.photo_file_id, remarks: payload.remarks
    };
    if (isNew && !patch.work_state) patch.work_state = txt_(ctx.company.state);
    var before = null;
    var employee;
    if (isNew) {
      patch.code = Employees.nextCode_(ctx, payload, c);
      employee = Db.insert(c, 'Employees', patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'employees', action: 'employees.save', entity: 'Employees', entity_id: employee.employee_id,
        after: redact_(patch), note: 'Employee created: ' + patch.name + ' (' + patch.code + ')'
      });
    } else {
      var current = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
      Perm.assertEmployee(ctx, payload.employee_id);
      if (txt_(current.status).toUpperCase() === 'EXITED' && patch.status !== 'EXITED') {
        fail_('NOT_ALLOWED', 'This employee has already exited. Use "Rejoin" in the employee record to start a new tenure.');
      }
      before = current;
      employee = Db.update(c, 'Employees', 'employee_id', payload.employee_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'employees', action: 'employees.save', entity: 'Employees', entity_id: employee.employee_id,
        before: redact_(before), after: redact_(patch), note: 'Employee updated: ' + patch.name
      });
    }

    // login account for the employee (phone is the login id)
    var login = Employees.ensureLogin_(ctx, employee, isNew);
    if (login.user_id && txt_(login.user_id) !== txt_(employee.user_id)) {
      employee = Db.update(c, 'Employees', 'employee_id', employee.employee_id, { user_id: login.user_id }, { actor: ctx.userId });
    }

    // default salary structure from the CTC entered on the form
    var structureInfo = null;
    if (numVal_(patch.ctc_monthly) > 0) {
      structureInfo = Employees.ensureStructureFromCtc_(ctx, employee, numVal_(patch.ctc_monthly));
    }

    var out = Employees.get(ctx, { employee_id: employee.employee_id });
    out.login = login;
    out.structure = structureInfo;
    return out;
  },

  nextCode_: function (ctx, payload, c) {
    if (txt_(payload.code)) {
      var code = txt_(payload.code).toUpperCase();
      var dupe = Db.findOne(c, 'Employees', function (e) { return txt_(e.code).toUpperCase() === code; });
      if (dupe) fail_('DUPLICATE', 'Employee code ' + code + ' is already used by ' + txt_(dupe.name) + '.', { field: 'code' });
      return code;
    }
    return Db.nextId(c, 'Employees');
  },

  /** Create or refresh the employee's login row (Users table). */
  ensureLogin_: function (ctx, employee, isNew) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var phone = normPhone_(employee.phone);
    var email = normEmail_(employee.email);
    var user = txt_(employee.user_id) ? Db.find(masterCtx_(), 'Users', 'user_id', employee.user_id) : null;
    if (user) {
      if (normPhone_(user.phone) !== phone || txt_(user.name) !== txt_(employee.name)) {
        Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, { phone: phone, name: txt_(employee.name), email: email || user.email }, { actor: ctx.userId });
      }
      return { user_id: user.user_id, created: false, has_password: !!txt_(user.password_hash), activation_required: !txt_(user.password_hash) };
    }
    var existing = Db.findOne(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && normPhone_(u.phone) === phone && txt_(u.employee_id);
    });
    if (existing) {
      Db.update(masterCtx_(), 'Users', 'user_id', existing.user_id, { employee_id: employee.employee_id, name: txt_(employee.name), email: email || existing.email }, { actor: ctx.userId });
      return { user_id: existing.user_id, created: false, has_password: !!txt_(existing.password_hash), activation_required: !txt_(existing.password_hash) };
    }
    var created = Db.insert(masterCtx_(), 'Users', {
      scope: 'COMPANY', company_id: ctx.companyId, employee_id: employee.employee_id, name: txt_(employee.name),
      email: email, phone: phone, password_salt: '', password_hash: '', must_change_password: 'FALSE',
      status: 'ACTIVE', role_code: 'EMPLOYEE', meta_json: jsonStr_({ source: 'EMPLOYEE_RECORD', created_by: ctx.userId })
    }, { actor: ctx.userId });
    Audit.info(ctx, 'employees', 'employees.login.created', 'Users', created.user_id, 'Employee login created for ' + txt_(employee.name) + ' (phone based OTP activation)');
    return { user_id: created.user_id, created: true, has_password: false, activation_required: true };
  },

  /* ============================================================ structure = */
  currentStructure_: function (ctx, employeeId) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var list = Db.all(c, 'SalaryStructures', function (s) {
      return txt_(s.employee_id) === employeeId && boolVal_(s.is_active) !== false;
    });
    list = sortRows_(list, 'effective_from', 'DESC');
    return list.length ? list[0] : null;
  },

  structureOut_: function (ctx, s) {
    var gross = numVal_(s.basic) + numVal_(s.hra) + numVal_(s.da) + numVal_(s.conveyance) + numVal_(s.special_allowance) + numVal_(s.other_allowance);
    return {
      structure_id: s.structure_id, employee_id: s.employee_id, effective_from: s.effective_from,
      basic: numVal_(s.basic), hra: numVal_(s.hra), da: numVal_(s.da), conveyance: numVal_(s.conveyance),
      special_allowance: numVal_(s.special_allowance), other_allowance: numVal_(s.other_allowance),
      overtime_rate: numVal_(s.overtime_rate), gross_monthly: round0_(gross), ctc_annual: round0_(gross * 12),
      pf_employee_pct: numVal_(s.pf_employee_pct), pf_employer_pct: numVal_(s.pf_employer_pct),
      esic_employee_pct: numVal_(s.esic_employee_pct), esic_employer_pct: numVal_(s.esic_employer_pct),
      pt_state: s.pt_state, tds_regime: s.tds_regime, is_active: boolVal_(s.is_active) !== false, note: s.note,
      created_at: s.created_at, updated_at: s.updated_at
    };
  },

  /** Quick split used when someone types a monthly CTC on the employee form. */
  ensureStructureFromCtc_: function (ctx, employee, ctc) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var existing = Employees.currentStructure_(ctx, employee.employee_id);
    if (existing && Math.abs(numVal_(existing.basic) * 2 - ctc) < 500) {
      return { structure_id: existing.structure_id, created: false, note: 'Existing structure already matches this CTC.' };
    }
    var basic = round0_(ctc * 0.5);
    var hra = round0_(basic * 0.4);
    var conveyance = 1600;
    var special = round0_(ctc - basic - hra - conveyance);
    if (special < 0) { conveyance = 0; special = round0_(ctc - basic - hra); }
    var patch = {
      employee_id: employee.employee_id, effective_from: txt_(employee.joining_date) || todayIso_(),
      basic: basic, hra: hra, da: 0, conveyance: conveyance, special_allowance: special, other_allowance: 0,
      overtime_rate: round0_(basic / 26 / 8 * 2), pf_employee_pct: 12, pf_employer_pct: 12,
      esic_employee_pct: 0.75, esic_employer_pct: 3.25,
      pt_state: txt_(getSetting_(ctx, 'payroll.pt_state', 'Maharashtra')), tds_regime: txt_(getSetting_(ctx, 'payroll.tds_regime', 'NEW')),
      is_active: 'TRUE', note: 'Auto-created from the monthly CTC entered on the employee form. Please review the split.'
    };
    var row = Db.insert(c, 'SalaryStructures', patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.salary.save', entity: 'SalaryStructures', entity_id: row.structure_id,
      after: patch, note: 'Auto salary structure from CTC ' + ctc + ' for ' + txt_(employee.name)
    });
    return { structure_id: row.structure_id, created: true, note: 'A salary structure was created from the CTC. Please review it on the salary tab.' };
  },

  salaryGet: function (ctx, payload) {
    Perm.require(ctx, 'employees.view');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var list = Db.all(c, 'SalaryStructures', function (s) { return txt_(s.employee_id) === payload.employee_id; });
    list = sortRows_(list, 'effective_from', 'DESC');
    Audit.sensitive(ctx, 'employees', 'employees.salary.get', 'Employees', payload.employee_id, 'Viewed salary structure of ' + txt_(e.name));
    return {
      employee: { employee_id: e.employee_id, code: e.code, name: e.name, designation: e.designation, ctc_monthly: numVal_(e.ctc_monthly), pf_applicable: boolVal_(e.pf_applicable), esic_applicable: boolVal_(e.esic_applicable), pt_applicable: boolVal_(e.pt_applicable), tds_applicable: boolVal_(e.tds_applicable), pf_ceiling_opt: e.pf_ceiling_opt },
      structures: list.map(function (s) { return Employees.structureOut_(ctx, s); }),
      current: list.length ? Employees.structureOut_(ctx, list[0]) : null
    };
  },

  salarySave: function (ctx, payload) {
    Perm.require(ctx, 'employees.edit');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var gross = numVal_(payload.basic) + numVal_(payload.hra) + numVal_(payload.da) + numVal_(payload.conveyance) +
      numVal_(payload.special_allowance) + numVal_(payload.other_allowance);
    if (numVal_(payload.basic) < 1000) fail_('VALIDATION', 'Basic pay looks too low — please check the amount.', { field: 'basic' });
    if (gross > 20000000) fail_('VALIDATION', 'This monthly gross looks unrealistic (over ₹2 crore). Please check the amounts.');
    var patch = {
      employee_id: payload.employee_id, effective_from: payload.effective_from,
      basic: numVal_(payload.basic), hra: numVal_(payload.hra), da: numVal_(payload.da),
      conveyance: numVal_(payload.conveyance), special_allowance: numVal_(payload.special_allowance),
      other_allowance: numVal_(payload.other_allowance),
      overtime_rate: numVal_(payload.overtime_rate, round0_(numVal_(payload.basic) / 26 / 8 * 2)),
      pf_employee_pct: numVal_(payload.pf_employee_pct, 12), pf_employer_pct: numVal_(payload.pf_employer_pct, 12),
      esic_employee_pct: numVal_(payload.esic_employee_pct, 0.75), esic_employer_pct: numVal_(payload.esic_employer_pct, 3.25),
      pt_state: txt_(payload.pt_state || getSetting_(ctx, 'payroll.pt_state', 'Maharashtra')),
      tds_regime: txt_(payload.tds_regime || getSetting_(ctx, 'payroll.tds_regime', 'NEW')).toUpperCase(),
      is_active: payload.is_active === false ? 'FALSE' : 'TRUE', note: payload.note
    };
    var row;
    if (payload.structure_id) {
      var before = Db.get(c, 'SalaryStructures', 'structure_id', payload.structure_id);
      row = Db.update(c, 'SalaryStructures', 'structure_id', payload.structure_id, patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'employees', action: 'employees.salary.save', entity: 'SalaryStructures', entity_id: row.structure_id,
        before: Employees.structureOut_(ctx, before), after: patch, note: 'Salary structure revised for ' + txt_(employee.name), severity: 'SENSITIVE'
      });
    } else {
      // a new structure supersedes the old one from its effective date
      Db.all(c, 'SalaryStructures', function (s) { return txt_(s.employee_id) === payload.employee_id && boolVal_(s.is_active) !== false; })
        .forEach(function (s) {
          if (txt_(s.effective_from) < txt_(patch.effective_from)) {
            Db.update(c, 'SalaryStructures', 'structure_id', s.structure_id, { is_active: 'FALSE' }, { actor: ctx.userId });
          }
        });
      row = Db.insert(c, 'SalaryStructures', patch, { actor: ctx.userId });
      Audit.write(ctx, {
        module: 'employees', action: 'employees.salary.save', entity: 'SalaryStructures', entity_id: row.structure_id,
        after: patch, note: 'New salary structure for ' + txt_(employee.name) + ' effective ' + patch.effective_from, severity: 'SENSITIVE'
      });
    }
    Db.update(c, 'Employees', 'employee_id', employee.employee_id, { ctc_monthly: gross }, { actor: ctx.userId });
    return { structure_id: row.structure_id, gross_monthly: gross, ctc_annual: gross * 12 };
  },

  salaryDelete: function (ctx, payload) {
    Perm.require(ctx, 'employees.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var before = Db.get(c, 'SalaryStructures', 'structure_id', payload.structure_id);
    Perm.assertEmployee(ctx, before.employee_id);
    Db.softDelete(c, 'SalaryStructures', 'structure_id', payload.structure_id, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.salary.delete', entity: 'SalaryStructures', entity_id: payload.structure_id,
      before: Employees.structureOut_(ctx, before), note: 'Salary structure removed', severity: 'SENSITIVE'
    });
    return { deleted: true };
  },

  /* ================================================================ exit = */
  exit: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'employees.edit');
    Perm.assertEmployee(ctx, payload.employee_id);
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    if (txt_(e.status).toUpperCase() === 'EXITED') fail_('ALREADY_DONE', 'This employee has already exited.');
    if (payload.exit_date < txt_(e.joining_date)) fail_('VALIDATION', 'Exit date cannot be before the joining date.', { field: 'exit_date' });
    Db.update(c, 'Employees', 'employee_id', e.employee_id, {
      status: 'EXITED', exit_date: payload.exit_date, exit_reason: payload.exit_reason,
      fnf_flag: payload.fnf_flag ? 'TRUE' : 'FALSE',
      remarks: payload.remarks ? (txt_(e.remarks) + '\n' + payload.remarks) : txt_(e.remarks),
      project_id: ''
    }, { actor: ctx.userId });
    Db.all(c, 'ProjectAssignments', function (a) { return txt_(a.employee_id) === e.employee_id && txt_(a.status) === 'ACTIVE'; })
      .forEach(function (a) {
        Db.update(c, 'ProjectAssignments', 'assignment_id', a.assignment_id, { status: 'ENDED', to_date: payload.exit_date }, { actor: ctx.userId });
      });
    if (txt_(e.user_id)) {
      Db.update(masterCtx_(), 'Users', 'user_id', e.user_id, { status: 'INACTIVE' }, { actor: ctx.userId });
      Db.all(masterCtx_(), 'Sessions', function (s) { return txt_(s.user_id) === txt_(e.user_id) && !txt_(s.ended_at); })
        .forEach(function (s) { Db.update(masterCtx_(), 'Sessions', 'session_id', s.session_id, { ended_at: nowIso_(), ended_reason: 'EMPLOYEE_EXITED' }, { system: true }); });
    }
    Audit.write(ctx, {
      module: 'employees', action: 'employees.exit', entity: 'Employees', entity_id: e.employee_id,
      before: { status: e.status, project_id: e.project_id },
      after: { status: 'EXITED', exit_date: payload.exit_date, exit_reason: payload.exit_reason, fnf: !!payload.fnf_flag },
      note: 'Employee exit recorded for ' + txt_(e.name), severity: 'SENSITIVE'
    });
    Notify.notifyCompanyAdmins_(ctx.companyId, {
      title: 'Exit recorded: ' + txt_(e.name),
      body: txt_(e.name) + ' (' + txt_(e.code) + ') exited on ' + fmtDateHuman_(payload.exit_date) + '. Reason: ' + payload.exit_reason + '. Full & final: ' + (payload.fnf_flag ? 'pending' : 'not required') + '.',
      kind: 'HR'
    });
    return { employee_id: e.employee_id, status: 'EXITED', full_and_final: !!payload.fnf_flag };
  },

  remove: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    Perm.require(ctx, 'employees.delete');
    var e = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    if (txt_(payload.reason).length < 4) fail_('VALIDATION', 'Please write why this record is being removed.', { field: 'reason' });
    var hasPayroll = Db.count(c, 'PayrollItems', function (i) { return txt_(i.employee_id) === e.employee_id; });
    if (hasPayroll) fail_('IN_USE', 'This employee has ' + hasPayroll + ' payroll record(s) and cannot be deleted. Record an exit instead so history stays intact.');
    Db.softDelete(c, 'Employees', 'employee_id', e.employee_id, { actor: ctx.userId });
    if (txt_(e.user_id)) Db.update(masterCtx_(), 'Users', 'user_id', e.user_id, { status: 'INACTIVE' }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.delete', entity: 'Employees', entity_id: e.employee_id,
      before: redact_(e), note: 'Employee record removed. Reason: ' + payload.reason, severity: 'SENSITIVE'
    });
    return { deleted: true };
  },

  /* ============================================================ documents = */
  documentsList: function (ctx, payload) {
    Perm.require(ctx, 'employees.view');
    if (!EmployeeMask.isSelf_(ctx, { employee_id: payload.employee_id })) Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'EmployeeDocuments', function (d) { return txt_(d.employee_id) === payload.employee_id; });
    var page = paginate_(sortRows_(rows, 'created_at', 'DESC'), payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (d) {
        return {
          doc_id: d.doc_id, employee_id: d.employee_id, doc_type: d.doc_type, doc_name: d.doc_name, file_id: d.file_id,
          file_name: d.file_name, mime_type: d.mime_type, size_bytes: intVal_(d.size_bytes), issued_date: d.issued_date,
          expiry_date: d.expiry_date, verified: boolVal_(d.verified), verified_by: d.verified_by, verified_at: d.verified_at,
          note: d.note, uploaded_at: d.created_at,
          expired: !!d.expiry_date && txt_(d.expiry_date) < todayIso_(),
          expiring_soon: !!d.expiry_date && txt_(d.expiry_date) >= todayIso_() && txt_(d.expiry_date) <= isoAddDays_(todayIso_(), 30)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      doc_types: ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'PHOTO', 'RESUME', 'OFFER_LETTER', 'RELIEVING_LETTER', 'PAYSLIP', 'BANK_PROOF', 'MEDICAL_CERTIFICATE', 'OTHER']
    };
  },

  documentsSave: function (ctx, payload) {
    Perm.require(ctx, 'employees.edit');
    Perm.assertEmployee(ctx, payload.employee_id);
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var patch = {
      employee_id: payload.employee_id, doc_type: txt_(payload.doc_type).toUpperCase(), doc_name: payload.doc_name,
      file_id: payload.file_id, file_name: payload.file_name, mime_type: payload.mime_type,
      size_bytes: intVal_(payload.size_bytes), issued_date: payload.issued_date, expiry_date: payload.expiry_date,
      verified: 'FALSE', note: payload.note
    };
    var row;
    if (payload.doc_id) {
      var before = Db.get(c, 'EmployeeDocuments', 'doc_id', payload.doc_id);
      row = Db.update(c, 'EmployeeDocuments', 'doc_id', payload.doc_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'employees', action: 'employees.documents.save', entity: 'EmployeeDocuments', entity_id: row.doc_id, before: { doc_name: before.doc_name, file_id: before.file_id }, after: patch, note: 'Document updated for ' + txt_(employee.name) });
    } else {
      row = Db.insert(c, 'EmployeeDocuments', patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'employees', action: 'employees.documents.save', entity: 'EmployeeDocuments', entity_id: row.doc_id, after: patch, note: txt_(patch.doc_type) + ' uploaded for ' + txt_(employee.name) });
    }
    // remember the Aadhaar file on the employee record for quick access
    if (patch.doc_type === 'AADHAAR') {
      Db.update(c, 'Employees', 'employee_id', employee.employee_id, { aadhaar_file_id: payload.file_id }, { actor: ctx.userId });
    }
    return { doc_id: row.doc_id };
  },

  documentsVerify: function (ctx, payload) {
    Perm.require(ctx, 'employees.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var doc = Db.get(c, 'EmployeeDocuments', 'doc_id', payload.doc_id);
    Perm.assertEmployee(ctx, doc.employee_id);
    Db.update(c, 'EmployeeDocuments', 'doc_id', doc.doc_id, {
      verified: payload.verified === false ? 'FALSE' : 'TRUE', verified_by: ctx.userId, verified_at: nowIso_(), note: payload.note || doc.note
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.documents.verify', entity: 'EmployeeDocuments', entity_id: doc.doc_id,
      before: { verified: boolVal_(doc.verified) }, after: { verified: payload.verified !== false }, note: txt_(doc.doc_name) + ' verification updated'
    });
    return { doc_id: doc.doc_id, verified: payload.verified !== false };
  },

  documentsDelete: function (ctx, payload) {
    Perm.require(ctx, 'employees.delete');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var doc = Db.get(c, 'EmployeeDocuments', 'doc_id', payload.doc_id);
    Perm.assertEmployee(ctx, doc.employee_id);
    Db.softDelete(c, 'EmployeeDocuments', 'doc_id', doc.doc_id, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.documents.delete', entity: 'EmployeeDocuments', entity_id: doc.doc_id,
      before: { doc_type: doc.doc_type, doc_name: doc.doc_name, file_id: doc.file_id },
      note: 'Document removed from records (the Drive file is kept in the folder history)', severity: 'SENSITIVE'
    });
    return { deleted: true };
  },

  /* =============================================================== import = */
  parseCsv_: function (text) {
    var rows = [];
    var current = [], field = '', inQuotes = false;
    var src = txt_(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n') { current.push(field); rows.push(current); current = []; field = ''; }
      else field += ch;
    }
    current.push(field);
    if (current.length > 1 || txt_(current[0])) rows.push(current);
    return rows.filter(function (r) { return r.some(function (x) { return txt_(x) !== ''; }); });
  },

  importPreview: function (ctx, payload) {
    Perm.require(ctx, 'employees.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var table = Employees.parseCsv_(payload.csv);
    if (!table.length) fail_('VALIDATION', 'The pasted file looks empty. Copy the columns from the template and try again.');
    if (table.length > 501) fail_('VALIDATION', 'Please import at most 500 employees at a time (this file has ' + (table.length - 1) + ' rows).');

    var header = table[0].map(function (h) { return txt_(h).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, ''); });
    var alias = {
      employee_name: 'name', full_name: 'name', mobile: 'phone', mobile_number: 'phone', phone_number: 'phone', contact: 'phone',
      date_of_joining: 'joining_date', doj: 'joining_date', join_date: 'joining_date', role: 'designation', post: 'designation',
      department_name: 'department', site: 'project', project_name: 'project', location: 'city', work_location: 'city',
      account_number: 'bank_account', account_no: 'bank_account', ifsc: 'bank_ifsc', bank: 'bank_name',
      aadhaar: 'aadhaar_last4', aadhar: 'aadhaar_last4', aadhaar_number: 'aadhaar_last4', monthly_ctc: 'ctc_monthly', ctc: 'ctc_monthly', salary: 'ctc_monthly',
      state_name: 'state', emp_code: 'code', employee_code: 'code', father_name: 'father_name'
    };
    header = header.map(function (h) { return alias[h] || h; });
    var required = ['name', 'phone'];
    var missing = required.filter(function (r) { return header.indexOf(r) < 0; });
    if (missing.length) {
      fail_('VALIDATION', 'The file is missing required column(s): ' + missing.join(', ') + '. Expected columns: ' + header.join(', '));
    }

    var projects = {}, branches = {};
    Db.all(c, 'Projects').forEach(function (p) { projects[txt_(p.name).toLowerCase()] = p; projects[txt_(p.code).toLowerCase()] = p; });
    Db.all(c, 'Branches').forEach(function (b) { branches[txt_(b.name).toLowerCase()] = b; branches[txt_(b.code).toLowerCase()] = b; });
    var existingPhones = {};
    Db.all(c, 'Employees').forEach(function (e) { existingPhones[normPhone_(e.phone)] = txt_(e.name); });

    var seen = {};
    var out = [];
    for (var r = 1; r < table.length; r++) {
      var raw = {};
      header.forEach(function (h, idx) { raw[h] = txt_(table[r][idx]).trim(); });
      var errors = [], warnings = [];
      var name = raw.name;
      var phone = normPhone_(raw.phone);
      if (!name || name.length < 3) errors.push('Name is required (at least 3 characters).');
      if (!isPhoneIn_(phone)) errors.push('Mobile number must be a valid 10-digit Indian number.');
      else if (existingPhones[phone]) errors.push('Mobile number already belongs to ' + existingPhones[phone] + '.');
      else if (seen[phone]) errors.push('This mobile number appears twice in the file (row ' + seen[phone] + ').');
      if (phone && !seen[phone]) seen[phone] = r + 1;
      var joinDate = toIsoDate_(raw.joining_date) || todayIso_();
      if (raw.joining_date && !toIsoDate_(raw.joining_date)) errors.push('Joining date "' + raw.joining_date + '" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).');
      if (raw.email && !isEmail_(raw.email)) errors.push('Email "' + raw.email + '" does not look right.');
      if (raw.pan && !isPan_(raw.pan)) errors.push('PAN "' + raw.pan + '" does not match the format ABCDE1234F.');
      if (raw.bank_ifsc && !isIfsc_(raw.bank_ifsc)) errors.push('IFSC "' + raw.bank_ifsc + '" does not match the format HDFC0001234.');
      var project = raw.project ? (projects[txt_(raw.project).toLowerCase()] || null) : null;
      if (raw.project && !project) warnings.push('Project "' + raw.project + '" was not found — the employee will be added without a site.');
      var branch = raw.branch ? (branches[txt_(raw.branch).toLowerCase()] || null) : null;
      if (raw.branch && !branch) warnings.push('Branch "' + raw.branch + '" was not found.');
      if (raw.aadhaar_last4 && !/^\d{4}$/.test(raw.aadhaar_last4.replace(/\D/g, '').slice(-4))) warnings.push('Aadhaar: only the last 4 digits can be stored.');
      out.push({
        row_no: r + 1,
        data: {
          name: name, phone: phone, email: normEmail_(raw.email), designation: raw.designation, department: raw.department,
          joining_date: joinDate, gender: txt_(raw.gender).toUpperCase(), city: raw.city, state: raw.state,
          pan: txt_(raw.pan).toUpperCase(), aadhaar_last4: aadhaarLast4_(raw.aadhaar_last4),
          bank_name: raw.bank_name, bank_account: raw.bank_account, bank_ifsc: txt_(raw.bank_ifsc).toUpperCase(),
          ctc_monthly: numVal_(raw.ctc_monthly), employment_type: txt_(raw.employment_type || 'FULL_TIME').toUpperCase(),
          project_id: project ? project.project_id : '', project_label: project ? txt_(project.name) : raw.project,
          branch_id: branch ? branch.branch_id : '', branch_label: branch ? txt_(branch.name) : raw.branch,
          code: txt_(raw.code)
        },
        errors: errors, warnings: warnings,
        ok: errors.length === 0
      });
    }
    return {
      rows: out,
      total: out.length,
      valid: out.filter(function (x) { return x.ok; }).length,
      invalid: out.filter(function (x) { return !x.ok; }).length,
      warnings: out.filter(function (x) { return x.warnings.length; }).length,
      detected_columns: uniq_(header),
      ignored_columns: uniq_(header.filter(function (h) { return ['name', 'phone', 'email', 'designation', 'department', 'joining_date', 'gender', 'city', 'state', 'pan', 'aadhaar_last4', 'bank_name', 'bank_account', 'bank_ifsc', 'ctc_monthly', 'employment_type', 'project', 'branch', 'code'].indexOf(h) < 0; })),
      template_csv: 'name,phone,email,designation,department,joining_date,gender,city,state,pan,aadhaar_last4,bank_name,bank_account,bank_ifsc,ctc_monthly,project,branch\n' +
        'Ramesh Yadav,9821012345,ramesh@example.com,Mason,Site Operations,2026-01-15,MALE,Pune,Maharashtra,ABCDE1234F,4321,State Bank of India,12345678901,SBIN0001234,24000,Tower A Site,Pune Head Office\n'
    };
  },

  importCommit: function (ctx, payload) {
    Perm.require(ctx, 'employees.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = payload.rows || [];
    var mode = txt_(payload.mode || 'VALID_ONLY').toUpperCase();
    var invalid = rows.filter(function (r) { return !r.ok || (r.errors && r.errors.length); });
    if (mode === 'REJECT_ALL' && invalid.length) {
      fail_('VALIDATION', 'Nothing was imported because ' + invalid.length + ' row(s) have problems. Fix them or choose "Skip problem rows".');
    }
    var created = [], failed = [];
    rows.forEach(function (r) {
      if (!r.ok) return;
      var data = r.data || {};
      try {
        if (txt_(data.project_id) === txt_(payload.default_project_id)) delete data.default_project_id;
        var saved = Employees.save(ctx, {
          name: data.name, phone: data.phone, email: data.email, designation: data.designation, department: data.department,
          joining_date: data.joining_date, gender: data.gender, city: data.city, state: data.state, pan: data.pan,
          aadhaar_last4: data.aadhaar_last4, bank_name: data.bank_name, bank_account: data.bank_account,
          bank_ifsc: data.bank_ifsc, ctc_monthly: data.ctc_monthly, employment_type: data.employment_type,
          project_id: txt_(data.project_id) || txt_(payload.default_project_id), branch_id: data.branch_id,
          code: txt_(data.code), status: 'ACTIVE', pf_applicable: true, esic_applicable: true, pt_applicable: true
        });
        created.push({ row_no: r.row_no, employee_id: saved.employee.employee_id, code: saved.employee.code, name: saved.employee.name, login_created: !!(saved.login && saved.login.created) });
      } catch (e) {
        failed.push({ row_no: r.row_no, name: data.name, error: txt_(e.message) });
      }
    });
    Audit.write(ctx, {
      module: 'employees', action: 'employees.import.commit', entity: 'Employees', entity_id: '',
      after: { created: created.length, failed: failed.length, mode: mode },
      note: 'Bulk import: ' + created.length + ' created, ' + failed.length + ' failed, ' + invalid.length + ' skipped'
    });
    return {
      created: created.length, failed: failed.length, skipped: invalid.length,
      rows: created, problems: failed.concat(invalid.map(function (i) {
        return { row_no: i.row_no, name: i.data && i.data.name, error: (i.errors || []).join(' ') };
      })),
      message: created.length + ' employee(s) added' + (invalid.length ? ', ' + invalid.length + ' row(s) skipped' : '') +
        '. Each employee can now activate their login with the OTP sent to their mobile number.'
    };
  },

  /* ============================================================ directory = */
  directory: function (ctx, payload) {
    Perm.require(ctx, 'employees.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'Employees', function (e) {
      if (allowed && allowed.indexOf(txt_(e.employee_id)) < 0) return false;
      return txt_(e.status).toUpperCase() !== 'EXITED';
    });
    if (payload.search) rows = rows.filter(function (e) { return matchesSearch_(e, SCHEMA.Employees.search, payload.search); });
    rows = sortRows_(rows, 'name', 'ASC');
    var page = paginate_(rows, payload.page, payload.pageSize || 60);
    return {
      rows: page.rows.map(function (e) {
        return {
          employee_id: e.employee_id, code: e.code, name: e.name, designation: e.designation, department: e.department,
          phone: maskPhone_(e.phone), email: e.email, status: e.status, photo_file_id: e.photo_file_id,
          blood_group: e.blood_group, emergency_name: e.emergency_name, emergency_phone: maskPhone_(e.emergency_phone),
          city: e.city, joining_date: e.joining_date, manager_id: e.manager_id
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  }
};

/** Light employee list used by every dropdown in the app. */
var EmployeeOptions = {
  list: function (ctx) {
    if (!ctx.companyId) return [];
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = ctx.userId ? Perm.allowedEmployeeIds(ctx) : null;
    var rows = Db.all(c, 'Employees', function (e) {
      if (allowed && allowed.indexOf(txt_(e.employee_id)) < 0) return false;
      return txt_(e.status).toUpperCase() !== 'EXITED';
    });
    rows = sortRows_(rows, 'name', 'ASC').slice(0, 600);
    return rows.map(function (e) {
      return {
        employee_id: e.employee_id, code: e.code, name: e.name, designation: e.designation, department: e.department,
        project_id: e.project_id, status: e.status, phone: maskPhone_(e.phone)
      };
    });
  }
};

/** Small helpers that make employee screens readable. */
var EmployeeTimeline = {
  build: function (c, employee, limit) {
    var events = [];
    events.push({ at: txt_(employee.created_at), kind: 'JOINED', title: 'Record created', detail: 'Joining date ' + fmtDateHuman_(employee.joining_date) });
    Db.all(c, 'ProjectAssignments', function (a) { return txt_(a.employee_id) === txt_(employee.employee_id); }).forEach(function (a) {
      var p = Db.find(c, 'Projects', 'project_id', a.project_id);
      events.push({ at: txt_(a.from_date) || txt_(a.created_at), kind: 'PROJECT', title: 'Assigned to ' + (p ? txt_(p.name) : 'a project'), detail: (txt_(a.role_on_site) || 'Team member') + (a.to_date ? ' until ' + fmtDateHuman_(a.to_date) : '') });
    });
    Db.all(c, 'LeaveRequests', function (l) { return txt_(l.employee_id) === txt_(employee.employee_id) && txt_(l.status) === 'APPROVED'; }).forEach(function (l) {
      events.push({ at: txt_(l.from_date), kind: 'LEAVE', title: txt_(l.leave_type_name) + ' approved', detail: fmtDateHuman_(l.from_date) + ' → ' + fmtDateHuman_(l.to_date) + ' (' + numVal_(l.days) + ' day(s))' });
    });
    Db.all(c, 'AttendanceRegularization', function (r) { return txt_(r.employee_id) === txt_(employee.employee_id) && txt_(r.status) === 'APPROVED'; }).forEach(function (r) {
      events.push({ at: txt_(r.date), kind: 'ATTENDANCE', title: 'Attendance corrected', detail: fmtDateHuman_(r.date) + ' marked ' + txt_(r.requested_status) });
    });
    if (txt_(employee.exit_date)) {
      events.push({ at: txt_(employee.exit_date), kind: 'EXIT', title: 'Exit recorded', detail: txt_(employee.exit_reason) });
    }
    return events.filter(function (e) { return !!e.at; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, limit || 10);
  }
};

/** Employee self-service profile (app.profile.get / app.profile.save). */
var Profile = {
  get: function (ctx) {
    if (ctx.scope === 'SUPER') {
      return { kind: 'SUPER', user: { name: ctx.name, email: ctx.email, phone: ctx.phone } };
    }
    var out = { kind: ctx.employeeId ? 'EMPLOYEE' : 'USER', user: { name: ctx.name, email: ctx.email, phone: maskPhone_(ctx.phone) } };
    if (ctx.employeeId) {
      var c = ctx.companyCtx || companyCtx_(ctx.companyId);
      var e = Db.find(c, 'Employees', 'employee_id', ctx.employeeId);
      if (e) {
        var masked = EmployeeMask.row(ctx, e);
        out.employee = {
          employee_id: e.employee_id, code: e.code, name: e.name, gender: e.gender, dob: e.dob,
          joining_date: e.joining_date, status: e.status, department: e.department, designation: e.designation,
          employment_type: e.employment_type, work_state: e.work_state,
          phone: e.phone, alt_phone: e.alt_phone, email: e.email, address: e.address, city: e.city, state: e.state,
          pincode: e.pincode, blood_group: e.blood_group, emergency_name: e.emergency_name,
          emergency_phone: e.emergency_phone, photo_file_id: e.photo_file_id,
          pan: masked.pan, bank_name: e.bank_name, bank_account: masked.bank_account, bank_ifsc: e.bank_ifsc,
          aadhaar_last4: masked.aadhaar_last4, pf_uan: e.pf_uan, esic_ip_no: e.esic_ip_no
        };
        var project = txt_(e.project_id) ? Db.find(c, 'Projects', 'project_id', e.project_id) : null;
        out.project = project ? { project_id: project.project_id, name: project.name, city: project.city } : null;
      }
    }
    return out;
  },

  save: function (ctx, payload) {
    if (ctx.scope === 'SUPER') fail_('FORBIDDEN', 'Platform accounts do not have an employee profile.');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var target = null;
    if (ctx.employeeId) {
      target = Db.find(c, 'Employees', 'employee_id', ctx.employeeId);
    }
    if (target) {
      var patch = {
        alt_phone: payload.alt_phone ? normPhone_(payload.alt_phone) : txt_(target.alt_phone),
        address: payload.address === undefined ? target.address : payload.address,
        city: payload.city === undefined ? target.city : payload.city,
        state: payload.state === undefined ? target.state : payload.state,
        pincode: payload.pincode === undefined ? target.pincode : payload.pincode,
        blood_group: payload.blood_group === undefined ? target.blood_group : payload.blood_group,
        emergency_name: payload.emergency_name === undefined ? target.emergency_name : payload.emergency_name,
        emergency_phone: payload.emergency_phone ? normPhone_(payload.emergency_phone) : txt_(target.emergency_phone),
        photo_file_id: payload.photo_file_id || txt_(target.photo_file_id)
      };
      // employees may not change their own name/phone through this screen (HR owns those)
      Db.update(c, 'Employees', 'employee_id', target.employee_id, patch, { actor: ctx.userId });
      Db.update(masterCtx_(), 'Users', 'user_id', ctx.userId, { name: txt_(target.name) }, { system: true });
      Audit.write(ctx, {
        module: 'core', action: 'app.profile.save', entity: 'Employees', entity_id: target.employee_id,
        after: { city: patch.city, state: patch.state, emergency_name: patch.emergency_name, photo: !!patch.photo_file_id },
        note: 'Employee updated their own profile'
      });
    } else {
      var patchU = { name: txt_(payload.name || ctx.name), phone: payload.phone ? normPhone_(payload.phone) : txt_(ctx.phone) };
      Db.update(masterCtx_(), 'Users', 'user_id', ctx.userId, patchU, { actor: ctx.userId });
      Audit.write(ctx, { module: 'core', action: 'app.profile.save', entity: 'Users', entity_id: ctx.userId, after: { name: patchU.name }, note: 'Profile updated' });
    }
    return Profile.get(ctx);
  }
};
