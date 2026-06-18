export interface OutboundMessage {
  channelId: string;
  phone: string;
  text: string;
}

export interface InboundMessage {
  instanceId: string;
  // Чат-контрагент: для личных чатов это и есть номер контакта (должника).
  chatId: string;
  phone: string;
  isGroup: boolean;
  isOutgoing: boolean;
  // Тип сообщения Green API: textMessage | imageMessage | audioMessage | ...
  messageType: string;
  // Текст: из textMessage / extendedText / подписи к файлу (caption).
  text: string;
  greenApiMessageId: string;
  receivedAt: Date;
}

export interface MessagingAdapter {
  sendMessage(message: OutboundMessage): Promise<string>;
}

// Payload задачи очереди 'messages'. JSON-сериализуемый (даты — ISO-строки).
export interface InboundMessageJob {
  organizationId: string;
  instanceId: string;
  chatId: string;
  phone: string;
  isGroup: boolean;
  isOutgoing: boolean;
  messageType: string;
  text: string;
  greenApiMessageId: string;
  receivedAt: string;
}
