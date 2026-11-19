import { useState } from 'preact/hooks';
import { Button, Loading, NotFound, Screen } from '../ui.tsx';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { SelectField, TextField, useAction, useLoad } from './shared.tsx';
import './settings.css';

interface RepoInfo { your_role: string; settings: { required_approvals: number; required_checks: string[]; queue: boolean } }
interface Grant { subject: string; label: string; role: string }
interface TokenRow { id: number; name: string; access: string }

const ROLES = [{ value: 'reader', label: 'Reader' }, { value: 'writer', label: 'Writer' }, { value: 'maintainer', label: 'Maintainer' }, { value: 'owner', label: 'Owner' }];

export function Settings({ org, repo }: { org: string; repo: string }) {
  const base = `/api/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
  const { data, error, reload } = useLoad(async () => {
    const info = await api<RepoInfo>('GET', base);
    const maintain = info.your_role === 'maintainer' || info.your_role === 'owner';
    const [members, tokens] = await Promise.all([api<Grant[]>('GET', `${base}/roles`), maintain ? api<TokenRow[]>('GET', `${base}/tokens`) : Promise.resolve([] as TokenRow[])]);
    return { info, members, tokens, maintain };
  }, `settings:${org}/${repo}`);
  const [rules, setRules] = useState<{ approvals: string; checks: string; queue: boolean } | null>(null);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [token, setToken] = useState({ name: '', access: 'read' });
  const [tokenErrors, setTokenErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<string | null>(null);
  const [grant, setGrant] = useState({ subject: '', role: 'reader' });
  const [grantErrors, setGrantErrors] = useState<Record<string, string>>({});
  const rulesAction = useAction();
  const tokenAction = useAction();
  const grantAction = useAction();
  const removeAction = useAction();
  if (error) return <NotFound />;
  if (!data) return <Screen><Loading /></Screen>;
  const { info, members, tokens, maintain } = data;
  const current = rules ?? { approvals: String(info.settings.required_approvals), checks: info.settings.required_checks.join(', '), queue: info.settings.queue };
  const subjectOf = (text: string): string => {
    const clean = text.trim().replace(/^@/, '');
    return clean.includes('/') ? `team:${clean.split('/')[1]}` : `user:${clean}`;
  };
  return (
    <Screen>
      <h1 className="page-title">Settings</h1>
      <p className="muted role-note">
        <Link href={`/${org}/${repo}`}>{org}/{repo}</Link> · Your role: {info.your_role}.
        {maintain ? '' : ' Only maintainers and owners can change these settings.'}
      </p>
      <div className="settings-grid">
        <form
          className="bento settings-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setRuleErrors({});
            const result = await rulesAction.run('Saving...', 'Rules saved.', () =>
              api('PUT', `${base}/settings`, {
                required_approvals: current.approvals.trim() === '' ? NaN : Number(current.approvals),
                required_checks: current.checks.split(',').map((name) => name.trim()).filter(Boolean),
                queue: current.queue,
              }),
            );
            if (result.ok) {
              setRules(null);
              await reload();
            } else setRuleErrors(result.fields);
          }}
        >
          <h2>Merge rules</h2>
          <TextField label="Required approvals" type="number" min={0} max={10} disabled={!maintain} value={current.approvals} onValue={(approvals) => setRules({ ...current, approvals })} error={ruleErrors.required_approvals} />
          <TextField label="Required checks" type="text" disabled={!maintain} value={current.checks} onValue={(checks) => setRules({ ...current, checks })} error={ruleErrors.required_checks} />
          <label className="check">
            <input type="checkbox" checked={current.queue} disabled={!maintain} onChange={(event) => setRules({ ...current, queue: (event.target as HTMLInputElement).checked })} />
            Use the merge queue
          </label>
          <Button kind="primary" type="submit" busy={rulesAction.busy} disabled={!maintain}>Save rules</Button>
        </form>

        <div className="split">
          <section className="bento">
            <h2>Tokens</h2>
            <form
              className="settings-form"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                setTokenErrors({});
                setCreated(null);
                const result = await tokenAction.run('Working...', 'Token created.', () => api<{ token: string }>('POST', `${base}/tokens`, token));
                if (result.ok) {
                  setCreated((result.result as { token: string }).token);
                  setToken({ name: '', access: 'read' });
                  await reload();
                } else setTokenErrors(result.fields);
              }}
            >
              <TextField label="Token name" type="text" disabled={!maintain} value={token.name} onValue={(name) => setToken({ ...token, name })} error={tokenErrors.name} />
              <SelectField label="Token access" value={token.access} disabled={!maintain} onValue={(access) => setToken({ ...token, access })} options={[{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }]} />
              <Button kind="secondary" type="submit" busy={tokenAction.busy} disabled={!maintain}>Create token</Button>
            </form>
            {created ? (
              <section className="new-token" role="region" aria-label="New token">
                <TextField label="Token value" type="text" readOnly value={created} onValue={() => undefined} />
                <p>Copy this token now. It is not shown again.</p>
              </section>
            ) : null}
            <ul className="token-list" aria-label="Tokens">
              {tokens.map((item) => (
                <li key={item.id}>
                  <span><span className="name">{item.name}</span> <span className="muted">· {item.access}</span></span>
                  <Button kind="secondary" busy={removeAction.busy} onClick={async () => {
                    if ((await removeAction.run('Working...', 'Token revoked.', () => api('DELETE', `${base}/tokens/${item.id}`))).ok) await reload();
                  }}>{`Revoke ${item.name}`}</Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="bento">
            <h2>Members</h2>
            <form
              className="settings-form"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                setGrantErrors({});
                const result = await grantAction.run('Working...', 'Role granted.', () => api('PUT', `${base}/roles`, { subject: subjectOf(grant.subject), role: grant.role }));
                if (result.ok) {
                  setGrant({ subject: '', role: grant.role });
                  await reload();
                } else setGrantErrors(result.fields);
              }}
            >
              <TextField label="User or team" type="text" autoCapitalize="none" disabled={!maintain} value={grant.subject} onValue={(subject) => setGrant({ ...grant, subject })} error={grantErrors.subject} />
              <SelectField label="Role" value={grant.role} disabled={!maintain} onValue={(role) => setGrant({ ...grant, role })} options={ROLES} />
              {grantErrors.role ? <span role="alert" className="field-error">{grantErrors.role}</span> : null}
              <Button kind="secondary" type="submit" busy={grantAction.busy} disabled={!maintain}>Grant role</Button>
            </form>
            <ul className="member-rows" aria-label="Members">
              {members.map((item) => {
                const shown = item.subject.startsWith('team:') ? item.label : item.subject.slice(5);
                return (
                  <li key={item.subject}>
                    <span><span className="name">{shown}</span> <span className="muted">· {item.role}</span></span>
                    {maintain ? (
                      <Button kind="secondary" busy={removeAction.busy} onClick={async () => {
                        if ((await removeAction.run('Working...', 'Role removed.', () => api('DELETE', `${base}/roles/${encodeURIComponent(item.subject)}`))).ok) await reload();
                      }}>{`Remove ${shown}`}</Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </Screen>
  );
}
