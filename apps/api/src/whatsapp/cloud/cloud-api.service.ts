import { Inject, Injectable, Logger } from '@nestjs/common';
import { WHATSAPP_CONFIG, type WhatsappConfig } from '../whatsapp.config.js';

/**
 * Outbound half of the official WhatsApp Cloud API.
 *
 * Note the 24-hour rule: free-form text only reaches a user within 24 hours of
 * their last message to you. Outside that window Meta rejects everything but
 * an approved template — use `sendTemplate`.
 */
@Injectable()
export class CloudApiService {
  private readonly logger = new Logger(CloudApiService.name);

  constructor(@Inject(WHATSAPP_CONFIG) private readonly config: WhatsappConfig) {}

  get enabled(): boolean {
    return this.config.cloud.enabled;
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    });
  }

  async sendTemplate(to: string, name: string, languageCode = 'en_US'): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name, language: { code: languageCode } },
    });
  }

  /** Blue ticks. Best-effort: a failure here must never break the reply. */
  async markRead(messageId: string): Promise<void> {
    try {
      await this.post({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch {
      this.logger.debug(`Could not mark ${messageId} as read`);
    }
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const { enabled, apiVersion, phoneNumberId, accessToken } = this.config.cloud;

    if (!enabled) {
      this.logger.warn(
        `Cloud API not configured (set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID) — dropping: ${JSON.stringify(payload)}`,
      );
      return;
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      // 401 during testing almost always means the 24h temporary token expired.
      throw new Error(`WhatsApp Cloud API ${response.status}: ${detail}`);
    }
  }
}
