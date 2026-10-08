import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Master Office', template: '%s · Master Office' },
  description: 'Work together, go further.',
  icons: { icon: '/icon.svg' },
};

/**
 * Chrome's "Translate this page" (used a lot here: the UI is English, people read Vietnamese / Japanese) wraps text
 * nodes in <font> elements behind React's back; React then calls insertBefore / removeChild with a node that is no
 * longer a direct child and the whole page crashes ("Failed to execute 'insertBefore' on 'Node'"). This runs before
 * React: such calls are redirected to the wrapper that now holds the node, or ignored when the node is already gone.
 */
const TRANSLATE_GUARD = `(function(){if(typeof Node!=='function'||!Node.prototype||Node.prototype.__moGuard)return;Node.prototype.__moGuard=true;
var up=function(parent,node){while(node&&node.parentNode!==parent)node=node.parentNode;return node};
var rm=Node.prototype.removeChild;Node.prototype.removeChild=function(child){if(child&&child.parentNode!==this){var w=up(this,child);if(w)return rm.call(this,w);return child}return rm.apply(this,arguments)};
var ins=Node.prototype.insertBefore;Node.prototype.insertBefore=function(node,ref){if(ref&&ref.parentNode!==this){var w=up(this,ref);return ins.call(this,node,w||null)}return ins.apply(this,arguments)};})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TRANSLATE_GUARD }} />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
