import type { InboundMessage } from './adapter.js';

// Сырой payload вебхука Green API (только используемые поля).
interface GreenApiWebhookBody {
  typeWebhook?: string;
  idMessage?: string;
  timestamp?: number;
  instanceData?: { idInstance?: number };
  senderData?: { chatId?: string; sender?: string };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
    fileMessageData?: {
      caption?: string;
      downloadUrl?: string;
      mimeType?: string;
      fileName?: string;
    };
  };
}

const MESSAGE_WEBHOOKS = new Set([
  'incomingMessageReceived',
  'outgoingMessageReceived',
  'outgoingAPIMessageReceived',
]);

function stripSuffix(chatId: string): string {
  return chatId.replace(/@(c|g)\.us$/, '');
}

function extractText(md: NonNullable<GreenApiWebhookBody['messageData']>): string {
  return (
    md.textMessageData?.textMessage ??
    md.extendedTextMessageData?.text ??
    md.fileMessageData?.caption ??
    ''
  );
}

/**
 * Нормализует payload вебхука Green API в InboundMessage.
 * Возвращает null для не-сообщений (state, статусы и т.п.) или при нехватке данных.
 */
export function parseGreenApiWebhook(raw: unknown): InboundMessage | null {
  const body = (raw ?? {}) as GreenApiWebhookBody;
  const typeWebhook = body.typeWebhook ?? '';
  if (!MESSAGE_WEBHOOKS.has(typeWebhook)) return null;

  const messageId = body.idMessage;
  const instanceIdRaw = body.instanceData?.idInstance;
  const chatId = body.senderData?.chatId;
  if (!messageId || instanceIdRaw == null || !chatId) return null;

  const md = body.messageData;
  if (!md) return null;

  const isGroup = chatId.endsWith('@g.us');
  const file = md.fileMessageData;
  const sender = body.senderData?.sender;
  return {
    instanceId: String(instanceIdRaw),
    chatId,
    // В личном чате chatId == контрагент в обе стороны; в группе оставляем id группы.
    phone: stripSuffix(chatId),
    isGroup,
    isOutgoing: typeWebhook !== 'incomingMessageReceived',
    messageType: md.typeMessage ?? 'unknown',
    text: extractText(md),
    downloadUrl: file?.downloadUrl,
    mimeType: file?.mimeType,
    fileName: file?.fileName,
    senderPhone: sender ? stripSuffix(sender) : undefined,
    greenApiMessageId: messageId,
    receivedAt: body.timestamp ? new Date(body.timestamp * 1000) : new Date(),
  };
}
