'use client';

import { useEffect } from 'react';

/** A render error inside a page: the shell stays, the page shows what happened and offers a retry. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('page error', error);
  }, [error]);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="card max-w-md px-6 py-5 text-center">
        <div className="text-[16px] font-semibold text-ink">Something went wrong on this page</div>
        <p className="mt-2 text-[13px] text-muted">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest && <p className="mt-1 text-[11px] text-muted">ref {error.digest}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={reset} className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
            Try again
          </button>
          <button type="button" onClick={() => (window.location.href = '/home')} className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-ink hover:bg-hover">
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}
