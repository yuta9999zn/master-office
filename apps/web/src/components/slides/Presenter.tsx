'use client';

import { animCss, animTimeline, slideHtml, slideTitle, type DeckSize, type PlainSlide, type Theme, safeHref, slideLinkId } from '@workos/slide-model';
import { ChevronLeft, ChevronRight, MonitorPlay, MousePointer2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../ui/primitives';
import { SlideStyles, SlideView } from './SlideView';

/** Messages between the audience window (this tab) and the presenter window (BroadcastChannel). */
type Msg =
  | { t: 'state'; index: number; total: number; current: string; next: string | null; notes: string; title: string; size: DeckSize; black: boolean }
  | { t: 'go'; index: number }
  | { t: 'step'; d: 1 | -1 }
  | { t: 'black' }
  | { t: 'end' }
  | { t: 'hello' };

export const presentChannel = (id: string) => `mo-present-${id}`;

/**
 * Full-screen slide show (PowerPoint "Slide Show"): keyboard / click navigation, transitions, laser pointer,
 * black screen and an optional presenter window with notes, next slide and timer.
 */
export function Presenter({ resourceId, slides, deck, start, onExit }: { resourceId: string; slides: PlainSlide[]; deck: { size: DeckSize; theme: Theme }; start: number; onExit: (index: number) => void }) {
  const visible = slides.filter((s) => !s.meta.hidden);
  const list = visible.length ? visible : slides;
  const startIndex = Math.max(0, list.indexOf(slides[start]) >= 0 ? list.indexOf(slides[start]) : 0);
  const [index, setIndex] = useState(startIndex);
  // Animation step on the current slide (0 = what plays as the slide appears, n = after the n-th click) and
  // whether that step is being played (forward) or just shown in its end state (going back).
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [prev, setPrev] = useState<number | null>(null);
  const [black, setBlack] = useState(false);
  const [laser, setLaser] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 720 });
  const [chrome, setChrome] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const go = useCallback(
    (i: number) => {
      if (i < 0) return;
      if (i >= list.length) {
        setIndex(list.length); // "End of slide show" screen
        return;
      }
      setPrev(index);
      setIndex(i);
      setStep(0);
      setPlaying(true);
      setBlack(false);
    },
    [index, list.length],
  );
  const clicksOf = useCallback((i: number) => (list[i] ? animTimeline(list[i]).clicks : 0), [list]);
  /** Next click: the next animation step, else the next slide. */
  const next = useCallback(() => {
    if (index < list.length && step < clicksOf(index)) {
      setStep(step + 1);
      setPlaying(true);
      setBlack(false);
    } else go(index + 1);
  }, [index, list.length, step, clicksOf, go]);
  /** Back: undo the last animation step, else the previous slide with all its animations done. */
  const back = useCallback(() => {
    if (index < list.length && step > 0) {
      setStep(step - 1);
      setPlaying(false);
    } else if (index > 0) {
      const i = Math.min(index, list.length) - 1;
      setPrev(null);
      setIndex(i);
      setStep(clicksOf(i));
      setPlaying(false);
      setBlack(false);
    }
  }, [index, list.length, step, clicksOf]);

  // Full screen on open; leaving full screen ends the show.
  useEffect(() => {
    const el = root.current;
    el?.requestFullscreen?.().catch(() => undefined);
    const onFs = () => !document.fullscreenElement && onExit(Math.min(index, list.length - 1));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const exit = useCallback(() => {
    chan.current?.postMessage({ t: 'end' } satisfies Msg);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onExit(Math.min(index, list.length - 1));
  }, [index, list.length, onExit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(e.key)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(e.key)) back();
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'Escape') exit();
      else if (e.key === 'b' || e.key === 'B' || e.key === '.') setBlack((b) => !b);
      else if (e.key === 'l' || e.key === 'L') setLaser((l) => !l);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, next, back, index, list.length, exit]);

  // Presenter window sync.
  useEffect(() => {
    const ch = new BroadcastChannel(presentChannel(resourceId));
    chan.current = ch;
    ch.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.t === 'go') go(m.index);
      else if (m.t === 'step') (m.d > 0 ? next() : back());
      else if (m.t === 'black') setBlack((b) => !b);
      else if (m.t === 'end') exit();
      else if (m.t === 'hello') post();
    };
    const post = () => {
      const cur = list[Math.min(index, list.length - 1)];
      const nxt = list[index + 1] ?? null;
      ch.postMessage({
        t: 'state',
        index,
        total: list.length,
        current: slideHtml(cur, deck, { elementCss: animCss(cur, step, false) }),
        next: nxt ? slideHtml(nxt, deck) : null,
        notes: cur.notes,
        title: slideTitle(cur),
        size: deck.size,
        black,
      } satisfies Msg);
    };
    post();
    return () => ch.close();
  }, [index, step, black, list, deck, go, next, back, exit, resourceId]);

  const k = Math.min(vp.w / deck.size.w, vp.h / deck.size.h);
  const done = index >= list.length;
  const slide = list[Math.min(index, list.length - 1)];
  const transition = slide?.meta.transition ?? 'none';
  const animOpts = useMemo(() => (slide ? { elementCss: animCss(slide, step, playing), live: true } : undefined), [slide, step, playing]);

  return (
    <div
      ref={root}
      className="fixed inset-0 z-[100] flex select-none items-center justify-center overflow-hidden bg-black"
      style={{ cursor: laser ? 'none' : chrome ? 'default' : 'none' }}
      onClick={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('[data-chrome]')) return;
        // Links: another slide of the deck, or a web page in a new tab — never "next slide".
        const linked = (e.target as HTMLElement).closest<HTMLElement>('a[href], [data-link]');
        const href = linked?.getAttribute('href') ?? linked?.getAttribute('data-link');
        if (href) {
          e.preventDefault();
          const to = slideLinkId(href);
          if (to) {
            const i = list.findIndex((s) => s.id === to);
            if (i >= 0) go(i);
          } else if (safeHref(href)) window.open(href, '_blank', 'noopener,noreferrer');
          return;
        }
        // Clicks on a video or an audio icon play / pause it instead of advancing.
        const media = (e.target as HTMLElement).closest('.mo-el')?.querySelector<HTMLMediaElement>('video[data-mo-media], audio[data-mo-media]');
        if (media) {
          if (media.tagName === 'AUDIO') void (media.paused ? media.play() : media.pause());
          return;
        }
        next();
      }}
      onContextMenu={(e) => (e.preventDefault(), back())}
      onMouseMove={(e) => {
        setPointer({ x: e.clientX, y: e.clientY });
        setChrome(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setChrome(false), 2500);
      }}
      data-testid="presenter"
    >
      <SlideStyles />
      <style>{`
@keyframes mo-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes mo-push { from { transform: translateX(100%) } to { transform: translateX(0) } }
@keyframes mo-wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
`}</style>
      {done ? (
        <div className="text-center text-[15px] text-white/70" data-testid="presenter-end">
          End of slide show, click to exit.
          <div className="mt-4">
            <button data-chrome onClick={exit} className="rounded-lg bg-white/10 px-4 py-2 text-white hover:bg-white/20">
              Exit
            </button>
          </div>
        </div>
      ) : (
        <div className="relative" style={{ width: deck.size.w * k, height: deck.size.h * k }}>
          {prev !== null && prev !== index && list[prev] && transition !== 'none' && (
            <SlideView key={`prev-${prev}`} slide={list[prev]} deck={deck} width={deck.size.w * k} className="absolute inset-0" />
          )}
          <SlideView
            key={`cur-${index}`}
            slide={slide}
            deck={deck}
            width={deck.size.w * k}
            opts={animOpts}
            className="absolute inset-0"
            style={prev !== null && transition !== 'none' ? { animation: `mo-${transition} ${transition === 'fade' ? 450 : 500}ms ease-out both` } : undefined}
          />
          {black && <div className="absolute inset-0 bg-black" />}
        </div>
      )}
      {laser && pointer && <div className="pointer-events-none fixed z-[2] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_12px_4px_rgba(239,68,68,0.7)]" style={{ left: pointer.x, top: pointer.y }} />}
      <div data-chrome className={cn('fixed bottom-4 left-4 flex items-center gap-1 rounded-xl bg-black/60 p-1 text-white/80 backdrop-blur transition-opacity', chrome ? 'opacity-100' : 'opacity-0')} onClick={(e) => e.stopPropagation()}>
        <button onClick={back} className="rounded-lg p-2 hover:bg-white/15" aria-label="Previous slide">
          <ChevronLeft size={18} />
        </button>
        <span className="px-1 text-[13px] tabular-nums" data-testid="presenter-counter">
          {Math.min(index + 1, list.length)} / {list.length}
        </span>
        <button onClick={next} className="rounded-lg p-2 hover:bg-white/15" aria-label="Next slide">
          <ChevronRight size={18} />
        </button>
        <button onClick={() => setLaser((l) => !l)} className={cn('rounded-lg p-2 hover:bg-white/15', laser && 'text-red-400')} aria-label="Laser pointer (L)">
          <MousePointer2 size={17} />
        </button>
        <button onClick={() => window.open(`/present/${resourceId}`, 'mo-presenter', 'width=1200,height=760')} className="rounded-lg p-2 hover:bg-white/15" aria-label="Open presenter view">
          <MonitorPlay size={17} />
        </button>
        <button onClick={exit} className="rounded-lg p-2 hover:bg-white/15" aria-label="End show (Esc)">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

/** The presenter window: current + next slide, speaker notes, timer, controls. Driven by the audience window. */
export function PresenterView({ resourceId }: { resourceId: string }) {
  const [s, setS] = useState<Extract<Msg, { t: 'state' }> | null>(null);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const chan = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const ch = new BroadcastChannel(presentChannel(resourceId));
    chan.current = ch;
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.t === 'state') {
        setS(e.data);
        setEnded(false);
      } else if (e.data.t === 'end') setEnded(true);
    };
    ch.postMessage({ t: 'hello' } satisfies Msg);
    return () => ch.close();
  }, [resourceId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const send = (m: Msg) => chan.current?.postMessage(m);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) send({ t: 'step', d: 1 });
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) send({ t: 'step', d: -1 });
      else if (e.key === 'b' || e.key === 'B') send({ t: 'black' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const frame = (html: string | null, w: number) => {
    if (!s || !html) return <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-800 text-[13px] text-slate-400" style={{ width: w }}>End of show</div>;
    const k = w / s.size.w;
    return (
      <div className="overflow-hidden rounded-lg bg-white shadow-lg" style={{ width: w, height: s.size.h * k }}>
        <div style={{ transform: `scale(${k})`, transformOrigin: '0 0', width: s.size.w, height: s.size.h }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  };
  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <SlideStyles />
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <MonitorPlay size={18} className="text-sky-400" />
        <span className="font-semibold">Presenter view</span>
        {s && <span className="text-[13px] text-slate-400">{s.title}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[20px] tabular-nums" data-testid="presenter-timer">
            {mmss}
          </span>
          <button onClick={() => setRunning((r) => !r)} className="rounded-md p-1.5 hover:bg-white/10" aria-label={running ? 'Pause timer' : 'Resume timer'}>
            {running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button onClick={() => setElapsed(0)} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Reset timer">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      {!s ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">Start the slide show in the other window (Present) to control it from here.</div>
      ) : ended ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">The slide show has ended. You can close this window.</div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-5 p-5">
          <div className="flex min-w-0 flex-[3] flex-col gap-3">
            <div className="text-[12px] uppercase tracking-wider text-slate-400">
              Current slide · {s.index + 1} of {s.total}
              {s.black ? ' · screen is black' : ''}
            </div>
            {frame(s.current, 640)}
            <div className="flex gap-2">
              <button onClick={() => send({ t: 'step', d: -1 })} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-[13px] hover:bg-white/20">
                <ChevronLeft size={16} /> Previous
              </button>
              <button onClick={() => send({ t: 'step', d: 1 })} className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-[13px] hover:bg-sky-500">
                Next <ChevronRight size={16} />
              </button>
              <button onClick={() => send({ t: 'black' })} className="rounded-lg bg-white/10 px-3 py-2 text-[13px] hover:bg-white/20">
                Black screen (B)
              </button>
              <button onClick={() => send({ t: 'end' })} className="ml-auto rounded-lg bg-red-600/80 px-3 py-2 text-[13px] hover:bg-red-600">
                End show
              </button>
            </div>
          </div>
          <div className="flex min-w-0 flex-[2] flex-col gap-3">
            <div className="text-[12px] uppercase tracking-wider text-slate-400">Next slide</div>
            {frame(s.next, 360)}
            <div className="text-[12px] uppercase tracking-wider text-slate-400">Speaker notes</div>
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/5 p-4 text-[18px] leading-relaxed" data-testid="presenter-notes">
              {s.notes || <span className="text-slate-500">No notes for this slide.</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
