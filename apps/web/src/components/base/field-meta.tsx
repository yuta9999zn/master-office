'use client';

import type { FieldType } from '@workos/base-model';
import {
  AlignLeft,
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  Clock,
  DollarSign,
  Hash,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Percent,
  Phone,
  Sigma,
  Star,
  Tags,
  Type,
  UserRound,
  UserRoundPen,
  Globe,
  History,
  type LucideIcon,
} from 'lucide-react';

/** Field types (§75): menu label, icon and what they are for. */
export const FIELD_META: Record<FieldType, { label: string; icon: LucideIcon; note: string }> = {
  text: { label: 'Text', icon: Type, note: 'A single line' },
  longText: { label: 'Long text', icon: AlignLeft, note: 'Paragraphs of notes' },
  number: { label: 'Number', icon: Hash, note: 'Whole or decimal numbers' },
  currency: { label: 'Currency', icon: DollarSign, note: 'Money in a currency' },
  percent: { label: 'Percent', icon: Percent, note: '15% is stored as 0.15' },
  checkbox: { label: 'Checkbox', icon: CheckSquare, note: 'Yes / no' },
  singleSelect: { label: 'Single select', icon: CircleDot, note: 'One option from a list' },
  multiSelect: { label: 'Multiple select', icon: Tags, note: 'Several options' },
  date: { label: 'Date', icon: Calendar, note: 'A day, optionally with a time' },
  person: { label: 'Person', icon: UserRound, note: 'People in the workspace' },
  link: { label: 'Link to table', icon: Link2, note: 'Records of another table' },
  attachment: { label: 'Attachment', icon: Paperclip, note: 'Files and pictures' },
  url: { label: 'URL', icon: Globe, note: 'A web address' },
  email: { label: 'Email', icon: AtSign, note: 'An e-mail address' },
  phone: { label: 'Phone', icon: Phone, note: 'A phone number' },
  rating: { label: 'Rating', icon: Star, note: 'Stars' },
  formula: { label: 'Formula', icon: Sigma, note: 'Computed from other fields' },
  autoNumber: { label: 'Auto number', icon: ListOrdered, note: 'Counts up for each record' },
  createdTime: { label: 'Created time', icon: Clock, note: 'When the record was created' },
  modifiedTime: { label: 'Last modified time', icon: History, note: 'When it last changed' },
  createdBy: { label: 'Created by', icon: UserRoundPen, note: 'Who created the record' },
};

export const FIELD_GROUPS: { label: string; types: FieldType[] }[] = [
  { label: 'Basic', types: ['text', 'longText', 'number', 'singleSelect', 'multiSelect', 'date', 'checkbox', 'person', 'attachment'] },
  { label: 'More', types: ['currency', 'percent', 'rating', 'url', 'email', 'phone', 'link'] },
  { label: 'Computed', types: ['formula', 'autoNumber', 'createdTime', 'modifiedTime', 'createdBy'] },
];

export function FieldIcon({ type, size = 14, className }: { type: FieldType; size?: number; className?: string }) {
  const Icon = FIELD_META[type]?.icon ?? List;
  return <Icon size={size} className={className ?? 'shrink-0 text-muted'} />;
}

/** Number-like fields align right. */
export const isNumeric = (t: FieldType) => ['number', 'currency', 'percent', 'autoNumber'].includes(t);
