import { text } from '../dom';

export function renderNotFound(main: HTMLElement, sentence: string): void {
  main.append(text('h1', sentence, { class: 'serif-sentence' }));
}
