// The curator profile and the public cluster page.

import type { FeedCard, PublicCluster } from '../../shared/types.js';
import { api, el, link, navigate, notFoundPage, session } from '../lib.js';
import { topBar } from '../app.js';
import { announce } from '../lib.js';

interface ProfilePayload {
  displayName: string;
  handle: string;
  followerCount: number;
  clusters: { id: string; title: string; publishedAt: string; publicItemCount: number; coverUrl: string | null }[];
}

export async function renderProfile(handle: string): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  const page = el('div');
  page.append(topBar({ account: acc }));
  const main = el('main');
  const r = await api<ProfilePayload>('GET', `/api/curators/${handle}`);
  if (!r.ok) {
    main.append(notFoundPage().firstElementChild ?? el('div'));
    page.append(main);
    return page;
  }
  const profile = r.data!;
  const header = el('header', { class: 'panel stack' });
  header.append(el('h1', {}, profile.displayName));
  const meta = el('p', { class: 'muted mono' });
  meta.append(el('span', {}, `@${profile.handle}`), el('span', {}, ` · `), el('span', { id: 'follower-count' }, `${profile.followerCount} followers`));
  header.append(meta);

  const status = el('div', { id: 'profile-status', role: 'status', class: 'visually-hidden' });
  status.setAttribute('aria-live', 'polite');

  const isSelf = acc?.handle === profile.handle;
  if (!isSelf) {
    const followBtn = el('button', { class: 'btn', id: 'follow-btn', type: 'button', 'aria-pressed': 'false' }, 'Follow') as HTMLButtonElement;
    followBtn.addEventListener('click', async () => {
      if (!acc) {
        navigate(`/signin?next=${encodeURIComponent(`/@${handle}`)}`);
        return;
      }
      const following = followBtn.getAttribute('aria-pressed') === 'true';
      const method = following ? 'DELETE' : 'POST';
      // Optimistic: toggle at once and change the count by one.
      const countEl = document.getElementById('follower-count')!;
      const beforeCount = Number(/(\d+)/.exec(countEl.textContent ?? '')?.[1] ?? 0);
      const nextCount = following ? beforeCount - 1 : beforeCount + 1;
      followBtn.setAttribute('aria-pressed', following ? 'false' : 'true');
      followBtn.textContent = following ? 'Follow' : 'Following';
      countEl.textContent = `${nextCount} followers`;
      const rr = await api<{ following: boolean; followerCount: number }>(method, `/api/curators/${handle}/follow`);
      if (rr.ok && rr.data) {
        followBtn.setAttribute('aria-pressed', rr.data.following ? 'true' : 'false');
        followBtn.textContent = rr.data.following ? 'Following' : 'Follow';
        countEl.textContent = `${rr.data.followerCount} followers`;
        announce('profile-status', rr.data.following ? `Following ${profile.displayName}. ${rr.data.followerCount} followers.` : `Unfollowed ${profile.displayName}. ${rr.data.followerCount} followers.`);
        return;
      }
      // Roll back honestly.
      followBtn.setAttribute('aria-pressed', following ? 'true' : 'false');
      followBtn.textContent = following ? 'Following' : 'Follow';
      countEl.textContent = `${beforeCount} followers`;
      announce('profile-status', `Could not update the follow. ${beforeCount} followers.`);
    });
    header.append(followBtn);
  }
  header.append(status);

  const grid = el('div', { class: 'feed-grid' });
  const feed = el('div', { role: 'feed', class: 'feed', 'aria-label': 'Public clusters' });
  grid.append(feed);
  for (const c of profile.clusters) {
    const article = el('article', { class: 'feed-card' });
    if (c.coverUrl) {
      const img = el('img', { src: c.coverUrl, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.remove());
      article.append(img);
    }
    const body = el('div', { class: 'card-body' });
    body.append(el('h2', { class: 'card-title' }, link(`/c/${c.id}`, c.title)));
    body.append(el('div', { class: 'card-meta mono' }, `${c.publicItemCount} items`));
    article.append(body);
    feed.append(article);
  }
  if (profile.clusters.length === 0) {
    feed.append(el('p', { class: 'muted' }, 'No public clusters yet.'));
  }

  main.append(header, grid);
  page.append(main);
  return page;
}

export async function renderPublicCluster(clusterId: string): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  const page = el('div');
  page.append(topBar({ account: acc }));
  const main = el('main');
  const r = await api<PublicCluster>('GET', `/api/public/clusters/${clusterId}`);
  if (!r.ok) {
    main.append(notFoundPage().firstElementChild ?? el('div'));
    page.append(main);
    return page;
  }
  const cluster = r.data!;
  main.append(el('h1', {}, cluster.title));
  if (cluster.publicDescription) {
    main.append(el('p', { class: 'muted' }, cluster.publicDescription));
  }
  const credits = el('ul', { id: 'credits', class: 'row', 'aria-label': 'Credits' });
  for (const credit of cluster.credits) {
    credits.append(el('li', {}, link(`/@${credit.handle}`, `${credit.displayName} (@${credit.handle})`)));
  }
  main.append(credits, el('p', { class: 'mono', 'aria-label': 'Item count' }, `${cluster.publicItemCount} items`));

  const grid = el('div', { class: 'masonry' });
  const list = el('ul', { id: 'public-items', 'aria-label': 'Items', class: 'masonry' });
  for (const item of cluster.items) {
    const li = el('li', {}, el('article', { class: 'ref-card' }));
    const card = li.firstElementChild as HTMLElement;
    const img = el('img', { src: item.mediaUrl, alt: '', loading: 'lazy' });
    card.append(img, el('div', { class: 'ref-title-full' }, `${item.position}. ${item.title}`));
    if (item.kind === 'still' && item.sourceClipTitle && item.timecode) {
      card.append(el('div', { class: 'still-meta' }, `${item.sourceClipTitle} · ${item.timecode}`));
    }
    list.append(li);
  }
  grid.append(list);
  main.append(grid);
  page.append(main);
  return page;
}
