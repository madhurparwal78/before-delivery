import { BOARD_COPY, MAKE_BOARD_COPY } from '../../shared/copy';
import type { BoardDto, BoardSummary, PostsListing, UserDto } from '../../shared/types';
import { parseSections } from '../../shared/validate';
import { RequestFailed, api } from '../api';
import { openDialog } from '../dialog';
import { el, field, messageLine, on } from '../dom';
import { applyFrameData, createFrame, renderClosedFrame } from '../frames';
import { signOutButton } from '../shell';

const boardRun = (board: BoardSummary, listing: PostsListing): HTMLElement => {
  const frames = el('div', { class: 'frames' });
  const posts = listing.sections.flatMap((section) => section.posts).slice(0, 8);
  for (const post of posts) {
    const frame = createFrame(post);
    frame.removeAttribute('tabindex');
    applyFrameData(frame, post, post.section_id, post.position);
    renderClosedFrame(frame, post);
    frames.append(frame);
  }
  if (posts.length === 0) frames.append(el('p', { class: 'empty-line', text: BOARD_COPY.empty }));
  return el('section', { class: 'board-run' }, [el('h2', { text: board.title }), frames]);
};

const makeBoardDialog = (opener: HTMLElement): void => {
  openDialog({
    name: 'Make a board',
    opener,
    content: (handle) => {
      const title = el('input', { type: 'text', 'aria-label': 'Board title' });
      const sections = el('input', { type: 'text', 'aria-label': 'Sections', value: 'Ideas, Booked, Done' });
      const titleMessage = messageLine();
      const sectionsMessage = messageLine();
      const alert = el('p', { role: 'alert' });
      const create = el('button', { type: 'button', text: 'Create board' });

      const submit = async (): Promise<void> => {
        titleMessage.textContent = '';
        sectionsMessage.textContent = '';
        alert.textContent = '';
        const parts = parseSections(sections.value);
        try {
          const board = await api.post<BoardDto>('/api/boards', { title: title.value, sections: parts });
          handle.close();
          window.location.assign(`/b/${board.id}`);
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          titleMessage.textContent = error.fieldError('title') ?? '';
          sectionsMessage.textContent = error.fieldError('sections') ?? '';
          const first = error.fieldError('title') ?? error.fieldError('sections');
          if (first !== null) alert.textContent = first;
          else alert.textContent = MAKE_BOARD_COPY.sectionCount;
        }
      };

      on(create, 'click', () => void submit());
      for (const input of [title, sections]) {
        on(input, 'keydown', (event) => {
          if (event.key === 'Enter') void submit();
        });
      }
      return [
        el('h2', { text: 'Make a board' }),
        field('Board title', title, titleMessage),
        field('Sections', sections, sectionsMessage, BOARD_COPY.sectionsHint),
        create,
        alert,
      ];
    },
    focus: (root) => root.querySelector<HTMLElement>('input'),
  });
};

export const renderDashboard = async (root: HTMLElement, user: UserDto): Promise<void> => {
  const { boards } = await api.get<{ boards: BoardSummary[] }>('/api/boards');
  const makeBoard = el('button', { type: 'button', text: 'Make a board' });
  on(makeBoard, 'click', () => makeBoardDialog(makeBoard));

  const boardList = el(
    'ul',
    { 'aria-label': 'Your boards' },
    boards.map((board) => el('li', {}, [el('a', { href: `/b/${board.id}`, text: board.title })])),
  );
  const waiting = boards.filter((board) => board.held > 0);
  const waitingList = el(
    'ul',
    { 'aria-label': 'Waiting on you' },
    waiting.map((board) =>
      el('li', {}, [
        el('a', { href: `/b/${board.id}`, text: board.title }),
        el('span', { class: 'muted', text: ` ${board.held} waiting for approval` }),
      ]),
    ),
  );

  root.append(
    el('header', { class: 'header' }, [el('span', { class: 'wordmark', text: 'Pinsheet' }), signOutButton()]),
    el('div', { class: 'band' }, [
      el('p', { text: user.display_name }),
      el('p', { class: 'muted', text: BOARD_COPY.boardCount(boards.length) }),
      el('h1', { text: 'Your boards' }),
      boardList,
      el('h2', { text: 'Waiting on you' }),
      waitingList,
      makeBoard,
    ]),
  );

  const sheet = el('div', {});
  root.append(sheet);
  for (const board of boards) {
    const listing = await api.get<PostsListing>(`/api/boards/${board.id}/posts`);
    sheet.append(boardRun(board, listing));
  }
};
