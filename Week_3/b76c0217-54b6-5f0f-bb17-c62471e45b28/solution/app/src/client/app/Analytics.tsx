import { useLayoutEffect, useState } from 'preact/hooks';
import type { AnalyticsJson, BootOf } from '../../shared/types';
import { api } from './api';
import { useEventStream } from './hooks';
import { AppHeader, siteLinks } from './ui';

export function Analytics({ boot }: { boot: BootOf<'analytics'> }) {
  const { me, site } = boot;
  const [data, setData] = useState<AnalyticsJson | null>(boot.analytics);
  const load = (): void => {
    void api<AnalyticsJson>('GET', `/api/sites/${site.id}/analytics`).then((result) => result.ok && setData(result.data));
  };
  useLayoutEffect(load, []);
  useEventStream('', { analytics: (event) => event.siteId === site.id && load() });

  return (
    <>
      <AppHeader me={me} current="analytics" {...siteLinks([site])} />
      <main class="page-wrap">
        <p class="crumbs">{site.title}</p>
        <h1>Analytics</h1>
        <div class="data-wrap">
          <table class="data-table">
            <caption>Page ratings</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Yes</th>
                <th scope="col">No</th>
                <th scope="col">Helpful</th>
              </tr>
            </thead>
            <tbody>
              {(data?.pageRatings ?? []).map((row) => (
                <tr key={row.pageId}>
                  <td>
                    {row.title} <span class="mono field-meta">{row.versionSlug}</span>
                  </td>
                  <td class="mono">{row.yes}</td>
                  <td class="mono">{row.no}</td>
                  <td class="mono">{row.helpful}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="data-wrap">
          <table class="data-table">
            <caption>Search terms</caption>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col">Searches</th>
                <th scope="col">Results</th>
              </tr>
            </thead>
            <tbody>
              {(data?.searchTerms ?? []).map((row) => (
                <tr key={row.term}>
                  <td class="mono">{row.term}</td>
                  <td class="mono">{row.searches}</td>
                  <td class="mono">{row.results}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
