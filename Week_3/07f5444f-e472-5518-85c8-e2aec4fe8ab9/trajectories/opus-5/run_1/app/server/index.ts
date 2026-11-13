import { createServer } from 'node:http';
import { boot } from './boot.js';
import { config } from './config.js';
import { handleApiRequest } from './http/api.js';
import { serveClient } from './http/static-files.js';

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    void handleApiRequest(request, response, url.pathname, url.searchParams);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    request.resume();
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  request.resume();
  void serveClient(url.pathname, response, request.method === 'HEAD');
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Quirewell Stand Desk listening on port ${config.port}\n`);
});

void boot();
