import { startServer } from './serve.js';
startServer().catch(err => {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'boot_failed', error: String(err) }) + '\n');
    process.exit(1);
});
