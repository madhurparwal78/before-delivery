// React 19 keeps its JSX types inside the module. The screens in this app write
// `JSX.Element` and `React.*` attribute types, so both are exposed globally here.
import type { JSX as ReactJsx } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJsx.Element;
    type ElementType = ReactJsx.ElementType;
    type ElementClass = ReactJsx.ElementClass;
    type IntrinsicElements = ReactJsx.IntrinsicElements;
    type ElementAttributesProperty = ReactJsx.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJsx.ElementChildrenAttribute;
  }
}

export {};
