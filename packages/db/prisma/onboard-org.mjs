import { PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS, seedScheduleJobs } from './default-settings.mjs';

// Онбординг НОВОГО клиента (ADR 0011). Заводит организацию + дефолтные настройки
// + расписания воркеров, БЕЗ пилот-специфичных менеджеров (их подключает
// onboard-managers.mjs) и БЕЗ WhatsApp-номеров (onboard-channels.mjs).
//
// seed.mjs остаётся сидом пилота с захардкоженным составом; этот скрипт —
// параметризованный, всё из env, ничего про конкретного клиента в коде.
//
// Обязательные env: ORG_ID (детерминированный id, чтобы downstream-скрипты
// ссылались на клиента), ORG_NAME.
// Опциональные: ORG_DEBT_SHEET_FILE_ID (file_id листа дебиторки в Drive),
// ORG_TELEGRAM_CHAT_ID (общий чат), ORG_OWNER_TELEGRAM_USER_ID (личка владельца).
//
// Запуск (переменные инлайном, чтобы не спутать с пилотным .env):
//   ORG_ID=client2 ORG_NAME="ТОО Ромашка" ORG_DEBT_SHEET_FILE_ID=1AbC... \
//   ORG_TELEGRAM_CHAT_ID=-100123 ORG_OWNER_TELEGRAM_USER_ID=456 \
//   pnpm --filter @repo/db onboard:org

const prisma = new PrismaClient();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} не задан (обязательный параметр онбординга)`);
  return v;
}

async function main() {
  const orgId = requireEnv('ORG_ID');
  const name = requireEnv('ORG_NAME');
  const debtSheetFileId = process.env.ORG_DEBT_SHEET_FILE_ID || undefined;
  const telegramGroupChatId = process.env.ORG_TELEGRAM_CHAT_ID || undefined;
  const ownerTelegramUserId = process.env.ORG_OWNER_TELEGRAM_USER_ID || undefined;

  // bitrixPortalId обязателен и @unique (наследие Битрикса, ADR 0009 — к чистке).
  // Пока генерируем синтетическое значение из orgId, чтобы не блокировать онбординг.
  const org = await prisma.organization.upsert({
    where: { id: orgId },
    update: {
      name,
      ...(debtSheetFileId ? { debtSheetFileId } : {}),
    },
    create: {
      id: orgId,
      name,
      bitrixPortalId: `${orgId}.noop.local`,
      bitrixWebhook: '',
      ...(debtSheetFileId ? { debtSheetFileId } : {}),
    },
  });
  console.log(`Organization: ${org.id} (${org.name})`);
  console.log(`  debtSheetFileId: ${org.debtSheetFileId ?? '— (не задан, воркер деградирует с warn)'}`);

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {
      ...(telegramGroupChatId ? { telegramGroupChatId } : {}),
      ...(ownerTelegramUserId ? { ownerTelegramUserId } : {}),
    },
    create: {
      organizationId: org.id,
      ...DEFAULT_SETTINGS,
      ...(telegramGroupChatId ? { telegramGroupChatId } : {}),
      ...(ownerTelegramUserId ? { ownerTelegramUserId } : {}),
    },
  });
  console.log('OrganizationSettings: ok');
  console.log(`  telegramGroupChatId: ${telegramGroupChatId ?? '— (задать позже через /chatid)'}`);

  await seedScheduleJobs(prisma, org.id, DEFAULT_SETTINGS.scheduleConfig);

  console.log('\nГотово. Дальше: onboard-managers.mjs (состав МОП) → onboard-channels.mjs (WhatsApp-номера).');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
