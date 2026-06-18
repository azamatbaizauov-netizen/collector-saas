import { prisma } from '@repo/db';
import { normalizeDebtRow } from '@repo/rules';
import { getDebtSource, loadAliasMap } from '../debt-data.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Опрос Google Sheet дебиторки (ADR 0003). Дёшево опрашиваем version Drive;
// импортируем только когда файл реально менялся. Снапшот — технический буфер
// для нормализации, НЕ вторая копия дебиторки.

export async function processDebtSheetPoll(data: { organizationId: string }): Promise<void> {
  const { organizationId } = data;

  const source = getDebtSource();
  if (!source) {
    log.warn({ organizationId }, 'DEBT_SHEET_POLL: нет GOOGLE_APPLICATION_CREDENTIALS/DEBT_SHEET_FILE_ID, пропуск');
    return;
  }

  const state = await prisma.debtSheetState.findUnique({ where: { organizationId } });
  const meta = await source.getMetadata();
  const now = new Date();

  // version не изменилась — файл не трогали, импорт не нужен.
  if (state && state.lastVersion === meta.version) {
    await prisma.debtSheetState.update({
      where: { organizationId },
      data: { lastPolledAt: now },
    });
    log.info({ organizationId, version: meta.version }, 'DEBT_SHEET_POLL: без изменений');
    return;
  }

  const aliases = await loadAliasMap(organizationId);
  const snapshot = await source.fetchSnapshot();

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  let brokenPhone = 0;
  let currencySuspect = 0;
  const unmatchedRows: { alias: string | null; raw: unknown }[] = [];

  for (const row of snapshot.rows) {
    const r = normalizeDebtRow(row, aliases);
    if (r.kind === 'imported') {
      imported++;
      if (r.currencySuspect) currencySuspect++;
      // TODO: запись касания/долга — после резолва contactId по телефону в Битриксе
      // (см. inbound-message.ts). Пока импорт = нормализация + диагностика.
    } else if (r.kind === 'skipped') {
      skipped++;
    } else if (r.reason === 'unmatched_manager') {
      unmatched++;
      unmatchedRows.push({ alias: r.alias, raw: r.raw });
    } else if (r.reason === 'broken_phone') {
      brokenPhone++;
    }
  }

  // Нераспределённые строки (неизвестный МОП) → AuditLog, чтобы владелец не
  // потерял должника. Съехавший мусор (alias=null) не алертим — пишем для разбора.
  if (unmatchedRows.length > 0) {
    await prisma.auditLog.createMany({
      data: unmatchedRows.map((u) => ({
        organizationId,
        actor: 'system',
        action: 'sheet.unmatched_manager',
        entityType: 'DebtSheet',
        entityId: meta.version,
        after: { alias: u.alias, raw: u.raw } as object,
      })),
    });
  }

  await prisma.debtSheetState.upsert({
    where: { organizationId },
    create: {
      organizationId,
      lastVersion: meta.version,
      lastModifiedTime: meta.modifiedTime,
      lastPolledAt: now,
      lastImportedAt: now,
      lastImported: imported,
      lastSkipped: skipped,
      lastUnmatched: unmatched,
      lastBrokenPhone: brokenPhone,
      lastCurrencySuspect: currencySuspect,
    },
    update: {
      lastVersion: meta.version,
      lastModifiedTime: meta.modifiedTime,
      lastPolledAt: now,
      lastImportedAt: now,
      lastImported: imported,
      lastSkipped: skipped,
      lastUnmatched: unmatched,
      lastBrokenPhone: brokenPhone,
      lastCurrencySuspect: currencySuspect,
    },
  });

  log.info(
    { organizationId, version: meta.version, imported, skipped, unmatched, brokenPhone, currencySuspect },
    'DEBT_SHEET_POLL: импорт завершён',
  );
}
