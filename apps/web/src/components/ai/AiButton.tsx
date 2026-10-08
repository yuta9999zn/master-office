'use client';

import { Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useAiUi } from '@/lib/ai';
import { cn } from '../ui/primitives';

/** The top-bar AI button (Ctrl+J): opens the assistant beside whatever app is open (§80). */
export function AiButton() {
  const { open, setOpen } = useAiUi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        useAiUi.getState().setOpen(!useAiUi.getState().open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <button
      onClick={() => setOpen(!open)}
      className={cn(
        'mr-1 flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition',
        open ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm' : 'bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-indigo-200 hover:ring-indigo-300',
      )}
      aria-pressed={open}
      title="AI Assistant (Ctrl+J)"
      data-testid="ai-button"
    >
      <Sparkles size={15} />
      AI
    </button>
  );
}
