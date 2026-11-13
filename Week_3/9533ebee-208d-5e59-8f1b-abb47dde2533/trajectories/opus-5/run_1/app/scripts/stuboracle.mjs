// A controllable stand-in for the price oracle, used to drive a server
// instance through every reading outcome during development.
//
//   GET  /feeds/<ASSET>-USD/latest   the current stub for that asset
//   POST /control                    {asset, status?, body?, delayMs?}
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);
/** asset -> { status, body, delayMs } */
const stubs = new Map();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://stub.invalid');

  if (request.method === 'POST' && url.pathname === '/control') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (command.clear === true) stubs.clear();
      else stubs.set(command.asset, command);
      response.writeHead(204).end();
    });
    return;
  }

  const match = /^\/feeds\/([A-Z]+)-USD\/latest$/.exec(url.pathname);
  if (match === null) {
    response.writeHead(404).end();
    return;
  }
  const stub = stubs.get(match[1]);
  if (stub === undefined) {
    response.writeHead(503).end();
    return;
  }
  const send = () => {
    response.writeHead(stub.status ?? 200, { 'content-type': 'application/json' });
    response.end(typeof stub.body === 'string' ? stub.body : JSON.stringify(stub.body));
  };
  if (stub.delayMs !== undefined) setTimeout(send, stub.delayMs);
  else send();
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`stub oracle on 127.0.0.1:${port}\n`);
});
