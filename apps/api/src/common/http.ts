/** RFC 6266 / 5987 — keeps Vietnamese file names intact. */
export function contentDisposition(name: string, disposition: 'attachment' | 'inline') {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
