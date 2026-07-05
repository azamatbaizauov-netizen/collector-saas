import { prisma } from '@repo/db';
import { InlineKeyboard } from 'grammy';
import type { Logger } from 'pino';
import { getTelegramApi } from '../telegram.js';

const KIND_LABEL: Record<string, string> = {
  PAYMENT: 'погашение (остаток после оплаты)',
  NEW_DEBT: 'новый долг (остаток после отгрузки)',
  UNKNOWN: 'остаток (контекст не ясен)',
};

function formatUsd(minorUnits: bigint): string {
  const dollars = Number(minorUnits) / 100;
  return `$${dollars.toLocaleString('ru-KZ', { maximumFractionDigits: 2 })}`;
}

// Карточка события долга владельцу (ADR 0010, продолжение ADR 0008). Показывает
// заявленный менеджером итоговый остаток и ЧТО было бы записано в лист. В режиме
// сухого прогона лист не трогаем; подтверждение/отклонение обрабатывает apps/bot.
export async function sendDebtEventCard(eventId: string, log: Logger): Promise<void> {
  const event = await prisma.debtBalanceEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: event.organizationId },
    select: { ownerTelegramUserId: true, sheetWriteMode: true, gracePeriodDays: true },
  });
  if (!settings?.ownerTelegramUserId) {
    log.warn(
      { organizationId: event.organizationId, eventId },
      'DebtBalanceEvent: нет ownerTelegramUserId, карточка не отправлена',
    );
    return;
  }

  const api = getTelegramApi();
  if (!api) {
    log.warn({ eventId }, 'DebtBalanceEvent: нет TELEGRAM_BOT_TOKEN, карточка не отправлена');
    return;
  }

  const manager = event.managerId
    ? await prisma.manager.findUnique({ where: { id: event.managerId }, select: { fullName: true } })
    : null;

  const balance = formatUsd(event.statedBalance);
  const kindLabel = KIND_LABEL[event.kind] ?? event.kind;

  const patch =
    event.kind === 'PAYMENT'
      ? `долг (E) = ${balance}, оплата (H) = сегодня, срок (G) = +${settings.gracePeriodDays} дн`
      : `долг (E) = ${balance}`;

  const dryRun = settings.sheetWriteMode === 'DRY_RUN';
  const header = dryRun ? '🧾 Событие долга — внести в лист вручную' : '🧾 Событие долга';
  const action = dryRun
    ? `Внесите в лист вручную: ${patch}.\nКнопка ниже — только отметка, что обработано (запись в лист система пока НЕ делает).`
    : `По подтверждению система запишет в лист: ${patch}.`;

  const lines = [
    header,
    `Менеджер: ${manager?.fullName ?? '—'}`,
    `Должник: ${event.debtorPhone}`,
    `Тип: ${kindLabel}`,
    `Заявленный итоговый остаток: ${balance}`,
    '',
    'Сообщение менеджера:',
    `«${event.rawText}»`,
    '',
    action,
  ];

  const keyboard = new InlineKeyboard()
    .text('✅ Подтвердить', `debtevent_apply:${event.id}`)
    .text('❌ Отклонить', `debtevent_reject:${event.id}`);

  await api.sendMessage(settings.ownerTelegramUserId, lines.join('\n'), { reply_markup: keyboard });

  log.info(
    { organizationId: event.organizationId, eventId, dryRun },
    'DebtBalanceEvent: карточка отправлена владельцу',
  );
}
