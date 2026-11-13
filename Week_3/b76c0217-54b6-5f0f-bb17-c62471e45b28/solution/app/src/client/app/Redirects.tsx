import { useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import type { BootOf, NavigationJson, RedirectJson } from '../../shared/types';
import { announce, setBusy } from '../shared/dom';
import { api } from './api';
import { useEventStream } from './hooks';
import { AppHeader, FieldError, fieldProps } from './ui';

export function Redirects({ boot }: { boot: BootOf<'redirects'> }) {
  const { me, site, version } = boot;
  const [redirects, setRedirects] = useState<RedirectJson[]>(boot.navigation.redirects);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const from = useRef<HTMLInputElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const canEdit = me.role !== 'viewer';
  useEventStream(`?versionId=${version.id}`, { navigation: (nav) => setRedirects(nav.redirects) });

  return (
    <>
      <AppHeader me={me} current="redirects" editorHref={`/app/sites/${site.slug}/${version.slug}/pages/`} analyticsHref={`/app/sites/${site.slug}/analytics`} />
      <main class="page-wrap">
        <p class="crumbs">
          {site.title} <span class="mono">{version.slug}</span>
        </p>
        <h1>Redirects</h1>
        <div class="data-wrap">
          <table class="data-table" aria-label="Redirects">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Kind</th>
                {canEdit && <th scope="col" />}
              </tr>
            </thead>
            <tbody>
              {redirects.map((redirect) => (
                <tr key={redirect.from}>
                  <td class="mono">{redirect.from}</td>
                  <td class="mono">{redirect.to}</td>
                  <td>{redirect.kind}</td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        class="button"
                        aria-label={`Remove redirect from ${redirect.from}`}
                        onClick={async () => {
                          const result = await api<NavigationJson>('DELETE', `/api/versions/${version.id}/redirects?from=${encodeURIComponent(redirect.from)}`);
                          if (result.ok) {
                            setRedirects(result.data.redirects);
                            announce(copy.redirectRemoved(redirect.from));
                          } else {
                            announce(result.failure.message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {redirects.length === 0 && <p>No redirects filed yet.</p>}
        {canEdit && (
          <form
            class="inline-form"
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              const button = (event.currentTarget as HTMLFormElement).querySelector('button') as HTMLElement;
              const body = { from: from.current?.value.trim() ?? '', to: to.current?.value.trim() ?? '' };
              setBusy(button, true);
              const result = await api<NavigationJson>('POST', `/api/versions/${version.id}/redirects`, body);
              setBusy(button, false);
              if (result.ok) {
                setErrors({});
                setRedirects(result.data.redirects);
                if (from.current && to.current) {
                  from.current.value = '';
                  to.current.value = '';
                }
                const added = result.data.redirects.find((candidate) => !redirects.some((known) => known.from === candidate.from));
                if (added) {
                  announce(copy.redirectAdded(added.from, added.to));
                }
                return;
              }
              const found = result.failure.fields ?? { [result.failure.code === 'redirect_exists' ? 'from' : 'to']: result.failure.message };
              setErrors(found);
              const [name] = Object.keys(found);
              (name === 'from' ? from.current : to.current)?.focus();
              announce(Object.values(found)[0] ?? result.failure.message);
            }}
          >
            <div class="field">
              <label for="redirect-from">From</label>
              <input id="redirect-from" ref={from} type="text" class="mono" autocomplete="off" spellcheck={false} placeholder="/old-path" {...fieldProps('redirect-from', errors.from)} />
              <FieldError id="redirect-from" message={errors.from} />
            </div>
            <div class="field">
              <label for="redirect-to">To</label>
              <input id="redirect-to" ref={to} type="text" class="mono" autocomplete="off" spellcheck={false} placeholder="/new-path" {...fieldProps('redirect-to', errors.to)} />
              <FieldError id="redirect-to" message={errors.to} />
            </div>
            <button type="submit" class="button primary">
              Add redirect
            </button>
          </form>
        )}
      </main>
    </>
  );
}
