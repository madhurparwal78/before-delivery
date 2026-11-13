import { useMemo, useState } from 'react';
import { COLOUR_PATTERN } from '../../../shared/format';
import { MESSAGES, presetApplied } from '../../../shared/messages';
import { SceneCanvas } from '../../stage/SceneCanvas';
import { cubeScene } from './demoScenes';
import { countText, useCountUp } from './hooks';
import { Reveal } from './Reveal';

interface Values {
  spin: number;
  boost: number;
  tint: string;
}

const PRESETS: Record<string, Partial<Values>> = {
  Calm: { spin: 0, boost: 20 },
  Lively: { spin: 90, boost: 80 },
};

function VariablesBody({ entered }: { entered: boolean }) {
  const [tab, setTab] = useState<'Variables' | 'Presets'>('Variables');
  const [values, setValues] = useState<Values>({ spin: 45, boost: 50, tint: '#B7A4FF' });
  const [draft, setDraft] = useState('#B7A4FF');
  const [status, setStatus] = useState('');
  const count = useCountUp(entered);
  const cube = useMemo(() => cubeScene(values.spin, values.boost, values.tint), [values.spin, values.boost, values.tint]);

  const setTint = (value: string): void => {
    setDraft(value);
    if (COLOUR_PATTERN.test(value)) {
      setValues((current) => ({ ...current, tint: value.toUpperCase() }));
      setStatus('');
    } else setStatus(MESSAGES.colour);
  };

  return (
          <>
            <div className="section-head">
              <h2>
                One value, <span className="serif-word">many</span> layers
              </h2>
              <p className="muted">Bind a variable to a property, clamp it to the property's range, switch the whole look with a preset.</p>
            </div>
            <div className="variables-card panel">
              <div className="variables-controls">
                <div role="tablist" aria-label="Variables and presets demo tabs" className="mini-tabs">
                  {(['Variables', 'Presets'] as const).map((name) => (
                    <button key={name} type="button" role="tab" aria-selected={tab === name} className="mini-tab" onClick={() => setTab(name)}>
                      {name}
                    </button>
                  ))}
                </div>
                {tab === 'Variables' ? (
                  <div role="tabpanel" className="variable-list">
                    <label className="variable-row">
                      <span>spin</span>
                      <input type="range" min={0} max={360} value={values.spin} onChange={(e) => setValues({ ...values, spin: Number(e.target.value) })} />
                      <output className="num">{countText(values.spin.toFixed(3), count)}</output>
                    </label>
                    <label className="variable-row">
                      <span>boost</span>
                      <input type="range" min={0} max={100} value={values.boost} onChange={(e) => setValues({ ...values, boost: Number(e.target.value) })} />
                      <output className="num">{countText(values.boost.toFixed(3), count)}</output>
                    </label>
                    <label className="variable-row">
                      <span>tint</span>
                      <input type="text" value={draft} onChange={(e) => setTint(e.target.value)} aria-invalid={!COLOUR_PATTERN.test(draft)} />
                      <span className="swatch" style={{ background: values.tint }} aria-hidden="true" />
                    </label>
                    {status && (
                      <p className="warn" role="status">
                        {status}
                      </p>
                    )}
                  </div>
                ) : (
                  <div role="tabpanel" className="variable-list">
                    {Object.keys(PRESETS).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="btn"
                        onClick={() => {
                          setValues({ ...values, ...PRESETS[name] });
                          setStatus(presetApplied(name));
                          setTab('Variables');
                        }}
                      >
                        Apply {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="variables-preview" aria-hidden="true">
                <SceneCanvas document={cube} frame={0} className="preview-cube" aria-label="Variables preview cube" />
              </div>
            </div>
          </>
  );
}

export function VariablesDemo() {
  return <Reveal className="demo-panel" aria-label="Variables and presets demo" render={(entered) => <VariablesBody entered={entered} />} />;
}
