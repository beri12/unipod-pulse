import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from '../bot/bot.types.js';
import type { KnowledgeClaudeService } from '../knowledge/claude.service.js';
import { IngestService } from '../knowledge/ingest.service.js';
import { KnowledgeStoreService } from '../knowledge/knowledge-store.service.js';
import { loadKnowledgeConfig } from '../knowledge/knowledge.config.js';
import type { TranscriptionService } from './transcription.service.js';
import { loadVoiceConfig } from './voice.config.js';
import { VoiceService } from './voice.service.js';

const message = (overrides: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: 'telegram',
  chatId: 'group-1',
  senderId: 'member-1',
  senderName: 'Amina',
  messageId: 'm1',
  text: '',
  isGroup: true,
  mentionedMe: true,
  timestamp: new Date('2026-09-12T10:00:00Z'),
  audio: { data: Buffer.from('fake audio'), filename: 'voice.ogg', durationSeconds: 8 },
  ...overrides,
});

const build = async (env: Record<string, string> = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'voice-'));
  const knowledgeConfig = loadKnowledgeConfig({ KNOWLEDGE_DATA_DIR: dataDir });

  const store = new KnowledgeStoreService(knowledgeConfig);
  await store.onModuleInit();

  const claude = {
    enabled: false,
    summarise: async (title: string) => `summary of ${title}`,
  } as unknown as KnowledgeClaudeService;

  const ingest = new IngestService(knowledgeConfig, store, claude);

  const transcription = {
    enabled: true,
    transcript: 'chhal mn sa3a katbdaw?' as string | null,
    async transcribe() {
      return this.transcript;
    },
  };

  const voice = new VoiceService(
    loadVoiceConfig({ OPENAI_API_KEY: 'test-key', ...env }),
    transcription as unknown as TranscriptionService,
    ingest,
  );

  return { voice, store, transcription };
};

describe('VoiceService', () => {
  it('ignores a message with no audio', async () => {
    const { voice } = await build();
    const text = message({ audio: undefined, text: 'typed question' });

    expect(await voice.handle(text)).toBeUndefined();
    expect(text.text).toBe('typed question');
  });

  it('turns a short voice note into the message text', async () => {
    const { voice } = await build();
    const spoken = message();

    // undefined = carry on routing, now with the transcript as the text.
    expect(await voice.handle(spoken)).toBeUndefined();
    expect(spoken.text).toBe('chhal mn sa3a katbdaw?');
  });

  it('imports a long recording from an admin instead of answering it', async () => {
    const { voice, store } = await build();
    const recording = message({
      senderIsAdmin: true,
      senderName: 'Youssef',
      audio: { data: Buffer.from('long'), filename: 'call.ogg', durationSeconds: 1800 },
    });

    const reply = await voice.handle(recording);

    expect(reply?.text).toContain('30 minute recording');
    expect(store.entries()).toHaveLength(1);
    expect(store.entries()[0]).toMatchObject({ type: 'meeting' });
    expect(store.entries()[0]?.source?.date).toBe('2026-09-12');
  });

  it('treats a long recording from a member as a normal message', async () => {
    const { voice, store } = await build();
    const recording = message({
      senderIsAdmin: false,
      audio: { data: Buffer.from('long'), filename: 'call.ogg', durationSeconds: 1800 },
    });

    expect(await voice.handle(recording)).toBeUndefined();
    expect(store.entries()).toHaveLength(0);
  });

  it('treats a long recording in a private chat as a normal message', async () => {
    const { voice, store } = await build();

    await voice.handle(
      message({
        isGroup: false,
        senderIsAdmin: true,
        audio: { data: Buffer.from('long'), filename: 'call.ogg', durationSeconds: 1800 },
      }),
    );

    expect(store.entries()).toHaveLength(0);
  });

  it('honours the import threshold', async () => {
    const { voice, store } = await build({ VOICE_IMPORT_FROM_SECONDS: '10' });

    await voice.handle(
      message({
        senderIsAdmin: true,
        audio: { data: Buffer.from('x'), filename: 'call.ogg', durationSeconds: 30 },
      }),
    );

    expect(store.entries()).toHaveLength(1);
  });

  describe('when it cannot listen', () => {
    it('says so when it was addressed', async () => {
      const { voice, transcription } = await build();
      transcription.enabled = false;

      const reply = await voice.handle(message({ isGroup: false }));

      expect(reply?.text).toContain('OPENAI_API_KEY');
    });

    it('stays quiet about it in a group it was not addressed in', async () => {
      const { voice, transcription } = await build();
      transcription.enabled = false;

      expect(await voice.handle(message({ mentionedMe: false }))).toBeUndefined();
    });

    it('says so when the audio could not be understood', async () => {
      const { voice, transcription } = await build();
      transcription.transcript = null;

      const reply = await voice.handle(message({ isGroup: false }));

      expect(reply?.text).toContain('could not understand');
    });
  });
});
