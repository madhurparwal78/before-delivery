import { api, ApiCallError, type Task } from './api.js';
import { toast } from './status.js';

export interface SaveOutcome {
  task: Task | null;
  stale: boolean;
  errors?: Record<string, string>;
}

/** One place for an inline save and its published feedback. */
export async function patchTask(
  taskId: string,
  body: Record<string, unknown>,
  options: { toastOnSuccess?: boolean } = {},
): Promise<SaveOutcome> {
  try {
    const task = await api.patch<Task>(`/api/tasks/${taskId}`, body);
    if (options.toastOnSuccess) toast('Saved');
    return { task, stale: false };
  } catch (err) {
    if (err instanceof ApiCallError) {
      if (err.failure.error === 'stale_task') {
        toast('This task changed. Try again.');
        return { task: null, stale: true };
      }
      if (err.failure.errors) {
        toast("Couldn't save. Nothing changed.");
        return { task: null, stale: false, errors: err.failure.errors };
      }
    }
    toast("Couldn't save. Nothing changed.");
    return { task: null, stale: false };
  }
}
