// Entry point: mounts the app and routes by address.
import { mount } from './app.js';

const root = document.getElementById('app');
if (root === null) {
  const created = document.createElement('div');
  created.id = 'app';
  document.body.appendChild(created);
  mount(created);
} else {
  mount(root);
}
