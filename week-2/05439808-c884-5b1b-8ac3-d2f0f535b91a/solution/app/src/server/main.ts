// Saltreach server entry: serves at once, then reaches PostgreSQL and Mailpit in the background.
import { createServer } from 'node:http';
import './accounts';
import { clanGate } from './clans';
import { config } from './config';
import { watchDatabase } from './db';
import { streamEvents } from './events';
import { handle, setEventStream, setGates } from './http';
import { startMailSender } from './mail';
import './ops';
import './raids';
import './rewards';
import { prepareDatabase } from './seed';
import { throttle } from './throttle';
import './village';

setGates({ clan: clanGate, throttle });
setEventStream(streamEvents);

const server = createServer((req, res) => {
  void handle(req, res);
});
server.keepAliveTimeout = 65000;
server.listen(config.port, '0.0.0.0', () => {
  console.log(`saltreach serving on 0.0.0.0:${config.port}`);
});

watchDatabase(prepareDatabase);
startMailSender();
