'use client';

import { applyView, type BaseField, type BaseView, type ViewConfig, type ViewType } from '@workos/base-model';
import type { ResourceDetail } from '@workos/shared';
import { can } from '@workos/shared';
import { CalendarDays, Columns3, Download, Ellipsis, FileUp, FormInput, LayoutGrid, Pencil, Plus, Sheet, Table2, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useBaseActions, useBaseLive, useBaseSchema, useCellContext, useRecords } from '@/lib/base';
import { useMe, useResourceMembers } from '@/lib/queries';
import { ShareDialog } from '../drive/dialogs';
import { TitleBar } from '../editor/TitleBar';
import { Button, cn, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from '../ui/primitives';
import { FieldDialog } from './FieldDialog';
import { CalendarView } from './CalendarView';
import { FormBuilder } from './FormBuilder';
import { GalleryView } from './GalleryView';
import { GridView } from './GridView';
import { KanbanView } from './KanbanView';
import { RecordDrawer } from './RecordDrawer';
import { ViewToolbar } from './ViewToolbar';

export const VIEW_META: Record<ViewType, { label: string; icon: typeof Sheet }> = {
  grid: { label: 'Grid', icon: Sheet },
  kanban: { label: 'Kanban', icon: Columns3 },
  calendar: { label: 'Calendar', icon: CalendarDays },
  gallery: { label: 'Gallery', icon: LayoutGrid },
  form: { label: 'Form', icon: FormInput },
};

/** Base (§75): tables on the left, views on top, the records of the chosen view, a record beside them. */
export function BaseWorkspace({ r }: { r: ResourceDetail }) {
  const { data: me } = useMe();
  const { data: members } = useResourceMembers(r.id);
  const { data: schema, error } = useBaseSchema(r.id);
  useBaseLive(r.id);
  const a = useBaseActions(r.id);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const nav = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    router.replace(`${path}?${n.toString()}`, { scroll: false });
  };
  const [share, setShare] = useState(false);
  const [search, setSearch] = useState('');
  const [fieldDialog, setFieldDialog] = useState<{ field: BaseField | null; after?: string | null } | null>(null);
  const [local, setLocal] = useState<Record<string, Partial<ViewConfig>>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const role = schema?.role ?? r.myRole;
  const editable = can(role, 'editor');
  const table = schema?.tables.find((t) => t.id === params.get('table')) ?? schema?.tables[0];
  const view = table?.views.find((v) => v.id === params.get('view')) ?? table?.views[0];
  const { data: records, isLoading } = useRecords(table?.id);
  const ctx = useCellContext(table?.fields ?? []);
  // Viewers can filter and sort for themselves; editors change the view for everyone.
  const config: ViewConfig | null = view ? { ...view.config, ...(editable ? {} : (local[view.id] ?? {})) } : null;
  const setConfig = (c: Partial<ViewConfig>) => {
    if (!view) return;
    if (editable) a.updateView.mutate({ id: view.id, config: c });
    else setLocal((m) => ({ ...m, [view.id]: { ...(m[view.id] ?? {}), ...c } }));
  };
  const result = useMemo(() => (table && config && records ? applyView(table, records, { config }, ctx, { me: me?.user.id, search }) : null), [table, config, records, ctx, me?.user.id, search]);
  const openId = params.get('record');
  const openRecord = openId ? records?.find((x) => x.id === openId) : null;

  const importFile = async (file: File) => {
    const csv = await file.text();
    const res = await a.importCsv.mutateAsync({ name: file.name, csv });
    toast.success(`Imported ${res.records} records`);
    nav({ table: res.tableId, view: null, record: null });
  };
  const exportCsv = () => table && window.open(`/api/base/tables/${table.id}/csv${view ? `?view=${view.id}` : ''}`, '_blank');

  if (error)
    return (
      <div className="p-10">
        <EmptyState title="Can’t open this base">{(error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-surface" data-testid="base-workspace">
      <TitleBar r={r} kind="base" members={members?.map((m) => m.principal)} status="static" onShare={() => setShare(true)} />
      {!schema || !table || !view || !config ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 border-t border-line">
          {/* Tables */}
          <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-canvas p-2" aria-label="Tables" data-testid="base-tables">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Tables</p>
            <ul className="space-y-0.5">
              {schema.tables.map((t) => (
                <li key={t.id} className="group flex items-center">
                  <button onClick={() => nav({ table: t.id, view: null, record: null })} className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', t.id === table.id ? 'bg-selected font-medium text-brand-700' : 'text-ink-2 hover:bg-hover')} data-testid="base-table" data-name={t.name}>
                    <Table2 size={14} className="shrink-0" /> <span className="truncate">{t.name}</span>
                  </button>
                  {editable && (
                    <Menu>
                      <MenuTrigger asChild>
                        <button className="rounded p-1 text-muted opacity-0 hover:bg-hover group-hover:opacity-100" aria-label={`${t.name} options`}>
                          <Ellipsis size={14} />
                        </button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem
                          icon={<Pencil size={15} />}
                          onSelect={() => {
                            const name = window.prompt('Table name', t.name);
                            if (name?.trim()) a.updateTable.mutate({ id: t.id, name });
                          }}
                        >
                          Rename
                        </MenuItem>
                        <MenuItem
                          icon={<Trash2 size={15} />}
                          danger
                          disabled={schema.tables.length < 2}
                          onSelect={() => {
                            if (window.confirm(`Delete the table "${t.name}" and all its records?`)) a.deleteTable.mutate(t.id, { onSuccess: () => nav({ table: null, view: null, record: null }) });
                          }}
                        >
                          Delete table
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <div className="mt-2 space-y-0.5 border-t border-line pt-2">
                <button onClick={() => a.createTable.mutate(undefined, { onSuccess: (x) => nav({ table: x.id, view: null, record: null }) })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-hover" data-testid="add-table">
                  <Plus size={14} /> Add table
                </button>
                <button onClick={() => fileInput.current?.click()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-hover" data-testid="import-csv">
                  <FileUp size={14} /> Import CSV
                </button>
                <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => (e.target.files?.[0] && void importFile(e.target.files[0]), (e.target.value = ''))} data-testid="import-input" />
              </div>
            )}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Views */}
            <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-3 pt-1.5" role="tablist" data-testid="base-views">
              {table.views.map((v) => (
                <ViewTab key={v.id} v={v} active={v.id === view.id} editable={editable} onOpen={() => nav({ view: v.id, record: null })} last={table.views.length < 2} baseId={r.id} />
              ))}
              {editable && (
                <Menu>
                  <MenuTrigger asChild>
                    <button className="mb-1 ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-hover" data-testid="add-view">
                      <Plus size={14} /> View
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    {(Object.keys(VIEW_META) as ViewType[]).map((t) => {
                      const Icon = VIEW_META[t].icon;
                      return (
                        <MenuItem key={t} icon={<Icon size={15} />} onSelect={() => a.createView.mutate({ tableId: table.id, type: t }, { onSuccess: (v) => nav({ view: v.id }) })}>
                          {VIEW_META[t].label}
                        </MenuItem>
                      );
                    })}
                  </MenuContent>
                </Menu>
              )}
            </div>
            <ViewToolbar
              table={table}
              view={view}
              config={config}
              setConfig={setConfig}
              search={search}
              setSearch={setSearch}
              extra={
                <>
                  {editable && view.type !== 'form' && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus size={14} />}
                      onClick={() => a.createRecords.mutate({ tableId: table.id, records: [{ values: {} }] }, { onSuccess: (rs) => nav({ record: rs[0].id }) })}
                      data-testid="new-record"
                    >
                      Record
                    </Button>
                  )}
                  <Menu>
                    <MenuTrigger asChild>
                      <button className="flex h-8 items-center rounded-md px-2 text-muted hover:bg-hover" aria-label="More">
                        <Ellipsis size={16} />
                      </button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Download size={15} />} onSelect={exportCsv}>
                        Download CSV
                      </MenuItem>
                      {editable && <MenuSeparator />}
                      {editable && (
                        <MenuItem icon={<Plus size={15} />} onSelect={() => setFieldDialog({ field: null, after: null })}>
                          Add a field
                        </MenuItem>
                      )}
                    </MenuContent>
                  </Menu>
                </>
              }
            />
            <div className="flex min-h-0 flex-1">
              {isLoading || !result ? (
                <Skeleton className="m-4 h-80 flex-1" />
              ) : view.type === 'grid' ? (
                <GridView
                  baseId={r.id}
                  table={table}
                  view={view}
                  config={config}
                  setConfig={setConfig}
                  records={result.records}
                  groups={result.groups}
                  ctx={ctx}
                  editable={editable}
                  manualOrder={!config.sorts.length && !config.groupBy}
                  onExpand={(id) => nav({ record: id })}
                  onEditField={(f) => setFieldDialog({ field: f })}
                  onAddField={(after) => setFieldDialog({ field: null, after })}
                  me={me?.user.id}
                />
              ) : view.type === 'kanban' ? (
                <KanbanView baseId={r.id} table={table} config={config} setConfig={setConfig} records={result.records} ctx={ctx} editable={editable} manualOrder={!config.sorts.length} onOpen={(id) => nav({ record: id })} me={me?.user.id} />
              ) : view.type === 'calendar' ? (
                <CalendarView baseId={r.id} table={table} config={config} setConfig={setConfig} records={result.records} ctx={ctx} editable={editable} onOpen={(id) => nav({ record: id })} me={me?.user.id} />
              ) : view.type === 'gallery' ? (
                <GalleryView baseId={r.id} table={table} config={config} setConfig={setConfig} records={result.records} ctx={ctx} editable={editable} onOpen={(id) => nav({ record: id })} me={me?.user.id} />
              ) : (
                <FormBuilder table={table} viewId={view.id} config={config} setConfig={setConfig} editable={editable} />
              )}
              {openRecord && (
                <RecordDrawer
                  baseId={r.id}
                  table={table}
                  record={openRecord}
                  ctx={ctx}
                  editable={editable}
                  canComment={can(role, 'commenter')}
                  me={me?.user.id}
                  onClose={() => nav({ record: null })}
                  onStep={(dir) => {
                    const list = result?.records ?? [];
                    const i = list.findIndex((x) => x.id === openRecord.id);
                    const next = list[i + dir];
                    if (next) nav({ record: next.id });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {fieldDialog && table && (
        <FieldDialog baseId={r.id} table={table} tables={schema!.tables} field={fieldDialog.field} afterFieldId={fieldDialog.after} sample={result?.records[0]} ctx={ctx} onClose={() => setFieldDialog(null)} />
      )}
      <ShareDialog resource={share ? r : null} onClose={() => setShare(false)} />
    </div>
  );
}

function ViewTab({ v, active, editable, onOpen, last, baseId }: { v: BaseView; active: boolean; editable: boolean; onOpen: () => void; last: boolean; baseId: string }) {
  const a = useBaseActions(baseId);
  const Icon = VIEW_META[v.type].icon;
  return (
    <div className={cn('group mb-[-1px] flex items-center rounded-t-md border-b-2', active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-2 hover:bg-hover')}>
      <button role="tab" aria-selected={active} onClick={onOpen} className="flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-[13px]" data-testid="base-view" data-name={v.name}>
        <Icon size={14} /> {v.name}
      </button>
      {editable && active && (
        <Menu>
          <MenuTrigger asChild>
            <button className="mr-1 rounded p-0.5 text-muted hover:bg-hover" aria-label={`${v.name} options`}>
              <Ellipsis size={13} />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Pencil size={15} />}
              onSelect={() => {
                const name = window.prompt('View name', v.name);
                if (name?.trim()) a.updateView.mutate({ id: v.id, name });
              }}
            >
              Rename view
            </MenuItem>
            <MenuItem icon={<Trash2 size={15} />} danger disabled={last} onSelect={() => a.deleteView.mutate(v.id)}>
              Delete view
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}
