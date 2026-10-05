'use client';

import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState } from '../ui/primitives';
import { ConversationList, type NewKind } from './ConversationList';
import { ConversationView } from './ConversationView';
import { BrowseChannelsDialog, NewChannelDialog, NewMessageDialog } from './NewChatDialogs';

/** /chat and /chat/:id — conversation list, the open conversation and its side panel (docs/ARCHITECTURE.md §64). */
export function ChatApp({ id }: { id?: string }) {
  const [dialog, setDialog] = useState<NewKind | null>(null);
  return (
    <div className="flex h-full">
      <ConversationList activeId={id} onNew={setDialog} />
      {id ? (
        <ConversationView key={id} id={id} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-canvas">
          <EmptyState
            icon={<MessageCircle size={40} />}
            title="Select a conversation"
            action={
              <Button variant="primary" onClick={() => setDialog('dm')}>
                Start a new chat
              </Button>
            }
          >
            Message a colleague, start a group or join a channel.
          </EmptyState>
        </div>
      )}
      <NewMessageDialog open={dialog === 'dm'} onOpenChange={(v) => setDialog(v ? 'dm' : null)} />
      <NewChannelDialog open={dialog === 'channel'} onOpenChange={(v) => setDialog(v ? 'channel' : null)} />
      <BrowseChannelsDialog open={dialog === 'browse'} onOpenChange={(v) => setDialog(v ? 'browse' : null)} />
    </div>
  );
}
