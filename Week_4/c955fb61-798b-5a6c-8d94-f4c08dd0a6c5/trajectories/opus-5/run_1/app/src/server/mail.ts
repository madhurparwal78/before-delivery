import { createConnection } from 'node:net';
import { config } from './config.js';
import { query } from './db.js';
import { loadProjectState, scheduleOf } from './repo.js';
import { longDate } from '../shared/dates.js';
import { formatHours } from '../shared/hours.js';

interface Mail {
  toName: string;
  toEmail: string;
  subject: string;
  lines: string[];
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

function sendSmtp(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    let buffer = '';
    const steps: string[] = [
      'EHLO slackwater',
      `MAIL FROM:<${envelopeAddress(config.smtp.from)}>`,
      `RCPT TO:<${mail.toEmail}>`,
      'DATA',
    ];
    let stage = -1;

    const message = [
      `From: ${config.smtp.from}`,
      `To: ${mail.toName} <${mail.toEmail}>`,
      `Subject: ${mail.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      ...mail.lines,
      '',
    ].join('\r\n');

    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let line = buffer.indexOf('\r\n');
      while (line !== -1) {
        const reply = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        line = buffer.indexOf('\r\n');
        if (reply.charAt(3) === '-') continue;
        const code = Number(reply.slice(0, 3));
        if (code >= 400) {
          fail(new Error(`smtp ${reply}`));
          return;
        }
        stage += 1;
        if (stage < steps.length) {
          socket.write(`${steps[stage]}\r\n`);
        } else if (stage === steps.length) {
          socket.write(`${message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
        } else {
          socket.write('QUIT\r\n');
          socket.end();
          resolve();
          return;
        }
      }
    });
  });
}

interface NoticeRow {
  id: string;
  item_id: string;
  user_id: string;
  assigner_name: string;
}

async function sendNotice(notice: NoticeRow): Promise<void> {
  const rows = await query<{
    item_name: string;
    project_id: string;
    project_name: string;
    hours: number;
    to_name: string;
    to_email: string;
  }>(
    `SELECT items.name AS item_name, projects.id AS project_id, projects.name AS project_name,
            assignments.hours, users.name AS to_name, users.email AS to_email
       FROM items
       JOIN projects ON projects.id = items.project_id
       JOIN assignments ON assignments.item_id = items.id AND assignments.user_id = $2
       JOIN users ON users.id = $2
      WHERE items.id = $1`,
    [notice.item_id, notice.user_id],
  );
  const row = rows[0];
  if (!row) {
    await query("UPDATE notices SET state = 'cancelled' WHERE id = $1", [notice.id]);
    return;
  }
  const state = await loadProjectState(row.project_id);
  if (!state) {
    await query("UPDATE notices SET state = 'cancelled' WHERE id = $1", [notice.id]);
    return;
  }
  const schedule = scheduleOf(state);
  const item = schedule.byId.get(notice.item_id)!;

  await sendSmtp({
    toName: row.to_name,
    toEmail: row.to_email,
    subject: `New assignment: ${row.item_name} in ${row.project_name}`,
    lines: [
      `${notice.assigner_name} assigned you to ${row.item_name} in ${row.project_name}.`,
      `Starts: ${longDate(item.start!)}`,
      `Ends: ${longDate(item.end!)}`,
      `Hours a day: ${formatHours(Number(row.hours))}`,
      `Open: ${config.publicUrl}/projects/${row.project_id}?task=${notice.item_id}`,
    ],
  });
  await query("UPDATE notices SET state = 'sent' WHERE id = $1", [notice.id]);
}

async function drainNotices(): Promise<void> {
  const due = await query<NoticeRow>(
    `UPDATE notices SET state = 'sending'
       WHERE id IN (
         SELECT id FROM notices WHERE state = 'queued' AND send_after <= now() FOR UPDATE SKIP LOCKED
       )
     RETURNING id, item_id, user_id, assigner_name`,
  );
  for (const notice of due) {
    try {
      await sendNotice(notice);
    } catch {
      await query("UPDATE notices SET state = 'queued' WHERE id = $1 AND state = 'sending'", [notice.id]);
    }
  }
}

export function startNoticeWorker(): void {
  // A restart leaves nothing half-sent: anything mid-flight goes back on the queue.
  void query("UPDATE notices SET state = 'queued' WHERE state = 'sending'");
  setInterval(() => {
    void drainNotices();
  }, 2000).unref();
}
