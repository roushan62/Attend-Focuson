/**
 * ============================================================================
 * SiteAttend — Google Apps Script backend  (the sheet IS the database)
 * ============================================================================
 * Ye script aapki Google Sheet ke upar ek chhota REST-jaisa API layer deti hai.
 * Is route me GOOGLE CLOUD PROJECT, SERVICE ACCOUNT ya JSON KEY ki zaroorat
 * NAHI hai — bas sheet + ye script. App (Next.js) isi URL ko call karta hai.
 *
 * SETUP (once, ~10 min):
 *  1. Apni Google Sheet kholo (naam: AttendanceDB) → Extensions ▸ Apps Script
 *  2. Editor me jo bhi default code hai hata ke ye POORI file paste karo.
 *  3. Neeche SECRET me ek lamba random string daalo (e.g. openssl rand -hex 32
 *     ya password generator se). YEHI string app ke .env me APPS_SCRIPT_SECRET
 *     banega — same hona chahiye.
 *  4. Function selector me `setupDatabase` chuno → ▶ Run → permissions maange
 *     to Allow (warning aaye to: Advanced → Go to project → Allow).
 *     → 5 tabs (Companies, Users, Projects, Attendance, Requests) headers,
 *       dropdown validations aur text-format ke saath ban/fix jaayenge.
 *  5. Deploy ▸ New deployment ▸ Type: Web app
 *       Description: siteattend-v1
 *       Execute as: Me
 *       Who has access: Anyone
 *     → Deploy → URL copy karo (https://script.google.com/macros/s/.../exec)
 *  6. App ke .env.local (aur Vercel env) me:
 *       APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec
 *       APPS_SCRIPT_SECRET=jo-upar-daala
 *  Bas. App ab live Google Sheet use karegi. Register page se pehla admin
 *  banao → Companies/Users rows apne aap sheet me aa jaayenge.
 *
 * SECURITY NOTE: /exec URL + secret = database ka master key. Ye URL kabhi
 * public mat karo (GitHub, chat groups). Leak ho to Deploy ▸ Manage
 * Deployments → delete karke naya deploy karo (naya URL) aur secret badlo.
 * Real per-user login/auth app side pe hai (bcrypt + session) — sheet tak
 * sirf app pahunchti hai, users ko kabhi URL nahi milta.
 *
 * HTTP contract (used by lib/db/appsscript.ts):
 *   GET {exec}?payload={"secret":..,"action":"list","tab":"Users"}
 *   GET {exec}?payload={"secret":..,"action":"insert","tab":"..","row":{..}}
 *   GET {exec}?payload={"secret":..,"action":"update","tab":"..","id":"..","patch":{..}}
 *   GET {exec}?payload={"secret":..,"action":"remove","tab":"..","id":".."}
 *   → {"ok":true,"data":...} | {"ok":false,"error":"..."}
 * (GET is used on purpose — Apps Script redirects POSTs and browsers/Node
 *  silently drop the body; query params survive redirects.)
 * ============================================================================
 */

var SECRET = 'CHANGE_ME_LONG_RANDOM_STRING';

var HEADERS = {
  Companies: ["id", "name", "cutoff_time", "default_radius_m", "timezone", "created_at"],
  Users: ["id", "company_id", "name", "phone", "password_hash", "role",
    "current_project_id", "daily_wage", "status", "created_at"],
  Projects: ["id", "company_id", "name", "address", "latitude", "longitude",
    "radius_m", "start_date", "end_date", "status"],
  Attendance: ["id", "company_id", "employee_id", "project_id", "date",
    "check_in_time", "check_in_lat", "check_in_lng", "check_in_distance_m",
    "check_out_time", "check_out_lat", "check_out_lng", "check_out_distance_m",
    "status", "remarks", "approved_by"],
  Requests: ["id", "company_id", "employee_id", "type", "reason", "from_date",
    "to_date", "project_id", "attendance_id", "status", "review_note",
    "reviewed_by", "reviewed_at", "created_at"],
};

var TAB_NAMES = ["Companies", "Users", "Projects", "Attendance", "Requests"];

var DATE_COLS = { date: 1, from_date: 1, to_date: 1, start_date: 1, end_date: 1 };

var DROPDOWNS = {
  'Users!F': "admin,hr,employee",              // role
  'Users!I': "active,inactive",                // status
  'Projects!J': "active,inactive",              // status
  'Attendance!N': "present,late,half_day,on_duty,leave,absent,late_pending,outside_pending,visit_pending", // status
  'Requests!D': "late,out_of_radius,site_visit,leave,half_day,on_duty", // type
  'Requests!J': "pending,approved,rejected",   // status
};

/* ------------------------------ HTTP entry ------------------------------ */

function doGet(e) {
  var out;
  try {
    out = handle_(JSON.parse((e && e.parameter && e.parameter.payload) || '{}'));
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

function doPost(e) {
  // convenience: some tools prefer POST; same contract, body = JSON
  var out;
  try {
    var body = (e && e.postData && e.postData.contents) || (e && e.parameter && e.parameter.payload) || '{}';
    out = handle_(JSON.parse(body));
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

function handle_(p) {
  if (!SECRET || p.secret !== SECRET) return { ok: false, error: 'invalid or missing secret' };
  if (TAB_NAMES.indexOf(p.tab) === -1) return { ok: false, error: 'unknown tab: ' + p.tab };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'sheet busy, retry' }; }
  try {
    var sh = sheet_(p.tab);
    var hdr = HEADERS[p.tab];

    if (p.action === 'list')   return { ok: true, data: readRows_(sh, hdr) };
    if (p.action === 'insert') { appendRow_(sh, hdr, p.row || {}); return { ok: true, data: p.row }; }
    if (p.action === 'update') {
      var ok = updateRow_(sh, hdr, p.id, p.patch || {});
      return ok ? { ok: true, data: p.patch } : { ok: false, error: 'row not found: ' + p.id };
    }
    if (p.action === 'remove') return { ok: true, data: removeRow_(sh, hdr, p.id) };
    return { ok: false, error: 'unknown action: ' + p.action };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------ sheet helpers ------------------------------ */

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); ensureHeaders_(sh, HEADERS[name]); }
  return sh;
}

function ensureHeaders_(sh, hdr) {
  var first = sh.getRange(1, 1, 1, hdr.length).getDisplayValues()[0];
  var empty = first.every(function (v) { return v === ''; });
  if (empty) {
    sh.getRange(1, 1, 1, hdr.length).setNumberFormat('@').setValues([hdr])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    var want = hdr.join('|'), got = first.join('|');
    if (want !== got) throw new Error('Header row of "' + sh.getName() + '" does not match expected columns:\nwant: ' + want + '\ngot:  ' + got);
  }
}

function readRows_(sh, hdr) {
  ensureHeaders_(sh, hdr);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = sh.getParent().getSpreadsheetTimeZone();
  var values = sh.getRange(2, 1, last - 1, hdr.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = {};
    var nonEmpty = false;
    for (var j = 0; j < hdr.length; j++) {
      var v = values[i][j];
      if (v instanceof Date) {
        v = DATE_COLS[hdr[j]]
          ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
          : v.toISOString();
      }
      v = (v === null || v === undefined) ? '' : String(v);
      row[hdr[j]] = v;
      if (v !== '') nonEmpty = true;
    }
    if (nonEmpty && row.id !== '') rows.push(row);
  }
  return rows;
}

function appendRow_(sh, hdr, row) {
  ensureHeaders_(sh, hdr);
  var vals = hdr.map(function (h) {
    var v = row[h];
    return (v === null || v === undefined) ? '' : String(v);
  });
  var n = sh.getLastRow() + 1;
  sh.getRange(n, 1, 1, hdr.length).setNumberFormat('@').setValues([vals]);
}

function findRowNumber_(sh, hdr, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var i = Math.max(0, hdr.indexOf('id'));
  var col = sh.getRange(2, i + 1, last - 1, 1).getDisplayValues();
  for (var r = 0; r < col.length; r++) {
    if (String(col[r][0]) === String(id)) return r + 2;
  }
  return -1;
}

function updateRow_(sh, hdr, id, patch) {
  ensureHeaders_(sh, hdr);
  var n = findRowNumber_(sh, hdr, id);
  if (n === -1) return false;
  var cur = sh.getRange(n, 1, 1, hdr.length).getValues()[0];
  for (var j = 0; j < hdr.length; j++) {
    var k = hdr[j];
    if (patch[k] !== undefined && patch[k] !== null) cur[j] = String(patch[k]);
  }
  sh.getRange(n, 1, 1, hdr.length).setNumberFormat('@').setValues([cur]);
  return true;
}

function removeRow_(sh, hdr, id) {
  var n = findRowNumber_(sh, hdr, id);
  if (n === -1) return false;
  sh.deleteRow(n);
  return true;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ------------------------------ one-time setup ------------------------------ */

/** Run ONCE from the editor (function dropdown → setupDatabase → ▶).
 *  Creates all tabs if missing, fixes headers, applies text formatting,
 *  freezes header rows and adds dropdown validations. Idempotent. */
function setupDatabase() {
  TAB_NAMES.forEach(function (name) {
    sheet_(name); // creates tab + headers if missing
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    sh.getRange('A1:AZ5000').setNumberFormat('@');
    sh.setColumnWidth(1, 150); // id column readable
  });
  Object.keys(DROPDOWNS).forEach(function (key) {
    try {
      var parts = key.split('!');
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(parts[0]);
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(DROPDOWNS[key].split(','), true)
        .setAllowInvalid(false).build();
      sh.getRange(parts[1] + '2:' + parts[1] + '2000').setValidation(rule);
    } catch (e) { Logger.log('dropdown skip ' + key + ': ' + e); }
  });
  // remove the default empty "Sheet1" if it's still around and empty
  var def = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(def);
  Logger.log('✅ AttendanceDB ready: ' + TAB_NAMES.join(', '));
}

/** Optional: daily email of pending approvals to the sheet owner.
 *  Triggers ▸ Add trigger ▸ sendPendingDigest ▸ Time-driven ▸ day timer 9am */
function sendPendingDigest() {
  var users = readRows_(sheet_('Users'), HEADERS.Users);
  var reqs = readRows_(sheet_('Requests'), HEADERS.Requests).filter(function (r) {
    return r.status === 'pending';
  });
  if (reqs.length === 0) return;
  var byId = {};
  users.forEach(function (u) { byId[u.id] = u; });
  var lines = reqs.map(function (r) {
    var e = byId[r.employee_id] || { name: '?' };
    return '• ' + e.name + ' — ' + r.type + ' (' + r.from_date +
      (r.to_date !== r.from_date ? '→' + r.to_date : '') + '): ' + r.reason;
  });
  MailApp.sendEmail({
    to: Session.getEffectiveUser(),
    subject: 'SiteAttend: ' + reqs.length + ' pending approval(s)',
    body: 'SiteAttend pending requests:\n\n' + lines.join('\n') +
      '\n\nApprove/reject in the app (Admin → Approvals).',
  });
}
