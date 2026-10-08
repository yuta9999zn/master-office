'use client';

import { useEffect, useState } from 'react';

/**
 * The font size like Google Slides / PowerPoint: type any size (7.5, 13, 150…) or pick one from the list. A
 * business card needs 5–8 pt, which a fixed list cannot give.
 */
export function FontSizeBox({ value, sizes, disabled, onChange }: { value: number; sizes: number[]; disabled?: boolean; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const apply = () => {
    const n = Math.round(parseFloat(text.replace(',', '.')) * 10) / 10;
    if (Number.isFinite(n) && n >= 1 && n <= 400) {
      if (n !== value) onChange(n);
      setText(String(n));
    } else setText(String(value));
  };
  return (
    <>
      <input
        aria-label="Font size"
        list="mo-font-sizes"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), apply());
          else if (e.key === 'Escape') (setText(String(value)), e.currentTarget.blur());
        }}
        className="h-8 w-[52px] rounded-md bg-transparent px-1.5 text-[13px] text-ink-2 outline-none hover:bg-hover focus:bg-surface focus:ring-1 focus:ring-brand-500 disabled:opacity-40"
      />
      <datalist id="mo-font-sizes">
        {sizes.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
