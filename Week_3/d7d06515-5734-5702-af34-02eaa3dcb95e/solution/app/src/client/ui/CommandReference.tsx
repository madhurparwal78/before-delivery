// dialog "Command reference": every alias with its full command name, prompts and shortcuts (brief: Editor dialogs).
import { ALIASES, COMMAND_NAMES, IDLE_PROMPT, PROMPTS, SHORTCUTS } from '../../shared/commands.ts';
import { Dialog } from './Dialog.tsx';

const aliasesOf = (name: string): string[] => Object.entries(ALIASES).filter(([alias, full]) => full === name && alias !== name).map(([alias]) => alias);

interface Props {
  onClose: () => void;
  /** The element that opened the dialog, when the browser does not focus it on press. */
  returnFocus?: () => HTMLElement | null;
}

export function CommandReferenceDialog({ onClose, returnFocus }: Props) {
  return (
    <Dialog label="Command reference" onClose={onClose} returnFocus={returnFocus} className="dialog-wide">
      <h2>Command reference</h2>
      <p className="muted">Idle prompt: {IDLE_PROMPT}</p>
      <div className="reference-scroll" tabIndex={0} role="region" aria-label="Commands and shortcuts">
        <table className="reference-table">
          <caption className="sr-only">Commands, aliases and prompts</caption>
          <thead>
            <tr><th scope="col">Command</th><th scope="col">Aliases</th><th scope="col">Prompts</th></tr>
          </thead>
          <tbody>
            {COMMAND_NAMES.map((name) => {
              const aliases = aliasesOf(name);
              const prompts = PROMPTS[name];
              return (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{aliases.length > 0 ? aliases.join(', ') : '—'}</td>
                  <td>
                    {prompts.length > 0 ? <ol className="reference-prompts">{prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ol> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Shortcuts</h3>
        <table className="reference-table">
          <caption className="sr-only">Editor shortcuts</caption>
          <thead>
            <tr><th scope="col">Keys</th><th scope="col">Action</th></tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((shortcut) => (
              <tr key={shortcut.keys}><th scope="row">{shortcut.keys}</th><td>{shortcut.action}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
