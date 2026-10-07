// Base model (docs/ARCHITECTURE.md §75): a base is a Drive resource holding tables; a table has fields, records
// (values keyed by field id, JSON in Postgres) and views (grid, kanban, calendar, gallery, form). Shared by the API
// (validation, CSV, formulas in exports) and the web app (rendering, filtering, sorting, grouping).

export const FIELD_TYPES = [
  'text',
  'longText',
  'number',
  'currency',
  'percent',
  'checkbox',
  'singleSelect',
  'multiSelect',
  'date',
  'person',
  'link',
  'attachment',
  'url',
  'email',
  'phone',
  'rating',
  'formula',
  'autoNumber',
  'createdTime',
  'modifiedTime',
  'createdBy',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types whose value is computed, never typed in. */
export const COMPUTED_TYPES: FieldType[] = ['formula', 'autoNumber', 'createdTime', 'modifiedTime', 'createdBy'];

export interface Choice {
  id: string;
  name: string;
  color: string;
}

export interface FieldOptions {
  /** number / currency / percent: digits after the point */
  precision?: number;
  /** currency: ISO code */
  currency?: string;
  /** singleSelect / multiSelect */
  choices?: Choice[];
  /** date: also a time of day */
  includeTime?: boolean;
  /** person: several people */
  multiple?: boolean;
  /** link: the table the records come from */
  tableId?: string;
  /** rating: number of stars */
  max?: number;
  /** formula: expression with {Field name} references */
  expression?: string;
}

/** A file in an attachment cell: stored as an asset of the base (GET /api/resources/:baseId/assets/:id). */
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface BaseField {
  id: string;
  tableId: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  description: string | null;
  position: number;
}

export interface BaseRecord {
  id: string;
  tableId: string;
  /** Values by field id (only stored types; computed ones are derived). */
  values: Record<string, unknown>;
  position: string;
  autoNumber: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  commentCount: number;
}

export type ViewType = 'grid' | 'kanban' | 'calendar' | 'gallery' | 'form';

export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'isAnyOf'
  | 'hasAnyOf'
  | 'hasAllOf'
  | 'before'
  | 'after'
  | 'isMe';

export interface FilterCondition {
  id: string;
  fieldId: string;
  op: FilterOp;
  value?: unknown;
}

export interface ViewConfig {
  filters: { conjunction: 'and' | 'or'; conditions: FilterCondition[] };
  sorts: { fieldId: string; dir: 'asc' | 'desc' }[];
  /** Grid: group rows by one field. */
  groupBy: { fieldId: string; dir: 'asc' | 'desc' } | null;
  /** Fields not shown in this view. */
  hidden: string[];
  /** Field order in this view (missing ones follow in table order). */
  order: string[];
  widths: Record<string, number>;
  rowHeight: 'short' | 'medium' | 'tall';
  /** Grid footer: aggregate per field (count, sum, avg…). */
  summaries?: Record<string, 'none' | 'count' | 'filled' | 'empty' | 'sum' | 'avg' | 'min' | 'max' | 'checked'>;
  /** Kanban: the single-select field that makes the columns. */
  stackField?: string | null;
  /** Calendar: the date field. */
  dateField?: string | null;
  /** Gallery: the attachment field shown as the cover. */
  coverField?: string | null;
  form?: FormConfig;
}

export interface FormConfig {
  title: string;
  description: string;
  /** Fields asked, in order. */
  fields: string[];
  required: string[];
  /** Anyone in the workspace may submit (even without access to the base). */
  open: boolean;
  submitText: string;
  /** Shown after submitting. */
  thanks: string;
}

export interface BaseView {
  id: string;
  tableId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
}

export interface BaseTable {
  id: string;
  baseId: string;
  name: string;
  position: number;
  primaryFieldId: string;
  fields: BaseField[];
  views: BaseView[];
}

export interface BaseSchema {
  id: string;
  name: string;
  role: 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';
  tables: BaseTable[];
}

export interface RecordComment {
  id: string;
  recordId: string;
  user: { id: string; name: string; avatarColor: string } | null;
  body: string;
  createdAt: string;
}

/** Pushed to everyone viewing a base (realtime event `base.changed`). */
export type BaseChange =
  | { kind: 'records'; tableId: string; upserted: BaseRecord[]; deleted: string[] }
  | { kind: 'schema' }
  | { kind: 'comments'; recordId: string };

export const CHOICE_COLORS = ['#dbeafe', '#ede9fe', '#dcfce7', '#fef3c7', '#fee2e2', '#cffafe', '#fce7f3', '#e2e8f0', '#ffedd5', '#d1fae5'];

export const emptyViewConfig = (): ViewConfig => ({
  filters: { conjunction: 'and', conditions: [] },
  sorts: [],
  groupBy: null,
  hidden: [],
  order: [],
  widths: {},
  rowHeight: 'short',
});
