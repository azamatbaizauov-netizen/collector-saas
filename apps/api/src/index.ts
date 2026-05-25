import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { webhookRoutes } from './routes/webhooks.js';

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    ...(process.env['NODE_ENV'] === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

await app.register(helmet);
await app.register(cors, { origin: false });

app.get('/health', async () => ({ status: 'ok' }));

await app.register(webhookRoutes, { prefix: '/webhook' });

const port = Number(process.env['PORT'] ?? 3001);
const host = process.env['HOST'] ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
