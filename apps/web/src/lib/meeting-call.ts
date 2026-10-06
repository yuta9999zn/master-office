'use client';

import type { IceServer, MeetingEvent, MeetingJoinResult, MeetingMessage, MeetingPeer, MeetingRecordingInfo, RealtimeEvent, UserSummary } from '@workos/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { api, ApiError, uploadFile } from './api';
import { sendRealtime } from './realtime';

export interface RemoteView {
  info: MeetingPeer;
  /** Camera + microphone, and the shared screen while there is one (told apart by info.screen). */
  streams: MediaStream[];
  connection: RTCPeerConnectionState;
}

export type CallPhase = 'idle' | 'joining' | 'waiting' | 'denied' | 'in' | 'left' | 'ended' | 'removed' | 'error';

export interface CallState {
  phase: CallPhase;
  error: string | null;
  peers: Record<string, RemoteView>;
  /** Microphone track (+ camera track while the camera is on). */
  local: MediaStream | null;
  screen: MediaStream | null;
  mic: boolean;
  cam: boolean;
  hand: boolean;
  /** No camera / microphone available (or permission refused). */
  noCam: boolean;
  noMic: boolean;
  micId: string | null;
  camId: string | null;
  /** peerId (or 'me') of whoever is talking loudest right now. */
  speaking: string | null;
  recording: MeetingRecordingInfo | null;
  /** True while this browser itself records. */
  recordingHere: boolean;
  reactions: { id: number; peerId: string; emoji: string; name: string }[];
  messages: MeetingMessage[];
  unread: number;
  lobby: UserSummary[];
  /** Someone asked us to mute: who. */
  mutedBy: string | null;
}

const initial = (): CallState => ({
  phase: 'idle',
  error: null,
  peers: {},
  local: null,
  screen: null,
  mic: true,
  cam: true,
  hand: false,
  noCam: false,
  noMic: false,
  micId: null,
  camId: null,
  speaking: null,
  recording: null,
  recordingHere: false,
  reactions: [],
  messages: [],
  unread: 0,
  lobby: [],
  mutedBy: null,
});

interface Remote {
  info: MeetingPeer;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Our tracks are on this connection. */
  attached: boolean;
  senders: Map<string, RTCRtpSender>;
}

const newPeerId = () => `p${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
let reactionSeq = 0;

/**
 * One browser's side of a meeting (docs/ARCHITECTURE.md §73): local camera / microphone, one RTCPeerConnection per
 * other browser in the room (mesh), signalling over the shared realtime socket with the "perfect negotiation"
 * pattern (the politer side yields when both offer at once), screen sharing as an extra track, the loudest-speaker
 * meter and the recorder. React reads its state through `store`.
 */
export class MeetingCall {
  readonly store: StoreApi<CallState> = createStore<CallState>(initial);
  readonly peerId = newPeerId();
  meetingId: string | null = null;
  private remotes = new Map<string, Remote>();
  private iceServers: IceServer[] = [];
  private aliveTimer?: ReturnType<typeof setInterval>;
  private meterTimer?: ReturnType<typeof setInterval>;
  private audio?: AudioContext;
  private analysers = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; stream: MediaStream }>();
  private recorder?: Recorder;
  private disposed = false;

  constructor(
    readonly code: string,
    private readonly me: UserSummary,
  ) {}

  private set(p: Partial<CallState> | ((s: CallState) => Partial<CallState>)) {
    if (!this.disposed) this.store.setState(p);
  }
  get state() {
    return this.store.getState();
  }

  // ── Local media ───────────────────────────────────────────────────────────

  /** Opens microphone and camera for the preview (each may be missing or refused). */
  async preview(want: { mic: boolean; cam: boolean }) {
    const local = new MediaStream();
    let noMic = false;
    let noCam = false;
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: this.state.micId ? { deviceId: { exact: this.state.micId } } : true });
      for (const t of a.getAudioTracks()) {
        t.enabled = want.mic;
        local.addTrack(t);
      }
    } catch {
      noMic = true;
    }
    if (want.cam) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints() });
        for (const t of v.getVideoTracks()) local.addTrack(t);
      } catch {
        noCam = true;
      }
    }
    this.state.local?.getTracks().forEach((t) => t.stop());
    this.set({ local, noMic, noCam, mic: want.mic && !noMic, cam: want.cam && !noCam });
  }

  private camConstraints(): MediaTrackConstraints {
    return { width: { ideal: 1280 }, height: { ideal: 720 }, ...(this.state.camId ? { deviceId: { exact: this.state.camId } } : {}) };
  }

  setMic(on: boolean) {
    const t = this.state.local?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = on;
    this.set({ mic: on, mutedBy: null });
    this.sendState({ mic: on });
  }

  /** Camera off stops the device (its light goes out); on opens it again and sends it to everyone. */
  async setCam(on: boolean) {
    const local = this.state.local ?? new MediaStream();
    if (!on) {
      for (const t of local.getVideoTracks()) {
        t.stop();
        local.removeTrack(t);
      }
      for (const r of this.remotes.values()) void r.senders.get('video')?.replaceTrack(null);
      this.set({ cam: false, local: new MediaStream(local.getTracks()) });
      this.sendState({ cam: false });
      return;
    }
    let track: MediaStreamTrack;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: this.camConstraints() })).getVideoTracks()[0];
    } catch {
      this.set({ noCam: true, cam: false });
      return;
    }
    local.addTrack(track);
    const next = new MediaStream(local.getTracks());
    this.set({ cam: true, noCam: false, local: next });
    for (const r of this.remotes.values()) this.sendTrack(r, 'video', track, next);
    this.sendState({ cam: true });
  }

  async useDevice(kind: 'mic' | 'cam', deviceId: string) {
    if (kind === 'cam') {
      this.set({ camId: deviceId });
      if (this.state.cam) {
        await this.setCam(false);
        await this.setCam(true);
      }
      return;
    }
    this.set({ micId: deviceId });
    let track: MediaStreamTrack;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })).getAudioTracks()[0];
    } catch {
      return;
    }
    track.enabled = this.state.mic;
    const local = this.state.local ?? new MediaStream();
    for (const t of local.getAudioTracks()) {
      t.stop();
      local.removeTrack(t);
    }
    local.addTrack(track);
    const next = new MediaStream(local.getTracks());
    this.set({ local: next });
    for (const r of this.remotes.values()) this.sendTrack(r, 'audio', track, next);
    this.watchLevel('me', next);
  }

  /** Puts a track on a connection: into the sender of that kind when there is one, else as a new track (renegotiates). */
  private sendTrack(r: Remote, kind: 'audio' | 'video' | 'screen', track: MediaStreamTrack, stream: MediaStream) {
    const sender = r.senders.get(kind);
    if (sender) void sender.replaceTrack(track);
    else if (r.attached) r.senders.set(kind, r.pc.addTrack(track, stream));
  }

  // ── Joining ───────────────────────────────────────────────────────────────

  async join(meetingId: string) {
    this.meetingId = meetingId;
    this.set({ phase: 'joining', error: null });
    let res: MeetingJoinResult;
    try {
      res = await api<MeetingJoinResult>(`/meetings/${this.code}/join`, { method: 'POST', json: { peerId: this.peerId, mic: this.state.mic, cam: this.state.cam } });
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof ApiError ? e.message : 'Could not join' });
      return;
    }
    if (res.state === 'waiting') {
      this.set({ phase: 'waiting' });
      return;
    }
    this.iceServers = res.iceServers;
    this.set({ phase: 'in', recording: res.recording });
    this.startTimers();
    if (this.state.local) this.watchLevel('me', this.state.local);
    // The newcomer calls everyone already in the room.
    for (const p of res.peers) this.attach(this.remote(p));
    void api<MeetingMessage[]>(`/meetings/${this.code}/messages`).then((messages) => this.set({ messages }), () => undefined);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private onPageHide = () => {
    navigator.sendBeacon(`/api/meetings/${this.code}/leave`, new Blob([JSON.stringify({ peerId: this.peerId })], { type: 'application/json' }));
  };

  /** Cancels waiting in the lobby. */
  async cancelKnock() {
    await api(`/meetings/${this.code}/leave`, { method: 'POST', json: {} }).catch(() => undefined);
    this.set({ phase: 'idle' });
  }

  async leave(phase: CallPhase = 'left') {
    if (this.state.recordingHere) await this.stopRecording();
    const wasIn = this.state.phase === 'in';
    this.teardown();
    this.set({ phase });
    if (wasIn && phase === 'left') await api(`/meetings/${this.code}/leave`, { method: 'POST', json: { peerId: this.peerId } }).catch(() => undefined);
  }

  /** Closes connections and devices; the call object stays readable (ended / left screens). */
  private teardown() {
    window.removeEventListener('pagehide', this.onPageHide);
    clearInterval(this.aliveTimer);
    clearInterval(this.meterTimer);
    for (const r of this.remotes.values()) r.pc.close();
    this.remotes.clear();
    this.state.local?.getTracks().forEach((t) => t.stop());
    this.state.screen?.getTracks().forEach((t) => t.stop());
    for (const a of this.analysers.values()) a.source.disconnect();
    this.analysers.clear();
    void this.audio?.close().catch(() => undefined);
    this.audio = undefined;
    this.set({ peers: {}, local: null, screen: null, speaking: null, hand: false });
  }

  dispose() {
    if (this.state.phase === 'in') void this.leave();
    else if (this.state.phase === 'waiting') void this.cancelKnock();
    else this.teardown();
    this.disposed = true;
  }

  private startTimers() {
    clearInterval(this.aliveTimer);
    this.aliveTimer = setInterval(async () => {
      if (this.state.phase !== 'in') return;
      const { ok } = await api<{ ok: boolean }>(`/meetings/${this.code}/alive`, { method: 'POST', json: { peerId: this.peerId } }).catch(() => ({ ok: true }));
      // The room dropped us (the connection was gone too long): come back in.
      if (!ok && this.state.phase === 'in') await this.rejoin();
    }, 10_000);
    clearInterval(this.meterTimer);
    this.meterTimer = setInterval(() => this.meter(), 250);
  }

  private async rejoin() {
    for (const r of this.remotes.values()) r.pc.close();
    this.remotes.clear();
    this.set({ peers: {} });
    const res = await api<MeetingJoinResult>(`/meetings/${this.code}/join`, { method: 'POST', json: { peerId: this.peerId, mic: this.state.mic, cam: this.state.cam } }).catch(() => null);
    if (!res || res.state !== 'joined') return void this.leave('removed');
    for (const p of res.peers) this.attach(this.remote(p));
    this.sendState({ hand: this.state.hand, screen: this.state.screen?.id ?? null });
  }

  // ── Connections ───────────────────────────────────────────────────────────

  private remote(info: MeetingPeer): Remote {
    const known = this.remotes.get(info.peerId);
    if (known) {
      // A signal can arrive before the "joined" event that names its sender.
      if (info.user.id && !known.info.user.id) {
        known.info = info;
        this.patchPeer(info.peerId, () => ({ info }));
      }
      return known;
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const r: Remote = { info, pc, polite: this.peerId > info.peerId, makingOffer: false, ignoreOffer: false, attached: false, senders: new Map() };
    this.remotes.set(info.peerId, r);
    this.set((s) => ({ peers: { ...s.peers, [info.peerId]: { info, streams: [], connection: 'new' } } }));
    pc.onicecandidate = ({ candidate }) => candidate && this.signal(info.peerId, { candidate: candidate.toJSON() });
    pc.onnegotiationneeded = async () => {
      try {
        r.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(info.peerId, { description: pc.localDescription?.toJSON() });
      } catch {
        /* superseded by the other side's offer */
      } finally {
        r.makingOffer = false;
      }
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const drop = () => {
        if (stream.getTracks().some((t) => t.readyState === 'live')) return this.patchPeer(info.peerId, (v) => ({ streams: [...v.streams] }));
        this.patchPeer(info.peerId, (v) => ({ streams: v.streams.filter((s) => s !== stream) }));
      };
      stream.onremovetrack = drop;
      track.onended = drop;
      track.onunmute = () => this.patchPeer(info.peerId, (v) => ({ streams: [...v.streams] }));
      this.patchPeer(info.peerId, (v) => ({ streams: v.streams.includes(stream) ? [...v.streams] : [...v.streams, stream] }));
      if (track.kind === 'audio') this.watchLevel(info.peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      this.patchPeer(info.peerId, () => ({ connection: pc.connectionState }));
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return r;
  }

  /** Adds our microphone, camera and screen to a connection. */
  private attach(r: Remote) {
    if (r.attached) return;
    r.attached = true;
    const local = this.state.local;
    const a = local?.getAudioTracks()[0];
    const v = local?.getVideoTracks()[0];
    if (a && local) r.senders.set('audio', r.pc.addTrack(a, local));
    if (v && local) r.senders.set('video', r.pc.addTrack(v, local));
    const s = this.state.screen;
    if (s?.getVideoTracks()[0]) r.senders.set('screen', r.pc.addTrack(s.getVideoTracks()[0], s));
  }

  private patchPeer(peerId: string, fn: (v: RemoteView) => Partial<RemoteView>) {
    this.set((s) => {
      const v = s.peers[peerId];
      return v ? { peers: { ...s.peers, [peerId]: { ...v, ...fn(v) } } } : {};
    });
  }

  private dropRemote(peerId: string) {
    const r = this.remotes.get(peerId);
    r?.pc.close();
    this.remotes.delete(peerId);
    const a = this.analysers.get(peerId);
    a?.source.disconnect();
    this.analysers.delete(peerId);
    this.set((s) => {
      const peers = { ...s.peers };
      delete peers[peerId];
      return { peers };
    });
  }

  private signal(to: string, data: unknown) {
    sendRealtime({ type: 'meeting.signal', meetingId: this.meetingId, peerId: this.peerId, to, data });
  }

  private sendState(patch: Record<string, unknown>) {
    if (this.state.phase === 'in') sendRealtime({ type: 'meeting.state', meetingId: this.meetingId, peerId: this.peerId, ...patch });
  }

  private async onSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const known = this.state.peers[from]?.info;
    const r = this.remote(known ?? { peerId: from, user: { id: '', name: 'Someone', email: '', avatarColor: '#94a3b8' } as UserSummary, role: 'guest', mic: true, cam: true, screen: null, hand: false, joinedAt: new Date().toISOString() });
    const pc = r.pc;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (r.makingOffer || pc.signalingState !== 'stable');
        r.ignoreOffer = !r.polite && collision;
        if (r.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          // Answering someone new: our tracks ride on the transceivers their offer made.
          this.attach(r);
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription?.toJSON() });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!r.ignoreOffer) throw e;
        }
      }
    } catch {
      /* a broken negotiation is retried by the next offer / ICE restart */
    }
  }

  /** Events from the realtime socket. */
  handle(e: RealtimeEvent) {
    if (!e.type.startsWith('meeting.') || !this.meetingId || (e as MeetingEvent & { meetingId: string }).meetingId !== this.meetingId) return;
    const ev = e as MeetingEvent;
    switch (ev.type) {
      case 'meeting.signal':
        if (ev.to === this.peerId && this.state.phase === 'in') void this.onSignal(ev.from, ev.data as never);
        break;
      case 'meeting.peer.joined':
        // They will call us; get ready (our tracks go on when their offer arrives).
        if (ev.peer.peerId !== this.peerId && this.state.phase === 'in') this.remote(ev.peer);
        break;
      case 'meeting.peer.updated':
        if (this.remotes.has(ev.peer.peerId)) {
          this.remotes.get(ev.peer.peerId)!.info = ev.peer;
          this.patchPeer(ev.peer.peerId, () => ({ info: ev.peer }));
        }
        break;
      case 'meeting.peer.left':
        if (ev.peerId === this.peerId) {
          if (this.state.phase === 'in') void this.rejoin();
        } else this.dropRemote(ev.peerId);
        break;
      case 'meeting.lobby':
        this.set({ lobby: ev.lobby });
        break;
      case 'meeting.admitted':
        if (this.state.phase === 'waiting') void this.join(this.meetingId);
        break;
      case 'meeting.denied':
        if (this.state.phase === 'waiting') this.set({ phase: 'denied' });
        break;
      case 'meeting.removed':
        void this.leave('removed');
        break;
      case 'meeting.ended':
        if (this.state.phase === 'in' || this.state.phase === 'waiting') void this.leave('ended');
        break;
      case 'meeting.mute':
        if (ev.peerId === this.peerId) {
          this.setMic(false);
          this.set({ mutedBy: ev.by });
        }
        break;
      case 'meeting.message':
        this.set((s) => (s.messages.some((m) => m.id === ev.message.id) ? {} : { messages: [...s.messages, ev.message], unread: s.unread + (ev.message.user?.id === this.me.id ? 0 : 1) }));
        break;
      case 'meeting.reaction': {
        const name = ev.peerId === this.peerId ? 'You' : this.state.peers[ev.peerId]?.info.user.name ?? '';
        const id = ++reactionSeq;
        this.set((s) => ({ reactions: [...s.reactions, { id, peerId: ev.peerId, emoji: ev.emoji, name }] }));
        setTimeout(() => this.set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })), 4000);
        break;
      }
      case 'meeting.recording':
        this.set({ recording: ev.recording });
        break;
    }
  }

  // ── Hand, reactions, chat ────────────────────────────────────────────────

  raiseHand(on: boolean) {
    this.set({ hand: on });
    this.sendState({ hand: on });
  }

  react(emoji: string) {
    sendRealtime({ type: 'meeting.reaction', meetingId: this.meetingId, peerId: this.peerId, emoji });
  }

  async say(body: string) {
    const m = await api<MeetingMessage>(`/meetings/${this.code}/messages`, { method: 'POST', json: { body } });
    this.set((s) => (s.messages.some((x) => x.id === m.id) ? {} : { messages: [...s.messages, m] }));
  }

  readChat() {
    this.set({ unread: 0 });
  }

  // ── Screen sharing ────────────────────────────────────────────────────────

  async shareScreen() {
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } catch {
      return false;
    }
    const track = screen.getVideoTracks()[0];
    track.onended = () => void this.stopScreen();
    this.set({ screen });
    for (const r of this.remotes.values()) this.sendTrack(r, 'screen', track, screen);
    this.sendState({ screen: screen.id });
    return true;
  }

  async stopScreen() {
    const s = this.state.screen;
    if (!s) return;
    s.getTracks().forEach((t) => t.stop());
    for (const r of this.remotes.values()) {
      const sender = r.senders.get('screen');
      if (sender) {
        r.pc.removeTrack(sender);
        r.senders.delete('screen');
      }
    }
    this.set({ screen: null });
    this.sendState({ screen: null });
  }

  // ── Who is talking ────────────────────────────────────────────────────────

  private watchLevel(key: string, stream: MediaStream) {
    if (!stream.getAudioTracks().length) return;
    try {
      this.audio ??= new AudioContext();
      const old = this.analysers.get(key);
      if (old?.stream === stream) return;
      old?.source.disconnect();
      const source = this.audio.createMediaStreamSource(stream);
      const analyser = this.audio.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analysers.set(key, { analyser, source, stream });
    } catch {
      /* no Web Audio: no speaker highlight */
    }
  }

  private meter() {
    let best: string | null = null;
    let top = 0.02;
    const buf = new Float32Array(512);
    for (const [key, { analyser }] of this.analysers) {
      if (key === 'me' && !this.state.mic) continue;
      if (key !== 'me' && this.state.peers[key] && !this.state.peers[key].info.mic) continue;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      if (rms > top) {
        top = rms;
        best = key;
      }
    }
    if (best !== this.state.speaking) this.set({ speaking: best });
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /** Host / co-host: records the room as everyone sees it (tiles + all voices) into a WebM. */
  async startRecording(title: string) {
    const info = await api<MeetingRecordingInfo>(`/meetings/${this.code}/recording`, { method: 'POST', json: { on: true } });
    this.recorder = new Recorder(this, title);
    this.recorder.start();
    this.set({ recordingHere: true, recording: info });
  }

  async stopRecording(): Promise<{ id: string; name: string } | null> {
    const rec = this.recorder;
    this.recorder = undefined;
    this.set({ recordingHere: false });
    await api(`/meetings/${this.code}/recording`, { method: 'POST', json: { on: false } }).catch(() => undefined);
    if (!rec) return null;
    const { blob, durationMs, name } = await rec.stop();
    if (!blob.size) return null;
    const fd = new FormData();
    fd.append('file', new File([blob], name, { type: blob.type || 'video/webm' }));
    fd.append('durationMs', String(durationMs));
    return uploadFile<{ id: string; name: string }>(`/meetings/${this.code}/recordings`, fd);
  }

  /** Every audio stream in the room (for the recorder's mix). */
  audioStreams() {
    const out: MediaStream[] = [];
    if (this.state.local?.getAudioTracks().length) out.push(this.state.local);
    for (const v of Object.values(this.state.peers)) for (const s of v.streams) if (s.getAudioTracks().length) out.push(s);
    return out;
  }
}

/** Draws the tiles on a canvas 15 times a second and mixes every voice; MediaRecorder turns that into WebM. */
class Recorder {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private audio = new AudioContext();
  private dest = this.audio.createMediaStreamDestination();
  private mixed = new Set<MediaStream>();
  private chunks: Blob[] = [];
  private media?: MediaRecorder;
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = 0;

  constructor(
    private readonly call: MeetingCall,
    private readonly title: string,
  ) {
    this.canvas.width = 1280;
    this.canvas.height = 720;
  }

  start() {
    const stream = new MediaStream([...this.canvas.captureStream(15).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.media = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.media.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.draw();
    this.media.start(1000);
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.draw(), 66);
  }

  private draw() {
    for (const s of this.call.audioStreams())
      if (!this.mixed.has(s)) {
        this.mixed.add(s);
        try {
          this.audio.createMediaStreamSource(s).connect(this.dest);
        } catch {
          /* ended stream */
        }
      }
    const { ctx, canvas } = this;
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The room as laid out on screen: the shared screen big when there is one, else the grid of tiles.
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-meeting-tile]')];
    const stage = document.querySelector<HTMLVideoElement>('[data-meeting-stage] video');
    if (stage && stage.videoWidth) {
      this.fit(stage, 0, 0, canvas.width, canvas.height);
      return;
    }
    const n = Math.max(1, tiles.length);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = canvas.width / cols;
    const h = canvas.height / rows;
    tiles.forEach((tile, i) => {
      const x = (i % cols) * w;
      const y = Math.floor(i / cols) * h;
      const video = tile.querySelector('video');
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      if (video && video.videoWidth) this.fit(video, x + 4, y + 4, w - 8, h - 8);
      else {
        ctx.fillStyle = tile.dataset.color ?? '#2563eb';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${Math.round(Math.min(w, h) / 7)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((tile.dataset.name ?? '?').slice(0, 1).toUpperCase(), x + w / 2, y + h / 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.font = '500 18px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const label = tile.dataset.name ?? '';
      ctx.fillRect(x + 12, y + h - 40, ctx.measureText(label).width + 16, 28);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 20, y + h - 20);
    });
  }

  /** Draws a video inside a box, keeping its shape (letterboxed). */
  private fit(v: HTMLVideoElement, x: number, y: number, w: number, h: number) {
    const s = Math.min(w / v.videoWidth, h / v.videoHeight);
    const dw = v.videoWidth * s;
    const dh = v.videoHeight * s;
    this.ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  async stop(): Promise<{ blob: Blob; durationMs: number; name: string }> {
    clearInterval(this.timer);
    const durationMs = Date.now() - this.startedAt;
    const media = this.media;
    if (media && media.state !== 'inactive') await new Promise<void>((res) => ((media.onstop = () => res()), media.stop()));
    void this.audio.close().catch(() => undefined);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    const safe = this.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Meeting';
    return { blob: new Blob(this.chunks, { type: media?.mimeType.split(';')[0] || 'video/webm' }), durationMs, name: `${safe} — ${stamp}.webm` };
  }
}
