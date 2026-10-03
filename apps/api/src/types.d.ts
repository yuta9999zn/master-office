// `@tiptap/html/server` (happy-dom based) is exposed through package "exports", which Node resolves at runtime
// but classic `moduleResolution: node` cannot see. It has the same API as the browser entry.
declare module '@tiptap/html/server' {
  export { generateHTML, generateJSON } from '@tiptap/html';
}

// nspell ships no types.
declare module 'nspell' {
  const nspell: (dict: { aff: Buffer | string; dic: Buffer | string }) => { correct(word: string): boolean; suggest(word: string): string[]; add(word: string): void };
  export default nspell;
}
