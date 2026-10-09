// Meetings end-to-end (§73) with fake cameras and microphones: start an instant meeting, preview, join, a second
// person joins and real WebRTC video flows both ways, mute / hand / reaction seen by others, in-call chat, a trusted
// room's lobby (ask to join → admit), host mutes someone, screen sharing, recording to Drive, notes, leaving,
// ending for everyone, history; a call from a direct message rings the other person; Video call on a profile.
// node e2e/meetings-flow.mjs   (needs the web app + API + seed)
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
let fails = 0;

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo', permissions: ['camera', 'microphone'] });
  const users = await (await ctx.request.get(`${BASE}/api/users`)).json();
  await ctx.addCookies([{ name: 'mo_uid', value: users.find((u) => u.email === email).id, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  return page;
}
const step = async (name, page, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    fails++;
    console.log('✗', name, '—', process.env.FULL ? e.message.slice(0, 1500) : e.message.split('\n')[0]);
    await page.screenshot({ path: join(tmpdir(), `mo-meetings-fail-${name.replace(/\W+/g, '_')}.png`), timeout: 10000 }).catch(() => undefined);
  }
};
/** A tile (by person) whose <video> is actually showing frames. */
const videoPlaying = (page, userId) =>
  page.waitForFunction(
    (id) => {
      const v = document.querySelector(`[data-testid="tile"][data-user="${id}"] video`);
      return !!v && v.videoWidth > 0 && v.readyState >= 2;
    },
    userId,
    { timeout: 30000 },
  );
const tile = (page, userId) => page.locator(`[data-testid="tile"][data-user="${userId}"]`).first();

const claudia = await session('claudia@hanami.example');
const ken = await session('ken@hanami.example');
const hana = await session('hana@hanami.example');
const users = await (await claudia.context().request.get(`${BASE}/api/users`)).json();
const id = (key) => users.find((u) => u.email === `${key}@hanami.example`).id;
let room = '';

await step('start an instant meeting and see yourself in the preview', claudia, async () => {
  await claudia.goto(`${BASE}/meetings`);
  await claudia.getByTestId('new-meeting').waitFor({ timeout: 60000 });
  await claudia.getByTestId('new-meeting').click();
  await claudia.getByTestId('instant-meeting').click();
  await claudia.waitForURL(/\/meetings\?room=[a-z]{3}-[a-z]{4}-[a-z]{3}/, { timeout: 30000 });
  room = new URL(claudia.url()).searchParams.get('room');
  await claudia.getByTestId('prejoin').waitFor({ timeout: 30000 });
  await claudia.getByTestId('prejoin-title').getByText("Claudia Chen's meeting").waitFor();
  await claudia.getByTestId('in-call-now').getByText('No one else is here').waitFor();
  await claudia.waitForFunction(() => {
    const v = document.querySelector('[data-testid="preview-video"]');
    return !!v && v.videoWidth > 0;
  });
});

await step('camera off shows your avatar; on again shows video', claudia, async () => {
  await claudia.getByTestId('toggle-cam').click();
  await claudia.getByText('Camera is off').waitFor();
  await claudia.getByTestId('toggle-cam').click();
  await claudia.getByTestId('preview-video').waitFor();
});

await step('join: alone in the room with a link to share', claudia, async () => {
  await claudia.getByTestId('join-now').click();
  await claudia.getByTestId('meeting-room').waitFor();
  await claudia.getByTestId('alone-card').waitFor();
  await videoPlaying(claudia, id('claudia'));
});

await step('a second person joins and video flows both ways over WebRTC', ken, async () => {
  await ken.goto(`${BASE}/meetings?room=${room}`);
  await ken.getByTestId('in-call-now').getByText('Claudia Chen is in this call').waitFor({ timeout: 60000 });
  await ken.getByTestId('join-now').click();
  await ken.getByTestId('meeting-room').waitFor();
  await videoPlaying(ken, id('claudia'));
  await videoPlaying(claudia, id('ken'));
  await claudia.getByTestId('alone-card').waitFor({ state: 'detached' });
});

await step('mute, raised hand and a reaction show on the other side', claudia, async () => {
  await ken.getByTestId('ctl-mic').click();
  await tile(claudia, id('ken')).getByTestId('tile-muted').waitFor();
  await ken.getByTestId('ctl-hand').click();
  await tile(claudia, id('ken')).getByTestId('tile-hand').waitFor();
  await ken.getByTestId('ctl-react').click();
  await ken.getByRole('button', { name: 'React 🎉' }).click();
  await claudia.getByTestId('reaction').filter({ hasText: 'Ken Watanabe' }).waitFor();
  await ken.getByTestId('ctl-hand').click();
  await tile(claudia, id('ken')).getByTestId('tile-hand').waitFor({ state: 'detached' });
});

await step('in-call chat with an unread badge', ken, async () => {
  await claudia.getByTestId('ctl-chat').click();
  await claudia.getByTestId('chat-input').fill('Hello team');
  await claudia.getByTestId('chat-input').press('Enter');
  await claudia.getByTestId('chat-message').filter({ hasText: 'Hello team' }).waitFor();
  await ken.getByTestId('ctl-chat').getByText('1').waitFor();
  await ken.getByTestId('ctl-chat').click();
  await ken.getByTestId('chat-message').filter({ hasText: 'Hello team' }).waitFor();
  await ken.getByTestId('ctl-chat').click();
  await claudia.getByTestId('ctl-chat').click();
});

await step('trusted room: someone asks to join and the host admits them', hana, async () => {
  await claudia.getByTestId('ctl-more').click();
  await claudia.getByTestId('toggle-access').click();
  await hana.goto(`${BASE}/meetings?room=${room}`);
  await hana.getByTestId('ask-to-join').click({ timeout: 60000 });
  await hana.getByTestId('waiting-room').waitFor();
  await claudia.getByTestId('ctl-people').click();
  await claudia.getByTestId('lobby').getByText('Hana Lee').waitFor();
  await claudia.getByTestId('lobby-admit').click();
  await hana.getByTestId('meeting-room').waitFor({ timeout: 20000 });
  await videoPlaying(hana, id('claudia'));
  await videoPlaying(hana, id('ken'));
  await claudia.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 3);
});

await step('the host mutes someone from the people panel', hana, async () => {
  await claudia.locator('[data-testid="person"][data-user="' + id('hana') + '"]').getByTestId('person-menu').click();
  await claudia.getByTestId('mute-person').click();
  await hana.getByTestId('ctl-mic').getByText('Unmute').waitFor();
  await tile(claudia, id('hana')).getByTestId('tile-muted').waitFor();
  await claudia.getByTestId('ctl-people').click();
});

await step('screen sharing takes the stage for everyone', ken, async () => {
  await ken.getByTestId('ctl-share').click();
  await ken.getByTestId('screen-stage').waitFor();
  await claudia.getByTestId('screen-stage').getByText('Ken Watanabe is presenting').waitFor({ timeout: 20000 });
  await claudia.waitForFunction(() => {
    const v = document.querySelector('[data-testid="screen-stage"] video');
    return !!v && v.videoWidth > 0;
  });
  await ken.getByTestId('ctl-share').click();
  await claudia.getByTestId('screen-stage').waitFor({ state: 'detached', timeout: 20000 });
});

await step('recording: everyone sees the sign, the video lands in Drive', claudia, async () => {
  await claudia.getByTestId('ctl-record').click();
  await ken.getByTestId('recording-badge').getByText('Claudia Chen').waitFor();
  await claudia.waitForTimeout(2500);
  await claudia.getByTestId('ctl-record').click();
  await claudia.getByText('Recording saved to Drive').waitFor({ timeout: 30000 });
  await ken.getByTestId('recording-badge').waitFor({ state: 'detached' });
  const m = await (await claudia.context().request.get(`${BASE}/api/meetings/${room}`)).json();
  if (m.recordings.length !== 1 || !m.recordings[0].name.endsWith('.webm') || m.recordings[0].durationMs < 2000) throw new Error(JSON.stringify(m.recordings));
  const res = await ken.context().request.get(`${BASE}/api/resources/${m.recordings[0].id}`);
  if (res.status() !== 200) throw new Error('participants cannot open the recording');
});

await step('notes open a shared document in a new tab', ken, async () => {
  const [doc] = await Promise.all([ken.context().waitForEvent('page'), ken.getByTestId('ctl-notes').click()]);
  await doc.waitForURL(/\/docs\//, { timeout: 30000 });
  await doc.close();
});

await step('leaving: the others carry on', hana, async () => {
  await hana.getByTestId('ctl-leave').click();
  await hana.getByTestId('after-call').getByText('You left the meeting').waitFor();
  await claudia.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 2);
});

await step('the host ends the meeting for everyone; it is in the history with its recording', ken, async () => {
  await claudia.getByTestId('ctl-more').click();
  await claudia.getByTestId('end-for-all').click();
  await ken.getByTestId('after-call').getByText('The meeting has ended').waitFor({ timeout: 15000 });
  await claudia.getByTestId('after-call').waitFor();
  await ken.goto(`${BASE}/meetings`);
  const row = ken.locator(`[data-testid="meeting-row"][data-code="${room}"]`);
  await row.waitFor({ timeout: 30000 });
  await row.getByTestId('recording-link').waitFor();
});

await step('calling from a direct message rings the other person, who picks up', hana, async () => {
  await hana.goto(`${BASE}/home`);
  const { id: dm } = await (await ken.context().request.post(`${BASE}/api/chat/conversations`, { data: { kind: 'dm', userId: id('hana') } })).json();
  await ken.goto(`${BASE}/chat/${dm}`);
  await ken.getByTestId('start-call').click({ timeout: 60000 });
  await ken.getByTestId('prejoin').waitFor({ timeout: 30000 });
  await ken.getByTestId('join-now').click();
  await ken.getByTestId('meeting-room').waitFor();
  await hana.getByTestId('incoming-call').getByText('Ken Watanabe').waitFor({ timeout: 15000 });
  await hana.getByTestId('accept-call').click();
  await hana.getByTestId('join-now').click({ timeout: 30000 });
  await hana.getByTestId('meeting-room').waitFor();
  await videoPlaying(hana, id('ken'));
  await ken.getByTestId('ctl-leave').click();
  await hana.getByTestId('ctl-leave').click();
  await hana.goto(`${BASE}/chat/${dm}`);
  await hana.getByTestId('meeting-card').last().getByTestId('meeting-card-status').getByText(/^Ended/).waitFor({ timeout: 30000 });
});

await step('Video call from a profile opens a call with that person', claudia, async () => {
  await claudia.goto(`${BASE}/contacts/${id('sora')}`);
  await claudia.getByTestId('profile-call').click({ timeout: 60000 });
  await claudia.waitForURL(/\/meetings\?room=/, { timeout: 30000 });
  await claudia.getByTestId('prejoin').getByText('Call in Sora Ito').waitFor();
});

await browser.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} step(s) failed` : '\nall meetings e2e steps passed');
process.exit(fails ? 1 : 0);
