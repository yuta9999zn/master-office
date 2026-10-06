'use client';

import { useEffect, useState } from 'react';

/**
 * False on the server and during hydration, true once mounted. Pages inside a Suspense boundary (useSearchParams)
 * hydrate late, after the shell has already filled the shared query cache — rendering their data only once
 * mounted keeps the first client render equal to the server HTML.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
