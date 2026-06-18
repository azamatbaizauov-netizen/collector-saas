import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Идентификатор пилотной организации фиксированный, чтобы PILOT_ORGANIZATION_ID
// в .env был детерминированным и не зависел от автогенерации cuid.
const ORG_ID = process.env.PILOT_ORGANIZATION_ID || 'pilot';

// Дефолтные бизнес-правила пилота (см. CLAUDE.md → Бизнес-логика).
// Алдияр согласует с практикой оптового рынка КЗ перед запуском.
const DEFAULT_SETTINGS = {
  ratingRules: {
    reliable: { periodMonths: 6, maxOverdueDays: 0, minPayments: 5 },
    normal: { maxOverdues: 2, maxOverdueDays: 7 },
    risk: { minOverdues: 3, orOverdueDaysGt: 14 },
    dangerous: { overdueDaysGt: 30, orBrokenPromisesInRow: 2 },
    stop: { overdueDaysGt: 60, orDebtOverLimitMultiplier: 2 },
  },
  limitRules: {
    onTimePaymentsForIncrease: 3,
    increasePct: 20,
    decreaseOnOverduePct: 15,
    zeroOnRatings: ['dangerous', 'stop'],
  },
  reminderTones: {
    soft: [0, 3],
    persistent: [4, 10],
    hard: [11, 30],
    final: [31, null],
  },
  scheduleConfig: {
    ratingRecalc: '0 2 * * *',
    dailyCallList: '0 7 * * *',
    ownerSummary: '0 8 * * *',
    debtSheetPoll: '*/15 * * * *', // опрос Google Sheet дебиторки каждые 15 мин (ADR 0003)
  },
  templateConfig: {
    generateReminder: 'reminders/v1',
    parseReply: 'conversations/parse-reply/v1',
  },
  whatsappRateLimit: 30,
};

// Состав пилота (ADR 0005). id фиксированный и детерминированный, чтобы сид
// был идемпотентным (Manager нельзя upsert'ить по telegramUserId — он null
// до первого /start). normalizedAlias = lower+trim, как делает нормализатор.
// Приставка "<имя> медет" регистрируется как алиас того же менеджера.
const MANAGERS = [
  { key: 'adilbek', fullName: 'Адилбек', aliases: ['адилбек', 'адилбек медет'] },
  { key: 'amir', fullName: 'Амир', aliases: ['амир', 'амир медет'] },
  { key: 'halima', fullName: 'Халима', aliases: ['халима', 'халима медет'] },
  { key: 'savutzhan', fullName: 'Савутжан', aliases: ['савутжан', 'савутжан медет'] },
  { key: 'bibigul', fullName: 'Бибигуль', aliases: ['бибигуль', 'бибигуль медет'] },
  // Владелец: его клиенты (одиночное "Медет" в колонке МОП) не идут в счётчик
  // задач менеджерам, по ним MORNING_DIGEST в личку (ADR 0004/0005).
  { key: 'owner', fullName: 'Медет', isOwner: true, aliases: ['медет'] },
];

async function seedManagers(orgId) {
  for (const m of MANAGERS) {
    const id = `${orgId}-mgr-${m.key}`;
    await prisma.manager.upsert({
      where: { id },
      update: { fullName: m.fullName, isOwner: m.isOwner ?? false },
      create: { id, organizationId: orgId, fullName: m.fullName, isOwner: m.isOwner ?? false },
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

// Расписания воркеров (ScheduleJob) — источник истины по cron на организацию.
// Регистратор воркера превращает активные строки в BullMQ Job Schedulers.
// Пока бутстрапим только DEBT_SHEET_POLL (импорт дебиторки); остальные job-типы
// подключим, когда их обработчики перестанут быть заглушками.
async function seedScheduleJobs(orgId, scheduleConfig) {
  const jobs = [{ jobType: 'DEBT_SHEET_POLL', cron: scheduleConfig.debtSheetPoll }];
  for (const j of jobs) {
    await prisma.scheduleJob.upsert({
      where: { organizationId_jobType: { organizationId: orgId, jobType: j.jobType } },
      update: { cronExpression: j.cron, isActive: true },
      create: { organizationId: orgId, jobType: j.jobType, cronExpression: j.cron, isActive: true },
    });
    console.log(`ScheduleJob: ${j.jobType} → ${j.cron}`);
  }
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: process.env.PILOT_ORGANIZATION_NAME || 'Пилотный клиент',
      bitrixPortalId: process.env.B24_PORTAL_ID || `${ORG_ID}.bitrix24.kz`,
      bitrixWebhook: process.env.B24_INCOMING_WEBHOOK || '',
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

  await seedScheduleJobs(org.id, DEFAULT_SETTINGS.scheduleConfig);

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
