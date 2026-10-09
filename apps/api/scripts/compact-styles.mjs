// Moves a spreadsheet's cell styles into the shared style table (§83) — for workbooks imported or created before the
// table existed, which still hold one style object per cell. Connects as an editor through the running API, like the
// browser does, so people with the file open see it as a normal (large) remote change.
//   node apps/api/scripts/compact-styles.mjs <resourceId> [editorEmail]      (API running in dev mode)
import { createRequire } from 'node:module';

// Everything through CommonJS so there is one yjs instance (the ESM build beside it would be a second one).
const require = createRequire(import.meta.url);
const Y = require('yjs');
const { HocuspocusProvider } = require('@hocuspocus/provider');
const { SHEETS_MAP, STYLES_MAP, toStoredCell, ySheet } = require('../dist/packages/sheet-model/src');
const API = process.env.API_URL ?? 'http://localhost:4000';
const [id, email = 'claudia@hanami.example'] = process.argv.slice(2);
if (!id) throw new Error('resource id?');
const users = await (await fetch(`${API}/users`)).json();
const me = users.find((u) => u.email === email)?.id;
if (!me) throw new Error(`no user ${email}`);
const token = await (await fetch(`${API}/resources/${id}/collab-token`, { headers: { 'x-user-id': me } })).json();
const doc = new Y.Doc();
const t0 = Date.now();
await new Promise((resolve, reject) => {
  new HocuspocusProvider({ url: token.url, name: token.document, token: token.token, document: doc, onSynced: resolve });
  setTimeout(() => reject(new Error('sync timeout')), 120_000);
});
const before = Y.encodeStateAsUpdate(doc).length;
let moved = 0;
let kept = 0;
doc.transact(() => {
  const styles = doc.getMap(STYLES_MAP);
  doc.getMap(SHEETS_MAP).forEach((m) => {
    const ys = ySheet(m);
    for (const [key, cell] of ys.cells.entries()) {
      if (!cell?.s || typeof cell.s === 'string') (kept++, 0);
      else (ys.cells.set(key, toStoredCell(styles, cell)), moved++);
    }
  });
});
// Give the provider a moment to send the update, then let the server save it.
await new Promise((r) => setTimeout(r, 4000));
const after = Y.encodeStateAsUpdate(doc).length;
console.log(JSON.stringify({ moved, kept, styles: doc.getMap(STYLES_MAP).size, stateBeforeMB: +(before / 1048576).toFixed(1), stateAfterMB: +(after / 1048576).toFixed(1), ms: Date.now() - t0 }));
process.exit(0);
