import { render } from './jsx/jsx-runtime.js';
import { App } from './app.js';

const root = document.getElementById('root');
if (root) {
  root.appendChild(render(App()));
}
