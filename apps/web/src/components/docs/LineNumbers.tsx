'use client';

import type { Editor } from '@tiptap/react';
import { lineBoxes } from '@workos/doc-model';
import { useEffect, useState, type RefObject } from 'react';

/**
 * Tools → Line numbers (§56): a number beside every visual line of the document, in the left margin. Measured
 * with the same function the PDF export runs (`lineBoxes`), after edits, resizes and font loads.
 */
export function LineNumbers({ editor, page, zoom }: { editor: Editor; page: RefObject<HTMLElement | null>; zoom: number }) {
  const [lines, setLines] = useState<{ top: number; height: number }[]>([]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const root = editor.view.dom as HTMLElement;
        if (page.current && root.isConnected) setLines(lineBoxes(root, page.current, zoom / 100));
      }, 120);
    };
    measure();
    editor.on('update', measure);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(editor.view.dom);
    return () => {
      clearTimeout(t);
      editor.off('update', measure);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [editor, page, zoom]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 select-none" data-testid="line-numbers">
      {lines.map((l, i) => (
        // In the left margin of the page (at least 64 px wide in every layout).
        <div key={i} className="absolute w-6 text-right text-[11px] leading-none text-subtle tabular-nums" style={{ top: l.top + Math.max(0, (l.height - 11) / 2), left: 14 }}>
          {i + 1}
        </div>
      ))}
    </div>
  );
}
