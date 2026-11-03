export type Breakpoint = 'desktop' | 'tablet' | 'phone';

export const BREAKPOINTS: readonly Breakpoint[] = ['desktop', 'tablet', 'phone'];

export type NodeType =
  | 'page'
  | 'section'
  | 'stack'
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'nav'
  | 'collection_list';

export type StyleKey =
  | 'color'
  | 'background-color'
  | 'font-size'
  | 'padding'
  | 'gap'
  | 'width'
  | 'text-align'
  | 'display'
  | 'flex-direction';

export type TokenRef = { token: string };
export type StyleValue = string | TokenRef;
export type StyleMap = Partial<Record<StyleKey, StyleValue>>;
export type Styles = Record<Breakpoint, StyleMap>;

export type PropValue = string | number;
export type Props = Record<string, PropValue>;

export interface PlinthNode {
  id: string;
  type: NodeType;
  name: string;
  props: Props;
  styles: Styles;
  children: PlinthNode[];
  shared?: { componentId: string };
  bind?: Record<string, string>;
}

export interface Page {
  id: string;
  name: string;
  slug: string;
  order: number;
  root: PlinthNode;
}

export type TokenKind = 'color' | 'size';
export type SizeUnit = 'px' | 'rem';

export interface Token {
  name: string;
  kind: TokenKind;
  value: string | number;
  unit?: SizeUnit;
}

export interface SharedComponent {
  id: string;
  name: string;
  root: PlinthNode;
}

export type FieldKind = 'text' | 'rich_text' | 'image';

export interface Field {
  name: string;
  kind: FieldKind;
}

export interface Entry {
  id: string;
  order: number;
  values: Record<string, string>;
}

export interface Collection {
  name: string;
  fields: Field[];
  entries: Entry[];
}

export interface PlinthDocument {
  id: string;
  name: string;
  slug: string;
  seq: number;
  tokens: Token[];
  pages: Page[];
  components: SharedComponent[];
  collection: Collection;
}

export type Role = 'owner' | 'editor' | 'viewer';
export type PublishState = 'not_published' | 'live' | 'live_changed' | 'unpublished';

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  page: 'Page',
  section: 'Section',
  stack: 'Stack',
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  nav: 'Nav',
  collection_list: 'Collection list',
};

export const INSERTABLE_TYPES: readonly NodeType[] = [
  'section',
  'stack',
  'heading',
  'text',
  'image',
  'button',
  'nav',
  'collection_list',
];

export function breakpointLabel(bp: Breakpoint): string {
  return bp === 'desktop' ? 'Desktop' : bp === 'tablet' ? 'Tablet' : 'Phone';
}

export const FRAME_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 768, phone: 375 };
