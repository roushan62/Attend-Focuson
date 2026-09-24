/**
 * ============================================================================
 *  FocusHR  —  Permissions.gs
 *  Role based access control + data scoping.
 *  • Role -> permissions matrix lives in the company sheet (RolePermissions)
 *  • per-user grants/revokes live in UserPermissionOverrides (with reason)
 *  • data scope (ALL | PROJECT | TEAM | SELF) narrows the rows a user can see
 * ============================================================================
 */

var Perm = {

  /** Build the effective permission set for the current session. */
  load: function (ctx) {
    var cached = memoGet_('__perms_' + (ctx.userId || 'x'));
    if (cached) return cached;
    var eff = { permissions: {}, dataScope: 'SELF', roleCode: txt_(ctx.role_code || ctx.roleCode) || 'EMPLOYEE', roleName: '', roleId: '', isSuper: false };

    if (ctx.scope === 'SUPER') {
      eff.isSuper = true;
      eff.dataScope = 'ALL';
      eff.roleCode = 'SUPER_ADMIN';
      eff.roleName = 'Super Admin';
      MODULES.forEach(function (m) {
        (m.actions || []).forEach(function (a) { eff.permissions[m.key + '.' + a] = true; });
      });
      eff.permissions['super.view'] = true;
      return memoSet_('__perms_' + ctx.userId, eff);
    }

    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    var role = null;
    if (ctx.role_code) {
      role = Db.findOne(compCtx, 'Roles', function (r) { return txt_(r.code) === txt_(ctx.role_code) && !boolVal_(r.is_deleted); });
    }
    if (!role) {
      role = Db.findOne(compCtx, 'Roles', function (r) { return txt_(r.code) === 'EMPLOYEE'; });
    }
    if (role) {
      eff.roleId = role.role_id;
      eff.roleCode = role.code;
      eff.roleName = role.name;
      eff.dataScope = txt_(role.data_scope) || 'SELF';
    }

    var roleCode = eff.roleCode;
    Db.all(compCtx, 'RolePermissions', function (r) { return txt_(r.role_code) === roleCode; })
      .forEach(function (r) {
        if (boolVal_(r.allowed)) eff.permissions[txt_(r.module) + '.' + txt_(r.action)] = true;
      });

    // per-user overrides (win over the role)
    var today = todayIso_();
    Db.all(compCtx, 'UserPermissionOverrides').forEach(function (o) {
      if (txt_(o.user_id) !== txt_(ctx.userId)) return;
      if (txt_(o.status).toUpperCase() !== 'ACTIVE') return;
      if (o.expires_at && txt_(o.expires_at) < today) return;
      var key = txt_(o.module) + '.' + txt_(o.action);
      if (boolVal_(o.allowed)) eff.permissions[key] = true;
      else delete eff.permissions[key];
    });

    return memoSet_('__perms_' + ctx.userId, eff);
  },

  has: function (ctx, perm) {
    if (!perm) return true;
    var eff = Perm.load(ctx);
    if (eff.isSuper) return true;
    if (eff.permissions[perm]) return true;
    var parts = txt_(perm).split('.');
    var mod = parts[0], act = parts[1] || '';
    // "<module>.manage" in the matrix means "everything in this module"
    if (eff.permissions[mod + '.manage']) return true;
    // A requirement written as "<module>.manage" is satisfied by the strongest
    // management right the company actually granted on that module.
    if (act === 'manage') {
      var strong = ['edit', 'approve', 'create', 'delete', 'export'];
      for (var i = 0; i < strong.length; i++) {
        if (eff.permissions[mod + '.' + strong[i]]) return true;
      }
    }
    return false;
  },

  require: function (ctx, perm) {
    if (!Perm.has(ctx, perm)) {
      var eff = Perm.load(ctx);
      fail_('FORBIDDEN', 'Your role (' + (eff.roleName || eff.roleCode) + ') does not have permission for this action. Ask your admin for "' + perm + '".');
    }
    return true;
  },

  scope: function (ctx) { return Perm.load(ctx).dataScope || 'SELF'; },

  isSuper: function (ctx) { return ctx.scope === 'SUPER'; },

  isSelfOnly: function (ctx) { return Perm.scope(ctx) === 'SELF'; },

  canApprove: function (ctx, module) { return Perm.has(ctx, module + '.approve') || Perm.has(ctx, module + '.manage'); },

  /** Full permission matrix for the role editor UI. */
  matrix: function (ctx, roleId) {
    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    var role = roleId ? Db.get(compCtx, 'Roles', 'role_id', roleId)
      : Db.findOne(compCtx, 'Roles', function (r) { return txt_(r.code) === txt_(ctx.role_code); });
    var set = {};
    if (role) {
      Db.all(compCtx, 'RolePermissions', function (r) { return txt_(r.role_id) === txt_(role.role_id); })
        .forEach(function (r) { if (boolVal_(r.allowed)) set[txt_(r.module) + '.' + txt_(r.action)] = true; });
    }
    return {
      role: role ? { role_id: role.role_id, code: role.code, name: role.name, data_scope: role.data_scope, is_system: boolVal_(role.is_system), level: role.level, description: role.description } : null,
      modules: MODULES,
      granted: Object.keys(set),
      all: role && txt_(role.code) === 'COMPANY_ADMIN'
    };
  },

  /**
   * Employee ids the session may act on.
   * @return {Array<string>|null} null means "no restriction"
   */
  allowedEmployeeIds: function (ctx) {
    if (ctx.scope === 'SUPER') return null;
    var cached = memoGet_('__scopeE_' + ctx.userId);
    if (cached !== undefined) return cached;
    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    var scope = Perm.scope(ctx);
    var out = null;

    if (scope === 'PROJECT' && ctx.employeeId) {
      var myProjects = Db.all(compCtx, 'ProjectAssignments', function (a) {
        return txt_(a.employee_id) === txt_(ctx.employeeId) && txt_(a.status).toUpperCase() === 'ACTIVE';
      }).map(function (a) { return txt_(a.project_id); });
      var managed = Db.all(compCtx, 'Projects', function (p) {
        return txt_(p.incharge_employee_id) === txt_(ctx.employeeId);
      }).map(function (p) { return txt_(p.project_id); });
      var projectIds = uniq_(myProjects.concat(managed));
      var ids = Db.all(compCtx, 'ProjectAssignments', function (a) {
        return projectIds.indexOf(txt_(a.project_id)) >= 0 && txt_(a.status).toUpperCase() === 'ACTIVE';
      }).map(function (a) { return txt_(a.employee_id); });
      ids.push(ctx.employeeId);
      out = uniq_(ids);
    } else if (scope === 'TEAM' && ctx.employeeId) {
      var team = Db.all(compCtx, 'Employees', function (e) {
        return txt_(e.manager_id) === txt_(ctx.employeeId) && txt_(e.status).toUpperCase() !== 'EXITED';
      }).map(function (e) { return txt_(e.employee_id); });
      team.push(ctx.employeeId);
      out = uniq_(team);
    } else if (scope === 'SELF') {
      // "Self only" logins see just their own record; an office login without a
      // linked employee record sees nothing personal at all.
      out = ctx.employeeId ? [txt_(ctx.employeeId)] : [];
    }
    // scope ALL (and any other case) keeps out = null → every employee allowed
    return memoSet_('__scopeE_' + ctx.userId, out);
  },

  /** Is the session allowed to see/act on this employee record? */
  canAccessEmployee: function (ctx, employeeId) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    if (!allowed) return true;
    return allowed.indexOf(txt_(employeeId)) >= 0;
  },

  assertEmployee: function (ctx, employeeId) {
    if (!Perm.canAccessEmployee(ctx, employeeId)) {
      fail_('FORBIDDEN', 'You do not have access to this employee record.');
    }
    return true;
  },

  /** Filter a list of employee rows by the session data scope. */
  filterEmployees: function (ctx, employees) {
    var allowed = Perm.allowedEmployeeIds(ctx);
    if (!allowed) return employees;
    return employees.filter(function (e) { return allowed.indexOf(txt_(e.employee_id)) >= 0; });
  },

  /** The employee record behind a company/employee session (may be null). */
  currentEmployee: function (ctx) {
    if (!ctx.employeeId) return null;
    var compCtx = ctx.companyCtx || companyCtx_(ctx.companyId);
    return Db.find(compCtx, 'Employees', 'employee_id', ctx.employeeId);
  }
};
