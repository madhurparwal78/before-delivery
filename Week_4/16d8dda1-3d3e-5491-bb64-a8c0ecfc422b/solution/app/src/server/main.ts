import { createServer } from 'node:http';
import { config } from './config';
import { ensureSchema } from './db';
import { dispatch, type Route } from './http';
import { startTicker } from './live/due';
import { handleUpgrade, startHub } from './live/hub';
import { accountRoutes } from './routes/accounts';
import { afterRoutes } from './routes/after';
import { chatRoutes } from './routes/chat';
import { classRoutes } from './routes/classes';
import { gradingRoutes } from './routes/grading';
import { healthRoutes } from './routes/health';
import { joinRoutes } from './routes/join';
import { lessonRoutes } from './routes/lessons';
import { pollRoutes } from './routes/polls';
import { sessionRoutes } from './routes/sessions';

process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));
process.on('uncaughtException', (error) => console.error('uncaught exception', error));

const routes: Route[] = [
  ...healthRoutes,
  ...accountRoutes,
  ...classRoutes,
  ...lessonRoutes,
  ...sessionRoutes,
  ...joinRoutes,
  ...pollRoutes,
  ...chatRoutes,
  ...afterRoutes,
  ...gradingRoutes,
];

async function boot(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await ensureSchema();
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const server = createServer((req, res) => {
    void dispatch(routes, req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });
  startHub();
  startTicker();
  server.listen(config.port, '0.0.0.0');
}

boot().catch((error: unknown) => {
  console.error('could not start', error);
  process.exit(1);
});
