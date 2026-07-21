import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { reportUsage, type UsageSink } from '../pricing.js';

const MODEL = 'claude-haiku-4-5-20251001';

export type DebtEventKind = 'PAYMENT' | 'NEW_DEBT' | 'UNKNOWN';

export interface ExtractedBalance {
  hasBalance: boolean;
  balanceUsd?: bigint | undefined;
  kind: DebtEventKind;
}

const outputSchema = z.object({
  hasBalance: z.boolean(),
  balanceUsd: z.number().nullish(),
  kind: z.enum(['PAYMENT', 'NEW_DEBT', 'UNKNOWN']).nullish(),
});

export async function extractDebtBalance(
  client: Anthropic,
  messageText: string,
  onUsage?: UsageSink,
): Promise<ExtractedBalance> {
  const startedAt = Date.now();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: `Проанализируй ИСХОДЯЩЕЕ сообщение менеджера клиенту. По регламенту менеджер фиксирует итоговый остаток долга клиента в ДОЛЛАРАХ — всегда абсолютное число (результирующий остаток после погашения или после новой отгрузки в долг), а не «минус столько-то».

Сообщение менеджера: "${messageText}"

Определи:
- hasBalance — есть ли в сообщении явно названный итоговый остаток долга. Если менеджер просто напоминает/спрашивает/торгуется без названной суммы остатка — false.
- balanceUsd — итоговый остаток в долларах (число, без знака валюты). null при hasBalance=false.
- kind:
  - PAYMENT — остаток назван после оплаты/погашения («оплатили X, остаток Y»)
  - NEW_DEBT — остаток после новой отгрузки в долг («взяли на X, теперь долг Y»)
  - UNKNOWN — остаток назван, но контекст не ясен

Правила:
- Только доллары. Если сумма явно в тенге/другой валюте — hasBalance=false (валюту не конвертируем).
- Консервативно: сомневаешься, что это именно итоговый остаток, — hasBalance=false.
- Обещания клиента, суммы платежей без остатка, «должны столько-то за конкретный товар» без итога — не остаток.

Ответь только JSON: {"hasBalance": true, "balanceUsd": 0, "kind": "PAYMENT"}`,
      },
    ],
  });

  reportUsage(onUsage, MODEL, message.usage, startedAt);

  const raw = message.content[0];
  if (!raw || raw.type !== 'text') throw new Error('Unexpected AI response type');

  const jsonMatch = raw.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in AI response');

  const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));

  if (!parsed.hasBalance || parsed.balanceUsd == null) {
    return { hasBalance: false, kind: 'UNKNOWN' };
  }

  return {
    hasBalance: true,
    balanceUsd: BigInt(Math.round(parsed.balanceUsd * 100)),
    kind: parsed.kind ?? 'UNKNOWN',
  };
}
