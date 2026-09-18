/**
 * Channel-neutral message shape.
 *
 * Every transport (WhatsApp Cloud API, the WhatsApp group bot, Telegram)
 * normalises its very different payload into this, so the command layer never
 * needs to know where a message came from.
 */
export type BotChannel = 'whatsapp-cloud' | 'whatsapp-group' | 'telegram';

/** The message this one replies to, when the sender quoted something. */
export interface QuotedMessage {
  messageId?: string;
  text: string;
  senderId?: string;
  /** True when the quoted message was written by this bot. */
  fromBot?: boolean;
}

/** A voice note, audio file or video note attached to a message. */
export interface IncomingAudio {
  data: Buffer;
  /** Name with a real extension — the transcription API reads the format from it. */
  filename: string;
  durationSeconds?: number;
}

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
  /** Set when the sender replied to an earlier message. */
  quoted?: QuotedMessage;
  /** Set when the message is a voice note or an audio file. */
  audio?: IncomingAudio;
  /**
   * True when the sender is an admin of this group. Undefined when the
   * transport could not determine it. Only admin answers are learned.
   */
  senderIsAdmin?: boolean;
}

export interface OutgoingReply {
  text: string;
}
