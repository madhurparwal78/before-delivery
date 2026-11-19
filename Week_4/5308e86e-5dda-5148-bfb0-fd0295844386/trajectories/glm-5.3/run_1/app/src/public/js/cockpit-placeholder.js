import { PlaceholderPage } from './pages/cockpit-pages.js';
const which = new URLSearchParams(window.location.search).get('page') || 'cards';
new PlaceholderPage(which).run();
