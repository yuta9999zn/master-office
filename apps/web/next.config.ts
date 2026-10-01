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
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:4000'}/:path*` }];
  },
};

export default nextConfig;
