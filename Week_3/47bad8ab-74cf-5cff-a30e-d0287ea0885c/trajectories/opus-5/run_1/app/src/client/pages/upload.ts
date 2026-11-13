import { copy } from '../../shared/copy';
import type { PuzzleJson } from '../../shared/types';
import { api, ApiFailure } from '../api';
import { el, replace } from '../dom';
import { link } from '../main';
import { openUploadDialog } from '../ui/uploadDialog';
import { staticGrid } from '../ui/puzzleGrid';

async function latestUpload(): Promise<PuzzleJson | null> {
  const mine = await api.puzzles('?source=mine');
  const newest = mine.puzzles[0];
  if (!newest) return null;
  return api.puzzle(newest.id);
}

export async function mountUpload(container: HTMLElement): Promise<void> {
  const preview = el('div', { class: 'tile preview-tile tile-6x4' });
  const band = el('div', { class: 'band ink', role: 'alert', hidden: true });

  async function drawPreview(): Promise<void> {
    try {
      const puzzle = await latestUpload();
      band.hidden = true;
      replace(
        preview,
        puzzle === null
          ? [el('p', { class: 'sentence-text', text: copy.nothingUploaded })]
          : [
              el('h3', { text: puzzle.title }),
              el('p', { class: 'muted', text: `${puzzle.cols}x${puzzle.rows}` }),
              staticGrid({ blocks: puzzle.blocks, numbers: puzzle.numbers }),
            ],
      );
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) {
        band.textContent = copy.storageOutage;
        band.hidden = false;
      }
    }
  }

  container.append(
    band,
    el('div', { class: 'board upload-page' }, [
      el('div', { class: 'tile drop-tile tile-6x4' }, [
        el('h2', { text: 'Upload a puzzle' }),
        el('p', {
          text: 'Write your puzzle in the Overlap text format and send it here as a file or as text.',
        }),
        el('button', {
          type: 'button',
          class: 'button',
          text: 'Upload puzzle',
          onclick: () => openUploadDialog(() => void drawPreview()),
        }),
        link('Build a puzzle', '/build', 'nav-link'),
      ]),
      preview,
    ]),
  );
  await drawPreview();
}
