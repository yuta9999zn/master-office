export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

/** All calls go through the Next.js `/api` rewrite → apps/api. Identity rides on the `mo_uid` cookie. */
export async function api<T = void>(path: string, init: Init = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Large bodies bypass the Next.js proxy (it buffers requests and caps them at 10 MB): uploads go straight to the API origin,
 * which accepts the same identity cookie via credentialed CORS. Phase 2 moves this to presigned S3 uploads (ARCHITECTURE §5).
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function uploadFile<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, { method: 'POST', body, credentials: 'include' });
  if (!res.ok) {
    const msg = await res.json().then((b) => b.message, () => res.statusText);
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(', ') : msg);
  }
  return res.json() as Promise<T>;
}

export const downloadUrl = (id: string, inline = false) => `/api/resources/${id}/download${inline ? '?inline=1' : ''}`;

export function setDevUser(id: string) {
  document.cookie = `mo_uid=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
