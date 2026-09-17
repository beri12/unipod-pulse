/**
 * End-to-end check of the bot endpoints against a running API.
 *
 * Exercises the path a Telegram message actually takes: store the message,
 * confirm a replay stores nothing twice, ask something the messages answer,
 * and ask something they do not — because a bot that answers the last one is
 * worse than no bot at all.
 *
 * Usage:
 *   node scripts/bot-smoke.mjs
 *   API_URL=http://localhost:3001 node scripts/bot-smoke.mjs
 *
 * Reads BOT_INGEST_SECRET from the environment, or from .env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SECRET = process.env.BOT_INGEST_SECRET ?? readEnvFile('BOT_INGEST_SECRET');

// Its own channel, so this never mixes with real community content and can be
// removed again without touching anything else.
const CHANNEL = 'Bot smoke test';
const RUN = Date.now();

const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

function readEnvFile(key) {
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

async function call(path, body, secret = SECRET) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-bot-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const MESSAGES = [
  {
    externalId: `smoke:${RUN}:1`,
    channel: CHANNEL,
    authorName: 'Amina',
    content: 'Reminder: the demo rehearsal moved to Thursday at 14:00 in Lab B.',
    messageDate: new Date().toISOString(),
    isAnnouncement: true,
  },
  {
    externalId: `smoke:${RUN}:2`,
    channel: CHANNEL,
    authorName: 'Bekele',
    content: 'The pitch deck template is on the shared drive under Resources.',
    messageDate: new Date().toISOString(),
  },
];

console.log(`Testing ${API_URL}\n`);

// 0. Is anything listening?
try {
  const health = await fetch(`${API_URL}/api/health`);
  check('API is reachable', health.ok, health.ok ? '' : `health returned ${health.status}`);
  if (!health.ok) process.exit(1);
} catch (error) {
  check('API is reachable', false, `${error.message} — is "pnpm dev" running?`);
  process.exit(1);
}

if (!SECRET) {
  check('BOT_INGEST_SECRET is set', false, 'Not found in the environment or in .env.');
  process.exit(1);
}

// 1. The secret is actually enforced.
const noSecret = await call('/api/ingest/ask', { question: 'anything' }, null);
check('refuses a request with no secret', noSecret.status === 403, `got ${noSecret.status}`);

const wrongSecret = await call('/api/ingest/ask', { question: 'anything' }, 'wrong-secret-abcdefgh');
check(
  'refuses a request with a wrong secret',
  wrongSecret.status === 403,
  `got ${wrongSecret.status}`,
);

// 2. Messages go in.
const first = await call('/api/ingest/message', { messages: MESSAGES });
check(
  'stores captured messages',
  first.status === 201 && first.body?.imported === 2,
  JSON.stringify(first.body),
);

// 3. Replaying the same batch stores nothing twice.
const replay = await call('/api/ingest/message', { messages: MESSAGES });
check(
  'a replayed batch imports nothing twice',
  replay.body?.imported === 0 && replay.body?.skipped === 2,
  JSON.stringify(replay.body),
);

// 4. Indexing is queued, so give the worker a moment to catch up.
process.stdout.write('\n      waiting for the worker to index');
let answered = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  process.stdout.write('.');
  const probe = await call('/api/ingest/ask', {
    question: 'When is the demo rehearsal?',
    channel: CHANNEL,
  });
  if (probe.body?.answered) {
    answered = probe.body;
    break;
  }
}
console.log('\n');

check(
  'answers a question the messages cover',
  answered !== null,
  answered ? '' : 'never became answerable — is the worker running, and is Redis up?',
);

if (answered) {
  check(
    'the answer cites a source',
    answered.sources?.length > 0,
    `sources: ${JSON.stringify(answered.sources)}`,
  );
  check(
    'the answer carries what the message actually said',
    /thursday/i.test(answered.text) && /14:00/.test(answered.text),
    answered.text.split('\n')[0],
  );
  console.log(`\n--- the reply, as the bot would post it ---\n${answered.text}\n`);
}

// 5. The refusal. This is the one that matters most.
const unknown = await call('/api/ingest/ask', {
  question: 'What is the catering budget for the closing dinner?',
  channel: CHANNEL,
});
check(
  'refuses a question nothing answers',
  unknown.body?.answered === false && unknown.body?.sources?.length === 0,
  unknown.body?.text,
);

const failed = results.filter((result) => !result.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.` +
    (failed.length ? ` Failed: ${failed.map((entry) => entry.name).join(', ')}` : ''),
);
console.log(
  `\nRemove the test messages again with:\n` +
    `  psql "<your DATABASE_URL>" -c "delete from messages where channel = '${CHANNEL}';"`,
);

process.exit(failed.length ? 1 : 0);
