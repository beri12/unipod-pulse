import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage, OutgoingReply } from '../bot/bot.types.js';
import { IngestService } from '../knowledge/ingest.service.js';
import { TranscriptionService } from './transcription.service.js';
import { VOICE_CONFIG, type VoiceConfig } from './voice.config.js';

/**
 * Turns spoken audio into something the bot can use.
 *
 * A short voice note becomes the message text, so a member can ask a question
 * by voice. A long recording sent by an admin is a call: it is transcribed and
 * imported into the knowledge base, which is what lets people who missed the
 * meeting still get answers from it.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    @Inject(VOICE_CONFIG) private readonly config: VoiceConfig,
    private readonly transcription: TranscriptionService,
    private readonly ingest: IngestService,
  ) {}

  /**
   * Preprocessor: rewrites `message.text` with what was said.
   *
   * @returns a reply to end the turn (a recording was imported), or undefined
   *          to carry on with the transcribed text.
   */
  async handle(message: IncomingMessage): Promise<OutgoingReply | null | undefined> {
    const audio = message.audio;
    if (!audio) return undefined;

    if (!this.transcription.enabled) {
      this.logger.warn('Received audio but OPENAI_API_KEY is not set');
      // Only say so when the bot was being addressed; otherwise stay quiet.
      return message.isGroup && !message.mentionedMe
        ? undefined
        : { text: 'I cannot listen to voice messages yet (OPENAI_API_KEY is not set).' };
    }

    const transcript = await this.transcription.transcribe(audio.data, audio.filename);
    if (!transcript) {
      return message.isGroup && !message.mentionedMe
        ? undefined
        : { text: 'I could not understand that recording, sorry.' };
    }

    message.text = transcript;

    if (this.isRecording(message)) return this.importRecording(message, transcript);

    // Short voice note: treat it as if the member had typed it.
    this.logger.log(`Voice message from ${message.senderName ?? message.senderId}: "${transcript}"`);
    return undefined;
  }

  /** A long recording from a group admin is a call, not a question. */
  private isRecording(message: IncomingMessage): boolean {
    const duration = message.audio?.durationSeconds ?? 0;
    return (
      message.isGroup &&
      message.senderIsAdmin === true &&
      duration >= this.config.importFromSeconds
    );
  }

  private async importRecording(
    message: IncomingMessage,
    transcript: string,
  ): Promise<OutgoingReply> {
    const when = message.timestamp.toISOString().slice(0, 10);
    const minutes = Math.round((message.audio?.durationSeconds ?? 0) / 60);
    const title = `Recording — ${when}`;

    const entries = await this.ingest.ingestDocument({
      title,
      content: transcript,
      type: 'meeting',
      date: when,
      author: message.senderName,
      label: `${title} (${message.messageId})`,
    });

    this.logger.log(`Imported a ${minutes} minute recording as ${entries.length} chunk(s)`);

    return {
      text: [
        `Got it — I listened to the ${minutes} minute recording and saved it 📌`,
        `Anyone who missed it can now ask me about it, or use !catchup.`,
      ].join('\n'),
    };
  }
}
