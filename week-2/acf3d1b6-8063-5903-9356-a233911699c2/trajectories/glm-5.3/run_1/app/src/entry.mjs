// Browser entry: hydrate the server-rendered app.
import { h } from 'preact';
import { hydrate } from 'preact-iso';
import { App } from './browser/app.jsx';
import './fonts.css';
import './styles.css';

hydrate(h(App), document.getElementById('app'));
