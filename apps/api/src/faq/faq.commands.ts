import type { BotCommand, CommandContext } from '../bot/commands/command.types.js';
import type { FaqService } from './faq.service.js';

/** Outside a group anyone may manage the FAQ; inside one, admins only. */
const mayManage = ({ message }: CommandContext): boolean =>
  !message.isGroup || message.senderIsAdmin === true;

const DENIED = 'Only a group admin can change what I have learned.';

export function faqCommands(faq: FaqService): BotCommand[] {
  return [
    {
      name: 'faq',
      description: 'Show the answers I have learned here',
      handler: (ctx) => {
        const entries = faq.listFor(ctx.message.chatId);
        if (entries.length === 0) {
          return 'I have not learned anything here yet.\nWhen an admin replies to a question, I remember the answer.';
        }

        const lines = entries
          .slice(-10)
          .reverse()
          .map((entry, index) => `${index + 1}. ${entry.question}\n   → ${entry.answer}`);

        const header = `I know ${entries.length} answer${entries.length === 1 ? '' : 's'} here`;
        const shown = entries.length > 10 ? ' (showing the 10 newest)' : '';
        return `${header}${shown}:\n\n${lines.join('\n\n')}`;
      },
    },
    {
      name: 'learn',
      description: 'Teach me an answer: !learn question | answer',
      handler: async (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const [question, ...answerParts] = ctx.rest.split('|');
        const answer = answerParts.join('|').trim();

        if (!question?.trim() || !answer) {
          return 'Use: !learn what are the opening hours? | We open 9h to 19h, Monday to Friday.';
        }

        const entry = await faq.teach(ctx.message, question, answer);
        return `Learned ✅\nQ: ${entry.question}\nA: ${entry.answer}`;
      },
    },
    {
      name: 'forget',
      description: 'Make me forget an answer: !forget <number from !faq>',
      handler: async (ctx) => {
        if (!mayManage(ctx)) return DENIED;

        const position = Number(ctx.args[0]);
        const entries = faq.listFor(ctx.message.chatId).slice(-10).reverse();

        if (!Number.isInteger(position) || position < 1 || position > entries.length) {
          return `Use: !forget 1 — the number comes from ${ctx.command === 'forget' ? '!faq' : '!faq'}.`;
        }

        const entry = entries[position - 1]!;
        await faq.forget(entry.id);
        return `Forgotten ✅\n"${entry.question}"`;
      },
    },
  ];
}
