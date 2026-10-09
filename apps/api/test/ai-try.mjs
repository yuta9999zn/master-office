// Tries a prompt of the library against the local model and reports time, tokens, fixes and the file it made.
//   node apps/api/test/ai-try.mjs <promptKey> "<request>" [model] [format]
// e.g. node apps/api/test/ai-try.mjs sheet.generate "Quản lý khách hàng spa ..." qwen2.5:3b
const API = process.env.API_URL ?? 'http://localhost:4000';
const [key, request, model, format] = process.argv.slice(2);
const users = await (await fetch(`${API}/users`)).json();
const me = users.find((u) => u.email === 'claudia@hanami.example').id;
const call = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { 'x-user-id': me, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const job = await call('POST', '/ai/jobs', { promptKey: key, request, model: model || null, format: format || null });
const t0 = Date.now();
let j = job;
let last = -1;
while (['queued', 'running'].includes(j.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  j = await call('GET', `/ai/jobs/${job.id}`);
  if (j.tokens !== last && (Date.now() - t0) % 20000 < 2100) process.stdout.write(`  … ${j.status} ${Math.round((Date.now() - t0) / 1000)}s ${j.tokens} tokens\n`);
  last = j.tokens;
}
console.log(JSON.stringify({ status: j.status, model: j.model, seconds: Math.round(j.elapsedMs / 1000), tokens: j.tokens, tokPerSec: j.elapsedMs ? +(j.tokens / (j.elapsedMs / 1000)).toFixed(1) : null, result: j.result, error: j.error }, null, 2));
if (process.env.SHOW) console.log('\n--- answer ---\n' + j.partial);
