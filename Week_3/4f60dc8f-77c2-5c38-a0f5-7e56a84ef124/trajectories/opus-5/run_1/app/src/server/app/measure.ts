import {
  RANGE_MAX_METRES,
  RANGE_MIN_METRES,
  type UnitDecision,
} from '../../shared/domain.js';
import {
  delayedMeasurementFiles,
  findIntakeFile,
  markMeasurementFailed,
  recordMeasurement,
  recordMeasurementFailure,
  setMeasurementState,
  type IntakeFileRow,
} from '../db/engagements.js';
import {
  GlbMalformedError,
  MeasurementFailure,
  glbJsonChunkLength,
  measureGltf,
  parseGltfJson,
} from '../domain/glb.js';
import { getObjectRange } from '../services/storage.js';
import {
  publishMeasureJob,
  publishToDeadQueue,
  startMeasureConsumer,
} from '../services/measure-queue.js';

const MEASURE_FAILURE_LIMIT = 2;

/** The unit decision a measurement reaches on its own: in-range models need no question. */
export const automaticUnit = (largestMetres: number): UnitDecision | null =>
  largestMetres > RANGE_MAX_METRES || largestMetres < RANGE_MIN_METRES ? null : 'as_exported';

const readGltf = async (objectKey: string) => {
  const header = await getObjectRange(objectKey, 0, 19);
  const jsonLength = glbJsonChunkLength(header);
  const json = await getObjectRange(objectKey, 20, 20 + jsonLength - 1);
  return parseGltfJson(json);
};

export const measureStoredFile = async (file: IntakeFileRow): Promise<'measured' | 'failed'> => {
  const gltf = await readGltf(file.object_key);
  const dimensions = measureGltf(gltf);
  const largest = Math.max(dimensions.x, dimensions.y, dimensions.z);
  await recordMeasurement(file.id, {
    x: dimensions.x.toFixed(12),
    y: dimensions.y.toFixed(12),
    z: dimensions.z.toFixed(12),
    unit: automaticUnit(largest),
  });
  return 'measured';
};

export const startMeasurementWorker = (): void => {
  startMeasureConsumer({
    handle: async (message) => {
      let intakeFileId: string | null = null;
      try {
        const body = JSON.parse(message.content.toString('utf8')) as { intake_file_id?: unknown };
        intakeFileId = typeof body.intake_file_id === 'string' ? body.intake_file_id : null;
      } catch {
        return 'ack';
      }
      if (intakeFileId === null) return 'ack';

      const file = await findIntakeFile(intakeFileId).catch(() => null);
      if (file === null) return 'requeue';
      if (file.measured) return 'ack';

      try {
        await measureStoredFile(file);
        return 'ack';
      } catch (error) {
        if (!(error instanceof MeasurementFailure) && !(error instanceof GlbMalformedError))
          return 'requeue';
        const failures = await recordMeasurementFailure(file.id);
        if (failures < MEASURE_FAILURE_LIMIT) return 'requeue';
        await publishToDeadQueue(message.content);
        await markMeasurementFailed(file.id);
        return 'ack';
      }
    },
  });
};

/** Delayed jobs are re-offered to the queue until it accepts them. */
export const startDelayedJobRetry = (): void => {
  const attempt = async (): Promise<void> => {
    for (const file of await delayedMeasurementFiles()) {
      await publishMeasureJob(file.id);
      await setMeasurementState(file.id, 'pending');
    }
  };
  setInterval(() => {
    void attempt().catch(() => undefined);
  }, 5_000).unref();
};
