// `@tiptap/html/server` (happy-dom based) is exposed through package "exports", which Node resolves at runtime
// but classic `moduleResolution: node` cannot see. It has the same API as the browser entry.
declare module '@tiptap/html/server' {
  export { generateHTML, generateJSON } from '@tiptap/html';
}
