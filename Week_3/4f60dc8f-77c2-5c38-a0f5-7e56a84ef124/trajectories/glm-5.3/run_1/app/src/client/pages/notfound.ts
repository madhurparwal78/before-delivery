import { el } from '../shell';

export function mountNotFound(): void {
  const main = document.querySelector('main') ?? document.body;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'not-found');
  const heading = el('h1');
  heading.textContent = 'We couldn\'t find that page';
  const paragraph = el('p');
  paragraph.textContent = 'The link may have expired, been withdrawn, or never existed.';
  const link = el('a');
  link.href = '/';
  link.textContent = 'Back to the studio';
  section.append(heading, paragraph, link);
  main.appendChild(section);
}
