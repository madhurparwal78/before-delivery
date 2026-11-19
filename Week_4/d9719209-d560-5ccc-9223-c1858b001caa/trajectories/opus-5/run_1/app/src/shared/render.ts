import { copy, MOD_LOG_ACTION_TEXT } from './copy.js';
import { countLabel, deadlineCell, scoreDisplay, utcTimestamp } from './format.js';
import { attribute, classes, html, raw, type Raw } from './html.js';
import type { CommentView, ImageView, ModLogEntryView, PostView, ReportView } from './types.js';

const UP_ARROW = raw('<span aria-hidden="true" class="arrow arrow-up">▲</span>');
const DOWN_ARROW = raw('<span aria-hidden="true" class="arrow arrow-down">▼</span>');

export function voteControls(
  targetType: 'post' | 'comment',
  id: string,
  score: number,
  myVote: number,
  options: { disabled?: boolean } = {},
): Raw {
  return html`
    <div class="${classes('votes', targetType === 'post' ? 'votes-post' : 'votes-comment')}">
      <button
        type="button"
        class="${classes('vote', 'vote-up', myVote === 1 && 'is-pressed')}"
        aria-label="Upvote"
        aria-pressed="${myVote === 1 ? 'true' : 'false'}"
        data-vote="up"
        data-target-type="${targetType}"
        data-target-id="${id}"
        ${attribute('disabled', options.disabled === true)}
      >${UP_ARROW}</button>
      <span class="score" id="score-${targetType}-${id}">${scoreDisplay(score)}</span>
      <button
        type="button"
        class="${classes('vote', 'vote-down', myVote === -1 && 'is-pressed')}"
        aria-label="Downvote"
        aria-pressed="${myVote === -1 ? 'true' : 'false'}"
        data-vote="down"
        data-target-type="${targetType}"
        data-target-id="${id}"
        ${attribute('disabled', options.disabled === true)}
      >${DOWN_ARROW}</button>
    </div>
  `;
}

function altText(image: ImageView, index: number, total: number, author: string): string {
  return image.alt && image.alt.trim() !== '' ? image.alt : copy.fixed.altFallback(index + 1, total, author);
}

export function imageTag(image: ImageView, index: number, total: number, author: string, hidden: boolean): Raw {
  return html`<img
    class="gallery-image"
    ${attribute('hidden', hidden)}
    src="${image.src}"
    srcset="${image.srcset}"
    sizes="(max-width: 767px) 100vw, 680px"
    width="${image.width}"
    height="${image.height}"
    alt="${altText(image, index, total, author)}"
    data-index="${index}"
  />`;
}

export function gallery(post: PostView): Raw {
  if (post.images.length === 0) return raw('');
  const author = post.author ? post.author.username : 'a member';
  const total = post.images.length;
  return html`
    <div
      class="${classes('gallery', post.spoiler && 'is-spoiler')}"
      role="region"
      aria-label="Images"
      tabindex="0"
      data-gallery
      data-count="${total}"
      data-spoiler="${post.spoiler ? 'true' : 'false'}"
    >
      <div class="gallery-frame">
        ${post.images.map((image, index) => imageTag(image, index, total, author, index !== 0))}
        ${post.spoiler
          ? html`<button type="button" class="spoiler-cover" data-show-spoiler>Show spoiler</button>`
          : raw('')}
      </div>
      <div class="gallery-controls">
        <button type="button" class="gallery-previous" aria-label="Previous image" data-gallery-previous>
          <span aria-hidden="true">←</span>
        </button>
        <span class="gallery-counter" id="gallery-counter">Image 1 of ${total}</span>
        <button type="button" class="gallery-next" aria-label="Next image" data-gallery-next>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  `;
}

function byline(post: PostView): Raw {
  return html`
    <p class="byline">
      <a class="byline-community" href="/c/${post.communityName}">c/${post.communityName}</a>
      <span aria-hidden="true">·</span>
      ${post.author
        ? html`<a class="byline-author" href="/u/${post.author.username}">u/${post.author.username}</a>`
        : html`<span class="byline-author">u/[unknown]</span>`}
      <span aria-hidden="true">·</span>
      <time class="byline-time" datetime="${post.createdAt}">${utcTimestamp(post.createdAt)}</time>
      ${post.editedAt ? html`<span class="edited-mark">edited</span>` : raw('')}
    </p>
  `;
}

export function cardThumbnail(post: PostView): Raw {
  if (post.images.length === 0) return raw('');
  const author = post.author ? post.author.username : 'a member';
  const image = post.images[0];
  return html`
    <div class="${classes('card-thumb', post.spoiler && 'is-spoiler')}" data-card-thumb>
      <img
        src="${image.src}"
        srcset="${image.srcset}"
        sizes="120px"
        width="${image.width}"
        height="${image.height}"
        alt="${altText(image, 0, post.images.length, author)}"
      />
      ${post.spoiler ? html`<button type="button" class="spoiler-cover" data-show-spoiler>Show spoiler</button>` : raw('')}
    </div>
  `;
}

/** One post card, used by the home feed, community feeds and profiles. */
export function postCard(post: PostView, options: { pinned?: boolean } = {}): Raw {
  const title = post.title ?? '[removed by moderators]';
  return html`
    <article
      class="${classes('card', options.pinned && 'is-pinned')}"
      id="post-${post.id}"
      tabindex="0"
      aria-labelledby="post-${post.id}-title"
      data-post-card
      data-post-id="${post.id}"
      data-community="${post.communityName}"
      data-version="${post.version}"
    >
      ${voteControls('post', post.id, post.score, post.myVote, { disabled: post.archived })}
      <div class="card-main">
        ${options.pinned ? html`<p class="pin-flag">Pinned</p>` : raw('')}
        <h2 class="card-title">
          <a id="post-${post.id}-title" href="${post.url}">${title}</a>
        </h2>
        ${byline(post)}
        ${cardThumbnail(post)}
        <p class="card-meta">
          <a class="comment-count" id="comments-post-${post.id}" href="${post.url}"
            >${countLabel(post.commentCount, 'comment', 'comments')}</a
          >
          ${post.locked ? html`<span class="lock-flag">${copy.fixed.lockBanner}</span>` : raw('')}
        </p>
      </div>
    </article>
  `;
}

export function feedList(posts: PostView[], pinned: PostView[] = []): Raw {
  return html`${pinned.map((post) => postCard(post, { pinned: true }))}${posts.map((post) => postCard(post))}`;
}

export function lockBanner(post: PostView): Raw {
  if (!post.locked) return raw('');
  return html`
    <div class="lock-banner" data-lock-banner>
      <p>${copy.fixed.lockBanner}</p>
      ${post.lockedUntil ? html`<p>${copy.fixed.lockReopen(post.lockedUntil)}</p>` : raw('')}
    </div>
  `;
}

export interface PostHeaderOptions {
  compact?: boolean;
  isModerator: boolean;
  /** True when this moderator must turn two-factor on before using moderator tools. */
  needsTwoFactor?: boolean;
}

export function postHeader(post: PostView, options: PostHeaderOptions): Raw {
  const removedHeading = post.removal ? copy.fixed.removedHeading(post.removal.publicReason) : null;
  return html`
    <header class="${classes('post-header', options.compact && 'is-compact')}" data-post-header data-post-id="${post.id}" data-version="${post.version}">
      ${voteControls('post', post.id, post.score, post.myVote, { disabled: post.archived })}
      <div class="post-header-main">
        ${removedHeading ? html`<h1 class="removal-heading" data-removal-heading>${removedHeading}</h1>` : raw('')}
        <h1 class="post-title" id="post-${post.id}-title">${post.title ?? '[removed by moderators]'}</h1>
        ${byline(post)}
        <p class="card-meta">
          <span class="comment-count" id="comments-post-${post.id}"
            >${countLabel(post.commentCount, 'comment', 'comments')}</span
          >
        </p>
        <div class="post-menus" data-post-menus>
          <div class="menu" data-menu>
            <button
              type="button"
              class="menu-button"
              aria-haspopup="menu"
              aria-expanded="false"
              data-menu-button="more"
            >More actions</button>
          </div>
          ${options.isModerator
            ? html`<div class="menu" data-menu>
                <button
                  type="button"
                  class="menu-button"
                  aria-haspopup="menu"
                  aria-expanded="false"
                  data-menu-button="moderator"
                  ${attribute('data-needs-two-factor', options.needsTwoFactor === true ? 'true' : null)}
                >Moderator actions</button>
              </div>`
            : raw('')}
        </div>
      </div>
    </header>
  `;
}

export function postBody(post: PostView, options: { isAuthor: boolean; isModerator: boolean }): Raw {
  const privileged = options.isAuthor || options.isModerator;
  return html`
    <div class="post-body" data-post-body>
      ${post.removal && privileged
        ? html`<p class="removal-banner">${copy.fixed.removedHeading(post.removal.publicReason)}</p>`
        : raw('')}
      ${post.archived ? html`<p class="archive-banner">${copy.fixed.archived}</p>` : raw('')}
      ${post.bodyHtml ? raw(post.bodyHtml) : raw('')}
      ${gallery(post)}
    </div>
  `;
}

function commentBody(comment: CommentView): Raw {
  if (comment.state === 'removed') {
    return comment.bodyHtml
      ? html`<p class="placeholder">${copy.fixed.removedCommentBody}</p>
          <div class="comment-text">${raw(comment.bodyHtml)}</div>`
      : html`<p class="placeholder">${copy.fixed.removedCommentBody}</p>`;
  }
  if (comment.state === 'deleted') return html`<p class="placeholder">${copy.fixed.deletedComment}</p>`;
  return html`<div class="comment-text">${raw(comment.bodyHtml ?? '')}</div>`;
}

export interface CommentRenderOptions {
  displayDepth: number;
  folded: Set<string>;
  postUrl: string;
  communityName: string;
  isModerator: boolean;
  viewerUsername: string | null;
  locked: boolean;
  archived: boolean;
  /** Level of the first rendered comment on this page. */
  baseLevel?: number;
}

function commentItem(
  comment: CommentView,
  level: number,
  position: number,
  setSize: number,
  options: CommentRenderOptions,
): Raw {
  const author = comment.author ? comment.author.username : 'a removed member';
  const hasReplies = comment.replies.length > 0 || comment.descendantCount > 0;
  const atDeepest = level >= options.displayDepth;
  const showReplies = comment.replies.length > 0 && !atDeepest;
  const isFolded = options.folded.has(comment.id);
  const continueHref = `${options.postUrl}/comment/${comment.id}`;

  return html`
    <li
      role="treeitem"
      id="comment-${comment.id}"
      class="${classes('comment', isFolded && 'is-folded')}"
      aria-level="${level}"
      aria-setsize="${setSize}"
      aria-posinset="${position}"
      ${hasReplies ? attribute('aria-expanded', isFolded ? 'false' : 'true') : raw('')}
      aria-label="Comment by ${author}"
      tabindex="-1"
      data-comment
      data-comment-id="${comment.id}"
      data-parent-id="${comment.parentId ?? ''}"
      data-depth="${level}"
      data-descendants="${comment.descendantCount}"
      data-author="${author}"
      data-can-edit="${comment.canEdit ? 'true' : 'false'}"
      data-state="${comment.state}"
    >
      <div class="comment-row">
        ${hasReplies
          ? html`<button
              type="button"
              class="fold-rail"
              aria-label="Fold replies to ${author}"
              data-fold-rail
            ><span class="rail-line" aria-hidden="true"></span></button>`
          : html`<span class="fold-rail-spacer" aria-hidden="true"></span>`}
        <div class="comment-main">
          <p class="comment-author-line">
            <a href="/u/${author}">u/${author}</a>
            <span aria-hidden="true">·</span>
            <time datetime="${comment.createdAt}">${utcTimestamp(comment.createdAt)}</time>
            ${comment.editedAt ? html`<span class="edited-mark">edited</span>` : raw('')}
          </p>
          ${hasReplies
            ? html`<button type="button" class="fold-pill" ${attribute('hidden', !isFolded)} data-fold-pill>
                <span aria-hidden="true">▶</span>
                ${countLabel(comment.descendantCount, 'reply folded', 'replies folded')}
              </button>`
            : raw('')}
          <div class="comment-content" ${attribute('hidden', isFolded)} ${attribute('inert', isFolded)}>
            ${commentBody(comment)}
            <div class="comment-actions">
              ${voteControls('comment', comment.id, comment.score, comment.myVote, { disabled: options.archived })}
              ${options.locked || options.archived
                ? raw('')
                : html`<button type="button" class="comment-reply" data-reply-to="${comment.id}">Reply</button>`}
              <div class="menu" data-menu>
                <button
                  type="button"
                  class="menu-button"
                  aria-haspopup="menu"
                  aria-expanded="false"
                  data-menu-button="comment"
                  data-comment-id="${comment.id}"
                >More actions</button>
              </div>
            </div>
            ${atDeepest && hasReplies
              ? html`<p class="continue"><a href="${continueHref}">Continue this thread</a></p>`
              : raw('')}
            ${showReplies ? commentGroup(comment.replies, level + 1, options) : raw('')}
          </div>
        </div>
      </div>
    </li>
  `;
}

function commentGroup(comments: CommentView[], level: number, options: CommentRenderOptions): Raw {
  return html`<ul role="group" class="comment-group">
    ${comments.map((comment, index) => commentItem(comment, level, index + 1, comments.length, options))}
  </ul>`;
}

export function commentTreeMarkup(comments: CommentView[], options: CommentRenderOptions): Raw {
  const base = options.baseLevel ?? 1;
  return html`<ul role="tree" aria-label="Comments" class="comment-tree" id="comment-tree" data-comment-tree>
    ${comments.map((comment, index) => commentItem(comment, base, index + 1, comments.length, options))}
  </ul>`;
}

export function modLogRow(
  entry: ModLogEntryView,
  options: { showModerator: boolean; showPrivate: boolean; communityName: string },
): Raw {
  return html`
    <tr id="mod-log-${entry.id}">
      <td class="cell-time"><time datetime="${entry.at}">${utcTimestamp(entry.at)}</time></td>
      <td class="cell-action">${MOD_LOG_ACTION_TEXT[entry.action] ?? entry.action}</td>
      <td class="cell-target">${modLogTarget(entry, options.communityName)}</td>
      <td class="cell-reason">${entry.publicReason ?? ''}</td>
      ${options.showModerator
        ? html`<td class="cell-moderator">${entry.moderator ? `u/${entry.moderator.username}` : ''}</td>`
        : raw('')}
      ${options.showPrivate ? html`<td class="cell-note">${entry.privateNote ?? ''}</td>` : raw('')}
    </tr>
  `;
}

export function modLogTarget(entry: ModLogEntryView, communityName: string): Raw {
  if (entry.target.type === 'user') return html`<a href="/u/${entry.target.id}">u/${entry.target.id}</a>`;
  if (entry.target.type === 'post') {
    return html`<a href="/c/${communityName}/post/${entry.target.id}">Post ${entry.target.id}</a>`;
  }
  return html`<a href="/c/${communityName}/post/0/comment/${entry.target.id}" data-comment-target="${entry.target.id}"
    >Comment ${entry.target.id}</a
  >`;
}

export function reportRow(report: ReportView, authorUsername: string | null): Raw {
  return html`
    <tr id="report-${report.reference}" class="${classes(report.overdue && 'is-overdue')}" data-report="${report.reference}">
      <td>${report.reference}</td>
      <td>${report.category}</td>
      <td>
        ${report.target.url
          ? html`<a href="${report.target.url}">${report.target.type} ${report.target.id}</a>`
          : html`${report.target.type} ${report.target.id}`}
      </td>
      <td class="cell-deadline" id="deadline-${report.reference}">
        ${deadlineCell(report.secondsRemaining, report.overdue)}
      </td>
      <td class="cell-actions" data-report-actions="${report.reference}">
        ${authorUsername
          ? html`<button type="button" data-suspend="${authorUsername}">Suspend ${authorUsername}</button>`
          : raw('')}
        <button type="button" data-resolve="${report.reference}" data-outcome="actioned">Mark handled</button>
        <button type="button" data-resolve="${report.reference}" data-outcome="dismissed">Dismiss</button>
      </td>
    </tr>
  `;
}
