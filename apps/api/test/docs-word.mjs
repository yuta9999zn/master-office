// Phase 2.1 (Word parity) server test: page setup, header/footer, page breaks, TOC, styles and tracked changes
// must survive into real Office Open XML and PDF.   node apps/api/test/docs-word.mjs
import { HocuspocusProvider } from '@hocuspocus/provider';
import JSZip from 'jszip';
import * as Y from 'yjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 300)}`);
  if (!cond) failures++;
};
const call = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return res;
};

// A fresh document in My Files.
const doc = await (await call('POST', '/resources', { name: 'Word parity test', type: 'document' })).json();
const t = await (await call('GET', `/resources/${doc.id}/collab-token`)).json();
const ydoc = new Y.Doc();
const provider = await new Promise((resolve, reject) => {
  const p = new HocuspocusProvider({ url: t.url, name: t.document, token: t.token, document: ydoc, onSynced: () => resolve(p) });
  setTimeout(() => reject(new Error('sync timeout')), 10000);
});

// Build content exactly as the editor stores it (y-prosemirror XML: marks are attributes on text deltas).
const el = (name, attrs, children) => {
  const e = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, v);
  if (children) e.insert(0, children);
  return e;
};
const text = (parts) => {
  const x = new Y.XmlText();
  let at = 0;
  for (const [s, marks] of parts) {
    x.insert(at, s, marks ?? {});
    at += s.length;
  }
  return x;
};
const who = { id: 's1', authorId: 'u1', authorName: 'Mika Tanaka', color: '#8b5cf6', at: '2026-09-29T09:00:00.000Z' };
ydoc.transact(() => {
  const f = ydoc.getXmlFragment('default');
  f.push([
    el('paragraph', { docStyle: 'title' }, [text([['Quarterly Review']])]),
    el('paragraph', { docStyle: 'subtitle' }, [text([['Natural Beauty — Q3 2026']])]),
    el('tableOfContents', { maxLevel: 3 }),
    el('heading', { level: 1 }, [text([['Summary']])]),
    el('paragraph', { lineHeight: '1.5', spaceAfter: 12 }, [
      text([['Revenue grew '], ['15', {}], ['%', { superscript: {} }], [' and churn fell. '], ['Old sentence.', { deletion: who }], ['New sentence.', { insertion: who }]]),
    ]),
    el('pageBreak'),
    el('heading', { level: 2 }, [text([['Details']])]),
    el('paragraph', {}, [text([['H'], ['2', { subscript: {} }], ['O is water.']])]),
  ]);
  ydoc.getMap('settings').set('pageSetup', {
    size: 'A4',
    orientation: 'landscape',
    margins: { top: 20, right: 15, bottom: 20, left: 15 },
    header: 'Confidential — {title}',
    footer: 'Page {page} of {pages}',
    headerAlign: 'right',
    footerAlign: 'center',
  });
});
await new Promise((r) => setTimeout(r, 1200));

// ── DOCX ────────────────────────────────────────────────────────────────────
const docx = Buffer.from(await (await call('GET', `/resources/${doc.id}/export?format=docx`)).arrayBuffer());
const zip = await JSZip.loadAsync(docx);
const xml = await zip.file('word/document.xml').async('string');
const files = Object.keys(zip.files);
check('landscape A4 page size', /<w:pgSz[^>]*w:orient="landscape"/.test(xml), xml.match(/<w:pgSz[^>]*>/)?.[0]);
check('custom margins (15 mm ≈ 850 twips)', /<w:pgMar[^>]*w:left="850"/.test(xml), xml.match(/<w:pgMar[^>]*>/)?.[0]);
check('page break', xml.includes('<w:br w:type="page"/>'));
check('Word TOC field over heading levels 1-3', /TOC [^<]*\\o (&quot;|")1-3(&quot;|")/.test(xml));
check('tracked insertion (w:ins) by author', /<w:ins [^>]*w:author="Mika Tanaka"/.test(xml));
check('tracked deletion (w:del + w:delText)', /<w:del [^>]*w:author="Mika Tanaka"/.test(xml) && xml.includes('<w:delText'));
check('superscript / subscript', xml.includes('w:val="superscript"') && xml.includes('w:val="subscript"'));
check('line spacing 1.5 and 12pt after', /<w:spacing[^>]*w:after="240"[^>]*w:line="360"|<w:spacing[^>]*w:line="360"[^>]*w:after="240"/.test(xml), xml.match(/<w:spacing[^>]*>/g));
check('Title style paragraph', xml.includes('w:val="Title"'));
const footerXml = await Promise.all(files.filter((n) => /word\/footer\d*\.xml/.test(n)).map((n) => zip.file(n).async('string')));
check('footer with live PAGE and NUMPAGES fields', footerXml.some((x) => x.includes('PAGE') && x.includes('NUMPAGES')));
const headerXml = await Promise.all(files.filter((n) => /word\/header\d*\.xml/.test(n)).map((n) => zip.file(n).async('string')));
check('header text with title token expanded', headerXml.some((x) => x.includes('Confidential — ') && x.includes('Word parity test')));

// ── PDF ─────────────────────────────────────────────────────────────────────
const pdf = Buffer.from(await (await call('GET', `/resources/${doc.id}/export?format=pdf`)).arrayBuffer()).toString('latin1');
const box = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
check('PDF is A4 landscape (842 × 595 pt)', box && Math.round(Number(box[1])) === 842 && Math.round(Number(box[2])) === 595, box?.[0]);
check('PDF has 2+ pages (explicit page break)', (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length >= 2);

// ── Text / search use the accepted reading ──────────────────────────────────
const txt = await (await call('GET', `/resources/${doc.id}/export?format=txt`)).text();
check('plain text excludes suggested deletion, includes insertion', !txt.includes('Old sentence.') && txt.includes('New sentence.'));
const html = await (await call('GET', `/resources/${doc.id}/export?format=html`)).text();
check('HTML shows suggestions as <ins>/<del> and a linked TOC', html.includes('<ins') && html.includes('<del') && html.includes('href="#h-0"'));
check('HTML @page rule follows page setup', html.includes('@page { size: 297mm 210mm'));

provider.destroy();
await call('POST', `/resources/${doc.id}/trash`);
await call('DELETE', `/resources/${doc.id}`);
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
