/**
 * FocusOn HRMS 2.0 — Attendance (07_Attendance.gs)
 * Check-in/out, geo-fence, selfie, policies, regularization, on-duty, overtime,
 * live board, muster roll, month lock.
 */

var ATT_HEADERS = ['date', 'empId', 'status', 'code', 'inTime', 'outTime', 'workMinutes',
  'lateMins', 'earlyMins', 'inLat', 'inLng', 'inDistM', 'outLat', 'outLng', 'outDistM',
  'gpsAccuracy', 'selfieFileId', 'source', 'flag', 'flagReason', 'approvedBy', 'approvedAt', 'deleted'];

function _attSheet(year, month) {
  var ss = _openAttDb(year);
  var name = 'ATT_' + year + '_' + String(month).padStart(2, '0');
  var sheet = _getOrCreateSheet(ss, name);
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, ATT_HEADERS.length).setValues([ATT_HEADERS]);
    sheet.getRange(1, 1, 1, ATT_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}
function _attKey(year, month, empId) { return year + '-' + String(month).padStart(2, '0') + ':' + empId; }

// Haversine distance in meters
function _distM(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return -1;
  var R = 6371000;
  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad;
  var dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function _getEmpPolicy(empId) {
  var emp = _findEmployeeById(empId);
  if (!emp) return null;
  var polId = emp.attPolicyId || 'POL_OFFICE';
  var rows = _readSheet(_openCoreDb(), 'AttPolicies').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].policyId) === String(polId)) return rows[i];
  return { id: 'POL_OFFICE', name: 'Office', type: 'Office', geoRadiusM: 100, selfie: false, blockOrFlag: 'flag', graceMins: 15, autoCheckout: true };
}
function _getShift(empId) {
  var emp = _findEmployeeById(empId);
  if (!emp) return null;
  var rows = _readSheet(_openCoreDb(), 'Shifts').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].shiftId) === String(emp.shiftId)) return rows[i];
  return { id: 'SH_GEN', name: 'General', start: '09:00', end: '18:00', graceMins: 15 };
}
function _isWeeklyOff(shift, dateStr) {
  if (!shift) return false;
  var wo = '';
  try { wo = shift.weeklyOff || ''; } catch (e) {}
  var days = [];
  try { days = JSON.parse(wo); } catch (e) { days = String(wo).split(',').map(Number); }
  var d = new Date(dateStr + 'T00:00:00Z');
  return days.indexOf(d.getUTCDay()) >= 0;
}
function _isHoliday(dateStr, branchId) {
  var rows = _readSheet(_openCoreDb(), 'Holidays').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date === dateStr && (rows[i].branchId === '' || rows[i].branchId === branchId)) return rows[i];
  }
  return null;
}

function _storeSelfie(base64, mime, empId, dateStr) {
  if (!base64) return '';
  var rootId = _getProp(PROP.ROOT_FOLDER);
  if (!rootId) return '';
  try {
    var root = DriveApp.getFolderById(rootId);
    var attFolder = _getOrCreateFolder(root, 'Attendance_Selfies');
    var yFolder = _getOrCreateFolder(attFolder, String(dateStr).slice(0, 4));
    var mFolder = _getOrCreateFolder(yFolder, String(dateStr).slice(0, 7));
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, 'selfie_' + empId + '_' + dateStr + '.jpg');
    var file = mFolder.createFile(blob);
    return file.getId();
  } catch (e) { return ''; }
}
function _getOrCreateFolder(parent, name) {
  var f = parent.getFoldersByName(name);
  if (f.hasNext()) return f.next();
  return parent.createFolder(name);
}

// ---------- Check in ----------

function att_checkin_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!empId) throw _error(ERR.NOT_FOUND, 'Employee record not found.');
  // scope: employee can mark self; supervisor/HR can mark others
  var isSelf = (empId === _findEmployeeByUserId(boot.user.userId));
  if (!isSelf && !_can(boot.user, 'attendance.markothers', 'company')) throw _error(ERR.FORBIDDEN, 'Cannot mark attendance for others.');
  var dateStr = payload.date || _todayStr();
  var now = new Date();
  var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
  var policy = _getEmpPolicy(empId);
  var shift = _getShift(empId);
  var flag = '', flagReason = '';
  var inDistM = -1;
  var lat = Number(payload.lat || 0), lng = Number(payload.lng || 0);
  var accuracy = Number(payload.acc || 0);

  if (policy.type === 'Office' && policy.geoRadiusM > 0 && lat && lng) {
    var geo = JSON.parse(policy.geoLocations || '[]');
    var nearest = -1;
    geo.forEach(function (g) {
      var d = _distM(lat, lng, Number(g.lat || 0), Number(g.lng || 0));
      if (d >= 0 && (nearest < 0 || d < nearest)) nearest = d;
    });
    if (nearest >= 0) inDistM = nearest;
    if (nearest < 0 || nearest > policy.geoRadiusM) {
      if (policy.blockOrFlag === 'block') throw _error(ERR.FORBIDDEN, 'You are outside the office geo-fence (' + Math.round(nearest) + ' m). Check-in blocked.');
      flag = '1'; flagReason = 'Outside geo-fence (' + Math.round(nearest) + ' m)';
    }
  }
  // weekly off / holiday
  if (_isWeeklyOff(shift, dateStr)) { flag = '1'; flagReason = 'Weekly off'; }
  var hol = _isHoliday(dateStr, _findEmployeeById(empId).branchId);
  if (hol) { flag = '1'; flagReason = 'Holiday: ' + hol.name; }

  var selfieFileId = '';
  if (policy.selfie && payload.selfie) {
    selfieFileId = _storeSelfie(payload.selfie, payload.selfieMime || 'image/jpeg', empId, dateStr);
  }

  var sheet = _attSheet(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)));
  var existing = _readSheet(_openAttDb(dateStr.slice(0, 4)), sheet.getName()).rows;
  var rowIdx = -1;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].date === dateStr && existing[i].empId === empId) { rowIdx = i; break; }
  }
  var lateMins = 0;
  // compute late vs shift start (server time Asia/Kolkata)
  var curMin = now.getHours() * 60 + now.getMinutes();
  var sMin = shift ? (Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3, 5))) : 0;
  var grace = shift ? Number(shift.graceMins || 0) : 0;
  if (curMin > sMin + grace) lateMins = curMin - (sMin + grace);

  var row = [dateStr, empId, 'Present', flag ? 'F' : 'P', timeStr, '', 0, lateMins, 0,
    lat, lng, inDistM, '', '', -1, accuracy, selfieFileId, 'punch', flag, flagReason, '', '', '0'];
  if (rowIdx >= 0) {
    // update existing (check-in again) — keep earliest
    var sheetRows = _readSheet(_openAttDb(dateStr.slice(0, 4)), sheet.getName()).rows;
    // find actual row number
    var rnum = -1;
    for (var i = 0; i < sheetRows.length; i++) {
      if (sheetRows[i].date === dateStr && sheetRows[i].empId === empId) { rnum = i + 2; break; }
    }
    if (rnum > 0) {
      sheet.getRange(rnum, 4, 1, 1).setValue(flag ? 'F' : 'P');
      sheet.getRange(rnum, 5, 1, 1).setValue(timeStr);
      sheet.getRange(rnum, 10, 1, 1).setValue(lat);
      sheet.getRange(rnum, 11, 1, 1).setValue(lng);
      sheet.getRange(rnum, 12, 1, 1).setValue(inDistM);
      sheet.getRange(rnum, 13, 1, 1).setValue(accuracy);
      sheet.getRange(rnum, 14, 1, 1).setValue(selfieFileId || sheetRows[i].selfieFileId || '');
      sheet.getRange(rnum, 15, 1, 1).setValue('punch');
      sheet.getRange(rnum, 16, 1, 1).setValue(flag);
      sheet.getRange(rnum, 17, 1, 1).setValue(flagReason);
      sheet.getRange(rnum, 8, 1, 1).setValue(lateMins);
      delete _rowCache[_sheetKey(_openAttDb(dateStr.slice(0, 4)), sheet.getName())];
    }
  } else {
    _appendRows(sheet, [row]);
    delete _rowCache[_sheetKey(_openAttDb(dateStr.slice(0, 4)), sheet.getName())];
  }
  _audit(boot.user.userId, 'att.checkin', 'Attendance', dateStr + ':' + empId, {}, { time: timeStr, dist: inDistM, flag: flag });
  return _result(true, { date: dateStr, status: flag ? 'Flagged' : 'Present', inTime: timeStr, lateMins: lateMins, flag: flag, flagReason: flagReason, selfie: !!selfieFileId });
}

// ---------- Check out ----------

function att_checkout_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn) throw _error(ERR.SESSION_EXPIRED, 'Session expired.');
  var empId = payload.empId || _findEmployeeByUserId(boot.user.userId);
  if (!empId) throw _error(ERR.NOT_FOUND, 'Employee record not found.');
  var dateStr = payload.date || _todayStr();
  var now = new Date();
  var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
  var sheet = _attSheet(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)));
  var rows = _readSheet(_openAttDb(dateStr.slice(0, 4)), sheet.getName()).rows;
  var rnum = -1, rowIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date === dateStr && rows[i].empId === empId) { rnum = i + 2; rowIdx = i; break; }
  }
  if (rnum < 0) throw _error(ERR.NOT_FOUND, 'No check-in found for today. Check in first.');
  var hdrs = _readSheet(_openAttDb(dateStr.slice(0, 4)), sheet.getName()).headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var inTime = rows[rowIdx].inTime || '';
  var workMins = 0;
  if (inTime) {
    var im = timeToMinutes(inTime); var om = now.getHours() * 60 + now.getMinutes();
    workMins = Math.max(0, om - im);
  }
  var outLat = Number(payload.lat || 0), outLng = Number(payload.lng || 0);
  var outDistM = -1;
  var policy = _getEmpPolicy(empId);
  if (policy.type === 'Office' && policy.geoRadiusM > 0 && outLat && outLng) {
    var geo = JSON.parse(policy.geoLocations || '[]');
    var nearest = -1;
    geo.forEach(function (g) {
      var d = _distM(outLat, outLng, Number(g.lat || 0), Number(g.lng || 0));
      if (d >= 0 && (nearest < 0 || d < nearest)) nearest = d;
    });
    outDistM = nearest;
  }
  sheet.getRange(rnum, col['outTime'], 1, 1).setValue(timeStr);
  sheet.getRange(rnum, col['workMinutes'], 1, 1).setValue(workMins);
  sheet.getRange(rnum, col['outLat'], 1, 1).setValue(outLat);
  sheet.getRange(rnum, col['outLng'], 1, 1).setValue(outLng);
  sheet.getRange(rnum, col['outDistM'], 1, 1).setValue(outDistM);
  delete _rowCache[_sheetKey(_openAttDb(dateStr.slice(0, 4)), sheet.getName())];
  _audit(boot.user.userId, 'att.checkout', 'Attendance', dateStr + ':' + empId, {}, { time: timeStr, workMins: workMins });
  return _result(true, { date: dateStr, outTime: timeStr, workMinutes: workMins });
}
function timeToMinutes(t) { var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1]); }

// ---------- Mark on behalf (supervisor) ----------

function att_markothers_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'attendance.markothers', 'company')) throw _error(ERR.FORBIDDEN, 'Cannot mark attendance for others.');
  var empId = payload.empId;
  var status = payload.status || 'Present';
  var code = payload.code || 'P';
  var dateStr = payload.date || _todayStr();
  var reason = payload.reason || '';
  var sheet = _attSheet(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)));
  var rows = _readSheet(_openAttDb(dateStr.slice(0, 4)), sheet.getName()).rows;
  var rnum = -1, rowIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date === dateStr && rows[i].empId === empId) { rnum = i + 2; rowIdx = i; break; }
  }
  var now = new Date(); var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
  var row = [dateStr, empId, status, code, timeStr, '', 0, 0, 0, '', '', -1, '', '', -1, 0, '', 'supervisor', '1', reason, boot.user.userId, now, '0'];
  if (rnum > 0) {
    sheet.getRange(rnum, 3, 1, 1).setValue(status);
    sheet.getRange(rnum, 4, 1, 1).setValue(code);
    sheet.getRange(rnum, 15, 1, 1).setValue('supervisor');
    sheet.getRange(rnum, 16, 1, 1).setValue('1');
    sheet.getRange(rnum, 17, 1, 1).setValue(reason);
    sheet.getRange(rnum, 18, 1, 1).setValue(boot.user.userId);
    sheet.getRange(rnum, 19, 1, 1).setValue(now);
    delete _rowCache[_sheetKey(_openAttDb(dateStr.slice(0, 4)), sheet.getName())];
  } else {
    _appendRows(sheet, [row]);
    delete _rowCache[_sheetKey(_openAttDb(dateStr.slice(0, 4)), sheet.getName())];
  }
  _notify(empId, 'Your attendance for ' + dateStr + ' was marked by your supervisor.', 'attendance');
  _flushNotifications();
  return _result(true, { empId: empId, status: status, date: dateStr });
}

// ---------- Live board (today) ----------

function att_liveboard_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'attendance.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var dateStr = payload.date || _todayStr();
  var year = Number(dateStr.slice(0, 4)), month = Number(dateStr.slice(5, 7));
  var sheet = _attSheet(year, month);
  var rows = _readSheet(_openAttDb(year), sheet.getName()).rows.filter(function (r) { return r.date === dateStr && r.deleted !== '1'; });
  var scope = _userScope(boot.user);
  rows = _scopeFilterEmployees(rows, boot.user, scope);
  var empMap = {};
  _readSheet(_openCoreDb(), 'Employees').rows.forEach(function (e) { empMap[e.empId] = e; });
  var out = rows.map(function (r) {
    var e = empMap[r.empId] || {};
    return { empId: r.empId, empCode: e.empCode || '', name: e.name || '', code: r.code || 'X', status: r.status, inTime: r.inTime || '—', outTime: r.outTime || '—', workMins: Number(r.workMinutes || 0), lateMins: Number(r.lateMins || 0), flag: r.flag === '1', flagReason: r.flagReason || '', branch: e.branchId || '', department: e.departmentId || '' };
  });
  var summary = { present: 0, late: 0, absent: 0, leave: 0, notMarked: 0, flagged: 0 };
  out.forEach(function (o) {
    if (o.code === 'P') summary.present++; else if (o.code === 'L') summary.late++; else if (o.code === 'V' || o.code === 'U') summary.leave++; else if (o.code === 'A') summary.absent++;
    if (o.flag) summary.flagged++;
  });
  return _result(true, { date: dateStr, rows: out, summary: summary });
}

// ---------- Muster roll (month) ----------

function att_muster_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'attendance.view', 'company')) throw _error(ERR.FORBIDDEN, 'Not allowed.');
  var ym = payload.month || _todayStr().slice(0, 7);
  var year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
  var sheet = _attSheet(year, month);
  var rows = _readSheet(_openAttDb(year), sheet.getName()).rows.filter(function (r) { return String(r.date).slice(0, 7) === ym && r.deleted !== '1'; });
  var scope = _userScope(boot.user);
  var empIds = rows.map(function (r) { return r.empId; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
  var empMap = {};
  _readSheet(_openCoreDb(), 'Employees').rows.forEach(function (e) { empMap[e.empId] = e; });
  var days = [];
  var d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) { days.push(Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd')); d.setDate(d.getDate() + 1); }
  var grid = {};
  empIds.forEach(function (eid) { grid[eid] = {}; });
  rows.forEach(function (r) { grid[r.empId][r.date] = r; });
  var out = [];
  empIds.forEach(function (eid) {
    var e = empMap[eid] || {};
    if (!_inScopeEmp(e, boot.user, scope)) return;
    var dayRow = [];
    days.forEach(function (ds) { dayRow.push(grid[eid][ds] || { code: '-', date: ds }); });
    out.push({ empId: eid, empCode: e.empCode || '', name: e.name || '', days: dayRow });
  });
  return _result(true, { month: ym, days: days, rows: out });
}
function _inScopeEmp(emp, user, scope) {
  if (scope === 'C') return true;
  if (scope === 'B') return emp.branchId === _getUserBranch(user);
  if (scope === 'P') return emp.departmentId === _getUserDept(user);
  if (scope === 'T') return _teamMemberIds(user.userId).indexOf(emp.empId) >= 0;
  if (scope === 'D') return emp.managerId === user.userId;
  return emp.empId === _findEmployeeByUserId(user.userId);
}

// ---------- Month lock ----------

function att_lock_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'attendance.lock', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  var ym = payload.month || _todayStr().slice(0, 7);
  _setProp('ATT.LOCK.' + ym, '1');
  _audit(boot.user.userId, 'att.lock', 'Settings', 'ATT.LOCK.' + ym, {}, { month: ym });
  return _result(true, { month: ym, locked: true });
}
function att_unlock_(payload) {
  var boot = _boot(payload.token);
  if (!boot.loggedIn || !_can(boot.user, 'attendance.lock', 'company')) throw _error(ERR.FORBIDDEN, 'HR only.');
  var ym = payload.month || _todayStr().slice(0, 7);
  _setProp('ATT.LOCK.' + ym, '0');
  _audit(boot.user.userId, 'att.unlock', 'Settings', 'ATT.LOCK.' + ym, {}, { month: ym });
  return _result(true, { month: ym, locked: false });
}

// ---------- Auto check-out (nightly cron) ----------

function cron_autocheckout_() {
  var dateStr = _todayStr();
  var year = Number(dateStr.slice(0, 4)), month = Number(dateStr.slice(5, 7));
  var sheet = _attSheet(year, month);
  var rows = _readSheet(_openAttDb(year), sheet.getName()).rows;
  var hdrs = _readSheet(_openAttDb(year), sheet.getName()).headers;
  var col = {}; hdrs.forEach(function (h, j) { col[h] = j + 1; });
  var now = new Date();
  var endStr = '18:00'; // default shift end; ideally per shift
  var endM = Number(endStr.slice(0, 2)) * 60 + Number(endStr.slice(3, 5));
  var curM = now.getHours() * 60 + now.getMinutes();
  if (curM <= endM) return;
  var count = 0;
  rows.forEach(function (r, i) {
    if (r.inTime && !r.outTime && r.deleted !== '1') {
      sheet.getRange(i + 2, col['outTime'], 1, 1).setValue(Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss'));
      sheet.getRange(i + 2, col['status'], 1, 1).setValue('Present');
      count++;
    }
  });
  if (count) { delete _rowCache[_sheetKey(_openAttDb(year), sheet.getName())]; _audit('system', 'att.autocheckout', 'Attendance', dateStr, {}, { count: count }); _flushAudit(); }
  return { autoCheckedOut: count };
}
