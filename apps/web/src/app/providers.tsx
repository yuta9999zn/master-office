'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider>{children}</Tooltip.Provider>
      <Toaster position="bottom-right" toastOptions={{ style: { fontSize: 13, borderRadius: 10 } }} />
    </QueryClientProvider>
  );
}
