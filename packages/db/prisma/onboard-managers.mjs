import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Онбординг состава МОП для клиента (ADR 0011). Замена захардкоженного MANAGERS
// из seed.mjs для НЕ-пилотных организаций: список менеджеров у каждого клиента
// свой. Создаёт Manager + ManagerSheetAlias, идемпотентно (upsert по id).
//
// Источник — JSON-файл ВНЕ репозитория (состав клиента не коммитим). Путь в
// MANAGERS_FILE, организация в ORG_ID.
//
// Формат файла:
// [
//   { "key": "adilbek", "fullName": "Адилбек", "telegramUsername": "adilbek_wa",
//     "aliases": ["адилбек", "адилбек медет"] },
//   { "key": "owner", "fullName": "Медет", "isOwner": true,
//     "telegramUsername": "medet", "aliases": ["медет"] }
// ]
// key — стабильный идентификатор менеджера (managerId = `${ORG_ID}-mgr-${key}`),
//       по нему onboard-channels.mjs привязывает WhatsApp-номер.
// aliases — как МОП записан в колонке листа; матчинг по нормализованному виду
//       (trim + lowercase), как делает нормализатор дебиторки.

const prisma = new PrismaClient();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} не задан`);
  return v;
}

function loadRoster() {
  const path = requireEnv('MANAGERS_FILE');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('MANAGERS_FILE: ожидался JSON-массив менеджеров');
  }
  return parsed;
}

async function main() {
  const orgId = requireEnv('ORG_ID');
  const roster = loadRoster();

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    throw new Error(`Организация ${orgId} не найдена — сначала onboard-org.mjs`);
  }

  for (const m of roster) {
    if (!m.key || !m.fullName || !Array.isArray(m.aliases) || m.aliases.length === 0) {
      console.error(`Пропуск: запись без key/fullName/aliases → ${JSON.stringify(m)}`);
      continue;
    }
    const id = `${orgId}-mgr-${m.key}`;
    const username = m.telegramUsername ? String(m.telegramUsername).toLowerCase() : null;
    await prisma.manager.upsert({
      where: { id },
      // telegramUserId не трогаем — его проставляет /start бота; username пишем
      // только если задан, чтобы не затирать вручную выставленный ник.
      update: { fullName: m.fullName, isOwner: m.isOwner ?? false, ...(username ? { telegramUsername: username } : {}) },
      create: { id, organizationId: orgId, fullName: m.fullName, isOwner: m.isOwner ?? false, telegramUsername: username },
    });

    for (const raw of m.aliases) {
      const normalizedAlias = String(raw).trim().toLowerCase();
      await prisma.managerSheetAlias.upsert({
        where: { organizationId_normalizedAlias: { organizationId: orgId, normalizedAlias } },
        update: { managerId: id, alias: String(raw) },
        create: { organizationId: orgId, managerId: id, alias: String(raw), normalizedAlias },
      });
    }
    console.log(`Manager: ${m.fullName}${m.isOwner ? ' (владелец)' : ''} → [${m.aliases.join(', ')}]`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
