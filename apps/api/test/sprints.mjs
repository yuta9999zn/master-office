// Sprints integration test (§76, batch 2): planning issues into sprints and ordering them, creating sprints with the
// project's length, one active sprint, starting with the Scrum ceremonies in Calendar (planning, daily 15 minutes
// Monday–Friday, review, retrospective — Kaori Meet rooms, invitations), burndown, completing with carry-over,
// velocity, the retrospective board (votes, action → issue), sprint settings and WIP limits.
// node apps/api/test/sprints.mjs   (fresh seed)
const API = process.env.API_URL ?? 'http://localhost:4000';
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const [hana, mika, ken, fujita] = ['hana', 'mika', 'ken', 'fujita'].map(uid);
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;
const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

const web = (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.key === 'WEB');
check('projects carry their sprint length and daily time', web.sprintDays === 14 && web.dailyTime === '09:30' && typeof web.wipLimits === 'object', web);
const sprints = (await call('GET', `/tasks/projects/${web.id}/sprints`, { user: hana })).data;
const [s1, s2, s3] = sprints;
check('sprints of a project, in order: closed, active, planned', sprints.length >= 3 && s1.state === 'closed' && s2.state === 'active' && s3.state === 'planned', sprints.map((x) => [x.name, x.state]));
check('a sprint counts its issues and points', s2.counts.total === 6 && s2.counts.points === 37 && s2.committedPoints === 37 && s1.completedPoints === 7, s2.counts);
const issues = (await call('GET', `/tasks?project=${web.id}`, { user: fujita })).data;
const byTitle = (t) => issues.find((x) => x.title === t);
check('issues know their sprint', byTitle('Implement booking system').sprintId === s2.id && byTitle('Prepare marketing assets').sprintId === null && byTitle('Build user authentication').sprintId === s3.id);

// ── Planning ────────────────────────────────────────────────────────────────
const assets = byTitle('Prepare marketing assets');
const auth = byTitle('Build user authentication');
const p1 = await call('PATCH', `/tasks/${assets.id}`, { user: mika, body: { sprintId: s3.id } });
check('planning an issue into a sprint', p1.status === 200 && p1.data.sprintId === s3.id && p1.data.rank > auth.rank, [p1.data?.rank, auth.rank]);
const p2 = await call('PATCH', `/tasks/${assets.id}`, { user: mika, body: { rankBefore: auth.id } });
check('… and putting it first in the sprint', p2.data.rank < auth.rank, [p2.data.rank, auth.rank]);
check('epics do not go into sprints', (await call('PATCH', `/tasks/${byTitle('Online booking').id}`, { user: mika, body: { sprintId: s3.id } })).status === 400);
check('closed sprints take nothing', (await call('PATCH', `/tasks/${assets.id}`, { user: mika, body: { sprintId: s1.id } })).status === 400);
check('viewers do not plan', (await call('PATCH', `/tasks/${assets.id}`, { user: hana, body: { sprintId: null } })).status === 403);
check('back to the backlog', (await call('PATCH', `/tasks/${assets.id}`, { user: mika, body: { sprintId: null } })).data.sprintId === null);
const inSprint = await call('POST', '/tasks', { user: mika, body: { projectId: web.id, title: 'Hotfix banner', sprintId: s2.id } });
check('creating straight into the active sprint (from its board)', inSprint.status === 201 && inSprint.data.sprintId === s2.id);

// ── Sprints ─────────────────────────────────────────────────────────────────
const s4 = await call('POST', `/tasks/projects/${web.id}/sprints`, { user: fujita, body: { goal: 'Reviews' } });
check('a new sprint starts the day after the last one, for the usual 2 weeks', s4.status === 201 && s4.data.startDate === addDays(s3.endDate, 1) && s4.data.endDate === addDays(s3.endDate, 14) && /Sprint \d+$/.test(s4.data.name), s4.data);
const s5 = await call('POST', `/tasks/projects/${web.id}/sprints`, { user: fujita, body: { name: 'Short one', startDate: '2027-01-04', days: 7 } });
check('… or a chosen start and length', s5.data.startDate === '2027-01-04' && s5.data.endDate === '2027-01-10');
check('a sprint lasts 1–60 days', (await call('POST', `/tasks/projects/${web.id}/sprints`, { user: fujita, body: { days: 0 } })).status === 400);
check('viewers do not create sprints', (await call('POST', `/tasks/projects/${web.id}/sprints`, { user: hana, body: {} })).status === 403);
check('one active sprint at a time', (await call('POST', `/tasks/sprints/${s3.id}/start`, { user: fujita, body: {} })).data?.message?.includes('Complete WEB Sprint 2 first'));

// ── Burndown ────────────────────────────────────────────────────────────────
const rep = (await call('GET', `/tasks/sprints/${s2.id}/report`, { user: hana })).data;
check('burndown: one point per day, ideal from the commitment to zero', rep.unit === 'points' && rep.burndown.length === 14 && rep.burndown[0].ideal === 37 && rep.burndown.at(-1).ideal === 0, rep.burndown.slice(0, 2));
check('… actual line up to today only', rep.burndown.filter((d) => d.remaining !== null).length === rep.burndown.filter((d) => d.day <= today).length && rep.burndown.find((d) => d.day > today)?.remaining == null);
check('… and what is done / not done', rep.notDone.some((t) => t.title === 'Implement booking system'));

// ── Complete with carry-over, velocity ──────────────────────────────────────
await call('PATCH', `/tasks/${byTitle('Design logo variations').id}`, { user: mika, body: { status: 'done' } });
const open = (await call('GET', `/tasks/sprints/${s2.id}/report`, { user: fujita })).data.notDone.length;
check('only the active sprint completes', (await call('POST', `/tasks/sprints/${s3.id}/complete`, { user: fujita, body: {} })).status === 400);
check('unfinished issues move to a planned sprint of this project only', (await call('POST', `/tasks/sprints/${s2.id}/complete`, { user: fujita, body: { moveTo: s1.id } })).status === 400);
const done2 = await call('POST', `/tasks/sprints/${s2.id}/complete`, { user: fujita, body: { moveTo: s3.id } });
check('completing the sprint carries unfinished work over', done2.status === 200 && done2.data.sprint.state === 'closed' && done2.data.moved === open && done2.data.sprint.completedPoints === 3, done2.data);
check('… into the next sprint', (await call('GET', `/tasks/${byTitle('Implement booking system').id}`, { user: fujita })).data.sprintId === s3.id && (await call('GET', `/tasks/${byTitle('Design logo variations').id}`, { user: fujita })).data.sprintId === s2.id);
const vel = (await call('GET', `/tasks/projects/${web.id}/velocity`, { user: hana })).data;
check('velocity: committed vs completed per sprint', vel.length >= 2 && vel.at(-2).completed === 7 && vel.at(-1).committed === 37 && vel.at(-1).completed === 3, vel);

// ── Start with the ceremonies ───────────────────────────────────────────────
const started = await call('POST', `/tasks/sprints/${s3.id}/start`, { user: fujita, body: { goal: 'Sign-in, payments and booking', ceremonies: { schedule: true, dailyTime: '09:15' } } });
const c = started.data?.ceremonies ?? {};
check('starting puts the four ceremonies in the calendar', started.status === 200 && started.data.state === 'active' && !!c.planning && !!c.daily && !!c.review && !!c.retro, started.data);
check('… and snapshots the commitment', started.data.committedCount === started.data.counts.total && started.data.committedPoints === started.data.counts.points);
const ev = async (id) => (await call('GET', `/calendar/events/${id}`, { user: fujita })).data;
const planning = await ev(c.planning);
const daily = await ev(c.daily);
const review = await ev(c.review);
const retro = await ev(c.retro);
const tokyo = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(',', '');
check('Sprint Planning on the first day, about 2 hours, with a meeting room', planning.title === 'WEB Sprint 3 · Sprint Planning' && tokyo(planning.start) === `${s3.startDate} 10:00` && Date.parse(planning.end) - Date.parse(planning.start) === 2 * 3600_000 && planning.meetingUrl?.includes('/meetings?room='), [planning.title, tokyo(planning.start)]);
check('Daily Scrum: 15 minutes at 09:15, Monday to Friday, until the last day', tokyo(daily.start) === `${addDays(s3.startDate, 1)} 09:15` && Date.parse(daily.end) - Date.parse(daily.start) === 15 * 60_000 && daily.recurrence?.byDay?.join() === '1,2,3,4,5' && daily.recurrence.until === s3.endDate, [tokyo(daily.start), daily.recurrence]);
check('Review and Retrospective on the last day', tokyo(review.start) === `${s3.endDate} 13:30` && tokyo(retro.start) === `${s3.endDate} 16:00` && retro.description.includes('Retro board'), [tokyo(review.start), tokyo(retro.start)]);
check('the lead and the people with issues are invited', ['ken@kaori.jp'].every((e) => planning.attendees.some((a) => a.email === e)), planning.attendees.map((a) => a.email));
await sleep(500);
check('… and get an invitation', (await inbox(ken)).some((n) => n.kind === 'calendar.invite' && n.title.includes('Sprint Planning')));
check('an empty sprint does not start', (await call('POST', `/tasks/sprints/${s4.data.id}/start`, { user: fujita, body: {} })).status === 400);

// ── Retrospective ───────────────────────────────────────────────────────────
check('the retrospective of a closed sprint keeps its cards', (await call('GET', `/tasks/sprints/${s1.id}/retro`, { user: hana })).data.length === 3);
check('viewers only read the retro', (await call('POST', `/tasks/sprints/${s3.id}/retro`, { user: hana, body: { kind: 'good', body: 'x' } })).status === 403);
const good = await call('POST', `/tasks/sprints/${s3.id}/retro`, { user: mika, body: { kind: 'good', body: 'Pairing on payments helped' } });
const act = await call('POST', `/tasks/sprints/${s3.id}/retro`, { user: mika, body: { kind: 'action', body: 'Add a staging checklist' } });
check('adding cards', good.status === 201 && act.status === 201 && good.data.author.id === mika);
const v1 = await call('POST', `/tasks/retro/${good.data.id}/vote`, { user: fujita });
const v2 = await call('POST', `/tasks/retro/${good.data.id}/vote`, { user: fujita });
check('votes toggle', v1.data.votes === 1 && v1.data.voted && v2.data.votes === 0);
check('only action items become issues', (await call('POST', `/tasks/retro/${good.data.id}/task`, { user: fujita, body: {} })).status === 400);
const toTask = await call('POST', `/tasks/retro/${act.data.id}/task`, { user: fujita, body: { assigneeId: ken } });
check('an action item becomes an issue in the backlog', toTask.status === 201 && toTask.data.title === 'Add a staging checklist' && toTask.data.tags.includes('retro') && toTask.data.sprintId === null && toTask.data.assignee?.id === ken, toTask.data);
check('… once', (await call('POST', `/tasks/retro/${act.data.id}/task`, { user: fujita, body: {} })).status === 400);
check('the card links to it', (await call('GET', `/tasks/sprints/${s3.id}/retro`, { user: fujita })).data.find((x) => x.id === act.data.id).task?.id === toTask.data.id);
check('only the author removes a card', (await call('DELETE', `/tasks/retro/${good.data.id}`, { user: ken })).status === 403 && (await call('DELETE', `/tasks/retro/${good.data.id}`, { user: mika })).status === 204);

// ── Completing early stops the daily ────────────────────────────────────────
await call('POST', `/tasks/sprints/${s3.id}/complete`, { user: fujita, body: {} });
check('completing early ends the daily standups today', (await ev(c.daily)).recurrence.until === today);
check('… unfinished work back to the backlog', (await call('GET', `/tasks/${byTitle('Implement booking system').id}`, { user: fujita })).data.sprintId === null);

// ── Cleanup & settings ──────────────────────────────────────────────────────
check('only planned sprints are deleted', (await call('DELETE', `/tasks/sprints/${s3.id}`, { user: fujita })).status === 400);
await call('PATCH', `/tasks/${assets.id}`, { user: mika, body: { sprintId: s5.data.id } });
check('deleting a planned sprint', (await call('DELETE', `/tasks/sprints/${s5.data.id}`, { user: fujita })).status === 204 && (await call('GET', `/tasks/${assets.id}`, { user: fujita })).data.sprintId === null);
await call('DELETE', `/tasks/sprints/${s4.data.id}`, { user: fujita });
const set = await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { sprintDays: 7, dailyTime: '10:00', wipLimits: { doing: 3, nope: 2 } } });
const after = (await call('GET', '/tasks/projects', { user: fujita })).data.find((p) => p.id === web.id);
check('sprint settings and WIP limits (known columns only)', set.status === 204 && after.sprintDays === 7 && after.dailyTime === '10:00' && after.wipLimits.doing === 3 && !('nope' in after.wipLimits), after);
check('times are HH:MM', (await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { dailyTime: '9am' } })).status === 400);
await call('PATCH', `/tasks/projects/${web.id}`, { user: fujita, body: { sprintDays: 14, dailyTime: '09:30', wipLimits: {} } });

console.log(failures ? `\n${failures} failed` : '\nall sprint checks passed');
process.exit(failures ? 1 : 0);
