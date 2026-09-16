import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The monorepo keeps a single .env at its root. Next only looks inside the app
// directory, so the root file is loaded here before the config is evaluated.
// Values already in the environment (a real deployment) always win.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), override: false });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The design-system package ships TypeScript source so it can share the app's
  // build settings and Tailwind scanning.
  transpilePackages: ['@unipods/ui'],
  typescript: { ignoreBuildErrors: false },
  // Only NEXT_PUBLIC_* values reach the browser; no provider credential or
  // server secret is ever bundled.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
