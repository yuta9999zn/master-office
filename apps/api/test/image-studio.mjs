// AI Image Studio (§81): image-AI keys never leave the server, a picture from ChatGPT / Gemini comes in as a design in
// its own shape, new information goes into the text layers (exact pairs and facts without the model), pictures are
// downloaded at 1×–4× / print 300 dpi as PNG or JPG, and a design is resized to another format (fit / fill).
//   node apps/api/test/image-studio.mjs   (API in dev mode + seed; no model needed)
import sharp from 'sharp';

const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 600)}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body, form } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type, name: decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '') ?? [])[1] ?? '') };
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, ken] = ['claudia', 'ken'].map(uid);
const waitJob = async (id, user) => {
  for (;;) {
    const j = (await call('GET', `/ai/jobs/${id}`, { user })).data;
    if (!['queued', 'running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 800));
  }
};
const created = [];

// ── Keys stay on the server ─────────────────────────────────────────────────
const before = (await call('GET', '/ai/settings', { user: claudia })).data.images;
const put = await call('PUT', '/ai/settings', { user: claudia, body: { images: { provider: 'openai', openaiKey: 'sk-test-never-shown-123' } } });
check('an admin stores an OpenAI key', put.status === 200 && put.data.images.hasOpenaiKey === true, put.data);
const view = await call('GET', '/ai/settings', { user: claudia });
check('… the key is never sent back (only “has a key”)', !JSON.stringify(view.data).includes('sk-test-never-shown') && view.data.images.hasOpenaiKey, view.data.images);
check('… members cannot read the settings', (await call('GET', '/ai/settings', { user: ken })).status === 403);
await call('PUT', '/ai/settings', { user: claudia, body: { images: { provider: before.provider === 'openai' ? 'none' : before.provider, openaiKey: '' } } });
check('… and it can be removed', (await call('GET', '/ai/settings', { user: claudia })).data.images.hasOpenaiKey === false);

// ── A picture comes in as a design in its own shape ─────────────────────────
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1512" height="793"><rect width="100%" height="100%" fill="#f6d5dc"/><circle cx="1200" cy="380" r="260" fill="#e8a0b0"/><text x="90" y="300" font-size="90" font-family="Arial" font-weight="bold" fill="#5a2d1a">KHUYẾN MÃI</text><text x="90" y="420" font-size="80" font-family="Arial" fill="#c0506a">GIẢM 30%</text></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'Banner tháng 10.png');
const imp = await call('POST', '/ai/pictures/import', { user: ken, form: fd });
check('a picture made elsewhere becomes a new design', imp.status === 201 && imp.data.resourceId && imp.data.slideId, imp.data);
created.push(imp.data.resourceId);
check('… in the matching format (1512 × 793 ≈ web banner 1200 × 628)', imp.data.size?.w === 1200 && imp.data.size?.h === 628, imp.data.size);
check('… named after the file (UTF-8 kept)', imp.data.name === 'Banner tháng 10 (editable)', imp.data.name);
const fd2 = new FormData();
fd2.append('file', new Blob([Buffer.from('not a picture')], { type: 'text/plain' }), 'x.txt');
const bad = await call('POST', '/ai/pictures/import', { user: ken, form: fd2 });
check('… a file that is not a picture is refused', bad.status === 400, bad.status);

// ── New information into the text layers (exact: no model) ──────────────────
const promo = (await call('POST', '/resources', { user: ken, body: { name: 'Khuyến mãi tháng 10 giảm 30% đến 31/10, gọi 0901 234 567', type: 'presentation' } })).data;
created.push(promo.id);
const start = await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'image.retext', request: 'Sang tháng 11: giảm 40%, đến 30/11, hotline 0909 888 999', targetId: promo.id } });
check('“put new information” starts on a presentation', start.status === 201, start.data);
const job = await waitJob(start.data.id, ken);
const after = job.result?.changes?.[0]?.to ?? '';
check('… month, percentage, date and phone are swapped exactly, without the model', job.status === 'done' && after === 'Khuyến mãi tháng 11 giảm 40% đến 30/11, gọi 0909 888 999' && job.result.by === 'exact', job.result ?? job.error);
check('… the run says what was done', job.result?.exact?.length === 4, job.result?.exact);
const pairs = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'image.retext', request: '"0909 888 999" → "1900 1234"', targetId: promo.id } })).data.id, ken);
check('“old → new” lines are applied word for word', pairs.status === 'done' && pairs.result.changes[0].to.endsWith('gọi 1900 1234'), pairs.result ?? pairs.error);
const nothing = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'image.retext', request: '"không có" → "x"', targetId: promo.id } })).data.id, ken);
check('a request that matches nothing fails clearly', nothing.status === 'failed' && /Nothing to change/.test(nothing.error), nothing);
check('only editors can change a design', [403, 404].includes((await call('POST', '/ai/jobs', { user: uid('hana'), body: { promptKey: 'image.retext', request: 'a → b', targetId: promo.id } })).status));

// ── Download as picture ─────────────────────────────────────────────────────
const dims = async (buf) => {
  const m = await sharp(buf).metadata();
  return [m.width, m.height, m.format, m.density];
};
const one = await call('GET', `/resources/${imp.data.resourceId}/export?format=png&slide=1&scale=1`, { user: ken });
check('PNG at 1× is the design size', one.status === 200 && JSON.stringify((await dims(one.data)).slice(0, 3)) === '[1200,628,"png"]', await dims(one.data).catch(() => one.data.toString().slice(0, 200)));
check('… a one-slide design is named after the file', one.name === 'Banner tháng 10 (editable) @1x.png', one.name);
const print = await call('GET', `/resources/${imp.data.resourceId}/export?format=png&slide=1&scale=3.125`, { user: ken });
check('print quality is 300 dpi (3750 × 1963 px, density 300)', JSON.stringify(await dims(print.data)) === '[3750,1963,"png",300]' && print.name.endsWith('@300dpi.png'), [await dims(print.data), print.name]);
const jpg = await call('GET', `/resources/${imp.data.resourceId}/export?format=jpg&slide=1`, { user: ken });
check('JPG at the default 2×', jpg.type === 'image/jpeg' && JSON.stringify((await dims(jpg.data)).slice(0, 3)) === '[2400,1256,"jpeg"]', await dims(jpg.data));
check('a scale above 4 is refused', (await call('GET', `/resources/${imp.data.resourceId}/export?format=png&scale=8`, { user: ken })).status === 400);

// ── Resize to another format ────────────────────────────────────────────────
const sq = await call('POST', `/ai/pictures/${imp.data.resourceId}/resize`, { user: ken, body: { format: 'banner-square' } });
created.push(sq.data.resourceId);
check('a picture design is resized whole by default (fit)', sq.status === 201 && sq.data.mode === 'fit' && sq.data.size.w === 1080 && sq.data.name.endsWith('· Square post 1080 × 1080'), sq.data);
const sqPng = await call('GET', `/resources/${sq.data.resourceId}/export?format=png&slide=1&scale=1`, { user: ken });
check('… the new design renders at 1080 × 1080', JSON.stringify((await dims(sqPng.data)).slice(0, 2)) === '[1080,1080]');
const fill = await call('POST', `/ai/pictures/${promo.id}/resize`, { user: ken, body: { format: 'banner-story', mode: 'fill' } });
created.push(fill.data.resourceId);
check('“fill” lays a design out again in the new shape', fill.status === 201 && fill.data.mode === 'fill' && fill.data.size.h === 1920, fill.data);
check('an unknown format is refused', (await call('POST', `/ai/pictures/${promo.id}/resize`, { user: ken, body: { format: 'billboard' } })).status === 400);
check('people without access cannot resize', [403, 404].includes((await call('POST', `/ai/pictures/${promo.id}/resize`, { user: uid('hana'), body: { format: 'banner-square' } })).status));

for (const id of created.filter(Boolean)) {
  await call('POST', `/resources/${id}/trash`, { user: ken });
  await call('DELETE', `/resources/${id}`, { user: ken });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Image Studio checks passed');
process.exit(failures ? 1 : 0);
