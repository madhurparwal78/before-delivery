import render from 'preact-render-to-string';
import { locationStub } from 'preact-iso/prerender';
import { App } from './App';

export function renderApp(url: string): string {
  locationStub(url);
  return render(<App />);
}
