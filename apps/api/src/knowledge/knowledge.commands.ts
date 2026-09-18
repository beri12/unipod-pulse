import type { BotCommand, CommandContext } from '../bot/commands/command.types.js';
import type { AnswerService } from './answer.service.js';
import type { CatchupService } from './catchup.service.js';
import type { IngestService } from './ingest.service.js';
import type { KnowledgeStoreService } from './knowledge-store.service.js';

/** Outside a group anyone may manage knowledge; inside one, admins only. */
const mayManage = ({ message }: CommandContext): boolean =>
  !message.isGroup || message.senderIsAdmin === true;

const DENIED = 'Only a group admin can do that.';

export interface KnowledgeCommandDeps {
  store: KnowledgeStoreService;
  ingest: IngestService;
  answer: AnswerService;
  catchup: CatchupService;
}

export function knowledgeCommands({
  store,
  ingest,
  answer,
  catchup,
}: KnowledgeCommandDeps): BotCommand[] {
  return [
    {
      name: 'ask',
      description: 'Ask anything: !ask when is the next meeting?',
      aliases: ['q'],
      handler: async (ctx) => {
        if (!ctx.rest) return 'Ask me something: !ask what are the opening hours?';
        if (!answer.enabled) {
          return 'Answering is switched off (ANTHROPIC_API_KEY is not set).';
        }
        // The message text is the command line; give the answerer the question.
        return answer.answer({ ...ctx.message, text: ctx.rest }, true);
      },
    },
    {
      name: 'catchup',
      description: 'What did I miss? !catchup [hours]',
      aliases: ['missed'],
      handler: (ctx) => catchup.catchUp(ctx.message, Number(ctx.args[0])),
    },
    {
      name: 'sources',
      description: 'What I have learned and read',
      aliases: ['faq', 'knowledge'],
      handler: (ctx) => {
        const entries = store.entriesFor(ctx.message.chatId);
        if (entries.length === 0) {
          return 'I have not learned anything here yet.\nWhen an admin answers a question, I remember it. Organisers can also import call transcripts and notes.';
        }

        const byType = new Map<string, number>();
        for (const entry of entries) byType.set(entry.type, (byType.get(entry.type) ?? 0) + 1);

        const counts = [...byType.entries()]
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');

        const recent = entries
          .slice(-5)
          .reverse()
          .map((entry, index) => `${index + 1}. ${entry.title}`);

        return `I know ${entries.length} things here (${counts}).\n\nNewest:\n${recent.join('\n')}`;
      },
    },
    {
      name: 'learn',
      description: 'Teach me an answer: !learn question | answer',
      handler: async (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const [question, ...answerParts] = ctx.rest.split('|');
        const text = answerParts.join('|').trim();
        if (!question?.trim() || !text) {
          return 'Use: !learn what are the opening hours? | We open 9h to 19h, Monday to Friday.';
        }

        const entry = await ingest.teach(ctx.message, question, text);
        return `Learned ✅\nQ: ${entry.title}\nA: ${entry.content}`;
      },
    },
    {
      name: 'forget',
      description: 'Make me forget something: !forget <number from !sources>',
      handler: async (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const entries = store.entriesFor(ctx.message.chatId).slice(-5).reverse();
        const position = Number(ctx.args[0]);

        if (!Number.isInteger(position) || position < 1 || position > entries.length) {
          return 'Use: !forget 1 — the number comes from !sources.';
        }

        const entry = entries[position - 1]!;
        await store.removeEntry(entry.id);
        return `Forgotten ✅\n"${entry.title}"`;
      },
    },
    {
      name: 'gaps',
      description: 'Questions nobody has answered yet',
      handler: (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const gaps = store.openGaps(ctx.message.chatId);
        if (gaps.length === 0) return 'No open questions 🎉';

        // Most-asked first: those are costing the group the most time.
        const lines = [...gaps]
          .sort((a, b) => b.timesAsked - a.timesAsked)
          .slice(0, 10)
          .map((gap, index) => {
            const times = gap.timesAsked > 1 ? ` (asked ${gap.timesAsked}×)` : '';
            return `${index + 1}. ${gap.question}${times}`;
          });

        return `${gaps.length} open question${gaps.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}\n\nAnswer one with: !resolve 1 your answer`;
      },
    },
    {
      name: 'resolve',
      description: 'Answer an open question: !resolve <number> <answer>',
      handler: async (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const gaps = [...store.openGaps(ctx.message.chatId)]
          .sort((a, b) => b.timesAsked - a.timesAsked)
          .slice(0, 10);

        const position = Number(ctx.args[0]);
        const text = ctx.args.slice(1).join(' ').trim();

        if (!Number.isInteger(position) || position < 1 || position > gaps.length) {
          return 'Use: !resolve 1 We open 9h to 19h. — the number comes from !gaps.';
        }
        if (!text) return 'Add the answer: !resolve 1 We open 9h to 19h.';

        const gap = gaps[position - 1]!;
        await ingest.teach(ctx.message, gap.question, text);
        await store.resolveGap(gap.id, text, ctx.message.senderName ?? ctx.message.senderId);

        return `Answered ✅ I will use this from now on.\nQ: ${gap.question}\nA: ${text}`;
      },
    },
  ];
}
