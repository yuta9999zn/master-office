// Document tabs (Google Docs' tabs): each tab is its own Yjs XmlFragment; the list lives in the settings map.
// The first tab is the historical `default` fragment, so documents without tabs need no migration.
// docs/ARCHITECTURE.md §39.
import type { JSONContent } from '@tiptap/core';

export const TABS_KEY = 'tabs';
export const DEFAULT_TAB = 'default';

export interface DocTab {
  id: string;
  title: string;
  /** One-level nesting (Google Docs subtabs). */
  parent?: string | null;
  emoji?: string | null;
}

/** Yjs field holding a tab's body. */
export const tabField = (id: string) => (id === DEFAULT_TAB ? 'default' : `tab:${id}`);

/** The document's tabs in order; a document without a tab list has one tab ("Tab 1"). */
export function tabsOf(settings: Record<string, unknown> | null | undefined): DocTab[] {
  const list = settings?.[TABS_KEY];
  if (Array.isArray(list) && list.length && list.every((t) => t && typeof t.id === 'string')) {
    const tabs = list as DocTab[];
    return tabs.some((t) => t.id === DEFAULT_TAB) ? tabs : [{ id: DEFAULT_TAB, title: 'Tab 1' }, ...tabs];
  }
  return [{ id: DEFAULT_TAB, title: 'Tab 1' }];
}

/**
 * All tabs as one document (export, search, links): a single tab is returned as is; with several, each tab starts
 * on a new page with its title as a heading.
 */
export function combineTabs(parts: { tab: DocTab; json: JSONContent }[]): JSONContent {
  if (parts.length <= 1) return parts[0]?.json ?? { type: 'doc', content: [] };
  const content: JSONContent[] = [];
  parts.forEach(({ tab, json }, i) => {
    if (i > 0) content.push({ type: 'pageBreak' });
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `${tab.emoji ? `${tab.emoji} ` : ''}${tab.title}` }] });
    content.push(...(json.content ?? []));
  });
  return { type: 'doc', content };
}
