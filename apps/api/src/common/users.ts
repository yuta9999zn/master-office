import type { UserSummary } from '@workos/shared';
import { inArray } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { users } from '../db/schema';

export const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  avatarColor: users.avatarColor,
  title: users.title,
  department: users.department,
};

export async function loadUsers(db: Tx, ids: (string | null | undefined)[]): Promise<Map<string, UserSummary>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await db.select(userColumns).from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r]));
}
