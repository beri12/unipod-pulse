/**
 * Channel-neutral message shape.
 *
 * Both transports (the official Cloud API and the Baileys group bot) normalise
 * their very different payloads into this, so the command layer never needs to
 * know where a message came from.
 */
export type WhatsappChannel = 'cloud' | 'group';

export interface IncomingMessage {
  channel: WhatsappChannel;
  /** Where a reply must be sent: a phone number (cloud) or a JID (group). */
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
