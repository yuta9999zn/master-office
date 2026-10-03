import type { NextConfig } from 'next';
import path from 'node:path';

const root = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  // @workos/shared is consumed from source via a tsconfig path alias (E: is exFAT, no workspace symlinks).
  turbopack: { root },
  devIndicators: false,
  outputFileTracingRoot: root,
  // The browser talks to the API through this proxy: same origin, so the dev identity cookie and file downloads just work.
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${api}/:path*` },
      // Published pages (File → Publish to web) live at /pub/<token>.
      { source: '/pub/:token', destination: `${api}/pub/:token` },
    ];
  },
};

export default nextConfig;
