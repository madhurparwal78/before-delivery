import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ACTIONS, TOPICS } from '../shared/types.js';
import type { RuleAction, RuleBody, RuleEffect, RuleTopic, TeamBody } from '../shared/types.js';
import { announce, useAnnouncement } from './announce.js';
import { ApiError, api } from './api.js';
import { Column, FormSummary } from './Chrome.js';
import type { FormError } from './Chrome.js';
import { Banner } from './WorkspacePage.js';

const ruleText = (rule: RuleBody): string => `${rule.effect} ${rule.action} on ${rule.topic === '*' ? 'all topics' : `${rule.topic} threads`}`;

function Moderator({ moderator, onChange }: { moderator: TeamBody['moderators'][number]; onChange: () => Promise<void> }) {
  const [effect, setEffect] = useState<RuleEffect>('grant');
  const [action, setAction] = useState<RuleAction>('read');
  const [topic, setTopic] = useState<RuleTopic>('*');
  const [errors, setErrors] = useState<FormError[]>([]);
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    announce('Team announcements', 'Adding rule...');
    try {
      await api(`/api/team/${moderator.id}/rules`, { method: 'POST', body: { effect, action, topic } });
      setErrors([]);
      announce('Team announcements', 'Rule added.');
      await onChange();
    } catch (error) {
      setErrors(error instanceof ApiError ? Object.entries(error.fields).map(([field, message]) => ({ field, message })) : []);
      announce('Team announcements', 'Rule not saved. Try again.');
    }
  };
  const revoke = async (rule: RuleBody): Promise<void> => {
    announce('Team announcements', 'Revoking rule...');
    try {
      await api(`/api/team/${moderator.id}/rules/${rule.id}`, { method: 'DELETE' });
      announce('Team announcements', 'Rule revoked.');
      await onChange();
    } catch {
      announce('Team announcements', 'Rule not revoked. Try again.');
    }
  };
  const fieldError = (field: string): string | undefined => errors.find((error) => error.field === field)?.message;
  return (
    <section className="moderator" aria-label={moderator.name}>
      <h2>{moderator.name}</h2>
      <ul className="rules" role="list" aria-label="Rules">
        {moderator.rules.map((rule) => (
          <li key={rule.id}>
            <span>{ruleText(rule)}</span>
            <button type="button" className="text-button" aria-label={`Revoke ${ruleText(rule)}`} onClick={() => void revoke(rule)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={(event) => void add(event)}>
        <FormSummary errors={errors} />
        <label htmlFor={`effect-${moderator.id}`} className="label">Effect</label>
        <select id={`effect-${moderator.id}`} className="field" value={effect} onChange={(event) => setEffect(event.target.value as RuleEffect)}>
          <option value="grant">grant</option>
          <option value="deny">deny</option>
        </select>
        {fieldError('effect') ? <p className="error">{fieldError('effect')}</p> : null}
        <label htmlFor={`action-${moderator.id}`} className="label">Action</label>
        <select id={`action-${moderator.id}`} className="field" value={action} onChange={(event) => setAction(event.target.value as RuleAction)}>
          {ACTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {fieldError('action') ? <p className="error">{fieldError('action')}</p> : null}
        <label htmlFor={`topic-${moderator.id}`} className="label">Topic</label>
        <select id={`topic-${moderator.id}`} className="field" value={topic} onChange={(event) => setTopic(event.target.value as RuleTopic)}>
          <option value="*">all topics</option>
          {TOPICS.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {fieldError('topic') ? <p className="error">{fieldError('topic')}</p> : null}
        <button type="submit" className="button primary">Add rule</button>
      </form>
    </section>
  );
}

export function TeamPage() {
  const [team, setTeam] = useState<TeamBody | null>(null);
  const status = useAnnouncement('Team announcements');
  const load = async (): Promise<void> => setTeam(await api<TeamBody>('/api/team'));
  useEffect(() => {
    document.title = 'Team · Hushline';
    void load().catch(() => undefined);
  }, []);
  return (
    <>
    <Banner developer />
    <main className="screen">
      <Column>
        <h1>Team</h1>
        {team?.moderators.map((moderator) => <Moderator key={moderator.id} moderator={moderator} onChange={load} />)}
        <div role="status" aria-label="Team announcements" aria-live="polite" className="announcements">{status}</div>
      </Column>
    </main>
    </>
  );
}
