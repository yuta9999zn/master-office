import type { ReactNode } from 'react';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { IncomingCall } from '@/components/meetings/IncomingCall';
import { RealtimeBridge } from '@/lib/realtime';
import { AuthGate } from '@/components/shell/AuthGate';
import { AiPanel } from '@/components/ai/AiPanel';

/** Rendered once — the sidebar and top bar persist while switching apps (docs/ARCHITECTURE.md §3.1). */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
        <AiPanel />
      </div>
      <CommandPalette />
      <RealtimeBridge />
      <IncomingCall />
      <AuthGate />
    </div>
  );
}
