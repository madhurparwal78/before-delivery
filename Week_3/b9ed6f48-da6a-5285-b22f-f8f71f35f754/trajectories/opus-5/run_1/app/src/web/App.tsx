import { useEffect, useState } from 'react';
import { useRouter } from './lib/router.js';
import { useResource } from './lib/hooks.js';
import { useStore } from './lib/store.js';
import { watchNumeralLinks } from './lib/morph.js';
import { Header } from './components/Header.js';
import { ChapterRail } from './components/ChapterRail.js';
import { PlanDialog } from './components/PlanDialog.js';
import { ChapterIndex } from './pages/ChapterIndex.js';
import { ChapterPage } from './pages/ChapterPage.js';
import { Timeline } from './pages/Timeline.js';
import { Sources } from './pages/Sources.js';
import { Sessions } from './pages/Sessions.js';
import { Support } from './pages/Support.js';
import { Account } from './pages/Account.js';
import { Studio } from './pages/Studio.js';
import { BoxOffice } from './pages/BoxOffice.js';
import { NotFound } from './pages/NotFound.js';
import type { ChapterSummary, SourceRecord, TimelineEvent } from '../shared/types.js';

export function App(): JSX.Element {
  const { route } = useRouter();
  const { reducedMotion, notice, serviceNotice } = useStore();
  const [planOpen, setPlanOpen] = useState(false);
  const chapters = useResource<{ chapters: ChapterSummary[] }>('/api/chapters', route.name);
  const sources = useResource<{ sources: SourceRecord[] }>('/api/sources');
  const events = useResource<{ events: TimelineEvent[] }>('/api/timeline');

  useEffect(() => watchNumeralLinks(), []);

  useEffect(() => {
    document.body.classList.toggle('reduced', reducedMotion);
  }, [reducedMotion]);

  const published = chapters.data?.chapters ?? [];
  const current = route.name === 'chapter' ? route.number : null;
  const fullBleed = route.name === 'chapter';

  return (
    <div className="shell">
      <p role="status" aria-label="Service notice" className="service-notice">
        {serviceNotice ?? ''}
      </p>
      <Header onOpenPlan={() => setPlanOpen(true)} />
      <p role="status" aria-label="Notices" className="notices">
        {notice}
      </p>
      <ChapterRail chapters={published} current={current} />
      <main className={fullBleed ? 'full-bleed' : ''}>
        {route.name === 'index' ? <ChapterIndex chapters={published} /> : null}
        {route.name === 'chapter' ? <ChapterPage number={route.number} chapters={published} /> : null}
        {route.name === 'timeline' ? (
          <Timeline chapters={published} sources={sources.data?.sources ?? []} />
        ) : null}
        {route.name === 'sources' ? (
          <Sources sources={sources.data?.sources ?? []} events={events.data?.events ?? []} />
        ) : null}
        {route.name === 'sessions' ? <Sessions /> : null}
        {route.name === 'support' ? <Support onOpenPlan={() => setPlanOpen(true)} /> : null}
        {route.name === 'account' ? <Account /> : null}
        {route.name === 'studio' ? <Studio chapters={published} /> : null}
        {route.name === 'box-office' ? <BoxOffice /> : null}
        {route.name === 'not-found' ? <NotFound /> : null}
      </main>
      {planOpen ? <PlanDialog onClose={() => setPlanOpen(false)} /> : null}
    </div>
  );
}
