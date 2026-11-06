import net from 'node:net';

const listenPort = Number(process.argv[2] ?? 9999);
const targetPort = Number(process.argv[3] ?? 8080);
const targetHost = process.argv[4] ?? 'killbill';

const server = net.createServer((socket) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  socket.on('error', () => upstream.destroy());
  upstream.on('error', () => socket.destroy());
});
server.listen(listenPort, '127.0.0.1', () => {
  console.log(`proxy listening on 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`);
});
