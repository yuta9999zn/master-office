'use client';

import type { UniverAPI } from './binding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type IRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type Awareness = {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(field: string, value: unknown): void;
  on(e: 'change', f: () => void): void;
  off(e: 'change', f: () => void): void;
};

export const CURSOR_LABEL = 'MoCursorLabel';

/** Name tag above another editor's selection (rendered by Univer in a canvas popup). */
export function CursorLabel(props: { popup?: { extraProps?: { name?: string; color?: string } } }) {
  const p = props.popup?.extraProps ?? {};
  return (
    <div
      style={{ background: p.color, pointerEvents: 'none' }}
      className="-translate-y-0.5 whitespace-nowrap rounded-t px-1.5 py-px text-[11px] font-medium leading-4 text-white shadow-sm"
      data-testid="sheet-cursor"
    >
      {p.name}
    </div>
  );
}

/**
 * Shows where the other people are in the workbook (like Google Sheets): their selection in their colour with a
 * name tag, on the sheet they are looking at. Selections travel through the collaboration awareness.
 */
export class RemoteCursors {
  private shown: { dispose(): void }[] = [];
  private sub: { dispose(): void } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private raf = 0;
  private readonly render = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => ((this.raf = 0), this.draw()));
  };

  constructor(
    private readonly api: UniverAPI,
    private readonly unitId: string,
    private readonly awareness: Awareness,
  ) {}

  start() {
    this.publish();
    this.sub = this.api.addEvent(this.api.Event.CommandExecuted, (e: Any) => {
      if (/set-selections|set-worksheet-activ/.test(e.id)) {
        this.publish();
        if (/set-worksheet-activ/.test(e.id)) this.render();
      } else if (/insert-row|remove-row|insert-col|remove-col|set-worksheet-row|set-worksheet-col|zoom/.test(e.id)) this.render();
    });
    this.awareness.on('change', this.render);
    // A remote structural change can rebuild the workbook (and drop the highlights): redraw now and then.
    this.timer = setInterval(this.render, 4000);
    this.render();
  }

  private publish() {
    const ws = (this.api.getWorkbook(this.unitId) as Any)?.getActiveSheet();
    const r: IRange | undefined = ws?.getSelection?.()?.getActiveRange?.()?.getRange?.();
    if (!ws || !r) return;
    this.awareness.setLocalStateField('sheet', { sheetId: ws.getSheetId(), range: { startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: r.endColumn } });
  }

  private clear() {
    for (const d of this.shown.splice(0)) d.dispose();
  }

  private draw() {
    this.clear();
    const ws = (this.api.getWorkbook(this.unitId) as Any)?.getActiveSheet();
    if (!ws) return;
    const sheetId = ws.getSheetId();
    this.awareness.getStates().forEach((st, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const u = st.user as { name?: string; color?: string } | undefined;
      const s = st.sheet as { sheetId: string; range: IRange } | undefined;
      if (!u?.name || !s || s.sheetId !== sheetId) return;
      const { startRow, endRow, startColumn, endColumn } = s.range;
      if (startRow > ws.getMaxRows() - 1 || startColumn > ws.getMaxColumns() - 1) return;
      const color = u.color ?? '#7c3aed';
      try {
        const range = ws.getRange(startRow, startColumn, Math.min(endRow, ws.getMaxRows() - 1) - startRow + 1, Math.min(endColumn, ws.getMaxColumns() - 1) - startColumn + 1);
        this.shown.push(range.highlight({ stroke: color, strokeWidth: 2, fill: `${color}14`, widgets: {}, hasAutoFill: false } as never));
        const tag = ws.getRange(startRow, startColumn).attachPopup({ componentKey: CURSOR_LABEL, direction: 'top', extraProps: { name: u.name, color } } as never);
        if (tag) this.shown.push(tag);
      } catch {
        // The sheet is being rebuilt: the next change redraws.
      }
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.sub?.dispose();
    this.awareness.off('change', this.render);
    this.awareness.setLocalStateField('sheet', null);
    this.clear();
  }
}
