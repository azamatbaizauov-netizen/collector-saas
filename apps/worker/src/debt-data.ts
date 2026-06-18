import { prisma } from '@repo/db';
import {
  normalizeDebtRow,
  buildDailyPlan,
  type AliasMap,
  type AliasResolution,
  type DailyPlan,
  type NormalizedDebtRow,
} from '@repo/rules';
import { GoogleSheetDebtSource } from '@repo/debt-source';

// Общий доступ к дебиторке для воркеров (ADR 0003/0004). Лист — технический
// источник: читаем по требованию, нормализуем, НЕ держим вторую копию.

// Алиасы менеджеров из БД (ManagerSheetAlias + Manager.isOwner) → карта матчинга.
export async function loadAliasMap(organizationId: string): Promise<AliasMap> {
  const rows = await prisma.managerSheetAlias.findMany({
    where: { organizationId },
    select: { normalizedAlias: true, managerId: true, manager: { select: { isOwner: true } } },
  });
  const map = new Map<string, AliasResolution>();
  for (const r of rows) {
    map.set(r.normalizedAlias, { managerId: r.managerId, isOwner: r.manager.isOwner });
  }
  return map;
}

// Источник дебиторки из env. null — не сконфигурирован (воркер деградирует с warn).
export function getDebtSource(): GoogleSheetDebtSource | null {
  const credentialsPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  const fileId = process.env['DEBT_SHEET_FILE_ID'];
  if (!credentialsPath || !fileId) return null;
  return new GoogleSheetDebtSource({ credentialsPath, fileId });
}

// Читает лист, нормализует, строит план дня. null — источник не сконфигурирован.
export async function loadDailyPlan(organizationId: string): Promise<DailyPlan | null> {
  const source = getDebtSource();
  if (!source) return null;
  const aliases = await loadAliasMap(organizationId);
  const snapshot = await source.fetchSnapshot();
  const imported: NormalizedDebtRow[] = [];
  for (const row of snapshot.rows) {
    const r = normalizeDebtRow(row, aliases);
    if (r.kind === 'imported') imported.push(r);
  }
  return buildDailyPlan(imported);
}
