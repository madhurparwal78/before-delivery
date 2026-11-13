// RabbitMQ: the durable intake.measure queue, its dead-letter queue, publishing with confirms and one consumer.
import amqp from "amqplib";
import { config } from "./config.js";
const MEASURE_QUEUE = "intake.measure";
const DEAD_QUEUE = "intake.measure.dead";
let connection = null;
let channel = null;
let connecting = null;
let consumer = null;
function reset() {
    connection = null;
    channel = null;
}
async function open() {
    if (channel)
        return channel;
    connecting ??= (async () => {
        try {
            const conn = await amqp.connect(config.amqpUrl, { timeout: 3_000 });
            conn.on("error", () => undefined);
            conn.on("close", reset);
            const ch = await conn.createConfirmChannel();
            ch.on("error", () => undefined);
            ch.on("close", reset);
            await ch.assertQueue(MEASURE_QUEUE, { durable: true });
            await ch.assertQueue(DEAD_QUEUE, { durable: true });
            connection = conn;
            channel = ch;
            if (consumer)
                await startConsuming(ch, consumer);
            return ch;
        }
        finally {
            connecting = null;
        }
    })();
    return connecting;
}
async function startConsuming(ch, handle) {
    await ch.prefetch(1);
    await ch.consume(MEASURE_QUEUE, (message) => {
        if (!message)
            return;
        let job = null;
        try {
            const parsed = JSON.parse(message.content.toString("utf8"));
            if (parsed && typeof parsed === "object" && typeof parsed.intake_file_id === "string")
                job = parsed;
        }
        catch {
            job = null;
        }
        const delivery = {
            job,
            ack: () => ch.ack(message),
            requeue: () => ch.nack(message, false, true),
            deadLetter: async () => {
                ch.sendToQueue(DEAD_QUEUE, message.content, { persistent: true, contentType: "application/json" });
                await ch.waitForConfirms();
                ch.ack(message);
            },
        };
        handle(delivery).catch(() => delivery.requeue());
    });
}
/** Publishes one persistent job and waits for the broker's confirm; throws when the queue cannot accept it. */
export async function publishMeasurement(job) {
    const ch = await open();
    ch.sendToQueue(MEASURE_QUEUE, Buffer.from(JSON.stringify(job)), { persistent: true, contentType: "application/json" });
    await ch.waitForConfirms();
}
/** Registers the worker and keeps the connection alive, reconnecting on its own. */
export function consumeMeasurements(handle) {
    consumer = handle;
    const tick = () => {
        if (!channel)
            open().catch(() => undefined);
    };
    tick();
    setInterval(tick, 3_000).unref();
}
export async function queueReachable() {
    try {
        await open();
        return connection !== null;
    }
    catch {
        return false;
    }
}
