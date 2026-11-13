import { h } from '../dom.ts';
import { openDialog } from './dialog.ts';
import { signaturePad } from './signaturePad.ts';
import { initialsOf } from '../../shared/fields.ts';
import type { Stroke } from '../../shared/types.ts';

export type Adoption = { typed: string } | { strokes: Stroke[] };

export const openAdoptDialog = (
  kind: 'signature' | 'initials',
  recipientName: string,
  opener: HTMLElement,
  onAdopt: (adoption: Adoption) => void,
): void => {
  const isSignature = kind === 'signature';
  const dialogLabel = isSignature ? 'Adopt your signature' : 'Adopt your initials';
  const textLabel = isSignature ? 'Full name' : 'Initials';

  openDialog(
    dialogLabel,
    (handle) => {
      const typeTab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'true', tabindex: '0' }, 'Type');
      const drawTab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'false', tabindex: '-1' }, 'Draw');
      const tabs = h('div', { role: 'tablist', class: 'tabs' }, typeTab, drawTab);

      const textInput = h('input', { type: 'text', id: 'adopt-text', maxlength: '100' });
      textInput.value = isSignature ? recipientName : initialsOf(recipientName);
      const typePanel = h(
        'div',
        { class: 'adopt-panel' },
        h('label', { for: 'adopt-text' }, textLabel),
        textInput,
      );

      const pad = signaturePad('Signature pad');
      const clearButton = h('button', { type: 'button', class: 'button quiet' }, 'Clear');
      const drawPanel = h('div', { class: 'adopt-panel', hidden: true }, pad.element, clearButton);

      const adopt = h('button', { type: 'button', class: 'button seal' }, 'Adopt and sign');
      const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');

      let active: 'type' | 'draw' = 'type';

      const refreshEnabled = (): void => {
        adopt.disabled =
          active === 'type' ? textInput.value.trim() === '' : pad.strokes().length === 0;
      };

      const show = (next: 'type' | 'draw', moveFocus: boolean): void => {
        active = next;
        const typing = next === 'type';
        typeTab.setAttribute('aria-selected', typing ? 'true' : 'false');
        typeTab.setAttribute('tabindex', typing ? '0' : '-1');
        drawTab.setAttribute('aria-selected', typing ? 'false' : 'true');
        drawTab.setAttribute('tabindex', typing ? '-1' : '0');
        typePanel.hidden = !typing;
        drawPanel.hidden = typing;
        if (moveFocus) (typing ? typeTab : drawTab).focus();
        refreshEnabled();
      };

      for (const [tab, name] of [
        [typeTab, 'type'],
        [drawTab, 'draw'],
      ] as const) {
        tab.addEventListener('click', () => show(name, false));
        tab.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          show(name === 'type' ? 'draw' : 'type', true);
        });
      }

      textInput.addEventListener('input', refreshEnabled);
      pad.onChange(refreshEnabled);
      clearButton.addEventListener('click', () => {
        pad.clear();
        refreshEnabled();
      });
      adopt.addEventListener('click', () => {
        const adoption: Adoption =
          active === 'type' ? { typed: textInput.value.trim() } : { strokes: pad.strokes() };
        handle.close();
        onAdopt(adoption);
      });
      cancel.addEventListener('click', () => handle.close());

      handle.body.append(
        tabs,
        typePanel,
        drawPanel,
        h('div', { class: 'dialog-actions' }, adopt, cancel),
      );
      refreshEnabled();
    },
    opener,
    { className: 'adopt-dialog' },
  );
};
