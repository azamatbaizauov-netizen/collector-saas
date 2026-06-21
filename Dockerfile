# Единый образ монорепо: один и тот же build обслуживает api и worker.
# Конкретный сервис выбирается командой в docker-compose.prod.yml.
FROM node:20-bookworm-slim

# Prisma engines требуют openssl; ca-certificates — для исходящих HTTPS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm 9 через corepack (lockfile v9, engines.pnpm >=9).
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Весь репозиторий (node_modules/dist/.env исключены через .dockerignore).
COPY . .

# Прод-VPS общий, ~2 ГБ свободной памяти. Параллельная сборка пакетов через
# tsc упирается в OOM, поэтому ограничиваем кучу Node и собираем пакеты
# по одному (--workspace-concurrency=1).
ENV NODE_OPTIONS=--max-old-space-size=2048

# Установка → генерация Prisma Client → сборка ТОЛЬКО api/worker и их пакетов
# (синтаксис "...": пакет + его workspace-зависимости). Виджет (Next) и бот
# в этот образ не входят — у них своё развёртывание.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @repo/db generate \
  && pnpm --workspace-concurrency=1 --filter "@repo/api..." --filter "@repo/worker..." build

ENV NODE_ENV=production

# Дефолт — api; worker переопределяет command в compose.
CMD ["node", "apps/api/dist/index.js"]
