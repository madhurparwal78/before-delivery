import { config, businessClock } from './config.js';
import { query, withTransaction } from './db.js';
import { getOrder, OrderRow } from './orders.js';
import * as store from './storage.js';
import * as mail from './mail.js';
import * as svix from './webhooks.js';
import * as bus from './bus.js';
import * as gw from './gateway.js';
import { formatOre } from '../shared/money.js';
import { pushAlert } from './alerts.js';

/** Effects happen once per event, however often the event is delivered.
 * Each effect records its completion in Postgres. */
export interface EffectState {
  certificate: boolean;
  receipt: boolean;
  giftNotice: boolean;
  webhook: boolean;
  courier: boolean;
}

async function loadEffects(reference: string, type: string): Promise<EffectState> {
  const rows = await query<{ effects: string }>(
    'SELECT effects FROM event_effects WHERE reference = $1 AND type = $2',
    [reference, type],
  );
  if (rows.length === 0) return { certificate: false, receipt: false, giftNotice: false, webhook: false, courier: false };
  return JSON.parse(rows[0].effects) as EffectState;
}

async function saveEffects(reference: string, type: string, effects: EffectState): Promise<void> {
  await query(
    `INSERT INTO event_effects (reference, type, effects) VALUES ($1,$2,$3)
     ON CONFLICT (reference, type) DO UPDATE SET effects = EXCLUDED.effects`,
    [reference, type, JSON.stringify(effects)],
  );
}

/** Render the certificate HTML and turn it into a real PDF with a text layer. */
async function renderCertificatePdf(order: OrderRow, artBytes: Buffer | null, artType: string | null): Promise<Buffer> {
  const charityDkk = formatOre(order.charity_ore);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #10202e; }
    h1 { font-size: 26pt; letter-spacing: 0.06em; margin-bottom: 2mm; }
    h2 { font-size: 13pt; font-weight: normal; color: #4a5b66; margin-top: 0; }
    .rule { border-top: 0.4pt solid #9fb0ba; margin: 8mm 0; }
    .line { font-size: 12.5pt; line-height: 1.7; }
    .art { max-width: 120mm; max-height: 90mm; margin-top: 10mm; }
    .sign { margin-top: 14mm; font-size: 11pt; color: #33454f; }
  </style></head><body>
  <h1>Svovlstik Press</h1>
  <h2>The Last Bundle</h2>
  <div class="rule"></div>
  <p class="line">Box ${order.number} of 240</p>
  <p class="line">Plate: ${order.plate}</p>
  <p class="line">Order ${order.reference}</p>
  <p class="line">Charity share of this box: DKK ${charityDkk}</p>
  ${artBytes ? `<img class="art" src="data:${artType};base64,${artBytes.toString('base64')}">` : ''}
  <div class="rule"></div>
  <p class="sign">Varmestuen Nord receives the charity share of every box.</p>
  </body></html>`;
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`pdf render failed ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function issueCertificate(order: OrderRow): Promise<void> {
  if (order.certificate_state === 'issued') return;
  let artBytes: Buffer | null = null;
  let artType: string | null = null;
  const rows = await query<{ object_key: string; content_type: string }>(
    'SELECT object_key, content_type FROM plate_art WHERE plate = $1 ORDER BY uploaded_at DESC LIMIT 1',
    [order.plate],
  );
  if (rows.length > 0) {
    const obj = await store.getObject(rows[0].object_key);
    if (obj) { artBytes = obj.body; artType = obj.contentType ?? rows[0].content_type; }
  }
  const pdf = await renderCertificatePdf(order, artBytes, artType);
  const key = `certificates/${order.reference}.pdf`;
  await store.putObject(key, pdf, 'application/pdf');
  await query(
    "UPDATE orders SET certificate_state = 'issued', certificate_key = $1 WHERE reference = $2",
    [key, order.reference],
  );
}

async function sendReceipt(order: OrderRow): Promise<void> {
  const link = `${config.appPublicUrl}/order/${order.reference}?token=${order.order_token}`;
  const text = [
    `Your receipt for box ${order.number} (${order.reference})`,
    '',
    `Total: DKK ${formatOre(order.total_ore)}`,
    `VAT: DKK ${formatOre(order.vat_ore)}`,
    `Courier: DKK ${formatOre(order.courier_ore)}`,
    `Charity share: DKK ${formatOre(order.charity_ore)}`,
    '',
    link,
  ].join('\n');
  await mail.sendMail(order.buyer_email, `Your receipt for box ${order.number} (${order.reference})`, text);
}

async function sendGiftNotice(order: OrderRow): Promise<void> {
  if (!order.gift_recipient_email) return;
  const text = [
    `Dear ${order.gift_recipient_name},`,
    '',
    `A numbered box is on its way to you.`,
    `Box ${order.number} of 240.`,
    `Plate: ${order.plate}.`,
    order.gift_message ? `\n"${order.gift_message}"` : '',
    '',
    'Svovlstik Press',
  ].join('\n');
  await mail.sendMail(order.gift_recipient_email, 'A numbered box is on its way to you', text);
}

async function sendOrderPaidWebhook(order: OrderRow): Promise<void> {
  const payload = {
    eventId: `evt-${order.reference}-paid`,
    reference: order.reference,
    boxNumber: order.number,
    plate: order.plate,
    grossOre: order.gross_ore,
    netOre: order.net_ore,
    vatOre: order.vat_ore,
    charityOre: order.charity_ore,
    makerOre: order.maker_ore,
    rateBasisPoints: order.rate_bps,
    paidAt: (order.paid_at ?? businessClock.now()).toISOString(),
  };
  await svix.sendMessage(`evt-${order.reference}-paid`, 'order.paid', payload);
}

export async function recordPendingEvent(eventId: string, type: bus.EventType, reference: string, boxNumber: number, occurredAt: Date): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO pending_events (event_id, type, reference, box_number, occurred_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, type, reference, boxNumber, occurredAt.toISOString()],
    );
  });
  await publishPending();
}

/** Publish any pending events that the broker missed. */
export async function publishPending(): Promise<void> {
  const rows = await query<{ event_id: string; type: string; reference: string; box_number: number; occurred_at: Date }>(
    'SELECT event_id, type, reference, box_number, occurred_at FROM pending_events WHERE published = FALSE',
  );
  for (const row of rows) {
    const ok = await bus.publish({
      eventId: row.event_id,
      type: row.type as bus.EventType,
      reference: row.reference,
      boxNumber: row.box_number,
      occurredAt: new Date(row.occurred_at).toISOString(),
    });
    if (ok) {
      await query('UPDATE pending_events SET published = TRUE WHERE event_id = $1', [row.event_id]);
    }
  }
}

/** Deliver one fulfilment event; failures throw so the bus retries. */
export async function deliverEvent(msg: bus.EventMessage): Promise<void> {
  const order = await getOrder(msg.reference);
  if (!order) throw new Error('order missing');
  const effects = await loadEffects(msg.reference, msg.type);

  if (msg.type === 'order.paid') {
    if (!effects.certificate) {
      await issueCertificate(order);
      effects.certificate = true;
      await saveEffects(msg.reference, msg.type, effects);
    }
    if (!effects.receipt) {
      await sendReceipt(order);
      effects.receipt = true;
      await saveEffects(msg.reference, msg.type, effects);
    }
    if (!effects.giftNotice && order.gift_recipient_email) {
      await sendGiftNotice(order);
      effects.giftNotice = true;
      await saveEffects(msg.reference, msg.type, effects);
    }
    if (!effects.webhook) {
      await sendOrderPaidWebhook(order);
      effects.webhook = true;
      await saveEffects(msg.reference, msg.type, effects);
    }
  } else if (msg.type === 'box.packed') {
    if (!effects.courier) {
      const booking = await gw.bookCourier({
        reference: order.reference,
        boxNumber: order.number,
        recipientName: order.gift_recipient_name ?? order.buyer_name,
        address: {
          street: order.address_street,
          postcode: order.address_postcode,
          city: order.address_city,
        },
      }, `courier-${order.reference}`);
      await query('UPDATE orders SET tracking_code = $1, box_state = $2 WHERE reference = $3', [booking.trackingCode, 'shipped', order.reference]);
      const moved = await query("UPDATE boxes SET box_state = 'shipped' WHERE number = $1 AND box_state = 'packed' RETURNING box_state", [order.number]);
      void moved;
      effects.courier = true;
      await saveEffects(msg.reference, msg.type, effects);
    }
  }
}

/** Send an alert, keeping it in Postgres when ntfy is down. */
export async function alert(title: string, body: string): Promise<void> {
  await query('INSERT INTO pending_alerts (title, body) VALUES ($1,$2)', [title, body]);
  await flushAlerts();
}

export async function flushAlerts(): Promise<void> {
  const rows = await query<{ id: number; title: string; body: string }>('SELECT id, title, body FROM pending_alerts ORDER BY id');
  for (const row of rows) {
    try {
      await pushAlert(row.title, row.body);
      await query('DELETE FROM pending_alerts WHERE id = $1', [row.id]);
    } catch {
      return;
    }
  }
}
