'use client';

import { youtubeId } from '@workos/slide-model';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Dialog } from '../ui/primitives';

/** Insert → Video: a YouTube link or a video file (uploaded to the presentation). */
export function VideoDialog({ open, onOpenChange, onLink, onFile }: { open: boolean; onOpenChange: (v: boolean) => void; onLink: (url: string) => void; onFile: (f: File) => void }) {
  const [url, setUrl] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const valid = !!youtubeId(url);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Insert video"
      description="Paste a YouTube link, or upload a video file (MP4, WebM, up to 100 MB)."
      footer={
        <>
          <Button variant="ghost" icon={<Upload size={14} />} onClick={() => file.current?.click()}>
            Upload a file…
          </Button>
          <Button disabled={!valid} onClick={() => (onLink(url.trim()), setUrl(''))} data-testid="insert-video-link">
            Insert
          </Button>
        </>
      }
    >
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && valid && (onLink(url.trim()), setUrl(''))}
        placeholder="https://www.youtube.com/watch?v=…"
        className="input h-9 w-full text-[13px]"
        aria-label="YouTube link"
      />
      {url && !valid && <p className="mt-1.5 text-[12px] text-red-600">That is not a YouTube video link.</p>}
      {valid && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${youtubeId(url)}/mqdefault.jpg`} alt="" className="mt-3 aspect-video w-full rounded-lg object-cover" />
      )}
      <input
        ref={file}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </Dialog>
  );
}
