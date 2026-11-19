import { ApiFailure, api } from '../api.js';
import { el } from '../dom.js';
import { withPending, type AppContext, type Screen } from './shared.js';
import { STORIES } from '../../shared/constants.js';
import type { Party, StoryListEntry } from '../../shared/types.js';

export async function renderStories(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  const { stories } = await api.get<{ stories: StoryListEntry[] }>('/api/stories');
  const page = el('div', { class: 'page stories-page' });
  host.append(page);

  const solo = stories.filter((story) => story.mode === 'solo');
  const coop = stories.filter((story) => story.mode === 'coop');

  page.append(el('h1', { text: ctx.t('nav.stories') }));
  page.append(el('h2', { text: ctx.t('stories.soloHeading') }));

  for (const story of solo) {
    const card = el('section', { class: 'paper-card story-card' }, [
      el('h3', { text: story.title }),
    ]);
    const unlocked = story.progress?.unlocked_chapter ?? 1;
    const completed = story.progress?.completed_chapters ?? [];
    for (let chapter = 1; chapter <= story.chapters; chapter += 1) {
      const button = el('button', { type: 'button', class: 'button' }, [
        ctx.t('btn.playChapter', { n: chapter }),
      ]) as HTMLButtonElement;
      button.disabled = chapter > unlocked;
      button.addEventListener('click', () => {
        void withPending(ctx, button, async () => {
          try {
            const created = await api.post<{ session_id: string }>(
              `/api/stories/${story.id}/sessions`,
              { chapter },
            );
            ctx.navigate(`/play/${created.session_id}`);
          } catch (failure) {
            ctx.announce(
              failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
            );
          }
        });
      });
      card.append(
        el('div', { class: 'chapter-row' }, [
          el('span', { text: ctx.t('chapter.label', { n: chapter }) }),
          completed.includes(chapter)
            ? el('span', { class: 'badge', text: ctx.t('stories.chapterDone') })
            : chapter > unlocked
              ? el('span', { class: 'badge', text: ctx.t('stories.chapterLocked') })
              : null,
          button,
        ]),
      );
    }
    page.append(card);
  }

  page.append(el('h2', { text: ctx.t('stories.coopHeading') }));
  for (const story of coop) {
    const completed = story.progress?.completed_chapters ?? [];
    page.append(
      el('section', { class: 'paper-card story-card' }, [
        el('h3', { text: story.title }),
        el('p', {
          text: `${ctx.t('chapter.label', { n: story.progress?.unlocked_chapter ?? 1 })} · ${completed.length}/${story.chapters}`,
        }),
        el('a', { href: '/lobby', class: 'link', text: ctx.t('stories.goToLobby') }),
      ]),
    );
  }

  return {};
}

export async function renderChapterComplete(
  ctx: AppContext,
  host: HTMLElement,
  storyId: string,
  chapter: number,
): Promise<Screen> {
  const story = STORIES.find((entry) => entry.id === storyId);
  const { party } = await api.get<{ party: Party | null }>('/api/parties/current');
  const page = el('div', { class: 'page paper-card' });
  host.append(page);

  page.append(
    el('h1', { text: ctx.t('chapter.completeHeading', { n: chapter }) }),
    el('p', { text: ctx.t('chapter.motesCollected', { collected: 3 }) }),
  );

  if (story !== undefined && chapter < story.chapters) {
    const next = el('button', { type: 'button', class: 'button primary' }, [
      ctx.t('btn.nextChapter'),
    ]) as HTMLButtonElement;
    next.addEventListener('click', () => {
      void withPending(ctx, next, async () => {
        if (story.mode === 'coop') {
          ctx.navigate(party === null ? '/lobby' : `/party/${party.id}`);
          return;
        }
        try {
          const created = await api.post<{ session_id: string }>(
            `/api/stories/${storyId}/sessions`,
            { chapter: chapter + 1 },
          );
          ctx.navigate(`/play/${created.session_id}`);
        } catch (failure) {
          ctx.announce(
            failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
          );
        }
      });
    });
    page.append(next);
  }

  page.append(el('a', { href: '/stories', class: 'link', text: ctx.t('btn.backToStories') }));

  if (party !== null && party.leader_id === ctx.account?.id) {
    const back = el('button', { type: 'button', class: 'button' }, [
      ctx.t('btn.backToLobby'),
    ]) as HTMLButtonElement;
    back.addEventListener('click', () => {
      void withPending(ctx, back, async () => {
        try {
          await api.post(`/api/parties/${party.id}/return`);
        } catch {
          // The party may already be forming again.
        }
        ctx.navigate(`/party/${party.id}`);
      });
    });
    page.append(back);
  }

  return {};
}
