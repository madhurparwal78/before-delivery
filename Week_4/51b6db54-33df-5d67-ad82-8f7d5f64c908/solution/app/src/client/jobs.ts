import type { JobState } from '../shared/types';
import { formatNumber, type Locale } from '../shared/format';

/** The Job progress text for a job state. */
export function jobText(job: JobState, locale: Locale): string {
  const format = locale.number_format;
  switch (job.state) {
    case 'stored':
      return `Stored: ${job.files.map((file) => file.name).join(', ')}`;
    case 'cancelled':
      return `Cancelled at ${formatNumber(job.done, format)} of ${formatNumber(job.total, format)}: nothing stored`;
    case 'failed':
      return 'Export failed: nothing stored';
    default:
      return `Processing ${formatNumber(job.done, format)} of ${formatNumber(job.total, format)}`;
  }
}

export const jobEnded = (job: JobState): boolean => job.state === 'stored' || job.state === 'cancelled' || job.state === 'failed';

/** Follows a job over server-sent events until it ends; returns a function that stops following. */
export function followJob(id: number, onUpdate: (job: JobState) => void): () => void {
  const source = new EventSource(`/api/jobs/${id}/events`);
  source.onmessage = (event: MessageEvent<string>) => {
    const job = JSON.parse(event.data) as JobState;
    onUpdate(job);
    if (jobEnded(job)) source.close();
  };
  return () => source.close();
}
