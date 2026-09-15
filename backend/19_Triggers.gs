/**
 * ============================================================================
 *  FILE: 19_Triggers.gs
 *  ROLE: Time-driven jobs (§12.4, §12.5, §9.12, §9.14) — monthly auto-report,
 *        document expiry alerts, daily attendance close, weather flagging and
 *        GPS retention purge. Plus the trigger installer used by the owner.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Trigger management                                                        */
/* -------------------------------------------------------------------------- */

var TRIGGER_DEFINITIONS = [
  { fn: 'monthlyAutoReport', type: 'MONTHLY', day: 1, hour: 6, description: 'Monthly attendance + payroll report' },
  { fn: 'documentExpiryCheck', type: 'DAILY', hour: 7, description: 'Document expiry alerts (15-day window)' },
  { fn: 'dailyAttendanceClose', type: 'DAILY', hour: 23, description: 'Auto-mark absentees after the day closes' },
  { fn: 'weatherFlagJob', type: 'DAILY', hour: 5, description: 'Weather-aware rain-day flag' },
  { fn: 'purgeOldGpsData', type: 'WEEKLY', day: 7, hour: 3, description: 'GPS retention purge' }
];

function installedTriggers_() {
  try {
    return ScriptApp.getProjectTriggers().map(function (t) {
      return { handler: t.getHandlerFunction(), source: String(t.getTriggerSource()), uniqueId: t.getUniqueId() };
    });
  } catch (e) {
    return [];
  }
}

function installTriggers() {
  var existing = installedTriggers_();
  var installed = [];
  TRIGGER_DEFINITIONS.forEach(function (def) {
    var already = existing.some(function (t) { return t.handler === def.fn; });
    if (already) { installed.push({ fn: def.fn, status: 'already-installed' }); return; }
    try {
      var builder = ScriptApp.newTrigger(def.fn);
      if (def.type === 'MONTHLY') {
        builder.timeBased().onMonthDay(def.day).atHour(def.hour).create();
      } else if (def.type === 'WEEKLY') {
        builder.timeBased().onWeekDay(ScriptApp.WeekDay[weekDayName_(def.day)]).atHour(def.hour).create();
      } else {
        builder.timeBased().atHour(def.hour).everyDays(1).create();
      }
      installed.push({ fn: def.fn, status: 'installed' });
    } catch (e) {
      installed.push({ fn: def.fn, status: 'failed', error: e.message });
    }
  });
  platformAudit_('INSTALL_TRIGGERS', { installed: installed }, 'OK');
  return installed;
}

function weekDayName_(n) {
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][num_(n, 7) % 7] || 'SATURDAY';
}

function removeAllTriggers() {
  var removed = 0;
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      ScriptApp.deleteTrigger(t);
      removed++;
    });
  } catch (e) {
    platformAudit_('REMOVE_TRIGGERS', { error: e.message }, 'ERROR');
  }
  platformAudit_('REMOVE_TRIGGERS', { removed: removed }, 'OK');
  return { removed: removed };
}

function actionInstallTriggers(payload, ctx) {
  assertOwner_(ctx);
  var installed = installTriggers();
  return { installed: installed, triggers: installedTriggers_(), definitions: TRIGGER_DEFINITIONS };
}

function actionRemoveTriggers(payload, ctx) {
  assertOwner_(ctx);
  var res = removeAllTriggers();
  res.triggers = installedTriggers_();
  return res;
}

/* -------------------------------------------------------------------------- */
/*  Helpers to iterate companies safely                                       */
/* -------------------------------------------------------------------------- */

function forEachCompany_(fn) {
  var registry = [];
  try { registry = listCompaniesRaw_(); } catch (e) {
    Logger.log('forEachCompany_: registry unreadable — ' + e.message);
    return { processed: 0, errors: [{ companyId: '', error: e.message }] };
  }
  var processed = 0, errors = [];
  registry.forEach(function (company) {
    if (String(company.Status) !== 'Active') return;
    try {
      var ss = companySpreadsheetById_(company.SheetID);
      fn(company, ss);
      processed++;
    } catch (e) {
      errors.push({ companyId: company.CompanyID, error: e.message });
      Logger.log('Job failed for ' + company.CompanyID + ': ' + e.message);
    }
  });
  return { processed: processed, errors: errors };
}

function superAdminsOf_(ss) {
  return readTable_(ss, 'Users').filter(function (u) {
    return String(u.Role) === ROLES.SUPER_ADMIN && String(u.Status) === 'Active';
  });
}

function adminEmailsOf_(ss, permission) {
  return readTable_(ss, 'Users').filter(function (u) {
    if (String(u.Status) !== 'Active') return false;
    if (!isStaffRole_(u.Role)) return false;
    if (!permission) return true;
    var perms = permissionsFor_(u);
    return perms.__all || perms[permission];
  }).map(function (u) { return u; });
}

/* -------------------------------------------------------------------------- */
/*  §12.4 — Monthly auto report (1st of every month)                          */
/* -------------------------------------------------------------------------- */

function monthlyAutoReport() {
  var month = shiftMonth_(monthKey_(today_()), -1);
  var results = forEachCompany_(function (company, ss) {
    var settings = readSettings_(ss);
    if (String(settings.autoMonthlyReport || 'Y').toUpperCase() === 'N') return;

    var ctx = systemContext_(company, ss, settings);
    var attendanceReport = buildReport_('monthlyAttendance', { month: month }, ctx);
    var payroll = payrollCompute_({ month: month, includeVendorLabour: true }, ctx);

    var admins = superAdminsOf_(ss).concat(adminEmailsOf_(ss, 'viewReports'));
    var seen = {};
    var recipients = admins.filter(function (a) {
      var e = String(a.Email || '').toLowerCase();
      if (!emailOk_(e) || seen[e]) return false;
      seen[e] = true;
      return true;
    }).slice(0, 5);
    var extra = str_(settings.reportRecipients, 200).split(',')
      .map(function (x) { return x.trim().toLowerCase(); })
      .filter(function (x) { return emailOk_(x) && !seen[x]; }).slice(0, 5);
    extra.forEach(function (e) { seen[e] = true; recipients.push({ Email: e, Name: 'Report recipient' }); });

    if (!recipients.length) {
      Logger.log('No report recipients for ' + company.CompanyID);
      return;
    }

    // Build one XLSX containing both sheets and attach it.
    var attachment = null;
    try {
      var temp = SpreadsheetApp.create('SiteTrack-' + company.CompanyName + '-' + month);
      try { temp.setSpreadsheetTimeZone(settings.timezone || platformTimezone_()); } catch (e) { }
      var payrollReport = payrollReport_({ month: month }, ctx);
      renderReportToSpreadsheet_(temp, attendanceReport, ctx, settings);
      var second = temp.insertSheet('Payroll ' + month);
      renderReportToSpreadsheet_({ getSheets: function () { return [second]; } }, payrollReport, ctx, settings);
      var token = ScriptApp.getOAuthToken();
      var url = 'https://docs.google.com/spreadsheets/export?id=' + temp.getId() + '&format=xlsx';
      var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        attachment = res.getBlob().setName('SiteTrack-' + month + '-' + company.CompanyName + '.xlsx');
      }
      try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e2) { }
    } catch (e3) {
      Logger.log('Attachment build failed: ' + e3.message);
    }

    var html = monthlyReportHtml_(company, settings, month, attendanceReport, payroll);
    var plain = 'SiteTrack monthly report for ' + month + '\n\n' +
      'Company: ' + company.CompanyName + '\n' +
      'Attendance rows: ' + attendanceReport.rowCount + '\n' +
      'Employees in payroll: ' + payroll.totals.employees + '\n' +
      'Payable days: ' + payroll.totals.payableDays + '\n' +
      'Overtime hours: ' + payroll.totals.overtimeHours + '\n' +
      'Net payable: ' + (settings.currency || 'INR') + ' ' + payroll.totals.netPayable + '\n' +
      'Flagged days awaiting review: ' + payroll.totals.flaggedDays + '\n\n' +
      'Sign in to SiteTrack for the interactive version.';

    recipients.forEach(function (r) {
      var opts = { attachments: attachment ? [attachment] : [] };
      sendEmailHtml_(r.Email, 'SiteTrack monthly report — ' + month + ' — ' + company.CompanyName, html, plain);
      Logger.log('monthly report → ' + r.Email + ' (attachment: ' + (attachment ? 'yes' : 'no') + ') ' + jsonString_(opts));
    });

    // Drop the same summary into the in-app inbox.
    admins.slice(0, 8).forEach(function (a) {
      notify_(ss, a.UserID, 'Monthly report ready — ' + month,
        'Attendance: ' + attendanceReport.rowCount + ' records. Payroll net payable: ' +
        (settings.currency || 'INR') + ' ' + payroll.totals.netPayable +
        '. Flagged days awaiting review: ' + payroll.totals.flaggedDays + '.', 'Report', 'Normal');
    });

    audit_(ss, ctx, 'MONTHLY_AUTO_REPORT', 'Reports', month,
      { recipients: recipients.length, rows: attendanceReport.rowCount, net: payroll.totals.netPayable }, 'OK');
  });

  platformAudit_('MONTHLY_AUTO_REPORT', { month: month, companies: results.processed, errors: results.errors.length }, 'OK');
  return { month: month, companies: results.processed, errors: results.errors };
}

function monthlyReportHtml_(company, settings, month, attendanceReport, payroll) {
  var cur = settings.currency || 'INR';
  var top = payroll.rows.slice(0, 15);
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:760px">',
    '<h2 style="margin:0 0 4px">SiteTrack monthly report — ' + month + '</h2>',
    '<p style="margin:0 0 18px;color:#475569">' + company.CompanyName + ' · ' +
    (settings.companyAddress || '') + '</p>',
    '<table style="border-collapse:collapse;width:100%;margin-bottom:20px">',
    metricCell_('Attendance records', attendanceReport.rowCount),
    metricCell_('Employees paid', payroll.totals.employees),
    metricCell_('Payable days', payroll.totals.payableDays),
    metricCell_('Overtime hours', payroll.totals.overtimeHours),
    metricCell_('Net payable', cur + ' ' + payroll.totals.netPayable),
    metricCell_('Flagged days', payroll.totals.flaggedDays),
    '</table>',
    top.length ? '<h3 style="margin:0 0 8px">Top of wage sheet</h3>' : '',
    top.length ? '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
      '<tr style="background:#f1f5f9"><th style="padding:6px;text-align:left">Employee</th>' +
      '<th style="padding:6px">Payable days</th><th style="padding:6px">OT h</th>' +
      '<th style="padding:6px;text-align:right">Net payable</th></tr>' +
      top.map(function (r) {
        return '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:6px">' + r.name +
          '</td><td style="padding:6px;text-align:center">' + r.payableDays +
          '</td><td style="padding:6px;text-align:center">' + r.overtimeHours +
          '</td><td style="padding:6px;text-align:right">' + cur + ' ' + r.netPayable + '</td></tr>';
      }).join('') + '</table>' : '',
    '<p style="margin-top:20px;color:#64748b;font-size:12px">' +
    (settings.reportFooterText || '') + '</p></div>'
  ].join('');
}

function metricCell_(label, value) {
  return '<td style="border:1px solid #e2e8f0;padding:10px;width:33%">' +
    '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">' + label +
    '</div><div style="font-size:18px;font-weight:600">' + value + '</div></td>';
}

/* -------------------------------------------------------------------------- */
/*  §12.5 — Document expiry check (daily)                                     */
/* -------------------------------------------------------------------------- */

function documentExpiryCheck() {
  var windowDays = 15;
  var results = forEachCompany_(function (company, ss) {
    var settings = readSettings_(ss);
    var ctx = systemContext_(company, ss, settings);
    var docs = readTable_(ss, 'Documents');
    var alerted = 0;

    docs.forEach(function (d) {
      if (!d.ExpiryDate) return;
      var days = Math.ceil((toDate_(d.ExpiryDate).getTime() - Date.now()) / 86400000);
      var status = days < 0 ? 'Expired' : (days <= num_(d.ExpiryAlertDays || windowDays, windowDays) ? 'ExpiringSoon' : 'Valid');
      if (String(d.Status) !== status) {
        updateRecord_(ss, 'Documents', 'DocID', d.DocID, { Status: status });
      }
      if (status === 'Valid') return;
      if (String(d.AlertSentAt) === today_(ctx.tz)) return; // one alert per day per document

      var user = findRecord_(ss, 'Users', 'UserID', d.UserID) || {};
      var message = (user.Name || d.UserID) + ' — ' + d.DocType +
        (status === 'Expired' ? ' EXPIRED on ' + d.ExpiryDate : ' expires on ' + d.ExpiryDate + ' (' + days + ' days)');

      adminEmailsOf_(ss, 'manageDocuments').slice(0, 6).forEach(function (a) {
        notify_(ss, a.UserID, status === 'Expired' ? 'Document expired' : 'Document expiring soon',
          message + '. Upload the renewed copy to keep the site compliant.', 'Expiry', 'High');
        if (emailOk_(a.Email)) {
          sendEmail_(a.Email, 'SiteTrack document alert — ' + company.CompanyName,
            message + '\n\nCompany: ' + company.CompanyName + '\nEmployee ID: ' + d.UserID +
            '\nDocument type: ' + d.DocType + '\nExpiry date: ' + d.ExpiryDate +
            '\n\nOpen SiteTrack → Employees → Documents to upload the renewed copy.');
        }
      });
      notify_(ss, d.UserID, status === 'Expired' ? 'Document expired' : 'Document expiring soon',
        'Your ' + d.DocType + (status === 'Expired' ? ' expired on ' : ' expires on ') + d.ExpiryDate +
        '. Please submit a renewed copy to your site office.', 'Expiry', 'High');

      updateRecord_(ss, 'Documents', 'DocID', d.DocID, { AlertSentAt: fmtDateTime_(new Date()) });
      alerted++;
    });

    if (alerted) audit_(ss, ctx, 'DOC_EXPIRY_CHECK', 'Documents', today_(ctx.tz), { alerts: alerted }, 'OK');
  });
  platformAudit_('DOCUMENT_EXPIRY_CHECK', { companies: results.processed }, 'OK');
  return results;
}

/* -------------------------------------------------------------------------- */
/*  Daily attendance close (auto-absent) + weather flag                       */
/* -------------------------------------------------------------------------- */

function dailyAttendanceClose() {
  var results = forEachCompany_(function (company, ss) {
    var settings = readSettings_(ss);
    var tz = settings.timezone || platformTimezone_();
    var dateStr = today_(tz);
    var hour = Number(Utilities.formatDate(new Date(), tz, 'HH'));
    if (hour < 21) { Logger.log('dailyAttendanceClose skipped at ' + hour + ':00'); }

    var holidays = readTable_(ss, 'Holidays');
    var projects = readTable_(ss, 'Projects').filter(function (p) { return String(p.Status) === 'Active'; });
    var assignments = readTable_(ss, 'ProjectAssignments').filter(function (a) { return String(a.Status) === 'Active'; });
    var marks = readTable_(ss, 'Attendance').filter(function (a) { return String(a.Date) === dateStr; });
    var markedKeys = {};
    marks.forEach(function (m) { markedKeys[String(m.UserID) + '|' + String(m.ProjectID)] = true; });
    var users = indexBy_(readTable_(ss, 'Users'), 'UserID');
    var ctx = systemContext_(company, ss, settings);
    var created = 0;

    assignments.forEach(function (a) {
      var project = null;
      projects.forEach(function (p) { if (String(p.ProjectID) === String(a.ProjectID)) project = p; });
      if (!project) return;
      var user = users[String(a.UserID)];
      if (!user || String(user.Status) !== 'Active') return;
      if (String(user.Role) === ROLES.SUPER_ADMIN) return;
      if (markedKeys[String(a.UserID) + '|' + String(a.ProjectID)]) return;
      if (!isWorkingDay_(settings, dateStr, holidays, a.ProjectID, user)) {
        // Holiday / week-off — record it so reports show the real reason.
        var holiday = isHolidayFor_(holidays, dateStr, a.ProjectID);
        appendRecord_(ss, 'Attendance', {
          AttendanceID: id_('ATT'), UserID: user.UserID, ProjectID: a.ProjectID, Date: dateStr,
          MarkedAt: fmtDateTime_(new Date(), tz), Status: holiday ? 'Holiday' : 'WeekOff',
          Source: 'System', ReviewNote: holiday ? ('Holiday: ' + holiday.Name) : 'Weekly off',
          CreatedAt: fmtDateTime_(new Date())
        });
        created++;
        return;
      }
      // Leave already covered?
      var onLeave = readTable_(ss, 'LeaveRequests').some(function (l) {
        return String(l.UserID) === String(a.UserID) && String(l.Status) === 'Approved' &&
          l.FromDate <= dateStr && l.ToDate >= dateStr;
      });
      if (onLeave) return;

      appendRecord_(ss, 'Attendance', {
        AttendanceID: id_('ATT'), UserID: user.UserID, ProjectID: a.ProjectID, Date: dateStr,
        MarkedAt: fmtDateTime_(new Date(), tz), Status: 'Absent', Source: 'System',
        ReviewNote: 'Auto-marked absent at day close (no GPS mark received)',
        CreatedAt: fmtDateTime_(new Date())
      });
      created++;
    });

    if (created) {
      audit_(ss, ctx, 'DAILY_ATTENDANCE_CLOSE', 'Attendance', dateStr, { autoRows: created }, 'OK');
      adminEmailsOf_(ss, 'reviewAttendance').slice(0, 5).forEach(function (a2) {
        notify_(ss, a2.UserID, 'Day closed — ' + created + ' auto entries',
          created + ' attendance rows were auto-created for ' + dateStr + ' (absent / holiday / week-off).', 'System');
      });
    }
  });
  platformAudit_('DAILY_ATTENDANCE_CLOSE', { companies: results.processed }, 'OK');
  return results;
}

function weatherFlagJob() {
  var results = forEachCompany_(function (company, ss) {
    var settings = readSettings_(ss);
    if (String(settings.autoRainDayFlag || 'N').toUpperCase() !== 'Y') return;
    var ctx = systemContext_(company, ss, settings);
    var dateStr = today_(ctx.tz);
    var flagged = 0;
    readTable_(ss, 'Projects').filter(function (p) { return String(p.Status) === 'Active'; }).slice(0, 20)
      .forEach(function (p) {
        var w = fetchWeather_(num_(p.Lat, 0), num_(p.Long, 0));
        if (!w) return;
        var flag = w.rainMm >= num_(settings.rainThresholdMm, 20) ? 'RainDay'
          : (w.maxTempC >= num_(settings.heatThresholdC, 45) ? 'ExtremeHeat' : '');
        if (!flag) return;
        readTable_(ss, 'Attendance').forEach(function (m) {
          if (String(m.ProjectID) === String(p.ProjectID) && String(m.Date) === dateStr && !m.WeatherFlag) {
            updateRecord_(ss, 'Attendance', 'AttendanceID', m.AttendanceID, { WeatherFlag: flag });
            flagged++;
          }
        });
      });
    if (flagged) audit_(ss, ctx, 'WEATHER_FLAG_JOB', 'Attendance', dateStr, { marks: flagged }, 'OK');
  });
  platformAudit_('WEATHER_FLAG_JOB', { companies: results.processed }, 'OK');
  return results;
}

/* -------------------------------------------------------------------------- */
/*  GPS retention purge (§10)                                                 */
/* -------------------------------------------------------------------------- */

function purgeOldGpsData() {
  var results = forEachCompany_(function (company, ss) {
    var settings = readSettings_(ss);
    var months = num_(settings.gpsRetentionMonths, 12);
    if (months <= 0) return;
    var cutoff = new Date(Date.now() - months * 30 * 86400000);
    var cutoffStr = fmtDate_(cutoff, settings.timezone || platformTimezone_());
    var ctx = systemContext_(company, ss, settings);
    var purged = 0;
    readTable_(ss, 'Attendance').forEach(function (m) {
      if (String(m.Date) >= cutoffStr) return;
      if (!m.Lat && !m.Long) return;
      updateRecord_(ss, 'Attendance', 'AttendanceID', m.AttendanceID, {
        Lat: '', Long: '', OutLat: '', OutLong: '', AccuracyMeters: '',
        ReviewNote: (m.ReviewNote ? m.ReviewNote + ' | ' : '') + 'Raw GPS purged after ' + months + ' months'
      });
      purged++;
    });
    if (purged) audit_(ss, ctx, 'GPS_PURGE', 'Attendance', cutoffStr, { rows: purged, months: months }, 'OK');
  });
  platformAudit_('GPS_PURGE', { companies: results.processed }, 'OK');
  return results;
}

/* -------------------------------------------------------------------------- */
/*  System context (jobs have no logged-in user)                              */
/* -------------------------------------------------------------------------- */

function systemContext_(company, ss, settings) {
  settings = settings || readSettings_(ss);
  return {
    userId: 'system', userName: 'SiteTrack System', role: ROLES.SUPER_ADMIN,
    companyId: company.CompanyID, company: company, ss: ss, settings: settings,
    tz: settings.timezone || platformTimezone_(),
    permissions: (function () { var o = {}; PERMISSIONS.forEach(function (p) { o[p] = true; }); o.__all = true; return o; })(),
    scope: ['ALL'],
    user: { UserID: 'system', Name: 'SiteTrack System', Role: ROLES.SUPER_ADMIN, ProjectScopeJSON: '["ALL"]' },
    assignedProjectIds: [], meta: { userAgent: 'trigger' }
  };
}
