import { PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS, seedScheduleJobs } from './default-settings.mjs';

const prisma = new PrismaClient();

// Идентификатор пилотной организации фиксированный, чтобы PILOT_ORGANIZATION_ID
// в .env был детерминированным и не зависел от автогенерации cuid.
const ORG_ID = process.env.PILOT_ORGANIZATION_ID || 'pilot';

// Состав пилота (ADR 0005). id фиксированный и детерминированный, чтобы сид
// был идемпотентным (Manager нельзя upsert'ить по telegramUserId — он null
// до первого /start). normalizedAlias = lower+trim, как делает нормализатор.
// Приставка "<имя> медет" регистрируется как алиас того же менеджера.
//
// telegramUsername — ОЖИДАЕМЫЙ Telegram-ник менеджера (без @, lowercase). По нему
// /start привязывает идентичность (ADR 0004): Telegram подтверждает ник, подделать
// нельзя. ЗАПОЛНИТЬ реальными хендлами перед онбордингом — пока null, /start
// вернёт «аккаунт не найден».
const MANAGERS = [
  { key: 'adilbek', fullName: 'Адилбек', telegramUsername: 'Adilbek_LuxRepublic', aliases: ['адилбек', 'адилбек медет'] },
  { key: 'amir', fullName: 'Амир', telegramUsername: 'Madina_LuxRepublic', aliases: ['амир', 'амир медет'] },
  // Айнур: в дебиторке 74 должника под МОП «айнур», но в системе её не было —
  // строки выпадали из планов. Telegram-ник пока null (уточняем личность),
  // поэтому в группе её план адресуется по имени, а не @-упоминанием.
  { key: 'ainur', fullName: 'Айнур', telegramUsername: null, aliases: ['айнур', 'айнур медет'] },
  { key: 'halima', fullName: 'Халима', telegramUsername: 'khalima_luxRepublic', aliases: ['халима', 'халима медет'] },
  { key: 'savutzhan', fullName: 'Савутжан', telegramUsername: null, aliases: ['савутжан', 'савутжан медет'] },
  { key: 'bibigul', fullName: 'Бибигуль', telegramUsername: null, aliases: ['бибигуль', 'бибигуль медет'] },
  // Владелец: его клиенты (одиночное "Медет" в колонке МОП) не идут в счётчик
  // задач менеджерам, по ним MORNING_DIGEST в личку (ADR 0004/0005).
  { key: 'owner', fullName: 'Медет', isOwner: true, telegramUsername: 'abuimran1990', aliases: ['медет'] },
];

async function seedManagers(orgId) {
  for (const m of MANAGERS) {
    const id = `${orgId}-mgr-${m.key}`;
    const username = m.telegramUsername ? m.telegramUsername.toLowerCase() : null;
    await prisma.manager.upsert({
      where: { id },
      // telegramUsername пишем только если задан, чтобы не затирать вручную
      // выставленный ник; telegramUserId не трогаем — его проставляет /start.
      update: { fullName: m.fullName, isOwner: m.isOwner ?? false, ...(username ? { telegramUsername: username } : {}) },
      create: { id, organizationId: orgId, fullName: m.fullName, isOwner: m.isOwner ?? false, telegramUsername: username },
    });
    for (const normalizedAlias of m.aliases) {
      await prisma.managerSheetAlias.upsert({
        where: { organizationId_normalizedAlias: { organizationId: orgId, normalizedAlias } },
        update: { managerId: id, alias: normalizedAlias },
        create: { organizationId: orgId, managerId: id, alias: normalizedAlias, normalizedAlias },
      });
    }
    console.log(`Manager: ${m.fullName}${m.isOwner ? ' (владелец)' : ''} → [${m.aliases.join(', ')}]`);
  }
}

async function main() {
  // debtSheetFileId переносим из env в БД (ADR 0011): source of truth по листу —
  // теперь Organization, а не env. Фолбэк на env в воркере остаётся, пока прод
  // не пересеян. Пустой env → не затираем уже сохранённый в БД file_id.
  const debtSheetFileId = process.env.DEBT_SHEET_FILE_ID || undefined;
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { ...(debtSheetFileId ? { debtSheetFileId } : {}) },
    create: {
      id: ORG_ID,
      name: process.env.PILOT_ORGANIZATION_NAME || 'Пилотный клиент',
      bitrixPortalId: process.env.B24_PORTAL_ID || `${ORG_ID}.bitrix24.kz`,
      bitrixWebhook: process.env.B24_INCOMING_WEBHOOK || '',
      ...(debtSheetFileId ? { debtSheetFileId } : {}),
    },
  });
  console.log(`Organization: ${org.id} (${org.name})`);

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id, ...DEFAULT_SETTINGS },
  });
  console.log('OrganizationSettings: ok');

  await seedManagers(org.id);

  await seedScheduleJobs(prisma, org.id, DEFAULT_SETTINGS.scheduleConfig);

  // WhatsApp-канал бутстрапится из env, чтобы токен инстанса не попадал в git.
  // Источник истины после seed — таблица WhatsAppChannel.
  const instanceId = process.env.SEED_WA_INSTANCE_ID;
  const instanceToken = process.env.SEED_WA_INSTANCE_TOKEN;
  const phone = process.env.SEED_WA_PHONE;

  if (instanceId && instanceToken && phone) {
    // Привязка номера к менеджеру по ключу из MANAGERS (SEED_WA_MANAGER_KEY).
    const managerKey = process.env.SEED_WA_MANAGER_KEY;
    const managerId = managerKey ? `${org.id}-mgr-${managerKey}` : null;
    const channel = await prisma.whatsAppChannel.upsert({
      where: { organizationId_instanceId: { organizationId: org.id, instanceId } },
      update: { instanceToken, phone, managerId, isActive: true },
      create: {
        organizationId: org.id,
        instanceId,
        instanceToken,
        phone,
        managerId,
        isActive: true,
      },
    });
    console.log(`WhatsAppChannel: ${channel.instanceId} → ${channel.phone}`);
  } else {
    console.log('WhatsAppChannel: пропущен (нет SEED_WA_INSTANCE_ID / SEED_WA_INSTANCE_TOKEN / SEED_WA_PHONE в .env)');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
