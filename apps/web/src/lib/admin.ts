'use client';

import type { Role, UserSummary } from '@workos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';

// Sign-in and the admin console (§79).

export interface SessionInfo {
  needsSetup: boolean;
  signedIn: boolean;
  /** Dev mode: the user switcher works without a password. */
  dev: boolean;
  userId: string | null;
}
export const useSession = () => useQuery({ queryKey: ['auth', 'session'], queryFn: () => api<SessionInfo>('/auth/session'), staleTime: 60_000 });

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';
export const ORG_ROLES: Record<OrgRole, { label: string; note: string }> = {
  owner: { label: 'Owner', note: 'Set the system up; names admins, hands over ownership' },
  admin: { label: 'Admin', note: 'System e-mail, members, invitations, teams, storage' },
  editor: { label: 'Member', note: 'Uses every app, sees public teams' },
  viewer: { label: 'Guest', note: 'Only what is shared with them' },
};

export interface AdminMember {
  user: UserSummary;
  role: Role;
  status: 'active' | 'suspended';
  joinedAt: string;
  lastSeenAt: string | null;
  hasPassword: boolean;
  teams: number;
}
export interface AdminInvitation {
  id: string;
  email: string;
  role: Role;
  teams: { spaceId: string; role: string; title?: string | null }[];
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}
export type SmtpProvider = 'gmail' | 'outlook' | 'custom';
export interface SmtpView {
  provider: SmtpProvider;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  hasPassword: boolean;
  verifiedAt?: string | null;
  updatedAt: string | null;
}

export const useAdminRole = () => useQuery({ queryKey: ['admin', 'me'], queryFn: () => api<{ role: OrgRole | null }>('/admin/me'), staleTime: 60_000 });
export const useAdminMembers = () => useQuery({ queryKey: ['admin', 'members'], queryFn: () => api<AdminMember[]>('/admin/members') });
export const useInvitations = () => useQuery({ queryKey: ['admin', 'invitations'], queryFn: () => api<AdminInvitation[]>('/admin/invitations') });
export const useSmtp = () => useQuery({ queryKey: ['admin', 'smtp'], queryFn: () => api<{ smtp: SmtpView | null }>('/admin/settings/smtp') });
export const useGeneral = () => useQuery({ queryKey: ['admin', 'general'], queryFn: () => api<{ appUrl: string | null }>('/admin/settings/general') });

const onError = (e: Error) => toast.error(e.message);

export type InviteResult = { delivered: boolean; results: { email: string; status: 'sent' | 'member'; link?: string }[] };

export function useAdminActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  return {
    updateMember: useMutation({
      mutationFn: ({ id, ...b }: { id: string; role?: 'admin' | 'editor' | 'viewer'; status?: 'active' | 'suspended' }) => api<AdminMember>(`/admin/members/${id}`, { method: 'PATCH', json: b }),
      onSuccess: refresh,
      onError,
    }),
    passwordLink: useMutation({ mutationFn: (id: string) => api<{ delivered: boolean }>(`/admin/members/${id}/password-link`, { method: 'POST' }), onError }),
    transfer: useMutation({ mutationFn: (userId: string) => api('/admin/owner', { method: 'POST', json: { userId } }), onSuccess: refresh, onError }),
    invite: useMutation({
      mutationFn: (b: { emails: string[]; role: 'admin' | 'editor' | 'viewer'; teams: { spaceId: string; role: 'admin' | 'editor' | 'viewer'; title?: string | null }[]; message?: string | null }) =>
        api<InviteResult>('/admin/invitations', { method: 'POST', json: b }),
      onSuccess: refresh,
      onError,
    }),
    resend: useMutation({ mutationFn: (id: string) => api<{ delivered: boolean; link?: string }>(`/admin/invitations/${id}/resend`, { method: 'POST' }), onSuccess: refresh, onError }),
    revoke: useMutation({ mutationFn: (id: string) => api(`/admin/invitations/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError }),
    saveSmtp: useMutation({
      mutationFn: (b: { provider: SmtpProvider; user: string; password?: string | null; fromName?: string; host?: string; port?: number; secure?: boolean }) =>
        api<{ smtp: SmtpView }>('/admin/settings/smtp', { method: 'PUT', json: b }),
      onSuccess: (r) => qc.setQueryData(['admin', 'smtp'], r),
      onError,
    }),
    clearSmtp: useMutation({ mutationFn: () => api('/admin/settings/smtp', { method: 'DELETE' }), onSuccess: () => qc.setQueryData(['admin', 'smtp'], { smtp: null }), onError }),
    testSmtp: useMutation({ mutationFn: (to: string) => api<{ ok: true; smtp: SmtpView }>('/admin/settings/smtp/test', { method: 'POST', json: { to } }), onSuccess: (r) => qc.setQueryData(['admin', 'smtp'], { smtp: r.smtp }) }),
    saveGeneral: useMutation({ mutationFn: (b: { appUrl: string | null }) => api<{ appUrl: string | null }>('/admin/settings/general', { method: 'PATCH', json: b }), onSuccess: (r) => qc.setQueryData(['admin', 'general'], r), onError }),
  };
}
