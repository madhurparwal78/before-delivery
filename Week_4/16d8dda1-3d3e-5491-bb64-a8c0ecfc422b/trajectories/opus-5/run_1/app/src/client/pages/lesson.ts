import type { LessonFileJson, LessonJson } from '../../shared/types.js';
import { api } from '../api.js';
import { button, element, keepFocus } from '../dom.js';
import { pageShell, pending } from '../shell.js';

export function lessonPage(lessonId: string): HTMLElement {
  const shell = pageShell('wide');
  const heading = element('h1', {}, ['']);
  const status = element('p', { class: 'meta' }, ['']);
  const fileList = element('ul', { class: 'rows', 'aria-label': 'Lesson files' });
  const chooser = element('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.glb', 'aria-label': 'Add files', class: 'file-input' });
  const addFiles = button('Add files', { class: 'primary' });
  const markReady = button('Mark ready to teach', { class: 'primary' });
  let pendingRows: HTMLElement[] = [];

  addFiles.addEventListener('click', () => chooser.click());

  const drawFile = (file: LessonFileJson, kind: 'slide' | 'model', index: number, total: number): HTMLElement => {
    const up = button(`Move ${file.name} up`, { 'data-focus-key': `up-${file.fileId}` });
    const down = button(`Move ${file.name} down`, { 'data-focus-key': `down-${file.fileId}` });
    const remove = button(`Remove ${file.name}`, { 'data-focus-key': `remove-${file.fileId}` });
    up.disabled = kind === 'model' || index === 0;
    down.disabled = kind === 'model' || index === total - 1;
    up.addEventListener('click', () => void reorder(file.fileId, -1));
    down.addEventListener('click', () => void reorder(file.fileId, 1));
    remove.addEventListener('click', () => void removeFile(file.fileId));
    return element(
      'li',
      {
        'data-file-id': file.fileId,
        'data-file-status': file.status,
        class: 'file-row'
      },
      [
        element('span', { class: 'file-name' }, [file.name]),
        element('span', { class: 'meta' }, [file.status === 'confirmed' ? 'Confirmed' : 'Pending']),
        element('div', { class: 'row' }, [up, down, remove])
      ]
    );
  };

  let lesson: LessonJson | null = null;

  const draw = (): void => {
    if (lesson === null) return;
    heading.textContent = lesson.title;
    document.title = `${lesson.title} - Slatehall`;
    status.textContent =
      lesson.state === 'ready' ? 'Status: Ready' : lesson.state === 'uploading' ? 'Status: Uploading' : 'Status: Draft';
    keepFocus(() => {
      if (lesson === null) return;
      fileList.replaceChildren();
      lesson.slides.forEach((file, index) => fileList.append(drawFile(file, 'slide', index, lesson?.slides.length ?? 0)));
      lesson.models.forEach((file, index) => fileList.append(drawFile(file, 'model', index, lesson?.models.length ?? 0)));
      for (const row of pendingRows) fileList.append(row);
    });
  };

  const load = async (): Promise<void> => {
    const answer = await api.get<LessonJson>(`/api/lessons/${lessonId}`);
    if (answer.status === 404) {
      shell.showNotFound();
      return;
    }
    if (answer.error !== null) {
      shell.showError(answer.error);
      return;
    }
    lesson = answer.body;
    draw();
  };

  const reorder = async (fileId: string, direction: number): Promise<void> => {
    if (lesson === null) return;
    const order = lesson.slides.map((file) => file.fileId);
    const at = order.indexOf(fileId);
    const to = at + direction;
    if (at === -1 || to < 0 || to >= order.length) return;
    const moved = [...order];
    moved.splice(at, 1);
    moved.splice(to, 0, fileId);
    shell.showError(null);
    shell.setStatus('Saving...');
    const answer = await api.put<LessonJson>(`/api/lessons/${lessonId}/order`, { slideIds: moved });
    if (answer.error !== null) {
      shell.setStatus('');
      shell.showError(answer.error);
      return;
    }
    lesson = answer.body;
    shell.setStatus('Lesson updated.');
    draw();
  };

  const removeFile = async (fileId: string): Promise<void> => {
    shell.showError(null);
    shell.setStatus('Saving...');
    const answer = await api.remove<LessonJson>(`/api/lessons/${lessonId}/files/${fileId}`);
    if (answer.error !== null) {
      shell.setStatus('');
      shell.showError(answer.error);
      return;
    }
    lesson = answer.body;
    shell.setStatus('Lesson updated.');
    draw();
  };

  chooser.addEventListener('change', () => {
    const files = [...(chooser.files ?? [])];
    if (files.length === 0) return;
    void (async () => {
      shell.showError(null);
      pending(addFiles, true);
      shell.setStatus('Saving...');
      pendingRows = files.map((file) =>
        element('li', { 'data-file-status': 'pending', class: 'file-row' }, [
          element('span', { class: 'file-name' }, [file.name]),
          element('span', { class: 'meta' }, ['Pending'])
        ])
      );
      draw();
      const answer = await api.upload<LessonJson>(`/api/lessons/${lessonId}/files`, files);
      pendingRows = [];
      pending(addFiles, false);
      chooser.value = '';
      if (answer.error !== null) {
        shell.setStatus('');
        shell.showError(answer.error);
        draw();
        return;
      }
      lesson = answer.body;
      shell.setStatus(`Files added: ${files.length}.`);
      draw();
    })();
  });

  markReady.addEventListener('click', () => {
    void (async () => {
      shell.showError(null);
      pending(markReady, true);
      shell.setStatus('Saving...');
      const answer = await api.post<LessonJson>(`/api/lessons/${lessonId}/ready`);
      pending(markReady, false);
      if (answer.error !== null) {
        shell.setStatus('');
        shell.showError(answer.error);
        return;
      }
      lesson = answer.body;
      shell.setStatus('Lesson ready to teach.');
      draw();
    })();
  });

  shell.body.append(
    element('div', { class: 'page-head' }, [heading, status]),
    element('div', { class: 'row' }, [addFiles, chooser, markReady]),
    fileList
  );

  void load();
  return shell.root;
}
