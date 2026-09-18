import type { BotCommand } from './command.types.js';

/**
 * Starter command set. Add project commands here (or call
 * `CommandRouterService.register()` from another module) — everything in this
 * list is automatically listed by `!help`.
 */
export const builtinCommands: BotCommand[] = [
  {
    name: 'ping',
    description: 'Check that the bot is alive',
    handler: () => 'pong ✅',
  },
  {
    name: 'about',
    description: 'What this bot is',
    handler: () =>
      'UniPod Pulse bot 🤖\nI answer commands here and in private chat.\nType !help to see what I can do.',
  },
  {
    name: 'whoami',
    description: 'Show how the bot sees you',
    handler: ({ message }) => {
      const where = message.isGroup ? 'group' : 'private chat';
      const name = message.senderName ?? 'unknown';
      return `You are ${name} (${message.senderId})\nWriting from a ${where}\nChannel: ${message.channel}`;
    },
  },
  {
    name: 'echo',
    description: 'Repeat back what you wrote — useful while testing',
    handler: ({ rest }) => (rest ? rest : 'Give me something to echo: !echo hello'),
  },
];
