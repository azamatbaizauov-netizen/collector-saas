import { prisma } from '@repo/db';
import type { AiUsage } from '@repo/ai';
import type { Logger } from 'pino';

// Атрибуция стоимости вызовов Claude по сценариям (таблица AiAction). Цель —
// увидеть, какой сценарий сколько стоит, прежде чем менять провайдера/модель.
// packages/ai сюда не тянет @repo/db: usage прилетает через колбэк onUsage,
// а запись в БД живёт здесь, в воркере.
//
// Промпты сейчас инлайновые (не версионированные файлы) — пишем promptVersion='inline'.

interface AiCostContext {
  scenario: string;
  organizationId: string | null;
  inputSummary: string;
  log: Logger;
}

// Оборачивает вызов AI-функции: прокидывает onUsage внутрь, после чего пишет
// AiAction (и на успехе, и на ошибке разбора — деньги уже потрачены). Ошибку
// не глотает: пробрасывает дальше, вызывающий решает, что с ней делать.
export async function withAiCost<T>(
  ctx: AiCostContext,
  run: (onUsage: (usage: AiUsage) => void) => Promise<T>,
  outputSummary?: (result: T) => string,
): Promise<T> {
  let usage: AiUsage | undefined;
  try {
    const result = await run((u) => {
      usage = u;
    });
    await record(ctx, usage, true, undefined, outputSummary?.(result));
    return result;
  } catch (err) {
    await record(ctx, usage, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function record(
  ctx: AiCostContext,
  usage: AiUsage | undefined,
  success: boolean,
  errorMessage?: string,
  outputSummary?: string,
): Promise<void> {
  // Без usage писать нечего (вызов не дошёл до API) — только логируем ошибку.
  if (!usage) {
    if (!success) ctx.log.warn({ scenario: ctx.scenario, errorMessage }, 'AI-вызов упал до ответа API');
    return;
  }
  try {
    await prisma.aiAction.create({
      data: {
        organizationId: ctx.organizationId,
        scenario: ctx.scenario,
        promptVersion: 'inline',
        model: usage.model,
        inputSummary: ctx.inputSummary,
        outputSummary: outputSummary ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: usage.latencyMs,
        costMicrodollars: usage.costMicrodollars,
        success,
        errorMessage: errorMessage ?? null,
      },
    });
  } catch (err) {
    // Логирование стоимости не должно ронять основной пайплайн.
    ctx.log.error({ scenario: ctx.scenario, err }, 'Не удалось записать AiAction');
  }
}
