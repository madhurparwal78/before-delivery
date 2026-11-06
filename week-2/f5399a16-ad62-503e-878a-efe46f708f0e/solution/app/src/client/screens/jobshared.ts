import { api } from '../api';
import type { Job } from '../types';

export function readJob(jobId: string): Promise<Job> {
  return api<Job>(`/api/jobs/${jobId}`);
}
