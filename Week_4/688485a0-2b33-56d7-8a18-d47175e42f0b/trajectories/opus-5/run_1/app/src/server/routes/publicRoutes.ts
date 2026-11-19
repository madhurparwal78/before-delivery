import { Router } from 'express';
import { compileStage, runPipeline } from '../../shared/aggregate';
import { notFound } from '../../shared/errors';
import { SAMPLE_PIPELINE_TEXT, houseplantDocuments } from '../../shared/sample';
import { DocObject, fromJson, toJson } from '../../shared/values';
import { config } from '../config';
import { isDatabaseReady } from '../db';
import { handler } from '../httpUtil';
import { storageReachable } from '../storage';

export const publicRoutes = Router();

publicRoutes.get(
  '/health',
  handler(async (_req, res) => {
    if (!isDatabaseReady()) {
      res.status(503).json({ status: 'starting' });
      return;
    }
    const reachable = await storageReachable();
    res.status(200).json({ status: reachable ? 'ok' : 'unavailable' });
  }),
);

/** The houseplant sample is public and exempt from the scan guard. */
publicRoutes.get(
  '/sample/sieve',
  handler(async (_req, res) => {
    const docs = houseplantDocuments();
    const stages = SAMPLE_PIPELINE_TEXT.map((text, index) =>
      compileStage(fromJson(JSON.parse(text) as unknown) as DocObject, index),
    );
    const run = runPipeline(docs, stages, new Set(), config.limits.previewDocs, null);
    res.json({
      input: run.input,
      stages: run.stages.map((stage) => ({
        index: stage.index,
        count: stage.count,
        disabled: stage.disabled,
        documents: stage.documents.map((doc) => toJson(doc)),
      })),
      pin: null,
      pipeline: SAMPLE_PIPELINE_TEXT,
    });
  }),
);

export function gradingKeyGuard(key: unknown): void {
  if (!config.gradingKey || typeof key !== 'string' || key !== config.gradingKey) throw notFound();
}
