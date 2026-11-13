import {
  ArrowDown,
  ArrowUp,
  Box,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Users,
} from 'lucide';

type IconNode = [string, Record<string, string | number>, IconNode[]?];

/** Renders a bundled ISC-licensed icon to markup. */
function render(node: IconNode): string {
  const [tag, attrs, children] = node;
  const attributes = Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(' ');
  const inner = (children ?? []).map((child) => render(child as IconNode)).join('');
  return `<${tag} ${attributes}>${inner}</${tag}>`;
}

const toMarkup = (icon: unknown): string => render(icon as IconNode);

export const icons = {
  add: toMarkup(Plus),
  drag: toMarkup(GripVertical),
  show: toMarkup(Eye),
  hide: toMarkup(EyeOff),
  lock: toMarkup(Lock),
  unlock: toMarkup(LockOpen),
  actions: toMarkup(MoreHorizontal),
  up: toMarkup(ArrowUp),
  down: toMarkup(ArrowDown),
  duplicate: toMarkup(Copy),
  trash: toMarkup(Trash2),
  undo: toMarkup(Undo2),
  redo: toMarkup(Redo2),
  members: toMarkup(Users),
  play: toMarkup(Play),
  pause: toMarkup(Pause),
  box: toMarkup(Box),
};
