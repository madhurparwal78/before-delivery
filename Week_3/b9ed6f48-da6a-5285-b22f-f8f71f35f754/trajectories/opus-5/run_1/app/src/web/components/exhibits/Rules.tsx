import { useMemo, useState } from 'react';
import {
  classifiedCount,
  classifyAll,
  type ClassificationRule,
  type RuleAttribute,
  type RuleLabel,
  type RulesSeed,
} from '../../../shared/exhibits.js';
import { ruleResultsAnnouncement } from '../../../shared/copy.js';

const ATTRIBUTES: { key: RuleAttribute; label: string }[] = [
  { key: 'legs', label: 'Legs' },
  { key: 'wings', label: 'Wings' },
  { key: 'feathers', label: 'Feathers' },
];

function defaultValue(attribute: RuleAttribute): number | boolean {
  return attribute === 'legs' ? 4 : true;
}

export function RulesExhibit({ seed, onUse }: { seed: RulesSeed; onUse: () => void }): JSX.Element {
  const [rules, setRules] = useState<ClassificationRule[]>(seed.rules);

  const labels = useMemo(() => classifyAll(seed.specimens, rules), [seed.specimens, rules]);
  const classified = classifiedCount(labels);

  function update(index: number, next: Partial<ClassificationRule>): void {
    onUse();
    setRules((current) =>
      current.map((rule, position) => (position === index ? { ...rule, ...next } : rule)),
    );
  }

  return (
    <div className="exhibit">
      <span className="catalogue">HRR-VI-01</span>
      <h3>The rule engine</h3>
      <p>
        Rules are tried from the top. The first rule whose attribute equals its value labels the specimen; anything
        no rule matches stays unclassified.
      </p>
      {rules.map((rule, index) => (
        <div className="rule-row" role="group" aria-label={`Rule ${index + 1}`} key={index}>
          <div>
            <label htmlFor={`rule-attribute-${index}`}>Attribute</label>
            <select
              id={`rule-attribute-${index}`}
              aria-label="Attribute"
              value={rule.attribute}
              onChange={(event) => {
                const attribute = event.target.value as RuleAttribute;
                update(index, { attribute, value: defaultValue(attribute) });
              }}
            >
              {ATTRIBUTES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`rule-value-${index}`}>Value</label>
            {rule.attribute === 'legs' ? (
              <input
                id={`rule-value-${index}`}
                type="number"
                aria-label="Value"
                min={seed.attributes.legs.min}
                max={seed.attributes.legs.max}
                value={String(rule.value)}
                onChange={(event) => update(index, { value: Number(event.target.value) })}
              />
            ) : (
              <select
                id={`rule-value-${index}`}
                aria-label="Value"
                value={rule.value === true ? 'yes' : 'no'}
                onChange={(event) => update(index, { value: event.target.value === 'yes' })}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            )}
          </div>
          <div>
            <label htmlFor={`rule-label-${index}`}>Label</label>
            <select
              id={`rule-label-${index}`}
              aria-label="Label"
              value={rule.label}
              onChange={(event) => update(index, { label: event.target.value as RuleLabel })}
            >
              {seed.labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            aria-label={`Remove rule ${index + 1}`}
            onClick={() => {
              onUse();
              setRules((current) => current.filter((_unused, position) => position !== index));
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="inline-actions">
        <button
          type="button"
          disabled={rules.length >= seed.max_rules}
          onClick={() => {
            onUse();
            setRules((current) => [...current, seed.new_rule]);
          }}
        >
          Add rule
        </button>
      </div>
      <div className="table-scroll">
        <table aria-label="Specimens">
          <thead>
            <tr>
              <th scope="col">Specimen</th>
              <th scope="col">Label</th>
            </tr>
          </thead>
          <tbody>
            {seed.specimens.map((specimen, index) => (
              <tr key={specimen.name}>
                <th scope="row">{specimen.name}</th>
                <td>{labels[index]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status" aria-label="Rule results" className="readout">
        {ruleResultsAnnouncement(classified)}
      </p>
    </div>
  );
}
