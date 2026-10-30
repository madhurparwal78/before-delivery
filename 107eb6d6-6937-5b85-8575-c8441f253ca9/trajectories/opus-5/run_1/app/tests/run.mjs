import { resetDatabase, summary } from './harness.mjs';
import { runApiTests } from './api.test.mjs';
import { runPageTests } from './pages.test.mjs';

await resetDatabase();
await runApiTests();
await resetDatabase();
await runPageTests();

process.exit(summary() ? 0 : 1);
