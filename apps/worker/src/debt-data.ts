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

// Источник дебиторки per-org (ADR 0011). file_id берём из Organization в БД —
// у каждого клиента свой лист. Пилот исторически жил на env DEBT_SHEET_FILE_ID:
// оставляем фолбэк, чтобы прод не упал, пока debtSheetFileId не проставлен в БД
// (seed.mjs записывает его при онбординге). Креды сервисного аккаунта — общие, из
// env. null — источник не сконфигурирован (воркер деградирует с warn).
export async function getDebtSourceForOrg(
  organizationId: string,
): Promise<GoogleSheetDebtSource | null> {
  const credentialsPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (!credentialsPath) return null;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { debtSheetFileId: true },
  });
  const fileId = org?.debtSheetFileId ?? process.env['DEBT_SHEET_FILE_ID'];
  if (!fileId) return null;
  return new GoogleSheetDebtSource({ credentialsPath, fileId });
}

// Читает лист, нормализует, строит план дня. null — источник не сконфигурирован.
export async function loadDailyPlan(organizationId: string): Promise<DailyPlan | null> {
  const source = await getDebtSourceForOrg(organizationId);
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
