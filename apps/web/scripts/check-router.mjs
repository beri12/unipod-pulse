/**
 * Refuses to start the dev server when a Pages Router directory is present.
 *
 * This app is App Router only. A stray `pages/` folder — left over from an
 * experiment, or created by a tool — makes Next enable the Pages Router
 * alongside it, and the failure that follows names neither the folder nor the
 * cause:
 *
 *   Cannot find module for page: route not found /page
 *   ENOENT ... .next/dev/server/pages/_app/build-manifest.json
 *
 * `/page` is what Next calls a file named `page.tsx` sitting in a Pages Router
 * directory, and `_app` is a Pages Router entry point this app has no reason to
 * have. Because such a folder is untracked, `git pull` will not remove it and
 * clearing `.next` does not help, so it survives every obvious remedy. One
 * existence check turns half an hour of confusion into a sentence.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const strays = ['pages', join('src', 'pages')].filter((candidate) =>
  existsSync(join(APP_DIR, candidate)),
);

if (strays.length > 0) {
  const paths = strays.map((stray) => `  apps/web/${stray.replace(/\\/g, '/')}`).join('\n');
  console.error(
    [
      '',
      'This app uses the App Router only, but a Pages Router directory exists:',
      '',
      paths,
      '',
      'Next will enable the Pages Router because of it, then fail with a message',
      'that mentions neither the folder nor the reason:',
      '',
      '  Cannot find module for page: route not found /page',
      '  ENOENT ... .next/dev/server/pages/_app/build-manifest.json',
      '',
      'Delete the folder and start again. Nothing in this repository needs it —',
      'every route lives in apps/web/src/app.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
