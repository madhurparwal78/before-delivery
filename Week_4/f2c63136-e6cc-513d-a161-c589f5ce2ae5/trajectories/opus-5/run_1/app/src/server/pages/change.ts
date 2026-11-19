import type { Db } from '../db.js';
import { CHECK_STATE_WORDS } from '../../domain/checks.js';
import type { ChangeView } from '../../domain/changeview.js';
import { diffHunks, type Hunk } from '../../domain/diff.js';
import { ROLE_RANK, type Role } from '../../domain/model.js';
import { readFileText } from '../../domain/revisions.js';
import type { ThreadView } from '../../domain/threads.js';
import { attr, escapeHtml, STATE_WORDS, statusBar, timeElement } from './layout.js';

export interface FileDiff {
  path: string;
  status: string;
  hunks: Hunk[];
}

export async function loadFileDiffs(tx: Db, view: ChangeView): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];
  for (const file of view.files) {
    const baseText = (await readFileText(tx, view.repo.id, view.change.baseRevision, file.path)) ?? '';
    const headText = (await readFileText(tx, view.repo.id, view.headRevision, file.path)) ?? '';
    diffs.push({ path: file.path, status: file.status, hunks: diffHunks(baseText, headText) });
  }
  return diffs;
}

const STATUS_WORDS: Record<string, string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };

function rowName(kind: string, oldLine: number | null, newLine: number | null, text: string, header: string): string {
  if (kind === 'hunk') return header;
  const shown = text === '' ? '(empty line)' : text;
  if (kind === 'added') return `Line ${newLine}, added: ${shown}`;
  if (kind === 'removed') return `Old line ${oldLine}, removed: ${shown}`;
  return `Line ${newLine}, unchanged: ${shown}`;
}

function cell(value: number | null): string {
  return value === null ? '' : String(value);
}

function diffRow(
  path: string,
  kind: 'hunk' | 'context' | 'added' | 'removed',
  oldLine: number | null,
  newLine: number | null,
  text: string,
  header: string,
  side: '' | 'old' | 'new',
): string {
  const name = rowName(kind, oldLine, newLine, text, header);
  const mark = kind === 'added' ? '+' : kind === 'removed' ? '-' : kind === 'hunk' ? '@' : ' ';
  const body = kind === 'hunk' ? header : text;
  return `<tr role="row" tabindex="-1" aria-label="${attr(name)}" data-path="${attr(path)}" data-kind="${attr(
    kind,
  )}" data-old-line="${attr(cell(oldLine))}" data-new-line="${attr(cell(newLine))}" data-side="${attr(
    side,
  )}" class="row row-${attr(kind)} side-${attr(side === '' ? 'none' : side)}">
<td class="num num-old">${attr(cell(oldLine))}</td><td class="num num-new">${attr(cell(newLine))}</td><td class="mark" aria-hidden="true">${attr(
    mark,
  )}</td><td class="code">${escapeHtml(body)}</td></tr>`;
}

function unifiedTable(file: FileDiff): string {
  const rows: string[] = [];
  for (const hunk of file.hunks) {
    rows.push(diffRow(file.path, 'hunk', null, null, hunk.header, hunk.header, ''));
    for (const row of hunk.rows) {
      const side = row.kind === 'removed' ? 'old' : 'new';
      rows.push(diffRow(file.path, row.kind, row.old_line, row.new_line, row.text, hunk.header, side));
    }
  }
  return `<table class="diff diff-unified" aria-label="Diff of ${attr(file.path)}" data-view="unified" data-path="${attr(
    file.path,
  )}"><tbody>${rows.join('')}</tbody></table>`;
}

function splitTable(file: FileDiff): string {
  const rows: string[] = [];
  for (const hunk of file.hunks) {
    rows.push(diffRow(file.path, 'hunk', null, null, hunk.header, hunk.header, ''));
    for (const row of hunk.rows) {
      if (row.kind === 'context') {
        rows.push(diffRow(file.path, 'context', row.old_line, row.new_line, row.text, hunk.header, 'old'));
        rows.push(diffRow(file.path, 'context', row.old_line, row.new_line, row.text, hunk.header, 'new'));
      } else if (row.kind === 'removed') {
        rows.push(diffRow(file.path, 'removed', row.old_line, null, row.text, hunk.header, 'old'));
      } else {
        rows.push(diffRow(file.path, 'added', null, row.new_line, row.text, hunk.header, 'new'));
      }
    }
  }
  return `<table class="diff diff-split" aria-label="Diff of ${attr(file.path)}" data-view="split" data-path="${attr(
    file.path,
  )}"><tbody>${rows.join('')}</tbody></table>`;
}

function suggestionBlock(comment: ThreadView['comments'][number]): string {
  if (!comment.suggestion) return '';
  const applied = comment.suggestion.state === 'applied';
  return `<div class="suggestion" role="region" aria-label="Suggested change" data-comment-id="${comment.id}" data-suggestion-state="${attr(
    comment.suggestion.state,
  )}">
<pre class="mono">${escapeHtml(comment.suggestion.lines.join('\n'))}</pre>
${
  applied
    ? '<p class="applied">Applied</p>'
    : `<button type="button" class="flat" data-suggestion-apply="${comment.id}">Apply suggestion</button>
<button type="button" class="flat" data-suggestion-batch="${comment.id}">Add to batch</button>`
}
</div>`;
}

function threadArticle(thread: ThreadView): string {
  const comments = thread.comments
    .map(
      (comment) => `<div class="comment" data-comment-id="${comment.id}">
<p class="commentmeta"><span class="author">${escapeHtml(comment.authorName)}</span> ${timeElement(comment.createdAt)}</p>
<p class="commentbody">${escapeHtml(comment.body)}</p>
${suggestionBlock(comment)}
</div>`,
    )
    .join('');
  const resolveLabel = thread.state === 'resolved' ? 'Unresolve thread' : 'Resolve thread';
  return `<article class="thread" aria-label="Thread on ${attr(thread.path)} line ${thread.line}" data-thread-id="${
    thread.id
  }" data-state="${attr(thread.state)}" data-outdated="${thread.outdated ? 'true' : 'false'}" data-path="${attr(
    thread.path,
  )}" data-side="${attr(thread.side)}" data-line="${thread.line}" data-anim="none" tabindex="-1">
<header class="threadhead"><span>${escapeHtml(thread.path)} line ${thread.line}</span>${
    thread.outdated ? '<span class="outdatedflag">Outdated</span>' : ''
  }</header>
${comments}
<div class="threadactions">
<label class="field"><span>Reply</span><textarea data-thread-reply="${thread.id}" aria-label="Reply"></textarea></label>
<button type="button" class="flat" data-thread-send="${thread.id}">Send reply</button>
<button type="button" class="flat" data-thread-state="${thread.id}">${resolveLabel}</button>
</div>
</article>`;
}

function fileSection(file: FileDiff, view: ChangeView, threads: ThreadView[]): string {
  const viewed = view.viewedPaths.has(file.path);
  const live = threads.filter((thread) => thread.path === file.path && !thread.outdated);
  return `<section class="file" data-path="${attr(file.path)}" data-viewed="${viewed ? 'true' : 'false'}">
<header class="fileheader">
<span class="filepath mono">${escapeHtml(file.path)}</span>
<span class="filestatus">${escapeHtml(STATUS_WORDS[file.status] ?? file.status)}</span>
<label class="viewedlabel"><input type="checkbox" data-viewed-path="${attr(file.path)}" aria-label="Viewed"${
    viewed ? ' checked' : ''
  } /><span>Viewed</span></label>
</header>
<div class="difftables">
${unifiedTable(file)}
${splitTable(file)}
</div>
<div class="threads" data-threads-for="${attr(file.path)}">${live.map(threadArticle).join('')}</div>
</section>`;
}

function fileTree(view: ChangeView): string {
  const entries = view.files
    .map(
      (file) =>
        `<li><a href="#file-${attr(file.path)}" data-file-link="${attr(file.path)}">${escapeHtml(file.path)}</a></li>`,
    )
    .join('');
  return `<nav class="filetree" aria-label="File tree"><ul>${entries}</ul></nav>
<button type="button" class="flat filesbutton" data-files-drawer hidden>Files</button>`;
}

export function renderStage(view: ChangeView, diffs: FileDiff[], outage: string | null): string {
  const change = view.change;
  const header = `<header class="changeheader" data-files-viewed="${view.counts.filesViewed}" data-files-total="${
    view.counts.filesTotal
  }" data-unresolved-threads="${view.counts.unresolvedThreads}" data-approvals-remaining="${
    view.counts.approvalsRemaining
  }">
<h1>#${change.number} ${escapeHtml(change.title)}</h1>
${statusBar(STATE_WORDS[change.state] ?? change.state)}
<p class="mergeline">${escapeHtml(view.author.username)} wants to merge ${escapeHtml(change.headBranch)} into ${escapeHtml(
    change.baseBranch,
  )}</p>
<p class="count">Unresolved threads: ${view.counts.unresolvedThreads}</p>
<p class="count">Approvals remaining: ${view.counts.approvalsRemaining}</p>
</header>`;

  const toolbar = `<div class="toolbar">
<div class="diffviews" role="radiogroup" aria-label="Diff view">
<label><input type="radio" name="diffview" value="split" data-diff-view="split" aria-label="Split" checked /><span>Split</span></label>
<label><input type="radio" name="diffview" value="unified" data-diff-view="unified" aria-label="Unified" /><span>Unified</span></label>
</div>
<label class="switchlabel"><input type="checkbox" role="switch" aria-label="Show outdated threads" data-outdated-switch /><span>Show outdated threads</span></label>
<p class="count viewedcount">${view.counts.filesViewed} of ${view.counts.filesTotal} files viewed</p>
<span class="batchslot" data-batch-slot></span>
</div>`;

  const outdated = view.threads.filter((thread) => thread.outdated);
  const outdatedRegion = `<section class="outdated" role="region" aria-label="Outdated threads" data-outdated-region hidden>${outdated
    .map(threadArticle)
    .join('')}</section>`;

  const body = outage === null ? diffs.map((file) => fileSection(file, view, view.threads)).join('') : '';

  return `${header}${toolbar}${fileTree(view)}<div class="files">${body}</div>${outdatedRegion}`;
}

function mergeBox(view: ChangeView, role: Role | null): string {
  const change = view.change;
  const rules = view.mergeRules
    .map((rule) => `<li data-rule="${attr(rule.rule)}">${escapeHtml(rule.text)}</li>`)
    .join('');
  const met = view.mergeRules.length === 1 && view.mergeRules[0].rule === 'met';
  const canWrite = role !== null && ROLE_RANK[role] >= ROLE_RANK.writer;

  let head = '';
  if (change.state === 'merged') {
    head = `<p class="mergedline">Merged into ${escapeHtml(change.baseBranch)} as ${escapeHtml(
      change.mergeRevision ?? '',
    )}</p>`;
  } else if (change.state === 'queued' && view.queueEntry && view.queueEntry.position !== null) {
    head = `<p class="queuedline">In the merge queue, position ${view.queueEntry.position}</p>`;
  } else if (change.state === 'removed' && change.removalReason) {
    head = `<p class="removedline">${escapeHtml(change.removalReason)}</p>`;
  }

  const list = change.state === 'merged' ? '' : `<ul class="mergerules" role="list" aria-label="Merge rules">${rules}</ul>`;
  const button =
    change.state === 'merged' || !canWrite
      ? ''
      : view.repo.queueOn
        ? `<button type="button" class="glow" data-queue-change${met ? '' : ' disabled'}>Add to merge queue</button>`
        : `<button type="button" class="glow" data-merge-change${met ? '' : ' disabled'}>Merge change</button>`;
  const ready =
    change.state === 'draft' && canWrite
      ? '<button type="button" class="flat" data-mark-ready>Mark ready for review</button>'
      : '';

  return `<section class="mergebox" role="region" aria-label="Merge box">${head}${list}${button}${ready}</section>`;
}

function checksList(view: ChangeView): string {
  const rows = view.checks
    .map(
      (row) => `<li data-check-name="${attr(row.name)}" data-state="${attr(row.state)}">
<span class="checkname mono">${escapeHtml(row.name)}</span>
<span class="checkstate">${escapeHtml(CHECK_STATE_WORDS[row.state])}</span>
${row.summary === '' ? '' : `<span class="checksummary">${escapeHtml(row.summary)}</span>`}
${row.required ? '<span class="checkrequired">(required)</span>' : ''}
${row.timeoutAt ? `<span class="checktimeout">Times out at ${timeElement(row.timeoutAt)}</span>` : ''}
</li>`,
    )
    .join('');
  return `<ul class="checks" role="list" aria-label="Checks">${rows}</ul>`;
}

function stackList(view: ChangeView): string {
  const resultWord = (restack: string, count: number): string => {
    if (restack === 'kept') return 'Approvals kept';
    if (restack === 'dismissed') return `Approvals dismissed (${count})`;
    if (restack === 'conflicting') return `Conflicts in ${count} files`;
    if (restack === 'not_restacked') return 'Not restacked';
    return '';
  };
  const rows = view.stack
    .map((row) => {
      const count = row.dismissedCount;
      return `<li data-change-number="${row.number}" data-stack-position="${row.position}" data-restack="${attr(
        row.restack,
      )}" data-anim="none" data-dismissed-count="${count}" class="railrow">
<span class="railbar" aria-hidden="true"></span>
<a href="/${attr(view.repo.org)}/${attr(view.repo.name)}/changes/${row.number}">#${row.number} ${escapeHtml(
        row.title,
      )}</a>
<span class="railresult">${escapeHtml(resultWord(row.restack, count))}</span>
</li>`;
    })
    .join('');
  return `<ul class="stackrail" role="list" aria-label="Stack">${rows}</ul>`;
}

function reviewsList(view: ChangeView, role: Role | null): string {
  const canDismiss = role !== null && ROLE_RANK[role] >= ROLE_RANK.maintainer;
  const items = view.reviews
    .map(({ review, reviewer }) => {
      const verb =
        review.type === 'approve' ? 'approved' : review.type === 'request_changes' ? 'requested changes' : 'commented';
      let text = `${reviewer.name} ${verb}`;
      if (review.state === 'dismissed') {
        text =
          review.dismissalKind === 'maintainer'
            ? `Dismissed by ${view.dismissedByName.get(review.id) ?? ''}: ${review.reason ?? ''}`
            : 'Dismissed: the change was updated after this approval';
      }
      return `<li data-review-id="${review.id}" data-state="${attr(review.state)}">
<span class="reviewtext">${escapeHtml(text)}</span>
${review.summary === '' ? '' : `<span class="reviewsummary">${escapeHtml(review.summary)}</span>`}
${
  canDismiss && review.state !== 'dismissed'
    ? `<button type="button" class="flat" data-dismiss-review="${review.id}">Dismiss review</button>`
    : ''
}
</li>`;
    })
    .join('');
  return `<ul class="reviews" role="list" aria-label="Reviews">${items}</ul>`;
}

export function renderRail(view: ChangeView, role: Role | null): string {
  const change = view.change;
  const canWrite = role !== null && ROLE_RANK[role] >= ROLE_RANK.writer;
  const notice =
    change.restackNoticeKind && change.restackNotice
      ? `<li data-notice="${attr(change.restackNoticeKind)}">${escapeHtml(change.restackNotice)}</li>`
      : '';
  const requested = view.requestedReviewers
    .map((user) => `<li>${escapeHtml(user.name)} (${escapeHtml(user.username)})</li>`)
    .join('');

  return `${stackList(view)}
${mergeBox(view, role)}
${checksList(view)}
<section class="notices" role="region" aria-label="Change notices"><ul>${notice}</ul></section>
<section class="reviewers card">
${
  canWrite
    ? `<label class="field"><span>Reviewer username</span><input type="text" data-reviewer-username aria-label="Reviewer username" /></label>
<button type="button" class="flat" data-request-review>Request review</button>`
    : ''
}
<ul class="requested" role="list" aria-label="Requested reviewers">${requested}</ul>
</section>
<button type="button" class="flat" data-review-changes>Review changes</button>
${reviewsList(view, role)}`;
}
