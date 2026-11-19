import { app, ctx } from './server.ts';
import { startKeepers } from './keep.ts';
import { ensureIdentity } from './boot.ts';

await ensureIdentity(ctx);
startKeepers(ctx);

const server = app.listen(ctx.config.port, '0.0.0.0');
server.keepAliveTimeout = 65_000;
void server;
console.log(`Boltrope listening on ${ctx.config.port}`);
