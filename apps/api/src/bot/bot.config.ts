export const BOT_CONFIG = Symbol('BOT_CONFIG');

export interface BotConfig {
  /** Character that marks a command, e.g. "!help". */
  commandPrefix: string;
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  return {
    commandPrefix: env.BOT_COMMAND_PREFIX ?? env.WHATSAPP_COMMAND_PREFIX ?? '!',
  };
}
