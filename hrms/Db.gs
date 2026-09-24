/**
 * ============================================================================
 *  FocusHR  —  Db.gs
 *  The only place that talks to Google Sheets.
 *  • one master spreadsheet (platform) + one spreadsheet per company
 *  • header caching, in-execution row caching, batch reads/writes
 *  • soft delete only, audit columns maintained automatically
 *  • LockService + Counters table for gap-free human readable IDs
 * ============================================================================
 */

var PROPS = {
  master: 'MASTER_SHEET_ID',
  driveRoot: 'DRIVE_ROOT_FOLDER_ID',
  setupAt: 'SETUP_AT',
  superEmail: 'SUPER_ADMIN_EMAIL'
};

function props_() { return PropertiesService.getScriptProperties(); }
function prop_(key, def) {
  var v = props_().getProperty(key);
  return v === null || v === '' ? (def === undefined ? '' : def) : v;
}
function setProp_(key, value) { props_().setProperty(key, txt_(value)); }

function masterSheetId_() {
  var id = prop_(PROPS.master);
  if (!id) fail_('SETUP_REQUIRED', 'FocusHR is not set up yet. Run setupSystem() once from the Apps Script editor.');
  return id;
}
function masterSs_() {
  var cached = memoGet_('__masterSs');
  if (cached) return cached;
  return memoSet_('__masterSs', SpreadsheetApp.openById(masterSheetId_()));
}
function masterCtx_() {
  return memoSet_('__masterCtx', { scope: 'MASTER', ss: masterSs_(), companyId: '' }) || memoGet_('__masterCtx');
}

/* ----------------------------------------------------------- company ctx -- */
function companyRow_(companyId) {
  if (!companyId) return null;
  return Db.find(masterCtx_(), 'Companies', 'company_id', companyId);
}

/**
 * Build (and memoise) the tenant context for a company id.
 * @param {string} companyId
 * @param {object=} opts {requireActive:boolean}
 */
function companyCtx_(companyId, opts) {
  var o = opts || {};
  if (!companyId) fail_('BAD_REQUEST', 'Company id is missing.');
  var key = '__ctx_' + companyId;
  var ctx = memoGet_(key);
  if (!ctx) {
    var row = companyRow_(companyId);
    if (!row) fail_('NOT_FOUND', 'Company account not found.');
    if (!row.spreadsheet_id) fail_('NOT_READY', 'This company workspace is still being created. Please try again in a minute.');
    ctx = {
      scope: 'COMPANY',
      companyId: companyId,
      company: row,
      ss: SpreadsheetApp.openById(row.spreadsheet_id)
    };
    memoSet_(key, ctx);
  }
  if (o.requireActive !== false) {
    var status = txt_(ctx.company.status).toUpperCase();
    if (status === 'PENDING') fail_('COMPANY_PENDING', 'Your company registration is awaiting verification. You will be able to log in once our team approves it.');
    if (status === 'SUSPENDED') fail_('COMPANY_SUSPENDED', 'This company account is currently suspended. Please contact support.');
    if (status === 'REJECTED') fail_('COMPANY_REJECTED', 'This company registration was not approved. Please contact support.');
  }
  return ctx;
}

/* ------------------------------------------------------------- tables ---- */
function headers_(table) {
  var s = SCHEMA[table];
  if (!s) fail_('CONFIG', 'Unknown table: ' + table);
  var cached = memoGet_('__hd_' + table);
  if (cached) return cached;
  return memoSet_('__hd_' + table, s.cols.concat(AUD_COLS));
}

function ensureTable_(ctx, table) {
  var key = '__sh_' + ctx.scope + '_' + (ctx.companyId || 'master') + '_' + table;
  var cached = memoGet_(key);
  if (cached) return cached;
  var sheet = ctx.ss.getSheetByName(table);
  var wanted = headers_(table);
  if (!sheet) {
    sheet = ctx.ss.insertSheet(table);
    sheet.appendRow(wanted);
    sheet.setFrozenRows(1);
    return memoSet_(key, sheet);
  }
  var lastRow = sheet.getLastRow();
  var existing = lastRow > 0 ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(txt_) : [];
  var needs = existing.length !== wanted.length;
  if (!needs) {
    for (var i = 0; i < wanted.length; i++) { if (existing[i] !== wanted[i]) { needs = true; break; } }
  }
  if (needs) {
    // Re-write the header row, keeping any custom columns the tenant added at the end.
    var extras = existing.slice(wanted.length).filter(function (h) { return h && wanted.indexOf(h) < 0; });
    sheet.getRange(1, 1, 1, wanted.length + extras.length).setValues([wanted.concat(extras)]);
    memoDrop_('__hd_' + table);
  }
  if (sheet.getLastRow() < 1) sheet.appendRow(wanted);
  if (lastRow === 0) sheet.appendRow(wanted);
  if (sheet.getLastRow() > 0) sheet.setFrozenRows(1);
  return memoSet_(key, sheet);
}

/** Create every table of a scope (used by setup / provisioning). */
function createAllTables_(ctx) {
  var created = [];
  Object.keys(SCHEMA).forEach(function (t) {
    // AuditLog lives in every workspace: company-side history stays in the
    // company sheet so an admin can review it even if the platform sheet moves.
    if (SCHEMA[t].scope !== ctx.scope && t !== 'AuditLog') return;
    var before = ctx.ss.getSheetByName(t);
    ensureTable_(ctx, t);
    if (!before) created.push(t);
  });
  // remove the default blank sheet created with a new spreadsheet
  var blank = ctx.ss.getSheetByName('Sheet1');
  if (blank && ctx.ss.getSheets().length > 1) ctx.ss.deleteSheet(blank);
  return created;
}

/* --------------------------------------------------------------- reads --- */
function sheetValues_(ctx, table) {
  var key = '__vals_' + ctx.scope + '_' + (ctx.companyId || 'master') + '_' + table;
  var cached = memoGet_(key);
  if (cached) return cached;
  var sheet = ensureTable_(ctx, table);
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  var values = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, 1)).getValues();
  var header = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0].map(txt_);
  var bundle = { header: header, values: values };
  return memoSet_(key, bundle);
}

function decodeRow_(header, values, rowNumber) {
  var obj = { __row: rowNumber };
  for (var i = 0; i < header.length; i++) { if (header[i]) obj[header[i]] = values[i] === undefined ? '' : values[i]; }
  return obj;
}

/** All rows of a table (deleted rows excluded unless asked for). */
function rows_(ctx, table, opts) {
  var o = opts || {};
  var bundle = sheetValues_(ctx, table);
  var out = [];
  for (var i = 0; i < bundle.values.length; i++) {
    var rec = decodeRow_(bundle.header, bundle.values[i], i + 2);
    if (!o.includeDeleted && boolVal_(rec.is_deleted)) continue;
    out.push(rec);
  }
  return out;
}

/* ---------------------------------------------------------- generic API -- */
var Db = {
  ctx: function (ctx, table) { return ensureTable_(ctx, table); },

  all: function (ctx, table, filter) {
    var list = rows_(ctx, table);
    return filter ? list.filter(filter) : list;
  },

  find: function (ctx, table, pk, value) {
    var list = rows_(ctx, table);
    for (var i = 0; i < list.length; i++) if (txt_(list[i][pk]) === txt_(value)) return list[i];
    return null;
  },

  findOne: function (ctx, table, predicate) {
    var list = rows_(ctx, table);
    for (var i = 0; i < list.length; i++) if (predicate(list[i])) return list[i];
    return null;
  },

  where: function (ctx, table, predicate) { return rows_(ctx, table).filter(predicate); },

  count: function (ctx, table, filter) { return Db.all(ctx, table, filter).length; },

  get: function (ctx, table, pk, value) {
    var row = Db.find(ctx, table, pk, value);
    if (!row) fail_('NOT_FOUND', 'Record not found.', { table: table, id: value });
    return row;
  },

  /**
   * List rows as a paged result.
   * @param {object} o {search, searchCols, filter(fn), sort, dir, page, pageSize, mapper(fn), includeDeleted}
   */
  query: function (ctx, table, o) {
    var opts = o || {};
    var list = rows_(ctx, table, { includeDeleted: opts.includeDeleted });
    if (opts.filter) list = list.filter(opts.filter);
    if (opts.search) list = list.filter(function (r) {
      return matchesSearch_(r, opts.searchCols || SCHEMA[table].search || [], opts.search);
    });
    if (opts.sort) list = sortRows_(list, opts.sort, opts.dir);
    var page = paginate_(list, opts.page, opts.pageSize);
    if (opts.mapper) page.rows = page.rows.map(opts.mapper);
    return page;
  },

  insert: function (ctx, table, obj, o) {
    var opts = o || {};
    var sheet = ensureTable_(ctx, table);
    var header = headers_(table);
    var pk = SCHEMA[table].cols[0];
    var rec = {};
    header.forEach(function (h) { rec[h] = obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
    if (!txt_(rec[pk])) rec[pk] = Db.nextId(ctx, table);
    var stamp = nowIso_();
    var actor = opts.system ? 'SYSTEM' : txt_(opts.actor || (ctx && (ctx.userId || ctx.companyId)) || 'SYSTEM');
    rec.created_at = rec.created_at || stamp;
    rec.created_by = rec.created_by || actor;
    rec.updated_at = stamp;
    rec.updated_by = actor;
    rec.is_deleted = boolVal_(rec.is_deleted) ? 'TRUE' : 'FALSE';
    var values = header.map(function (h) {
      var v = rec[h];
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'number') return v;
      return v === undefined || v === null ? '' : txt_(v);
    });
    sheet.appendRow(values);
    Db.invalidate(ctx, table);
    return rec;
  },

  /**
   * Insert many rows in a single sheet write. Used by the CSV importer and the
   * demo data seeder so a few hundred rows do not cost a few hundred writes.
   */
  insertMany: function (ctx, table, objs, o) {
    var opts = o || {};
    var list = objs || [];
    if (!list.length) return [];
    var sheet = ensureTable_(ctx, table);
    var header = headers_(table);
    var pk = SCHEMA[table].cols[0];
    var stamp = nowIso_();
    var actor = opts.system ? 'SYSTEM' : txt_(opts.actor || (ctx && (ctx.userId || ctx.companyId)) || 'SYSTEM');
    var recs = [];
    var matrix = list.map(function (obj) {
      var rec = {};
      header.forEach(function (h) { rec[h] = obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
      if (!txt_(rec[pk])) rec[pk] = Db.nextId(ctx, table);
      rec.created_at = rec.created_at || stamp;
      rec.created_by = rec.created_by || actor;
      rec.updated_at = stamp;
      rec.updated_by = actor;
      rec.is_deleted = boolVal_(rec.is_deleted) ? 'TRUE' : 'FALSE';
      recs.push(rec);
      return header.map(function (h) {
        var v = rec[h];
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (typeof v === 'number') return v;
        return v === undefined || v === null ? '' : txt_(v);
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, header.length).setValues(matrix);
    Db.invalidate(ctx, table);
    return recs;
  },

  update: function (ctx, table, pk, id, patch, o) {
    var opts = o || {};
    var sheet = ensureTable_(ctx, table);
    var header = headers_(table);
    var current = Db.find(ctx, table, pk, id);
    if (!current) fail_('NOT_FOUND', 'Record not found or already removed.');
    var rec = {};
    header.forEach(function (h) { rec[h] = current[h] === undefined ? '' : current[h]; });
    Object.keys(patch || {}).forEach(function (k) {
      if (header.indexOf(k) >= 0) rec[k] = patch[k] === null || patch[k] === undefined ? '' : patch[k];
    });
    rec.updated_at = nowIso_();
    rec.updated_by = opts.system ? 'SYSTEM' : txt_(opts.actor || ctx.userId || '');
    rec.is_deleted = boolVal_(rec.is_deleted) ? 'TRUE' : 'FALSE';
    var values = header.map(function (h) {
      var v = rec[h];
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'number') return v;
      return v === undefined || v === null ? '' : txt_(v);
    });
    sheet.getRange(current.__row, 1, 1, header.length).setValues([values]);
    Db.invalidate(ctx, table);
    return rec;
  },

  softDelete: function (ctx, table, pk, id, o) {
    var opts = o || {};
    var row = Db.find(ctx, table, pk, id);
    if (!row) fail_('NOT_FOUND', 'Record not found or already removed.');
    Db.update(ctx, table, pk, id, {
      is_deleted: 'TRUE',
      deleted_at: nowIso_(),
      deleted_by: opts.actor || ctx.userId || ''
    }, opts);
    return row;
  },

  restore: function (ctx, table, pk, id, o) {
    return Db.update(ctx, table, pk, id, { is_deleted: 'FALSE', deleted_at: '', deleted_by: '' }, o || {});
  },

  /** Drop cached rows for a table after a write. */
  invalidate: function (ctx, table) {
    memoDrop_('__vals_' + ctx.scope + '_' + (ctx.companyId || 'master') + '_' + table);
  },

  /**
   * Gap-free human readable ID (EMP-0001) backed by the Counters table.
   * Uses a script lock so two people adding employees at the same moment
   * never receive the same number.
   */
  nextId: function (ctx, table) {
    if (table === 'Counters') return uuid_();
    var prefix = ID_PREFIX[table] || 'REC';
    var lock = LockService.getScriptLock();
    try { lock.waitLock(20000); } catch (e) { /* continue: worst case a retry below */ }
    try {
      var key = txt_(prefix) + '::' + table;
      var counter = Db.findOne(ctx, 'Counters', function (r) { return txt_(r.key) === key; });
      var next;
      if (!counter) {
        next = 1;
        Db.insert(ctx, 'Counters', { key: key, prefix: prefix, next_no: next + 1, width: 4, note: table }, { system: true });
      } else {
        next = intVal_(counter.next_no, 1);
        Db.update(ctx, 'Counters', 'key', key, { next_no: next + 1 }, { system: true });
      }
      return prefix + '-' + String(next).padStart(4, '0');
    } finally {
      try { lock.releaseLock(); } catch (e2) { /* noop */ }
    }
  },

  /** Runtime counter used for things like chunk progress (not user visible). */
  bumpCounter: function (ctx, key, by) {
    var row = Db.findOne(ctx, 'Counters', function (r) { return txt_(r.key) === txt_(key); });
    var next = row ? intVal_(row.next_no, 1) : 1;
    if (row) Db.update(ctx, 'Counters', 'key', txt_(key), { next_no: next + numVal_(by, 1) }, { system: true });
    else Db.insert(ctx, 'Counters', { key: txt_(key), prefix: 'CNT', next_no: next + numVal_(by, 1), width: 4, note: 'runtime' }, { system: true });
    return next;
  }
};

/* ------------------------------------------------------------ settings -- */
/**
 * Accepts either a database workspace context ({scope, ss}) or a session
 * context ({scope, companyId, companyCtx}) and returns the workspace that owns
 * the Settings tab, so callers never have to remember which one they hold.
 */
function workspaceCtx_(ctx) {
  if (!ctx) return masterCtx_();
  if (ctx.ss && typeof ctx.ss.getSheetByName === 'function') return ctx;
  if (ctx.companyCtx && ctx.companyCtx.ss) return ctx.companyCtx;
  if (txt_(ctx.companyId)) return companyCtx_(ctx.companyId, { requireActive: false });
  return masterCtx_();
}

function settingRaw_(ctx, key) {
  return Db.findOne(workspaceCtx_(ctx), 'Settings', function (r) { return txt_(r.key) === txt_(key); });
}

function getSetting_(ctx, key, def) {
  var row = settingRaw_(ctx, key);
  if (!row) {
    if (def !== undefined) return def;
    var d = null;
    DEFAULT_SETTINGS.forEach(function (s) { if (s.key === key) d = s.value; });
    return d;
  }
  return txt_(row.value) === '' && def !== undefined ? def : row.value;
}

function getSettingNum_(ctx, key, def) {
  var v = getSetting_(ctx, key);
  return v === null || v === undefined || v === '' ? def : numVal_(v, def);
}
function getSettingBool_(ctx, key, def) {
  var v = getSetting_(ctx, key);
  if (v === null || v === undefined || v === '') return def;
  return boolVal_(v);
}

function setSetting_(ctx, key, value, meta) {
  var m = meta || {};
  var target = workspaceCtx_(ctx);
  var row = settingRaw_(ctx, key);
  var version = row ? intVal_(row.version, 1) + 1 : 1;
  var patch = {
    key: key,
    value: value,
    value_type: m.value_type || (row ? row.value_type : 'string'),
    group_name: m.group_name || (row ? row.group_name : 'General'),
    label: m.label || (row ? row.label : key),
    description: m.description || (row ? row.description : ''),
    effective_from: m.effective_from || todayIso_(),
    version: version
  };
  if (row) return Db.update(target, 'Settings', 'setting_id', row.setting_id, patch, { actor: ctx.userId });
  return Db.insert(target, 'Settings', patch, { actor: ctx.userId });
}

function settingsMap_(ctx) {
  var map = {};
  DEFAULT_SETTINGS.forEach(function (s) { map[s.key] = s.value; });
  Db.all(workspaceCtx_(ctx), 'Settings').forEach(function (r) { map[txt_(r.key)] = r.value; });
  return map;
}
