import { config } from '../core/config.js';
import { db, many } from '../core/db.js';
import { errors } from '../core/errors.js';
import { commentSubtree, commentTree } from '../domain/comments.js';
import {
  listApprovedPosters,
  listModerators,
  loadCommunity,
  projectCommunity,
  requiresTwoFactor,
  type Community,
} from '../domain/communities.js';
import { modLogPage, modLogProjection, modLogView } from '../domain/moderation.js';
import { feedPage, loadPostRow, pinnedPosts, projectPost, projectPosts } from '../domain/posts.js';
import { reportQueue, reportTargetAuthor } from '../domain/reports.js';
import { parseSort } from '../domain/validation.js';
import { loadMemberByUsername, moderates, ownAccount } from '../domain/viewer.js';
import { copy, MOD_LOG_ACTION_TEXT } from '../shared/copy.js';
import { countLabel, utcTimestamp } from '../shared/format.js';
import { attribute, html, raw, type Raw } from '../shared/html.js';
import {
  commentTreeMarkup,
  feedList,
  lockBanner,
  modLogRow,
  modLogTarget,
  postBody,
  postHeader,
  reportRow,
} from '../shared/render.js';
import type {
  CommentView,
  CommunityView,
  ModLogEntryView,
  PageData,
  PostView,
  ReportView,
} from '../shared/types.js';
import { document as documentShell, formField, sidebarCommunity } from './layout.js';
import { communityOr404 } from '../server/guards.js';
import { requireMember, route, sendHtml, type Ctx, type Route } from '../server/http.js';

async function railCommunities(ctx: Ctx): Promise<CommunityView[]> {
  if (!ctx.viewer.member) return [];
  const rows = await many<{ name: string }>(
    db,
    `select c.name from memberships m join communities c on c.id = m.community_id
     where m.member_id = $1 order by c.name asc`,
    [ctx.viewer.member.id],
  );
  const list: CommunityView[] = [];
  for (const row of rows) {
    const community = await loadCommunity(db, row.name);
    if (community) list.push((await projectCommunity(community, ctx.viewer)) as unknown as CommunityView);
  }
  return list;
}

function basePageData(ctx: Ctx, route: string, topics: string[]): PageData {
  return {
    route,
    account: ctx.member ? (ownAccount(ctx.member) as unknown as PageData['account']) : null,
    topics,
  };
}

async function respond(
  ctx: Ctx,
  options: { title: string; data: PageData; main: Raw; sidebar?: Raw | null },
): Promise<void> {
  const rail = await railCommunities(ctx);
  sendHtml(
    ctx,
    200,
    documentShell({
      title: options.title,
      nonce: ctx.nonce,
      data: options.data,
      main: options.main,
      sidebar: options.sidebar ?? null,
      rail,
    }),
  );
}

function redirect(ctx: Ctx, location: string): void {
  ctx.res.writeHead(302, { Location: location, 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end();
}

const SORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
];

function sortTabs(active: string): Raw {
  return html`
    <div role="tablist" aria-label="Sort posts" class="sort-tabs" data-sort-tabs>
      ${SORTS.map(
        (sort) => html`<button
          type="button"
          role="tab"
          id="tab-${sort.value}"
          aria-selected="${sort.value === active ? 'true' : 'false'}"
          aria-controls="feed"
          tabindex="${sort.value === active ? '0' : '-1'}"
          data-sort="${sort.value}"
        >${sort.label}</button>`,
      )}
    </div>
  `;
}

function feedSection(posts: PostView[], pinned: PostView[], nextCursor: string | null, emptyCopy: string | null): Raw {
  return html`
    <div role="tabpanel" id="feed" class="feed" data-feed>
      ${posts.length === 0 && pinned.length === 0 && emptyCopy
        ? html`<p class="empty-feed">${emptyCopy}</p>`
        : feedList(posts, pinned)}
    </div>
    <div class="feed-footer" data-feed-footer>
      ${nextCursor
        ? html`<button type="button" data-load-more data-cursor="${nextCursor}">Load more posts</button>`
        : html`<p class="end-of-feed">${copy.fixed.endOfFeed}</p>`}
    </div>
  `;
}

function modLogTable(
  entries: ModLogEntryView[],
  communityName: string,
  options: { showModerator: boolean; showPrivate: boolean; nextCursor: string | null },
): Raw {
  return html`
    <table class="mod-log" aria-label="Moderation log" data-mod-log data-community="${communityName}">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Action</th>
          <th scope="col">Target</th>
          <th scope="col">Reason</th>
          ${options.showModerator ? html`<th scope="col">Moderator</th>` : raw('')}
          ${options.showPrivate ? html`<th scope="col">Private note</th>` : raw('')}
        </tr>
      </thead>
      <tbody data-mod-log-body>
        ${entries.map((entry) => modLogRow(entry, { ...options, communityName }))}
      </tbody>
    </table>
    <div data-mod-log-footer>
      ${options.nextCursor
        ? html`<button type="button" data-load-log data-cursor="${options.nextCursor}">Load more entries</button>`
        : raw('')}
    </div>
  `;
}

function sidebarLogSummary(entries: ModLogEntryView[], communityName: string): Raw {
  if (entries.length === 0) return html`<p class="empty-log">No moderator actions yet</p>`;
  return html`
    <table class="mod-log mod-log-summary" aria-label="Moderation log" data-community="${communityName}">
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">Target</th>
          <th scope="col">Time</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(
          (entry) => html`<tr>
            <td>${MOD_LOG_ACTION_TEXT[entry.action] ?? entry.action}</td>
            <td>${modLogTarget(entry, communityName)}</td>
            <td><time datetime="${entry.at}">${utcTimestamp(entry.at)}</time></td>
          </tr>`,
        )}
      </tbody>
    </table>
  `;
}

async function communitySidebar(ctx: Ctx, community: Community, projected: CommunityView): Promise<Raw> {
  const page = await modLogPage(String(community.id), null, 5);
  const view = modLogView(ctx.viewer, community);
  const entries = page.rows.map((row) => modLogProjection(row, view) as unknown as ModLogEntryView);
  return sidebarCommunity(projected, sidebarLogSummary(entries, community.name));
}

function communityHeader(community: CommunityView): Raw {
  return html`
    <header class="community-header" data-community-header data-community="${community.name}">
      <h1>${community.title}</h1>
      <p class="community-handle">c/${community.name}</p>
      <p class="community-members">
        <span id="members-${community.name}">${countLabel(community.memberCount, 'member', 'members')}</span>
      </p>
      <button
        type="button"
        class="join-button"
        aria-pressed="${community.viewer.joined ? 'true' : 'false'}"
        data-join="${community.name}"
      >${community.viewer.joined ? 'Joined' : 'Join'}</button>
      ${community.viewer.isModerator
        ? html`<p><a href="/c/${community.name}/about/mod">Moderator tools</a></p>`
        : raw('')}
      ${community.viewer.canPost || community.type === 'public'
        ? html`<p><a href="/c/${community.name}/submit">Create a post</a></p>`
        : raw('')}
    </header>
  `;
}

export const pageRoutes: Route[] = [
  route(
    'GET',
    '/',
    async (ctx) => {
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['hot', 'new', 'top'] as const, 'hot');
      const page = await feedPage({
        sort,
        cursor: null,
        viewerId: ctx.viewer.member ? ctx.viewer.member.id : null,
        scope: { kind: 'home', memberId: ctx.viewer.member ? ctx.viewer.member.id : null },
      });
      const posts = (await projectPosts(page.rows, ctx.viewer)) as unknown as PostView[];
      const data = basePageData(ctx, 'home', ['home']);
      data.sort = sort;
      data.posts = posts;
      data.nextCursor = page.nextCursor;
      await respond(ctx, {
        title: 'Moothall',
        data,
        main: html`
          <h1 class="page-heading">Home</h1>
          ${sortTabs(sort)}
          ${feedSection(posts, [], page.nextCursor, ctx.member ? copy.fixed.emptyHome : null)}
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/communities',
    async (ctx) => {
      const rows = await many<{ name: string }>(
        db,
        'select name from communities order by member_count desc, name asc limit $1',
        [config.pageSize],
      );
      const communities: CommunityView[] = [];
      for (const row of rows) {
        const community = await loadCommunity(db, row.name);
        if (community) communities.push((await projectCommunity(community, ctx.viewer)) as unknown as CommunityView);
      }
      const data = basePageData(ctx, 'communities', ['home']);
      data.communities = communities;
      await respond(ctx, {
        title: 'Communities · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Communities</h1>
          <ul class="community-list">
            ${communities.map(
              (community) => html`<li>
                <article id="community-${community.name}" class="community-card">
                  <h2><a href="/c/${community.name}">${community.title}</a></h2>
                  <p class="community-handle">c/${community.name}</p>
                  <p><span id="members-${community.name}">${countLabel(community.memberCount, 'member', 'members')}</span></p>
                  <button
                    type="button"
                    aria-pressed="${community.viewer.joined ? 'true' : 'false'}"
                    data-join="${community.name}"
                  >${community.viewer.joined ? 'Joined' : 'Join'}</button>
                </article>
              </li>`,
            )}
          </ul>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/communities/new',
    async (ctx) => {
      const data = basePageData(ctx, 'community-new', []);
      await respond(ctx, {
        title: 'Create a community · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Create a community</h1>
          <form class="stack" data-create-community novalidate>
            ${formField({ id: 'name', label: 'Name' })}
            ${formField({ id: 'title', label: 'Title' })}
            <div class="field">
              <label for="description">Description</label>
              <textarea id="description" name="description" rows="4" aria-describedby="description-error"></textarea>
              <p class="field-error" id="description-error" hidden></p>
            </div>
            <fieldset class="field" role="radiogroup" aria-label="Type">
              <legend>Type</legend>
              <label><input type="radio" name="type" value="public" checked /> Public</label>
              <label><input type="radio" name="type" value="restricted" /> Restricted</label>
            </fieldset>
            <button type="submit" data-submit>Create community</button>
          </form>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const projected = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['hot', 'new', 'top'] as const, 'hot');
      const viewerId = ctx.viewer.member ? ctx.viewer.member.id : null;
      const page = await feedPage({ sort, cursor: null, viewerId, scope: { kind: 'community', communityId: String(community.id) } });
      const pinned = (await projectPosts(await pinnedPosts(String(community.id), viewerId), ctx.viewer)) as unknown as PostView[];
      const posts = (await projectPosts(page.rows, ctx.viewer)) as unknown as PostView[];

      const data = basePageData(ctx, 'community', ['home', `community:${community.name}`]);
      data.community = projected;
      data.sort = sort;
      data.posts = posts;
      data.pinned = pinned;
      data.nextCursor = page.nextCursor;

      await respond(ctx, {
        title: `${community.title} · Moothall`,
        data,
        main: html`
          ${communityHeader(projected)}
          ${sortTabs(sort)}
          ${feedSection(posts, pinned, page.nextCursor, 'No posts yet')}
        `,
        sidebar: await communitySidebar(ctx, community, projected),
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name/submit',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const projected = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      const data = basePageData(ctx, 'submit', [`community:${community.name}`]);
      data.community = projected;
      await respond(ctx, {
        title: `Submit to c/${community.name} · Moothall`,
        data,
        main: html`
          <h1 class="page-heading">Create a post in c/${community.name}</h1>
          <p class="restricted-notice" data-restricted-notice ${attribute('hidden', projected.viewer.canPost)}>
            ${copy.fixed.restrictedComposer}
          </p>
          <form class="composer stack" data-composer data-community="${community.name}" novalidate>
            ${formField({ id: 'title', label: 'Title' })}
            <div class="field">
              <div role="tablist" aria-label="Body editor" class="editor-tabs" data-editor-tabs>
                <button type="button" role="tab" id="tab-write" aria-selected="true" aria-controls="body-panel" tabindex="0" data-editor="write">Write</button>
                <button type="button" role="tab" id="tab-preview" aria-selected="false" aria-controls="preview-panel" tabindex="-1" data-editor="preview">Preview</button>
              </div>
              <div role="tabpanel" id="body-panel" aria-labelledby="tab-write">
                <label for="body">Body</label>
                <textarea id="body" name="body" rows="10" aria-describedby="body-error"></textarea>
                <p class="field-error" id="body-error" hidden></p>
              </div>
              <div role="tabpanel" id="preview-panel" aria-labelledby="tab-preview" hidden data-preview></div>
            </div>
            <div class="field checkbox">
              <input type="checkbox" id="spoiler" name="spoiler" />
              <label for="spoiler">Spoiler</label>
            </div>
            <div class="field">
              <label for="images">Add images</label>
              <input type="file" id="images" name="images" accept="image/jpeg,image/png,image/webp" multiple data-image-input />
              <p class="field-error" id="images-error" hidden></p>
            </div>
            <ul class="image-tiles" data-image-tiles></ul>
            <button type="submit" data-submit>Post</button>
          </form>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name/about/log',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const page = await modLogPage(String(community.id), null);
      const view = modLogView(ctx.viewer, community);
      const entries = page.rows.map((row) => modLogProjection(row, view) as unknown as ModLogEntryView);
      const data = basePageData(ctx, 'mod-log', [`community:${community.name}`]);
      data.community = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      data.modLog = entries;
      await respond(ctx, {
        title: `Moderation log for c/${community.name} · Moothall`,
        data,
        main: html`
          <h1 class="page-heading">Moderation log for c/${community.name}</h1>
          ${modLogTable(entries, community.name, {
            showModerator: view.isModerator || view.showModNames,
            showPrivate: view.isModerator,
            nextCursor: page.nextCursor,
          })}
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name/about/mod',
    async (ctx) => {
      const member = requireMember(ctx);
      const community = await communityOr404(ctx.params.name);
      if (!moderates(ctx.viewer, String(community.id))) throw errors.forbidden('You are not a moderator here');
      if (requiresTwoFactor(community) && !member.totpEnabled) {
        redirect(ctx, `/settings/2fa?next=/c/${community.name}/about/mod`);
        return;
      }
      const projected = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      const data = basePageData(ctx, 'mod-tools', [`community:${community.name}`]);
      data.community = projected;
      data.moderators = await listModerators(String(community.id));
      data.approved = await listApprovedPosters(String(community.id));

      const tabs = [
        { id: 'moderators', label: 'Moderators' },
        { id: 'approved', label: 'Approved posters' },
        { id: 'rules', label: 'Rules' },
        { id: 'settings', label: 'Settings' },
      ];

      await respond(ctx, {
        title: `Moderator tools for c/${community.name} · Moothall`,
        data,
        main: html`
          <h1 class="page-heading">Moderator tools for c/${community.name}</h1>
          <div role="tablist" aria-label="Moderator tools" class="mod-tabs" data-mod-tabs>
            ${tabs.map(
              (tab, index) => html`<button
                type="button"
                role="tab"
                id="tab-${tab.id}"
                aria-selected="${index === 0 ? 'true' : 'false'}"
                aria-controls="panel-${tab.id}"
                tabindex="${index === 0 ? '0' : '-1'}"
                data-mod-tab="${tab.id}"
              >${tab.label}</button>`,
            )}
          </div>
          <div role="tabpanel" id="panel-moderators" aria-labelledby="tab-moderators" data-mod-panel="moderators">
            <ul data-moderator-list>
              ${(data.moderators ?? []).map(
                (moderator) => html`<li>
                  u/${moderator.username}${moderator.isOwner ? ' (owner)' : ''}
                  ${moderator.isOwner
                    ? raw('')
                    : html`<button type="button" data-remove-moderator="${moderator.username}">
                        Remove ${moderator.username} as moderator
                      </button>`}
                </li>`,
              )}
            </ul>
            <form class="inline-form" data-add-moderator novalidate>
              <label for="moderator-username">Username</label>
              <input id="moderator-username" name="username" type="text" />
              <button type="submit">Add moderator</button>
            </form>
          </div>
          <div role="tabpanel" id="panel-approved" aria-labelledby="tab-approved" data-mod-panel="approved" hidden>
            <ul data-approved-list>
              ${(data.approved ?? []).map(
                (entry) => html`<li>
                  u/${entry.username}
                  <button type="button" data-remove-approval="${entry.username}">
                    Remove approval for ${entry.username}
                  </button>
                </li>`,
              )}
            </ul>
            <form class="inline-form" data-approve-poster novalidate>
              <label for="approved-username">Username</label>
              <input id="approved-username" name="username" type="text" />
              <button type="submit">Approve</button>
            </form>
          </div>
          <div role="tabpanel" id="panel-rules" aria-labelledby="tab-rules" data-mod-panel="rules" hidden>
            <ol class="rule-list">
              ${projected.rules.map((rule) => html`<li><strong>${rule.title}</strong> ${rule.description}</li>`)}
            </ol>
          </div>
          <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" data-mod-panel="settings" hidden>
            <div class="field checkbox">
              <input
                type="checkbox"
                id="show-mod-names"
                data-show-mod-names
                ${attribute('checked', projected.showModNames)}
              />
              <label for="show-mod-names">Show moderator names in the public log</label>
            </div>
          </div>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name/post/:id',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const row = await loadPostRow(db, ctx.params.id, ctx.viewer.member ? ctx.viewer.member.id : null);
      if (!row || String(row.community_id) !== String(community.id)) throw errors.notFound('Post not found');
      const post = (await projectPost(row, ctx.viewer)) as unknown as PostView;
      const isModerator = moderates(ctx.viewer, String(community.id));
      const isAuthor = ctx.member !== null && String(row.author_id) === ctx.member.id;
      const needsTwoFactor =
        isModerator && requiresTwoFactor(community) && ctx.member !== null && !ctx.member.totpEnabled;
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['top', 'new'] as const, 'top');
      const tree = await commentTree(String(row.id), ctx.viewer, { isModerator }, sort, 8);
      const comments = tree.tree as unknown as CommentView[];

      const data = basePageData(ctx, 'post', ['home', `community:${community.name}`, `post:${post.id}`]);
      data.community = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      data.post = post;
      data.comments = comments;
      data.more = tree.more;
      data.sort = sort;
      data.displayDepth = 8;

      await respond(ctx, {
        title: `${post.title ?? 'Removed post'} · Moothall`,
        data,
        main: html`
          ${postHeader(post, { isModerator, needsTwoFactor })}
          ${lockBanner(post)}
          ${postBody(post, { isAuthor, isModerator })}
          ${commentComposer(post)}
          ${commentSortTabs(sort)}
          ${commentTreeMarkup(comments, {
            displayDepth: 8,
            folded: new Set(),
            postUrl: post.url,
            communityName: community.name,
            isModerator,
            viewerUsername: ctx.member ? ctx.member.username : null,
            locked: post.locked,
            archived: post.archived,
          })}
        `,
        sidebar: await communitySidebar(ctx, community, data.community),
      });
    },
    'none',
  ),

  route(
    'GET',
    '/c/:name/post/:postId/comment/:commentId',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const row = await loadPostRow(db, ctx.params.postId, ctx.viewer.member ? ctx.viewer.member.id : null);
      if (!row || String(row.community_id) !== String(community.id)) throw errors.notFound('Post not found');
      const post = (await projectPost(row, ctx.viewer)) as unknown as PostView;
      const isModerator = moderates(ctx.viewer, String(community.id));
      const needsTwoFactor =
        isModerator && requiresTwoFactor(community) && ctx.member !== null && !ctx.member.totpEnabled;
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['top', 'new'] as const, 'top');
      const subtree = await commentSubtree(ctx.params.commentId, ctx.viewer, { isModerator }, sort, 8);
      if (!subtree) throw errors.notFound('Comment not found');
      const comments = subtree.tree.tree as unknown as CommentView[];

      const data = basePageData(ctx, 'continue', ['home', `community:${community.name}`, `post:${post.id}`]);
      data.community = (await projectCommunity(community, ctx.viewer)) as unknown as CommunityView;
      data.post = post;
      data.comments = comments;
      data.more = subtree.tree.more;
      data.rootCommentId = ctx.params.commentId;
      data.sort = sort;
      data.displayDepth = 8;

      await respond(ctx, {
        title: `Thread in c/${community.name} · Moothall`,
        data,
        main: html`
          ${postHeader(post, { compact: true, isModerator, needsTwoFactor })}
          <p><a href="${post.url}">Back to full thread</a></p>
          ${lockBanner(post)}
          ${commentTreeMarkup(comments, {
            displayDepth: 8,
            folded: new Set(),
            postUrl: post.url,
            communityName: community.name,
            isModerator,
            viewerUsername: ctx.member ? ctx.member.username : null,
            locked: post.locked,
            archived: post.archived,
          })}
        `,
        sidebar: await communitySidebar(ctx, community, data.community),
      });
    },
    'none',
  ),

  route(
    'GET',
    '/u/:username',
    async (ctx) => {
      const member = await loadMemberByUsername(ctx.params.username);
      if (!member) throw errors.notFound('Account not found');
      const page = await feedPage({
        sort: 'new',
        cursor: null,
        viewerId: ctx.viewer.member ? ctx.viewer.member.id : null,
        scope: { kind: 'author', authorId: member.id },
      });
      const posts = (await projectPosts(page.rows, ctx.viewer)) as unknown as PostView[];
      const data = basePageData(ctx, 'profile', ['home']);
      data.profile = { username: member.username, createdAt: member.createdAt };
      data.posts = posts;
      data.nextCursor = page.nextCursor;
      await respond(ctx, {
        title: `u/${member.username} · Moothall`,
        data,
        main: html`
          <h1 class="page-heading">u/${member.username}</h1>
          <p class="profile-joined">
            Joined <time datetime="${member.createdAt}">${new Date(member.createdAt).toISOString().slice(0, 10)}</time>
          </p>
          ${feedSection(posts, [], page.nextCursor, 'No posts yet')}
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/signup',
    async (ctx) => {
      await respond(ctx, {
        title: 'Create your account · Moothall',
        data: basePageData(ctx, 'signup', []),
        main: html`
          <h1 class="page-heading">Create account</h1>
          <form class="stack" data-signup novalidate>
            ${formField({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
            ${formField({ id: 'username', label: 'Username', autocomplete: 'username' })}
            ${formField({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' })}
            <button type="submit" data-submit>Create account</button>
          </form>
          <div data-signup-done hidden></div>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/login',
    async (ctx) => {
      const data = basePageData(ctx, 'login', []);
      data.next = ctx.url.searchParams.get('next');
      await respond(ctx, {
        title: 'Sign in · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Sign in</h1>
          <form class="stack" data-login novalidate>
            ${formField({ id: 'login', label: 'Email or username', autocomplete: 'username' })}
            ${formField({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}
            <div data-totp-step hidden>
              ${formField({ id: 'totp', label: 'Authentication code', autocomplete: 'one-time-code', inputMode: 'numeric' })}
            </div>
            <button type="submit" data-submit>Sign in</button>
          </form>
          <p><a href="/forgot">Forgot your password?</a></p>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/verify',
    async (ctx) => {
      const data = basePageData(ctx, 'verify', []);
      data.token = ctx.url.searchParams.get('token');
      await respond(ctx, {
        title: 'Confirm your email · Moothall',
        data,
        main: html`
          <h1 class="page-heading" data-verify-heading>${copy.verify.pending}</h1>
          <div data-verify-body></div>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/forgot',
    async (ctx) => {
      await respond(ctx, {
        title: 'Reset your password · Moothall',
        data: basePageData(ctx, 'forgot', []),
        main: html`
          <h1 class="page-heading">Reset your password</h1>
          <form class="stack" data-forgot novalidate>
            ${formField({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
            <button type="submit" data-submit>Send reset link</button>
          </form>
          <div data-forgot-done hidden></div>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/reset',
    async (ctx) => {
      const data = basePageData(ctx, 'reset', []);
      data.token = ctx.url.searchParams.get('token');
      await respond(ctx, {
        title: 'Set a new password · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Set a new password</h1>
          <form class="stack" data-reset novalidate>
            ${formField({ id: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password' })}
            <button type="submit" data-submit>Set new password</button>
          </form>
          <div data-reset-done hidden></div>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/settings',
    async (ctx) => {
      const member = requireMember(ctx);
      await respond(ctx, {
        title: 'Settings · Moothall',
        data: basePageData(ctx, 'settings', []),
        main: html`
          <h1 class="page-heading">Settings</h1>
          <h2>Username</h2>
          <p class="settings-username">${member.username}</p>
          <p class="settings-note">${copy.account.usernameNote}</p>
          <h2>Two-factor authentication</h2>
          <p>${member.totpEnabled ? copy.totp.enabled : 'Two-factor authentication is off'}</p>
          <p><a href="/settings/2fa">Set up two-factor authentication</a></p>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/settings/2fa',
    async (ctx) => {
      requireMember(ctx);
      const data = basePageData(ctx, 'totp', []);
      data.next = ctx.url.searchParams.get('next');
      await respond(ctx, {
        title: 'Set up two-factor authentication · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Set up two-factor authentication</h1>
          <p>Add this secret to your authenticator app, then enter the code it shows.</p>
          <p class="totp-secret" id="totp-secret" data-totp-secret></p>
          <form class="stack" data-totp novalidate>
            ${formField({ id: 'code', label: 'Authentication code', autocomplete: 'one-time-code', inputMode: 'numeric' })}
            <button type="submit" data-submit>Turn on two-factor authentication</button>
          </form>
        `,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/admin/reports',
    async (ctx) => {
      const member = requireMember(ctx);
      if (member.role !== 'admin') throw errors.forbidden('Only site admins can do that');
      if (!member.totpEnabled) {
        redirect(ctx, '/settings/2fa?next=/admin/reports');
        return;
      }
      const queue = await reportQueue('open');
      const reports = queue.items as unknown as ReportView[];
      const authors = new Map<string, string>();
      for (const report of reports) {
        const author = await reportTargetAuthor(
          report.target.type === 'comment' ? 'comment' : 'post',
          report.target.id,
        );
        if (author) authors.set(report.reference, author.username);
      }
      const data = basePageData(ctx, 'admin', []);
      data.reports = reports;
      data.serverTime = queue.serverTime;
      await respond(ctx, {
        title: 'Illegal-content reports · Moothall',
        data,
        main: html`
          <h1 class="page-heading">Illegal-content reports</h1>
          <table class="report-table" aria-label="Illegal-content reports" data-report-table>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Category</th>
                <th scope="col">Target</th>
                <th scope="col">Deadline</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody data-report-body>
              ${reports.map((report) => reportRow(report, authors.get(report.reference) ?? null))}
            </tbody>
          </table>
        `,
      });
    },
    'none',
  ),
];

function commentComposer(post: PostView): Raw {
  if (post.locked || post.archived || post.state !== 'published') return raw('');
  return html`
    <form class="comment-composer" data-comment-composer novalidate>
      <label for="add-comment">Add a comment</label>
      <textarea id="add-comment" name="bodyMd" rows="4" aria-describedby="add-comment-error"></textarea>
      <p class="field-error" id="add-comment-error" hidden></p>
      <button type="submit" data-submit>Comment</button>
    </form>
  `;
}

function commentSortTabs(active: string): Raw {
  return html`
    <div role="tablist" aria-label="Sort comments" class="comment-sort-tabs" data-comment-sort>
      ${[
        { value: 'top', label: 'Top' },
        { value: 'new', label: 'New' },
      ].map(
        (sort) => html`<button
          type="button"
          role="tab"
          id="comment-tab-${sort.value}"
          aria-selected="${sort.value === active ? 'true' : 'false'}"
          aria-controls="comment-tree"
          tabindex="${sort.value === active ? '0' : '-1'}"
          data-comment-sort-value="${sort.value}"
        >${sort.label}</button>`,
      )}
    </div>
  `;
}
