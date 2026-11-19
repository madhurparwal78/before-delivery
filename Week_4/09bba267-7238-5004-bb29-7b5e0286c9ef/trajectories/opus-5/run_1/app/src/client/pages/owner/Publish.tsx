import { useCallback, useState, type ReactNode } from 'react';
import { COPY, publishedAnnouncement } from '../../../shared/copy';
import { api } from '../../lib/api';
import { useAnnouncer } from '../../lib/announce';
import { OwnerFrame } from './OwnerFrame';

const ROW_ID_PATTERN = /^(?:ST|CI|BA)-[A-P]$/;

interface TierDraft {
  readonly name: string;
  readonly dollars: string;
  readonly seating: string;
}

export function OwnerPublish(): ReactNode {
  const { announce } = useAnnouncer();
  const [title, setTitle] = useState('');
  const [startsLocal, setStartsLocal] = useState('');
  const [tiers, setTiers] = useState<TierDraft[]>([{ name: '', dollars: '', seating: '' }]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => (await api.ownerPerformances()).status, []);

  const publish = async (): Promise<void> => {
    setWorking(true);
    setFieldErrors({});
    const body = {
      title,
      startsLocal,
      tiers: tiers.map((tier) => {
        const parts = tier.seating
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '');
        const dollars = Number(tier.dollars);
        return {
          name: tier.name,
          faceCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
          rows: parts.filter((part) => ROW_ID_PATTERN.test(part)),
          seats: parts.filter((part) => !ROW_ID_PATTERN.test(part)),
        };
      }),
    };
    const result = await api.ownerPublish(body);
    setWorking(false);
    if (result.status === 201) {
      announce(publishedAnnouncement(title));
      setTitle('');
      setStartsLocal('');
      setTiers([{ name: '', dollars: '', seating: '' }]);
      return;
    }
    setFieldErrors(result.fields ?? {});
    announce(COPY.checkDetails);
  };

  const messages = Object.entries(fieldErrors);

  return (
    <OwnerFrame load={load}>
      <h1>Publish performance</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!working) void publish();
        }}
      >
        {messages.length > 0 ? (
          <div className="error-summary">
            <h2>Check these details</h2>
            <ul>
              {messages.map(([name, message]) => (
                <li key={name}>
                  <a
                    href={`#publish-${name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`publish-${name}`)?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="publish-title">Title</label>
          <input id="publish-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {fieldErrors.title === undefined ? null : <p className="field-error">{fieldErrors.title}</p>}
        </div>
        <div className="field">
          <label htmlFor="publish-startsLocal">Start (venue time)</label>
          <input
            id="publish-startsLocal"
            value={startsLocal}
            placeholder="2027-02-12T20:00"
            onChange={(event) => setStartsLocal(event.target.value)}
          />
          {fieldErrors.startsLocal === undefined ? null : <p className="field-error">{fieldErrors.startsLocal}</p>}
        </div>
        {tiers.map((tier, index) => (
          <fieldset key={index}>
            <legend>{`Tier ${index + 1}`}</legend>
            <div className="field">
              <label htmlFor={`tier-name-${index}`}>Tier name</label>
              <input
                id={`tier-name-${index}`}
                value={tier.name}
                onChange={(event) =>
                  setTiers((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`tier-face-${index}`}>Face value in dollars</label>
              <input
                id={`tier-face-${index}`}
                value={tier.dollars}
                onChange={(event) =>
                  setTiers((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, dollars: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`tier-seating-${index}`}>Rows and seats</label>
              <input
                id={`tier-seating-${index}`}
                value={tier.seating}
                placeholder="ST-B, ST-A-15"
                onChange={(event) =>
                  setTiers((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, seating: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            {tiers.length > 1 ? (
              <button
                type="button"
                onClick={() => setTiers((current) => current.filter((_, position) => position !== index))}
              >
                {`Remove tier ${index + 1}`}
              </button>
            ) : null}
          </fieldset>
        ))}
        {fieldErrors.tiers === undefined ? null : <p className="field-error">{fieldErrors.tiers}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => setTiers((current) => [...current, { name: '', dollars: '', seating: '' }])}
          >
            Add tier
          </button>
          <button type="submit" className="primary" disabled={working}>
            Publish
          </button>
        </div>
      </form>
    </OwnerFrame>
  );
}
