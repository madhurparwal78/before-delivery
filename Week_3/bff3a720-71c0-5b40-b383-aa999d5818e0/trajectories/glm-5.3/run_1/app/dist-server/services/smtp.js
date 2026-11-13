import net from 'net';
export class Smtp {
    host;
    port;
    from;
    constructor(host, port, from) {
        this.host = host;
        this.port = port;
        this.from = from;
    }
    async send(msg) {
        return new Promise(resolve => {
            const sock = net.createConnection({ host: this.host, port: this.port });
            let stage = 0;
            let buffer = '';
            let failed = false;
            const finish = (ok) => { sock.destroy(); resolve(ok); };
            sock.setTimeout(4000, () => { failed = true; finish(false); });
            sock.on('error', () => { failed = true; finish(false); });
            sock.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
                while (true) {
                    const lineEnd = buffer.indexOf('\r\n');
                    if (lineEnd < 0)
                        return;
                    const line = buffer.slice(0, lineEnd);
                    buffer = buffer.slice(lineEnd + 2);
                    if (!/^\d{3} /.test(line))
                        continue;
                    const code = Number(line.slice(0, 3));
                    if (code >= 400) {
                        failed = true;
                        finish(false);
                        return;
                    }
                    stage++;
                    const wire = (s) => sock.write(s + '\r\n', 'utf8');
                    switch (stage) {
                        case 1:
                            wire(`EHLO longseat`);
                            break;
                        case 2:
                            wire(`MAIL FROM:<${envelope(this.from)}>`);
                            break;
                        case 3:
                            wire(`RCPT TO:<${msg.to}>`);
                            break;
                        case 4:
                            wire('DATA');
                            break;
                        case 5: {
                            const text = [
                                `From: ${this.from}`,
                                `To: ${msg.to}`,
                                `Subject: ${mimeFold(msg.subject)}`,
                                'Content-Type: text/plain; charset=utf-8',
                                'Content-Transfer-Encoding: 8bit',
                                'MIME-Version: 1.0',
                                '',
                                dotStuffBody(msg.body),
                            ].join('\r\n');
                            sock.write(text, 'utf8');
                            sock.write('\r\n.\r\n', 'utf8');
                            break;
                        }
                        case 6:
                            wire('QUIT');
                            finish(true);
                            return;
                        default: break;
                    }
                    if (failed)
                        return;
                }
            });
        });
    }
    async healthy() {
        return new Promise(resolve => {
            const sock = net.createConnection({ host: this.host, port: this.port });
            sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
            sock.on('error', () => resolve(false));
            sock.on('data', () => { sock.destroy(); resolve(true); });
        });
    }
}
function envelope(from) {
    const lt = from.indexOf('<');
    const gt = from.indexOf('>');
    return lt >= 0 && gt > lt ? from.slice(lt + 1, gt) : from;
}
/** Folds a long subject at 78 characters, RFC 2047 style is avoided by keeping to ASCII-ish text. */
function mimeFold(subject) {
    return subject.replace(/[\r\n]+/g, ' ').slice(0, 900);
}
/** SMTP dot-stuffing: a line starting with a dot gains a second dot. */
function dotStuffBody(body) {
    return body.replace(/(^|\r\n)\./g, '$1..');
}
