import type Anthropic from '@anthropic-ai/sdk';
import type { ReminderTone } from '@repo/shared';
import { z } from 'zod';

const MODEL = 'claude-sonnet-4-6';

export interface ReminderInput {
  contactName: string;
  overdueDays: number;
  debtAmount: bigint;
  currency: string;
  tone: ReminderTone;
  organizationName: string;
}

const outputSchema = z.object({
  text: z.string().min(10),
});

export async function generateReminder(
  client: Anthropic,
  input: ReminderInput,
): Promise<string> {
  const toneDescriptions: Record<ReminderTone, string> = {
    SOFT: 'мягкое, вежливое напоминание',
    FIRM: 'настойчивое напоминание',
    STRICT: 'жёсткое требование оплаты',
    FINAL: 'финальное предупреждение о передаче долга в юридический отдел',
  };

  const amountFormatted = (Number(input.debtAmount) / 100).toLocaleString('ru-KZ', {
    style: 'currency',
    currency: input.currency,
  });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: `Напиши ${toneDescriptions[input.tone]} должнику по оптовым закупкам.

Данные:
- Клиент: ${input.contactName}
- Просрочка: ${input.overdueDays} дней
- Сумма долга: ${amountFormatted}
- Компания-кредитор: ${input.organizationName}
- Канал: WhatsApp

Требования:
- Только сам текст сообщения, без вводных слов и объяснений
- На русском языке
- До 3 предложений
- Не упоминай штрафы или проценты, если тон SOFT или FIRM

Ответь в JSON: {"text": "текст сообщения"}`,
      },
    ],
  });

  const raw = message.content[0];
  if (!raw || raw.type !== 'text') throw new Error('Unexpected AI response type');

  const jsonMatch = raw.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in AI response');

  const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));
  return parsed.text;
}
