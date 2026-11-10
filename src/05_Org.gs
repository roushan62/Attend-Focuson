/**
 * FocusOn HRMS 2.0 — Organization & Employee master (05_Org.gs)
 * Employees, branches, departments, designations, sites, shifts, attendance
 * policies, holidays. Soft deletes. Import/export via CSV rows.
 */

var EMP_HEADERS = ['empId', 'empCode', 'name', 'gender', 'dob', 'phone', 'email',
  'address', 'emergencyContact', 'bloodGroup', 'maritalStatus', 'fathersName',
  'branchId', 'departmentId', 'designationId', 'siteId', 'managerId', 'shiftId',
  'attPolicyId', 'employmentType', 'doj', 'probationMonths', 'confirmed', 'confirmationDate',
  'noticePeriod', 'status', 'photoFileId', 'joiningLetter', 'roleId', 'panel',
  'loginId', 'passwordTemp', 'mustChangePassword', 'createdBy', 'createdAt', 'deleted'];

// ---------- Company profile ----------

function org_companyprofile_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'settings.company', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Settings');
  var rows = _readSheet(db, 'Settings').rows;
  var headers = _readSheet(db, 'Settings').headers;
  var col = {}; headers.forEach(function (h, j) { col[h] = j + 1; });
  var getv = function (key) {
    for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
    return '';
  };
  if (payload.action === 'get') {
    return _result(true, {
      name: getv('company.name') || APP.companyName,
      legalName: getv('company.legalName') || '',
      address: getv('company.address') || '',
      gstin: getv('company.gstin') || '',
      pan: getv('company.pan') || '',
      logo: getv('company.logo') || '',
      signature: getv('company.signature') || '',
      stamp: getv('company.stamp') || '',
      primaryColor: getv('company.primaryColor') || APP.primaryColor,
      rdashLink: getv('integration.rdashLink') || ''
    });
  }
  // set
  var fields = ['name', 'legalName', 'address', 'gstin', 'pan', 'logo', 'signature', 'stamp', 'primaryColor', 'rdashLink'];
  var now = _nowStr();
  var changed = {};
  fields.forEach(function (f) {
    var val = payload[f] !== undefined ? payload[f] : getv('company.' + f);
    var key = 'company.' + f;
    var exists = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].key === key) { exists = true; sheet.getRange(i + 2, col['value'], 1, 1).setValue(val); changed[key] = val; break; }
    }
    if (!exists) {
      _appendRows(sheet, [[key, val, 'text', now]]);
      changed[key] = val;
    }
  });
  delete _rowCache[_sheetKey(db, 'Settings')];
  _audit(boot.user.userId, 'org.companyprofile.set', 'Settings', 'company', {}, changed);
  _clearPermCache();
  return _result(true, { message: 'Company profile saved.' });
}

// ---------- Generic master CRUD (branches, departments, designations, sites, shifts, policies, holidays) ----------

function _masterList(kind) { return _readSheet(_openCoreDb(), kind).rows.filter(function (r) { return r.deleted !== '1'; }); }
function _masterSave(kind, headers, idCol, payload, auditAction) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, kind);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var rows = _readSheet(db, kind).rows;
  var hdrs = _readSheet(db, kind).headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = _nowStr();
  var id = payload.id || _uid();
  var isNew = true;
  var rowNum = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(id)) { isNew = false; rowNum = i + 2; break; }
  }
  var values = {};
  headers.forEach(function (h) { values[h] = payload[h] !== undefined ? payload[h] : ''; });
  if (isNew) {
    // duplicate code check
    if (col['code']) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].deleted === '1') continue;
        if (String(rows[i].code) === String(values.code)) throw _error(ERR.DUPLICATE, 'This code already exists.', 'code');
      }
    }
    var row = headers.map(function (h) {
      if (h === idCol) return id;
      if (h === 'createdAt') return now;
      if (h === 'deleted') return '0';
      return values[h] || '';
    });
    _appendRows(sheet, [row]);
    _audit(boot.user.userId, auditAction || ('org.' + kind + '.create'), kind, id, {}, values);
  } else {
    var old = {};
    headers.forEach(function (h) { old[h] = rows[i ? 0 : 0][h] || ''; });
    // re-fetch old properly
    var oldRow = null;
    for (var i = 0; i < rows.length; i++) { if (String(rows[i][idCol]) === String(id)) { oldRow = rows[i]; break; } }
    if (!oldRow) throw _error(ERR.NOT_FOUND, kind + ' not found.');
    headers.forEach(function (h) { old[h] = oldRow[h] || ''; });
    headers.forEach(function (h) {
      var c = col[h];
      if (c) sheet.getRange(rowNum, c, 1, 1).setValue(values[h] !== undefined ? values[h] : '');
    });
    delete _rowCache[_sheetKey(db, kind)];
    _audit(boot.user.userId, auditAction || ('org.' + kind + '.edit'), kind, id, old, values);
  }
  return _result(true, { id: id, message: kind + ' saved.' });
}
function _masterDelete(kind, idCol, payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  if (!_can(boot.user, 'org.delete', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed to delete.');
  var id = payload.id;
  var db = _openCoreDb();
  var ok = _softDelete(db, kind, id, idCol);
  _audit(boot.user.userId, 'org.' + kind + '.delete', kind, id, {}, {});
  return _result(true, { deleted: ok });
}

// Branch
function org_branchlist_(payload) { return _result(true, { rows: _masterList('Branches') }); }
function org_branchsave_(payload) { return _masterSave('Branches', ['branchId','name','code','address','state','geoLocations','headId','createdAt','deleted'], 'branchId', payload, 'org.branch.save'); }
function org_branchdelete_(payload) { return _masterDelete('Branches', 'branchId', payload); }

// Department
function org_departmentlist_(payload) { return _result(true, { rows: _masterList('Departments') }); }
function org_departmentsave_(payload) { return _masterSave('Departments', ['deptId','name','code','headId','parentId','createdAt','deleted'], 'deptId', payload, 'org.department.save'); }
function org_departmentdelete_(payload) { return _masterDelete('Departments', 'deptId', payload); }

// Designation
function org_designationlist_(payload) { return _result(true, { rows: _masterList('Designations') }); }
function org_designationsave_(payload) { return _masterSave('Designations', ['desgId','name','level','defaultRoleId','noticePeriod','createdAt','deleted'], 'desgId', payload, 'org.designation.save'); }
function org_designationdelete_(payload) { return _masterDelete('Designations', 'desgId', payload); }

// Site
function org_sitelist_(payload) { return _result(true, { rows: _masterList('Sites') }); }
function org_sitesave_(payload) { return _masterSave('Sites', ['siteId','name','code','branchId','address','geoPoint','createdAt','deleted'], 'siteId', payload, 'org.site.save'); }
function org_sitedelete_(payload) { return _masterDelete('Sites', 'siteId', payload); }

// Shift
function org_shiftlist_(payload) { return _result(true, { rows: _masterList('Shifts') }); }
function org_shiftsave_(payload) { return _masterSave('Shifts', ['shiftId','name','start','end','graceMins','breakMins','nightShift','weeklyOff','createdAt','deleted'], 'shiftId', payload, 'org.shift.save'); }
function org_shiftdelete_(payload) { return _masterDelete('Shifts', 'shiftId', payload); }

// Attendance policy
function org_attpolicy_list_(payload) { return _result(true, { rows: _masterList('AttPolicies') }); }
function org_attpolicy_save_(payload) { return _masterSave('AttPolicies', ['policyId','name','type','geoRadiusM','selfie','blockOrFlag','graceMins','autoCheckout','createdAt','deleted'], 'policyId', payload, 'org.attpolicy.save'); }
function org_attpolicy_delete_(payload) { return _masterDelete('AttPolicies', 'policyId', payload); }

// Holiday
function org_holidaylist_(payload) {
  var year = payload.year || new Date().getFullYear();
  var rows = _masterList('Holidays').filter(function (r) { return String(r.date).slice(0,4) === String(year); });
  return _result(true, { rows: rows, year: year });
}
function org_holiday_save_(payload) { return _masterSave('Holidays', ['holidayId','date','name','type','branchId','createdAt','deleted'], 'holidayId', payload, 'org.holiday.save'); }
function org_holiday_delete_(payload) { return _masterDelete('Holidays', 'holidayId', payload); }

// ---------- Employee master ----------

function org_employee_list_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var rows = _masterList('Employees');
  // scope filter
  var scope = _userScope(boot.user);
  rows = _scopeFilterEmployees(rows, boot.user, scope);
  // sensitive field masking
  var showSalary = _can(boot.user, 'field.salary.view', 'company');
  var showBank = _can(boot.user, 'field.bank.view', 'company');
  var showGov = _can(boot.user, 'field.govtid.view', 'company');
  rows = rows.map(function (r) {
    if (!showSalary) { r.salary = '***'; r.ctc = '***'; }
    if (!showBank) { r.bank = '***'; r.account = '***'; r.ifsc = '***'; }
    if (!showGov) { r.pan = '***'; r.aadhaar = '***'; r.uan = '***'; }
    return r;
  });
  return _result(true, { rows: rows });
}

function _userScope(user) {
  if (_isSuperAdmin(user.userId)) return 'C';
  var perms = _effectivePermissions(user.userId);
  // find widest scope across key org perms
  var best = 'S';
  ['employee.view', 'org.view'].forEach(function (p) {
    if (perms[p] && _scopeRank[perms[p].scope] > _scopeRank[best]) best = perms[p].scope;
  });
  return best;
}
function _scopeFilterEmployees(rows, user, scope) {
  if (scope === 'C') return rows;
  if (scope === 'X') return rows; // custom list not implemented in MVP; treat as company
  if (scope === 'B') {
    var branch = _getUserBranch(user);
    return rows.filter(function (r) { return r.branchId === branch; });
  }
  if (scope === 'P') {
    var dept = _getUserDept(user);
    return rows.filter(function (r) { return r.departmentId === dept; });
  }
  if (scope === 'T') {
    var team = _teamMemberIds(user.userId);
    return rows.filter(function (r) { return team.indexOf(r.empId) >= 0 || r.empId === user.userId; });
  }
  if (scope === 'D') {
    return rows.filter(function (r) { return r.managerId === user.userId || r.empId === user.userId; });
  }
  return rows.filter(function (r) { return r.empId === user.userId; });
}
function _getUserBranch(user) {
  var emp = _findEmployeeByUser(user.userId);
  return emp ? emp.branchId : '';
}
function _getUserDept(user) {
  var emp = _findEmployeeByUser(user.userId);
  return emp ? emp.departmentId : '';
}
function _findEmployeeByUser(userId) {
  var rows = _masterList('Employees');
  for (var i = 0; i < rows.length; i++) if (rows[i].userId === userId || rows[i].loginId === userId) return rows[i];
  return null;
}
function _teamMemberIds(userId) {
  // downline: all employees whose manager chain leads to userId
  var rows = _masterList('Employees');
  var byMgr = {};
  rows.forEach(function (r) { if (r.managerId) { byMgr[r.managerId] = byMgr[r.managerId] || []; byMgr[r.managerId].push(r.empId); } });
  var out = [], queue = [userId];
  while (queue.length) {
    var cur = queue.shift();
    (byMgr[cur] || []).forEach(function (x) { if (out.indexOf(x) < 0) { out.push(x); queue.push(x); } });
  }
  return out;
}

function org_employee_get_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var rows = _masterList('Employees');
  var emp = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].empId) === String(payload.empId)) { emp = rows[i]; break; }
  if (!emp) throw _error(ERR.NOT_FOUND, 'Employee not found.');
  // scope check
  var scope = _userScope(boot.user);
  if (!_inScope(emp, boot.user, scope)) throw _error(ERR.FORBIDDEN, 'Not in your scope.');
  return _result(true, { row: emp });
}
function _inScope(emp, user, scope) {
  if (scope === 'C') return true;
  if (scope === 'B') return emp.branchId === _getUserBranch(user);
  if (scope === 'P') return emp.departmentId === _getUserDept(user);
  if (scope === 'T') return _teamMemberIds(user.userId).indexOf(emp.empId) >= 0 || emp.empId === _findEmployeeByUser(user.userId)?.empId;
  if (scope === 'D') return emp.managerId === user.userId || emp.empId === _findEmployeeByUser(user.userId)?.empId;
  return emp.empId === _findEmployeeByUser(user.userId)?.empId;
}

function org_employee_save_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var canCreate = _can(boot.user, 'employee.create', 'company');
  var canEdit = _can(boot.user, 'employee.edit', 'company');
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Employees');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, EMP_HEADERS.length).setValues([EMP_HEADERS]);
  var rows = _readSheet(db, 'Employees').rows;
  var hdrs = _readSheet(db, 'Employees').headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = _nowStr();
  var id = payload.empId || _uid();
  var empCode = payload.empCode || ('FO-' + _nextCounter('EMP'));
  var isNew = true, rowNum = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].empId) === String(id)) { isNew = false; rowNum = i + 2; break; }
  }
  if (isNew) {
    if (!canCreate) throw _error(ERR.FORBIDDEN, 'Cannot create employee.');
    // dup code
    for (var i = 0; i < rows.length; i++) if (rows[i].deleted !== '1' && rows[i].empCode === empCode) throw _error(ERR.DUPLICATE, 'Employee code already exists.', 'empCode');
    // build row
    var row = {};
    EMP_HEADERS.forEach(function (h) { row[h] = ''; });
    row.empId = id; row.empCode = empCode;
    row.createdAt = now; row.deleted = '0';
    ['empCode','name','gender','dob','phone','email','address','emergencyContact','bloodGroup','maritalStatus','fathersName',
     'branchId','departmentId','designationId','siteId','managerId','shiftId','attPolicyId','employmentType','doj',
     'probationMonths','confirmed','confirmationDate','noticePeriod','status','photoFileId','joiningLetter','roleId',
     'panel','loginId','passwordTemp','mustChangePassword','createdBy'].forEach(function (h) {
      if (payload[h] !== undefined) row[h] = payload[h];
    });
    row.createdBy = boot.user.userId;
    row.status = row.status || 'Active';
    row.employmentType = row.employmentType || 'Full-time';
    var values = EMP_HEADERS.map(function (h) { return row[h] || ''; });
    _appendRows(sheet, [values]);
    _audit(boot.user.userId, 'org.employee.create', 'Employees', id, {}, row);
    _clearPermCache();
    return _result(true, { empId: id, empCode: empCode, message: 'Employee created.' });
  } else {
    if (!canEdit) throw _error(ERR.FORBIDDEN, 'Cannot edit employee.');
    var oldRow = null;
    for (var i = 0; i < rows.length; i++) { if (String(rows[i].empId) === String(id)) { oldRow = rows[i]; break; } }
    if (!oldRow) throw _error(ERR.NOT_FOUND, 'Employee not found.');
    var old = {}; EMP_HEADERS.forEach(function (h) { old[h] = oldRow[h] || ''; });
    var changes = {};
    EMP_HEADERS.forEach(function (h) {
      if (h === 'empId' || h === 'createdAt' || h === 'createdBy') return;
      if (payload[h] !== undefined && String(payload[h]) !== String(old[h])) {
        sheet.getRange(rowNum, col[h], 1, 1).setValue(payload[h]);
        changes[h] = payload[h];
      }
    });
    delete _rowCache[_sheetKey(db, 'Employees')];
    _audit(boot.user.userId, 'org.employee.edit', 'Employees', id, old, changes);
    _clearPermCache();
    return _result(true, { empId: id, message: 'Employee updated.' });
  }
}
function org_employee_delete_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  if (!_can(boot.user, 'employee.delete', 'company')) throw _error(ERR.FORBIDDEN, 'Super Admin only.');
  var ok = _softDelete(_openCoreDb(), 'Employees', payload.empId, 'empId');
  _audit(boot.user.userId, 'org.employee.delete', 'Employees', payload.empId, {}, {});
  _clearPermCache();
  return _result(true, { deleted: ok });
}
function org_employee_import_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'employee.import', 'company')) throw _error(ERR.FORBIDDEN, 'Cannot import.');
  var rows = payload.rows || []; // array of objects matching EMP_HEADERS
  var db = _openCoreDb();
  var sheet = _getOrCreateSheet(db, 'Employees');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, EMP_HEADERS.length).setValues([EMP_HEADERS]);
  var existing = _readSheet(db, 'Employees').rows;
  var codes = {}; existing.forEach(function (r) { if (r.deleted !== '1') codes[r.empCode] = true; });
  var out = [], errors = [], now = _nowStr();
  var batch = [];
  rows.forEach(function (r, idx) {
    var code = r.empCode || ('FO-' + _nextCounter('EMP'));
    if (codes[code]) { errors.push({ row: idx + 2, error: 'Duplicate code ' + code }); return; }
    codes[code] = true;
    var row = EMP_HEADERS.map(function (h) {
      if (h === 'empId') return _uid();
      if (h === 'empCode') return code;
      if (h === 'createdAt') return now;
      if (h === 'createdBy') return boot.user.userId;
      if (h === 'deleted') return '0';
      if (h === 'status') return r.status || 'Active';
      return r[h] || '';
    });
    batch.push(row);
    out.push({ empCode: code, name: r.name });
  });
  if (batch.length) _appendRows(sheet, batch);
  delete _rowCache[_sheetKey(db, 'Employees')];
  _clearPermCache();
  _audit(boot.user.userId, 'org.employee.import', 'Employees', 'batch', {}, { count: batch.length, errors: errors.length });
  return _result(true, { imported: batch.length, errors: errors, rows: out });
}
function org_employee_export_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'employee.export', 'company')) throw _error(ERR.FORBIDDEN, 'Cannot export.');
  var rows = org_employee_list_(payload).data.rows;
  var csv = [EMP_HEADERS.join(',')];
  rows.forEach(function (r) {
    csv.push(EMP_HEADERS.map(function (h) { var v = String(r[h] || '').replace(/"/g, '""'); return '"' + v + '"'; }).join(','));
  });
  return _result(true, { csv: csv.join('\n'), fileName: 'employees_' + _todayStr() + '.csv' });
}

// ---------- Org chart ----------
function org_chart_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'orgchart.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var rows = _masterList('Employees');
  var nodes = [], links = [];
  rows.forEach(function (r) {
    nodes.push({ id: r.empId, code: r.empCode, name: r.name, designation: r.designationId || '', department: r.departmentId || '', manager: r.managerId || '' });
    if (r.managerId) links.push({ from: r.managerId, to: r.empId });
  });
  return _result(true, { nodes: nodes, links: links });
}
