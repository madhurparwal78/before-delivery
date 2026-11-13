import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { el, replace } from '../dom';
import { navigate } from '../main';
import type { PuzzleJson } from '../../shared/types';
import { openDialog } from './overlay';
import { staticGrid } from './puzzleGrid';

export function openUploadDialog(onUploaded?: (puzzle: PuzzleJson) => void): void {
  let file: File | null = null;
  let pending = false;

  const status = el('div', { role: 'status', 'aria-label': 'Upload status', class: 'status' });
  const board = el('div', { class: 'board upload-board' });
  const errorsTile = el('div', { class: 'tile ink errors-tile', hidden: true });
  const previewTile = el('div', { class: 'tile paper preview-tile', hidden: true });
  const band = el('div', { class: 'band ink', role: 'alert', hidden: true });
  const text = el('textarea', {
    class: 'field textarea',
    'aria-label': 'Puzzle text',
    rows: '10',
  }) as HTMLTextAreaElement;
  const fileInput = el('input', {
    type: 'file',
    id: 'puzzle-file',
    class: 'file',
    accept: '.overlap.txt',
  }) as HTMLInputElement;
  const uploadButton = el('button', {
    type: 'button',
    class: 'button brass',
    text: 'Upload',
  }) as HTMLButtonElement;

  fileInput.addEventListener('change', () => {
    const chosen = fileInput.files?.[0] ?? null;
    file = chosen;
    if (!chosen) return;
    void chosen.text().then((content) => {
      text.value = content;
      file = chosen;
    });
  });
  text.addEventListener('input', () => {
    file = null;
  });

  function showErrors(heading: string, lines: string[]): void {
    uploadButton.classList.add('brass');
    board.classList.remove('has-preview');
    const headingNode = el('h3', { class: 'errors-heading', text: heading, tabindex: '-1' });
    replace(errorsTile, [
      headingNode,
      lines.length > 0
        ? el(
            'div',
            { role: 'list', 'aria-label': 'Upload errors', class: 'errors-list' },
            lines.map((line) => el('div', { role: 'listitem', text: line })),
          )
        : null,
    ]);
    errorsTile.hidden = false;
    previewTile.hidden = true;
    headingNode.focus();
  }

  function showPreview(puzzle: PuzzleJson, solution: string[][]): void {
    errorsTile.hidden = true;
    // Brass belongs to one element per screen: the preview's primary action takes it.
    uploadButton.classList.remove('brass');
    board.classList.add('has-preview');
    replace(previewTile, [
      el('h3', { text: puzzle.title }),
      el('p', { class: 'muted', text: `${puzzle.cols}x${puzzle.rows}` }),
      staticGrid({ blocks: puzzle.blocks, numbers: puzzle.numbers, solution }),
      el('button', {
        type: 'button',
        class: 'button brass',
        text: 'Start a room with this puzzle',
        onclick: () => {
          void api.createGame(puzzle.id, 'shared').then((game) => {
            dialog.close();
            navigate(`/games/${game.id}`);
          });
        },
      }),
    ]);
    previewTile.hidden = false;
  }

  async function upload(): Promise<void> {
    if (pending) return;
    pending = true;
    uploadButton.disabled = true;
    status.textContent = copy.uploadPending;
    try {
      const body: BodyInit = file ?? new Blob([text.value], { type: 'text/plain' });
      const result = await api.upload(body);
      band.hidden = true;
      status.textContent = copy.uploadReady(result.puzzle.title);
      showPreview(result.puzzle, result.solution);
      if (onUploaded) onUploaded(result.puzzle);
    } catch (failure) {
      status.textContent = '';
      if (failure instanceof ApiFailure && failure.status === 503) {
        band.textContent = copy.storageOutageUpload;
        band.hidden = false;
        uploadButton.disabled = false;
        uploadButton.focus();
        pending = false;
        return;
      }
      if (failure instanceof ApiFailure) {
        showErrors(failure.body.message, failure.body.lines ?? []);
      }
    }
    pending = false;
    uploadButton.disabled = false;
  }

  uploadButton.addEventListener('click', () => void upload());

  board.append(
    band,
    el('div', { class: 'tile drop-tile' }, [
      el('h2', { text: 'Upload a puzzle' }),
      el('label', { class: 'label', for: 'puzzle-file', text: 'Puzzle file' }),
      fileInput,
      text,
      uploadButton,
      status,
    ]),
    errorsTile,
    previewTile,
  );
  const dialog = openDialog({ name: 'Upload a puzzle', className: 'upload-dialog' }, () => [board]);
}
