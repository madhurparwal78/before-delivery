import { resolveStyle } from './breakpoints.js';
import type {
  Breakpoint,
  NodeType,
  PlinthNode,
  StyleKey,
  StyleValue,
  Token,
  TokenKind,
} from './types.js';

export const STYLE_KEYS: readonly StyleKey[] = [
  'color',
  'background-color',
  'font-size',
  'padding',
  'gap',
  'width',
  'text-align',
  'display',
  'flex-direction',
];

export const STYLE_TOKEN_KIND: Record<StyleKey, TokenKind | null> = {
  color: 'color',
  'background-color': 'color',
  'font-size': 'size',
  padding: 'size',
  gap: 'size',
  width: 'size',
  'text-align': null,
  display: null,
  'flex-direction': null,
};

export const CSS_NAMED_COLOURS: readonly string[] = [
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond',
  'blue','blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral',
  'cornflowerblue','cornsilk','crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray',
  'darkgreen','darkgrey','darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid',
  'darkred','darksalmon','darkseagreen','darkslateblue','darkslategray','darkslategrey',
  'darkturquoise','darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue',
  'firebrick','floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod',
  'gray','green','greenyellow','grey','honeydew','hotpink','indianred','indigo','ivory','khaki',
  'lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan',
  'lightgoldenrodyellow','lightgray','lightgreen','lightgrey','lightpink','lightsalmon',
  'lightseagreen','lightskyblue','lightslategray','lightslategrey','lightsteelblue','lightyellow',
  'lime','limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid',
  'mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise',
  'mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy',
  'oldlace','olive','olivedrab','orange','orangered','orchid','palegoldenrod','palegreen',
  'paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue',
  'purple','rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown',
  'seagreen','seashell','sienna','silver','skyblue','slateblue','slategray','slategrey','snow',
  'springgreen','steelblue','tan','teal','thistle','tomato','turquoise','violet','wheat','white',
  'whitesmoke','yellow','yellowgreen','transparent',
];

const SIZE_RE = /^(\d{1,3})(?:\.(\d{1,3}))?(px|rem)$/;
const PERCENT_RE = /^(\d{1,3})(?:\.(\d{1,3}))?%$/;

export function isNamedColour(value: string): boolean {
  return CSS_NAMED_COLOURS.includes(value);
}

function isSizeString(value: string): boolean {
  const m = SIZE_RE.exec(value);
  if (!m) return false;
  return Number(value.slice(0, value.length - m[3]!.length)) <= 999;
}

export function isValidStyleString(key: StyleKey, value: string): boolean {
  switch (key) {
    case 'color':
    case 'background-color':
      return isNamedColour(value);
    case 'font-size':
    case 'padding':
    case 'gap':
      return isSizeString(value);
    case 'width': {
      if (value === 'auto') return true;
      if (isSizeString(value)) return true;
      const m = PERCENT_RE.exec(value);
      return m !== null && Number(value.slice(0, -1)) <= 100;
    }
    case 'text-align':
      return value === 'left' || value === 'center' || value === 'right';
    case 'display':
      return value === 'block' || value === 'flex' || value === 'none';
    case 'flex-direction':
      return value === 'row' || value === 'column';
  }
}

export function styleKeyHint(key: StyleKey): string {
  switch (key) {
    case 'color':
    case 'background-color':
      return `${key} takes a CSS named colour.`;
    case 'font-size':
    case 'padding':
    case 'gap':
      return `${key} takes a number with px or rem.`;
    case 'width':
      return 'width takes px, rem, % or auto.';
    case 'text-align':
      return 'text-align takes left, center or right.';
    case 'display':
      return 'display takes block, flex or none.';
    case 'flex-direction':
      return 'flex-direction takes row or column.';
  }
}

export function isStyleKey(key: string): key is StyleKey {
  return (STYLE_KEYS as readonly string[]).includes(key);
}

export function tokenCssValue(token: Token): string {
  return token.kind === 'size' ? `${token.value}${token.unit ?? 'px'}` : String(token.value);
}

export function findToken(tokens: readonly Token[], name: string): Token | undefined {
  return tokens.find((t) => t.name === name);
}

/** A style value as shown to people: the token name, or the literal value. */
export function styleValueText(value: StyleValue | undefined): string {
  if (value === undefined) return 'nothing';
  return typeof value === 'string' ? value : value.token;
}

export function cssOf(value: StyleValue, tokens: readonly Token[]): string | undefined {
  if (typeof value === 'string') return value;
  const token = findToken(tokens, value.token);
  return token === undefined ? undefined : tokenCssValue(token);
}

const BASE_DEFAULTS: Record<StyleKey, string> = {
  color: '#1b1a17',
  'background-color': 'transparent',
  'font-size': '16px',
  padding: '0px',
  gap: '0px',
  width: 'auto',
  'text-align': 'left',
  display: 'block',
  'flex-direction': 'row',
};

const TYPE_DEFAULTS: Record<NodeType, Partial<Record<StyleKey, string>>> = {
  page: { padding: '24px' },
  section: { padding: '24px' },
  stack: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  heading: {},
  text: {},
  image: { display: 'block', width: '100%' },
  button: { display: 'flex', padding: '12px' },
  nav: { display: 'flex', gap: '16px' },
  collection_list: {},
};

const HEADING_SIZES: Record<number, string> = { 1: '40px', 2: '33px', 3: '28px' };

export function defaultStyleFor(node: PlinthNode, key: StyleKey): string {
  if (node.type === 'heading' && key === 'font-size') {
    const level = Number(node.props['level'] ?? 1);
    return HEADING_SIZES[level] ?? HEADING_SIZES[1]!;
  }
  return TYPE_DEFAULTS[node.type][key] ?? BASE_DEFAULTS[key];
}

/** The nine declarations a node's element carries at one breakpoint. */
export function nodeDeclarations(
  node: PlinthNode,
  bp: Breakpoint,
  tokens: readonly Token[],
): Record<StyleKey, string> {
  const out = {} as Record<StyleKey, string>;
  for (const key of STYLE_KEYS) {
    const stored = resolveStyle(node, bp, key);
    const css = stored === undefined ? undefined : cssOf(stored, tokens);
    out[key] = css ?? defaultStyleFor(node, key);
  }
  return out;
}

export function declarationText(decls: Record<StyleKey, string>): string {
  return STYLE_KEYS.map((key) => `${key}:${decls[key]}`).join(';');
}

/** Shared, context-free styling of node elements: the same rules in both renders. */
export const BASE_NODE_CSS = `
.pl-node{box-sizing:border-box;margin:0;max-width:100%;overflow-wrap:anywhere;font-family:'IBM Plex Sans',system-ui,sans-serif;line-height:1.45;border:0}
.pl-heading{font-family:'Space Grotesk','IBM Plex Sans',system-ui,sans-serif;font-weight:700;line-height:1.2}
.pl-image{object-fit:cover;aspect-ratio:16/10}
.pl-collection_list{list-style:none}
.pl-collection_list>li{list-style:none;max-width:100%}
.pl-button{text-decoration:none;border:1px solid currentColor;border-radius:2px;align-items:center;justify-content:center;min-height:44px;min-width:44px;cursor:pointer}
.pl-nav{flex-wrap:wrap;align-items:center}
.pl-empty-list{font-family:'IBM Plex Sans',system-ui,sans-serif;color:#6b6760}
`;
