export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Parsed JSON error body, when there is one (e.g. the 409 "needs access" details from chat). */
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

/** Pages anyone may open; a 401 there is shown, not redirected to sign-in. */
const PUBLIC = /^\/(login|setup|forgot|reset|invite|f|bf|pub|present|qa)(\/|$)/;

/** All calls go through the Next.js `/api` rewrite → apps/api. Identity rides on the `mo_session` cookie (dev: `mo_uid`). */
/** A failed request is always an ApiError with a message a person can read; network trouble is status 0. */
async function request(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline' : 'The server cannot be reached', { cause: (e as Error).message });
  }
  if (res.status === 401 && typeof window !== 'undefined' && !PUBLIC.test(location.pathname)) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    let body: unknown;
    try {
      body = await res.json();
      const b = body as { message?: string | string[] };
      message = Array.isArray(b.message) ? b.message.join(', ') : b.message ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, message, body);
  }
  return res;
}

export async function api<T = void>(path: string, init: Init = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await request(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Large bodies bypass the Next.js proxy (it buffers requests and caps them at 10 MB): uploads go straight to the API origin,
 * which accepts the same identity cookie via credentialed CORS. Phase 2 moves this to presigned S3 uploads (ARCHITECTURE §5).
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** The API origin for websockets: an absolute ws(s) URL even when API_ORIGIN is a path behind the site's proxy ("/api"). */
export const apiWsOrigin = () => (/^https?:/.test(API_ORIGIN) ? API_ORIGIN.replace(/^http/, 'ws') : `${window.location.origin.replace(/^http/, 'ws')}${API_ORIGIN.replace(/\/$/, '')}`);

export async function uploadFile<T>(path: string, body: FormData): Promise<T> {
  const res = await request(`${API_ORIGIN}${path}`, { method: 'POST', body, credentials: 'include' });
  return res.json() as Promise<T>;
}

/** A link from a notification or a flow must stay inside the site: an absolute URL to elsewhere becomes the home page. */
export const safePath = (url: string | null | undefined) => (typeof url === 'string' && /^\/(?!\/)/.test(url) ? url : '/home');

export const downloadUrl = (id: string, inline = false) => `/api/resources/${id}/download${inline ? '?inline=1' : ''}`;

export function setDevUser(id: string) {
  document.cookie = `mo_uid=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
