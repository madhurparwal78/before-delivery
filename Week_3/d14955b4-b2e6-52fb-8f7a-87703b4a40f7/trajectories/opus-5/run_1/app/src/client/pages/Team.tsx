import { useEffect, useState } from 'react';
import { COPY } from '../../shared/copy';
import type { RuleAction, RuleEffect, RuleTopic, TeamBody } from '../../shared/types';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ruleText } from '../lib/format';

const EFFECTS: RuleEffect[] = ['grant', 'deny'];
const ACTIONS: RuleAction[] = ['read', 'reply', 'close', 'receipts'];
const TOPIC_OPTIONS: Array<{ value: RuleTopic; label: string }> = [
  { value: '*', label: 'all topics' },
  { value: 'bug', label: 'bug' },
  { value: 'account', label: 'account' },
  { value: 'purchase', label: 'purchase' },
  { value: 'other', label: 'other' },
];

export function TeamPage(): React.ReactElement {
  const [team, setTeam] = useState<TeamBody | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [effect, setEffect] = useState<RuleEffect>('grant');
  const [action, setAction] = useState<RuleAction>('read');
  const [topic, setTopic] = useState<RuleTopic>('*');

  const load = async (): Promise<void> => {
    try {
      setTeam(await api<TeamBody>('/api/team'));
    } catch {
      navigate('/inbox');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addRule = async (moderatorId: string): Promise<void> => {
    setAnnouncement(COPY.addingRule);
    try {
      await api(`/api/team/${encodeURIComponent(moderatorId)}/rules`, {
        method: 'POST',
        body: { effect, action, topic },
      });
      setAnnouncement(COPY.ruleAdded);
      await load();
    } catch {
      setAnnouncement(COPY.ruleNotSaved);
    }
  };

  const revokeRule = async (moderatorId: string, ruleId: string): Promise<void> => {
    setAnnouncement(COPY.revokingRule);
    try {
      await api(`/api/team/${encodeURIComponent(moderatorId)}/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      });
      setAnnouncement(COPY.ruleRevoked);
      await load();
    } catch {
      setAnnouncement(COPY.ruleNotRevoked);
    }
  };

  return (
    <div className="column form-page">
      <header className="banner">
        <a href="/inbox" onClick={(event) => { event.preventDefault(); navigate('/inbox'); }}>
          Inbox
        </a>
        <a href="/team" onClick={(event) => { event.preventDefault(); navigate('/team'); }}>
          Team
        </a>
      </header>
      <h1>Team</h1>
      {(team?.moderators ?? []).map((moderator) => (
        <section key={moderator.id} role="region" aria-label={moderator.name} className="moderator">
          <h2>{moderator.name}</h2>
          <ul aria-label="Rules" className="rules">
            {moderator.rules.map((rule) => (
              <li key={rule.id}>
                <span>{ruleText(rule)}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void revokeRule(moderator.id, rule.id)}
                >
                  {`Revoke ${ruleText(rule)}`}
                </button>
              </li>
            ))}
          </ul>
          <div className="field">
            <label htmlFor={`effect-${moderator.id}`}>Effect</label>
            <select
              id={`effect-${moderator.id}`}
              value={effect}
              onChange={(event) => setEffect(event.target.value as RuleEffect)}
            >
              {EFFECTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`action-${moderator.id}`}>Action</label>
            <select
              id={`action-${moderator.id}`}
              value={action}
              onChange={(event) => setAction(event.target.value as RuleAction)}
            >
              {ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`topic-${moderator.id}`}>Topic</label>
            <select
              id={`topic-${moderator.id}`}
              value={topic}
              onChange={(event) => setTopic(event.target.value as RuleTopic)}
            >
              {TOPIC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="accent-button" onClick={() => void addRule(moderator.id)}>
            Add rule
          </button>
        </section>
      ))}
      <p className="live-region" role="status" aria-label="Team announcements" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
