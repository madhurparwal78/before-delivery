// Dev SMTP sink: accepts messages on a port and prints one line per message.
import net from 'node:net';

const port = Number(process.argv[2] ?? 5590);
const server = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  socket.write('220 sink ready\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    let index;
    while ((index = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('250 ok\r\n');
        }
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO') || cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) {
        socket.write('250 ok\r\n');
      } else if (cmd.startsWith('DATA')) {
        inData = true;
        socket.write('354 go\r\n');
      } else if (cmd.startsWith('QUIT')) {
        socket.write('221 bye\r\n');
        socket.end();
      } else if (cmd.startsWith('NOOP')) {
        socket.write('250 ok\r\n');
      }
    }
  });
});

server.listen(port, '127.0.0.1', () => console.log(`smtp sink on ${port}`));
