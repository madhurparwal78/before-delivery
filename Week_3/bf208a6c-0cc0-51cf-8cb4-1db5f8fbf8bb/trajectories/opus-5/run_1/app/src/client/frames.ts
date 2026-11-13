import { BOARD_COPY } from '../shared/copy';
import type { PostDto } from '../shared/types';
import { clear, el, svg } from './dom';
import { fileIcon, icons } from './icons';

const SANDS = ['#e7dcc6', '#dccfb4', '#d3c6a8', '#cbbd9b'];
const GREENS = ['#6d8a52', '#54703e', '#425c31', '#7d9a62'];

const hash = (value: string): number => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const pick = <T>(list: T[], seed: number): T => list[seed % list.length];

/** A photo-like field built from the palette, seeded by the post id. */
export const proceduralField = (seedSource: string): string => {
  const seed = hash(seedSource);
  const sandA = pick(SANDS, seed);
  const sandB = pick(SANDS, seed >> 3);
  const greenA = pick(GREENS, seed >> 6);
  const greenB = pick(GREENS, seed >> 9);
  const angle = 20 + (seed % 140);
  const x = 20 + ((seed >> 4) % 60);
  const y = 20 + ((seed >> 7) % 60);
  const stop = 30 + ((seed >> 11) % 40);
  return [
    `radial-gradient(circle at ${x}% ${y}%, ${greenA} 0 18%, transparent 19%)`,
    `radial-gradient(circle at ${100 - y}% ${100 - x}%, ${sandB} 0 26%, transparent 27%)`,
    `linear-gradient(${angle}deg, ${sandA} 0 ${stop}%, ${greenB} ${stop}% 100%)`,
  ].join(', ');
};

const frameWidth = (post: PostDto): number => {
  if (post.attachment !== null && post.attachment.content_type.startsWith('image/')) return 128;
  return 104 + (hash(post.id) % 5) * 12;
};

const counts = (post: PostDto): HTMLElement =>
  el('p', { class: 'frame-counts' }, [
    svg(icons.heart, 'count-icon'),
    String(post.likes),
    svg(icons.votes, 'count-icon'),
    String(post.score),
    svg(icons.comments, 'count-icon'),
    String(post.comments),
  ]);

export const renderClosedFrame = (frame: HTMLElement, post: PostDto): void => {
  const signature = [
    post.id,
    post.attachment?.id ?? '',
    post.state,
    post.title,
    post.likes,
    post.score,
    post.comments,
  ].join('|');
  if (frame.getAttribute('data-render') === signature) return;
  frame.setAttribute('data-render', signature);
  clear(frame);
  frame.style.setProperty('--frame-width', `${frameWidth(post)}px`);
  const attachment = post.attachment;
  if (attachment !== null && attachment.content_type.startsWith('image/')) {
    const image = el('img', { src: attachment.url, alt: post.title });
    image.addEventListener('load', () => {
      if (image.naturalHeight === 0 || frame.getAttribute('data-loupe') === 'open') return;
      const natural = Math.round((frame.clientHeight * image.naturalWidth) / image.naturalHeight);
      frame.style.setProperty('--frame-width', `${Math.min(Math.max(natural, 88), 280)}px`);
    });
    frame.append(image);
  } else if (attachment !== null) {
    frame.append(
      el('span', { class: 'frame-file' }, [svg(fileIcon(attachment.content_type), 'file-icon'), el('span', { text: attachment.file_name })]),
    );
  } else {
    const fieldNode = el('span', { class: 'frame-field' });
    fieldNode.style.backgroundImage = proceduralField(post.id);
    frame.append(fieldNode);
  }
  if (post.state === 'awaiting_approval') {
    frame.append(el('span', { class: 'frame-note', text: BOARD_COPY.awaitingApproval }));
  }
  frame.append(el('span', { class: 'frame-band' }, [el('span', { class: 'frame-title', text: post.title }), counts(post)]));
};

export const createFrame = (post: PostDto): HTMLElement => {
  const frame = el('article', {
    class: 'frame',
    tabindex: '0',
    'aria-label': post.title,
    'data-post-id': post.id,
    'data-loupe': 'closed',
  });
  return frame;
};

export const applyFrameData = (frame: HTMLElement, post: PostDto, sectionId: string, position: number | null): void => {
  frame.setAttribute('aria-label', post.title);
  frame.setAttribute('data-section-id', sectionId);
  frame.setAttribute('data-author-id', post.author.id);
  frame.setAttribute('data-state', post.state);
  frame.setAttribute('data-likes', String(post.likes));
  frame.setAttribute('data-score', String(post.score));
  frame.setAttribute('data-comments', String(post.comments));
  if (position === null) frame.removeAttribute('data-position');
  else frame.setAttribute('data-position', String(position));
};
