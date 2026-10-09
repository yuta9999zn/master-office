import type { NextConfig } from 'next';
import path from 'node:path';

const root = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  // @workos/shared is consumed from source via a tsconfig path alias (E: is exFAT, no workspace symlinks).
  turbopack: { root },
  devIndicators: false,
  outputFileTracingRoot: root,
  // Docker image (apps/web/Dockerfile): a self-contained server with only the files it needs.
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' || process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  // Security headers for every page (§85 B). Public forms (/f, /bf) and published pages (/pub) may be embedded elsewhere.
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
    ];
    return [
      { source: '/((?!f/|bf/|pub/).*)', headers: [...base, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      { source: '/(f|bf|pub)/:path*', headers: base },
    ];
  },
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
