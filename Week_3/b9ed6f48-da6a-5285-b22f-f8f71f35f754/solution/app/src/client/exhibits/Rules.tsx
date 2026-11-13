// Chapter VI: the rule engine (brief: Exhibits › Rules). Any edit reclassifies the twelve
// specimens at once by first-match order.

import { useState } from "react";
import { UNCLASSIFIED, classify, type Attribute, type Rule, type RulesSeed } from "../../shared/exhibits.js";
import { copyFor } from "../../shared/copy.js";

const ATTRIBUTE_NAMES: Record<Attribute, string> = { legs: "Legs", wings: "Wings", feathers: "Feathers" };

export function RulesExhibit({ seed, onUse }: { seed: RulesSeed; onUse: () => void }) {
  const [rules, setRules] = useState<Rule[]>(seed.rules);
  const labels = classify(seed.specimens, rules);
  const classified = labels.filter((l) => l !== UNCLASSIFIED).length;

  const edit = (next: Rule[]) => {
    onUse();
    setRules(next);
  };
  const update = (index: number, change: Partial<Rule>) => edit(rules.map((r, i) => (i === index ? { ...r, ...change } : r)));

  return (
    <div className="exhibit rules-exhibit">
      <ol className="rule-list">
        {rules.map((rule, i) => (
          <li key={i}>
            <fieldset className="rule">
              <legend>Rule {i + 1}</legend>
              <span className="rule-word">If</span>
              <select
                aria-label="Attribute"
                value={rule.attribute}
                onChange={(e) => {
                  const attribute = e.currentTarget.value as Attribute;
                  update(i, { attribute, value: attribute === "legs" ? seed.attributes.legs.min : true });
                }}
              >
                {(Object.keys(ATTRIBUTE_NAMES) as Attribute[]).map((a) => (
                  <option key={a} value={a}>
                    {ATTRIBUTE_NAMES[a]}
                  </option>
                ))}
              </select>
              <span className="rule-word">is</span>
              {rule.attribute === "legs" ? (
                <input
                  type="number"
                  aria-label="Value"
                  min={seed.attributes.legs.min}
                  max={seed.attributes.legs.max}
                  value={String(rule.value)}
                  onChange={(e) => {
                    const value = Number.parseInt(e.currentTarget.value, 10);
                    if (Number.isInteger(value)) update(i, { value: Math.min(seed.attributes.legs.max, Math.max(seed.attributes.legs.min, value)) });
                  }}
                />
              ) : (
                <select aria-label="Value" value={rule.value ? "yes" : "no"} onChange={(e) => update(i, { value: e.currentTarget.value === "yes" })}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              )}
              <span className="rule-word">then</span>
              <select aria-label="Label" value={rule.label} onChange={(e) => update(i, { label: e.currentTarget.value })}>
                {seed.labels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" className="button button-quiet" onClick={() => edit(rules.filter((_, j) => j !== i))}>
                Remove rule {i + 1}
              </button>
            </fieldset>
          </li>
        ))}
      </ol>
      <button type="button" className="button" disabled={rules.length >= seed.max_rules} onClick={() => edit([...rules, { ...seed.new_rule }])}>
        Add rule
      </button>
      <div role="status" aria-label="Rule results" className="exhibit-status">
        {copyFor.ruleResults(classified)}
      </div>
      <table aria-label="Specimens" className="data-table specimens">
        <thead>
          <tr>
            <th scope="col">Specimen</th>
            <th scope="col">Label</th>
          </tr>
        </thead>
        <tbody>
          {seed.specimens.map((s, i) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              <td className={labels[i] === UNCLASSIFIED ? "muted" : undefined}>{labels[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
