import type { ActivityEvent } from '@workos/shared';

const VERBS: Record<string, string> = {
  'resource.created': 'created',
  'resource.updated': 'updated',
  'resource.renamed': 'renamed',
  'resource.moved': 'moved',
  'resource.trashed': 'moved to trash',
  'resource.restored': 'restored',
  'resource.deleted': 'permanently deleted',
  'acl.changed': 'changed sharing of',
  'space.created': 'created the space',
  'space.member_changed': 'updated members of',
};

/** Splits an audit event into "<verb>" + "<object>" so UIs can link the object. */
export function describe(e: ActivityEvent): { verb: string; object?: string; extra?: string } {
  const d = e.data as Record<string, unknown> & { name?: string; uploaded?: boolean; rename?: { from: string; to: string }; userName?: string; role?: string | null };
  if (e.action === 'resource.created' && d.uploaded) return { verb: 'uploaded', object: d.name };
  if (e.action === 'resource.created' && d.copiedFrom) return { verb: 'made a copy', object: d.name };
  if (e.action === 'resource.renamed' && d.rename) return { verb: 'renamed', object: d.rename.to, extra: `from “${d.rename.from}”` };
  if (e.action === 'acl.changed' && d.userName) {
    return { verb: d.role ? `shared with ${d.userName}` : `removed ${d.userName} from`, object: d.name };
  }
  if (e.action === 'space.member_changed') return { verb: d.role ? `added ${d.userName ?? 'a member'} as ${d.role} to` : `removed ${d.userName ?? 'a member'} from`, object: 'this space' };
  if (e.action === 'space.created') return { verb: 'created the space', object: d.name };
  return { verb: VERBS[e.action] ?? e.action, object: d.name };
}
