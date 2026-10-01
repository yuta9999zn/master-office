import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/client';
import { auditEvents, outbox } from '../db/schema';
import type { Actor } from '../common/current-user';

/**
 * Writes the audit trail and the transactional outbox in the caller's transaction
 * (docs/ARCHITECTURE.md §13). A publisher relays `outbox` to Redis Streams in Phase 6.
 */
@Injectable()
export class EventsService {
  async emit(
    tx: Tx,
    actor: Actor,
    action: string,
    target: { resourceId?: string | null; spaceId?: string | null },
    data: Record<string, unknown> = {},
  ) {
    await tx.insert(auditEvents).values({
      workspaceId: actor.workspaceId,
      actorId: actor.id,
      action,
      resourceId: target.resourceId ?? null,
      spaceId: target.spaceId ?? null,
      data,
    });
    await tx.insert(outbox).values({
      topic: action,
      payload: { workspaceId: actor.workspaceId, actorId: actor.id, ...target, ...data },
    });
  }
}
