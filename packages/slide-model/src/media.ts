// Video / audio helpers (docs/ARCHITECTURE.md §32).

export interface MediaOptions {
  start?: number; // seconds
  end?: number;
  autoplay?: boolean; // when the slide appears in the slide show
  muted?: boolean;
  loop?: boolean;
}

/** YouTube video id of a watch / share / embed / shorts link, else null. */
export function youtubeId(url: string | null | undefined): string | null {
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url ?? '');
  return m ? m[1] : null;
}
