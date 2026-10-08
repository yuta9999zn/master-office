// AI layer (§80): status and models, the prompt library (built-ins, overrides by admins, reset, people's own prompts,
// permissions), job validation, and real runs on the local model — a workflow, a banner and a business card from
// templates (contact details taken from the request, never invented), Docs text — plus cancel and history.
//   node apps/api/test/ai.mjs   (API in dev mode + seed + Ollama with a model; AI_FAST=1 skips the model runs)
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '').slice(0, 600)}`);
  if (!cond) failures++;
};
async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-user-id'] = user;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const users = (await call('GET', '/users')).data;
const uid = (key) => users.find((u) => u.email === `${key}@kaori.jp`).id;
const [claudia, ken] = ['claudia', 'ken'].map(uid);
const waitJob = async (id, user = claudia, ms = 600_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const j = (await call('GET', `/ai/jobs/${id}`, { user })).data;
    if (!['queued', 'running'].includes(j.status) || Date.now() > end) return j;
    await new Promise((r) => setTimeout(r, 1500));
  }
};

// ── Status ──────────────────────────────────────────────────────────────────
const status = (await call('GET', '/ai/status', { user: ken })).data;
check('status: the model server, its models, the model per app, design formats', typeof status.reachable === 'boolean' && Array.isArray(status.models) && status.perApp && status.formats.some((f) => f.id === 'business-card-eu'), status);
const live = status.reachable && status.models.length > 0;
check('… the local server answers with at least one model', live, status.error);
check('settings are for admins', (await call('GET', '/ai/settings', { user: ken })).status === 403 && (await call('GET', '/ai/settings', { user: claudia })).status === 200);
check('a bad server address is refused', (await call('PUT', '/ai/settings', { user: claudia, body: { url: 'ftp://x' } })).status === 400);

// ── Prompt library ──────────────────────────────────────────────────────────
const prompts = (await call('GET', '/ai/prompts', { user: ken })).data;
const keys = prompts.map((p) => p.key);
check('the built-in library: workflow, workbook (+ its 3 steps), deck, banner, card, free-form, docs, ask', ['flow.generate', 'sheet.generate', 'sheet.plan', 'sheet.table', 'sheet.summary', 'slides.deck', 'slides.banner', 'slides.businessCard', 'slides.freeform', 'docs.draft', 'docs.summarize', 'docs.rewrite', 'general.ask'].every((k) => keys.includes(k)), keys);
check('every prompt has a description, rules and a template; steps name their parent', prompts.every((p) => p.description && p.system && p.template) && prompts.find((p) => p.key === 'sheet.table').partOf === 'sheet.generate');
check('members cannot change built-in prompts', prompts.every((p) => !p.builtIn || !p.canEdit) && (await call('PUT', '/ai/prompts/general.ask', { user: ken, body: { ...prompts.find((p) => p.key === 'general.ask'), name: 'x' } })).status === 403);
const ask = prompts.find((p) => p.key === 'general.ask');
const edited = await call('PUT', '/ai/prompts/general.ask', { user: claudia, body: { name: ask.name, app: ask.app, output: ask.output, description: ask.description, system: `${ask.system}\nAlways sign "— Master Office".`, template: ask.template, temperature: 0.3, variables: ask.variables } });
check('an admin tunes a built-in prompt for the organisation', edited.status === 200 && edited.data.overridden && edited.data.system.includes('Master Office'), edited.data);
check('… everyone sees the tuned version', (await call('GET', '/ai/prompts/general.ask', { user: ken })).data.system.includes('— Master Office'));
check('… and it can be reset to the built-in text', (await call('DELETE', '/ai/prompts/general.ask', { user: claudia })).status === 204 && !(await call('GET', '/ai/prompts/general.ask', { user: ken })).data.overridden);
check('resetting an unchanged built-in is a 404', (await call('DELETE', '/ai/prompts/general.ask', { user: claudia })).status === 404);
const mine = await call('POST', '/ai/prompts', { user: ken, body: { name: 'Slogan', app: 'general', output: 'text', description: 'Three slogans', system: 'Write 3 short slogans in {{language}}.', template: '{{request}}', temperature: 0.7, variables: [{ name: 'request', label: 'Product', example: 'spa' }] } });
check('anyone adds a prompt of their own (key custom.*)', mine.status === 201 && mine.data.key.startsWith('custom.') && mine.data.canEdit, mine.data);
check('… others can use but not change it', (await call('GET', `/ai/prompts/${mine.data.key}`, { user: claudia })).status === 200 && (await call('PUT', `/ai/prompts/${mine.data.key}`, { user: uid('hana'), body: { ...mine.data, name: 'Mine now' } })).status === 403);
check('… its author edits it', (await call('PUT', `/ai/prompts/${mine.data.key}`, { user: ken, body: { name: 'Slogans', app: 'general', output: 'text', description: 'x', system: 'Write 3 slogans.', template: '{{request}}', temperature: 0.7, variables: [] } })).data.name === 'Slogans');
check('a prompt needs rules and a template', (await call('POST', '/ai/prompts', { user: ken, body: { name: 'x', app: 'general', output: 'text', system: '', template: '' } })).status === 400);

// ── Job validation ──────────────────────────────────────────────────────────
check('a request is needed', (await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'flow.generate', request: '  ' } })).status === 400);
check('unknown prompts are 404', (await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'nope', request: 'x' } })).status === 404);
const sheet = (await call('POST', '/resources', { user: claudia, body: { name: 'AI target', type: 'spreadsheet' } })).data;
check('a workflow cannot be written into a spreadsheet', (await call('POST', '/ai/jobs', { user: claudia, body: { promptKey: 'flow.generate', request: 'x', targetId: sheet.id } })).status === 400);
check('nor into a file one cannot edit', (await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'sheet.generate', request: 'x', targetId: sheet.id } })).status === 404);
check('unknown design formats are refused', (await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'slides.banner', request: 'x', format: 'billboard' } })).status === 400);
const jobs0 = (await call('GET', '/ai/jobs', { user: ken })).data;
check('history lists one’s own jobs', Array.isArray(jobs0));

if (live && !process.env.AI_FAST) {
  // ── Real runs on the local model ──────────────────────────────────────────
  const flow = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'flow.generate', request: 'Đặt lịch: khách gửi form, nhân viên kiểm tra lịch trống, nếu còn chỗ thì gửi email xác nhận, nếu không thì gọi điện đề xuất giờ khác.' } })).data.id, ken);
  check('a workflow from a description: a new flow with a start, a decision and an end', flow.status === 'done' && flow.result?.url?.startsWith('/flow/') && flow.result.steps >= 4, flow);
  const fid = flow.result?.resourceId;
  if (fid) {
    const auto = (await call('GET', `/flows/${fid}/automation`, { user: ken })).data;
    check('… marked as AI-made, with a trigger on its start', auto.triggers.length >= 1 && (await call('GET', `/resources/${fid}`, { user: ken })).data.metadata?.aiGenerated === true, auto);
  }
  const banner = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'slides.banner', request: 'Banner khai trương Lotus Spa: tặng 20% mọi dịch vụ đến 15/11, hotline 0912 345 678, lotusspa.vn, màu xanh lá', format: 'banner-web' } })).data.id, ken);
  check('a banner from a brief: a 1200 × 628 design', banner.status === 'done' && banner.result?.size?.w === 1200 && banner.result.size.h === 628, banner);
  if (banner.result?.resourceId) {
    const v = await call('POST', `/resources/${banner.result.resourceId}/versions`, { user: ken, body: { label: 'check' } });
    const versions = (await call('GET', `/resources/${banner.result.resourceId}/versions`, { user: ken })).data;
    const content = (await call('GET', `/resources/${banner.result.resourceId}/versions/${versions.find((x) => x.label === 'check')?.id}/content`, { user: ken })).data;
    const texts = JSON.stringify(content?.deck ?? content ?? {});
    check('… the phone and website are the ones in the brief', v.status < 300 && texts.includes('0912 345 678') && texts.includes('lotusspa.vn'), texts.slice(0, 400));
  }
  const card = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'slides.businessCard', request: 'Card visit cho Trần Minh Anh, Giám đốc, Lotus Spa, 0912 345 678, anh@lotusspa.vn, 5 Hai Bà Trưng, Hà Nội, lotusspa.vn', format: 'business-card-eu' } })).data.id, ken);
  check('a business card: two sides at 85 × 55 mm', card.status === 'done' && card.result?.pages === 2 && card.result.size.w === 321, card);
  const text = await waitJob((await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'docs.rewrite', request: 'trang trọng hơn', variables: { selection: 'mai tụi mình họp lúc 9h nha, nhớ mang báo cáo' } } })).data.id, ken);
  check('Docs: improving a selection returns text (nothing is created)', text.status === 'done' && typeof text.result?.text === 'string' && text.result.text.length > 10 && !text.result.resourceId, text);
  // Cancel: a long job stopped while it runs.
  const long = (await call('POST', '/ai/jobs', { user: ken, body: { promptKey: 'slides.deck', request: 'Kế hoạch marketing năm 2027 cho chuỗi spa, 10 slide' } })).data;
  await new Promise((r) => setTimeout(r, 4000));
  const cancelled = await waitJob((await call('POST', `/ai/jobs/${long.id}/cancel`, { user: ken })).data.id, ken, 60_000);
  check('a running job can be stopped', cancelled.status === 'cancelled', cancelled.status);
  check('others do not see one’s jobs', (await call('GET', `/ai/jobs/${long.id}`, { user: uid('hana') })).status === 404);
  for (const id of [fid, banner.result?.resourceId, card.result?.resourceId].filter(Boolean)) {
    await call('POST', `/resources/${id}/trash`, { user: ken });
    await call('DELETE', `/resources/${id}`, { user: ken });
  }
}

await call('DELETE', `/ai/prompts/${mine.data.key}`, { user: ken });
await call('POST', `/resources/${sheet.id}/trash`, { user: claudia });
await call('DELETE', `/resources/${sheet.id}`, { user: claudia });
console.log(failures ? `\n${failures} check(s) failed` : '\nall AI checks passed');
process.exit(failures ? 1 : 0);
