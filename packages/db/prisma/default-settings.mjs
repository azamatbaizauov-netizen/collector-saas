// Дефолтные бизнес-правила клиента (см. CLAUDE.md → Бизнес-логика).
// Общий источник для seed.mjs (пилот) и onboard-org.mjs (новые клиенты), чтобы
// стартовые настройки не расходились между скриптами. Алдияр согласует значения
// с практикой оптового рынка КЗ; клиент дальше крутит свои через OrganizationSettings.
export const DEFAULT_SETTINGS = {
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
    // Времена по локальной TZ воркера (в проде TZ=Asia/Almaty, docker-compose.prod.yml).
    ratingRecalc: '0 2 * * *',
    dailyCallList: '30 9 * * *', // план дня менеджерам в общий чат в 09:30 (ADR 0004)
    ownerSummary: '0 8 * * *',
    cutoffCoverage: '0 14 * * *', // в 14:00 напоминание-счётчик: кто ещё не написал (ADR 0006)
    finalCoverage: '0 17 * * *', // в 17:00 финал: кто так и не вышел на связь (ADR 0006)
    debtSheetPoll: '0 * * * *', // опрос Google Sheet дебиторки раз в час (ADR 0003)
  },
  templateConfig: {
    generateReminder: 'reminders/v1',
    parseReply: 'conversations/parse-reply/v1',
  },
  whatsappRateLimit: 30,
};

// Расписания воркеров (ScheduleJob) — источник истины по cron на организацию.
// Регистратор воркера превращает активные строки в BullMQ Job Schedulers.
// RATING_RECALC/PROMISE_FOLLOWUP пока заглушки — не бутстрапим, чтобы не гонять
// пустые задачи. DAILY_PLAN/MORNING_DIGEST/DAILY_OVERDUE_CHECK/FINAL_COVERAGE
// шлют в Telegram и деградируют с warn, пока не настроен бот/chat id (ADR 0004/0006).
export async function seedScheduleJobs(prisma, orgId, scheduleConfig) {
  const jobs = [
    { jobType: 'DEBT_SHEET_POLL', cron: scheduleConfig.debtSheetPoll },
    { jobType: 'DAILY_PLAN', cron: scheduleConfig.dailyCallList },
    { jobType: 'MORNING_DIGEST', cron: scheduleConfig.ownerSummary },
    { jobType: 'DAILY_OVERDUE_CHECK', cron: scheduleConfig.cutoffCoverage },
    { jobType: 'FINAL_COVERAGE', cron: scheduleConfig.finalCoverage },
  ];
  for (const j of jobs) {
    await prisma.scheduleJob.upsert({
      where: { organizationId_jobType: { organizationId: orgId, jobType: j.jobType } },
      update: { cronExpression: j.cron, isActive: true },
      create: { organizationId: orgId, jobType: j.jobType, cronExpression: j.cron, isActive: true },
    });
    console.log(`ScheduleJob: ${j.jobType} → ${j.cron}`);
  }
}
