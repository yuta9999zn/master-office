import type { Response } from 'express';

/** RFC 6266 / 5987 — keeps Vietnamese file names intact. */
export function contentDisposition(name: string, disposition: 'attachment' | 'inline') {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Immutable content (a blob is addressed by its sha256): sets ETag + Cache-Control and answers 304 when the
 * browser already holds this version. Returns true when the response is finished (nothing to stream).
 */
export function sendCached(res: Response, etag: string, ifNoneMatch: string | undefined, cacheControl = 'private, max-age=86400'): boolean {
  const tag = `"${etag}"`;
  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', cacheControl);
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim().replace(/^W\//, '') === tag)) {
    res.status(304).end();
    return true;
  }
  return false;
}
