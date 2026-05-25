export interface OutboundMessage {
  channelId: string;
  phone: string;
  text: string;
}

export interface InboundMessage {
  channelId: string;
  phone: string;
  text: string;
  wazzupMessageId: string;
  receivedAt: Date;
  isOutgoing: boolean;
}

export interface MessagingAdapter {
  sendMessage(message: OutboundMessage): Promise<string>;
}
