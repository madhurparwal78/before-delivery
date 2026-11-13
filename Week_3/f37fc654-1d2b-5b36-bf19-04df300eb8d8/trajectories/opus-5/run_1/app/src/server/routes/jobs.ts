import { Router } from 'express';
import { queryString, route } from '../http/handler.js';
import { requireCaller, requireRole } from '../http/session.js';
import { listJobs } from '../jobs/queue.js';
import { isoUtc } from '../../shared/venue-time.js';

export const jobsRouter = Router();

jobsRouter.get(
  '/api/jobs',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const jobs = await listJobs({
      status: queryString(req, 'status'),
      commissionId: queryString(req, 'commissionId'),
    });
    res.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        commissionId: job.commission_id,
        status: job.status,
        attempts: job.attempts,
        lastError: job.last_error,
        createdAt: isoUtc(job.created_at),
        finishedAt: job.finished_at ? isoUtc(job.finished_at) : null,
      })),
    });
  }),
);
