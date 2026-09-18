/**
 * Channel-neutral message shape.
 *
 * Every transport (WhatsApp Cloud API, the WhatsApp group bot, Telegram)
 * normalises its very different payload into this, so the command layer never
 * needs to know where a message came from.
 */
export type BotChannel = 'whatsapp-cloud' | 'whatsapp-group' | 'telegram';

export interface IncomingMessage {
  channel: BotChannel;
  /** Where a reply must be sent: a phone number, a JID, or a Telegram chat id. */
  chatId: string;
  /** Who wrote it. In groups this differs from chatId. */
  senderId: string;
  senderName?: string;
  /** Provider message id, used for de-duplication. */
  messageId: string;
  text: string;
  isGroup: boolean;
  /** True when the bot itself was @mentioned in the message. */
  mentionedMe: boolean;
  timestamp: Date;
}

export interface OutgoingReply {
  text: string;
}
