export const TELEGRAM_CONFIG = Symbol('TELEGRAM_CONFIG');

/**
 * polling  — the bot asks Telegram for updates. Works on a laptop, behind a
 *            firewall, with no public URL. Best for development.
 * webhook  — Telegram POSTs to you. Needs a public HTTPS URL. Best for servers.
 */
export type TelegramMode = 'polling' | 'webhook';

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  mode: TelegramMode;
  /** Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string;
  /** Empty = every chat the bot is added to. */
  allowedChats: string[];
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const token = env.TELEGRAM_BOT_TOKEN ?? '';

  return {
    // No token means nothing to connect with, so the module simply stays quiet.
    enabled: Boolean(token),
    token,
    mode: env.TELEGRAM_MODE === 'webhook' ? 'webhook' : 'polling',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
    allowedChats: list(env.TELEGRAM_ALLOWED_CHATS),
  };
}
