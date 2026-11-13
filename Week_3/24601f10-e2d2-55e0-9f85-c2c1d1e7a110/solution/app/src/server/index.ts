import { createServer } from 'node:http';
import { config } from './config.js';
import { startDeadlineLoop } from './deadlines.js';
import { connectWithRetry } from './db.js';
import { handle } from './http.js';
import { startHeartbeat, startListening } from './live.js';
import { registerCheckin } from './routes/checkin.js';
import { registerEntrants } from './routes/entrants.js';
import { registerFiles } from './routes/files.js';
import { registerGrading } from './routes/grading.js';
import { registerMatches } from './routes/matches.js';
import { registerMisc } from './routes/misc.js';
import { registerShare } from './routes/share.js';
import { handleUpgrade } from './routes/socket.js';
import { registerTournaments } from './routes/tournaments.js';

registerMisc();
registerTournaments();
registerEntrants();
registerCheckin();
registerMatches();
registerFiles();
registerShare();
if (config.grading) registerGrading();

const server = createServer((req, res) => { void handle(req, res); });
server.on('upgrade', (req, socket, head) => { void handleUpgrade(req, socket, head); });

// Listen first: until Postgres answers, health reports 503 {"status":"starting"}.
server.listen(config.port, '0.0.0.0', () => console.log(`Cupfold listening on ${config.port}`));

void connectWithRetry().then(() => {
  startListening();
  startHeartbeat();
  startDeadlineLoop();
});
