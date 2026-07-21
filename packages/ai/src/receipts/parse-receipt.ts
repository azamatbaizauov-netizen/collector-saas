import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { reportUsage, type UsageSink } from '../pricing.js';

// Vision-разбор документов из рабочих WhatsApp-групп (ADR 0008): чек оплаты
// (Kaspi/банк — картинка или PDF) и скрин курса обмена валют. Haiku 4.5 —
// vision-capable, поддерживает и image, и document(PDF). Долг НЕ меняем:
// возвращаем структуру владельцу на подтверждение (человек в цикле, принцип 6).
const MODEL = 'claude-haiku-4-5-20251001';

export type ReceiptDocType = 'PAYMENT_RECEIPT' | 'NEW_DEBT' | 'EXCHANGE_RATE' | 'OTHER';

export interface ReceiptMedia {
  // base64-содержимое файла (без data: префикса)
  data: string;
  // mime: image/jpeg | image/png | image/webp | image/gif | application/pdf
  mediaType: string;
}

export interface ParsedReceipt {
  docType: ReceiptDocType;
  // Сумма в минорных единицах валюты чека (тиыны/центы). Валюту НЕ конвертируем:
  // Kaspi-чек — это тенге, а не доллары. undefined, если суммы на документе нет.
  amountMinor?: bigint | undefined;
  currency?: string | undefined;
  dateText?: string | undefined;
  payerName?: string | undefined;
  payeeName?: string | undefined;
  bank?: string | undefined;
  // Курс из скрина обмена валют, как напечатан (например «480 ₸/$»).
  exchangeRate?: string | undefined;
  // Короткая человекочитаемая сводка на русском — для карточки владельцу.
  note?: string | undefined;
}

const outputSchema = z.object({
  docType: z.enum(['PAYMENT_RECEIPT', 'NEW_DEBT', 'EXCHANGE_RATE', 'OTHER']),
  amount: z.number().nullish(),
  currency: z.string().nullish(),
  dateText: z.string().nullish(),
  payerName: z.string().nullish(),
  payeeName: z.string().nullish(),
  bank: z.string().nullish(),
  exchangeRate: z.string().nullish(),
  note: z.string().nullish(),
});

const PROMPT = `Ты разбираешь документ из рабочей WhatsApp-группы оптовика. В группу кидают: чеки оплаты (обычно Kaspi, картинка или PDF), реже — скриншот курса обмена валют. Твоя задача — извлечь структурированные данные. Ничего не выдумывай: если поля нет на документе — верни null.

Определи:
- docType:
  - PAYMENT_RECEIPT — чек/квитанция об оплате (перевод, Kaspi, банк).
  - NEW_DEBT — документ явно про новую отгрузку в долг (накладная/счёт), не оплату.
  - EXCHANGE_RATE — скриншот курса обмена валют (табло обменника, экран приложения с курсом).
  - OTHER — фото не относится к деньгам/долгу (товар, переписка, случайное).
- amount — сумма платежа ЧИСЛОМ в той валюте, что на документе. НЕ конвертируй. null, если суммы нет.
- currency — ISO-код валюты чека: KZT (тенге), USD, RUB, CNY. null, если не ясно.
- dateText — дата операции, КАК напечатана на документе (строкой). null, если нет.
- payerName — кто платит/отправитель. null, если нет.
- payeeName — кто получает/получатель. null, если нет.
- bank — банк/сервис (Kaspi, Halyk, Freedom и т.п.). null, если нет.
- exchangeRate — только для EXCHANGE_RATE: курс строкой как на экране (например "480 ₸/$"). Иначе null.
- note — одна короткая фраза на русском, что это за документ (для человека).

Правила:
- Валюту НЕ конвертируем. Kaspi-чек — это тенге (KZT), а не доллары.
- Сомневаешься, что это чек оплаты, — docType=OTHER, amount=null.
- Ответь ТОЛЬКО JSON, без пояснений: {"docType":"PAYMENT_RECEIPT","amount":0,"currency":"KZT","dateText":null,"payerName":null,"payeeName":null,"bank":null,"exchangeRate":null,"note":""}`;

function buildMediaBlock(media: ReceiptMedia): Anthropic.Messages.ContentBlockParam {
  if (media.mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: media.data },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: media.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data: media.data,
    },
  };
}

export async function parseReceipt(
  client: Anthropic,
  media: ReceiptMedia,
  onUsage?: UsageSink,
): Promise<ParsedReceipt> {
  const startedAt = Date.now();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [buildMediaBlock(media), { type: 'text', text: PROMPT }],
      },
    ],
  });

  reportUsage(onUsage, MODEL, message.usage, startedAt);

  const raw = message.content[0];
  if (!raw || raw.type !== 'text') throw new Error('Unexpected AI response type');

  const jsonMatch = raw.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in AI response');

  const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));

  return {
    docType: parsed.docType,
    amountMinor:
      parsed.amount != null ? BigInt(Math.round(parsed.amount * 100)) : undefined,
    currency: parsed.currency ?? undefined,
    dateText: parsed.dateText ?? undefined,
    payerName: parsed.payerName ?? undefined,
    payeeName: parsed.payeeName ?? undefined,
    bank: parsed.bank ?? undefined,
    exchangeRate: parsed.exchangeRate ?? undefined,
    note: parsed.note ?? undefined,
  };
}
