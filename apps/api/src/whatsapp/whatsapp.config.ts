export const WHATSAPP_CONFIG = Symbol('WHATSAPP_CONFIG');

export interface WhatsappConfig {
  cloud: {
    enabled: boolean;
    /** Graph API version, e.g. "v21.0". */
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
    /** Value you also type into the Meta dashboard callback form. */
    verifyToken: string;
    /** Meta App Secret. When set, webhook signatures are enforced. */
    appSecret: string;
  };
  group: {
    enabled: boolean;
    sessionPath: string;
    /** Empty = every group the bot is added to. */
    allowedGroups: string[];
    /** Human-like pause before replying, in ms. */
    replyDelayMs: number;
  };
  /** Prefix that marks a message as a command, e.g. "!help". */
  commandPrefix: string;
}

const bool = (value: string | undefined, fallback = false): boolean =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function loadWhatsappConfig(env: NodeJS.ProcessEnv = process.env): WhatsappConfig {
  const accessToken = env.WHATSAPP_TOKEN ?? '';
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID ?? '';

  return {
    cloud: {
      // Sending is only possible with both credentials; the webhook half works
      // regardless, so the app still boots for receive-only testing.
      enabled: Boolean(accessToken && phoneNumberId),
      apiVersion: env.WHATSAPP_API_VERSION ?? 'v21.0',
      phoneNumberId,
      accessToken,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
      appSecret: env.WHATSAPP_APP_SECRET ?? '',
    },
    group: {
      enabled: bool(env.WHATSAPP_GROUP_BOT_ENABLED, false),
      sessionPath: env.WHATSAPP_SESSION_PATH ?? './wa-session',
      allowedGroups: list(env.WHATSAPP_ALLOWED_GROUPS),
      replyDelayMs: Number(env.WHATSAPP_REPLY_DELAY_MS ?? 1200),
    },
    commandPrefix: env.WHATSAPP_COMMAND_PREFIX ?? '!',
  };
}
