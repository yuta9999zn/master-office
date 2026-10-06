'use client';

import { Hash, MessageCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useConversation, useConversations } from '@/lib/chat';
import { useSpaces } from '@/lib/queries';
import { useMounted } from '@/lib/use-mounted';
import { Button, EmptyState } from '../ui/primitives';
import { ChatSidebar, type NewKind, type Place, SpaceRail } from './ConversationList';
import { ConversationView } from './ConversationView';
import { NewCategoryDialog, NewChannelDialog, NewMessageDialog } from './NewChatDialogs';

/**
 * /chat (direct messages), /chat?space=… (a space's channels) and /chat/:id — the Discord layout of §68:
 * space rail · channels or DMs · conversation · side panel.
 */
export function ChatApp({ id }: { id?: string }) {
  const [dialog, setDialog] = useState<NewKind | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const { data: list } = useConversations();
  const { data: spaces } = useSpaces();
  const inList = list?.find((c) => c.id === id);
  const { data: detail } = useConversation(id && !inList ? id : null);
  const conv = inList ?? detail;
  const place: Place = id ? (conv ? conv.spaceId ?? 'home' : params.get('space') ?? 'home') : params.get('space') ?? 'home';
  const space = place === 'home' ? null : spaces?.find((s) => s.id === place);

  // Opening a space without a channel picks its first one, as Discord does.
  useEffect(() => {
    if (id || place === 'home' || !list) return;
    const first = list.filter((c) => c.kind === 'channel' && c.spaceId === place).sort((a, b) => a.position - b.position)[0];
    if (first) router.replace(`/chat/${first.id}`);
  }, [id, place, list, router]);

  const mounted = useMounted();
  if (!mounted) return <div className="h-full bg-canvas" />;
  return (
    <div className="flex h-full">
      <SpaceRail place={place} />
      <ChatSidebar place={place} activeId={id} onNew={setDialog} />
      {id ? (
        <ConversationView key={id} id={id} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-canvas">
          {place === 'home' ? (
            <EmptyState
              icon={<MessageCircle size={40} />}
              title="Your direct messages"
              action={
                <Button variant="primary" onClick={() => setDialog('dm')}>
                  Start a new chat
                </Button>
              }
            >
              Message a colleague or start a group of up to 10. Team conversations live in each space’s channels (left rail).
            </EmptyState>
          ) : (
            <EmptyState icon={<Hash size={40} />} title={space?.name ?? 'Space'}>
              Pick a channel on the left.
            </EmptyState>
          )}
        </div>
      )}
      <NewMessageDialog open={dialog === 'dm'} onOpenChange={(v) => setDialog(v ? 'dm' : null)} />
      {space && <NewChannelDialog open={dialog === 'channel'} onOpenChange={(v) => setDialog(v ? 'channel' : null)} spaceId={space.id} spaceName={space.name} />}
      {space && <NewCategoryDialog open={dialog === 'category'} onOpenChange={(v) => setDialog(v ? 'category' : null)} spaceId={space.id} />}
    </div>
  );
}
