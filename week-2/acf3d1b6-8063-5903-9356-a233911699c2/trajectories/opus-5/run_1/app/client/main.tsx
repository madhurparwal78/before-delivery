import { hydrate } from 'preact-iso';
import './styles.css';
import { App } from './App';

hydrate(<App />, document.getElementById('app') as HTMLElement);
