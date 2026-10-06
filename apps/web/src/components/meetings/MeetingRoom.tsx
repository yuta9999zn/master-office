'use client';

import { MEETING_REACTIONS, type MeetingDetail, type MeetingMessage, type MeetingPeer, type UserSummary } from '@workos/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Circle,
  Copy,
  Ellipsis,
  FileText,
  Hand,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  SendHorizontal,
  ShieldCheck,
  SmilePlus,
  Square,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from 'zustand';
import { api } from '@/lib/api';
import { MeetingCall, type CallState, type RemoteView } from '@/lib/meeting-call';
import { formatDuration, meetingPath, useMeeting } from '@/lib/meetings';
import { useMe } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime';
import { Avatar, AvatarStack, Button, cn, LogoMark, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tip } from '../ui/primitives';

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const whenFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const meetingLink = (code: string) => `${window.location.origin}${meetingPath(code)}`;
const copyLink = (code: string) => {
  void navigator.clipboard?.writeText(meetingLink(code)).catch(() => undefined);
  toast.success('Meeting link copied');
};

/** /meetings?room=… — the preview / lobby, the call itself, and what comes after. */
export function MeetingRoom({ code }: { code: string }) {
  const { data: me } = useMe();
  const { data: meeting, error } = useMeeting(code);
  const qc = useQueryClient();
  const [call, setCall] = useState<MeetingCall | null>(null);
  const user = me?.user as UserSummary | undefined;

  useEffect(() => {
    if (!user?.id) return;
    const c = new MeetingCall(code, user);
    setCall(c);
    void c.preview({ mic: true, cam: true });
    return () => c.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user?.id]);

  useRealtime((e) => {
    call?.handle(e);
    // Becoming (or no longer being) a co-host changes what the controls offer.
    if (e.type === 'meeting.peer.updated' && call && e.peer.peerId === call.peerId) void qc.invalidateQueries({ queryKey: ['meetings', 'one', code] });
  });

  if (error)
    return (
      <Centered>
        <div className="text-center" data-testid="meeting-missing">
          <h2 className="text-[20px] font-semibold text-ink">Check your meeting code</h2>
          <p className="mt-2 text-[14px] text-muted">Make sure you entered the correct meeting code in the URL, for example abc-defg-hij.</p>
          <Link href="/meetings" className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
            Return to Meetings
          </Link>
        </div>
      </Centered>
    );
  if (!meeting || !call || !user) return <Centered><Loader2 className="animate-spin text-subtle" /></Centered>;
  return <Room call={call} meeting={meeting} me={user} />;
}

function Room({ call, meeting, me }: { call: MeetingCall; meeting: MeetingDetail; me: UserSummary }) {
  const phase = useStore(call.store, (s) => s.phase);
  if (phase === 'in') return <InCall call={call} meeting={meeting} me={me} />;
  if (phase === 'left' || phase === 'ended' || phase === 'removed') return <AfterCall call={call} meeting={meeting} />;
  return <PreJoin call={call} meeting={meeting} me={me} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center bg-canvas p-8">{children}</div>;
}

// ── Media elements ──────────────────────────────────────────────────────────

function StreamVideo({ stream, mirror, contain, className, testId }: { stream: MediaStream; mirror?: boolean; contain?: boolean; className?: string; testId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={cn('size-full', contain ? 'object-contain' : 'object-cover', mirror && '-scale-x-100', className)} data-testid={testId} />;
}

function StreamAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (a && a.srcObject !== stream) {
      a.srcObject = stream;
      void a.play().catch(() => undefined);
    }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

const liveVideo = (s: MediaStream) => s.getVideoTracks().some((t) => t.readyState === 'live');
const cameraOf = (v: RemoteView) => v.streams.find((s) => s.id !== v.info.screen && liveVideo(s)) ?? null;
const screenOf = (v: RemoteView) => (v.info.screen ? v.streams.find((s) => s.id === v.info.screen && liveVideo(s)) ?? null : null);

// ── Before joining ──────────────────────────────────────────────────────────

function PreJoin({ call, meeting, me }: { call: MeetingCall; meeting: MeetingDetail; me: UserSummary }) {
  const s = useStore(call.store);
  const knock = meeting.me.entry === 'knock';
  const others = meeting.inRoom.filter((u) => u.id !== me.id);
  const full = meeting.peers.length >= 8;
  const who =
    others.length === 0
      ? 'No one else is here'
      : others.length === 1
        ? `${others[0].name} is in this call`
        : `${others[0].name} and ${others.length - 1} other${others.length > 2 ? 's' : ''} are in this call`;

  return (
    <div className="h-full overflow-auto bg-canvas" data-testid="prejoin">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-center gap-10 px-8 py-10">
        <div className="w-[640px] max-w-full">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0b1020] shadow-lg">
            {s.cam && s.local?.getVideoTracks().length ? (
              <StreamVideo stream={s.local} mirror testId="preview-video" />
            ) : (
              <div className="grid size-full place-items-center">
                <div className="text-center">
                  <Avatar user={me} size={88} className="mx-auto" />
                  <p className="mt-3 text-[13px] text-white/70">{s.noCam ? 'No camera found' : 'Camera is off'}</p>
                </div>
              </div>
            )}
            <span className="absolute left-4 top-3 text-[13px] font-medium text-white/90 drop-shadow">{me.name}</span>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
              <RoundToggle on={s.mic} disabled={s.noMic} label={s.mic ? 'Turn off microphone' : 'Turn on microphone'} onClick={() => call.setMic(!s.mic)} testId="toggle-mic">
                {s.mic ? <Mic size={20} /> : <MicOff size={20} />}
              </RoundToggle>
              <RoundToggle on={s.cam} disabled={s.noCam && !s.cam} label={s.cam ? 'Turn off camera' : 'Turn on camera'} onClick={() => void call.setCam(!s.cam)} testId="toggle-cam">
                {s.cam ? <Video size={20} /> : <VideoOff size={20} />}
              </RoundToggle>
            </div>
          </div>
          <DevicePickers call={call} />
        </div>

        <div className="w-[340px] max-w-full text-center">
          <h2 className="text-[24px] font-semibold text-ink" data-testid="prejoin-title">
            {meeting.title}
          </h2>
          {meeting.event && <p className="mt-1 text-[13px] text-muted">{whenFmt.format(new Date(meeting.event.startAt))}</p>}
          {meeting.conversationTitle && <p className="mt-1 text-[13px] text-muted">Call in {meeting.conversationTitle}</p>}
          <div className="mt-4 flex items-center justify-center gap-2 text-[13.5px] text-ink-2" data-testid="in-call-now">
            {others.length > 0 && <AvatarStack users={others} max={4} size={26} />}
            {who}
          </div>

          <div className="mt-6 flex flex-col items-center gap-3">
            {s.phase === 'waiting' ? (
              <div className="flex flex-col items-center gap-3" data-testid="waiting-room">
                <p className="flex items-center gap-2 text-[14px] text-ink-2">
                  <Loader2 size={16} className="animate-spin text-brand-600" /> Asking to be let in…
                </p>
                <p className="text-[12.5px] text-muted">{meeting.live ? 'You will join when someone lets you in.' : 'No one is in the meeting yet — you will join when the host lets you in.'}</p>
                <Button variant="ghost" onClick={() => void call.cancelKnock()}>
                  Cancel
                </Button>
              </div>
            ) : s.phase === 'denied' ? (
              <div data-testid="join-denied">
                <p className="text-[14px] font-medium text-ink">You can&apos;t join this call</p>
                <p className="mt-1 text-[12.5px] text-muted">Someone in the call denied your request to join.</p>
                <Link href="/meetings" className="mt-4 inline-block text-[13px] font-medium text-brand-700 hover:underline">
                  Return to Meetings
                </Link>
              </div>
            ) : (
              <>
                <Button variant="primary" className="h-11 rounded-full px-8 text-[14px]" disabled={full} loading={s.phase === 'joining'} onClick={() => void call.join(meeting.id)} data-testid={knock ? 'ask-to-join' : 'join-now'}>
                  {knock ? 'Ask to join' : 'Join now'}
                </Button>
                {full && <p className="text-[12.5px] text-red-600">This call is full (8 people).</p>}
                {s.error && (
                  <p className="text-[12.5px] text-red-600" data-testid="join-error">
                    {s.error}
                  </p>
                )}
              </>
            )}
            <button onClick={() => copyLink(meeting.code)} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
              <Copy size={13} /> {meeting.code}
            </button>
            {meeting.access === 'trusted' && (
              <p className="flex items-center gap-1 text-[12px] text-subtle">
                <Lock size={12} /> Only invited people join directly
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundToggle({ on, label, onClick, disabled, children, testId }: { on: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <Tip label={label} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={on}
        className={cn('grid size-12 place-items-center rounded-full text-white transition-colors disabled:opacity-40', on ? 'bg-white/15 ring-1 ring-white/40 hover:bg-white/25' : 'bg-red-500 hover:bg-red-600')}
        data-testid={testId}
      >
        {children}
      </button>
    </Tip>
  );
}

function DevicePickers({ call }: { call: MeetingCall }) {
  const s = useStore(call.store);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then(setDevices, () => undefined);
  }, [s.local]);
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
  const cams = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  const currentMic = s.micId ?? s.local?.getAudioTracks()[0]?.getSettings().deviceId ?? '';
  const currentCam = s.camId ?? s.local?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
  return (
    <div className="mt-3 flex gap-3">
      {[
        { list: mics, value: currentMic, icon: <Mic size={14} />, kind: 'mic' as const, empty: 'No microphone' },
        { list: cams, value: currentCam, icon: <Video size={14} />, kind: 'cam' as const, empty: 'No camera' },
      ].map((d) => (
        <label key={d.kind} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 text-[12.5px] text-ink-2 ring-1 ring-line">
          <span className="text-muted">{d.icon}</span>
          <select value={d.value} onChange={(e) => void call.useDevice(d.kind, e.target.value)} className="min-w-0 flex-1 truncate bg-transparent outline-none" aria-label={d.kind === 'mic' ? 'Microphone' : 'Camera'} disabled={!d.list.length}>
            {d.list.length ? d.list.map((x, i) => <option key={x.deviceId} value={x.deviceId}>{x.label || `${d.kind === 'mic' ? 'Microphone' : 'Camera'} ${i + 1}`}</option>) : <option>{d.empty}</option>}
          </select>
        </label>
      ))}
    </div>
  );
}

// ── In the call ─────────────────────────────────────────────────────────────

type Panel = 'chat' | 'people' | 'info' | null;

function InCall({ call, meeting, me }: { call: MeetingCall; meeting: MeetingDetail; me: UserSummary }) {
  const s = useStore(call.store);
  const [panel, setPanel] = useState<Panel>(null);
  const [now, setNow] = useState(() => new Date());
  const remotes = Object.values(s.peers);
  const manage = meeting.me.manage;
  const lobbySeen = useRef(new Set<string>());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (s.mutedBy) toast(`${s.mutedBy} muted your microphone`, { description: 'Turn it back on when you want to talk.' });
  }, [s.mutedBy]);
  useEffect(() => {
    if (panel === 'chat') call.readChat();
  }, [panel, s.messages.length, call]);
  // Someone asks to join: a heads-up with Admit, unless the people panel is open anyway.
  useEffect(() => {
    for (const u of s.lobby)
      if (!lobbySeen.current.has(u.id)) {
        lobbySeen.current.add(u.id);
        if (panel !== 'people')
          toast(`${u.name} wants to join this call`, { action: { label: 'Admit', onClick: () => void admit(meeting.code, u.id, true) }, duration: 15_000 });
      }
    for (const id of [...lobbySeen.current]) if (!s.lobby.some((u) => u.id === id)) lobbySeen.current.delete(id);
  }, [s.lobby, panel, meeting.code]);

  const sharing = s.screen ? { who: 'me' as const, stream: s.screen } : (() => {
    for (const v of remotes) {
      const st = screenOf(v);
      if (st) return { who: v, stream: st };
    }
    return null;
  })();

  const tiles: TileProps[] = [
    { id: 'me', name: `${me.name} (You)`, user: me, stream: s.cam ? s.local : null, mirror: true, mic: s.mic, hand: s.hand, speaking: s.speaking === 'me', me: true, role: meeting.me.role },
    ...remotes.map((v) => ({
      id: v.info.peerId,
      name: v.info.user.name,
      user: v.info.user,
      stream: v.info.cam ? cameraOf(v) : null,
      mic: v.info.mic,
      hand: v.info.hand,
      speaking: s.speaking === v.info.peerId,
      connecting: v.connection !== 'connected',
      role: v.info.role,
    })),
  ];

  const leave = async () => {
    const saving = s.recordingHere;
    if (saving) toast.loading('Saving the recording…', { id: 'rec' });
    await call.leave();
    if (saving) toast.success('Recording saved to Drive', { id: 'rec' });
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0b1020] text-white" data-testid="meeting-room">
      {remotes.map((v) => v.streams.filter((x) => x.getAudioTracks().length).map((x) => <StreamAudio key={`${v.info.peerId}:${x.id}`} stream={x} />))}

      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <LogoMark size={26} />
        <h1 className="truncate text-[15px] font-semibold" data-testid="room-title">
          {meeting.title}
        </h1>
        <span className="text-[13px] text-white/60">{timeFmt.format(now)}</span>
        {s.recording && (
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[12px] font-medium text-red-300" data-testid="recording-badge">
            <span className="size-2 animate-pulse rounded-full bg-red-500" /> Recording…{s.recording.by.id !== me.id ? ` (${s.recording.by.name})` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DarkIcon label="Meeting details" active={panel === 'info'} onClick={() => setPanel(panel === 'info' ? null : 'info')}>
            <Info size={18} />
          </DarkIcon>
          <DarkIcon label="Leave call" onClick={() => void leave()}>
            <X size={18} />
          </DarkIcon>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-2">
        <div className="relative min-w-0 flex-1">
          {sharing ? (
            <div className="flex size-full gap-3">
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl bg-black" data-meeting-stage data-testid="screen-stage">
                <StreamVideo stream={sharing.stream} contain />
                <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[12px]">
                  {sharing.who === 'me' ? 'You are presenting' : `${sharing.who.info.user.name} is presenting`}
                </span>
              </div>
              <div className="flex w-[220px] shrink-0 flex-col gap-3 overflow-auto">
                {tiles.map((t) => (
                  <div key={t.id} className="aspect-video shrink-0">
                    <Tile {...t} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Grid tiles={tiles} />
          )}
          {remotes.length === 0 && (
            <div className="absolute bottom-4 left-4 w-[300px] rounded-xl bg-white p-4 text-ink shadow-xl" data-testid="alone-card">
              <p className="text-[14px] font-semibold">You&apos;re the only one here</p>
              <p className="mt-1 text-[12.5px] text-muted">Share this meeting link with others you want in the meeting.</p>
              <button onClick={() => copyLink(meeting.code)} className="mt-3 flex w-full items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-left text-[12.5px] ring-1 ring-line hover:bg-hover">
                <span className="min-w-0 flex-1 truncate">{meetingLink(meeting.code).replace(/^https?:\/\//, '')}</span>
                <Copy size={14} className="text-muted" />
              </button>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col-reverse gap-2" aria-live="polite">
            {s.reactions.map((r) => (
              <span key={r.id} className="animate-[float_4s_ease-out_forwards] rounded-full bg-black/50 px-3 py-1.5 text-[14px]" data-testid="reaction">
                <span className="text-[22px]">{r.emoji}</span> <span className="text-[12px] text-white/80">{r.name}</span>
              </span>
            ))}
          </div>
        </div>
        {panel && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl bg-white text-ink">
            {panel === 'chat' && <ChatPanel call={call} messages={s.messages} onClose={() => setPanel(null)} me={me} />}
            {panel === 'people' && <PeoplePanel call={call} meeting={meeting} state={s} me={me} onClose={() => setPanel(null)} />}
            {panel === 'info' && <InfoPanel meeting={meeting} onClose={() => setPanel(null)} />}
          </aside>
        )}
      </div>

      <Controls call={call} meeting={meeting} state={s} manage={manage} panel={panel} setPanel={setPanel} onLeave={() => void leave()} count={remotes.length + 1} />
    </div>
  );
}

async function admit(code: string, userId: string, allow: boolean) {
  await api(`/meetings/${code}/admit`, { method: 'POST', json: { userId, allow } }).catch((e: Error) => toast.error(e.message));
}

function DarkIcon({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Tip label={label}>
      <button onClick={onClick} aria-label={label} className={cn('grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white', active && 'bg-white/15 text-white')}>
        {children}
      </button>
    </Tip>
  );
}

function Grid({ tiles }: { tiles: TileProps[] }) {
  const n = tiles.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  return (
    <div className="grid size-full gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }} data-testid="tile-grid">
      {tiles.map((t) => (
        <Tile key={t.id} {...t} />
      ))}
    </div>
  );
}

interface TileProps {
  id: string;
  name: string;
  user: UserSummary;
  stream: MediaStream | null;
  mirror?: boolean;
  mic: boolean;
  hand: boolean;
  speaking: boolean;
  connecting?: boolean;
  me?: boolean;
  role: MeetingPeer['role'];
}

function Tile({ name, user, stream, mirror, mic, hand, speaking, connecting, me, role }: TileProps) {
  const video = stream && stream.getVideoTracks().length > 0;
  return (
    <div
      className={cn('relative size-full overflow-hidden rounded-xl bg-[#1e293b] ring-2 transition-shadow', speaking ? 'ring-sky-400' : 'ring-transparent')}
      data-meeting-tile
      data-name={name}
      data-color={user.avatarColor}
      data-testid="tile"
      data-me={me ? '1' : undefined}
      data-user={user.id}
      data-speaking={speaking ? '1' : undefined}
    >
      {video ? (
        <StreamVideo stream={stream} mirror={mirror} testId="tile-video" />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar user={user} size={72} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1.5 truncate rounded-md bg-black/55 px-2 py-0.5 text-[12px]" data-testid="tile-name">
        {name}
        {role !== 'guest' && <span className="text-white/60">· {role === 'host' ? 'Host' : 'Co-host'}</span>}
      </span>
      <span className="absolute right-2 top-2 flex gap-1.5">
        {hand && (
          <span className="grid size-7 place-items-center rounded-full bg-amber-400 text-ink" title="Hand raised" data-testid="tile-hand">
            <Hand size={15} />
          </span>
        )}
        {!mic && (
          <span className="grid size-7 place-items-center rounded-full bg-black/55" title="Muted" data-testid="tile-muted">
            <MicOff size={14} />
          </span>
        )}
      </span>
      {connecting && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white/80">
          <Loader2 size={11} className="animate-spin" /> Connecting
        </span>
      )}
    </div>
  );
}

function Controls({
  call,
  meeting,
  state: s,
  manage,
  panel,
  setPanel,
  onLeave,
  count,
}: {
  call: MeetingCall;
  meeting: MeetingDetail;
  state: CallState;
  manage: boolean;
  panel: Panel;
  setPanel: (p: Panel) => void;
  onLeave: () => void;
  count: number;
}) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const record = async () => {
    setBusy(true);
    try {
      if (s.recordingHere) {
        toast.loading('Saving the recording…', { id: 'rec' });
        const saved = await call.stopRecording();
        if (saved) toast.success('Recording saved to Drive', { id: 'rec', description: saved.name, action: { label: 'Open', onClick: () => window.open(`/preview/${saved.id}`, '_blank') } });
        else toast.dismiss('rec');
      } else await call.startRecording(meeting.title);
    } catch (e) {
      toast.error((e as Error).message, { id: 'rec' });
    } finally {
      setBusy(false);
    }
  };
  const notes = async () => {
    try {
      const { id } = await api<{ id: string }>(`/meetings/${meeting.code}/notes`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['meetings', 'one', meeting.code] });
      window.open(`/docs/${id}`, '_blank');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const recordingByOther = !!s.recording && !s.recordingHere;

  return (
    <footer className="flex h-[84px] shrink-0 items-center justify-center gap-2 px-5">
      <Ctl label={s.mic ? 'Mic' : 'Unmute'} off={!s.mic} disabled={s.noMic} onClick={() => call.setMic(!s.mic)} testId="ctl-mic">
        {s.mic ? <Mic size={20} /> : <MicOff size={20} />}
      </Ctl>
      <Ctl label="Camera" off={!s.cam} onClick={() => void call.setCam(!s.cam)} testId="ctl-cam">
        {s.cam ? <Video size={20} /> : <VideoOff size={20} />}
      </Ctl>
      <Ctl label={s.screen ? 'Stop sharing' : 'Share'} active={!!s.screen} onClick={() => void (s.screen ? call.stopScreen() : call.shareScreen())} testId="ctl-share">
        {s.screen ? <ScreenShareOff size={20} /> : <MonitorUp size={20} />}
      </Ctl>
      {manage && (
        <Ctl label={s.recordingHere ? 'Stop' : 'Record'} active={s.recordingHere} disabled={busy || recordingByOther} onClick={() => void record()} testId="ctl-record">
          {s.recordingHere ? <Square size={18} className="fill-red-500 text-red-500" /> : <Circle size={20} />}
        </Ctl>
      )}
      <Ctl label="Notes" onClick={() => void notes()} testId="ctl-notes">
        <FileText size={20} />
      </Ctl>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <button className="flex w-[64px] flex-col items-center gap-1 text-[11.5px] text-white/80" aria-label="Send a reaction" data-testid="ctl-react">
            <span className="grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20">
              <SmilePlus size={20} />
            </span>
            React
          </button>
        </MenuTrigger>
        <MenuContent align="center" className="flex gap-1 p-1.5">
          {MEETING_REACTIONS.map((e) => (
            <button key={e} onClick={() => call.react(e)} className="rounded-lg p-1.5 text-[22px] hover:bg-hover" aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </MenuContent>
      </Menu>
      <Ctl label={s.hand ? 'Lower hand' : 'Raise hand'} active={s.hand} onClick={() => call.raiseHand(!s.hand)} testId="ctl-hand">
        <Hand size={20} />
      </Ctl>
      <Ctl label="Chat" active={panel === 'chat'} badge={s.unread || undefined} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} testId="ctl-chat">
        <MessageSquareText size={20} />
      </Ctl>
      <Ctl label="Participants" active={panel === 'people'} badge={s.lobby.length || undefined} count={count} onClick={() => setPanel(panel === 'people' ? null : 'people')} testId="ctl-people">
        <Users size={20} />
      </Ctl>
      <Menu>
        <MenuTrigger asChild>
          <button className="flex w-[64px] flex-col items-center gap-1 text-[11.5px] text-white/80" aria-label="More options" data-testid="ctl-more">
            <span className="grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20">
              <Ellipsis size={20} />
            </span>
            More
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Copy size={15} />} onSelect={() => copyLink(meeting.code)}>
            Copy meeting link
          </MenuItem>
          {manage && (
            <>
              <MenuSeparator />
              <MenuLabel>Host controls</MenuLabel>
              <MenuItem
                icon={<ShieldCheck size={15} />}
                onSelect={() => void api(`/meetings/${meeting.code}`, { method: 'PATCH', json: { access: meeting.access === 'open' ? 'trusted' : 'open' } }).catch((e: Error) => toast.error(e.message))}
                data-testid="toggle-access"
              >
                {meeting.access === 'open' ? 'Only invited people join directly' : 'Anyone in the workspace joins directly'}
              </MenuItem>
              <MenuItem icon={<PhoneOff size={15} />} danger onSelect={() => void api(`/meetings/${meeting.code}/end`, { method: 'POST' }).catch((e: Error) => toast.error(e.message))} data-testid="end-for-all">
                End meeting for everyone
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <button onClick={onLeave} className="ml-3 flex h-11 items-center gap-2 rounded-full bg-red-500 px-6 text-[14px] font-semibold hover:bg-red-600" data-testid="ctl-leave">
        <PhoneOff size={18} /> Leave
      </button>
    </footer>
  );
}

function Ctl({ label, onClick, off, active, disabled, badge, count, children, testId }: { label: string; onClick: () => void; off?: boolean; active?: boolean; disabled?: boolean; badge?: number; count?: number; children: React.ReactNode; testId?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={active ?? (off === undefined ? undefined : !off)} aria-label={label} className="flex w-[64px] flex-col items-center gap-1 text-[11.5px] text-white/80 disabled:opacity-40" data-testid={testId}>
      <span className={cn('relative grid size-11 place-items-center rounded-full transition-colors', off ? 'bg-red-500 text-white hover:bg-red-600' : active ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-white/10 hover:bg-white/20')}>
        {children}
        {count !== undefined && <span className="absolute -right-1 -top-1 rounded-full bg-white/20 px-1.5 text-[10.5px] font-semibold text-white">{count}</span>}
        {badge !== undefined && <span className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-red-500 text-[10.5px] font-semibold text-white">{badge}</span>}
      </span>
      {label}
    </button>
  );
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Close panel">
        <X size={16} />
      </button>
    </div>
  );
}

function ChatPanel({ call, messages, onClose, me }: { call: MeetingCall; messages: MeetingMessage[]; onClose: () => void; me: UserSummary }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    await call.say(body).catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-panel">
      <PanelHead title="In-call messages" onClose={onClose} />
      <p className="mx-4 mt-3 rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">Messages are kept with the meeting and can be read by everyone who joins it.</p>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
        {messages.map((m) => (
          <div key={m.id} data-testid="chat-message">
            <p className="text-[12px]">
              <span className="font-semibold text-ink">{m.user?.id === me.id ? 'You' : m.user?.name ?? 'Someone'}</span> <span className="text-subtle">{timeFmt.format(new Date(m.createdAt))}</span>
            </p>
            <p className="whitespace-pre-wrap text-[13.5px] text-ink-2 [overflow-wrap:anywhere]">{m.body}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="m-3 flex items-center gap-2 rounded-full bg-canvas px-4 py-2 ring-1 ring-line focus-within:ring-brand-500"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" aria-label="Message" data-testid="chat-input" />
        <button type="submit" disabled={!text.trim()} className="text-brand-600 disabled:text-subtle" aria-label="Send">
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}

function PeoplePanel({ call, meeting, state: s, me, onClose }: { call: MeetingCall; meeting: MeetingDetail; state: CallState; me: UserSummary; onClose: () => void }) {
  const manage = meeting.me.manage;
  const host = meeting.me.role === 'host';
  const act = (path: string, json: unknown) => void api(`/meetings/${meeting.code}/${path}`, { method: 'POST', json }).catch((e: Error) => toast.error(e.message));
  const people = [
    { peerId: call.peerId, user: me, role: meeting.me.role, mic: s.mic, hand: s.hand, me: true },
    ...Object.values(s.peers).map((v) => ({ peerId: v.info.peerId, user: v.info.user, role: v.info.role, mic: v.info.mic, hand: v.info.hand, me: false })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="people-panel">
      <PanelHead title="People" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {s.lobby.length > 0 && (
          <section className="mb-3 rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200" data-testid="lobby">
            <h3 className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-amber-800">Waiting to join ({s.lobby.length})</h3>
            {s.lobby.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <Avatar user={u} size={30} />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.name}</span>
                <button onClick={() => void admit(meeting.code, u.id, false)} className="rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-white" data-testid="lobby-deny">
                  Deny
                </button>
                <button onClick={() => void admit(meeting.code, u.id, true)} className="rounded-md bg-brand-600 px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-brand-700" data-testid="lobby-admit">
                  Admit
                </button>
              </div>
            ))}
          </section>
        )}
        <h3 className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-subtle">In the meeting ({people.length})</h3>
        {people.map((p) => (
          <div key={p.peerId} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover" data-testid="person" data-user={p.user.id}>
            <Avatar user={p.user} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">
                {p.user.name}
                {p.me && ' (You)'}
              </p>
              {p.role !== 'guest' && <p className="text-[11.5px] text-muted">{p.role === 'host' ? 'Meeting host' : 'Co-host'}</p>}
            </div>
            {p.hand && <Hand size={15} className="text-amber-500" />}
            {p.mic ? <Mic size={15} className="text-muted" /> : <MicOff size={15} className="text-red-500" />}
            {manage && !p.me && (
              <Menu>
                <MenuTrigger asChild>
                  <button className="rounded-md p-1 text-muted hover:bg-white" aria-label={`Options for ${p.user.name}`} data-testid="person-menu">
                    <Ellipsis size={16} />
                  </button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<MicOff size={15} />} disabled={!p.mic} onSelect={() => act('mute', { peerId: p.peerId })} data-testid="mute-person">
                    Mute
                  </MenuItem>
                  {host && p.role !== 'host' && (
                    <MenuItem icon={<ShieldCheck size={15} />} onSelect={() => act('cohost', { userId: p.user.id, on: p.role !== 'cohost' })}>
                      {p.role === 'cohost' ? 'Remove co-host' : 'Make co-host'}
                    </MenuItem>
                  )}
                  {p.role !== 'host' && (
                    <MenuItem icon={<X size={15} />} danger onSelect={() => act('remove', { userId: p.user.id })} data-testid="remove-person">
                      Remove from meeting
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoPanel({ meeting, onClose }: { meeting: MeetingDetail; onClose: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="Meeting details" onClose={onClose} />
      <div className="space-y-4 p-4 text-[13.5px]">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">Joining info</p>
          <p className="mt-1 break-all text-ink-2">{meetingLink(meeting.code)}</p>
          <button onClick={() => copyLink(meeting.code)} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <Copy size={14} /> Copy joining info
          </button>
        </div>
        {meeting.host && (
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">Host</p>
            <p className="mt-1 flex items-center gap-2">
              <Avatar user={meeting.host} size={22} /> {meeting.host.name}
            </p>
          </div>
        )}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">Access</p>
          <p className="mt-1 text-ink-2">{meeting.access === 'open' ? 'Anyone in the workspace can join directly.' : 'Invited people join directly; others ask to join.'}</p>
        </div>
        {meeting.event && (
          <Link href={`/calendar?event=${meeting.event.id}`} target="_blank" className="block text-[13px] font-medium text-brand-700 hover:underline">
            Open the calendar event
          </Link>
        )}
        {meeting.notesId && (
          <Link href={`/docs/${meeting.notesId}`} target="_blank" className="flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <FileText size={14} /> Meeting notes
          </Link>
        )}
      </div>
    </div>
  );
}

// ── After ───────────────────────────────────────────────────────────────────

function AfterCall({ call, meeting }: { call: MeetingCall; meeting: MeetingDetail }) {
  const phase = useStore(call.store, (s) => s.phase);
  const startedAt = useMemo(() => Date.now(), []);
  const text = phase === 'ended' ? 'The meeting has ended' : phase === 'removed' ? "You've been removed from the meeting" : 'You left the meeting';
  return (
    <Centered>
      <div className="text-center" data-testid="after-call">
        <h2 className="text-[24px] font-semibold text-ink">{text}</h2>
        {meeting.startedAt && phase !== 'removed' && <p className="mt-2 text-[13px] text-muted">Started {timeFmt.format(new Date(meeting.startedAt))} · {formatDuration(startedAt - Date.parse(meeting.startedAt))}</p>}
        <div className="mt-6 flex justify-center gap-3">
          {phase !== 'removed' && (
            <Button
              onClick={() => {
                // A fresh call object (new peer id) via a reload of the room.
                window.location.assign(meetingPath(meeting.code));
              }}
              data-testid="rejoin"
            >
              Rejoin
            </Button>
          )}
          <Link href="/meetings" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-[13px] font-medium text-white hover:bg-brand-700">
            <ArrowLeft size={15} /> Return to Meetings
          </Link>
        </div>
        {meeting.notesId && (
          <Link href={`/docs/${meeting.notesId}`} className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <FileText size={14} /> Open meeting notes
          </Link>
        )}
      </div>
    </Centered>
  );
}
