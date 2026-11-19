import type { User } from '../../shared/types';
import { fieldColours } from '../../shared/pose';
import { h } from '../dom';
import { Stage } from '../stage/stage';
import { loadGuideModel } from '../stage/guide-model';
import { phaseNames } from '../reader/panel';
import type { ReadingGuide } from '../reader/reader';

export function mountHome(root: HTMLElement, guide: ReadingGuide | null, _user: User | null): void {
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-field hero-bone', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-field hero-red', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-top' },
      h('a', { class: 'wordmark', href: '/' }, 'Pennywasher'),
      h('a', { class: 'start-link', href: '/dashboard?start=1' }, 'Start a guide')),
    h('h1', { class: 'headline' },
      h('span', { class: 'headline-line' }, 'TAKE IT'),
      h('span', { class: 'headline-line apart' },
        h('span', { class: 'apart-upper' }, 'APART.'),
        h('span', { class: 'apart-lower', 'aria-hidden': 'true' }, 'APART.'))),
    h('p', { class: 'hero-sentence' }, 'Upload the thing you fixed, and readers watch it come apart one step at a time.'));
  root.append(hero);
  if (!guide) return;
  const step = guide.steps[0]!;
  const colours = fieldColours[step.phase];
  const stage = new Stage();
  const section = h('section', { class: 'home-guide', style: `background-color:${colours.field};color:${colours.text}` },
    h('div', { class: 'home-copy' },
      h('p', { class: 'phase-name' }, phaseNames[step.phase]),
      h('h2', { class: 'guide-title' }, guide.title),
      h('p', { class: 'step-text' }, step.title),
      h('p', { class: 'step-text' }, step.text),
      h('div', { class: 'home-links' },
        h('a', { class: 'button', href: `/g/${guide.slug}` }, 'Read this guide'),
        h('a', { class: 'button quiet', href: '/search' }, 'Find a guide'))),
    h('div', { class: 'home-stage' }, stage.element));
  root.append(section);
  stage.setStep(1);
  stage.setPose({ explode: step.explode, yaw: step.camera.yaw, pitch: step.camera.pitch, zoom: step.camera.zoom });
  stage.setFocus(step.focus_parts);
  stage.setInk({ above: colours.text, below: colours.text, edge: -1 });
  if (!stage.webgl) {
    stage.setState('still');
    stage.element.append(h('img', { class: 'still', alt: `${guide.title}, step 1 still`, src: `/api/guides/${guide.id}/stills/1` }));
    return;
  }
  loadGuideModel(stage, guide).then(() => stage.setState('ready'), () => stage.setState('error'));
}

