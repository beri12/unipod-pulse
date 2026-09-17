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
  // Next 16 writes AGENTS.md and CLAUDE.md into the app directory on every dev
  // start. This repository documents itself in README.md and docs/, so the
  // generated pair is untracked noise that shows up in `git status` after
  // simply running the app.
  agentRules: false,
  // Next 16 blocks dev-only resources (the HMR socket among them) from any
  // host it does not recognise. The dev server answers on localhost, so
  // opening the app as 127.0.0.1 — or over the LAN to try it from a phone —
  // silently loses hot reload and, with it, hydration: the page renders but
  // nothing on it responds. Naming the hosts here is dev-only and changes
  // nothing about production.
  allowedDevOrigins: ['localhost', '127.0.0.1', '0.0.0.0', '*.local'],
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
