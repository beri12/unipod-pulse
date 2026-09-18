import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage } from '../bot/bot.types.js';
import { chunkText } from './chunker.js';
import { KnowledgeClaudeService } from './claude.service.js';
import { KnowledgeStoreService } from './knowledge-store.service.js';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config.js';
import { GLOBAL_SCOPE, type KnowledgeEntry, type SourceType } from './knowledge.types.js';
import { looksLikeQuestion } from './question.js';

export interface IngestRequest {
  title: string;
  content: string;
  type?: SourceType;
  /** A chat id, or omitted for community-wide. */
  scope?: string;
  label?: string;
  date?: string;
  author?: string;
}

/** Everything that puts knowledge into the store. */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig,
    private readonly store: KnowledgeStoreService,
    private readonly claude: KnowledgeClaudeService,
  ) {}

  /**
   * Imports a call transcript, meeting notes or a document: split into chunks,
   * indexed with a one-line summary each.
   */
  async ingestDocument(request: IngestRequest): Promise<KnowledgeEntry[]> {
    const type = request.type ?? 'meeting';
    const label = request.label ?? request.title;
    const chunks = chunkText(request.content, this.config.chunkSize, this.config.chunkOverlap);

    if (chunks.length === 0) return [];

    // Re-importing the same call replaces the previous import rather than
    // storing every line twice.
    const replaced = await this.store.removeBySourceLabel(label);
    if (replaced > 0) {
      this.logger.log(`Replacing ${replaced} existing chunks of "${label}"`);
    }

    const prepared = [];
    for (const chunk of chunks) {
      const title =
        chunks.length > 1 ? `${request.title} (part ${chunk.part}/${chunk.parts})` : request.title;

      prepared.push({
        type,
        title,
        content: chunk.text,
        summary: await this.claude.summarise(title, chunk.text, type),
        scope: request.scope ?? GLOBAL_SCOPE,
        source: {
          label,
          date: request.date,
          author: request.author,
          part: chunk.part,
          parts: chunk.parts,
        },
      });
    }

    const entries = await this.store.addEntries(prepared);
    this.logger.log(`Imported "${request.title}" as ${entries.length} chunk(s)`);
    return entries;
  }

  /**
   * Watches for a group admin replying to a member's question, and keeps the
   * pair as the community's official answer.
   */
  async learnFromAdminReply(message: IncomingMessage): Promise<KnowledgeEntry | null> {
    if (!this.config.autoLearn) return null;
    if (!message.isGroup) return null;
    if (message.senderIsAdmin !== true) return null;

    const quoted = message.quoted;
    if (!quoted?.text) return null;
    // Replying to the bot is a correction or a thank-you, not a new answer.
    if (quoted.fromBot) return null;
    if (!looksLikeQuestion(quoted.text)) return null;

    const answer = message.text.trim();
    // A command, a bare "yes", or an emoji is not an answer worth keeping.
    if (answer.length < 4) return null;

    const entry = await this.teach(message, quoted.text, answer);
    this.logger.log(`Learned: "${entry.title}" -> "${entry.content}"`);
    return entry;
  }

  /** Stores a question/answer pair as the community's official answer. */
  async teach(
    message: IncomingMessage,
    question: string,
    answer: string,
  ): Promise<KnowledgeEntry> {
    const title = question.trim();
    const content = answer.trim();

    return this.store.addEntry({
      type: 'qa',
      title,
      content,
      summary: `Question: ${title}`,
      scope: message.chatId,
      channel: message.channel,
      source: {
        label: 'Answered in the group',
        date: new Date().toISOString().slice(0, 10),
        author: message.senderName ?? message.senderId,
      },
    });
  }
}
