/**
 * ============================================================================
 *  FocusHR  —  Files.gs
 *  Every uploaded file (KYC documents, bills, payslips, letters, logos) lives
 *  in the company's own Drive folder tree and is never shared publicly.
 *  Downloads always go through the API so permissions are checked first.
 *
 *  Uploads are chunked because the browser <-> Apps Script bridge is happiest
 *  with small payloads:  files.upload.begin -> N x files.upload.chunk (80,000
 *  base64 characters each) -> files.upload.finish
 * ============================================================================
 */

var FOLDERS = {
  'platform': ['Platform'],
  'branding': ['Branding'],
  'employee-photo': ['Employees', 'Photos'],
  'employee-doc': ['Employees', '{owner_id}', 'Documents'],
  'employee-kyc': ['Employees', '{owner_id}', 'KYC'],
  'document': ['Documents'],
  'expense-bill': ['Expenses', '{fy}', 'Bills'],
  'payslip': ['Payslips', '{fy}', '{month}'],
  'letter': ['Letters', '{fy}'],
  'ticket': ['Tickets', '{owner_id}'],
  'import': ['Imports'],
  'report': ['Reports', '{fy}'],
  'misc': ['Misc']
};

var ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/vnd.oasis.opendocument.text'
];

var Files = {

  /* ------------------------------------------------------- Drive helpers */
  rootFolder: function () {
    var id = prop_(PROPS.driveRoot);
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
    }
    var it = DriveApp.getFoldersByName(APP.name + ' Files');
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(APP.name + ' Files');
    setProp_(PROPS.driveRoot, folder.getId());
    return folder;
  },

  ensureSubfolder_: function (parent, name) {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  },

  companyFolderById_: function (companyId) {
    var row = companyRow_(companyId);
    if (!row) fail_('NOT_FOUND', 'Company not found.');
    if (txt_(row.drive_folder_id)) {
      try { return DriveApp.getFolderById(txt_(row.drive_folder_id)); } catch (e) { /* fall through and recreate */ }
    }
    var root = Files.rootFolder();
    var folder = Files.ensureSubfolder_(root, txt_(row.name) + ' (' + txt_(row.company_id) + ')');
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Db.update(masterCtx_(), 'Companies', 'company_id', companyId, { drive_folder_id: folder.getId() }, { system: true });
    memoDrop_('__ctx_' + companyId);
    return folder;
  },

  companyFolder: function (ctx) {
    if (!ctx.companyId) fail_('BAD_REQUEST', 'This action needs a company workspace.');
    return Files.companyFolderById_(ctx.companyId);
  },

  /** Resolve (and create) a folder path such as Expenses/2025-26/Bills. */
  path: function (ctx, folderKey, meta) {
    var m = meta || {};
    var parts = FOLDERS[folderKey] || FOLDERS.misc;
    var owner = txt_(m.owner_id);
    var fy = txt_(m.fy || fyOf_(todayIso_()));
    var month = txt_(m.month || monthOfIso_(todayIso_()));
    var folder = folderKey === 'platform' ? Files.rootFolder() : Files.companyFolder(ctx);
    parts.forEach(function (raw) {
      var name = raw.split('{owner_id}').join(owner || 'Common')
        .split('{fy}').join(fy)
        .split('{month}').join(month);
      folder = Files.ensureSubfolder_(folder, name);
    });
    return folder;
  },

  /* ---------------------------------------------------------- uploads ---- */
  uploadBegin: function (ctx, payload) {
    var name = txt_(payload.name).replace(/[\\/]/g, '-').slice(0, 160);
    if (!name) fail_('VALIDATION', 'File name is missing.');
    var mime = txt_(payload.mime_type) || 'application/octet-stream';
    if (ALLOWED_MIME.indexOf(mime) < 0) {
      fail_('FILE_TYPE', 'This file type (' + mime + ') is not allowed. Please upload a PDF, image, Word, Excel or CSV file.');
    }
    var size = intVal_(payload.size_bytes, 0);
    if (size > APP.maxUploadBytes) {
      fail_('FILE_TOO_LARGE', 'Files up to ' + Math.round(APP.maxUploadBytes / 1048576) + ' MB are supported. This file is ' + (size / 1048576).toFixed(1) + ' MB.');
    }
    var folderKey = txt_(payload.folder || 'misc');
    if (!FOLDERS[folderKey]) folderKey = 'misc';
    if (payload.owner_id) {
      if (folderKey.indexOf('employee') === 0) Perm.assertEmployee(ctx, payload.owner_id);
    }
    var uploadId = uuid_();
    var meta = {
      upload_id: uploadId, name: name, mime: mime, size: size, folder_key: folderKey,
      owner_id: txt_(payload.owner_id), user_id: ctx.userId, company_id: txt_(ctx.companyId),
      fy: txt_(payload.fy || fyOf_(todayIso_())), month: txt_(payload.month || monthOfIso_(todayIso_())),
      chunks: 0, created_at: nowIso_()
    };
    CacheService.getScriptCache().put('up_meta_' + uploadId, jsonStr_(meta), 3600);
    return {
      upload_id: uploadId,
      chunk_chars: APP.chunkCharsBase64,
      max_chunks: APP.maxUploadChunks,
      name: name
    };
  },

  uploadChunk: function (ctx, payload) {
    var meta = safeJson_(CacheService.getScriptCache().get('up_meta_' + txt_(payload.upload_id)), null);
    if (!meta) fail_('UPLOAD_EXPIRED', 'This upload took too long. Please start the upload again.');
    if (txt_(meta.user_id) !== txt_(ctx.userId)) fail_('FORBIDDEN', 'This upload belongs to another session.');
    var index = intVal_(payload.index, -1);
    if (index < 0 || index >= APP.maxUploadChunks) fail_('VALIDATION', 'Invalid chunk number.');
    var data = txt_(payload.data);
    if (data.length > APP.chunkCharsBase64 + 2000) fail_('VALIDATION', 'Chunk is too large. Please refresh the page and try again.');
    CacheService.getScriptCache().put('up_' + txt_(payload.upload_id) + '_' + index, data, 3600);
    meta.chunks = Math.max(intVal_(meta.chunks, 0), index + 1);
    CacheService.getScriptCache().put('up_meta_' + txt_(payload.upload_id), jsonStr_(meta), 3600);
    return { received: index, chunks: meta.chunks };
  },

  uploadFinish: function (ctx, payload) {
    var uploadId = txt_(payload.upload_id);
    var cache = CacheService.getScriptCache();
    var meta = safeJson_(cache.get('up_meta_' + uploadId), null);
    if (!meta) fail_('UPLOAD_EXPIRED', 'This upload took too long. Please start the upload again.');
    if (txt_(meta.user_id) !== txt_(ctx.userId)) fail_('FORBIDDEN', 'This upload belongs to another session.');
    var chunks = intVal_(payload.chunks, meta.chunks);
    if (chunks < 1 || chunks > APP.maxUploadChunks) fail_('VALIDATION', 'No file data was received. Please try again.');

    var bytes = [];
    for (var i = 0; i < chunks; i++) {
      var part = cache.get('up_' + uploadId + '_' + i);
      if (part === null) fail_('UPLOAD_INCOMPLETE', 'Part ' + (i + 1) + ' of the file did not reach the server. Please upload again.');
      bytes = bytes.concat(Utilities.base64Decode(part));
      cache.remove('up_' + uploadId + '_' + i);
    }
    cache.remove('up_meta_' + uploadId);
    if (!bytes.length) fail_('VALIDATION', 'The uploaded file is empty.');

    var blob = Utilities.newBlob(bytes, meta.mime, meta.name);
    var folder = Files.path(ctx, meta.folder_key, { owner_id: meta.owner_id, fy: meta.fy, month: meta.month });
    var file = folder.createFile(blob);
    try { file.setDescription('Uploaded via ' + APP.name + ' by ' + txt_(ctx.name) + ' on ' + nowIso_()); } catch (e) { /* optional */ }

    Audit.write(ctx, {
      module: 'files', action: 'files.upload', entity: 'Drive', entity_id: file.getId(),
      note: meta.name + ' (' + Math.round(bytes.length / 1024) + ' KB) → ' + meta.folder_key, severity: 'INFO'
    });

    return {
      file_id: file.getId(),
      name: meta.name,
      mime_type: meta.mime,
      size_bytes: bytes.length,
      url: file.getUrl(),
      folder_key: meta.folder_key,
      uploaded_at: nowIso_()
    };
  },

  uploadCancel: function (ctx, payload) {
    var cache = CacheService.getScriptCache();
    var meta = safeJson_(cache.get('up_meta_' + txt_(payload.upload_id)), null);
    if (meta) {
      for (var i = 0; i < intVal_(meta.chunks, 0); i++) cache.remove('up_' + txt_(payload.upload_id) + '_' + i);
      cache.remove('up_meta_' + txt_(payload.upload_id));
    }
    return { cancelled: true };
  },

  /* --------------------------------------------------------- download ---- */
  meta: function (ctx, payload) {
    var file = Files.open_(ctx, payload.file_id);
    return { file_id: payload.file_id, name: file.getName(), mime_type: file.getMimeType(), size_bytes: file.getSize(), url: file.getUrl() };
  },

  download: function (ctx, payload) {
    var file = Files.open_(ctx, payload.file_id);
    var blob = file.getBlob();
    Audit.sensitive(ctx, 'files', 'files.download', 'Drive', payload.file_id, 'Downloaded ' + file.getName());
    return {
      file_id: payload.file_id,
      name: file.getName(),
      mime_type: file.getMimeType() || blob.getContentType(),
      size_bytes: blob.getBytes().length,
      base64: Utilities.base64Encode(blob.getBytes())
    };
  },

  /** Fetch a Drive file after checking it belongs to the caller's tree. */
  open_: function (ctx, fileId) {
    var id = txt_(fileId);
    if (!id) fail_('VALIDATION', 'File id is missing.');
    var file;
    try { file = DriveApp.getFileById(id); } catch (e) { fail_('NOT_FOUND', 'That file no longer exists in Drive.'); }
    if (!Files.belongsToCaller_(ctx, file)) {
      Audit.write(ctx, {
        module: 'files', action: 'files.denied', entity: 'Drive', entity_id: id,
        note: 'Blocked cross-tenant file access attempt', severity: 'SECURITY'
      });
      fail_('FORBIDDEN', 'You do not have access to this file.');
    }
    return file;
  },

  belongsToCaller_: function (ctx, file) {
    if (ctx.scope === 'SUPER') return true;
    var companyFolderId = '';
    try { companyFolderId = Files.companyFolder(ctx).getId(); } catch (e) { return false; }
    var guard = 0;
    var parents = file.getParents();
    while (parents.hasNext() && guard < 12) {
      guard++;
      var parent = parents.next();
      if (parent.getId() === companyFolderId) return true;
      parents = parent.getParents();
    }
    return false;
  },

  remove: function (ctx, payload) {
    var file = Files.open_(ctx, payload.file_id);
    file.setTrashed(true);
    Audit.write(ctx, { module: 'files', action: 'files.delete', entity: 'Drive', entity_id: payload.file_id, note: 'Trashed ' + file.getName(), w: true });
    return { deleted: true, file_id: payload.file_id };
  },

  /* ------------------------------------------------------ folder browser - */
  companyTree: function (ctx) {
    var root = Files.companyFolder(ctx);
    var pairs = [
      ['Branding', FOLDERS.branding], ['Employees', FOLDERS['employee-doc']], ['Expenses', FOLDERS['expense-bill']],
      ['Payslips', FOLDERS.payslip], ['Letters', FOLDERS.letter], ['Documents', FOLDERS.document],
      ['Reports', FOLDERS.report], ['Tickets', FOLDERS.ticket], ['Imports', FOLDERS.import]
    ];
    var out = [];
    pairs.forEach(function (p) {
      var folder = root;
      try {
        for (var i = 0; i < p[1].length; i++) folder = Files.ensureSubfolder_(folder, p[1][i]);
        out.push({ label: p[0], folder_id: folder.getId(), url: folder.getUrl() });
      } catch (e) {
        out.push({ label: p[0], folder_id: '', url: '', error: e.message });
      }
    });
    return {
      company_folder_id: root.getId(),
      company_folder_url: root.getUrl(),
      folders: out,
      storage_note: 'Files are private to the account that owns this system. They are never shared publicly — the app streams them through a permission checked API.'
    };
  },

  /* ------------------------------------------------------------ PDF ---- */
  /** Save generated HTML as a PDF (or HTML) into the company Drive tree. */
  saveGenerated: function (ctx, opts) {
    var o = opts || {};
    var folderPath = o.folder_key || 'misc';
    var folder = Files.path(ctx, folderPath, { owner_id: o.owner_id, fy: o.fy, month: o.month });
    var wanted = txt_(o.name);
    if (o.csv !== undefined && o.csv !== null && txt_(o.csv) !== '') {
      var csvName = /\.csv$/i.test(wanted) ? wanted : wanted.replace(/\.[a-z0-9]+$/i, '') + '.csv';
      return folder.createFile(Utilities.newBlob(txt_(o.csv), 'text/csv', csvName));
    }
    var blob = o.mime === 'text/html'
      ? Utilities.newBlob(txt_(o.html), 'text/html', wanted)
      : Utilities.newBlob(txt_(o.html), 'text/html', wanted.replace(/\.pdf$/i, '') + '.pdf');
    if (o.mime === 'application/pdf') {
      // Convert the HTML to PDF using Drive's export helper.
      var temp = folder.createFile(Utilities.newBlob(txt_(o.html), 'text/html', 'tmp_' + Utilities.getUuid() + '.html'));
      var pdf = temp.getAs('application/pdf').setName(txt_(o.name));
      var saved = folder.createFile(pdf);
      temp.setTrashed(true);
      return saved;
    }
    return folder.createFile(blob);
  }
};
