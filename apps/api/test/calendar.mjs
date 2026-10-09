// Calendar integration test (§71): calendars and roles, events in a range (recurrence, exceptions), invitations
// (bell + mail with .ics), responses, free/busy of other people, all-day, validation, team calendars.
//   node apps/api/test/calendar.mjs   (fresh seed)
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
const uid = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
const [claudia, hana, mika, ken, yuki, rina, huong] = ['claudia', 'hana', 'mika', 'ken', 'yuki', 'rina', 'huong'].map(uid);
const day = 86_400_000;
const now = new Date();
const from = new Date(now.getTime() - 8 * day).toISOString();
const to = new Date(now.getTime() + 15 * day).toISOString();
const range = async (user, q = '') => (await call('GET', `/calendar/events?from=${from}&to=${to}${q}`, { user })).data;
const cals = async (user) => (await call('GET', '/calendar/calendars', { user })).data;
const inbox = async (user) => (await call('GET', '/notifications?unread=1', { user })).data;

// ── Calendars ───────────────────────────────────────────────────────────────
const cCals = await cals(claudia);
const myCal = cCals.find((c) => c.kind === 'user');
const mkt = cCals.find((c) => c.name === 'Marketing');
const hr = cCals.find((c) => c.name === 'HR');
check('everyone has My Calendar; team calendars come with the spaces you see', myCal?.name === 'My Calendar' && myCal.perms.write && !!mkt && !!hr, cCals.map((c) => c.name));
check('a private space\'s calendar is hidden from outsiders', !(await cals(ken)).some((c) => c.name === 'HR'));
const asYuki = (await cals(yuki)).find((c) => c.id === mkt.id);
check('team calendars follow the space role (commenter sees, cannot add)', asYuki?.perms.read && !asYuki.perms.write, asYuki?.perms);

// ── Range, recurrence, invitations seen ─────────────────────────────────────
const mine = await range(claudia);
const team = mine.filter((e) => e.title === 'Team Meeting');
check('a weekly event appears once per week in the range', team.length >= 3 && new Set(team.map((e) => e.occurrence)).size === team.length, team.map((e) => e.start));
check('occurrences keep their wall-clock time (09:00 Tokyo)', team.every((e) => new Date(e.start).getUTCHours() === 0), team.map((e) => e.start));
const itm = mine.find((e) => e.title === 'Mirai Systems Meeting');
check('an event carries guests with their answers, the meeting link and files', itm.attendees.length === 5 && itm.attendees.find((a) => a.user?.id === mika).response === 'tentative' && itm.meetingUrl?.includes('/meetings?room=') && itm.attachments[0].name === 'Project Plan Sep.pptx' && itm.myResponse === 'accepted', itm);
check('team calendar events are in the range of people who can read them', mine.some((e) => e.title === 'Marketing Plan Review' && e.calendarId === mkt.id));
const yRange = await range(yuki);
const yItm = yRange.find((e) => e.id === itm.id);
check('invited people see the event even though it sits in someone else\'s calendar', yItm?.myResponse === 'pending' && !yItm.canEdit, yItm);
check('people who are not invited cannot open it', (await call('GET', `/calendar/events/${itm.id}`, { user: ken })).status === 404);

// ── Free / busy ─────────────────────────────────────────────────────────────
const overlay = await range(ken, `&people=${claudia}`);
const busy = overlay.find((e) => e.id === itm.id);
check('someone else\'s time shows as busy, without details', busy?.busyOnly && busy.title === 'Busy' && busy.attendees.length === 0 && busy.meetingUrl === null, busy);
const pd = overlay.find((e) => e.title === 'Product Discussion');
check('… except events you are invited to', pd && !pd.busyOnly);

// ── Responding ──────────────────────────────────────────────────────────────
const r = await call('POST', `/calendar/events/${itm.id}/respond`, { user: yuki, body: { response: 'tentative' } });
check('answering an invitation', r.status === 201 && r.data.myResponse === 'tentative' && r.data.attendees.find((a) => a.user?.id === yuki).response === 'tentative', r.data);
await sleep(300);
check('the organizer is told', (await inbox(claudia)).some((n) => n.kind === 'calendar.response' && n.title === 'Yuki Sato might attend "Mirai Systems Meeting"'));
check('only guests can answer', (await call('POST', `/calendar/events/${itm.id}/respond`, { user: ken, body: { response: 'accepted' } })).status === 404);

// ── Creating with invitations ───────────────────────────────────────────────
const tomorrow = new Date(now.getTime() + day);
const start = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 5, 0)).toISOString();
const end = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 6, 0)).toISOString();
const created = await call('POST', '/calendar/events', {
  user: claudia,
  body: { calendarId: myCal.id, title: 'Launch rehearsal', start, end, timezone: 'Asia/Tokyo', location: 'Room C', meeting: { provider: 'office' }, guests: [{ email: 'hana@hanami.example' }, { email: 'Partner@Example.com', name: 'Partner' }], message: 'Please join the rehearsal.' },
});
check('creating an event with guests and a meeting link', created.status === 201 && created.data.attendees.length === 3 && created.data.meetingUrl && created.data.attendees.find((a) => a.email === 'partner@example.com').user === null, created.data);
await sleep(800);
check('people of the workspace get a bell invitation', (await inbox(hana)).some((n) => n.kind === 'calendar.invite' && n.title === 'Claudia Chen invited you to "Launch rehearsal"' && n.url === `/calendar?event=${created.data.id}`));
const hBox = (await call('GET', '/mail/mailboxes', { user: hana })).data.find((b) => b.kind === 'user');
const invite = (await call('GET', `/mail/mailboxes/${hBox.id}/threads`, { user: hana })).data.find((t) => t.subject.startsWith('Invitation: Launch rehearsal'));
const im = (await call('GET', `/mail/threads/${invite?.id}`, { user: hana })).data?.messages[0];
check('… and an invitation mail with the note and an .ics', !!im && im.text.startsWith('Please join the rehearsal.') && im.attachments[0]?.name === 'invite.ics', im);
const ics = await (await fetch(`${API}/mail/attachments/${im.attachments[0].id}`, { headers: { 'x-user-id': hana } })).text();
check('the .ics is an iCalendar REQUEST with organizer and guests', ics.includes('METHOD:REQUEST') && ics.includes('BEGIN:VEVENT') && ics.includes('SUMMARY:Launch rehearsal') && ics.includes('mailto:partner@example.com') && ics.includes(`UID:${created.data.id}@hanami.example`), ics);
check('the organizer is a guest who said yes', created.data.attendees.find((a) => a.user?.id === claudia).response === 'accepted');

check('commenters cannot add to a team calendar', (await call('POST', '/calendar/events', { user: yuki, body: { calendarId: mkt.id, title: 'x', start, end } })).status === 403);
check('people of the space who can edit add to it', (await call('POST', '/calendar/events', { user: mika, body: { calendarId: mkt.id, title: 'Photo shoot', start, end, notify: false } })).status === 201);
check('nobody adds to someone else\'s calendar', (await call('POST', '/calendar/events', { user: ken, body: { calendarId: myCal.id, title: 'x', start, end } })).status === 404);
check('the end must be after the start', (await call('POST', '/calendar/events', { user: claudia, body: { calendarId: myCal.id, title: 'x', start: end, end: start } })).status === 400);
check('unknown time zones are refused', (await call('POST', '/calendar/events', { user: claudia, body: { calendarId: myCal.id, title: 'x', start, end, timezone: 'Mars/Olympus' } })).status === 400);
const allDay = await call('POST', '/calendar/events', { user: claudia, body: { calendarId: myCal.id, title: 'Offsite', start, end: start, allDay: true, timezone: 'Asia/Tokyo', notify: false } });
check('all-day events run midnight to midnight in their zone', allDay.status === 201 && new Date(allDay.data.start).getUTCHours() === 15 && new Date(allDay.data.end).getTime() - new Date(allDay.data.start).getTime() === day, allDay.data);
check('asking for more than 120 days is refused', (await call('GET', `/calendar/events?from=${from}&to=${new Date(now.getTime() + 200 * day).toISOString()}`, { user: claudia })).status === 400);

// Monthly on the 31st only lands in months that have one.
const jan31 = '2027-01-31T01:00:00.000Z';
const monthly = await call('POST', '/calendar/events', { user: claudia, body: { calendarId: myCal.id, title: 'Month end close', start: jan31, end: '2027-01-31T02:00:00.000Z', timezone: 'Asia/Tokyo', recurrence: { freq: 'monthly', interval: 1, count: 6 }, notify: false } });
const closes = (await call('GET', `/calendar/events?from=2027-01-01T00:00:00Z&to=2027-04-30T00:00:00Z`, { user: claudia })).data.filter((e) => e.id === monthly.data.id);
check('monthly on the 31st skips months without one', closes.map((e) => e.start.slice(5, 10)).join() === '01-31,03-31', closes.map((e) => e.start));

// ── Changing and cancelling ─────────────────────────────────────────────────
const moved = await call('PATCH', `/calendar/events/${created.data.id}`, { user: claudia, body: { start: new Date(new Date(start).getTime() + 3600_000).toISOString(), end: new Date(new Date(end).getTime() + 3600_000).toISOString(), guests: [{ email: 'hana@hanami.example' }, { email: 'mika@hanami.example' }] } });
check('moving an event and changing guests', moved.status === 200 && moved.data.attendees.map((a) => a.email).sort().join() === 'claudia@hanami.example,hana@hanami.example,mika@hanami.example', moved.data.attendees);
await sleep(600);
check('guests hear about the change', (await inbox(hana)).some((n) => n.title === 'Claudia Chen changed "Launch rehearsal"'));
check('guests of other people cannot change it', (await call('PATCH', `/calendar/events/${created.data.id}`, { user: hana, body: { title: 'Mine' } })).status === 404);

const first = team[0];
await call('DELETE', `/calendar/events/${first.id}?occurrence=${encodeURIComponent(first.occurrence)}`, { user: claudia });
const after = (await range(claudia)).filter((e) => e.title === 'Team Meeting');
check('removing one occurrence keeps the rest of the series', after.length === team.length - 1 && !after.some((e) => e.occurrence === first.occurrence));

await call('DELETE', `/calendar/events/${created.data.id}`, { user: claudia });
await sleep(800);
check('cancelling tells the guests', (await inbox(mika)).some((n) => n.title === 'Claudia Chen cancelled "Launch rehearsal"'));
check('… and the event is gone', (await call('GET', `/calendar/events/${created.data.id}`, { user: claudia })).status === 404);

// ── Team calendars ──────────────────────────────────────────────────────────
const spaces = (await call('GET', '/spaces', { user: claudia })).data;
const finance = spaces.find((s) => s.name === 'Finance');
check('only space admins add a team calendar', (await call('POST', `/calendar/spaces/${finance.id}/calendar`, { user: hana, body: {} })).status === 403);
check('a space admin adds one', (await call('POST', `/calendar/spaces/${finance.id}/calendar`, { user: huong, body: {} })).status === 201 && (await cals(huong)).some((c) => c.name === 'Finance'));
check('one calendar per space', (await call('POST', `/calendar/spaces/${finance.id}/calendar`, { user: huong, body: {} })).status === 400);
void rina;

console.log(failures ? `\n${failures} check(s) failed` : '\nall calendar checks passed');
process.exit(failures ? 1 : 0);
