export const USERNAME_MESSAGE =
  'Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter.';
export const PASSWORD_MESSAGE = 'Passwords are 8 to 128 characters.';
export const USERNAME_TAKEN_MESSAGE = 'That username is taken.';
export const WRONG_CREDENTIALS_MESSAGE = 'Wrong username or password.';
export const LAYOUT_NAME_MESSAGE = 'Layout names are 1 to 80 characters.';
export const TEMPLATE_MESSAGE = 'Choose a starter template.';
export const VERSION_NAME_MESSAGE = 'Version names are 1 to 60 characters.';
export const BODY_MESSAGE = 'The request body is not valid.';

export const SIZE_FORM_MESSAGE = 'Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).';
export const SIZE_RANGE_MESSAGE =
  'Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%.';
export const SIZE_FR_MIN_MESSAGE = 'A flexible size (fr) can only be the maximum in minmax.';
export const SIZE_ORDER_MESSAGE = 'The minimum is larger than the maximum.';

export const GAP_MESSAGE = 'Gaps are whole pixels from 0 to 200.';

export const AREA_NAME_MESSAGE =
  'Area names use 1 to 24 lowercase letters, digits and hyphens and start with a letter.';
export const AREA_RESERVED_MESSAGE = 'The name layout is reserved.';

export const BREAKPOINT_RANGE_MESSAGE = 'Breakpoints start between 400px and 1440px.';
export const CSS_LENGTH_MESSAGE = 'The CSS is longer than 20,000 characters.';

export const UNKNOWN_CHANGE_MESSAGE = 'Unknown change.';
export const UNKNOWN_BASE_REVISION_MESSAGE = 'Unknown base revision.';
export const NOTHING_TO_UNDO_MESSAGE = 'Nothing to undo.';
export const NOTHING_TO_REDO_MESSAGE = 'Nothing to redo.';

export const maxColumnsMessage = (maxTracks: number): string =>
  `A layout can have at most ${maxTracks} columns.`;
export const maxRowsMessage = (maxTracks: number): string =>
  `A layout can have at most ${maxTracks} rows.`;
export const MIN_COLUMNS_MESSAGE = 'A layout needs at least one column.';
export const MIN_ROWS_MESSAGE = 'A layout needs at least one row.';
export const maxBreakpointsMessage = (maxBreakpoints: number): string =>
  `A layout can have at most ${maxBreakpoints} breakpoints.`;
export const duplicateBreakpointMessage = (minWidth: number): string =>
  `There is already a breakpoint at ${minWidth}px.`;
export const noBreakpointMessage = (minWidth: number): string =>
  `There is no breakpoint at ${minWidth}px.`;
export const noTrackMessage = (axis: 'column' | 'row', index: number): string =>
  axis === 'column' ? `There is no column ${index}.` : `There is no row ${index}.`;
export const noVersionMessage = (n: number): string => `There is no version ${n}.`;
export const noAreaMessage = (name: string): string => `There is no area ${name}.`;
export const nameUsedMessage = (name: string): string => `The name ${name} is already used.`;
export const overlapMessage = (name: string, other: string): string =>
  `Area ${name} would overlap area ${other}.`;
export const rectangleMessage = (name: string): string => `Area ${name} must stay one rectangle.`;
