/**
 * ============================================================================
 *  FocusHR  —  Company.gs
 *  Tenant provisioning + everything in the Company Admin panel:
 *  workspace, settings, profile, branches, roles, permissions, users,
 *  holidays, leave types, expense categories and statutory rates.
 * ============================================================================
 */

var Company = {

  /* ======================================================= provisioning === */
  /**
   * Create (or repair) a company workspace: spreadsheet with all tabs,
   * default settings, roles, leave types, expense categories, letter
   * templates and the Drive folder tree.
   */
  provision_: function (company, meta, opts) {
    var o = opts || {};
    var companyId = txt_(company.company_id);
    var ss;
    if (txt_(company.spreadsheet_id)) {
      try { ss = SpreadsheetApp.openById(txt_(company.spreadsheet_id)); } catch (e) { ss = null; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create(APP.name + ' — ' + txt_(company.name) + ' (' + companyId + ')');
      try { ss.setSpreadsheetTimeZone(APP.timezone); } catch (e2) { /* optional */ }
      Db.update(masterCtx_(), 'Companies', 'company_id', companyId, { spreadsheet_id: ss.getId() }, { system: true });
    }
    memoClear_();
    var updated = companyRow_(companyId);
    var ctx = companyCtx_(companyId, { requireActive: false });

    var created = createAllTables_(ctx);

    // default settings for this workspace
    var existingSettings = {};
    Db.all(ctx, 'Settings').forEach(function (s) { existingSettings[txt_(s.key)] = true; });
    var settingsSeeded = 0;
    DEFAULT_SETTINGS.forEach(function (s) {
      if (existingSettings[s.key]) return;
      var value = s.value;
      if (s.key === 'company.display_name' || s.key === 'company.legal_name') value = txt_(updated.name);
      if (s.key === 'company.legal_name') value = txt_(updated.legal_name || updated.name);
      if (s.key === 'company.gstin') value = txt_(updated.gstin);
      if (s.key === 'company.pan') value = txt_(updated.pan);
      if (s.key === 'company.address') value = txt_(updated.address);
      if (s.key === 'company.city') value = txt_(updated.city);
      if (s.key === 'company.state') value = txt_(updated.state);
      if (s.key === 'company.pincode') value = txt_(updated.pincode);
      if (s.key === 'company.brand_color') value = txt_(updated.brand_color) || '#2563eb';
      if (s.key === 'company.hr_contact_email') value = normEmail_(updated.admin_email);
      if (s.key === 'payroll.pt_state') value = txt_(updated.state) || 'Maharashtra';
      setSetting_(ctx, s.key, value, { value_type: s.value_type, group_name: s.group_name, label: s.label, description: s.description || '' });
      settingsSeeded++;
    });

    // roles + permissions
    var roleMap = {};
    Db.all(ctx, 'Roles').forEach(function (r) { roleMap[txt_(r.code)] = r; });
    var rolesSeeded = 0;
    ROLE_PRESETS.forEach(function (preset) {
      var role = roleMap[preset.code];
      if (!role) {
        role = Db.insert(ctx, 'Roles', {
          code: preset.code, name: preset.name, description: preset.description,
          data_scope: preset.data_scope, is_system: 'TRUE', level: preset.level, is_active: 'TRUE'
        }, { system: true });
        rolesSeeded++;
      }
      Company.writePermissions_(ctx, role, preset.perms, true);
    });

    // leave types
    var leaveTypesSeeded = 0;
    if (!Db.count(ctx, 'LeaveTypes')) {
      DEFAULT_LEAVE_TYPES.forEach(function (t) {
        Db.insert(ctx, 'LeaveTypes', {
          code: t.code, name: t.name, is_paid: t.is_paid ? 'TRUE' : 'FALSE', accrual_per_month: t.accrual_per_month,
          max_balance: t.max_balance, carry_forward: t.carry_forward, requires_doc: t.requires_doc,
          max_consecutive_days: t.max_consecutive_days, color: t.color, is_active: 'TRUE', sort_order: t.sort_order
        }, { system: true });
        leaveTypesSeeded++;
      });
    }

    // expense categories
    var categoriesSeeded = 0;
    if (!Db.count(ctx, 'ExpenseCategories')) {
      DEFAULT_EXPENSE_CATEGORIES.forEach(function (t) {
        Db.insert(ctx, 'ExpenseCategories', {
          code: t.code, name: t.name, max_amount: t.max_amount, requires_bill: t.requires_bill,
          is_taxable: t.is_taxable, is_active: 'TRUE', sort_order: t.sort_order
        }, { system: true });
        categoriesSeeded++;
      });
    }

    // letter templates
    var lettersSeeded = 0;
    if (!Db.count(ctx, 'LetterTemplates')) {
      DEFAULT_LETTER_TEMPLATES.forEach(function (t) {
        Db.insert(ctx, 'LetterTemplates', {
          code: t.code, name: t.name, category: t.category, subject: t.subject, body_html: t.body_html, is_active: 'TRUE'
        }, { system: true });
        lettersSeeded++;
      });
    }

    // holidays for the current and next calendar year
    var holidaysSeeded = Company.seedHolidays_(ctx);

    // Drive tree
    var folder = Files.companyFolderById_(companyId);

    // admin user
    var adminUser = null;
    var adminEmail = normEmail_(o.admin_email || updated.admin_email);
    if (adminEmail) {
      adminUser = Db.findOne(masterCtx_(), 'Users', function (u) {
        return normEmail_(u.email) === adminEmail && txt_(u.company_id) === companyId;
      });
      if (!adminUser) {
        var pwd = txt_(o.admin_password) || strongTempPassword_();
        var salt = randomSalt_();
        adminUser = Db.insert(masterCtx_(), 'Users', {
          scope: 'COMPANY', company_id: companyId, employee_id: '', name: txt_(o.admin_name || updated.admin_name),
          email: adminEmail, phone: normPhone_(updated.admin_phone), password_salt: salt,
          password_hash: hashPassword_(pwd, salt), password_set_at: nowIso_(),
          must_change_password: o.admin_password ? 'FALSE' : 'TRUE',
          status: 'ACTIVE', role_code: 'COMPANY_ADMIN', meta_json: jsonStr_({ source: o.source || 'SIGNUP' })
        }, { system: true });
        o.generated_password = o.admin_password ? '' : pwd;
      }
      if (txt_(adminUser.user_id) !== txt_(updated.admin_user_id)) {
        Db.update(masterCtx_(), 'Companies', 'company_id', companyId, { admin_user_id: adminUser.user_id }, { system: true });
      }
    }
    // register the tenant in the platform address book for the login page
    memoDrop_('__ctx_' + companyId);
    var finalRow = companyRow_(companyId);

    var summary = {
      company_id: companyId,
      company_name: txt_(finalRow.name),
      spreadsheet_id: ss.getId(),
      spreadsheet_url: ss.getUrl(),
      drive_folder_id: folder.getId(),
      drive_folder_url: folder.getUrl(),
      tables_created: created,
      settings_seeded: settingsSeeded,
      roles_seeded: rolesSeeded,
      leave_types_seeded: leaveTypesSeeded,
      categories_seeded: categoriesSeeded,
      letters_seeded: lettersSeeded,
      holidays_seeded: holidaysSeeded,
      admin_user_id: adminUser ? adminUser.user_id : '',
      admin_email: adminUser ? adminUser.email : '',
      admin_temp_password: txt_(o.generated_password),
      provisioned_at: nowIso_()
    };
    logEvent_('INFO', 'Company.provision', 'Workspace ready for ' + summary.company_name + ' (' + companyId + ')', {
      spreadsheet: ss.getId(), tables: created.length
    });
    return summary;
  },

  /** Write a role's permission set. `perms` may be '*' or {module: 'view,create'}. */
  writePermissions_: function (ctx, role, perms, onlyIfEmpty) {
    var existing = Db.all(ctx, 'RolePermissions', function (r) { return txt_(r.role_id) === txt_(role.role_id); });
    if (onlyIfEmpty && existing.length) return existing.length;
    existing.forEach(function (r) {
      Db.softDelete(ctx, 'RolePermissions', 'perm_id', r.perm_id, { system: true });
    });
    var wanted = [];
    if (perms === '*') {
      MODULES.forEach(function (m) { (m.actions || []).forEach(function (a) { wanted.push([m.key, a]); }); });
    } else if (perms instanceof Array) {
      perms.forEach(function (key) { var p = txt_(key).split('.'); if (p.length === 2) wanted.push([p[0], p[1]]); });
    } else if (perms && typeof perms === 'object') {
      Object.keys(perms).forEach(function (mod) {
        txt_(perms[mod]).split(',').forEach(function (a) { if (txt_(a).trim()) wanted.push([mod, txt_(a).trim()]); });
      });
    }
    wanted.forEach(function (pair) {
      Db.insert(ctx, 'RolePermissions', {
        role_id: role.role_id, role_code: role.code, module: pair[0], action: pair[1], allowed: 'TRUE'
      }, { system: true });
    });
    return wanted.length;
  },

  /** Public/national holidays for the current and next year (editable). */
  seedHolidays_: function (ctx) {
    var template = [
      ['2025-01-26', 'Republic Day'], ['2025-03-14', 'Holi'], ['2025-04-14', 'Dr. Ambedkar Jayanti'],
      ['2025-04-18', 'Good Friday'], ['2025-05-01', 'Maharashtra Day / Labour Day'], ['2025-08-15', 'Independence Day'],
      ['2025-08-27', 'Ganesh Chaturthi'], ['2025-10-02', 'Gandhi Jayanti & Dussehra'], ['2025-10-20', 'Diwali (Laxmi Pujan)'],
      ['2025-11-05', 'Guru Nanak Jayanti'], ['2025-12-25', 'Christmas'],
      ['2026-01-01', 'New Year'], ['2026-01-26', 'Republic Day'], ['2026-03-04', 'Holi'],
      ['2026-04-03', 'Good Friday'], ['2026-04-14', 'Dr. Ambedkar Jayanti'], ['2026-05-01', 'Maharashtra Day / Labour Day'],
      ['2026-08-15', 'Independence Day'], ['2026-09-14', 'Ganesh Chaturthi'], ['2026-10-02', 'Gandhi Jayanti'],
      ['2026-11-08', 'Diwali (Laxmi Pujan)'], ['2026-11-24', 'Guru Nanak Jayanti'], ['2026-12-25', 'Christmas']
    ];
    var seedNote = 'Seeded automatically — please verify with your state holiday list and edit or remove as needed.';
    var year = Number(todayIso_().slice(0, 4));
    var wanted = [String(year), String(year + 1), String(year - 1)];
    var existing = {};
    Db.all(ctx, 'Holidays').forEach(function (h) { existing[txt_(h.date)] = true; });
    var seeded = 0;
    template.forEach(function (row) {
      if (wanted.indexOf(row[0].slice(0, 4)) < 0) return;
      if (existing[row[0]]) return;
      Db.insert(ctx, 'Holidays', { name: row[1], date: row[0], kind: 'PUBLIC', region: 'ALL', is_paid: 'TRUE', note: seedNote }, { system: true });
      seeded++;
    });
    return seeded;
  },

  /* ============================================================ bootstrap = */
  bootstrap: function (ctx) {
    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    var eff = Perm.load(ctx);
    var settings = settingsMap_(ctx);
    var out = {
      session: Auth.sessionInfo(ctx),
      settings: settings,
      setting_groups: uniq_(DEFAULT_SETTINGS.map(function (s) { return s.group_name; })),
      leave_types: Leave.typesList(ctx).rows,
      expense_categories: Expense.categoriesList(ctx).rows,
      holidays: Company.holidaysList(ctx, { year: todayIso_().slice(0, 4) }).rows,
      branches: Company.branchOptions_(ctx),
      projects: Projects.options_(ctx),
      employees: EmployeeOptions.list(ctx),
      roles: Db.all(compCtx, 'Roles').filter(function (r) { return boolVal_(r.is_active) !== false; }).map(function (r) {
        return { role_id: r.role_id, code: r.code, name: r.name, data_scope: r.data_scope, level: r.level, is_system: boolVal_(r.is_system) };
      }),
      modules: MODULES.filter(function (m) {
        if (eff.isSuper) return true;
        return (m.actions || []).some(function (a) { return Perm.has(ctx, m.key + '.' + a); });
      }).map(function (m) {
        return {
          key: m.key, label: m.label,
          actions: (m.actions || []).filter(function (a) { return Perm.has(ctx, m.key + '.' + a); })
        };
      }),
      dashboard_layout: Dashboard.layoutGet(ctx),
      unread_notifications: Notify.unreadCount(ctx).unread,
      constants: {
        statuses: STATUS,
        states: INDIAN_STATES,
        pt_states: Object.keys(PT_SLABS),
        month_names: MONTH_NAMES,
        roles_presets: ROLE_PRESETS.map(function (r) { return { code: r.code, name: r.name, data_scope: r.data_scope }; }),
        expense_request_kinds: ['ADVANCE', 'OVERTIME', 'COMPOFF', 'CONVEYANCE', 'MEDICAL', 'BONUS', 'OTHER'],
        document_categories: ['ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'EXPERIENCE', 'BANK', 'PF', 'ESIC', 'MEDICAL', 'OTHER'],
        document_types: ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'PHOTO', 'RESUME', 'OFFER_LETTER', 'RELIEVING_LETTER', 'PAYSLIP', 'BANK_PROOF', 'MEDICAL_CERTIFICATE', 'OTHER'],
        ticket_categories: ['PAYROLL', 'ATTENDANCE', 'LEAVE', 'EXPENSE', 'PROFILE', 'DOCUMENT', 'OTHER'],
        ticket_priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT']
      }
    };
    return out;
  },

  /* ============================================================= settings = */
  settingsGet: function (ctx) {
    Perm.require(ctx, 'settings.view');
    var rows = Db.all(ctx.companyCtx, 'Settings').map(function (r) {
      return {
        setting_id: r.setting_id, key: r.key, value: r.value, value_type: r.value_type,
        group_name: r.group_name, label: r.label, description: r.description,
        effective_from: r.effective_from, version: intVal_(r.version, 1), updated_at: r.updated_at, updated_by: r.updated_by
      };
    });
    var known = {};
    rows.forEach(function (r) { known[r.key] = true; });
    DEFAULT_SETTINGS.forEach(function (d) {
      if (known[d.key]) return;
      rows.push({
        setting_id: '', key: d.key, value: d.value, value_type: d.value_type,
        group_name: d.group_name, label: d.label, description: d.description || '', effective_from: '', version: 0,
        updated_at: '', updated_by: ''
      });
    });
    return {
      items: sortRows_(rows, 'key', 'ASC'),
      groups: uniq_(rows.map(function (r) { return r.group_name; })),
      editable_groups: ['Company', 'Attendance', 'Leave', 'Expense', 'General']
    };
  },

  settingsSave: function (ctx, payload) {
    Perm.require(ctx, 'settings.edit');
    var items = payload.items || [];
    if (!items.length) fail_('VALIDATION', 'Nothing to save.');
    var changed = [];
    items.forEach(function (item) {
      var key = txt_(item.key);
      if (!key) return;
      var meta = null;
      DEFAULT_SETTINGS.forEach(function (d) { if (d.key === key) meta = d; });
      var before = getSetting_(ctx, key, '');
      var raw = item.value;
      if (meta && meta.value_type === 'boolean') raw = boolVal_(raw) ? 'TRUE' : 'FALSE';
      if (meta && meta.value_type === 'number') {
        if (raw === '' || isNaN(Number(raw))) fail_('VALIDATION', fieldLabel_(key) + ' must be a number.');
        raw = String(numVal_(raw));
      }
      if (key === 'attendance.radius_m' && numVal_(raw) < 10) fail_('VALIDATION', 'The geo-fence radius should be at least 10 metres.');
      if (key.indexOf('payroll.') === 0 && key.indexOf('_pct') > 0 && (numVal_(raw) < 0 || numVal_(raw) > 100)) {
        fail_('VALIDATION', fieldLabel_(key) + ' must be between 0 and 100.');
      }
      if (raw === before) return;
      setSetting_(ctx, key, raw, meta ? { value_type: meta.value_type, group_name: meta.group_name, label: meta.label, description: meta.description } : null);
      changed.push({ key: key, from: before, to: raw });
    });
    if (!changed.length) return { saved: 0, message: 'No changes to save.' };
    Audit.write(ctx, {
      module: 'settings', action: 'company.settings.save', entity: 'Settings', entity_id: '',
      before: { items: changed.map(function (c) { return { key: c.key, value: c.from }; }) },
      after: { items: changed.map(function (c) { return { key: c.key, value: c.to }; }) },
      note: payload.reason ? 'Reason: ' + payload.reason : 'Settings updated (' + changed.length + ' keys)'
    });
    Perm.load(ctx).permissions = Perm.load(ctx).permissions; // keep memo warm
    memoDrop_('__perms_' + ctx.userId);
    return { saved: changed.length, changed: changed, settings: settingsMap_(ctx) };
  },

  profileSave: function (ctx, payload) {
    Perm.require(ctx, 'settings.edit');
    var before = companyRow_(ctx.companyId);
    var patch = {};
    ['address', 'city', 'state', 'pincode', 'brand_color', 'logo_file_id'].forEach(function (k) {
      if (payload[k] !== undefined) patch[k] = payload[k];
    });
    if (payload.name) {
      if (txt_(payload.name).length < 3) fail_('VALIDATION', 'Company name is too short.');
      patch.name = txt_(payload.name);
    }
    if (Object.keys(patch).length) {
      Db.update(masterCtx_(), 'Companies', 'company_id', ctx.companyId, patch, { actor: ctx.userId });
      memoDrop_('__ctx_' + ctx.companyId);
    }
    if (payload.address !== undefined) setSetting_(ctx, 'company.address', txt_(payload.address));
    if (payload.city !== undefined) setSetting_(ctx, 'company.city', txt_(payload.city));
    if (payload.state !== undefined) setSetting_(ctx, 'company.state', txt_(payload.state));
    if (payload.pincode !== undefined) setSetting_(ctx, 'company.pincode', txt_(payload.pincode));
    if (payload.brand_color) setSetting_(ctx, 'company.brand_color', txt_(payload.brand_color));
    if (payload.logo_file_id) setSetting_(ctx, 'company.logo_file_id', txt_(payload.logo_file_id));
    if (payload.brand_color) {
      Audit.write(ctx, { module: 'settings', action: 'company.profile.save', entity: 'Companies', entity_id: ctx.companyId, before: { brand_color: before.brand_color }, after: { brand_color: payload.brand_color }, note: 'Company profile / branding updated' });
    }
    var fresh = companyRow_(ctx.companyId);
    return {
      saved: true,
      company: {
        company_id: fresh.company_id, name: fresh.name, city: fresh.city, state: fresh.state, address: fresh.address,
        pincode: fresh.pincode, brand_color: txt_(fresh.brand_color) || '#2563eb', logo_file_id: fresh.logo_file_id
      }
    };
  },

  /* ============================================================= branches = */
  setContext_: function (ctx) {
    if (ctx.scope === 'SUPER') fail_('FORBIDDEN', 'This screen belongs to a company workspace.');
    if (!ctx.companyCtx) ctx.companyCtx = companyCtx_(ctx.companyId);
    return ctx.companyCtx;
  },

  branchOptions_: function (ctx) {
    var c = Company.setContext_(ctx);
    return Db.all(c, 'Branches', function (b) { return boolVal_(b.is_active) !== false; }).map(function (b) {
      return { branch_id: b.branch_id, name: b.name, code: b.code, city: b.city, state: b.state };
    });
  },

  branchesList: function (ctx, payload) {
    Perm.require(ctx, 'branches.view');
    var c = Company.setContext_(ctx);
    return Db.query(c, 'Branches', {
      search: payload.search, page: payload.page, pageSize: payload.pageSize, sort: payload.sort || 'name', dir: payload.dir || 'ASC',
      filter: function (r) {
        if (payload.is_active === 'TRUE' && boolVal_(r.is_active) === false) return false;
        if (payload.is_active === 'FALSE' && boolVal_(r.is_active) !== false) return false;
        return true;
      },
      mapper: function (r) {
        return {
          branch_id: r.branch_id, name: r.name, code: r.code, address: r.address, city: r.city, state: r.state,
          pincode: r.pincode, phone: r.phone, incharge_name: r.incharge_name, latitude: r.latitude, longitude: r.longitude,
          is_active: boolVal_(r.is_active) !== false, note: r.note, created_at: r.created_at,
          employees: Db.count(c, 'Employees', function (e) { return txt_(e.branch_id) === txt_(r.branch_id); })
        };
      }
    });
  },

  branchesSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    var isNew = !payload.branch_id;
    Perm.require(ctx, isNew ? 'branches.create' : 'branches.edit');
    var patch = {
      name: payload.name, code: txt_(payload.code).toUpperCase(), address: payload.address, city: payload.city,
      state: payload.state, pincode: payload.pincode, phone: payload.phone, incharge_name: payload.incharge_name,
      latitude: payload.latitude, longitude: payload.longitude,
      is_active: payload.is_active === undefined ? 'TRUE' : (payload.is_active ? 'TRUE' : 'FALSE'),
      note: payload.note
    };
    if (!isNew) {
      var before = Db.get(c, 'Branches', 'branch_id', payload.branch_id);
      var updated = Db.update(c, 'Branches', 'branch_id', payload.branch_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'branches', action: 'company.branches.save', entity: 'Branches', entity_id: payload.branch_id, before: before, after: patch, note: 'Branch updated' });
      return { branch_id: updated.branch_id, created: false };
    }
    var row = Db.insert(c, 'Branches', patch, { actor: ctx.userId });
    Audit.write(ctx, { module: 'branches', action: 'company.branches.save', entity: 'Branches', entity_id: row.branch_id, after: patch, note: 'Branch created' });
    return { branch_id: row.branch_id, created: true };
  },

  branchesDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'branches.delete');
    var inUse = Db.count(c, 'Employees', function (e) { return txt_(e.branch_id) === txt_(payload.branch_id); });
    if (inUse) fail_('IN_USE', 'This branch is still linked to ' + inUse + ' employee(s). Move them to another branch first.');
    var before = Db.get(c, 'Branches', 'branch_id', payload.branch_id);
    Db.softDelete(c, 'Branches', 'branch_id', payload.branch_id, { actor: ctx.userId });
    Audit.write(ctx, { module: 'branches', action: 'company.branches.delete', entity: 'Branches', entity_id: payload.branch_id, before: before, note: 'Branch removed' });
    return { deleted: true };
  },

  /* ================================================================ roles = */
  rolesList: function (ctx) {
    Perm.require(ctx, 'users.view');
    var c = Company.setContext_(ctx);
    var counts = {};
    Db.all(c, 'RolePermissions', function (r) { return boolVal_(r.allowed); }).forEach(function (r) {
      counts[txt_(r.role_id)] = (counts[txt_(r.role_id)] || 0) + 1;
    });
    var userCounts = {};
    Db.all(masterCtx_(), 'Users', function (u) { return txt_(u.company_id) === ctx.companyId; }).forEach(function (u) {
      userCounts[txt_(u.role_code)] = (userCounts[txt_(u.role_code)] || 0) + 1;
    });
    return {
      rows: sortRows_(Db.all(c, 'Roles').map(function (r) {
        return {
          role_id: r.role_id, code: r.code, name: r.name, description: r.description, data_scope: r.data_scope,
          is_system: boolVal_(r.is_system), level: intVal_(r.level, 5), is_active: boolVal_(r.is_active) !== false,
          permission_count: counts[txt_(r.role_id)] || 0, user_count: userCounts[txt_(r.code)] || 0
        };
      }), 'level', 'ASC'),
      modules: MODULES
    };
  },

  rolesGet: function (ctx, payload) {
    Perm.require(ctx, 'users.view');
    return Perm.matrix(ctx, payload.role_id);
  },

  rolesSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.manage');
    var perms = payload.permissions || {};
    var isNew = !payload.role_id;
    if (isNew) {
      if (txt_(payload.code)) {
        var dupe = Db.findOne(c, 'Roles', function (r) { return txt_(r.code).toUpperCase() === txt_(payload.code).toUpperCase(); });
        if (dupe) fail_('DUPLICATE', 'A role with this code already exists.');
      }
      var created = Db.insert(c, 'Roles', {
        code: txt_(payload.code || payload.name).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 24),
        name: payload.name, description: payload.description, data_scope: payload.data_scope || 'SELF',
        is_system: 'FALSE', level: payload.level || 5, is_active: 'TRUE'
      }, { actor: ctx.userId });
      Company.writePermissions_(c, created, perms);
      Audit.write(ctx, { module: 'users', action: 'company.roles.save', entity: 'Roles', entity_id: created.role_id, after: { name: payload.name, data_scope: payload.data_scope, permissions: perms }, note: 'Role created' });
      return { role_id: created.role_id, created: true };
    }
    var before = Db.get(c, 'Roles', 'role_id', payload.role_id);
    if (boolVal_(before.is_system) && txt_(before.code) !== 'COMPANY_ADMIN' && txt_(payload.data_scope) && txt_(payload.data_scope) !== txt_(before.data_scope)) {
      // allow changing data scope of system roles, just record it
      Audit.info(ctx, 'users', 'company.roles.scope_change', 'Roles', before.role_id, 'Data scope ' + before.data_scope + ' → ' + payload.data_scope);
    }
    var patch = {
      name: payload.name || before.name,
      description: payload.description === undefined ? before.description : payload.description,
      data_scope: payload.data_scope || before.data_scope,
      level: payload.level === undefined ? before.level : payload.level
    };
    if (!boolVal_(before.is_system)) patch.code = txt_(payload.code || before.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (txt_(before.code) === 'COMPANY_ADMIN' && payload.data_scope && txt_(payload.data_scope) !== 'ALL') {
      fail_('VALIDATION', 'The Company Admin role must always keep full access (data scope ALL).');
    }
    Db.update(c, 'Roles', 'role_id', before.role_id, patch, { actor: ctx.userId });
    Company.writePermissions_(c, before, perms);
    Audit.write(ctx, {
      module: 'users', action: 'company.roles.save', entity: 'Roles', entity_id: before.role_id,
      before: { name: before.name, data_scope: before.data_scope }, after: patch,
      note: 'Role updated with ' + Object.keys(perms).length + ' module rule(s)'
    });
    return { role_id: before.role_id, created: false };
  },

  rolesDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.manage');
    var role = Db.get(c, 'Roles', 'role_id', payload.role_id);
    if (boolVal_(role.is_system)) fail_('NOT_ALLOWED', 'Built-in roles cannot be deleted. You can change their permissions instead.');
    var used = Db.count(masterCtx_(), 'Users', function (u) { return txt_(u.company_id) === ctx.companyId && txt_(u.role_code) === txt_(role.code); });
    if (used) fail_('IN_USE', 'This role is assigned to ' + used + ' user(s). Move them to another role first.');
    Db.softDelete(c, 'Roles', 'role_id', payload.role_id, { actor: ctx.userId });
    Db.all(c, 'RolePermissions', function (r) { return txt_(r.role_id) === txt_(payload.role_id); })
      .forEach(function (p) { Db.softDelete(c, 'RolePermissions', 'perm_id', p.perm_id, { actor: ctx.userId }); });
    Audit.write(ctx, { module: 'users', action: 'company.roles.delete', entity: 'Roles', entity_id: payload.role_id, before: { code: role.code, name: role.name }, note: 'Role deleted' });
    return { deleted: true };
  },

  /* ============================================================ overrides = */
  overridesList: function (ctx, payload) {
    Perm.require(ctx, 'users.view');
    var c = Company.setContext_(ctx);
    return Db.query(c, 'UserPermissionOverrides', {
      page: payload.page, pageSize: payload.pageSize, sort: 'created_at', dir: 'DESC',
      filter: function (r) { return !payload.user_id || txt_(r.user_id) === txt_(payload.user_id); },
      mapper: function (r) {
        return {
          override_id: r.override_id, user_id: r.user_id, employee_id: r.employee_id, module: r.module, action: r.action,
          allowed: boolVal_(r.allowed), reason: r.reason, requested_by: r.requested_by, granted_by: r.granted_by,
          granted_at: r.granted_at, expires_at: r.expires_at, status: r.status, at: r.created_at,
          expired: !!r.expires_at && txt_(r.expires_at) < todayIso_()
        };
      }
    });
  },

  overridesSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.manage');
    if (!txt_(payload.reason) || txt_(payload.reason).length < 4) fail_('VALIDATION', 'Please write a short reason for this access change.', { field: 'reason' });
    var target = Db.get(masterCtx_(), 'Users', 'user_id', payload.user_id);
    if (txt_(target.company_id) !== txt_(ctx.companyId)) fail_('FORBIDDEN', 'That user belongs to another company.');
    var patch = {
      user_id: payload.user_id, employee_id: txt_(target.employee_id), module: txt_(payload.module), action: txt_(payload.action),
      allowed: payload.allowed === false ? 'FALSE' : 'TRUE', reason: payload.reason,
      requested_by: ctx.userId, granted_by: ctx.userId, granted_at: nowIso_(),
      expires_at: payload.expires_at || '', status: 'ACTIVE'
    };
    var row;
    if (payload.override_id) {
      var before = Db.get(c, 'UserPermissionOverrides', 'override_id', payload.override_id);
      row = Db.update(c, 'UserPermissionOverrides', 'override_id', payload.override_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'users', action: 'company.overrides.save', entity: 'UserPermissionOverrides', entity_id: row.override_id, before: before, after: patch, note: 'Override updated' });
    } else {
      row = Db.insert(c, 'UserPermissionOverrides', patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'users', action: 'company.overrides.save', entity: 'UserPermissionOverrides', entity_id: row.override_id, after: patch, note: 'Override granted for ' + txt_(target.name) });
    }
    memoDrop_('__perms_' + payload.user_id);
    return { override_id: row.override_id };
  },

  overridesDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.manage');
    var before = Db.get(c, 'UserPermissionOverrides', 'override_id', payload.override_id);
    Db.update(c, 'UserPermissionOverrides', 'override_id', payload.override_id, { status: 'REVOKED' }, { actor: ctx.userId });
    Db.softDelete(c, 'UserPermissionOverrides', 'override_id', payload.override_id, { actor: ctx.userId });
    memoDrop_('__perms_' + before.user_id);
    Audit.write(ctx, { module: 'users', action: 'company.overrides.delete', entity: 'UserPermissionOverrides', entity_id: payload.override_id, before: before, note: 'Override revoked' });
    return { deleted: true };
  },

  /* ================================================================ users = */
  usersList: function (ctx, payload) {
    Perm.require(ctx, 'users.view');
    var c = Company.setContext_(ctx);
    var employees = {};
    Db.all(c, 'Employees').forEach(function (e) { if (txt_(e.user_id)) employees[txt_(e.user_id)] = e; });
    var users = Db.all(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && txt_(u.scope) === 'COMPANY';
    });
    if (payload.role_code) users = users.filter(function (u) { return txt_(u.role_code) === txt_(payload.role_code); });
    if (payload.search) users = users.filter(function (u) { return matchesSearch_(u, ['name', 'email', 'phone', 'role_code'], payload.search); });
    var page = paginate_(sortRows_(users, 'name', 'ASC'), payload.page, payload.pageSize);
    return {
      rows: page.rows.map(function (u) {
        var emp = employees[txt_(u.user_id)];
        return {
          user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, role_code: u.role_code,
          status: u.status, last_login_at: u.last_login_at, created_at: u.created_at,
          must_change_password: boolVal_(u.must_change_password),
          activated: !!txt_(u.password_hash),
          employee_id: txt_(u.employee_id), employee_code: emp ? txt_(emp.code) : '', is_employee: !!emp,
          locked_until: u.locked_until
        };
      }),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  usersSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.manage');
    var email = normEmail_(payload.email);
    var role = Db.findOne(c, 'Roles', function (r) { return txt_(r.code) === txt_(payload.role_code); });
    if (!role) fail_('VALIDATION', 'Please choose a valid role.', { field: 'role_code' });
    if (txt_(role.code) === 'EMPLOYEE') fail_('VALIDATION', 'Use the Employees screen to add employee logins. This screen is for office users who are not employees (HR, accountant, supervisors with their own login).');
    var result = { created: false, user_id: '' };
    var tempPassword = '';
    if (payload.user_id) {
      var user = Db.get(masterCtx_(), 'Users', 'user_id', payload.user_id);
      if (txt_(user.company_id) !== txt_(ctx.companyId)) fail_('FORBIDDEN', 'That user belongs to another company.');
      var dupe = Db.findOne(masterCtx_(), 'Users', function (u) {
        return normEmail_(u.email) === email && txt_(u.user_id) !== txt_(user.user_id);
      });
      if (dupe) fail_('DUPLICATE', 'Another account already uses this email address.');
      var before = { name: user.name, email: user.email, role_code: user.role_code, status: user.status };
      Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
        name: payload.name, email: email, phone: payload.phone || user.phone,
        role_code: payload.role_code, status: txt_(payload.status || user.status || 'ACTIVE').toUpperCase()
      }, { actor: ctx.userId });
      Audit.write(ctx, { module: 'users', action: 'company.users.save', entity: 'Users', entity_id: user.user_id, before: before, after: { name: payload.name, email: email, role_code: payload.role_code, status: payload.status }, note: 'User updated' });
      result.user_id = user.user_id;
    } else {
      var exists = Db.findOne(masterCtx_(), 'Users', function (u) { return normEmail_(u.email) === email; });
      if (exists) {
        if (txt_(exists.company_id) === txt_(ctx.companyId)) fail_('DUPLICATE', 'This email already has access to your workspace.');
        fail_('DUPLICATE', 'This email is already registered on ' + APP.name + ' with another company.');
      }
      tempPassword = strongTempPassword_();
      var salt = randomSalt_();
      var created = Db.insert(masterCtx_(), 'Users', {
        scope: 'COMPANY', company_id: ctx.companyId, employee_id: '', name: payload.name, email: email,
        phone: payload.phone || '', password_salt: salt, password_hash: hashPassword_(tempPassword, salt),
        password_set_at: nowIso_(), must_change_password: 'TRUE', status: 'ACTIVE', role_code: payload.role_code,
        meta_json: jsonStr_({ invited_by: ctx.userId })
      }, { actor: ctx.userId });
      result.user_id = created.user_id;
      result.created = true;
      Audit.write(ctx, { module: 'users', action: 'company.users.save', entity: 'Users', entity_id: created.user_id, after: { name: payload.name, email: email, role_code: payload.role_code }, note: 'User invited (temp password issued)' });
      if (payload.send_invite !== false) {
        Notify.send({
          to: email, template: 'USER_INVITE',
          vars: { name: payload.name, email: email, role: txt_(role.name), company_name: ctx.company.name, password: tempPassword }
        });
      }
    }
    return { user_id: result.user_id, created: result.created, temp_password: tempPassword, invited: payload.send_invite !== false && result.created };
  },

  usersDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'users.delete');
    var user = Db.get(masterCtx_(), 'Users', 'user_id', payload.user_id);
    if (txt_(user.company_id) !== txt_(ctx.companyId)) fail_('FORBIDDEN', 'That user belongs to another company.');
    if (txt_(user.role_code) === 'COMPANY_ADMIN' && Db.count(masterCtx_(), 'Users', function (u) {
      return txt_(u.company_id) === ctx.companyId && txt_(u.role_code) === 'COMPANY_ADMIN' && txt_(u.status) === 'ACTIVE';
    }) <= 1) {
      fail_('NOT_ALLOWED', 'You cannot remove the only Company Admin. Add another admin first.');
    }
    Db.update(masterCtx_(), 'Users', 'user_id', payload.user_id, { status: 'INACTIVE' }, { actor: ctx.userId });
    Db.update(masterCtx_(), 'Sessions', 'user_id', payload.user_id, {}, { system: true });
    Db.all(masterCtx_(), 'Sessions', function (s) { return txt_(s.user_id) === txt_(payload.user_id) && !txt_(s.ended_at); })
      .forEach(function (s) { Db.update(masterCtx_(), 'Sessions', 'session_id', s.session_id, { ended_at: nowIso_(), ended_reason: 'USER_DISABLED' }, { system: true }); });
    Audit.write(ctx, { module: 'users', action: 'company.users.delete', entity: 'Users', entity_id: payload.user_id, before: { email: user.email, role_code: user.role_code }, note: 'User access revoked' });
    return { deleted: true };
  },

  usersResetPassword: function (ctx, payload) {
    Perm.require(ctx, 'users.manage');
    var user = Db.get(masterCtx_(), 'Users', 'user_id', payload.user_id);
    if (txt_(user.company_id) !== txt_(ctx.companyId)) fail_('FORBIDDEN', 'That user belongs to another company.');
    if (txt_(payload.mode) === 'OTP') {
      var otp = Auth.createOtp_('PASSWORD_RESET', normEmail_(user.email), { userId: user.user_id, companyId: ctx.companyId, ip: ctx.ip });
      Notify.sendOtp({ email: user.email, code: otp, purpose: 'PASSWORD_RESET', name: user.name, company_id: ctx.companyId });
      Audit.write(ctx, { module: 'users', action: 'company.users.resetPassword', entity: 'Users', entity_id: user.user_id, note: 'Password reset link/code sent to ' + maskEmail_(user.email), severity: 'SENSITIVE' });
      return { mode: 'OTP', sent_to: maskEmail_(user.email) };
    }
    var temp = strongTempPassword_();
    var salt = randomSalt_();
    Db.update(masterCtx_(), 'Users', 'user_id', user.user_id, {
      password_salt: salt, password_hash: hashPassword_(temp, salt), password_set_at: nowIso_(),
      must_change_password: 'TRUE', failed_attempts: 0, locked_until: '', status: 'ACTIVE'
    }, { actor: ctx.userId });
    Notify.send({ to: user.email, template: 'TEMP_PASSWORD', vars: { name: user.name, password: temp } });
    Audit.write(ctx, { module: 'users', action: 'company.users.resetPassword', entity: 'Users', entity_id: user.user_id, note: 'Temporary password issued and emailed', severity: 'SENSITIVE' });
    return { mode: 'TEMP', temp_password: temp, emailed_to: maskEmail_(user.email) };
  },

  /* ============================================================= holidays = */
  holidaysList: function (ctx, payload) {
    if (!Perm.has(ctx, 'leave.view') && !Perm.has(ctx, 'settings.view')) Perm.require(ctx, 'leave.view');
    var c = Company.setContext_(ctx);
    var year = txt_(payload && payload.year) || todayIso_().slice(0, 4);
    var rows = Db.all(c, 'Holidays', function (h) { return txt_(h.date).slice(0, 4) === year; });
    rows = sortRows_(rows, 'date', 'ASC');
    var page = paginate_(rows, payload && payload.page, payload && payload.pageSize ? payload.pageSize : 100);
    return {
      rows: page.rows.map(function (h) {
        return {
          holiday_id: h.holiday_id, name: h.name, date: h.date, day: dayName_(h.date), kind: h.kind,
          region: h.region, branch_id: h.branch_id, is_paid: boolVal_(h.is_paid), note: h.note
        };
      }),
      total: page.total, year: year,
      years: uniq_(Db.all(c, 'Holidays').map(function (h) { return txt_(h.date).slice(0, 4); }).concat([year])).sort(),
      page: page.page, pageSize: page.pageSize, totalPages: page.totalPages
    };
  },

  holidaysSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var patch = {
      name: payload.name, date: payload.date, kind: txt_(payload.kind || 'PUBLIC').toUpperCase(),
      region: txt_(payload.region || 'ALL'), branch_id: txt_(payload.branch_id),
      is_paid: payload.is_paid === false ? 'FALSE' : 'TRUE', note: payload.note
    };
    var dupe = Db.findOne(c, 'Holidays', function (h) {
      return txt_(h.date) === txt_(payload.date) && txt_(h.holiday_id) !== txt_(payload.holiday_id) &&
        (txt_(h.region || 'ALL') === txt_(patch.region) || txt_(patch.region) === 'ALL');
    });
    if (dupe) fail_('DUPLICATE', 'A holiday already exists on ' + fmtDateHuman_(payload.date) + ' (' + txt_(dupe.name) + ').');
    if (payload.holiday_id) {
      var before = Db.get(c, 'Holidays', 'holiday_id', payload.holiday_id);
      Db.update(c, 'Holidays', 'holiday_id', payload.holiday_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'settings', action: 'company.holidays.save', entity: 'Holidays', entity_id: payload.holiday_id, before: before, after: patch, note: 'Holiday updated' });
      return { holiday_id: payload.holiday_id, created: false };
    }
    var row = Db.insert(c, 'Holidays', patch, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.holidays.save', entity: 'Holidays', entity_id: row.holiday_id, after: patch, note: 'Holiday added' });
    return { holiday_id: row.holiday_id, created: true };
  },

  holidaysDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var before = Db.get(c, 'Holidays', 'holiday_id', payload.holiday_id);
    Db.softDelete(c, 'Holidays', 'holiday_id', payload.holiday_id, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.holidays.delete', entity: 'Holidays', entity_id: payload.holiday_id, before: before, note: 'Holiday removed' });
    return { deleted: true };
  },

  /* ========================================================== leave types = */
  leaveTypesList: function (ctx) {
    Perm.require(ctx, 'settings.view');
    var c = Company.setContext_(ctx);
    return {
      rows: sortRows_(Db.all(c, 'LeaveTypes').map(function (t) {
        return {
          leave_type_id: t.leave_type_id, code: t.code, name: t.name, is_paid: boolVal_(t.is_paid),
          accrual_per_month: numVal_(t.accrual_per_month), max_balance: numVal_(t.max_balance),
          carry_forward: boolVal_(t.carry_forward), requires_doc: boolVal_(t.requires_doc),
          max_consecutive_days: intVal_(t.max_consecutive_days, 30), color: txt_(t.color) || '#64748b',
          is_active: boolVal_(t.is_active) !== false, sort_order: intVal_(t.sort_order, 9), note: t.note,
          used_this_fy: Db.count(c, 'LeaveRequests', function (r) {
            return txt_(r.leave_type_id) === txt_(t.leave_type_id) && txt_(r.status) === 'APPROVED' && txt_(r.fy) === fyOf_(todayIso_());
          })
        };
      }), 'sort_order', 'ASC')
    };
  },

  leaveTypesSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var patch = {
      code: txt_(payload.code).toUpperCase().slice(0, 8), name: payload.name,
      is_paid: payload.is_paid === false ? 'FALSE' : 'TRUE',
      accrual_per_month: numVal_(payload.accrual_per_month), max_balance: numVal_(payload.max_balance),
      carry_forward: payload.carry_forward ? 'TRUE' : 'FALSE', requires_doc: payload.requires_doc ? 'TRUE' : 'FALSE',
      max_consecutive_days: intVal_(payload.max_consecutive_days, 30), color: txt_(payload.color || '#64748b'),
      is_active: payload.is_active === false ? 'FALSE' : 'TRUE', sort_order: intVal_(payload.sort_order, 9),
      note: payload.note
    };
    var dupe = Db.findOne(c, 'LeaveTypes', function (t) {
      return txt_(t.code) === txt_(patch.code) && txt_(t.leave_type_id) !== txt_(payload.leave_type_id);
    });
    if (dupe) fail_('DUPLICATE', 'A leave type with the code ' + patch.code + ' already exists.');
    if (payload.leave_type_id) {
      var before = Db.get(c, 'LeaveTypes', 'leave_type_id', payload.leave_type_id);
      Db.update(c, 'LeaveTypes', 'leave_type_id', payload.leave_type_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'settings', action: 'company.leavetypes.save', entity: 'LeaveTypes', entity_id: payload.leave_type_id, before: before, after: patch, note: 'Leave type updated' });
      return { leave_type_id: payload.leave_type_id, created: false };
    }
    var row = Db.insert(c, 'LeaveTypes', patch, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.leavetypes.save', entity: 'LeaveTypes', entity_id: row.leave_type_id, after: patch, note: 'Leave type added' });
    return { leave_type_id: row.leave_type_id, created: true };
  },

  leaveTypesDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var inUse = Db.count(c, 'LeaveRequests', function (r) { return txt_(r.leave_type_id) === txt_(payload.leave_type_id); });
    if (inUse) fail_('IN_USE', 'This leave type has ' + inUse + ' request(s). Mark it inactive instead of deleting.');
    Db.softDelete(c, 'LeaveTypes', 'leave_type_id', payload.leave_type_id, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.leavetypes.delete', entity: 'LeaveTypes', entity_id: payload.leave_type_id, note: 'Leave type deleted' });
    return { deleted: true };
  },

  /* ==================================================== expense categories */
  expenseCategoriesList: function (ctx) {
    Perm.require(ctx, 'settings.view');
    var c = Company.setContext_(ctx);
    return {
      rows: sortRows_(Db.all(c, 'ExpenseCategories').map(function (t) {
        return {
          category_id: t.category_id, code: t.code, name: t.name, max_amount: numVal_(t.max_amount),
          requires_bill: boolVal_(t.requires_bill), is_taxable: boolVal_(t.is_taxable),
          is_active: boolVal_(t.is_active) !== false, sort_order: intVal_(t.sort_order, 9), gl_code: t.gl_code, note: t.note
        };
      }), 'sort_order', 'ASC')
    };
  },

  expenseCategoriesSave: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var patch = {
      code: txt_(payload.code).toUpperCase().slice(0, 10), name: payload.name, max_amount: numVal_(payload.max_amount),
      requires_bill: payload.requires_bill ? 'TRUE' : 'FALSE', is_taxable: payload.is_taxable ? 'TRUE' : 'FALSE',
      is_active: payload.is_active === false ? 'FALSE' : 'TRUE', sort_order: intVal_(payload.sort_order, 9),
      gl_code: payload.gl_code, note: payload.note
    };
    var dupe = Db.findOne(c, 'ExpenseCategories', function (t) {
      return txt_(t.code) === txt_(patch.code) && txt_(t.category_id) !== txt_(payload.category_id);
    });
    if (dupe) fail_('DUPLICATE', 'A category with the code ' + patch.code + ' already exists.');
    if (payload.category_id) {
      var before = Db.get(c, 'ExpenseCategories', 'category_id', payload.category_id);
      Db.update(c, 'ExpenseCategories', 'category_id', payload.category_id, patch, { actor: ctx.userId });
      Audit.write(ctx, { module: 'settings', action: 'company.expensecategories.save', entity: 'ExpenseCategories', entity_id: payload.category_id, before: before, after: patch, note: 'Expense category updated' });
      return { category_id: payload.category_id, created: false };
    }
    var row = Db.insert(c, 'ExpenseCategories', patch, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.expensecategories.save', entity: 'ExpenseCategories', entity_id: row.category_id, after: patch, note: 'Expense category added' });
    return { category_id: row.category_id, created: true };
  },

  expenseCategoriesDelete: function (ctx, payload) {
    var c = Company.setContext_(ctx);
    Perm.require(ctx, 'settings.edit');
    var inUse = Db.count(c, 'ExpenseClaims', function (r) { return txt_(r.category_id) === txt_(payload.category_id); });
    if (inUse) fail_('IN_USE', 'This category has ' + inUse + ' claim(s). Mark it inactive instead of deleting.');
    Db.softDelete(c, 'ExpenseCategories', 'category_id', payload.category_id, { actor: ctx.userId });
    Audit.write(ctx, { module: 'settings', action: 'company.expensecategories.delete', entity: 'ExpenseCategories', entity_id: payload.category_id, note: 'Expense category deleted' });
    return { deleted: true };
  },

  /* ======================================================= payroll rates = */
  payrollRatesGet: function (ctx) {
    Perm.require(ctx, 'payroll.view');
    var keys = DEFAULT_SETTINGS.filter(function (s) { return s.group_name === 'Payroll'; });
    var items = keys.map(function (s) {
      var row = settingRaw_(ctx, s.key);
      return {
        key: s.key, label: s.label, value_type: s.value_type, group_name: s.group_name,
        value: row ? txt_(row.value) : s.value, version: row ? intVal_(row.version, 1) : 0,
        effective_from: row ? row.effective_from : '', updated_at: row ? row.updated_at : '', updated_by: row ? row.updated_by : ''
      };
    });
    return {
      items: items,
      defaults: PAYROLL_DEFAULTS,
      pt_states: Object.keys(PT_SLABS),
      pt_slabs: PT_SLABS[txt_(getSetting_(ctx, 'payroll.pt_state', 'Maharashtra'))] || PT_SLABS['Maharashtra'],
      tds_note: 'TDS is estimated with the simplified annual projection built into this prototype. Your accountant should review the final figures before filing.',
      pf_note: 'PF is calculated on basic + DA, capped at the wage ceiling unless the employee opts out of the ceiling.',
      esic_note: 'ESIC applies when monthly gross is at or below the ESIC wage ceiling.'
    };
  },

  payrollRatesSave: function (ctx, payload) {
    Perm.require(ctx, 'payroll.edit');
    var allowed = {};
    DEFAULT_SETTINGS.filter(function (s) { return s.group_name === 'Payroll'; }).forEach(function (s) { allowed[s.key] = s; });
    var changed = [];
    (payload.items || []).forEach(function (item) {
      var key = txt_(item.key);
      if (!allowed[key]) return;
      var before = getSetting_(ctx, key, '');
      var value = txt_(item.value);
      if (allowed[key].value_type === 'boolean') value = boolVal_(value) ? 'TRUE' : 'FALSE';
      if (allowed[key].value_type === 'number') {
        if (value === '' || isNaN(Number(value))) fail_('VALIDATION', allowed[key].label + ' must be a number.');
        value = String(numVal_(value));
      }
      if (key === 'payroll.pt_state' && !PT_SLABS[value]) fail_('VALIDATION', 'Professional tax slabs are not configured for ' + value + ' yet.');
      if (value === before) return;
      setSetting_(ctx, key, value, allowed[key]);
      changed.push({ key: key, from: before, to: value });
    });
    if (!changed.length) return { saved: 0 };
    Audit.write(ctx, {
      module: 'payroll', action: 'company.payrollrates.save', entity: 'Settings', entity_id: '',
      before: { items: changed.map(function (c) { return { key: c.key, value: c.from }; }) },
      after: { items: changed.map(function (c) { return { key: c.key, value: c.to }; }) },
      note: 'Statutory rates updated' + (payload.reason ? ' — ' + payload.reason : '')
    });
    return { saved: changed.length, changed: changed };
  }
};
