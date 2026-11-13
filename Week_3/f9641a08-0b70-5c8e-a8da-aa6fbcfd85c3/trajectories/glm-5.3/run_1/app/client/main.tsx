import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { App } from './app.js';
import { loadConfig } from './lib/format.js';
import { store, startLiveStream } from './lib/store.js';

const root = document.getElementById('root');
if (root !== null) render(<Boot />, root);

function Boot(): preact.JSX.Element {
  useEffect(() => {
    void (async () => {
      await loadConfig();
      await store.refreshAll();
      startLiveStream();
    })();
  }, []);
  return <App />;
}
