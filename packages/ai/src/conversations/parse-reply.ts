import type Anthropic from '@anthropic-ai/sdk';
import type { ReplyIntent } from '@repo/shared';
import { z } from 'zod';

const MODEL = 'claude-haiku-4-5-20251001';

export interface ParsedReply {
  intent: ReplyIntent;
  promisedDate?: Date | undefined;
  promisedAmount?: bigint | undefined;
  currency?: string | undefined;
}

const outputSchema = z.object({
  intent: z.enum(['PROMISE_TO_PAY', 'PAID', 'DISPUTE', 'REQUEST_DELAY', 'OTHER']),
  promisedDate: z.string().nullish(),
  promisedAmount: z.number().nullish(),
  currency: z.string().nullish(),
});

export async function parseReply(
  client: Anthropic,
  replyText: string,
  contextDate: Date = new Date(),
): Promise<ParsedReply> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: `Сегодня ${contextDate.toLocaleDateString('ru-KZ')}. Проанализируй ответ клиента на напоминание об оплате долга.

Ответ клиента: "${replyText}"

Определи намерение:
- PROMISE_TO_PAY — обещает оплатить в конкретный день
- PAID — говорит что уже оплатил
- DISPUTE — оспаривает сумму или факт долга
- REQUEST_DELAY — просит отсрочку без конкретной даты
- OTHER — всё остальное

Если есть дата платежа — укажи в ISO формате (YYYY-MM-DD).
Если есть сумма — укажи число (без знаков валюты), валюту отдельно.

Ответь только JSON: {"intent": "...", "promisedDate": "...", "promisedAmount": 0, "currency": "KZT"}`,
      },
    ],
  });

  const raw = message.content[0];
  if (!raw || raw.type !== 'text') throw new Error('Unexpected AI response type');

  const jsonMatch = raw.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in AI response');

  const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));

  return {
    intent: parsed.intent,
    promisedDate: parsed.promisedDate ? new Date(parsed.promisedDate) : undefined,
    promisedAmount: parsed.promisedAmount
      ? BigInt(Math.round(parsed.promisedAmount * 100))
      : undefined,
    currency: parsed.currency ?? undefined,
  };
}
