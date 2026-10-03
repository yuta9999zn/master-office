'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// Univer enums (protocol): UnitAction.View = 0, UnitRole Reader/Editor/Owner = 0/1/2, ObjectScope Some/All/OneSelf = 0/1/2.
const VIEW = 0;
const MANAGE = 2; // ManageCollaborator
const DELETE = 42;
const ROLE_EDITOR = 1;
const ROLE_OWNER = 2;
const SCOPE_SOME = 0;
const SCOPE_ALL = 1;
const SCOPE_SELF = 2;
/** Same resource name as Univer's local mock, so rules saved before keep their data. */
const PLUGIN = 'SHEET_AuthzIoMockService_PLUGIN';

interface Entry {
  objectType: number;
  unitID: string;
  name: string;
  owner?: string; // Master Office user id of the creator (absent on rules made before this service)
  editors: string[]; // user ids allowed to edit when scope.edit = SomeCollaborator
  scope?: { read?: number; edit?: number };
}

/** "Owner_<uuid>" / "Reader_<uuid>" (Univer user ids, see UniverGrid) → "<uuid>". */
const bare = (id: string | undefined) => (id ?? '').replace(/^(Owner|Reader)_/, '');

/**
 * Permissions for protected ranges and sheets, per person (Univer's built-in service is a role-only mock: every
 * editor would be "the owner" of every rule). A rule records who made it and who may edit; the data travels with
 * the workbook as a plugin resource, so everyone's grid enforces the same rule.
 * Enforcement is in the editor (like Google Sheets' protected ranges, which are a guard against mistakes).
 */
export class MoAuthzService {
  private map = new Map<string, Entry>();

  constructor(
    resources: Any,
    private readonly users: Any,
  ) {
    resources.registerPluginResource({
      pluginName: PLUGIN,
      businesses: [2 /* UNIVER_SHEET */],
      toJson: () => JSON.stringify(Object.fromEntries(this.map)),
      parseJson: (json: string) => JSON.parse(json),
      onLoad: (_unitId: string, data: Record<string, Any>) => {
        for (const [k, v] of Object.entries(data ?? {})) this.map.set(k, { editors: [], ...v });
      },
      onUnLoad: () => this.map.clear(),
    });
  }

  private me() {
    return (this.users.getCurrentUser()?.userID as string | undefined) ?? '';
  }
  private isReader() {
    return this.me().startsWith('Reader_');
  }

  private can(entry: Entry | undefined, action: number): boolean {
    if (!entry) return !this.isReader() || action === VIEW;
    const me = bare(this.me());
    const edit = entry.scope?.edit ?? SCOPE_SELF;
    const canEdit =
      !this.isReader() && (!entry.owner || entry.owner === me || edit === SCOPE_ALL || (edit === SCOPE_SOME && entry.editors.includes(me)));
    if (action === VIEW) return canEdit || (entry.scope?.read ?? SCOPE_ALL) !== SCOPE_SELF;
    // Only whoever protected it can change or remove the protection (like Google Sheets).
    if (action === MANAGE || action === DELETE) return !this.isReader() && (!entry.owner || entry.owner === me);
    return canEdit;
  }

  private people() {
    const seen = new Map<string, Any>();
    for (const u of (this.users.list?.() ?? []) as Any[]) {
      const id = bare(u.userID);
      if (id && !seen.has(id)) seen.set(id, { id, role: ROLE_EDITOR, subject: { userID: `Owner_${id}`, name: u.name, avatar: u.avatar ?? '' } });
    }
    return [...seen.values()];
  }

  async create(config: Any) {
    const objectID = Math.random().toString(36).slice(2, 10);
    const obj = config.selectRangeObject ?? config.worksheetObject ?? {};
    this.map.set(objectID, {
      objectType: config.objectType,
      unitID: obj.unitID ?? '',
      name: obj.name ?? '',
      owner: bare(this.me()),
      editors: (obj.collaborators ?? []).map((c: Any) => bare(c.subject?.userID ?? c.id)),
      scope: obj.scope,
    });
    return objectID;
  }

  async allowed(config: Any) {
    const entry = this.map.get(config.objectID);
    return (config.actions as number[]).map((action) => ({ action, allowed: this.can(entry, action) }));
  }

  async batchAllowed(configs: Any[]) {
    return Promise.all(configs.map(async (c) => ({ unitID: c.unitID, objectID: c.objectID, actions: await this.allowed(c) })));
  }

  async list(config: Any) {
    return (config.objectIDs as string[]).map((objectID) => {
      const e = this.map.get(objectID);
      const owner = e?.owner ? this.people().find((p) => p.id === e.owner)?.subject : undefined;
      return {
        objectID,
        unitID: config.unitID,
        objectType: e?.objectType ?? 3,
        name: e?.name ?? '',
        shareOn: false,
        shareRole: ROLE_OWNER,
        shareScope: -1,
        scope: { read: e?.scope?.read ?? SCOPE_ALL, edit: e?.scope?.edit ?? SCOPE_SELF },
        creator: owner ?? { userID: `Owner_${e?.owner ?? ''}`, name: '', avatar: '' },
        strategies: [],
        actions: (config.actions as number[]).map((action) => ({ action, allowed: this.can(e, action) })),
      };
    });
  }

  async listCollaborators(config: Any) {
    const e = this.map.get(config.objectID);
    const all = this.people();
    return e ? all.filter((p) => e.editors.includes(p.id)) : all;
  }

  async listRoles() {
    return { roles: [], actions: [] };
  }

  async update(config: Any) {
    const e = this.map.get(config.objectID);
    if (!e) return;
    if (config.name !== undefined) e.name = config.name;
    if (config.scope) e.scope = config.scope;
    const obj = config.selectRangeObject ?? config.worksheetObject;
    if (obj?.scope) e.scope = obj.scope;
    if (obj?.collaborators) e.editors = obj.collaborators.map((c: Any) => bare(c.subject?.userID ?? c.id));
  }

  async putCollaborators(config: Any) {
    const e = this.map.get(config.objectID);
    if (e) e.editors = (config.collaborators ?? []).map((c: Any) => bare(c.subject?.userID ?? c.id));
  }
  async createCollaborator(config: Any) {
    const e = this.map.get(config.objectID);
    if (e) for (const c of config.collaborators ?? []) e.editors.push(bare(c.subject?.userID ?? c.id));
  }
  async updateCollaborator() {}
  async deleteCollaborator(config: Any) {
    const e = this.map.get(config.objectID);
    if (e) e.editors = e.editors.filter((id) => id !== bare(config.collaboratorID));
  }
}

/**
 * Re-evaluates the permission points of every protected range and sheet. Univer does this when the page starts,
 * but not when the workbook is rebuilt live (a remote protection change): its points would all stay "denied".
 */
export async function refreshProtection(injector: Any, sheets: Any, api: Any, unitId: string) {
  const authz = injector.get(sheets.IAuthzIoService);
  const permissions = injector.get(sheets.IPermissionService);
  const ranges = injector.get(sheets.RangeProtectionRuleModel);
  const worksheets = injector.get(sheets.WorksheetProtectionRuleModel);
  const apply = async (points: Any[], objectID: string, objectType: number) => {
    const actions = await authz.allowed({ objectID, unitID: unitId, objectType, actions: [...new Set(points.map((p) => p.subType))] });
    for (const p of points) {
      const a = actions.find((x: Any) => x.action === p.subType);
      if (a) permissions.updatePermissionPoint(p.id, a.allowed);
    }
  };
  for (const ws of api.getWorkbook(unitId)?.getSheets() ?? []) {
    const subUnitId = ws.getSheetId();
    for (const rule of ranges.getSubunitRuleList(unitId, subUnitId) ?? []) {
      await apply(sheets.getAllRangePermissionPoint().map((F: Any) => new F(unitId, subUnitId, rule.permissionId)), rule.permissionId, 3 /* SelectRange */);
      ranges.ruleRefresh?.(rule.permissionId);
    }
    const sheetRule = worksheets.getRule(unitId, subUnitId);
    if (sheetRule) {
      await apply(sheets.getAllWorksheetPermissionPoint().map((F: Any) => new F(unitId, subUnitId)), sheetRule.permissionId, 2 /* Worksheet */);
      worksheets.ruleRefresh?.(sheetRule.permissionId);
    }
  }
}
