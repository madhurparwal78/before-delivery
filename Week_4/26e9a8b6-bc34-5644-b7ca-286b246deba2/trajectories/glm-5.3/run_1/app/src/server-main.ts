import { readConfig } from './server/config';
import { App } from './server/app';

const app = new App(readConfig());
app.start().catch((error) => {
  console.error('failed to start', error);
  process.exit(1);
});
