import type { App } from './app';
import type { ConsumeMessage } from 'amqplib';
import { validateGlb, measureGlb, GlbError, MeasurementError } from './glb';
import { needsUnitDecision } from './domain';

/**
 * The measuring worker. A redelivered message for a file already measured
 * is acknowledged without measuring again; a stored object that fails the
 * measurement rules counts as a failure, once per retry, with the second
 * failure moving the message to the dead queue.
 */
export function startMeasuring(app: App): void {
  const handler = async (message: ConsumeMessage): Promise<'ack' | 'retry' | 'dead'> => {
    let payload: { intake_file_id?: string };
    try {
      payload = JSON.parse(message.content.toString()) as { intake_file_id?: string };
    } catch {
      return 'ack';
    }
    const fileId = payload.intake_file_id;
    if (!fileId) {
      return 'ack';
    }
    const file = await app.pool.query(`SELECT * FROM intake_files WHERE id = $1`, [fileId]);
    if (file.rows.length === 0) {
      // A worker that does not find the file in its own database returns the message.
      return 'retry';
    }
    const record = file.rows[0];
    if (record.measurement === 'measured' || record.measurement === 'failed') {
      return 'ack';
    }
    const engagementId = record.engagement_id as string;
    const key = `intake/${engagementId}/${fileId}.glb`;
    const chunks: Buffer[] = [];
    try {
      const stream = await app.storage.getObject(key);
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
    } catch {
      // Storage unreachable: return the message without counting a failure.
      return 'retry';
    }
    const data = Buffer.concat(chunks);
    try {
      const json = validateGlb(data);
      const dims = measureGlb(json);
      const unitNeeded = needsUnitDecision(dims);
      await app.pool.query('BEGIN');
      try {
        await app.pool.query(
          `UPDATE intake_files SET measurement = 'measured',
            dim_m_x = $2, dim_m_y = $3, dim_m_z = $4,
            unit_needed = $5,
            unit = CASE WHEN $5 THEN NULL ELSE 'as_exported' END,
            unit_confirmed = CASE WHEN $5 THEN FALSE ELSE TRUE END
           WHERE id = $1`,
          [fileId, dims.x, dims.y, dims.z, unitNeeded],
        );
        await app.pool.query(
          `INSERT INTO intake_measurements (file_id) VALUES ($1) ON CONFLICT (file_id) DO NOTHING`,
          [fileId],
        );
        await app.pool.query('COMMIT');
      } catch (error) {
        await app.pool.query('ROLLBACK');
        throw error;
      }
      return 'ack';
    } catch (error) {
      if (error instanceof GlbError) {
        // The upload stream validated this file already; treat store/read issues as retry.
        return 'retry';
      }
      if (error instanceof MeasurementError) {
        const failures = Number(record.measure_failures) + 1;
        await app.pool.query(
          `UPDATE intake_files SET measure_failures = $2 WHERE id = $1`,
          [fileId, failures],
        );
        if (failures >= 2) {
          await app.pool.query(
            `UPDATE intake_files SET measurement = 'failed' WHERE id = $1`,
            [fileId],
          );
          await app.queue.publishDead(fileId);
          return 'ack';
        }
        return 'retry';
      }
      return 'retry';
    }
  };
  app.queue.setHandler(handler);
}
