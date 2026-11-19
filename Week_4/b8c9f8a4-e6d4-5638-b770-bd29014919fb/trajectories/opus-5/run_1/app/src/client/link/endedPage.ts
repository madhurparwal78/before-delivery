import { LINK_PAGE } from '../../shared/copy';
import { carFileFooter } from '../shared/chrome';
import { el } from '../shared/dom';
import { Stage } from '../stage/stage';

export type EndedKind = 'ended' | 'unknown';

/** The same dim still of the stage with one notice panel. */
export const endedLinkPage = (root: HTMLElement, kind: EndedKind): void => {
  const stage = new Stage({ kind: 'preview', carName: 'this car' });
  stage.setListing('withdrawn');
  stage.region.classList.add('stage-ended');

  const panel = el('div', { class: 'notice-panel ended-panel' }, [
    el('h1', { class: 'notice-heading', text: kind === 'ended' ? LINK_PAGE.endedHeading : LINK_PAGE.unknownHeading }),
    ...(kind === 'ended' ? [el('p', { class: 'notice-line', text: LINK_PAGE.endedBody })] : []),
  ]);

  root.replaceChildren(
    el('main', { class: 'ended-main' }, [stage.region, panel]),
    carFileFooter(),
  );
};
