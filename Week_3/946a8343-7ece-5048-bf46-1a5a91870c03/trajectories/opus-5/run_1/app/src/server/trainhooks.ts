import { ProjectRow, roleLevels } from './access';
import { Tx } from './live';
import { firstFailedCheck, loadRequest, mergeChecks, openRequestsForBranch } from './mr';
import { performMerge } from './merge';
import { loadPipeline } from './pipeline';
import { carsOf, mergeFirstCar, removeCar, requestOfCar } from './train';

export async function onPipelineFinished(
  t: Tx,
  project: ProjectRow,
  pipelineId: number,
  status: string,
): Promise<void> {
  const pipeline = await loadPipeline(t.sql, pipelineId);
  if (pipeline === null) return;
  if (pipeline.source === 'train') {
    const cars = await carsOf(t.sql, project.id, pipeline.ref);
    const all = await t.sql.query<{ id: string; target: string }>(
      'select id, target from train_cars where project_id = $1 and pipeline_id = $2',
      [project.id, pipelineId],
    );
    void cars;
    for (const row of all) {
      const target = row.target;
      const targetCars = await carsOf(t.sql, project.id, target);
      const car = targetCars.find((item) => item.pipeline_id === pipelineId);
      if (car === undefined) continue;
      const request = await requestOfCar(t.sql, car);
      if (status === 'failed') {
        await removeCar(t, project, request, `pipeline ${pipelineId} failed`, true);
        continue;
      }
      if (status === 'success' && car.position === 1) {
        await mergeFirstCar(t, project, car);
      }
    }
    return;
  }
  await tryAutoMergeForBranch(t, project, pipeline.ref);
}

export async function tryAutoMergeForBranch(t: Tx, project: ProjectRow, branch: string): Promise<void> {
  const requests = await openRequestsForBranch(t.sql, project.id, branch);
  for (const request of requests) {
    if (!request.auto_merge) continue;
    await tryAutoMerge(t, project, request.iid);
  }
}

export async function tryAutoMerge(t: Tx, project: ProjectRow, iid: number): Promise<boolean> {
  const request = await loadRequest(t.sql, project.id, iid);
  if (request === null || !request.auto_merge) return false;
  const checks = await mergeChecks(t.sql, project, request);
  if (firstFailedCheck(checks) !== null) return false;
  await performMerge(
    t,
    project,
    { level: roleLevels.owner, role: 'owner', permissions: [], implied: false },
    request,
    null,
    request.author,
    { skipChecks: true },
  );
  return true;
}
