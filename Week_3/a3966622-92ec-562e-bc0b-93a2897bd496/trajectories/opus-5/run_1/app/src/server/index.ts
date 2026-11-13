import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { startHttpServer } from './http.ts';
import { buildRoutes } from './routes.ts';

const app = createApp();
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));

app.services.start();
app.steps.start();
startHttpServer(app, buildRoutes(app), webRoot);
