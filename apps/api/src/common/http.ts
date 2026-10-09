import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { Readable } from 'node:stream';

const log = new Logger('Http');

/**
 * Streams storage content to the client. A stream that breaks mid-way (storage restarted, client gone) is logged and
 * the response is closed — never left hanging, never turned into an unhandled 'error' event.
 */
export function pipeStream(res: Response, stream: Readable, what: string) {
  stream.on('error', (e) => {
    log.warn(`stream ${what}: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ statusCode: 502, message: 'The stored content could not be read' });
    else res.destroy(e);
  });
  res.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  stream.pipe(res);
}

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
