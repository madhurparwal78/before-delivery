import { APPLICATION_LABELS } from '../../shared/labels.js';
import type { QueueRow } from '../../shared/types.js';
import { planStages, stageLabel } from '../domain/routing.js';
import { errors } from '../errors.js';
import { requireSignedIn, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { repo } from '../repo.js';
import { loadCard } from '../services/library.js';

export async function listQueue(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  if (principal.role !== 'brand_reviewer' && principal.role !== 'legal_reviewer' && principal.role !== 'owner') {
    throw errors.notFound();
  }

  const stages = await repo.openStages();
  const rows: QueueRow[] = [];
  for (const stage of stages) {
    if (stage.assigneeId !== principal.id) continue;
    const request = await repo.request(stage.requestId);
    if (!request || request.deadline === null) continue;
    const card = await loadCard(request.assetId, request.variantId);
    const requester = await repo.principal(request.requesterId);
    const organisation = requester ? await repo.organisation(requester.organisationId) : null;
    const plan = planStages(request.applicationClass, card!.asset.assetClass);
    rows.push({
      requestId: request.id,
      stage: stage.n,
      stageLabel: stageLabel(stage.n, plan, card!.asset.assetClass),
      cardName: card!.cardName,
      applicationLabel: APPLICATION_LABELS[request.applicationClass],
      requesterName: requester?.displayName ?? '',
      organisationName: organisation?.name ?? '',
      deadline: request.deadline.toISOString(),
      escalation: request.escalation,
    });
  }

  rows.sort((left, right) =>
    left.deadline === right.deadline
      ? left.requestId.localeCompare(right.requestId)
      : left.deadline < right.deadline
        ? -1
        : 1,
  );

  sendJson(ctx.res, 200, { rows });
}
