/** Renderer registration so state modules never import the DOM layer. */
let renderer: (() => void) | null = null;

export function registerRender(fn: () => void): void { renderer = fn }
export function requestRender(): void { renderer?.() }
