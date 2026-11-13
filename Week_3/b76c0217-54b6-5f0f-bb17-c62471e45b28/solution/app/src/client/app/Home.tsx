import type { BootOf } from '../../shared/types';
import { AppHeader, siteLinks } from './ui';

export function Home({ boot }: { boot: BootOf<'home'> }) {
  const { me } = boot;
  return (
    <>
      <AppHeader me={me} current="home" {...siteLinks(boot.sites)} />
      <main class="page-wrap">
        <h1>{me.team.name}</h1>
        <p class="crumbs">Signed in as {me.user.name}</p>
        {boot.sites.map((site) => (
          <section key={site.id}>
            <h2>{site.title}</h2>
            <ul class="plain-list">
              {site.versions.map((version) => (
                <li key={version.id}>
                  <a href={`/app/sites/${site.slug}/${version.slug}/pages/`}>{version.title}</a>{' '}
                  <span class="mono">
                    {version.slug}
                    {version.default ? ' · default' : ''}
                    {version.publishedAt ? ' · published' : ' · draft'}
                  </span>
                </li>
              ))}
              <li>
                <a class="row-link" href={`/app/sites/${site.slug}/analytics`}>
                  Analytics
                </a>
              </li>
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
