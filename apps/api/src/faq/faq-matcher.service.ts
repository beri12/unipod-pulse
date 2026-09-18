import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { FAQ_CONFIG, type FaqConfig } from './faq.config.js';
import type { FaqEntry, FaqMatch } from './faq.types.js';

const MatchSchema = z.object({
  match_id: z
    .string()
    .nullable()
    .describe('The id of the matching entry, or null when nothing matches'),
  confidence: z.number().describe('0 to 1: how sure you are that it is the same question'),
  reason: z.string().describe('One short sentence explaining the decision'),
});

const SYSTEM_PROMPT = `You match a new question against a list of questions a community's admins have already answered.

The community is multilingual: questions arrive in English, French, Arabic, Darija (Moroccan Arabic, often written in Latin letters with numbers, e.g. "3afak", "chhal"), or a mix. The same question is rarely asked with the same words twice.

Match when the new question asks for THE SAME INFORMATION as a stored question, even if:
- it is in a different language
- it is worded completely differently, or paraphrased
- it has typos, slang, or no punctuation
- it is shorter or longer, or more polite

Do NOT match when:
- the topic is the same but the information wanted is different
  ("what time do you open?" vs "what time do you close?" are DIFFERENT)
- the new question asks about a different person, place, price or date
- you are only guessing

Answering wrongly is worse than not answering: a wrong answer misinforms the whole group. When unsure, return match_id null.

Set confidence to how sure you are that a member asking the new question would be satisfied by the stored answer.`;

/**
 * Decides whether a new question is one the admins already answered.
 *
 * Claude does the understanding; the answer text itself always comes from the
 * stored admin reply, so the bot cannot invent facts about the community.
 */
@Injectable()
export class FaqMatcherService {
  private readonly logger = new Logger(FaqMatcherService.name);
  private readonly client?: Anthropic;

  constructor(@Inject(FAQ_CONFIG) private readonly config: FaqConfig) {
    if (config.enabled) {
      this.client = new Anthropic({ apiKey: config.apiKey });
    }
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  async match(question: string, entries: FaqEntry[]): Promise<FaqMatch | null> {
    if (!this.client || entries.length === 0) return null;

    // Newest first: recent answers are the ones most likely to be asked about
    // again, and this keeps the prompt bounded on a large FAQ.
    const candidates = entries.slice(-this.config.maxEntriesPerCall).reverse();

    try {
      const response = await this.client.messages.parse({
        model: this.config.model,
        max_tokens: 2000,
        system: [
          { type: 'text', text: SYSTEM_PROMPT },
          {
            type: 'text',
            text: this.renderEntries(candidates),
            // Stable across questions, so it is worth caching once the list
            // grows past the model's minimum cacheable prefix.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: `New question:\n${question}` }],
        output_config: {
          effort: this.config.effort,
          format: zodOutputFormat(MatchSchema),
        },
      });

      const parsed = response.parsed_output;
      if (!parsed?.match_id) return null;

      const entry = candidates.find((candidate) => candidate.id === parsed.match_id);
      if (!entry) {
        this.logger.warn(`Claude returned an unknown entry id: ${parsed.match_id}`);
        return null;
      }

      this.logger.debug(
        `Matched "${question}" -> "${entry.question}" (${parsed.confidence}): ${parsed.reason}`,
      );
      return { entry, confidence: parsed.confidence };
    } catch (error) {
      // Never let an API problem break the bot: it just stays silent.
      this.logger.error(`Matching failed: ${(error as Error).message}`);
      return null;
    }
  }

  private renderEntries(entries: FaqEntry[]): string {
    const lines = entries.map((entry) =>
      [`id: ${entry.id}`, `question: ${entry.question}`, `answer: ${entry.answer}`].join('\n'),
    );
    return `Questions the admins have already answered:\n\n${lines.join('\n\n')}`;
  }
}
