/**
 * Development seed.
 *
 * Creates a small, clearly-synthetic community so every feature can be
 * exercised locally: documents, meetings with timestamped transcripts, chat
 * messages, and a set of recorded information gaps.
 *
 * Everything written here is flagged `isDemo: true`. Retrieval keeps demo and
 * real content in separate worlds (see `RagService.demoFilter`), so seeding a
 * database that already holds real content cannot contaminate answers.
 *
 * Run with: pnpm db:seed
 */
import { createAiBundle, contentTokens, parseTranscript } from '@unipods/ai';
import { loadEnv } from '@unipods/config';
import { createPrismaClient, setUnansweredQuestionEmbedding } from '@unipods/database';
import {
  JsonImporter,
  persistMessages,
  processDocument,
  processMeeting,
  processMessages,
  saveTranscript,
  type ObjectStore,
} from '@unipods/ingest';
import { hash } from 'bcryptjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const DEMO_DIR = resolve(__dirname, 'demo');
const DEMO_PASSWORD = 'unipods-demo-2026';

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const ai = createAiBundle(env);

/** Files read straight from `prisma/demo`, so no object store is required. */
const seedFiles = new Map<string, Buffer>();
const seedStore: ObjectStore = {
  async download(key: string): Promise<Buffer> {
    const buffer = seedFiles.get(key);
    if (!buffer) throw new Error(`Seed file not found for key ${key}`);
    return buffer;
  },
};

const deps = {
  prisma,
  embeddings: ai.embeddings,
  llm: ai.llm,
  transcription: ai.transcription,
  storage: seedStore,
  logger: {
    info: (message: string, fields?: Record<string, unknown>) =>
      console.log(`   ${message}`, fields ? JSON.stringify(fields) : ''),
    warn: (message: string) => console.warn(`   ! ${message}`),
    error: (message: string) => console.error(`   x ${message}`),
  },
};

interface DemoDocument {
  file: string;
  title: string;
  description: string;
  publishedAt: string;
}

const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    file: 'hackathon-guidelines.md',
    title: 'Hackathon Guidelines',
    description: 'Dates, team rules, judging criteria and submission requirements.',
    publishedAt: '2026-09-05T09:00:00.000Z',
  },
  {
    file: 'unipods-program-guide.md',
    title: 'UniPods Program Guide',
    description: 'How pods work, membership expectations and available resources.',
    publishedAt: '2026-08-20T09:00:00.000Z',
  },
  {
    file: 'ai-challenge-brief.md',
    title: 'AI Challenge Brief',
    description: 'Requirements and evaluation notes for the AI track.',
    publishedAt: '2026-09-16T08:00:00.000Z',
  },
];

const DEMO_MEETINGS = [
  {
    file: 'hackathon-kickoff.vtt',
    title: 'Hackathon Kickoff',
    description: 'Dates, team rules and an introduction to the AI track.',
    meetingDate: '2026-09-08T15:00:00.000Z',
  },
  {
    file: 'ai-architecture-meeting.vtt',
    title: 'AI Architecture Meeting',
    description: 'How the prototype should answer questions, and who builds what.',
    meetingDate: '2026-09-15T14:00:00.000Z',
  },
];

/**
 * Questions the seeded knowledge base genuinely cannot answer. They are seeded
 * as real gaps rather than decoration: each one fails if you ask it in chat.
 */
const DEMO_GAPS: Array<{ question: string; count: number; daysAgo: number }> = [
  { question: 'What are the final judging criteria weightings for the AI track?', count: 17, daysAgo: 0 },
  { question: 'When will prizes be distributed after demo day?', count: 11, daysAgo: 0 },
  { question: 'How do we get access to the hackathon API sandbox?', count: 8, daysAgo: 1 },
  { question: 'Who is on the judging panel this year?', count: 6, daysAgo: 0 },
  { question: 'Is there a travel stipend for demo day?', count: 5, daysAgo: 2 },
  { question: 'Can a mentor also be a team member?', count: 4, daysAgo: 3 },
  { question: 'What happens if a teammate drops out after the declaration deadline?', count: 3, daysAgo: 1 },
  { question: 'Is there a template for the submission README?', count: 3, daysAgo: 2 },
  { question: 'Do private pod channels get indexed by the assistant?', count: 2, daysAgo: 4 },
  { question: 'What is the maximum size for an uploaded meeting recording?', count: 2, daysAgo: 5 },
];

async function main(): Promise<void> {
  console.log('Seeding UniPods Pulse demo data');
  console.log(`  ai provider : ${env.AI_PROVIDER}`);
  console.log(`  storage     : ${env.STORAGE_DRIVER}`);
  console.log(`  demo mode   : ${env.DEMO_MODE ? 'on' : 'off (demo rows will be hidden from retrieval)'}`);

  await clearDemoData();
  const users = await seedUsers();
  await seedDocuments(users.admin.id);
  await seedMeetings(users.admin.id);
  await seedMessages();
  await seedQuestionAnalytics(users);

  const [documents, meetings, messages, sources, gaps] = await Promise.all([
    prisma.document.count({ where: { isDemo: true } }),
    prisma.meeting.count({ where: { isDemo: true } }),
    prisma.message.count({ where: { isDemo: true } }),
    prisma.source.count(),
    prisma.unansweredQuestion.count(),
  ]);

  console.log('\nSeed complete');
  console.log(`  documents  ${documents}`);
  console.log(`  meetings   ${meetings}`);
  console.log(`  messages   ${messages}`);
  console.log(`  sources    ${sources}`);
  console.log(`  open gaps  ${gaps}`);
  console.log('\nSign in with:');
  console.log(`  admin  admin@unipods.dev   / ${DEMO_PASSWORD}`);
  console.log(`  member ngozi@unipods.dev   / ${DEMO_PASSWORD}`);
  console.log(`  member kelechi@unipods.dev / ${DEMO_PASSWORD}`);
  if (!env.DEMO_MODE) {
    console.log('\nSet DEMO_MODE=true to make this content visible to search and chat.');
  }
}

/** Removes only previously seeded rows; real content is never touched. */
async function clearDemoData(): Promise<void> {
  console.log('\n- clearing previous demo data');
  await prisma.document.deleteMany({ where: { isDemo: true } });
  await prisma.meeting.deleteMany({ where: { isDemo: true } });
  await prisma.message.deleteMany({ where: { isDemo: true } });
  await prisma.user.deleteMany({ where: { isDemo: true } });
  // Question analytics are global rather than per-item, so the seeded set is
  // replaced wholesale.
  await prisma.unansweredQuestion.deleteMany({});
  await prisma.questionLog.deleteMany({});
}

async function seedUsers() {
  console.log('- creating users');
  const passwordHash = await hash(DEMO_PASSWORD, 10);

  /**
   * Never overwrite a real account that happens to share a seed email: the
   * existing row is reused for authorship and its password is left alone.
   */
  const ensureUser = async (email: string, name: string, role: 'ADMIN' | 'USER') => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !existing.isDemo) {
      console.log(`   ${email} already exists and is not demo data - reusing it, password unchanged`);
      return existing;
    }
    return prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash, role, isDemo: true },
      update: { name, passwordHash, role, isDemo: true },
    });
  };

  const admin = await ensureUser('admin@unipods.dev', 'Amara Obi (demo admin)', 'ADMIN');
  const members = [
    await ensureUser('ngozi@unipods.dev', 'Ngozi Eze (demo member)', 'USER'),
    await ensureUser('kelechi@unipods.dev', 'Kelechi Anyanwu (demo member)', 'USER'),
  ];
  return { admin, members };
}

async function seedDocuments(createdById: string): Promise<void> {
  console.log('- ingesting documents');
  for (const demo of DEMO_DOCUMENTS) {
    const buffer = await readFile(join(DEMO_DIR, demo.file));
    const storageKey = `documents/demo/${demo.file}`;
    seedFiles.set(storageKey, buffer);
    // Also place the file in local object storage so its download link works.
    if (env.STORAGE_DRIVER === 'local') {
      const target = resolve(env.LOCAL_STORAGE_DIR, storageKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }

    const document = await prisma.document.create({
      data: {
        title: demo.title,
        description: demo.description,
        type: 'MARKDOWN',
        sourceType: 'DOCUMENT',
        originalFileName: demo.file,
        storageKey,
        mimeType: 'text/markdown',
        fileSize: buffer.byteLength,
        status: 'PENDING',
        publishedAt: new Date(demo.publishedAt),
        isDemo: true,
        createdById,
      },
    });

    const result = await processDocument(deps, document.id);
    console.log(
      `   ${demo.title}: ${result.ok ? `${result.chunks} chunks, ${result.embedded} embedded` : `FAILED - ${result.message}`}`,
    );
  }
}

async function seedMeetings(createdById: string): Promise<void> {
  console.log('- ingesting meetings');
  for (const demo of DEMO_MEETINGS) {
    const content = await readFile(join(DEMO_DIR, demo.file), 'utf8');
    const parsed = parseTranscript(demo.file, content);

    const meeting = await prisma.meeting.create({
      data: {
        title: demo.title,
        description: demo.description,
        meetingDate: new Date(demo.meetingDate),
        originalFileName: demo.file,
        status: 'PENDING',
        // No recording: the transcript is imported directly, which is the path
        // communities use when their conferencing tool already produced one.
        isDemo: true,
        createdById,
      },
    });

    await saveTranscript(prisma, meeting.id, parsed.segments, parsed.durationSeconds);
    const result = await processMeeting(deps, meeting.id);
    console.log(
      `   ${demo.title}: ${parsed.segments.length} segments, ${
        result.ok ? `${result.chunks} chunks, ${result.embedded} embedded` : `FAILED - ${result.message}`
      }`,
    );
  }
}

async function seedMessages(): Promise<void> {
  console.log('- importing messages');
  const content = await readFile(join(DEMO_DIR, 'community-messages.json'), 'utf8');
  const outcome = await new JsonImporter().import(content);
  const persisted = await persistMessages(prisma, outcome.messages, { isDemo: true });
  const result = await processMessages(deps, persisted.messageIds);
  console.log(
    `   ${persisted.imported} imported, ${persisted.skipped} already present, ${result.chunks} chunks, ${result.embedded} embedded`,
  );
}

async function seedQuestionAnalytics(users: {
  admin: { id: string };
  members: Array<{ id: string }>;
}): Promise<void> {
  console.log('- seeding question analytics');
  const now = Date.now();

  for (const gap of DEMO_GAPS) {
    const normalized = [...new Set(contentTokens(gap.question))].sort().join(' ').slice(0, 500);
    const lastAskedAt = new Date(now - gap.daysAgo * 86_400_000);
    const created = await prisma.unansweredQuestion.create({
      data: {
        question: gap.question,
        normalizedQuestion: normalized,
        count: gap.count,
        lastAskedAt,
        status: 'OPEN',
      },
    });
    const embedding = await ai.embeddings.embedText(normalized);
    await setUnansweredQuestionEmbedding(prisma, created.id, embedding);

    // One log row per ask, so the dashboard's totals match the gap counts.
    await prisma.questionLog.createMany({
      data: Array.from({ length: gap.count }, (_, index) => ({
        userId: users.members[index % users.members.length]?.id ?? users.admin.id,
        question: gap.question,
        answered: false,
        confidence: 0,
        latencyMs: 400 + ((index * 37) % 600),
        createdAt: new Date(lastAskedAt.getTime() - index * 3_600_000),
      })),
    });
  }

  const answered = [
    'When is the team declaration deadline?',
    'How big can a team be?',
    'What did we decide about the AI architecture?',
    'What are the submission requirements?',
    'When are mentor office hours?',
    'What happens if we submit late?',
  ];
  await prisma.questionLog.createMany({
    data: answered.map((question, index) => ({
      userId: users.members[index % users.members.length]?.id ?? users.admin.id,
      question,
      answered: true,
      confidence: 0.55 + (index % 4) * 0.1,
      latencyMs: 500 + index * 45,
      createdAt: new Date(now - index * 5_400_000),
    })),
  });
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
