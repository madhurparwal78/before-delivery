// One import point for Preact, its hooks and htm.
import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { render, Fragment };
export { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect };
