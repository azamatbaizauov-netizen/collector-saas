import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Повторяемый онбординг WhatsApp-номеров менеджеров (ADR 0005/0006).
// seed.mjs бутстрапит ОДИН канал из SEED_WA_*; этот скрипт подключает СПИСОК
// номеров за один прогон — «доливаем остальных» = дописать строки в файл.
//
// Источник списка — JSON-файл ВНЕ репозитория (токены инстансов — секрет, в git
// не коммитим, по аналогии с GOOGLE_APPLICATION_CREDENTIALS). Путь в WA_CHANNELS_FILE.
//
// Формат файла:
// [
//   { "managerKey": "adilbek", "instanceId": "7700651295",
//     "instanceToken": "xxx", "phone": "77772342652" }
// ]
// managerKey — ключ из MANAGERS в seed.mjs (adilbek|amir|halima|savutzhan|bibigul|owner).

// ORG_ID — generic для любого клиента (ADR 0011); PILOT_ORGANIZATION_ID — фолбэк
// для пилота, чтобы старые команды не сломались.
const ORG_ID = process.env.ORG_ID || process.env.PILOT_ORGANIZATION_ID || 'pilot';
const GREEN_API_URL = process.env.GREEN_API_URL || 'https://api.green-api.com';

const prisma = new PrismaClient();

function loadChannels() {
  const path = process.env.WA_CHANNELS_FILE;
  if (!path) {
    throw new Error('WA_CHANNELS_FILE не задан (путь к JSON-списку каналов вне репозитория)');
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('WA_CHANNELS_FILE: ожидался JSON-массив каналов');
  }
  return parsed;
}

// Проставляет постоянный webhookUrl + секрет инстансу в Green API (шаг setSettings).
// Включается флагом WA_SET_WEBHOOK=1. Адрес: WHATSAPP_WEBHOOK_URL или https://API_DOMAIN/webhook/whatsapp.
async function setInstanceWebhook(instanceId, instanceToken) {
  const webhookUrl =
    process.env.WHATSAPP_WEBHOOK_URL ||
    (process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}/webhook/whatsapp` : null);
  if (!webhookUrl) {
    throw new Error('WA_SET_WEBHOOK=1, но не задан WHATSAPP_WEBHOOK_URL и API_DOMAIN');
  }
  const body = {
    webhookUrl,
    incomingWebhook: 'yes',
    outgoingMessageWebhook: 'yes',
    outgoingAPIMessageWebhook: 'yes',
  };
  const token = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (token) body.webhookUrlToken = token;

  const res = await fetch(`${GREEN_API_URL}/waInstance${instanceId}/setSettings/${instanceToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Green API setSettings ${instanceId}: HTTP ${res.status}`);
  }
  return webhookUrl;
}

async function main() {
  const channels = loadChannels();
  const setWebhook = process.env.WA_SET_WEBHOOK === '1';

  for (const c of channels) {
    const { managerKey, instanceId, instanceToken, phone } = c;
    if (!managerKey || !instanceId || !instanceToken || !phone) {
      console.error(`Пропуск: запись без managerKey/instanceId/instanceToken/phone → ${JSON.stringify(c)}`);
      continue;
    }
    const managerId = `${ORG_ID}-mgr-${managerKey}`;
    const manager = await prisma.manager.findUnique({ where: { id: managerId } });
    if (!manager) {
      console.error(`Пропуск ${instanceId}: менеджер ${managerId} не найден (сначала seed)`);
      continue;
    }

    await prisma.whatsAppChannel.upsert({
      where: { organizationId_instanceId: { organizationId: ORG_ID, instanceId: String(instanceId) } },
      update: { instanceToken, phone: String(phone), managerId, isActive: true },
      create: {
        organizationId: ORG_ID,
        instanceId: String(instanceId),
        instanceToken,
        phone: String(phone),
        managerId,
        isActive: true,
      },
    });

    let webhookNote = '';
    if (setWebhook) {
      const url = await setInstanceWebhook(String(instanceId), instanceToken);
      webhookNote = ` → webhookUrl=${url}`;
    }
    console.log(`WhatsAppChannel: ${instanceId} (${phone}) → ${manager.fullName}${webhookNote}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
