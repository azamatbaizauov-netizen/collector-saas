import type { MessagingAdapter, OutboundMessage } from './adapter.js';

export interface WazzupAdapterConfig {
  apiKey: string;
  baseUrl?: string;
}

export class WazzupAdapter implements MessagingAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: WazzupAdapterConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.wazzup24.com';
  }

  async sendMessage(message: OutboundMessage): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v3/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        channelId: message.channelId,
        chatType: 'whatsapp',
        chatId: message.phone,
        text: message.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Wazzup API error: ${response.status}`);
    }

    const data = (await response.json()) as { messageId: string };
    return data.messageId;
  }
}
