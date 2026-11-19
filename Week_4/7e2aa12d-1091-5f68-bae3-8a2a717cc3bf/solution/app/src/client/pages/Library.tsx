import { useEffect, useState } from 'react';
import { request } from '../lib/api.js';
import { FormDialog } from '../components/Dialogs.js';
import { BlueprintDrawing } from '../components/Icons.js';
import { Link, navigate, signInPath } from '../lib/router.js';
import type { ErrorBody } from '../lib/api.js';
import { UNREACHABLE_PAGE_MESSAGE } from '../../shared/messages.js';
import { TEMPLATE_CHOICES, type TemplateName } from '../../shared/templates.js';
import type { LayoutObject, LibraryEntry } from '../../shared/types.js';

export function LibraryPage() {
  const [layouts, setLayouts] = useState<LibraryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    request<{ layouts: LibraryEntry[] }>('GET', '/api/layouts')
      .then(({ status, body }) => {
        if (status === 401) navigate(signInPath('/'), true);
        else setLayouts(body.layouts);
      })
      .catch(() => setFailed(true));
  }, []);

  const signOut = async (): Promise<void> => {
    await request('DELETE', '/api/session');
    navigate('/signin');
  };

  return (
    <div className="library">
      <header className="topbar">
        <span className="wordmark">Mullion</span>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main>
        <div className="library-head">
          <h1>Your layouts</h1>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New layout
          </button>
        </div>
        {failed ? (
          <p className="problem">{UNREACHABLE_PAGE_MESSAGE}</p>
        ) : layouts === null ? (
          <p className="note">Loading layouts…</p>
        ) : layouts.length === 0 ? (
          <div className="empty">
            <BlueprintDrawing />
            <p>No layouts yet.</p>
          </div>
        ) : (
          <ul className="layout-list">
            {layouts.map((layout) => (
              <li key={layout.id}>
                <Link to={`/layouts/${layout.id}`}>
                  <span className="layout-name">{layout.name}</span>{' '}
                  <span className="mono">
                    {layout.columns.join(' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      {creating && <NewLayoutDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewLayoutDialog({ onClose }: { onClose: () => void }) {
  const [choice, setChoice] = useState<TemplateName>('blank');
  return (
    <FormDialog
      label="New layout"
      field="Layout name"
      initial=""
      submit="Create layout"
      onClose={onClose}
      hint={
        <div role="radiogroup" aria-label="Starter template" className="templates">
          {TEMPLATE_CHOICES.map((template) => (
            <label key={template.name} className="radio">
              <input type="radio" name="template" value={template.name} checked={choice === template.name} onChange={() => setChoice(template.name)} />
              <span>{template.label}</span>
            </label>
          ))}
        </div>
      }
      onSubmit={async (name) => {
        const { status, body } = await request<LayoutObject | ErrorBody>('POST', '/api/layouts', { name, template: choice });
        if (status === 201) {
          navigate(`/layouts/${(body as LayoutObject).id}`);
          return { ok: true };
        }
        return { ok: false, message: (body as ErrorBody).message ?? '' };
      }}
    />
  );
}
