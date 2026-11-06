// Browser entry: the stylesheet, the hooks scheduler and the app root.
import './styles.css';
import { options, render } from 'preact';
import { App } from './app';
import { boot } from './store';

// Effects run in a microtask after each commit rather than on the next animation frame, so focus
// moves and panel framing happen as soon as the DOM changes, also in a backgrounded tab.
(options as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame = (cb) => {
  void Promise.resolve().then(cb);
};

render(<App />, document.getElementById('root') as HTMLElement);
void boot();
