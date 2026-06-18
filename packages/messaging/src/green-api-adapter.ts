import type { MessagingAdapter, OutboundMessage } from './adapter.js';

export interface GreenApiAdapterConfig {
  instanceId: string;
  instanceToken: string;
  baseUrl?: string;
}

export class GreenApiAdapter implements MessagingAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: GreenApiAdapterConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.green-api.com';
  }

  async sendMessage(message: OutboundMessage): Promise<string> {
    const url = `${this.baseUrl}/waInstance${this.config.instanceId}/sendMessage/${this.config.instanceToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${message.phone}@c.us`,
        message: message.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Green API error: ${response.status}`);
    }

    const data = (await response.json()) as { idMessage: string };
    return data.idMessage;
  }
}
