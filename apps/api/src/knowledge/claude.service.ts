import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config.js';
import type { ArchivedMessage, KnowledgeEntry } from './knowledge.types.js';

const SelectionSchema = z.object({
  ids: z.array(z.string()).describe('Ids of the entries worth reading in full, best first'),
});

const AnswerSchema = z.object({
  answer: z
    .string()
    .nullable()
    .describe('The answer in the asker\'s language, or null if the sources do not contain it'),
  confidence: z.number().describe('0 to 1: how well the sources actually answer the question'),
  citation_ids: z.array(z.string()).describe('Ids of the entries the answer came from'),
});

const SummarySchema = z.object({
  summary: z.string().describe('One line naming the topics and questions this text can answer'),
});

const ANSWER_SYSTEM = `You answer questions for a community, using only the sources you are given.

The community is multilingual: questions and sources arrive in English, French, Arabic or Darija (Moroccan Arabic, often written in Latin letters with numbers, e.g. "3afak", "chhal"). Match meaning across languages and paraphrases, and always reply in the language the question was asked in.

Rules:
- Use ONLY the sources provided. Never add facts from your own knowledge.
- When a source of type "qa" answers the question, reuse the admin's wording as closely as possible — it is the community's official answer.
- When the answer comes from a meeting or a document, state it plainly and mention when it was decided if the source says so.
- If the sources disagree, prefer the most recent and say that it changed.
- If the sources do not actually answer the question, set answer to null. Do not guess, and do not answer a nearby question instead.
- Keep it short: a chat message, not an essay. No greeting, no sign-off.

Answering wrongly is worse than not answering: a wrong answer misinforms the whole group. confidence is how well the sources answer THIS question, not how well written your reply is.`;

const SELECT_SYSTEM = `You pick which community sources are worth reading in full to answer a question.

Each candidate is one line: an id, its type, and what it covers. Return the ids that plausibly contain the answer, best first, and nothing else. Match across languages and paraphrases. Prefer fewer, better candidates; return an empty list when nothing looks relevant.`;

const CATCHUP_SYSTEM = `You tell a community member what they missed in a group chat.

Write a short briefing from the messages given. Structure it as:
- Decisions and announcements
- Questions that were answered (with the answer)
- Anything still open or needing a reply

Rules:
- Only use what is in the messages. Never invent.
- Skip greetings, thanks, emoji and small talk.
- Name people as they appear in the messages.
- If nothing important happened, say so in one line.
- Be brief: this is a chat message. Use short bullets.
- Reply in the language most of the messages use.`;

/**
 * Every Claude call the knowledge base makes.
 *
 * Each returns a safe fallback instead of throwing: a failing API must make
 * the bot quieter, never broken.
 */
@Injectable()
export class KnowledgeClaudeService {
  private readonly logger = new Logger(KnowledgeClaudeService.name);
  private readonly client?: Anthropic;

  constructor(@Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig) {
    if (config.enabled) this.client = new Anthropic({ apiKey: config.apiKey });
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  /** One line describing a chunk, used later to decide what to read. */
  async summarise(title: string, content: string, type: string): Promise<string> {
    const fallback = content.replace(/\s+/g, ' ').slice(0, 160);
    if (!this.client) return fallback;

    try {
      const response = await this.client.messages.parse({
        model: this.config.model,
        max_tokens: 500,
        system:
          'You write one-line indexes for a community knowledge base. Given a piece of text, write a single line naming the topics, names, dates and questions it could answer. No preamble. Write it in the language of the text.',
        messages: [
          { role: 'user', content: `Type: ${type}\nTitle: ${title}\n\n${content.slice(0, 6000)}` },
        ],
        output_config: { effort: 'low', format: zodOutputFormat(SummarySchema) },
      });
      return response.parsed_output?.summary?.trim() || fallback;
    } catch (error) {
      this.logger.warn(`Could not summarise "${title}": ${(error as Error).message}`);
      return fallback;
    }
  }

  /** Narrows a large corpus down to the entries worth reading in full. */
  async selectRelevant(question: string, candidates: KnowledgeEntry[]): Promise<string[]> {
    if (!this.client || candidates.length === 0) return [];

    const lines = candidates.map(
      (entry) => `${entry.id} | ${entry.type} | ${entry.title} | ${entry.summary}`,
    );

    try {
      const response = await this.client.messages.parse({
        model: this.config.model,
        max_tokens: 2000,
        system: [
          { type: 'text', text: SELECT_SYSTEM },
          {
            type: 'text',
            text: `Candidates:\n${lines.join('\n')}`,
            // Stable between questions, so it caches once the list is large.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Question:\n${question}\n\nReturn at most ${this.config.maxReadEntries} ids.`,
          },
        ],
        output_config: { effort: 'low', format: zodOutputFormat(SelectionSchema) },
      });

      return response.parsed_output?.ids?.slice(0, this.config.maxReadEntries) ?? [];
    } catch (error) {
      this.logger.error(`Selection failed: ${(error as Error).message}`);
      return [];
    }
  }

  /** Composes the reply from the entries that were read. */
  async composeAnswer(
    question: string,
    entries: KnowledgeEntry[],
  ): Promise<{ answer: string | null; confidence: number; citationIds: string[] }> {
    const none = { answer: null, confidence: 0, citationIds: [] };
    if (!this.client || entries.length === 0) return none;

    try {
      const response = await this.client.messages.parse({
        model: this.config.model,
        max_tokens: 2000,
        system: ANSWER_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Sources:\n\n${entries.map((entry) => this.renderEntry(entry)).join('\n\n---\n\n')}\n\nQuestion:\n${question}`,
          },
        ],
        output_config: {
          effort: this.config.effort,
          format: zodOutputFormat(AnswerSchema),
        },
      });

      const parsed = response.parsed_output;
      if (!parsed?.answer) return none;

      return {
        answer: parsed.answer.trim(),
        confidence: parsed.confidence,
        citationIds: parsed.citation_ids ?? [],
      };
    } catch (error) {
      this.logger.error(`Answering failed: ${(error as Error).message}`);
      return none;
    }
  }

  /** Summarises recent messages into "here is what you missed". */
  async catchUp(messages: ArchivedMessage[], hours: number): Promise<string | null> {
    if (!this.client || messages.length === 0) return null;

    const transcript = messages
      .map((message) => `[${message.at}] ${message.senderName ?? message.senderId}: ${message.text}`)
      .join('\n');

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 2000,
        system: CATCHUP_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `The last ${hours} hours in the group (${messages.length} messages):\n\n${transcript}`,
          },
        ],
        output_config: { effort: this.config.effort },
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return text || null;
    } catch (error) {
      this.logger.error(`Catch-up failed: ${(error as Error).message}`);
      return null;
    }
  }

  private renderEntry(entry: KnowledgeEntry): string {
    const source = entry.source;
    const where = [source?.label, source?.date, source?.author].filter(Boolean).join(' · ');
    const part = source?.parts && source.parts > 1 ? ` (part ${source.part}/${source.parts})` : '';

    return [
      `id: ${entry.id}`,
      `type: ${entry.type}`,
      where ? `source: ${where}${part}` : undefined,
      `title: ${entry.title}`,
      `content:\n${entry.content}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
