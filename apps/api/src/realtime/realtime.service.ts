import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { RealtimeEvent } from '@workos/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { Actor } from '../common/current-user';
import { config } from '../config';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (body: string) => createHmac('sha256', config.collab.secret).update(`rt:${body}`).digest();
const TOKEN_TTL = 60;

/** A message from a client socket (typing indicators); the chat module validates it. */
export type ClientMessage = { type: string; [k: string]: unknown };
type ClientHandler = (actor: Actor, msg: ClientMessage) => void | Promise<void>;

/**
 * Per-user event channel (docs/ARCHITECTURE.md §64): one WebSocket per open tab at ws://<api>/realtime?token=…,
 * shared by every app (chat now, notifications next). Single process for now — the Redis fan-out of §1 slots in
 * behind publish() when the API runs as several instances.
 */
@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Realtime');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly workspaceOf = new Map<string, string>();
  private readonly handlers: ClientHandler[] = [];
  private heartbeat?: NodeJS.Timeout;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap() {
    const server = this.adapterHost.httpAdapter.getHttpServer() as import('node:http').Server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/realtime') return;
      const actor = this.verify(url.searchParams.get('token') ?? '');
      if (!actor) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, actor));
    });
    // Drops sockets that stopped answering pings (sleeping laptops, killed tabs).
    this.heartbeat = setInterval(() => {
      for (const set of this.sockets.values())
        for (const ws of set) {
          const w = ws as WebSocket & { alive?: boolean };
          if (w.alive === false) w.terminate();
          else {
            w.alive = false;
            w.ping();
          }
        }
    }, 30_000);
  }

  onApplicationShutdown() {
    clearInterval(this.heartbeat);
    for (const set of this.sockets.values()) for (const ws of set) ws.terminate();
    this.wss.close();
  }

  /** Short-lived ticket for opening the socket (the socket itself stays open afterwards). */
  token(actor: Actor): string {
    const body = b64(JSON.stringify({ uid: actor.id, name: actor.name, ws: actor.workspaceId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }));
    return `${body}.${b64(sign(body))}`;
  }

  private verify(token: string): Actor | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = sign(body);
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as { uid: string; name: string; ws: string; exp: number };
    return t.exp > Date.now() / 1000 ? { id: t.uid, name: t.name, workspaceId: t.ws } : null;
  }

  private attach(ws: WebSocket, actor: Actor) {
    const w = ws as WebSocket & { alive?: boolean };
    w.alive = true;
    const set = this.sockets.get(actor.id) ?? new Set();
    const cameOnline = !set.size;
    set.add(ws);
    this.sockets.set(actor.id, set);
    this.workspaceOf.set(actor.id, actor.workspaceId);
    ws.on('pong', () => (w.alive = true));
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type === 'ping') return void ws.send('{"type":"pong"}');
      for (const h of this.handlers) Promise.resolve(h(actor, msg)).catch((e: Error) => this.log.warn(`client message: ${e.message}`));
    });
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) {
        this.sockets.delete(actor.id);
        this.workspaceOf.delete(actor.id);
        this.broadcastPresence(actor.workspaceId);
      }
    });
    ws.send(JSON.stringify({ type: 'presence', online: this.online(actor.workspaceId) } satisfies RealtimeEvent));
    if (cameOnline) this.broadcastPresence(actor.workspaceId);
  }

  private online(workspaceId: string) {
    return [...this.workspaceOf].filter(([, w]) => w === workspaceId).map(([id]) => id);
  }

  private broadcastPresence(workspaceId: string) {
    const online = this.online(workspaceId);
    this.publish(online, { type: 'presence', online });
  }

  onClientMessage(handler: ClientHandler) {
    this.handlers.push(handler);
  }

  isOnline(userId: string) {
    return this.sockets.has(userId);
  }

  /** Sends an event to every open tab of the given users. */
  publish(userIds: Iterable<string>, event: RealtimeEvent, except?: string) {
    const data = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      if (id === except) continue;
      for (const ws of this.sockets.get(id) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}
