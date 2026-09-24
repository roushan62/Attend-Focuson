/**
 * ============================================================================
 *  FocusHR  —  Documents.gs
 *  The document vault (company and employee documents, versions, expiry) and
 *  the letter factory (templates, preview, generated PDF letters).
 * ============================================================================
 */

var DocumentCategories = ['POLICY', 'LICENCE', 'CERTIFICATE', 'INSURANCE', 'CONTRACT', 'ID_PROOF', 'EDUCATION', 'BANK', 'MEDICAL', 'OTHER'];
var DocumentVisibility = ['EVERYONE', 'MANAGERS', 'HR', 'PRIVATE'];

var Documents = {

  /* =============================================================== list == */
  out_: function (ctx, d) {
    return {
      doc_id: d.doc_id, owner_type: txt_(d.owner_type), owner_id: txt_(d.owner_id), owner_name: txt_(d.owner_name),
      category: txt_(d.category), title: txt_(d.title), file_id: txt_(d.file_id), file_name: txt_(d.file_name),
      mime_type: txt_(d.mime_type), size_bytes: intVal_(d.size_bytes), size_label: sizeLabel_(d.size_bytes),
      version: intVal_(d.version, 1), is_latest: boolVal_(d.is_latest), visibility: txt_(d.visibility),
      expiry_date: txt_(d.expiry_date), note: txt_(d.note), created_at: txt_(d.created_at),
      created_by_name: txt_(d.created_by_name),
      expired: !!txt_(d.expiry_date) && txt_(d.expiry_date) < todayIso_(),
      expiring_soon: !!txt_(d.expiry_date) && txt_(d.expiry_date) >= todayIso_() && txt_(d.expiry_date) <= isoAddDays_(todayIso_(), 30),
      download: txt_(d.file_id) ? { action: 'files.download', payload: { file_id: txt_(d.file_id) } } : null
    };
  },

  visible_: function (ctx, d) {
    var vis = txt_(d.visibility || 'EVERYONE').toUpperCase();
    if (Perm.has(ctx, 'documents.view')) {
      if (vis === 'PRIVATE' && txt_(d.created_by) !== ctx.userId && !Perm.has(ctx, 'documents.manage')) return false;
      return true;
    }
    var empId = ctx.employeeId;
    if (!empId) return false;
    if (txt_(d.owner_type) === 'EMPLOYEE' && txt_(d.owner_id) === empId) return true;
    return vis === 'EVERYONE';
  },

  list: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'Documents', function (d) {
      if (!Documents.visible_(ctx, d)) return false;
      if (!boolVal_(d.is_latest)) return false;
      if (payload.owner_type && txt_(d.owner_type) !== txt_(payload.owner_type).toUpperCase()) return false;
      if (payload.owner_id && txt_(d.owner_id) !== txt_(payload.owner_id)) return false;
      if (payload.category && txt_(d.category) !== txt_(payload.category).toUpperCase()) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (d) { return matchesSearch_(d, SCHEMA.Documents.search, payload.search); });
    rows = sortRows_(rows, payload.sort || 'created_at', payload.dir || 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize || payload.page_size);
    return {
      rows: page.rows.map(function (d) { return Documents.out_(ctx, d); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      categories: DocumentCategories, visibilities: DocumentVisibility,
      counts: {
        company: rows.filter(function (d) { return txt_(d.owner_type) === 'COMPANY'; }).length,
        employee: rows.filter(function (d) { return txt_(d.owner_type) === 'EMPLOYEE'; }).length,
        project: rows.filter(function (d) { return txt_(d.owner_type) === 'PROJECT'; }).length,
        expiring: rows.filter(function (d) { return !!txt_(d.expiry_date) && txt_(d.expiry_date) <= isoAddDays_(todayIso_(), 30); }).length
      },
      folder: Files.companyTree(ctx)
    };
  },

  my: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0, message: 'Company documents are on the Documents screen.' };
    var rows = Db.all(c, 'Documents', function (d) {
      if (!boolVal_(d.is_latest)) return false;
      if (txt_(d.owner_type) === 'EMPLOYEE' && txt_(d.owner_id) === ctx.employeeId) return true;
      return txt_(d.visibility) === 'EVERYONE' && txt_(d.owner_type) === 'COMPANY';
    });
    rows = sortRows_(rows, 'created_at', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (d) { return Documents.out_(ctx, d); }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      employee_documents: Db.all(c, 'EmployeeDocuments', function (d) {
        return txt_(d.employee_id) === ctx.employeeId;
      }).map(function (d) {
        return {
          doc_id: d.doc_id, doc_type: txt_(d.doc_type), doc_name: txt_(d.doc_name || d.doc_type),
          file_id: txt_(d.file_id), expiry_date: txt_(d.expiry_date), verified: boolVal_(d.verified),
          expired: !!txt_(d.expiry_date) && txt_(d.expiry_date) < todayIso_()
        };
      })
    };
  },

  save: function (ctx, payload) {
    Perm.require(ctx, 'documents.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var ownerType = txt_(payload.owner_type).toUpperCase();
    if (['COMPANY', 'EMPLOYEE', 'PROJECT', 'OTHER'].indexOf(ownerType) < 0) {
      fail_('VALIDATION', 'Choose who the document belongs to.', { field: 'owner_type' });
    }
    var ownerId = txt_(payload.owner_id);
    var ownerName = '';
    if (ownerType === 'EMPLOYEE') {
      if (!ownerId) fail_('VALIDATION', 'Choose the employee this document belongs to.', { field: 'owner_id' });
      var emp = Db.get(c, 'Employees', 'employee_id', ownerId);
      ownerName = txt_(emp.name);
    } else if (ownerType === 'PROJECT') {
      if (!ownerId) fail_('VALIDATION', 'Choose the project this document belongs to.', { field: 'owner_id' });
      ownerName = txt_(Db.get(c, 'Projects', 'project_id', ownerId).name);
    } else {
      ownerName = txt_(payload.owner_name || (c.company ? c.company.name : ''));
      ownerId = ownerId || 'COMPANY';
    }
    var uploaded = Files.open_(ctx, payload.file_id);
    if (!Files.belongsToCaller_(ctx, uploaded)) {
      fail_('NOT_ALLOWED', 'That file is not in this company workspace. Upload it again from this screen.');
    }
    var meta = { name: uploaded.getName(), mime_type: uploaded.getMimeType(), size_bytes: uploaded.getSize() };
    var patch = {
      owner_type: ownerType, owner_id: ownerId, owner_name: ownerName,
      category: txt_(payload.category || 'OTHER').toUpperCase().slice(0, 40),
      title: txt_(payload.title).slice(0, 200), file_id: txt_(payload.file_id),
      file_name: txt_(payload.file_name || meta.name), mime_type: txt_(payload.mime_type || meta.mime_type),
      size_bytes: intVal_(payload.size_bytes || meta.size_bytes), version: 1, is_latest: 'TRUE',
      visibility: txt_(payload.visibility || 'EVERYONE').toUpperCase(),
      expiry_date: txt_(payload.expiry_date), note: txt_(payload.note).slice(0, 500)
    };
    var rows = Db.all(c, 'Documents', function (d) {
      return txt_(d.owner_type) === ownerType && txt_(d.owner_id) === ownerId;
    });
    var existing = rows.filter(function (d) { return txt_(d.title).toLowerCase() === patch.title.toLowerCase() && boolVal_(d.is_latest); })[0];
    var row;
    if (existing) {
      rows.filter(function (d) { return txt_(d.title).toLowerCase() === patch.title.toLowerCase(); })
        .forEach(function (d) { Db.update(c, 'Documents', 'doc_id', d.doc_id, { is_latest: 'FALSE' }, { actor: ctx.userId }); });
      patch.version = Db.all(c, 'Documents', function (d) {
        return txt_(d.title).toLowerCase() === patch.title.toLowerCase();
      }).length + 1;
      patch.parent_doc_id = existing.parent_doc_id || existing.doc_id;
      row = Db.insert(c, 'Documents', patch, { actor: ctx.userId });
    } else {
      row = Db.insert(c, 'Documents', patch, { actor: ctx.userId });
    }
    Audit.write(ctx, {
      module: 'documents', action: existing ? 'documents.newVersion' : 'documents.save', entity: 'Documents', entity_id: row.doc_id,
      after: { owner: ownerName || ownerType, category: patch.category, title: patch.title, version: patch.version, file: patch.file_name },
      note: 'Document "' + patch.title + '" stored for ' + (ownerName || ownerType)
    });
    return { document: Documents.out_(ctx, row), message: 'Document saved in the secure company Drive folder.' };
  },

  newVersion: function (ctx, payload) {
    Perm.require(ctx, 'documents.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var doc = Db.get(c, 'Documents', 'doc_id', payload.doc_id);
    var newFile = Files.open_(ctx, payload.file_id);
    var meta = { name: newFile.getName(), mime_type: newFile.getMimeType(), size_bytes: newFile.getSize() };
    Db.all(c, 'Documents', function (d) {
      return txt_(d.title).toLowerCase() === txt_(doc.title).toLowerCase() &&
        txt_(d.owner_type) === txt_(doc.owner_type) && txt_(d.owner_id) === txt_(doc.owner_id);
    }).forEach(function (d) { Db.update(c, 'Documents', 'doc_id', d.doc_id, { is_latest: 'FALSE' }, { actor: ctx.userId }); });
    var version = intVal_(doc.version, 1) + 1;
    var row = Db.insert(c, 'Documents', {
      parent_doc_id: txt_(doc.parent_doc_id) || doc.doc_id,
      owner_type: doc.owner_type, owner_id: doc.owner_id, owner_name: doc.owner_name,
      category: doc.category, title: doc.title, file_id: txt_(payload.file_id),
      file_name: txt_(payload.file_name || meta.name), mime_type: txt_(payload.mime_type || meta.mime_type),
      size_bytes: intVal_(payload.size_bytes || meta.size_bytes), version: version, is_latest: 'TRUE',
      visibility: doc.visibility, expiry_date: txt_(payload.expiry_date || doc.expiry_date),
      note: txt_(payload.note || doc.note)
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'documents', action: 'documents.newVersion', entity: 'Documents', entity_id: row.doc_id,
      before: { version: doc.version }, after: { version: version, file: row.file_name },
      note: 'New version (v' + version + ') of "' + txt_(doc.title) + '" uploaded'
    });
    return { document: Documents.out_(ctx, row), message: 'Version ' + version + ' saved. Older versions are still available.' };
  },

  remove: function (ctx, payload) {
    Perm.require(ctx, 'documents.delete');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var doc = Db.get(c, 'Documents', 'doc_id', payload.doc_id);
    Db.softDelete(c, 'Documents', 'doc_id', doc.doc_id, { actor: ctx.userId, note: txt_(payload.reason) });
    if (txt_(payload.reason).length < 3) fail_('VALIDATION', 'Please write a short reason for deleting this document.', { field: 'reason' });
    Audit.write(ctx, {
      module: 'documents', action: 'documents.delete', entity: 'Documents', entity_id: doc.doc_id,
      before: { title: doc.title, version: doc.version, file: doc.file_name },
      note: 'Document "' + txt_(doc.title) + '" deleted: ' + txt_(payload.reason), severity: 'SENSITIVE'
    });
    return { deleted: true, message: 'Document removed from the list. The file itself stays in Drive for your records.' };
  },

  /* ============================================================ letters == */
  templatesList: function (ctx) {
    Perm.require(ctx, 'documents.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var rows = Db.all(c, 'LetterTemplates');
    var fallback = DEFAULT_LETTER_TEMPLATES.map(function (t) {
      return {
        template_id: '', code: t.code, name: t.name, category: t.category, subject: t.subject,
        body_html: t.body_html, is_active: true, is_default: true
      };
    });
    var byCode = {};
    rows.forEach(function (t) { byCode[txt_(t.code)] = t; });
    var merged = fallback.map(function (t) {
      var saved = byCode[t.code];
      if (!saved) return t;
      return {
        template_id: saved.template_id, code: saved.code, name: txt_(saved.name), category: txt_(saved.category),
        subject: txt_(saved.subject), body_html: txt_(saved.body_html), is_active: boolVal_(saved.is_active),
        is_default: false, note: txt_(saved.note), updated_at: txt_(saved.updated_at)
      };
    });
    rows.forEach(function (t) {
      if (!DEFAULT_LETTER_TEMPLATES.filter(function (d) { return d.code === txt_(t.code); }).length) {
        merged.push({
          template_id: t.template_id, code: txt_(t.code), name: txt_(t.name), category: txt_(t.category),
          subject: txt_(t.subject), body_html: txt_(t.body_html), is_active: boolVal_(t.is_active), is_default: false
        });
      }
    });
    return {
      rows: merged,
      placeholders: Documents.placeholders_(),
      categories: uniq_(merged.map(function (t) { return t.category; })),
      note: 'Placeholders between double braces are replaced when you preview or generate a letter.'
    };
  },

  placeholders_: function () {
    return [
      { key: '{{employee_name}}', label: 'Employee name' },
      { key: '{{employee_code}}', label: 'Employee code' },
      { key: '{{designation}}', label: 'Designation' },
      { key: '{{department}}', label: 'Department' },
      { key: '{{joining_date}}', label: 'Date of joining (readable)' },
      { key: '{{exit_date}}', label: 'Date of exit (readable)' },
      { key: '{{employee_address}}', label: 'Employee address' },
      { key: '{{employee_phone}}', label: 'Employee phone' },
      { key: '{{employee_email}}', label: 'Employee email' },
      { key: '{{monthly_gross}}', label: 'Monthly gross salary' },
      { key: '{{ctc_annual}}', label: 'Annual CTC' },
      { key: '{{project_name}}', label: 'Current site / project' },
      { key: '{{manager_name}}', label: 'Reporting manager' },
      { key: '{{company_name}}', label: 'Company name' },
      { key: '{{company_address}}', label: 'Company address' },
      { key: '{{company_gstin}}', label: 'Company GSTIN' },
      { key: '{{branch_name}}', label: 'Branch' },
      { key: '{{today}}', label: "Today's date (readable)" },
      { key: '{{issue_date}}', label: 'Date of issue (readable)' },
      { key: '{{signer_name}}', label: 'Signing authority' },
      { key: '{{location}}', label: 'Work location' },
      { key: '{{effective_date}}', label: 'Effective date (from the form)' },
      { key: '{{purpose}}', label: 'Purpose (from the form)' },
      { key: '{{notice_days}}', label: 'Notice period in days' },
      { key: '{{last_working_day}}', label: 'Last working day' },
      { key: '{{amount}}', label: 'Amount (from the form)' },
      { key: '{{reference_no}}', label: 'Reference number (from the form)' },
      { key: '{{remarks}}', label: 'Remarks (from the form)' }
    ];
  },

  templatesSave: function (ctx, payload) {
    Perm.require(ctx, 'documents.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var code = txt_(payload.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
    if (!code) fail_('VALIDATION', 'Give the template a short code such as OFFER or RELIEVING.', { field: 'code' });
    var existing = payload.template_id
      ? Db.get(c, 'LetterTemplates', 'template_id', payload.template_id)
      : Db.findOne(c, 'LetterTemplates', function (t) { return txt_(t.code) === code; });
    var patch = {
      code: code, name: txt_(payload.name).slice(0, 120), category: txt_(payload.category || 'GENERAL').toUpperCase(),
      subject: txt_(payload.subject).slice(0, 250), body_html: txt_(payload.body_html),
      is_active: boolVal_(payload.is_active === undefined ? true : payload.is_active) ? 'TRUE' : 'FALSE',
      note: txt_(payload.note).slice(0, 300)
    };
    var row = existing
      ? Db.update(c, 'LetterTemplates', 'template_id', existing.template_id, patch, { actor: ctx.userId })
      : Db.insert(c, 'LetterTemplates', patch, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'documents', action: 'documents.templates.save', entity: 'LetterTemplates', entity_id: row.template_id,
      after: { code: code, name: patch.name, active: patch.is_active },
      note: existing ? 'Letter template "' + patch.name + '" updated' : 'Letter template "' + patch.name + '" created'
    });
    return { template: { template_id: row.template_id, code: row.code, name: row.name }, message: 'Template saved.' };
  },

  templatesReset: function (ctx) {
    Perm.require(ctx, 'documents.manage');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var removed = 0;
    Db.all(c, 'LetterTemplates').forEach(function (t) {
      Db.softDelete(c, 'LetterTemplates', 'template_id', t.template_id, { actor: ctx.userId, note: 'reset to ready-made templates' });
      removed++;
    });
    Audit.write(ctx, {
      module: 'documents', action: 'documents.templates.reset', entity: 'LetterTemplates', entity_id: '',
      before: { removed: removed }, after: { restored: DEFAULT_LETTER_TEMPLATES.length },
      note: 'Letter templates reset to the FocusHR defaults', severity: 'SENSITIVE'
    });
    return { removed: removed, restored: DEFAULT_LETTER_TEMPLATES.length, message: 'Ready-made templates restored. Your custom templates were removed from the list.' };
  },

  template_: function (ctx, templateId) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (txt_(templateId)) {
      var saved = Db.find(c, 'LetterTemplates', 'template_id', templateId);
      if (saved) return saved;
      var byCode = Db.findOne(c, 'LetterTemplates', function (t) { return txt_(t.code) === txt_(templateId).toUpperCase(); });
      if (byCode) return byCode;
    }
    var fallback = DEFAULT_LETTER_TEMPLATES.filter(function (t) { return t.code === txt_(templateId).toUpperCase(); })[0];
    if (!fallback) fail_('NOT_FOUND', 'That letter template was not found. Reload the templates list and try again.');
    return fallback;
  },

  values_: function (ctx, employee, extra, issueDate) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var company = c.company || companyRow_(ctx.companyId);
    var e = extra || {};
    var project = txt_(employee.project_id) ? Db.find(c, 'Projects', 'project_id', employee.project_id) : null;
    var manager = txt_(employee.manager_id) ? Db.find(c, 'Employees', 'employee_id', employee.manager_id) : null;
    var branch = txt_(employee.branch_id) ? Db.find(c, 'Branches', 'branch_id', employee.branch_id) : null;
    var structure = Employees.currentStructure_(ctx, employee.employee_id);
    var monthlyGross = structure
      ? round0_(numVal_(structure.basic) + numVal_(structure.hra) + numVal_(structure.da) + numVal_(structure.conveyance) +
        numVal_(structure.special_allowance) + numVal_(structure.other_allowance))
      : numVal_(employee.ctc_monthly);
    var annualCtc = round0_(numVal_(employee.ctc_monthly) * 12) || round0_(monthlyGross * 12);
    return {
      '{{employee_name}}': txt_(employee.name),
      '{{employee_code}}': txt_(employee.code),
      '{{designation}}': txt_(employee.designation),
      '{{department}}': txt_(employee.department),
      '{{joining_date}}': fmtDateHuman_(employee.joining_date),
      '{{exit_date}}': fmtDateHuman_(employee.exit_date),
      '{{employee_address}}': [txt_(employee.address), txt_(employee.city), txt_(employee.state), txt_(employee.pincode)].filter(function (x) { return !!x; }).join(', '),
      '{{employee_phone}}': maskPhone_(employee.phone),
      '{{employee_email}}': txt_(employee.email),
      '{{monthly_gross}}': '₹' + Number(monthlyGross).toLocaleString('en-IN'),
      '{{ctc_annual}}': '₹' + Number(annualCtc).toLocaleString('en-IN'),
      '{{project_name}}': project ? txt_(project.name) : '',
      '{{manager_name}}': manager ? txt_(manager.name) : '',
      '{{company_name}}': txt_(company.name),
      '{{company_address}}': [txt_(company.address), txt_(company.city), txt_(company.state), txt_(company.pincode)].filter(function (x) { return !!x; }).join(', '),
      '{{company_gstin}}': txt_(company.gstin),
      '{{branch_name}}': branch ? txt_(branch.name) : '',
      '{{today}}': fmtDateHuman_(todayIso_()),
      '{{issue_date}}': fmtDateHuman_(issueDate || todayIso_()),
      '{{signer_name}}': txt_(e.signer_name || (company.admin_name || ctx.name)),
      '{{location}}': txt_(e.location || (project ? project.city : '') || txt_(employee.work_state)),
      '{{effective_date}}': fmtDateHuman_(e.effective_date || todayIso_()),
      '{{purpose}}': txt_(e.purpose),
      '{{notice_days}}': txt_(e.notice_days || '30'),
      '{{last_working_day}}': fmtDateHuman_(e.last_working_day || employee.exit_date || ''),
      '{{amount}}': txt_(e.amount),
      '{{reference_no}}': txt_(e.reference_no),
      '{{remarks}}': txt_(e.remarks)
    };
  },

  fill_: function (text, values) {
    var out = txt_(text);
    Object.keys(values).forEach(function (k) {
      out = out.split(k).join(escapeHtml_(values[k]));
    });
    return out;
  },

  letterHtml_: function (ctx, template, employee, extra, issueDate) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var company = c.company || companyRow_(ctx.companyId);
    var values = Documents.values_(ctx, employee, extra, issueDate);
    var brand = txt_(company.brand_color) || '#2563eb';
    var body = Documents.fill_(template.body_html, values);
    var subject = Documents.fill_(template.subject, values);
    var letterNo = txt_(extra && extra.letter_no);
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml_(subject) + '</title>' +
      '<style>' +
      '@page{size:A4;margin:18mm}' +
      'body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;font-size:12.5pt;line-height:1.65;margin:0}' +
      '.sheet{max-width:190mm;margin:0 auto;padding:6mm 0}' +
      '.head{display:flex;gap:6mm;align-items:flex-start;border-bottom:2px solid ' + brand + ';padding-bottom:4mm;margin-bottom:8mm}' +
      '.logo{height:18mm;width:18mm;object-fit:contain;border-radius:2mm;background:' + brand + ';color:#fff;display:flex;align-items:center;justify-content:center;font-family:Inter,Arial,sans-serif;font-weight:700}' +
      '.cname{font-family:Inter,Arial,sans-serif;font-size:17pt;font-weight:700;letter-spacing:.2px}' +
      '.cmeta{font-family:Inter,Arial,sans-serif;font-size:9.5pt;color:#475569}' +
      '.ref{display:flex;justify-content:space-between;font-family:Inter,Arial,sans-serif;font-size:10pt;color:#334155;margin-bottom:6mm}' +
      '.subject{font-weight:700;text-decoration:underline;margin-bottom:5mm}' +
      'p{margin:0 0 4mm}' +
      '.sign{margin-top:14mm;font-family:Inter,Arial,sans-serif;font-size:10.5pt}' +
      '.sigline{border-bottom:1px solid #94a3b8;width:60mm;height:12mm}' +
      '.foot{margin-top:12mm;border-top:1px dashed #cbd5e1;padding-top:3mm;font-family:Inter,Arial,sans-serif;font-size:8.5pt;color:#94a3b8}' +
      '</style></head><body><div class="sheet">' +
      '<div class="head">' +
      (txt_(company.logo_file_id)
        ? '<img class="logo" style="background:transparent" src="https://drive.google.com/thumbnail?id=' + escapeHtml_(company.logo_file_id) + '&sz=w200" alt="logo"/>'
        : '<div class="logo">' + escapeHtml_(txt_(company.name).slice(0, 2).toUpperCase()) + '</div>') +
      '<div><div class="cname">' + escapeHtml_(txt_(company.name)) + '</div>' +
      '<div class="cmeta">' + escapeHtml_([txt_(company.address), txt_(company.city), txt_(company.state), txt_(company.pincode)].filter(function (x) { return !!x; }).join(', ')) + '</div>' +
      '<div class="cmeta">' + (txt_(company.gstin) ? 'GSTIN: ' + escapeHtml_(company.gstin) + ' · ' : '') +
      (txt_(company.contact_email) ? escapeHtml_(company.contact_email) : '') + '</div></div></div>' +
      '<div class="ref"><div>Ref: ' + escapeHtml_(letterNo || '—') + '</div>' +
      '<div>Date: ' + escapeHtml_(fmtDateHuman_(issueDate || todayIso_())) + '</div></div>' +
      '<div class="subject">' + escapeHtml_(subject) + '</div>' +
      body +
      '<div class="foot">This letter was generated by ' + escapeHtml_(APP.name) + ' on ' + escapeHtml_(fmtDateHuman_(nowIso_(), 'dd MMM yyyy HH:mm')) +
      ' and is valid without a physical seal.</div>' +
      '</div></body></html>';
  },

  letterPreview: function (ctx, payload) {
    Perm.require(ctx, 'documents.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var template = Documents.template_(ctx, payload.template_id);
    var employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var html = Documents.letterHtml_(ctx, template, employee, payload.extra, payload.issue_date);
    return {
      html: html, subject: Documents.fill_(template.subject, Documents.values_(ctx, employee, payload.extra, payload.issue_date)),
      template: { code: txt_(template.code), name: txt_(template.name) },
      employee: { employee_id: employee.employee_id, name: txt_(employee.name), code: txt_(employee.code) }
    };
  },

  letterGenerate: function (ctx, payload) {
    Perm.require(ctx, 'documents.create');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var template = Documents.template_(ctx, payload.template_id);
    var employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
    var issueDate = txt_(payload.issue_date) || todayIso_();
    var letterNo = Db.nextId(c, 'GeneratedLetters');
    var html = Documents.letterHtml_(ctx, template, employee, payload.extra, issueDate);
    var subject = Documents.fill_(template.subject, Documents.values_(ctx, employee, payload.extra, issueDate));
    var saved = null;
    if (payload.save_file === undefined || boolVal_(payload.save_file)) {
      var file = Files.saveGenerated(ctx, {
        html: html, name: letterNo + '_' + txt_(template.code) + '_' + txt_(employee.code) + '.pdf',
        mime: 'application/pdf', folder_key: 'letter', fy: fyOf_(issueDate)
      });
      saved = { file_id: file.getId(), file_name: file.getName(), url: file.getUrl() };
    }
    var row = Db.insert(c, 'GeneratedLetters', {
      template_id: txt_(template.template_id) || txt_(template.code), employee_id: employee.employee_id,
      employee_name: txt_(employee.name), letter_no: letterNo, subject: subject, body_html: html,
      file_id: saved ? saved.file_id : '', file_name: saved ? saved.file_name : '',
      issued_date: issueDate, issued_by: ctx.userId, issued_by_name: txt_(ctx.name), status: 'ISSUED',
      note: txt_(payload.extra && payload.extra.remarks)
    }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'documents', action: 'documents.letters.generate', entity: 'GeneratedLetters', entity_id: row.letter_id,
      after: { employee: txt_(employee.name), template: txt_(template.code), letter_no: letterNo, file: saved ? saved.file_name : 'not saved' },
      note: txt_(template.name) + ' issued to ' + txt_(employee.name) + ' (' + letterNo + ')'
    });
    try {
      if (txt_(employee.user_id)) {
        Notify.push([txt_(employee.user_id)], {
          company_id: ctx.companyId, title: 'New letter issued: ' + txt_(template.name),
          body: letterNo + ' — ' + subject + '. Open Documents → My letters to download it.',
          kind: 'INFO', link_action: 'documents.letters.my', link_payload: { letter_id: row.letter_id }
        });
      }
    } catch (e) { /* notification is optional */ }
    return {
      letter: {
        letter_id: row.letter_id, letter_no: letterNo, subject: subject, issued_date: issueDate,
        employee_name: txt_(employee.name), file_id: saved ? saved.file_id : '', file_name: saved ? saved.file_name : ''
      },
      url: saved ? saved.url : '', html: html,
      message: txt_(template.name) + ' generated for ' + txt_(employee.name) + ' (' + letterNo + ')' + (saved ? ' and saved as a PDF.' : '.')
    };
  },

  lettersList: function (ctx, payload) {
    Perm.require(ctx, 'documents.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'GeneratedLetters', function (l) {
      if (allowed && allowed.indexOf(txt_(l.employee_id)) < 0) return false;
      if (payload.employee_id && txt_(l.employee_id) !== txt_(payload.employee_id)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (l) { return matchesSearch_(l, ['letter_no', 'employee_name', 'subject'], payload.search); });
    rows = sortRows_(rows, 'issued_date', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (l) {
        var t = DEFAULT_LETTER_TEMPLATES.filter(function (x) { return x.code === txt_(l.template_id); })[0];
        return {
          letter_id: l.letter_id, letter_no: txt_(l.letter_no), subject: txt_(l.subject),
          template_code: txt_(l.template_id), template_name: t ? t.name : txt_(l.template_id),
          employee_id: txt_(l.employee_id), employee_name: txt_(l.employee_name),
          issued_date: txt_(l.issued_date), issued_by_name: txt_(l.issued_by_name),
          file_id: txt_(l.file_id), file_name: txt_(l.file_name), status: txt_(l.status), note: txt_(l.note)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      total_generated: rows.length
    };
  },

  lettersMy: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0 };
    var rows = sortRows_(Db.all(c, 'GeneratedLetters', function (l) {
      return txt_(l.employee_id) === ctx.employeeId && txt_(l.status) !== 'DRAFT';
    }), 'issued_date', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (l) {
        return {
          letter_id: l.letter_id, letter_no: txt_(l.letter_no), subject: txt_(l.subject),
          template_code: txt_(l.template_id), issued_date: txt_(l.issued_date), file_id: txt_(l.file_id),
          file_name: txt_(l.file_name), issued_by_name: txt_(l.issued_by_name)
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      templates: Documents.templatesForEmployee_(ctx)
    };
  },

  /** Letters an employee may self-serve request (HR still issues the final copy). */
  templatesForEmployee_: function (ctx) {
    return Documents.templatesList(ctx).rows.filter(function (t) {
      return boolVal_(t.is_active) !== false && ['SALARY', 'EXPERIENCE', 'ADDRESS_PROOF', 'BONAFIDE'].indexOf(txt_(t.code)) >= 0;
    });
  },

  /* ===================================================== expiry watch ===== */
  expiring_: function (c, days) {
    var horizon = isoAddDays_(todayIso_(), intVal_(days, 30));
    var out = [];
    Db.all(c, 'EmployeeDocuments').forEach(function (d) {
      if (txt_(d.expiry_date) && txt_(d.expiry_date) <= horizon) {
        out.push({ source: 'EMPLOYEE_DOC', owner_id: txt_(d.employee_id), title: txt_(d.doc_name || d.doc_type), expiry_date: txt_(d.expiry_date), doc_id: txt_(d.doc_id) });
      }
    });
    Db.all(c, 'Documents').forEach(function (d) {
      if (boolVal_(d.is_latest) && txt_(d.expiry_date) && txt_(d.expiry_date) <= horizon) {
        out.push({ source: 'DOCUMENT', owner_id: txt_(d.owner_id), title: txt_(d.title), expiry_date: txt_(d.expiry_date), doc_id: txt_(d.doc_id) });
      }
    });
    return sortRows_(out, 'expiry_date', 'ASC');
  },

  /** Time trigger: remind admins about documents that lapse soon. */
  sendExpiryReminders: function () {
    var companies = Db.all(masterCtx_(), 'Companies', function (c) { return txt_(c.status) === 'ACTIVE'; });
    var sent = 0;
    companies.forEach(function (company) {
      try {
        var ctx = { companyId: txt_(company.company_id), scope: 'COMPANY', userId: 'system', name: 'FocusHR', companyCtx: companyCtx_(company.company_id, { requireActive: false }) };
        var soon = Documents.expiring_(ctx.companyCtx, 30);
        if (!soon.length) return;
        var admins = Db.all(masterCtx_(), 'Users', function (u) {
          return txt_(u.company_id) === txt_(company.company_id) && txt_(u.status) === 'ACTIVE' &&
            ['COMPANY_ADMIN', 'HR_MANAGER'].indexOf(txt_(u.role_code)) >= 0;
        });
        var title = soon.length + ' document(s) expire within 30 days';
        var lines = soon.slice(0, 20).map(function (d) {
          return '• ' + d.title + ' — ' + fmtDateHuman_(d.expiry_date);
        }).join('\n');
        admins.forEach(function (u) {
          Notify.push([txt_(u.user_id)], {
            company_id: txt_(company.company_id), title: title, body: lines, kind: 'WARNING',
            link_action: 'reports.run', link_payload: { report: 'document_expiry' }
          });
          Notify.send({
            channel: 'EMAIL', to: txt_(u.email), user_id: txt_(u.user_id), company_id: txt_(company.company_id),
            subject: '[' + txt_(company.name) + '] ' + title,
            html: '<p>Hello ' + escapeHtml_(txt_(u.name)) + ',</p><p>These documents need attention:</p><pre style="font-family:Inter,Arial,sans-serif">' +
              escapeHtml_(lines) + '</pre><p>Open ' + escapeHtml_(APP.name) + ' → Reports → Document expiry watchlist to act on them.</p>',
            related_type: 'Documents', related_id: soon[0].doc_id
          });
          sent++;
        });
      } catch (e) {
        logEvent_('WARN', 'Documents.sendExpiryReminders', 'Skipped ' + company.company_id + ': ' + e.message, {});
      }
    });
    logEvent_('INFO', 'Documents.sendExpiryReminders', sent + ' reminder(s) queued', {});
    return { reminders: sent };
  }
};

/** Small helper used by the document screens for human readable sizes. */
function sizeLabel_(bytes) {
  var b = intVal_(bytes, 0);
  if (b <= 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
