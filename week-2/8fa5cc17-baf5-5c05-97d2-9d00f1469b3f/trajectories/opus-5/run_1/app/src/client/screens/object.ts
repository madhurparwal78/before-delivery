import { api } from '../api';
import { clear, el } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { BacklinkDto, BlockDto, ObjectDto } from '../types';
import { refreshLibrary, typeById, workspace } from '../state';
import { dateHeading } from '../../shared/homeclock';
import { MarginTether } from '../components/tether';
import { openDialog } from '../components/dialog';
import { UndoStack, setActiveUndoStack } from '../components/undo';
import { onLive } from '../live';
import { BlockColumn } from './blockcolumn';
import { Op } from '../../shared/ops';
import {
  COPY,
  capturedNewDayCopy,
  deleteNoteCopy,
  uploadAttachedCopy,
  uploadDoneCopy,
  uploadPendingCopy,
} from '../../shared/copy';

export type ObjectScreenMode = 'object' | 'today';

export function objectScreen(mode: ObjectScreenMode): Screen {
  let object: ObjectDto | null = null;
  let column: BlockColumn | null = null;
  let tether: MarginTether | null = null;
  let backlinks: BacklinkDto[] = [];
  let stopLive: (() => void) | null = null;
  let undo: UndoStack | null = null;
  let scrollHandler: (() => void) | null = null;
  const chipHost = el('div', { className: 'chip-host' });

  const isPhone = (): boolean => frame().currentLayout() === 'phone';

  async function createBlock(afterBlockId: string | null, body: string): Promise<BlockDto | null> {
    if (object === null) return null;
    const todayNote = object.daily_date !== null && mode === 'today';
    if (todayNote) {
      const key = `capture-${Math.random().toString(36).slice(2)}`;
      let result = await api.post<{ date: string; object_id: string; block: BlockDto }>(
        '/api/daily/today/blocks',
        { body, after_block_id: afterBlockId },
        { 'Idempotency-Key': key },
      );
      if (result.status === 0) {
        result = await api.post<{ date: string; object_id: string; block: BlockDto }>(
          '/api/daily/today/blocks',
          { body, after_block_id: afterBlockId },
          { 'Idempotency-Key': key },
        );
      }
      if (!result.ok) {
        frame().setSaveStatus(COPY.saveFailed);
        return null;
      }
      if (object !== null && result.data.object_id !== object.id) {
        frame().announce(capturedNewDayCopy(dateHeading(result.data.date)));
        navigate('/today', { reveal: true });
        return null;
      }
      appendBlock(result.data.block);
      return result.data.block;
    }
    const result = await api.post<BlockDto>(`/api/objects/${object.id}/blocks`, {
      body,
      after_block_id: afterBlockId,
    });
    if (!result.ok) {
      frame().setSaveStatus(COPY.saveFailed);
      return null;
    }
    appendBlock(result.data);
    return result.data;
  }

  function appendBlock(block: BlockDto): void {
    if (object === null || column === null) return;
    const blocks = column.blocks().filter((candidate) => candidate.id !== block.id);
    const index = blocks.findIndex((candidate) => candidate.position >= block.position);
    if (index === -1) blocks.push(block);
    else blocks.splice(index, 0, block);
    column.setBlocks(blocks);
  }

  function renderMargin(): void {
    if (object === null) return;
    const margin = frame().margin;
    // A live change never moves focus: a control in the margin is focused again by its name.
    const active = document.activeElement as HTMLElement | null;
    const focusedName = active !== null && margin.contains(active) ? active.getAttribute('aria-label') : null;
    clear(margin);
    margin.append(propertiesRegion(), backlinksRegion(), chipHost);
    syncChips();
    if (focusedName !== null) {
      const again = margin.querySelector<HTMLElement>(`[aria-label="${focusedName}"]`);
      if (again !== null) again.focus();
    }
  }

  function propertiesRegion(): HTMLElement {
    const region = el('div', { className: 'properties', attrs: { role: 'region', 'aria-label': 'Properties' } });
    region.append(el('h2', { text: 'Properties' }));
    const current = object as ObjectDto;
    const type = typeById(current.type_id);
    if (type === undefined) return region;
    for (const field of type.fields) {
      const id = `prop-${field.name.replace(/\s+/g, '-')}`;
      const label = el('label', { text: field.name, attrs: { for: id } });
      const value = current.properties[field.name];
      const row = el('div', { className: 'property-row', children: [label] });
      const errorNode = el('div', { className: 'field-error', attrs: { id: `${id}-error` } });
      const save = async (raw: unknown): Promise<void> => {
        const result = await api.patch<ObjectDto>(`/api/objects/${current.id}`, {
          properties: { [field.name]: raw },
        });
        if (!result.ok) {
          const message = result.errors?.[`properties.${field.name}`] ?? '';
          errorNode.textContent = message;
          return;
        }
        errorNode.textContent = '';
        object = result.data;
        frame().setSaveStatus(COPY.saveDone);
      };
      if (field.kind === 'select' || field.kind === 'relation') {
        const select = el('select', { attrs: { id, 'aria-label': field.name } });
        select.append(el('option', { text: 'None', attrs: { value: '' } }));
        if (field.kind === 'select') {
          for (const option of field.options ?? []) {
            select.append(el('option', { text: option, attrs: { value: option } }));
          }
          select.value = typeof value === 'string' ? value : '';
          select.addEventListener('change', () => void save(select.value === '' ? null : select.value));
        } else {
          const targets = relationTargets.get(field.name) ?? [];
          for (const target of targets) {
            select.append(el('option', { text: target.title, attrs: { value: target.id } }));
          }
          select.value = typeof value === 'string' ? value : '';
          select.addEventListener('change', () => void save(select.value === '' ? null : select.value));
        }
        row.append(select, errorNode);
        region.append(row);
        continue;
      }
      const input = el('input', {
        attrs: {
          id,
          'aria-label': field.name,
          type: field.kind === 'number' ? 'number' : 'text',
          ...(field.kind === 'date' ? { placeholder: 'YYYY-MM-DD' } : {}),
          'aria-describedby': `${id}-error`,
        },
      });
      if (field.kind === 'number') input.setAttribute('role', 'spinbutton');
      input.value = value === null || value === undefined ? '' : String(value);
      const commit = (): void => {
        const raw = input.value.trim();
        if (raw === '') {
          void save(null);
          return;
        }
        void save(field.kind === 'number' ? Number(raw) : raw);
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      });
      row.append(input, errorNode);
      region.append(row);
    }
    return region;
  }

  const relationTargets = new Map<string, { id: string; title: string }[]>();

  async function loadRelationTargets(): Promise<void> {
    relationTargets.clear();
    if (object === null) return;
    const type = typeById(object.type_id);
    if (type === undefined) return;
    for (const field of type.fields) {
      if (field.kind !== 'relation' || field.target_type_id === null) continue;
      const result = await api.get<{ objects: ObjectDto[] }>(`/api/objects?type_id=${field.target_type_id}`);
      if (result.ok) {
        relationTargets.set(
          field.name,
          result.data.objects.map((candidate) => ({ id: candidate.id, title: candidate.title })),
        );
      }
    }
  }

  function backlinksRegion(): HTMLElement {
    const region = el('div', { className: 'backlinks', attrs: { role: 'region', 'aria-label': 'Backlinks' } });
    const count = object?.backlinks ?? 0;
    region.append(
      el('h2', {
        className: 'backlinks-heading',
        children: [
          el('span', { text: 'Backlinks' }),
          el('span', {
            className: 'backlink-count',
            text: String(count),
            attrs: { 'data-backlink-count': String(count) },
          }),
        ],
      }),
    );
    const list = el('ul', { className: 'backlinks-list', attrs: { 'aria-label': 'Backlinks list' } });
    for (const backlink of backlinks) {
      const link = el('a', {
        text: backlink.from_title,
        attrs: { href: `/o/${backlink.from_object_id}` },
      });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(`/o/${backlink.from_object_id}`);
      });
      link.addEventListener('keydown', (event) => {
        const links = [...list.querySelectorAll('a')];
        const index = links.indexOf(link);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          (links[Math.min(links.length - 1, index + 1)] as HTMLElement | undefined)?.focus();
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          (links[Math.max(0, index - 1)] as HTMLElement | undefined)?.focus();
        }
      });
      list.append(
        el('li', {
          children: [
            link,
            el('span', {
              className: 'backlink-kind',
              text: backlink.kind === 'quote' ? 'quoted' : backlink.field_name ?? 'relation',
            }),
          ],
        }),
      );
    }
    region.append(list);
    return region;
  }

  function syncChips(): void {
    if (column === null) return;
    if (isPhone()) {
      tether = null;
      return;
    }
    if (tether === null) {
      tether = new MarginTether(chipHost, frame().tetherLayer, (objectId) => navigate(`/o/${objectId}`));
    }
    tether.setTargets(column.quoteTargets(), { drawTethers: true });
  }

  async function loadBacklinks(): Promise<void> {
    if (object === null) return;
    const result = await api.get<{ count: number; backlinks: BacklinkDto[] }>(
      `/api/objects/${object.id}/backlinks`,
    );
    if (!result.ok) return;
    backlinks = result.data.backlinks;
    if (object !== null) object.backlinks = result.data.count;
    renderMargin();
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      const main = frame().main;
      clear(main);
      let loaded: ObjectDto | null = null;
      if (mode === 'today') {
        const result = await api.post<{ date: string; object: ObjectDto }>('/api/daily/today');
        if (result.ok) loaded = result.data.object;
      } else {
        const result = await api.get<ObjectDto>(`/api/objects/${params.params['id']}`);
        if (result.ok) loaded = result.data;
      }
      if (loaded === null) {
        main.append(el('h1', { text: COPY.notFound }));
        clear(frame().margin);
        return;
      }
      object = loaded;
      backlinks = [];
      await loadRelationTargets();
      undo = new UndoStack((blockId, ops, baseVersion) =>
        column === null
          ? Promise.resolve({ ok: false as const, reason: 'gone' as const })
          : column.applyTyping(blockId, ops, baseVersion),
      );
      setActiveUndoStack(undo);
      column = new BlockColumn({
        objectId: () => (object as ObjectDto).id,
        isPhone,
        tether: () => tether,
        undo: () => undo as UndoStack,
        afterChange: () => {
          syncChips();
          renderEmptyPrompt();
        },
        createBlock,
      });
      main.append(...headingNodes());
      main.append(column.node);
      main.append(...controlNodes());
      column.setBlocks(loaded.blocks ?? []);
      frame().setTopTitle(headingText());
      renderMargin();
      await loadBacklinks();
      wireLive();
      scrollHandler = (): void => {
        if (column !== null) {
          column.resizeAll();
          column.repositionCarets();
        }
        if (tether !== null) tether.position();
      };
      void document.fonts.ready.then(() => {
        if (column !== null) column.resizeAll();
        if (tether !== null) tether.position();
      });
      window.addEventListener('scroll', scrollHandler, { passive: true });
      window.addEventListener('resize', scrollHandler);
      document.addEventListener('keydown', keyHandler);
    },

    unmount(): void {
      setActiveUndoStack(null);
      if (stopLive !== null) stopLive();
      if (scrollHandler !== null) {
        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
      }
      document.removeEventListener('keydown', keyHandler);
      clear(frame().tetherLayer);
    },

  } as Screen;

  function headingNodes(): Node[] {
      const current = object as ObjectDto;
      const heading = el('h1', { text: headingText(), attrs: { tabindex: '-1' } });
      const rename = el('button', { className: 'rename', text: 'Rename', attrs: { type: 'button' } });
      rename.addEventListener('click', () => {
        const input = el('input', { attrs: { type: 'text', 'aria-label': 'Title' } });
        input.value = current.title;
        heading.replaceWith(input);
        input.focus();
        const finish = async (save: boolean): Promise<void> => {
          if (save) {
            const result = await api.patch<ObjectDto>(`/api/objects/${current.id}`, { title: input.value });
            if (result.ok) {
              object = result.data;
              heading.textContent = headingText();
              frame().setTopTitle(headingText());
              await refreshLibrary();
              frame().renderRail();
            }
          }
          input.replaceWith(heading);
          rename.focus();
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void finish(true);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            void finish(false);
          }
        });
      });
    return [heading, rename];
  }

  function wireLive(): void {
      stopLive = onLive((type, data) => {
        if (object === null || column === null) return;
        if (type === 'block.saved') {
          const block = data['block'] as BlockDto | undefined;
          if (block === undefined) return;
          if (block.object_id !== object.id) {
            if (column.viewOf(block.id) === undefined) return;
          }
          if (column.viewOf(block.id) === undefined) {
            appendBlock(block);
            return;
          }
          column.applyBlockSaved(
            block,
            (data['ops'] as Op[] | null) ?? null,
            (data['edit_id'] as string | null) ?? null,
          );
          return;
        }
        if (type === 'block.removed') {
          column.applyBlockRemoved(String(data['block_id'] ?? ''));
          return;
        }
        if (type === 'backlinks.changed') {
          const objectId = String(data['object_id'] ?? '');
          const count = Number(data['backlinks'] ?? 0);
          if (objectId === object.id) {
            object.backlinks = count;
            void loadBacklinks();
          }
          column.updateOriginCounts(objectId, count);
          if (tether !== null) {
            for (const target of column.quoteTargets()) {
              if (target.originObjectId !== objectId) continue;
              void tether.rollNumeral(target.quoteBlockId, count);
            }
          }
          return;
        }
        if (type === 'object.saved' && String(data['object_id'] ?? '') === object.id) {
          void (async () => {
            const result = await api.get<ObjectDto>(`/api/objects/${(object as ObjectDto).id}`);
            if (!result.ok) return;
            object = result.data;
            renderMargin();
            await loadBacklinks();
          })();
          return;
        }
        if (type === 'object.removed' && String(data['object_id'] ?? '') === object.id) {
          clear(frame().main);
          frame().main.append(el('h1', { text: COPY.notFound }));
          return;
        }
        if (type === 'presence.changed') {
          const sessionId = String(data['session_id'] ?? '');
          if (sessionId === workspace().session.session_id) return;
          column.applyPresence(
            String(data['block_id'] ?? ''),
            sessionId,
            String(data['label'] ?? ''),
            data['anchor'] === null ? null : Number(data['anchor']),
            data['head'] === null ? null : Number(data['head']),
          );
          return;
        }
        if (type === 'sync.reset') {
          void (async () => {
            const result = await api.get<ObjectDto>(`/api/objects/${(object as ObjectDto).id}`);
            if (!result.ok || column === null) return;
            object = result.data;
            column.setBlocks(result.data.blocks ?? []);
            renderMargin();
            await loadBacklinks();
          })();
        }
    });
  }

  function headingText(): string {
    const current = object as ObjectDto;
    return current.daily_date === null ? current.title : dateHeading(current.daily_date);
  }

  function renderEmptyPrompt(): void {
    if (object === null || column === null) return;
    const existing = frame().main.querySelector('.empty-daily');
    if (object.daily_date !== null && column.blocks().length === 0) {
      if (existing === null) {
        const prompt = el('p', { className: 'empty-daily', text: COPY.emptyDailyNote });
        column.node.after(prompt);
      }
      return;
    }
    if (existing !== null) existing.remove();
  }

  function keyHandler(event: KeyboardEvent): void {
    if (event.altKey && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      void focusBacklinks();
      return;
    }
    const meta = event.ctrlKey || event.metaKey;
    if (!meta || undo === null) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undo.undo();
      return;
    }
    if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      void undo.redo();
    }
  }

  async function focusBacklinks(): Promise<void> {
    const before = document.activeElement as HTMLElement | null;
    if (frame().currentLayout() === 'phone' && !frame().isSheetOpen()) {
      frame().openSheet(before);
    }
    const first = frame().margin.querySelector<HTMLElement>('.backlinks-list a');
    if (first !== undefined && first !== null) first.focus();
  }

  function controlNodes(): Node[] {
    const current = object as ObjectDto;
    const addBlock = el('button', { className: 'add-block', text: 'Add block', attrs: { type: 'button' } });
    addBlock.addEventListener('click', () => {
      void (async () => {
        if (column === null) return;
        const blocks = column.blocks();
        const last = blocks[blocks.length - 1];
        const created = await createBlock(last === undefined ? null : last.id, '');
        if (created !== null && column !== null) column.focusBlock(created.id, 0);
      })();
    });

    const fileInput = el('input', { className: 'file-input', attrs: { type: 'file' } });
    fileInput.style.display = 'none';
    const attach = el('button', { className: 'attach-file', text: 'Attach file', attrs: { type: 'button' } });
    attach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      void uploadFile(file);
      fileInput.value = '';
    });

    const sharing = el('select', { className: 'sharing', attrs: { 'aria-label': 'Sharing' } });
    sharing.append(
      el('option', { text: 'Follow collections', attrs: { value: 'follow' } }),
      el('option', { text: 'Never share', attrs: { value: 'never' } }),
    );
    sharing.value = current.share_visibility;
    sharing.addEventListener('change', () => {
      void api.patch<ObjectDto>(`/api/objects/${current.id}`, { share_visibility: sharing.value });
    });

    const addToCollection = el('button', {
      className: 'add-to-collection',
      text: 'Add to collection',
      attrs: { type: 'button' },
    });
    addToCollection.addEventListener('click', () => openCollectionDialog(addToCollection));

    const deleteNote = el('button', { className: 'delete-note', text: 'Delete note', attrs: { type: 'button' } });
    deleteNote.addEventListener('click', () => openDeleteDialog(deleteNote));

    return [
      el('div', {
        className: 'note-controls',
        children: [addBlock, attach, fileInput, sharing, addToCollection, deleteNote],
      }),
    ];
  }

  async function uploadFile(file: File): Promise<void> {
    if (object === null) return;
    const form = new FormData();
    form.append('file', file);
    frame().setSaveStatus(uploadPendingCopy(file.name));
    const result = await api.upload<BlockDto>(`/api/objects/${object.id}/attachments`, form);
    if (result.ok) {
      const filename = result.data.attachment?.filename ?? file.name;
      appendBlock(result.data);
      frame().setSaveStatus(uploadDoneCopy(filename));
      frame().announce(uploadAttachedCopy(filename, object.title));
      return;
    }
    if (result.status === 413) {
      frame().showAlert(COPY.uploadTooLarge);
      frame().setSaveStatus('');
      return;
    }
    if (result.status === 415) {
      frame().showAlert(COPY.uploadWrongType);
      frame().setSaveStatus('');
      return;
    }
    if (result.status === 503) {
      frame().showAlert(COPY.uploadDuringOutage);
      frame().setSaveStatus(COPY.saveFailed);
      frame().setStorageOutage(true);
      return;
    }
    frame().setSaveStatus(COPY.saveFailed);
  }

  function openCollectionDialog(opener: HTMLElement): void {
    const current = object as ObjectDto;
    openDialog({
      label: 'Add to collection',
      opener,
      content: (handle) => {
        const boxes = workspace().collections.map((collection) => {
          const box = el('input', { attrs: { type: 'checkbox', id: `coll-${collection.id}` } });
          box.checked = current.collection_ids.includes(collection.id);
          box.addEventListener('change', () => {
            void (async () => {
              if (box.checked) {
                await api.post(`/api/collections/${collection.id}/objects`, { object_id: current.id });
                current.collection_ids.push(collection.id);
              } else {
                await api.del(`/api/collections/${collection.id}/objects/${current.id}`);
                current.collection_ids = current.collection_ids.filter((id) => id !== collection.id);
              }
            })();
          });
          return el('div', {
            className: 'collection-row',
            children: [box, el('label', { text: collection.name, attrs: { for: `coll-${collection.id}` } })],
          });
        });
        const done = el('button', { text: 'Done', attrs: { type: 'button' } });
        done.addEventListener('click', () => handle.close());
        return [...boxes, done];
      },
    });
  }

  function openDeleteDialog(opener: HTMLElement): void {
    const current = object as ObjectDto;
    const quoteCount = backlinks.filter((backlink) => backlink.kind === 'quote').length;
    openDialog({
      label: 'Delete this note?',
      role: 'alertdialog',
      opener,
      content: (handle) => {
        const confirm = el('button', { text: 'Delete', attrs: { type: 'button' } });
        const cancel = el('button', { text: 'Cancel', attrs: { type: 'button' } });
        confirm.addEventListener('click', () => {
          void (async () => {
            const result = await api.del(`/api/objects/${current.id}`);
            handle.close();
            if (result.ok) {
              await refreshLibrary();
              frame().renderRail();
              navigate('/today', { reveal: true });
            }
          })();
        });
        cancel.addEventListener('click', () => handle.close());
        return [el('p', { text: deleteNoteCopy(quoteCount) }), confirm, cancel];
      },
    });
  }
}
