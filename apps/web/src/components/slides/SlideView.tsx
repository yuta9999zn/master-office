'use client';

import { FONT_ALIASES, SLIDE_CSS, slideHtml, type DeckSize, type PlainSlide, type RenderOptions, type Theme } from '@workos/slide-model';
import { memo, useMemo, type CSSProperties } from 'react';

// The app ships Inter through next/font (hashed family name, exposed as --font-inter on <html>).
FONT_ALIASES.Inter = 'var(--font-inter), Inter, Arial, sans-serif';

/** Base slide CSS, rendered once by every surface that shows slides (editor, presenter, previews). */
export function SlideStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SLIDE_CSS }} />;
}

/** "a:b;c:d" → React style object (shared by renderer-produced CSS and in-place editors). */
export function cssObject(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[k] = part.slice(i + 1).trim();
  }
  return out as CSSProperties;
}

/** A slide rendered at `width` px (thumbnails, sorter, previews, presenting). */
export const SlideView = memo(function SlideView({
  slide,
  deck,
  width,
  opts,
  className,
  style,
}: {
  slide: PlainSlide;
  deck: { size: DeckSize; theme: Theme };
  width: number;
  opts?: RenderOptions;
  className?: string;
  style?: CSSProperties;
}) {
  const html = useMemo(() => slideHtml(slide, deck, opts), [slide, deck.size, deck.theme, opts]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = width / deck.size.w;
  return (
    <div className={className} style={{ width, height: deck.size.h * k, position: 'relative', overflow: 'hidden', ...style }}>
      <div style={{ transform: `scale(${k})`, transformOrigin: '0 0', width: deck.size.w, height: deck.size.h }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});
