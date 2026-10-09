'use client';

/** The root layout itself failed: a bare page (no shell, no providers) so the person is never left with a blank screen. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif', background: '#F8FAFC', color: '#0F172A', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '20px 24px', maxWidth: 440, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Master Office could not load</div>
            <p style={{ fontSize: 13, color: '#64748B', margin: '8px 0 0' }}>{error.message || 'An unexpected error occurred.'}</p>
            {error.digest && <p style={{ fontSize: 11, color: '#94A3B8', margin: '4px 0 0' }}>ref {error.digest}</p>}
            <button type="button" onClick={reset} style={{ marginTop: 16, background: '#2563EB', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
