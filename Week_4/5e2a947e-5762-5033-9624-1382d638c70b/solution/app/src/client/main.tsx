import { render } from 'preact';
import { App } from './App.tsx';
import './styles/index.css';

render(<App />, document.getElementById('app') as HTMLElement);
