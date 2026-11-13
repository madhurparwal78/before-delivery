import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { config } from '../config.js';

export const MEASURE_QUEUE = 'intake.measure';
export const MEASURE_DEAD_QUEUE = 'intake.measure.dead';

export type MeasureMessage = { intake_file_id: string };

type Connection = { model: ChannelModel; channel: Channel };

let connecting: Promise<Connection> | null = null;
let current: Connection | null = null;

const connect = async (): Promise<Connection> => {
  if (current !== null) return current;
  if (connecting === null) {
    connecting = (async () => {
      const model = await amqplib.connect(config.amqpUrl);
      model.on('error', () => undefined);
      model.on('close', () => {
        if (current?.model === model) current = null;
        connecting = null;
      });
      const channel = await model.createChannel();
      channel.on('error', () => undefined);
      await channel.assertQueue(MEASURE_QUEUE, { durable: true });
      await channel.assertQueue(MEASURE_DEAD_QUEUE, { durable: true });
      const established = { model, channel };
      current = established;
      return established;
    })().catch((error: unknown) => {
      connecting = null;
      current = null;
      throw error;
    });
  }
  return connecting;
};

export const measuringUp = async (): Promise<boolean> => {
  try {
    await connect();
    return true;
  } catch {
    return false;
  }
};

export const publishMeasureJob = async (intakeFileId: string): Promise<void> => {
  const { channel } = await connect();
  channel.sendToQueue(
    MEASURE_QUEUE,
    Buffer.from(JSON.stringify({ intake_file_id: intakeFileId } satisfies MeasureMessage)),
    { persistent: true },
  );
};

export const publishToDeadQueue = async (content: Buffer): Promise<void> => {
  const { channel } = await connect();
  channel.sendToQueue(MEASURE_DEAD_QUEUE, content, { persistent: true });
};

export type Consumer = {
  handle: (message: ConsumeMessage) => Promise<'ack' | 'requeue'>;
};

let attaching = false;
let attachedTo: ChannelModel | null = null;

export const startMeasureConsumer = (consumer: Consumer): void => {
  const attach = async (): Promise<void> => {
    const { model, channel } = await connect();
    await channel.prefetch(4);
    await channel.consume(
      MEASURE_QUEUE,
      (message) => {
        if (message === null) return;
        void consumer
          .handle(message)
          .then(async (outcome) => {
            if (outcome === 'ack') {
              channel.ack(message);
              return;
            }
            // A message this instance cannot handle goes back after a pause, so a job that
            // belongs to another instance never starves the queue.
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            channel.nack(message, false, true);
          })
          .catch(() => {
            try {
              channel.nack(message, false, true);
            } catch {
              /* the channel went away; the broker redelivers */
            }
          });
      },
      { noAck: false },
    );
    attachedTo = model;
  };

  const ensureAttached = (): void => {
    if (attaching || (current !== null && attachedTo === current.model)) return;
    attaching = true;
    attach()
      .catch(() => undefined)
      .finally(() => {
        attaching = false;
      });
  };

  ensureAttached();
  setInterval(ensureAttached, 5_000).unref();
};
