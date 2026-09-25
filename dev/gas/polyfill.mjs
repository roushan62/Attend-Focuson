/**
 * ============================================================================
 *  dev/gas/polyfill.mjs
 *  Local stand-ins for the Google Apps Script services (SpreadsheetApp,
 *  DriveApp, MailApp, Utilities, UrlFetchApp, CacheService, …) so the EXACT
 *  backend/*.gs code can run in Node for the live preview and the smoke tests.
 *
 *  Data lives in dev/data (gitignored):
 *    sheets/<id>.json   spreadsheet contents
 *    drive/…            folders, file metadata and blobs
 *    properties.json    Script Properties
 *    outbox.json        every e-mail "sent"
 *    fetchlog.json      every outbound HTTP call the backend would make
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const SIGNED = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const UNSIGNED = (arr) => {
  if (typeof arr === 'string') return Buffer.from(arr, 'utf8');
  if (Buffer.isBuffer(arr)) return arr;
  if (arr && typeof arr.length === 'number') return Uint8Array.from(arr, (b) => (b < 0 ? b + 256 : b));
  return Buffer.alloc(0);
};

export function createPolyfill({ dataDir, verbose = false, templateDir = null, serviceUrl = '', contextRef = null }) {
  const DATA = dataDir;
  const SHEETS_DIR = path.join(DATA, 'sheets');
  const DRIVE_DIR = path.join(DATA, 'drive');
  const BLOBS_DIR = path.join(DRIVE_DIR, 'blobs');
  for (const d of [DATA, SHEETS_DIR, DRIVE_DIR, BLOBS_DIR]) fs.mkdirSync(d, { recursive: true });

  const log = (...a) => { if (verbose) console.log('[gas]', ...a); };

  /* ---------------------------------------------------------------- state */
  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1));

  const propertiesFile = path.join(DATA, 'properties.json');
  let properties = readJson(propertiesFile, {});
  const saveProperties = () => writeJson(propertiesFile, properties);

  const outboxFile = path.join(DATA, 'outbox.json');
  const outbox = readJson(outboxFile, []);
  const fetchLogFile = path.join(DATA, 'fetchlog.json');
  const fetchLog = readJson(fetchLogFile, []);

  const cacheStore = new Map(); // key -> {value, expires}

  /* ------------------------------------------------------- spreadsheets */
  const colToNum = (letters) => letters.toUpperCase().split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
  const numToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m - 1) / 26); } return s; };

  const parseA1 = (a1) => {
    const m = String(a1).match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
    if (!m) throw new Error('Bad A1 notation: ' + a1);
    const c1 = colToNum(m[1]), r1 = Number(m[2]);
    const c2 = m[3] ? colToNum(m[3]) : c1;
    const r2 = m[4] ? Number(m[4]) : r1;
    return { row: r1, col: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 };
  };

  class Range {
    constructor(sheet, row, col, rows, cols) {
      this.sheet = sheet; this.row = row; this.col = col; this.rows = rows; this.cols = cols;
    }
    #cell(r, c, create) {
      const values = this.sheet.values;
      while (values.length < r) values.push([]);
      const line = values[r - 1];
      while (line.length < c) line.push('');
      return line;
    }
    getValues() {
      const out = [];
      for (let r = this.row; r < this.row + this.rows; r++) {
        const line = [];
        for (let c = this.col; c < this.col + this.cols; c++) {
          const rowArr = this.sheet.values[r - 1];
          line.push(rowArr && rowArr[c - 1] !== undefined && rowArr[c - 1] !== null ? rowArr[c - 1] : '');
        }
        out.push(line);
      }
      return out;
    }
    setValues(matrix) {
      for (let i = 0; i < matrix.length; i++) {
        const r = this.row + i;
        const line = this.#cell(r, this.col);
        for (let j = 0; j < this.cols; j++) {
          const v = matrix[i] && matrix[i][j] !== undefined ? matrix[i][j] : '';
          line[this.col - 1 + j] = typeof v === 'boolean' ? v : v;
        }
      }
      this.sheet.save();
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    getValue() { return this.getValues()[0][0]; }
    getDisplayValues() { return this.getValues().map((r) => r.map((c) => String(c))); }
    setFontWeight() { return this; }
    setFontSize() { return this; }
    setFontColor() { return this; }
    setBackground() { return this; }
    setHorizontalAlignment() { return this; }
    setNumberFormat() { return this; }
    setDataValidation() { return this; }
    setWrap() { return this; }
    clearContent() {
      for (let r = this.row; r < this.row + this.rows; r++) {
        if (this.sheet.values[r - 1]) {
          for (let c = this.col; c < this.col + this.cols; c++) this.sheet.values[r - 1][c - 1] = '';
        }
      }
      this.sheet.save();
      return this;
    }
    clear() { return this.clearContent(); }
  }

  class Sheet {
    constructor(ss, name, sheetId) {
      this.ss = ss; this.name = name; this.sheetId = sheetId || Math.floor(Math.random() * 1e9);
      this.values = (ss.data.sheets[name] && ss.data.sheets[name].values) || [];
      this.frozenRows = 0;
    }
    save() {
      this.ss.data.sheets[this.name] = { name: this.name, values: this.values, sheetId: this.sheetId };
      this.ss.save();
    }
    getName() { return this.name; }
    setName(n) { const old = this.name; this.name = n; delete this.ss.data.sheets[old]; this.save(); return this; }
    getSheetId() { return this.sheetId; }
    getLastRow() { return this.values.length; }
    getLastColumn() { return this.values.reduce((m, r) => Math.max(m, r.length), 0); }
    getMaxRows() { return Math.max(this.values.length, 1); }
    getMaxColumns() { return Math.max(this.getLastColumn(), 1); }
    getRange(a, b, c, d) {
      if (typeof a === 'string') { const p = parseA1(a); return new Range(this, p.row, p.col, p.rows, p.cols); }
      return new Range(this, a, b, c || 1, d || 1);
    }
    getDataRange() {
      return new Range(this, 1, 1, Math.max(this.values.length, 1), Math.max(this.getLastColumn(), 1));
    }
    appendRow(row) { this.values.push(row.slice()); this.save(); return this; }
    deleteRow(n) { this.values.splice(n - 1, 1); this.save(); return this; }
    deleteRows(n, howMany) { this.values.splice(n - 1, howMany); this.save(); return this; }
    insertRowAfter(n) { this.values.splice(n, 0, []); this.save(); return this; }
    clear() { this.values = []; this.save(); return this; }
    clearContents() { for (let i = 1; i < this.values.length; i++) this.values[i] = []; this.save(); return this; }
    setFrozenRows(n) { this.frozenRows = n; return this; }
    autoResizeColumns() { return this; }
    setConditionalFormatRules() { return this; }
    getConditionalFormatRules() { return []; }
    setColumnWidth() { return this; }
    hideSheet() { return this; }
    activate() { return this; }
  }

  class Spreadsheet {
    constructor(id, name, data) {
      this.id = id; this.name = name;
      this.data = data || { id, name, timezone: 'Asia/Kolkata', sheets: {} };
      this.file = path.join(SHEETS_DIR, id + '.json');
      this.sheetsCache = new Map();
    }
    static load(id) {
      const file = path.join(SHEETS_DIR, id + '.json');
      const data = readJson(file, null);
      if (!data) throw new Error('No spreadsheet with ID: ' + id);
      return new Spreadsheet(id, data.name, data);
    }
    static create(name) {
      const id = 'dev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const ss = new Spreadsheet(id, name);
      // Real Apps Script always creates a spreadsheet with one default sheet.
      ss.data.sheets['Sheet1'] = { name: 'Sheet1', values: [], sheetId: 1 };
      ss.save();
      return ss;
    }
    save() { writeJson(this.file, this.data); }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
    getSpreadsheetUrl() { return this.getUrl(); }
    setSpreadsheetTimeZone(tz) { this.data.timezone = tz; this.save(); return this; }
    getSpreadsheetTimeZone() { return this.data.timezone || 'Asia/Kolkata'; }
    getSheets() {
      return Object.keys(this.data.sheets).map((n) => this.getSheetByName(n)).filter(Boolean);
    }
    getSheetByName(name) {
      if (!this.data.sheets[name]) return null;
      if (!this.sheetsCache.has(name)) {
        this.sheetsCache.set(name, new Sheet(this, name, this.data.sheets[name].sheetId));
      }
      return this.sheetsCache.get(name);
    }
    insertSheet(name) {
      this.data.sheets[name] = { name, values: [], sheetId: Math.floor(Math.random() * 1e9) };
      this.save();
      return this.getSheetByName(name);
    }
    deleteSheet(sheet) { delete this.data.sheets[sheet.getName()]; this.sheetsCache.delete(sheet.getName()); this.save(); return this; }
    getActiveSheet() { return this.getSheets()[0] || null; }
    addViewer(email) { log('addViewer', email); return this; }
    getOwner() { return { getEmail: () => 'owner@local.dev' }; }
    moveActiveSheet() { return this; }
    setSpreadsheetLocale() { return this; }
  }

  const SpreadsheetApp = {
    openById: (id) => Spreadsheet.load(String(id)),
    openByUrl: (url) => Spreadsheet.load(String(url).match(/\/d\/([^/]+)/)[1]),
    create: (name) => Spreadsheet.create(name),
    getActive: () => null,
    setActiveSpreadsheet: () => {},
    getUi: () => ({ alert: () => {}, prompt: () => null }),
    DataValidationCriteria: {},
    newDataValidation: () => ({
      requireValueInList: () => ({ setAllowInvalid: () => ({ build: () => ({}) }) }),
      build: () => ({})
    }),
    newConditionalFormatRule: () => {
      const chain = { whenTextContains: () => chain, setBackgroundColor: () => chain, setRanges: () => chain, build: () => ({}) };
      return chain;
    },
    BorderStyle: {},
    Color: { newRgbColor: () => ({ asRgbColor: () => '#000000' }) }
  };

  /* --------------------------------------------------------------- drive */
  const driveState = readJson(path.join(DRIVE_DIR, 'state.json'), { folders: {}, files: {} });
  const saveDrive = () => writeJson(path.join(DRIVE_DIR, 'state.json'), driveState);

  class Blob {
    constructor(bytes, mime, name) { this.bytes = UNSIGNED(bytes); this.mime = mime || 'application/octet-stream'; this.name = name || 'blob'; }
    getBytes() { return SIGNED(this.bytes); }
    getContentType() { return this.mime; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getDataAsString() { return Buffer.from(this.bytes).toString('utf8'); }
    copyBlob() { return new Blob(this.bytes, this.mime, this.name); }
    setContentType(t) { this.mime = t; return this; }
  }

  class DriveIterator {
    constructor(items) { this.items = items; this.i = 0; }
    hasNext() { return this.i < this.items.length; }
    next() { return this.items[this.i++]; }
  }

  class DriveFile {
    constructor(id) { this.id = id; }
    #meta() { return driveState.files[this.id] || {}; }
    getId() { return this.id; }
    getName() { return this.#meta().name || ''; }
    setName(n) { driveState.files[this.id].name = n; saveDrive(); return this; }
    getSize() { return this.#meta().size || 0; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
    getDownloadUrl() { return 'https://drive.google.com/uc?export=download&id=' + this.id; }
    getMimeType() { return this.#meta().mime || ''; }
    getDescription() { return this.#meta().description || ''; }
    setDescription(d) { if (driveState.files[this.id]) driveState.files[this.id].description = d; saveDrive(); return this; }
    setSharing() { return this; }
    setTrashed(t) { if (driveState.files[this.id]) driveState.files[this.id].trashed = !!t; saveDrive(); return this; }
    isTrashed() { return !!this.#meta().trashed; }
    moveTo() { return this; }
    getBlob() {
      const meta = this.#meta();
      const buf = meta.blobFile ? fs.readFileSync(path.join(BLOBS_DIR, meta.blobFile)) : Buffer.alloc(0);
      return new Blob(buf, meta.mime, meta.name);
    }
    getAs(mime) {
      const meta = this.#meta();
      const buf = meta.blobFile ? fs.readFileSync(path.join(BLOBS_DIR, meta.blobFile)) : Buffer.alloc(0);
      if (String(mime).indexOf('pdf') >= 0) {
        return new Blob(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8'), 'application/pdf', String(meta.name || 'file').replace(/\.html?$/i, '') + '.pdf');
      }
      return new Blob(buf, mime, meta.name);
    }
    getParents() {
      const parent = this.#meta().folderId;
      return new DriveIterator(parent ? [new DriveFolder(parent)] : []);
    }
  }

  class DriveFolder {
    constructor(id) { this.id = id; }
    #meta() { return driveState.folders[this.id] || {}; }
    getId() { return this.id; }
    getName() { return this.#meta().name || ''; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    setSharing() { return this; }
    getParents() {
      const parent = this.#meta().parent;
      return new DriveIterator(parent ? [new DriveFolder(parent)] : []);
    }
    getFoldersByName(name) {
      const kids = Object.keys(driveState.folders)
        .filter((k) => driveState.folders[k].parent === this.id && driveState.folders[k].name === name)
        .map((k) => new DriveFolder(k));
      return new DriveIterator(kids);
    }
    getFilesByName(name) {
      const kids = Object.keys(driveState.files)
        .filter((k) => driveState.files[k].folderId === this.id && driveState.files[k].name === name && !driveState.files[k].trashed)
        .map((k) => new DriveFile(k));
      return new DriveIterator(kids);
    }
    getFiles() {
      const kids = Object.keys(driveState.files)
        .filter((k) => driveState.files[k].folderId === this.id && !driveState.files[k].trashed)
        .map((k) => new DriveFile(k));
      return new DriveIterator(kids);
    }
    createFolder(name) {
      const id = 'fld_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      driveState.folders[id] = { id, name, parent: this.id, createdAt: new Date().toISOString() };
      saveDrive();
      return new DriveFolder(id);
    }
    createFile(blobOrContent, mime, name) {
      let blob;
      if (blobOrContent instanceof Blob) blob = blobOrContent;
      else blob = new Blob(Buffer.from(String(blobOrContent), 'utf8'), mime, name);
      const id = 'file_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const blobFile = id + '.bin';
      fs.writeFileSync(path.join(BLOBS_DIR, blobFile), Buffer.from(blob.bytes));
      driveState.files[id] = {
        id, name: blob.name, mime: blob.mime, size: blob.bytes.length,
        folderId: this.id, blobFile, createdAt: new Date().toISOString(), trashed: false
      };
      saveDrive();
      return new DriveFile(id);
    }
    createFileFromUrl() { return this.createFile(new Blob(Buffer.from(''), 'application/octet-stream', 'remote')); }
  }

  const DriveApp = {
    getRootFolder: () => {
      if (!driveState.rootId) {
        driveState.rootId = 'root';
        driveState.folders.root = { id: 'root', name: 'My Drive', parent: null };
        saveDrive();
      }
      return new DriveFolder(driveState.rootId);
    },
    createFolder: (name) => DriveApp.getRootFolder().createFolder(name),
    createFile: (blob, mime, n) => DriveApp.getRootFolder().createFile(blob, mime, n),
    getFolderById: (id) => {
      if (!driveState.folders[String(id)]) throw new Error('No folder with ID: ' + id);
      return new DriveFolder(String(id));
    },
    getFileById: (id) => {
      if (!driveState.files[String(id)]) throw new Error('No file with ID: ' + id);
      return new DriveFile(String(id));
    },
    getFoldersByName: (name) => new DriveIterator(
      Object.keys(driveState.folders).filter((k) => driveState.folders[k].name === name).map((k) => new DriveFolder(k))
    ),
    searchFiles: () => new DriveIterator([]),
    Access: { PRIVATE: 'private', DOMAIN: 'domain', ANYONE: 'anyone' },
    Permission: { NONE: 'none', VIEW: 'view', EDIT: 'edit' }
  };

  /* ---------------------------------------------------------------- mail */
  const MailApp = {
    getRemainingDailyQuota: () => 100,
    sendEmail: (a, b, c, d) => {
      const strip = (h) => String(h || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .trim();
      const entry = typeof a === 'object'
        ? { to: a.to, cc: a.cc, subject: a.subject, body: a.body || strip(a.htmlBody), html_body: a.htmlBody || '', name: a.name, attachments: (a.attachments || []).map((x) => x.name || 'file') }
        : { to: a, subject: b, body: c, attachments: [] };
      entry.at = new Date().toISOString();
      outbox.push(entry);
      writeJson(outboxFile, outbox.slice(-200));
      log('MAIL →', entry.to, '|', entry.subject);
      return true;
    }
  };

  /* ----------------------------------------------------------- utilities */
  const dateFormat = (date, tz, pattern) => {
    const d = date && typeof date.getTime === 'function' ? new Date(date.getTime()) : new Date(date);
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).formatToParts(d);
    } catch {
      parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'medium' }).formatToParts(d);
    }
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
    let offset = '+00:00';
    try {
      const oz = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', timeZoneName: 'longOffset' }).formatToParts(d);
      const gmt = (oz.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT';
      offset = gmt === 'GMT' ? '+00:00' : gmt.replace('GMT', '');
    } catch { offset = '+00:00'; }
    const hour = get('hour') === '24' ? '00' : get('hour');
    return String(pattern)
      .replace(/yyyy/g, get('year'))
      .replace(/MM/g, get('month'))
      .replace(/dd/g, get('day'))
      .replace(/HH/g, hour)
      .replace(/mm/g, get('minute'))
      .replace(/ss/g, get('second'))
      .replace(/XXX/g, offset)
      .replace(/'([^']*)'/g, '$1');
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' },
    MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
    Charset: { UTF_8: 'utf-8' },
    computeDigest(algo, value, charset) {
      const alg = String(algo).includes('SHA_256') ? 'sha256' : (String(algo).includes('SHA_1') ? 'sha1' : 'md5');
      const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(UNSIGNED(value));
      return SIGNED(crypto.createHash(alg).update(buf).digest());
    },
    computeHmacSha256Signature(value, secret) {
      const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(UNSIGNED(value));
      const key = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(UNSIGNED(secret));
      return SIGNED(crypto.createHmac('sha256', key).update(buf).digest());
    },
    base64Encode(value, charset) {
      const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(UNSIGNED(value));
      return buf.toString('base64');
    },
    base64EncodeWebSafe(value) { return Utilities.base64Encode(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    base64Decode(value) { return SIGNED(Buffer.from(String(value), 'base64')); },
    newBlob(data, mime, name) {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(UNSIGNED(data));
      return new Blob(buf, mime, name);
    },
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, pattern) => dateFormat(d, tz, pattern),
    formatString: (fmt, ...args) => {
      let i = 0;
      return String(fmt).replace(/%[sd]/g, () => String(args[i++]));
    },
    sleep: () => {},
    jsonParse: (s) => JSON.parse(s),
    jsonStringify: (o) => JSON.stringify(o),
    getDateType: (s) => new Date(s),
    unzip: () => [],
    zip: () => new Blob(Buffer.alloc(0), 'application/zip', 'archive.zip'),
    encodeURIComponent: (s) => encodeURIComponent(s)
  };

  /* -------------------------------------------------------- url fetching */
  const mockGeocode = (url) => {
    const q = decodeURIComponent((url.match(/[?&]name=([^&]+)/) || url.match(/[?&]address=([^&]+)/) || [, ''])[1] || '');
    const h = crypto.createHash('sha1').update(q).digest();
    const known = {
      andheri: { lat: 19.1197, lng: 72.8464 }, bkc: { lat: 19.0662, lng: 72.8683 },
      powai: { lat: 19.1176, lng: 72.906 }, mumbai: { lat: 19.076, lng: 72.8777 },
      delhi: { lat: 28.6139, lng: 77.209 }, pune: { lat: 18.5204, lng: 73.8567 },
      bengaluru: { lat: 12.9716, lng: 77.5946 }, bangalore: { lat: 12.9716, lng: 77.5946 }
    };
    const lower = q.toLowerCase();
    let hit = null;
    for (const key of Object.keys(known)) if (lower.includes(key)) { hit = known[key]; break; }
    if (!hit) hit = { lat: 19.076 + (h[0] % 50) / 100, lng: 72.8777 + (h[1] % 50) / 100 };
    if (url.includes('maps.googleapis.com')) {
      return { results: [{ formatted_address: q, geometry: { location: { lat: hit.lat, lng: hit.lng } } }] };
    }
    return { results: [{ name: q.split(',')[0], latitude: hit.lat, longitude: hit.lng, admin1: 'Maharashtra', country: 'India' }] };
  };

  const mockWeather = (url) => {
    const lat = Number((url.match(/latitude=([-\d.]+)/) || [, '19.1'])[1]);
    const h = crypto.createHash('sha1').update(String(lat) + new Date().toISOString().slice(0, 10)).digest();
    return {
      daily: {
        time: [new Date().toISOString().slice(0, 10)],
        precipitation_sum: [(h[0] % 40) / 2],
        temperature_2m_max: [28 + (h[1] % 12)],
        windspeed_10m_max: [5 + (h[2] % 20)]
      }
    };
  };

  const minimalXlsx = () => Buffer.concat([
    Buffer.from('PK\u0003\u0004', 'binary'), Buffer.from('dev-xlsx-placeholder')
  ]);
  const minimalPdf = () => Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8');

  const UrlFetchApp = {
    fetch(url, opts = {}) {
      const u = String(url);
      fetchLog.push({ at: new Date().toISOString(), url: u.slice(0, 300), method: (opts.method || 'get').toUpperCase() });
      writeJson(fetchLogFile, fetchLog.slice(-200));
      log('FETCH', u.slice(0, 120));
      let body = '{}';
      let bytes = Buffer.from('{}');
      let code = 200;
      if (u.includes('geocoding-api.open-meteo.com') || u.includes('maps.googleapis.com/maps/api/geocode')) {
        body = JSON.stringify(mockGeocode(u));
      } else if (u.includes('api.open-meteo.com/v1/forecast')) {
        body = JSON.stringify(mockWeather(u));
      } else if (u.includes('docs.google.com/spreadsheets/export')) {
        const format = (u.match(/format=(\w+)/) || [, 'xlsx'])[1];
        bytes = format === 'pdf' ? minimalPdf() : minimalXlsx();
        body = '';
      } else if (u.includes('graph.facebook.com')) {
        body = JSON.stringify({ messages: [{ id: 'wamid.dev' }] });
      } else {
        code = 200;
        body = JSON.stringify({ ok: true, mocked: true, url: u.slice(0, 120) });
      }
      const buf = Buffer.from(body, 'utf8');
      return {
        getResponseCode: () => code,
        getContentText: () => (bytes.length && !body ? bytes.toString('binary') : body),
        getBlob: () => new Blob(bytes.length && !body ? bytes : buf, 'application/octet-stream', 'response'),
        getAllHeaders: () => ({})
      };
    },
    fetchAll: (requests) => requests.map((r) => UrlFetchApp.fetch(r.url, r))
  };

  /* ------------------------------------------- cache / properties / locks */
  const CacheService = {
    getScriptCache: () => ({
      get(key) {
        const hit = cacheStore.get(String(key));
        if (!hit) return null;
        if (hit.expires && hit.expires < Date.now()) { cacheStore.delete(String(key)); return null; }
        return hit.value;
      },
      put(key, value, seconds = 600) {
        cacheStore.set(String(key).slice(0, 240), { value: String(value), expires: Date.now() + seconds * 1000 });
      },
      remove(key) { cacheStore.delete(String(key)); },
      removeAll(keys) { (keys || []).forEach((k) => cacheStore.delete(String(k))); },
      getAll(keys) { const out = {}; (keys || []).forEach((k) => { out[k] = CacheService.getScriptCache().get(k); }); return out; }
    }),
    getUserCache: () => CacheService.getScriptCache(),
    getDocumentCache: () => CacheService.getScriptCache()
  };

  const scriptProps = {
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(properties, k) ? String(properties[k]) : null),
    setProperty: (k, v) => { properties[k] = String(v); saveProperties(); return scriptProps; },
    setProperties: (obj, del) => { if (del) properties = {}; Object.assign(properties, obj); saveProperties(); return scriptProps; },
    getProperties: () => ({ ...properties }),
    deleteProperty: (k) => { delete properties[k]; saveProperties(); return scriptProps; },
    deleteAllProperties: () => { properties = {}; saveProperties(); return scriptProps; }
  };
  const PropertiesService = {
    getScriptProperties: () => scriptProps,
    getUserProperties: () => scriptProps,
    getDocumentProperties: () => scriptProps
  };

  const LockService = {
    getScriptLock: () => ({ waitLock: () => true, tryLock: () => true, releaseLock: () => {} }),
    getDocumentLock: () => ({ waitLock: () => true, tryLock: () => true, releaseLock: () => {} })
  };

  /* --------------------------------------- content / html / script / misc */
  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain', HTML: 'text/html', CSV: 'text/csv', XML: 'application/xml' },
    createTextOutput(content) {
      let mime = 'text/plain';
      const out = {
        setMimeType(m) { mime = m; return out; },
        getMimeType: () => mime,
        getContent: () => String(content),
        append: (more) => { content = String(content) + String(more); return out; }
      };
      return out;
    }
  };

  /* ------------------------------------------------------- HtmlService ---
   * A faithful-enough clone of Apps Script's templating so the pages in
   * backend/*.html can be rendered locally exactly as script.google.com
   * renders them:
   *    <?!= expr ?>  raw output          <?= expr ?>  HTML-escaped output
   *    <? code ?>    script statements   and all of them run in the SAME
   *                  sandbox as the backend, so includeCss_('app_css') and
   *                  logoSvg_() resolve against the real .gs code.
   * -------------------------------------------------------------------- */
  function htmlOutput(html) {
    const out = {
      content: String(html), title: '', metas: [],
      setTitle(t) { out.title = String(t); return out; },
      addMetaTag(name, content) { out.metas.push([name, content]); return out; },
      setFaviconUrl() { return out; },
      setXFrameOptionsMode() { return out; },
      setSandboxMode() { return out; },
      getContent: () => out.content
    };
    return out;
  }

  function templateFile(name) {
    const clean = String(name).replace(/\.html$/, '');
    const candidates = [
      path.join(templateDir || path.join(dataDir, '..', '..', 'backend'), clean + '.html'),
      path.join(templateDir || path.join(dataDir, '..', '..', 'backend'), String(name))
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new Error('HtmlService: no such file: ' + name);
  }

  /** Turn a template into executable JS for the sandbox context. */
  function compileTemplate(source) {
    const parts = String(source).split(/(<\?[!=]?[\s\S]*?\?>)/);
    let body = '';
    for (const part of parts) {
      if (part.startsWith('<?!=')) body += '__out.push(String(' + part.slice(4, -2) + '));\n';
      else if (part.startsWith('<?=')) body += '__out.push(__esc(' + part.slice(3, -2) + '));\n';
      else if (part.startsWith('<?')) body += part.slice(2, -2) + '\n';
      else if (part) body += '__out.push(' + JSON.stringify(part) + ');\n';
    }
    return '(function(){ var __out = []; var __esc = function (v) { return String(v == null ? "" : v)' +
      '.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };\n' +
      body + 'return __out.join(""); })()';
  }

  function renderTemplate(name) {
    if (!contextRef || !contextRef.context) throw new Error('HtmlService: render context not attached');
    const file = templateFile(name);
    const code = compileTemplate(fs.readFileSync(file, 'utf8'));
    // The compiled template is a self-invoking function returning the HTML.
    return String(vm.runInContext(code, contextRef.context, { filename: path.basename(file) }));
  }

  const HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', SANDBOX: 'SANDBOX' },
    SandboxMode: { IFRAME: 'IFRAME' },
    createHtmlOutput: (html) => htmlOutput(html),
    createHtmlOutputFromFile(name) {
      const file = templateFile(name);
      return htmlOutput(fs.readFileSync(file, 'utf8'));
    },
    createTemplateFromFile(name) {
      return { evaluate: () => htmlOutput(renderTemplate(name)) };
    },
    createTemplate: (source) => ({ evaluate: () => htmlOutput(String(source)) })
  };

  const triggers = [];
  const ScriptApp = {
    WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY' },
    TriggerSource: { CLOCK: 'CLOCK' },
    AuthMode: { FULL: 'FULL' },
    getOAuthToken: () => 'dev-oauth-token',
    getProjectTriggers: () => triggers.map((t, i) => ({
      getHandlerFunction: () => t.fn, getTriggerSource: () => 'CLOCK', getUniqueId: () => 'trg_' + i
    })),
    newTrigger(fn) {
      const builder = {
        timeBased() { return builder; },
        onMonthDay(d) { builder.day = d; return builder; },
        onWeekDay(d) { builder.weekDay = d; return builder; },
        atHour(h) { builder.hour = h; return builder; },
        everyDays(n) { builder.every = n; return builder; },
        everyHours(n) { builder.everyHours = n; return builder; },
        everyMinutes(n) { builder.everyMinutes = n; return builder; },
        after(ms) { builder.after = ms; return builder; },
        atDate(d) { builder.atDate = d; return builder; },
        nearMinute() { return builder; },
        create() { triggers.push({ fn, ...builder }); return builder; }
      };
      return builder;
    },
    deleteTrigger(t) { const i = triggers.findIndex((x) => x.fn === t.getHandlerFunction()); if (i >= 0) triggers.splice(i, 1); },
    // '' (as the dev server passes) makes the pages fall back to the relative
    // /api path; a real deployment returns the script.google.com /exec URL.
    getService: () => ({ getUrl: () => (serviceUrl === null || serviceUrl === undefined ? 'http://127.0.0.1:8080/' : serviceUrl) }),
    getProjectTriggers_() { return triggers; }
  };

  const Session = {
    getTimeZone: () => properties.TIMEZONE || 'Asia/Kolkata',
    getActiveUser: () => ({ getEmail: () => 'owner@local.dev' }),
    getEffectiveUser: () => ({ getEmail: () => 'owner@local.dev' }),
    getUser: () => ({ getEmail: () => 'owner@local.dev' })
  };

  const Logger = {
    _lines: [],
    log(...args) { const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '); Logger._lines.push(line); if (verbose) console.log('[gas.log]', line); },
    clear() { Logger._lines = []; },
    getLog() { return Logger._lines.join('\n'); }
  };

  const MimeType = { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', PDF: 'application/pdf', PNG: 'image/png', JPEG: 'image/jpeg' };

  return {
    SpreadsheetApp, DriveApp, MailApp, Utilities, UrlFetchApp, CacheService, PropertiesService,
    LockService, ContentService, HtmlService, ScriptApp, Session, Logger, MimeType, Blob,
    console, JSON, Math, Date, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    String, Number, Boolean, Array, Object, RegExp, Error, __SITETRACK_DEV__: true,
    __dev: {
      outbox, fetchLog, triggers, cacheStore, properties, driveState,
      Spreadsheet, DriveFolder, DriveFile, Blob,
      sheetFile: (id) => path.join(SHEETS_DIR, id + '.json'),
      reset() {
        for (const f of fs.readdirSync(SHEETS_DIR)) fs.unlinkSync(path.join(SHEETS_DIR, f));
        for (const f of fs.readdirSync(BLOBS_DIR)) fs.unlinkSync(path.join(BLOBS_DIR, f));
        driveState.folders = {}; driveState.files = {}; driveState.rootId = null;
        saveDrive();
        properties = {}; saveProperties();
        cacheStore.clear(); triggers.length = 0;
        outbox.length = 0; writeJson(outboxFile, outbox);
        Logger.clear();
      }
    }
  };
}
