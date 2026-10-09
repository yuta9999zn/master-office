'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

/** One toast per distinct message within a few seconds, so a burst of failures does not stack ten boxes. */
const recent = new Map<string, number>();
export function reportError(e: unknown, fallback = 'Something went wrong') {
  const err = e as Partial<ApiError> & { message?: string };
  if (err instanceof ApiError && err.status === 401) return; // api() already sends the person to sign in
  const message = err?.message && typeof err.message === 'string' && err.message !== 'Failed to fetch' ? err.message : fallback;
  const last = recent.get(message) ?? 0;
  if (Date.now() - last < 4000) return;
  recent.set(message, Date.now());
  toast.error(message, { description: err instanceof ApiError && err.status >= 500 ? 'The server could not complete this. Try again in a moment.' : undefined });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            // A 4xx will not get better by asking again; network and 5xx get one retry.
            retry: (count, e) => count < 1 && !(e instanceof ApiError && e.status < 500),
          },
        },
        // Mutations that handle their own failure keep doing so; the rest get a toast instead of silence.
        mutationCache: new MutationCache({ onError: (e, _v, _c, m) => (m.options.onError ? undefined : reportError(e)) }),
        // Background loads that fail (a list, a panel) say so once; the UI keeps the last data it had.
        queryCache: new QueryCache({ onError: (e, q) => (q.meta?.silent ? undefined : reportError(e, 'Could not load the latest data')) }),
      }),
  );
  useEffect(() => {
    // The last resort for promises nobody awaited and errors outside React: tell the person, keep the app alive.
    const onRejection = (ev: PromiseRejectionEvent) => {
      reportError(ev.reason);
      console.error('unhandled rejection', ev.reason);
    };
    const onError = (ev: ErrorEvent) => console.error('window error', ev.error ?? ev.message);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider>{children}</Tooltip.Provider>
      <Toaster position="bottom-right" toastOptions={{ style: { fontSize: 13, borderRadius: 10 } }} />
    </QueryClientProvider>
  );
}
