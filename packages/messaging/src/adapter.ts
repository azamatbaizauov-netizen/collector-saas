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
  // Тип сообщения Green API: textMessage | imageMessage | documentMessage | ...
  messageType: string;
  // Текст: из textMessage / extendedText / подписи к файлу (caption).
  text: string;
  // Медиа-вложение (ADR 0008): прямая ссылка Green API на файл (чек-картинка/PDF)
  // и его mime/имя. Есть только у file-сообщений; для текста undefined.
  downloadUrl?: string | undefined;
  mimeType?: string | undefined;
  fileName?: string | undefined;
  // Кто отправил в группе (senderData.sender) — для аудита событий долга.
  senderPhone?: string | undefined;
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
  downloadUrl?: string | undefined;
  mimeType?: string | undefined;
  fileName?: string | undefined;
  senderPhone?: string | undefined;
  greenApiMessageId: string;
  receivedAt: string;
}
