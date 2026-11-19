import { useState } from 'react';
import type { Outcome } from '../lib/workspace.js';
import { useTabKeys } from './Tabs.js';

interface CodePaneProps {
  css: string;
  html: string;
  /** Present in the editor; the view page reads only. */
  onApply?: (css: string) => Promise<Outcome>;
}

/** The tablist "Code": the generated CSS (editable in the editor) and HTML (read-only). */
export function CodePane({ css, html, onApply }: CodePaneProps) {
  const [tab, setTab] = useState<'CSS' | 'HTML'>('CSS');
  const [draft, setDraft] = useState<string | null>(null);
  const keys = useTabKeys();

  const apply = async (): Promise<void> => {
    if (!onApply) return;
    const outcome = await onApply(draft ?? css);
    if (outcome.ok) setDraft(null);
  };

  return (
    <div className="code-pane">
      <div role="tablist" aria-label="Code" className="tabs" onKeyDown={keys}>
        {(['CSS', 'HTML'] as const).map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} className="tab" onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="code-body" hidden={tab !== 'CSS'}>
        <textarea
          aria-label="Layout CSS"
          className="code mono"
          spellCheck={false}
          wrap="off"
          readOnly={!onApply}
          value={draft ?? css}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void apply();
            }
          }}
        />
        {onApply && (
          <button type="button" className="primary" onClick={() => void apply()}>
            Apply CSS
          </button>
        )}
      </div>
      <div className="code-body" hidden={tab !== 'HTML'}>
        <textarea aria-label="Layout HTML" className="code mono" spellCheck={false} wrap="off" readOnly value={html} />
      </div>
    </div>
  );
}
