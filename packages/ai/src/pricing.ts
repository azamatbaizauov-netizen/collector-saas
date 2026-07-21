// Оценка стоимости вызова Claude для атрибуции по сценариям (таблица AiAction).
// Считаем в микродолларах (×1_000_000 от USD) — точность без float, как в схеме.
//
// ВНИМАНИЕ: цены — стартовая прикидка, СВЕРИТЬ с Anthropic Console перед выводами
// по счёту. При смене тарифа правим только эту таблицу. input_tokens уже включает
// vision-токены картинки, поэтому чеки (parse-receipt) считаются здесь же без спец-логики.
const PRICE_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costMicrodollars: number;
}

// Колбэк, через который AI-функция отдаёт наверх токены/латентность/стоимость.
// Вызывается сразу после ответа API — до Zod-парсинга, чтобы стоимость
// фиксировалась даже когда разбор ответа падает (деньги уже потрачены).
export type UsageSink = (usage: AiUsage) => void;

export function estimateCostMicrodollars(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICE_PER_MTOK_USD[model];
  if (!price) return 0;
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

// Отдаёт usage в sink (если он передан). Вызывать сразу после client.messages.create.
export function reportUsage(
  onUsage: UsageSink | undefined,
  model: string,
  usage: { input_tokens: number; output_tokens: number } | undefined,
  startedAt: number,
): void {
  if (!onUsage) return;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  onUsage({
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - startedAt,
    costMicrodollars: estimateCostMicrodollars(model, inputTokens, outputTokens),
  });
}
