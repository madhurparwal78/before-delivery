import { clear, el } from '../dom.js';
import { ApiFailure, write } from '../state.js';

type PipeResult = {
  columns: { name: string; type: string }[];
  rows: (string | number | boolean | null)[][];
};

export function renderPipes(main: HTMLElement): void {
  const area = el('textarea', {
    'aria-label': 'Spoor Pipe',
    class: 'mono pipe-input',
    rows: '4',
    text: 'FROM web | STATS count(*) AS events BY level',
  });
  const run = el('button', { type: 'button', 'aria-label': 'Run', text: 'Run', class: 'primary' });
  const resultHost = el('div', { class: 'result-host' });
  run.addEventListener('click', () => {
    run.setAttribute('aria-busy', 'true');
    void (async () => {
      clear(resultHost);
      try {
        const result = await write<PipeResult>('POST', '/api/pipe', { pipe: area.value });
        resultHost.append(
          el('table', { 'aria-label': 'Result', class: 'data-table' }, [
            el('thead', {}, [
              el(
                'tr',
                {},
                result.columns.map((column) =>
                  el('th', { scope: 'col', 'data-type': column.type, text: column.name }),
                ),
              ),
            ]),
            el(
              'tbody',
              {},
              result.rows.map((row) =>
                el(
                  'tr',
                  {},
                  row.map((cell) => el('td', { class: 'mono', text: cell === null ? 'null' : String(cell) })),
                ),
              ),
            ),
          ]),
        );
      } catch (cause) {
        if (cause instanceof ApiFailure) {
          resultHost.append(
            el('div', { role: 'alert', 'aria-label': 'Pipe error', class: 'notice-box' }, [
              el('p', { text: cause.message }),
            ]),
          );
        }
      } finally {
        run.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(
    el('h1', { class: 'view-title', text: 'Pipes' }),
    el('div', { class: 'card' }, [area, run]),
    resultHost,
  );
}
