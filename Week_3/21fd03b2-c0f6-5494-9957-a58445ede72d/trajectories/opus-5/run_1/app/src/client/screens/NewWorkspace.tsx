import { useState } from 'react';
import type { WorkspaceSummary } from '../../shared/api.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { ErrorSummary } from '../components/ErrorSummary.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, Wordmark } from '../components/Toolbar.jsx';
import { useSession } from '../session.js';

const IDS = { name: 'workspace-name' };

export function NewWorkspace(): JSX.Element {
  const { me } = useSession();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFields({});
    try {
      const response = await api<{ workspace: WorkspaceSummary }>('/api/workspaces', {
        method: 'POST',
        body: { name },
      });
      window.location.assign(`/w/${response.workspace.id}`);
    } catch (error) {
      if (error instanceof ApiFault) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Toolbar>
        {me ? <AccountMenu me={me} workspaceId={null} /> : null}
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <div className="panel">
          <div className="panel-head">
            <h1 className="panel-title">New workspace</h1>
          </div>
          <div className="panel-body">
            <ErrorSummary fields={fields} ids={IDS} />
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor={IDS.name}>Workspace name</label>
                <input
                  id={IDS.name}
                  type="text"
                  value={name}
                  aria-invalid={fields.name ? true : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                {fields.name ? <span className="field-error">{fields.name}</span> : null}
              </div>
              <div className="dialog-actions">
                <button type="submit" className="chip on" disabled={busy}>
                  Create workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <LiveRegions />
    </div>
  );
}
