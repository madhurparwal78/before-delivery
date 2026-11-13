import type {
  Bundle,
  GraphNode,
  Overrides,
  Promotion,
  ProjectRole,
  StageHealthResponse,
} from '../../shared/types.js';
import { clusterTime } from '../../shared/zone.js';
import { ApiCallFailed, download, newRequestKey, send } from '../api.js';
import { PHASE_LABEL, blockReason, copy, stamp } from '../copy.js';
import { labelledField, openDialog, type DialogHandle } from '../dialog.js';
import { append, clear, el, svgIcon, type Child } from '../dom.js';
import { healthChip, icons, statusChip, syncChip } from '../icons.js';
import { announce, clearProblem, failureMessage, problem, type FailureCopy } from '../live.js';
import { mayPerform } from '../../shared/authority.js';

export interface EvidenceContext {
  slug: string;
  node: GraphNode;
  role: ProjectRole;
  shown: Promotion | null;
  health: StageHealthResponse | null;
  promotions: Promotion[];
  bundles: Bundle[];
  selectedPromotionId: string | null;
  selectPromotion(id: string | null): void;
  close(): void;
  refresh(): void;
}

function overrideLines(overrides: Overrides): HTMLElement {
  const rows: HTMLElement[] = [];
  for (const [key, value] of Object.entries(overrides.parameters)) {
    rows.push(el('dt', {}, [`parameters.${key}`]), el('dd', {}, [value]));
  }
  for (const [ref, count] of Object.entries(overrides.replicas)) {
    rows.push(el('dt', {}, [`replicas.${ref}`]), el('dd', {}, [String(count)]));
  }
  if (rows.length === 0) rows.push(el('dt', {}, ['none']), el('dd', {}, ['—']));
  return el('dl', {}, rows);
}

function valueCell(value: unknown): HTMLElement {
  if (value === null || value === undefined) return el('td', { class: 'mono' }, ['—']);
  const text = String(value);
  return el('td', { class: 'mono' }, [
    text === copy.redacted ? el('span', { class: 'redacted' }, [text]) : text,
  ]);
}

function diffSection(promotion: Promotion | null): Node[] {
  const heading = el('h3', {}, ['Diff']);
  if (!promotion || promotion.diff.length === 0) {
    return [heading, el('p', { class: 'evidence__empty' }, ['No changes.'])];
  }
  const rows = promotion.diff.map((entry) =>
    el('tr', {}, [
      el('td', { class: 'mono' }, [entry.resource]),
      el('td', { class: 'mono' }, [entry.path === '' ? '—' : entry.path]),
      el('td', {}, [entry.change]),
      valueCell(entry.before),
      valueCell(entry.after),
    ]),
  );
  return [
    heading,
    el('table', { 'aria-label': 'Diff' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Resource']),
          el('th', {}, ['Path']),
          el('th', {}, ['Change']),
          el('th', {}, ['Before']),
          el('th', {}, ['After']),
        ]),
      ]),
      el('tbody', {}, rows),
    ]),
  ];
}

function approvalSection(promotion: Promotion | null, timeZone: string): Node[] {
  const heading = el('h3', {}, ['Approvals']);
  const approval = promotion?.approval;
  if (!approval) {
    return [heading, el('p', { class: 'evidence__empty' }, ['This stage does not need approval.'])];
  }
  return [
    heading,
    el('dl', {}, [
      el('dt', {}, ['Decision']),
      el('dd', {}, [approval.state]),
      el('dt', {}, ['By']),
      el('dd', {}, [approval.decided_by ?? '—']),
      el('dt', {}, ['When']),
      el('dd', { class: 'mono' }, [stamp(approval.decided_at, timeZone)]),
      el('dt', {}, ['Expires']),
      el('dd', { class: 'mono' }, [
        stamp(approval.expires_at ?? approval.request_expires_at, timeZone),
      ]),
      el('dt', {}, ['Comment']),
      el('dd', {}, [approval.comment ?? '—']),
    ]),
  ];
}

function windowSection(promotion: Promotion | null, timeZone: string): Node[] {
  const heading = el('h3', {}, ['Window decision']);
  const decision = promotion?.window_decision ?? null;
  if (!decision) {
    return [
      heading,
      el('p', { class: 'evidence__empty' }, [copy.notCheckedYet]),
      el('dl', {}, [
        el('dt', {}, ['Policy version']),
        el('dd', { class: 'mono' }, [String(promotion?.policy_version ?? '—')]),
      ]),
    ];
  }
  const reason =
    decision.reason === 'freeze'
      ? `freeze "${decision.freeze?.name ?? ''}"`
      : decision.reason === 'outside_window'
        ? 'outside every sync window'
        : (decision.window?.label ?? 'no window required');
  return [
    heading,
    el('dl', {}, [
      el('dt', {}, ['Decision']),
      el('dd', {}, [decision.open ? 'Open' : 'Closed']),
      el('dt', {}, ['Reason']),
      el('dd', {}, [reason]),
      el('dt', {}, ['Local time at check']),
      el('dd', { class: 'mono' }, [`${decision.local_time} ${timeZone}`]),
      el('dt', {}, ['Policy version']),
      el('dd', { class: 'mono' }, [String(decision.policy_version)]),
    ]),
  ];
}

function healthSection(ctx: EvidenceContext, promotion: Promotion | null): Child[] {
  const heading = el('h3', {}, ['Health']);
  const health = ctx.health;
  if (!health || health.revision === null || health.resources.length === 0) {
    return [heading, el('p', { class: 'evidence__empty' }, [copy.nothingDeployed])];
  }
  const own = promotion !== null && promotion.id === health.revision;
  const live = ctx.promotions.find((candidate) => candidate.id === health.revision);
  const caption = own
    ? null
    : el('p', { class: 'evidence__caption' }, [
        copy.liveRevision(live?.bundle.short_digest ?? ctx.node.current?.short_digest ?? ''),
      ]);

  const rows = health.resources.map((resource) =>
    el('tr', {}, [
      el('td', { class: 'mono' }, [resource.ref]),
      el('td', {}, [syncChip(resource.sync)]),
      el('td', {}, [healthChip(resource.health)]),
    ]),
  );
  return [
    heading,
    caption,
    el('table', { 'aria-label': 'Resource health' }, [
      el('thead', {}, [
        el('tr', {}, [el('th', {}, ['Resource']), el('th', {}, ['Sync']), el('th', {}, ['Health'])]),
      ]),
      el('tbody', {}, rows),
    ]),
    el('p', { class: 'evidence__caption mono' }, [`in sync ${health.in_sync}/${health.total}`]),
  ];
}

function historySection(promotion: Promotion | null, timeZone: string): Node[] {
  const heading = el('h3', {}, ['History']);
  if (!promotion || promotion.history.length === 0) {
    return [heading, el('p', { class: 'evidence__empty' }, ['No history yet.'])];
  }
  return [
    heading,
    el(
      'ul',
      { class: 'history', 'aria-label': 'Promotion history' },
      promotion.history.map((entry) =>
        el('li', {}, [`${entry.from ?? 'new'} → ${entry.to}  ${clusterTime(entry.at, timeZone)}  ${entry.by}`]),
      ),
    ),
  ];
}

interface Submission {
  button: HTMLButtonElement;
  dialog: DialogHandle | null;
  run(requestKey: string): Promise<string>;
  pending: string;
  failureCopy?: FailureCopy;
}

/** Holds one request key for a submission and reuses it until a final response arrives. */
function wireSubmit(submission: Submission, onSettled: (succeeded: boolean) => void): void {
  let key: string | null = null;
  submission.button.addEventListener('click', () => {
    if (submission.button.disabled) return;
    key = key ?? newRequestKey();
    submission.button.disabled = true;
    submission.dialog?.clearError();
    clearProblem();
    announce(submission.pending);
    void submission
      .run(key)
      .then((success) => {
        key = null;
        submission.dialog?.close();
        announce(success, true);
        onSettled(true);
      })
      .catch((cause: unknown) => {
        const network = cause instanceof ApiCallFailed && cause.failure.status === 0;
        if (!network) key = null;
        const message = failureMessage(cause, submission.failureCopy);
        if (submission.dialog) submission.dialog.showError(message);
        problem(message);
        announce('');
        onSettled(false);
      })
      .finally(() => {
        submission.button.disabled = false;
      });
  });
}

function actionButton(label: string, glyph?: string): HTMLButtonElement {
  return el('button', { type: 'button', class: 'btn' }, [glyph ? svgIcon(glyph) : null, label]);
}

/** The open Promote dialog, so a refresh can add a bundle the pipeline has just ingested. */
let openPromoteOptions: ((bundles: Bundle[]) => void) | null = null;

export function refreshPromoteOptions(bundles: Bundle[]): void {
  openPromoteOptions?.(bundles);
}

function promoteDialog(ctx: EvidenceContext, opener: HTMLElement): void {
  const upstream = ctx.node.upstream;
  const select = el('select', { id: 'promote-bundle', 'aria-label': 'Release bundle' });
  const missing = el('span', { class: 'field-error' });

  const refreshOptions = (bundles: Bundle[]): void => {
    if (!select.isConnected) {
      openPromoteOptions = null;
      return;
    }
    const offered = bundles.filter(
      (bundle) => upstream === null || bundle.verified_in.includes(upstream),
    );
    const chosen = select.value;
    const shown = [...select.options].map((option) => option.value).join(',');
    if (shown === offered.map((bundle) => bundle.version).join(',')) return;
    clear(select);
    append(
      select,
      offered.map((bundle) =>
        el('option', { value: bundle.version }, [`${bundle.version} · ${bundle.short_digest}`]),
      ),
    );
    if (chosen && offered.some((bundle) => bundle.version === chosen)) select.value = chosen;
    missing.textContent =
      offered.length === 0 ? `No bundle has reached Healthy in ${upstream ?? 'this stage'} yet.` : '';
  };
  refreshOptions(ctx.bundles);
  openPromoteOptions = refreshOptions;

  const confirm = el('button', { type: 'button', class: 'btn btn--primary' }, ['Request promotion']);
  const cancel = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Cancel']);
  const dialog = openDialog({
    label: `Promote to ${ctx.node.stage}`,
    heading: `Promote to ${ctx.node.stage}`,
    opener,
    content: [
      el('div', { class: 'field' }, [
        el('label', { for: 'promote-bundle' }, ['Release bundle']),
        select,
        missing,
      ]),
      el('h3', {}, ['Overrides frozen into this promotion']),
      el('div', { class: 'dialog__summary' }, [overrideLines(ctx.node.defaults)]),
    ],
    actions: [cancel, confirm],
  });
  cancel.addEventListener('click', () => dialog.close());

  const submission: Submission = {
    button: confirm,
    dialog,
    pending: copy.requestingPromotion,
    failureCopy: (failure) => {
      if (failure.code === 'stage_busy' && failure.holder) {
        return copy.stageHeld(
          ctx.node.stage,
          failure.holder.bundle_version,
          failure.holder.bundle_digest.replace(/^sha256:/, '').slice(0, 7),
        );
      }
      if (failure.code === 'not_verified_upstream') {
        return copy.notVerified(select.value, upstream ?? '');
      }
      return null;
    },
    async run(requestKey) {
      const promotion = await send<Promotion>(
        `/api/projects/${ctx.slug}/stages/${encodeURIComponent(ctx.node.stage)}/promotions`,
        'POST',
        { bundle_version: select.value },
        requestKey,
      );
      if (promotion.state === 'awaiting_approval') {
        return copy.waitingApproval(promotion.bundle.version, promotion.stage);
      }
      if (promotion.state === 'window_blocked') {
        return copy.blockedPromotion(
          promotion.bundle.version,
          promotion.stage,
          blockReason(promotion.window_decision, promotion.cluster, promotion.time_zone),
        );
      }
      return copy.startedPromotion(promotion.bundle.version, promotion.stage);
    },
  };
  // A stage-busy refusal keeps the dialog open so the holder copy stays in view.
  wireSubmit(submission, () => ctx.refresh());
}

function reasonDialog(options: {
  ctx: EvidenceContext;
  opener: HTMLElement;
  label: string;
  heading: string;
  fieldLabel: string;
  confirmLabel: string;
  danger?: boolean;
  intro?: Node[];
  pending: string;
  run(reason: string, requestKey: string): Promise<string>;
  failureCopy?: Submission['failureCopy'];
  /** Keeps this promotion in the column when the action is refused. */
  pinOnFailure?: string;
}): void {
  const field = labelledField({ label: options.fieldLabel, multiline: true });
  const confirm = el(
    'button',
    { type: 'button', class: `btn ${options.danger ? 'btn--danger' : 'btn--primary'}` },
    [options.confirmLabel],
  );
  const cancel = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Cancel']);
  const dialog = openDialog({
    label: options.label,
    heading: options.heading,
    opener: options.opener,
    content: [...(options.intro ?? []), field.wrapper],
    actions: [cancel, confirm],
  });
  cancel.addEventListener('click', () => dialog.close());

  const submission: Submission = {
    button: confirm,
    dialog,
    pending: options.pending,
    failureCopy: (failure) => {
      if (failure.code === 'validation' && failure.fields) {
        const message = Object.values(failure.fields)[0];
        if (message) {
          field.setError(message);
          return message;
        }
      }
      return options.failureCopy?.(failure) ?? null;
    },
    run: (requestKey) => options.run(field.input.value, requestKey),
  };
  wireSubmit(submission, (succeeded) => {
    if (!succeeded && options.pinOnFailure) options.ctx.selectPromotion(options.pinOnFailure);
    options.ctx.refresh();
  });
}

function approveDialog(ctx: EvidenceContext, promotion: Promotion, opener: HTMLElement): void {
  const field = labelledField({ label: 'Comment', multiline: true });
  const confirm = el('button', { type: 'button', class: 'btn btn--primary' }, ['Approve promotion']);
  const cancel = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Cancel']);
  const label = `Approve ${promotion.bundle.version} to ${promotion.stage}`;
  const dialog = openDialog({
    label,
    heading: label,
    opener,
    content: [
      el('p', { class: 'evidence__caption' }, [
        `The window is checked when the promotion starts, not now.`,
      ]),
      field.wrapper,
    ],
    actions: [cancel, confirm],
  });
  cancel.addEventListener('click', () => dialog.close());

  const submission: Submission = {
    button: confirm,
    dialog,
    pending: copy.recordingApproval,
    failureCopy: (failure) => {
      if (failure.code === 'evidence_pending') return copy.evidencePending;
      if (failure.code === 'storage_unavailable') return copy.approvalStorageDown;
      if (failure.code === 'approval_expired') {
        return copy.requestLapsed(
          clusterTime(promotion.approval?.request_expires_at ?? promotion.requested_at, promotion.time_zone),
        );
      }
      return null;
    },
    async run(requestKey) {
      const updated = await send<Promotion>(
        `/api/promotions/${promotion.id}/approve`,
        'POST',
        field.input.value ? { comment: field.input.value } : {},
        requestKey,
      );
      return copy.approvedUntil(
        clusterTime(updated.approval?.expires_at ?? updated.requested_at, updated.time_zone),
      );
    },
  };
  wireSubmit(submission, (succeeded) => {
    if (!succeeded) ctx.selectPromotion(promotion.id);
    ctx.refresh();
  });
}

function lapsedCopy(promotion: Promotion): string {
  return copy.approvalLapsed(
    clusterTime(
      promotion.approval?.expires_at ?? promotion.approval?.request_expires_at ?? promotion.requested_at,
      promotion.time_zone,
    ),
  );
}

function blockedOrStarted(promotion: Promotion): string {
  if (promotion.state === 'window_blocked') {
    return copy.blockedPromotion(
      promotion.bundle.version,
      promotion.stage,
      blockReason(promotion.window_decision, promotion.cluster, promotion.time_zone),
    );
  }
  return copy.startedApplying(promotion.bundle.version, promotion.stage);
}

function directAction(
  ctx: EvidenceContext,
  options: {
    button: HTMLButtonElement;
    pending: string;
    run: (requestKey: string) => Promise<string>;
    failureCopy?: Submission['failureCopy'];
    pinOnFailure?: string;
  },
): void {
  const submission: Submission = {
    button: options.button,
    dialog: null,
    pending: options.pending,
    run: options.run,
    failureCopy: options.failureCopy,
  };
  wireSubmit(submission, (succeeded) => {
    if (!succeeded && options.pinOnFailure) ctx.selectPromotion(options.pinOnFailure);
    ctx.refresh();
  });
}

function rollbackTarget(ctx: EvidenceContext): Promotion | null {
  const currentId = ctx.node.current?.promotion_id ?? null;
  return (
    ctx.promotions.find(
      (candidate) => candidate.state === 'healthy' && candidate.id !== currentId,
    ) ?? null
  );
}

function actionsFor(ctx: EvidenceContext, promotion: Promotion | null): Node[] {
  const buttons: Node[] = [];
  const active = ctx.node.active_promotion;

  if (mayPerform(ctx.role, 'request_promotion') && active === null) {
    const promote = el('button', { type: 'button', class: 'btn btn--primary' }, [
      svgIcon(icons.package),
      'Promote',
    ]);
    promote.addEventListener('click', () => promoteDialog(ctx, promote));
    buttons.push(promote);
  }

  if (promotion && promotion.state === 'awaiting_approval' && mayPerform(ctx.role, 'approve')) {
    const approve = el('button', { type: 'button', class: 'btn btn--primary' }, [
      svgIcon(icons.shieldCheck),
      'Approve',
    ]);
    approve.addEventListener('click', () => approveDialog(ctx, promotion, approve));
    const reject = el('button', { type: 'button', class: 'btn btn--danger' }, ['Reject']);
    reject.addEventListener('click', () =>
      reasonDialog({
        ctx,
        opener: reject,
        label: `Reject ${promotion.bundle.version} to ${promotion.stage}`,
        heading: `Reject ${promotion.bundle.version} to ${promotion.stage}`,
        fieldLabel: 'Reason',
        confirmLabel: 'Reject promotion',
        danger: true,
        pending: copy.recordingRejection,
        pinOnFailure: promotion.id,
        failureCopy: (failure) =>
          failure.code === 'approval_expired'
            ? copy.requestLapsed(
                clusterTime(
                  promotion.approval?.request_expires_at ?? promotion.requested_at,
                  promotion.time_zone,
                ),
              )
            : null,
        async run(reason, requestKey) {
          await send<Promotion>(`/api/promotions/${promotion.id}/reject`, 'POST', { reason }, requestKey);
          return copy.rejected;
        },
      }),
    );
    buttons.push(approve, reject);
  }

  if (promotion && promotion.state === 'approved' && mayPerform(ctx.role, 'start_promotion')) {
    const start = el('button', { type: 'button', class: 'btn btn--primary' }, [
      svgIcon(icons.play),
      'Start promotion',
    ]);
    directAction(ctx, {
      button: start,
      pending: copy.starting,
      async run(requestKey) {
        const updated = await send<Promotion>(
          `/api/promotions/${promotion.id}/start`,
          'POST',
          {},
          requestKey,
        );
        return blockedOrStarted(updated);
      },
      failureCopy: (failure) => (failure.code === 'approval_expired' ? lapsedCopy(promotion) : null),
      pinOnFailure: promotion.id,
    });
    buttons.push(start);
  }

  if (promotion && promotion.state === 'window_blocked') {
    if (mayPerform(ctx.role, 'retry_window')) {
      const recheck = actionButton('Re-check window', icons.clock);
      directAction(ctx, {
        button: recheck,
        pending: copy.checkingWindow,
        async run(requestKey) {
          const updated = await send<Promotion>(
            `/api/promotions/${promotion.id}/retry-window`,
            'POST',
            {},
            requestKey,
          );
          return blockedOrStarted(updated);
        },
        failureCopy: (failure) => (failure.code === 'approval_expired' ? lapsedCopy(promotion) : null),
        pinOnFailure: promotion.id,
      });
      buttons.push(recheck);
    }
    if (mayPerform(ctx.role, 'break_freeze')) {
      const breakFreeze = actionButton('Break freeze', icons.snowflake);
      breakFreeze.addEventListener('click', () =>
        reasonDialog({
          ctx,
          opener: breakFreeze,
          label: `Break freeze on ${promotion.stage}`,
          heading: `Break freeze on ${promotion.stage}`,
          fieldLabel: 'Incident reason',
          confirmLabel: 'Break freeze and start',
          danger: true,
          pending: copy.breakingFreeze,
          pinOnFailure: promotion.id,
          failureCopy: (failure) => (failure.code === 'approval_expired' ? lapsedCopy(promotion) : null),
          async run(reason, requestKey) {
            const updated = await send<Promotion>(
              `/api/promotions/${promotion.id}/break-freeze`,
              'POST',
              { reason },
              requestKey,
            );
            return copy.freezeBroken(updated.bundle.version, updated.stage);
          },
        }),
      );
      buttons.push(breakFreeze);
    }
  }

  if (mayPerform(ctx.role, 'rollback') && active === null) {
    const target = rollbackTarget(ctx);
    const roll = actionButton('Roll back', icons.rotate);
    if (target) {
      roll.addEventListener('click', () =>
        reasonDialog({
          ctx,
          opener: roll,
          label: `Roll back ${ctx.node.stage}`,
          heading: `Roll back ${ctx.node.stage}`,
          fieldLabel: 'Incident reason',
          confirmLabel: `Roll back to ${target.bundle.version}`,
          danger: true,
          intro: [
            el('p', { class: 'dialog__summary' }, [
              `Restores ${target.bundle.version} (${target.bundle.short_digest})`,
            ]),
          ],
          pending: copy.startingRollback,
          failureCopy: (failure) => {
            if (failure.code === 'no_healthy_revision') return copy.noHealthyRevision(ctx.node.stage);
            if (failure.code === 'storage_unavailable') return copy.rollbackStorageDown;
            if (failure.code === 'stage_busy' && failure.holder) {
              return copy.stageHeld(
                ctx.node.stage,
                failure.holder.bundle_version,
                failure.holder.bundle_digest.replace(/^sha256:/, '').slice(0, 7),
              );
            }
            return null;
          },
          async run(reason, requestKey) {
            const created = await send<Promotion>(
              `/api/projects/${ctx.slug}/stages/${encodeURIComponent(ctx.node.stage)}/rollback`,
              'POST',
              { reason },
              requestKey,
            );
            if (created.state === 'window_blocked') {
              return copy.blockedPromotion(
                created.bundle.version,
                created.stage,
                blockReason(created.window_decision, created.cluster, created.time_zone),
              );
            }
            return copy.rollingBack(created.stage, created.bundle.version, created.bundle.short_digest);
          },
        }),
      );
    } else {
      roll.addEventListener('click', () => {
        problem(copy.noHealthyRevision(ctx.node.stage));
      });
    }
    buttons.push(roll);
  }

  if (promotion) {
    const grab = actionButton('Download evidence', icons.download);
    grab.addEventListener('click', () => {
      if (grab.disabled) return;
      grab.disabled = true;
      clearProblem();
      announce(copy.preparingEvidence);
      void download(
        `/api/promotions/${promotion.id}/evidence`,
        `keelson-evidence-${promotion.id}.json`,
      )
        .then((file) => {
          const url = URL.createObjectURL(file.bytes);
          const link = el('a', { href: url, download: file.fileName });
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          announce(copy.evidenceDownloaded, true);
        })
        .catch((cause: unknown) => {
          announce('');
          problem(
            failureMessage(cause, (failure) => {
              if (failure.code === 'evidence_pending') return copy.noEvidenceYet;
              if (failure.code === 'storage_unavailable') return copy.evidenceStorageDown;
              return null;
            }),
          );
        })
        .finally(() => {
          grab.disabled = false;
        });
    });
    buttons.push(grab);
  }

  const close = el('button', { type: 'button', class: 'btn btn--quiet' }, [svgIcon(icons.close), 'Close']);
  close.addEventListener('click', () => ctx.close());
  buttons.push(close);
  return buttons;
}

function promotionList(ctx: EvidenceContext): Node[] {
  if (ctx.promotions.length === 0) return [];
  return [
    el('h3', {}, ['Promotion history']),
    el(
      'ul',
      { class: 'promotion-list', 'aria-label': `Promotions of ${ctx.node.stage}` },
      ctx.promotions.slice(0, 50).map((promotion) => {
        const button = el('button', { type: 'button' }, [
          `${promotion.bundle.version} · ${promotion.bundle.short_digest}`,
          el('span', {}, [PHASE_LABEL[promotion.phase]]),
          el('span', {}, [clusterTime(promotion.requested_at, promotion.time_zone)]),
        ]);
        button.addEventListener('click', () => ctx.selectPromotion(promotion.id));
        return el('li', {}, [button]);
      }),
    ),
  ];
}

/** The right-hand evidence column: the paperwork for one stage. */
export function renderEvidence(ctx: EvidenceContext): HTMLElement {
  const promotion = ctx.shown;
  const timeZone = ctx.node.time_zone;
  const column = el('aside', {
    class: 'evidence',
    'aria-label': `Evidence for ${ctx.node.stage}`,
    tabindex: '-1',
  });

  const heading = el('h2', { tabindex: '-1', id: 'evidence-heading' }, [
    promotion ? `${promotion.bundle.version} · ${promotion.bundle.short_digest}` : ctx.node.stage,
  ]);

  append(column, [
    el('div', { class: 'evidence__head' }, [
      heading,
      statusChip(ctx.node.status),
    ]),
    el('p', { class: 'evidence__meta' }, [
      promotion
        ? `${PHASE_LABEL[promotion.phase]} · ${promotion.state} · requested by ${promotion.requested_by.name}`
        : `${ctx.node.stage} on ${ctx.node.cluster} (${timeZone})`,
      promotion?.kind === 'rollback' ? ' · rollback' : null,
    ]),
    el('div', { class: 'evidence__actions' }, actionsFor(ctx, promotion)),
    ctx.selectedPromotionId
      ? (() => {
          const back = el('button', { type: 'button', class: 'btn btn--quiet' }, [
            'Show the stage’s current promotion',
          ]);
          back.addEventListener('click', () => ctx.selectPromotion(null));
          return back;
        })()
      : null,
    ...diffSection(promotion),
    ...approvalSection(promotion, timeZone),
    ...windowSection(promotion, timeZone),
    ...healthSection(ctx, promotion),
    ...historySection(promotion, timeZone),
    ...promotionList(ctx),
  ]);
  return column;
}
