import type { ReactElement } from "react";

declare global {
  namespace JSX {
    type Element = ReactElement;
    interface IntrinsicElements {
      [name: string]: unknown;
    }
  }
}

export {};
