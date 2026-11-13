// Every sentence the brief prints, in one place. The server and the browser import these;
// no other file writes one of these sentences.

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);
export const entities = (n: number): string => plural(n, 'entity', 'entities');

// -- accounts
export const WRONG_CREDENTIALS = 'Wrong username or password.';
export const TOO_MANY_SIGN_INS = 'Too many sign-ins. Wait a minute and try again.';
export const BAD_USERNAME = 'Use 3 to 24 lower-case letters, digits or underscores.';
export const SHORT_PASSWORD = 'Use at least 8 characters.';
export const USERNAME_TAKEN = 'That username is taken.';

// -- server boundary
export const CROSS_ORIGIN = 'Requests from other sites are refused.';
export const STALE_BASE = 'This change is too old. Reload the drawing and try again.';
export const NOT_FOUND_PAGE = "We couldn't find that page.";

// -- storage actions
export const PUBLISHING = 'Publishing…';
export const publishedVersion = (n: number): string => `Published version ${n}.`;
export const PUBLISH_OUTAGE = 'File storage is unavailable. Nothing was published. Try again in a moment.';
export const UPLOADING = 'Uploading…';
export const UNDERLAY_ATTACHED = 'Underlay attached.';
export const UNDERLAY_WRONG_TYPE = 'Underlays must be PNG or JPEG images.';
export const underlayQuota = (quota: number): string => `This drawing's underlays would pass ${quota} bytes.`;
export const UNDERLAY_OUTAGE = 'File storage is unavailable. Nothing was added. Try again in a moment.';
export const READING_FILE = 'Reading file…';
export const imported = (n: number): string => `Imported ${n} entities.`;
export const NOT_A_PLOTFOLD_FILE = "That isn't a Plotfold drawing text file.";
export const IMPORT_ERRORS = 'That file has errors. The lines are listed.';
export const EXPORT_STARTED = 'Export started.';
export const EXPORT_READY = 'Export ready.';
export const EXPORT_FAILED = 'Export failed: file storage is unavailable.';
export const importPreview = (e: number, l: number, b: number): string => `Adds ${e} entities, ${l} layers, ${b} blocks.`;
export const importRename = (from: string, to: string): string => `${from} renamed ${to}`;

// -- connection
export const CONNECTION_LIVE = 'Live';
export const CONNECTION_RECONNECTING = 'Reconnecting…';
export const offlineBanner = (n: number): string => `You're working offline. ${plural(n, 'change', 'changes')} waiting.`;
export const backOnline = (sent: number, conflicts: number): string =>
  `Back online: ${plural(sent, 'change', 'changes')} sent, ${plural(conflicts, 'conflict', 'conflicts')}.`;

// -- drawing announcements
const KIND_LABEL = { line: 'Line', pline: 'Polyline', circle: 'Circle', arc: 'Arc', hatch: 'Hatch', dimension: 'Dimension', insert: 'Block' } as const;
export const kindAdded = (kind: keyof typeof KIND_LABEL, handle: string): string => `${KIND_LABEL[kind]} ${handle} added`;
export const entitiesAdded = (n: number): string => `${n} entities added`;
export const MODIFY_VERB = { MOVE: 'Moved', COPY: 'Copied', ROTATE: 'Rotated', SCALE: 'Scaled', MIRROR: 'Mirrored', ERASE: 'Erased' } as const;
export const modifyDone = (verb: (typeof MODIFY_VERB)[keyof typeof MODIFY_VERB], n: number): string => `${verb} ${entities(n)}`;
export const arrayed = (n: number): string => `Arrayed: ${n} copies added`;
export const trimmed = (n: number): string => `Trim: ${entities(n)} changed`;
export const extended = (n: number): string => `Extend: ${entities(n)} changed`;
export const filleted = (n: number): string => `Fillet: ${entities(n)} changed`;
export const chamfered = (n: number): string => `Chamfer: ${entities(n)} changed`;
export const offsetAdded = (n: number): string => `Offset: ${entities(n)} added`;
export const exploded = (handle: string, n: number): string => `Exploded ${handle}: ${entities(n)} added`;
export const blockDefined = (name: string): string => `Block ${name} defined`;
export const blockRedefined = (name: string): string => `Block ${name} redefined`;
export const undone = (command: string): string => `Undo: ${command}`;
export const redone = (command: string): string => `Redo: ${command}`;
export const NOTHING_TO_UNDO = 'Nothing to undo.';
export const NOTHING_TO_REDO = 'Nothing to redo.';
export const otherMoved = (user: string, handle: string): string => `${user} moved ${handle}`;
export const otherChanged = (user: string, n: number): string => `${user} changed ${entities(n)}`;
export const aidToggled = (aid: 'Snap' | 'Ortho' | 'Grid' | 'Polar', on: boolean): string => `${aid} ${on ? 'on' : 'off'}`;
export const stoppedFollowing = (user: string): string => `Stopped following ${user}.`;
export const findCount = (k: number, n: number): string => (n === 0 ? 'No matches.' : `${k} of ${n}`);
export const PHONE_COMMAND = "Drawing commands aren't available on a phone. Open this drawing on a desktop to edit.";

// -- command line
export const PROMPT_READY = 'Ready. Type a command.';
export const PROMPT_CANCELLED = 'Cancelled.';
export const unknownCommand = (typed: string): string => `Unknown command: ${typed.toUpperCase()}. Nothing happened.`;
export const NOT_A_POINT = "That isn't a point. Try 10,20 or @5,0 or @10<45.";
export const NOT_A_NUMBER = "That isn't a number.";
export const NUMBER_ABOVE_ZERO = 'Enter a number greater than 0.';
export const NUMBER_TOO_LARGE = 'That number is too large.';
export const EXPRESSION_TOO_DEEP = 'That expression is nested too deeply.';
export const noBlock = (name: string): string => `No block named ${name}.`;
export const noDrawingInFolder = (name: string): string => `No drawing named ${name} in this folder.`;
export const noXref = (name: string): string => `No xref named ${name}.`;
export const NOTHING_TO_PICK = 'Nothing there to pick.';
export const distResult = (d: string, a: string): string => `DIST: ${d} units, angle ${a} degrees`;
export const areaResult = (area: string): string => `AREA: ${area}`;
export const purged = (blocks: number, layers: number): string => `Purged ${blocks} blocks, ${layers} layers.`;
export const VIEW_ONLY = 'You can view this drawing but not edit it.';

// -- geometry refusals
export const TRIM_WRONG_TYPE = 'TRIM works on lines, arcs and circles. Explode a polyline first.';
export const TRIM_NOTHING = "Nothing to trim: that entity doesn't cross a cutting edge.";
export const EXTEND_NOTHING = 'Nothing to extend: no boundary in that direction.';
export const FILLET_PARALLEL = 'These lines are parallel. Nothing to fillet.';
export const FILLET_TOO_LARGE = 'Radius too large for these lines.';
export const CHAMFER_PARALLEL = 'These lines are parallel. Nothing to chamfer.';
export const CHAMFER_TOO_LARGE = 'Distance too large for these lines.';
export const OFFSET_ZERO_RADIUS = 'Offset would make a radius of zero or less.';
export const NO_BOUNDARY = 'No closed boundary around that point.';

// -- layers, blocks, dimensions, hatch
export const LAYER_ZERO = "Layer 0 can't be deleted.";
export const layerHasEntities = (name: string, n: number): string => `Layer ${name} has ${n} entities. Move them first.`;
export const FROZEN_CURRENT = "Frozen layers can't be current.";
export const layerLocked = (name: string): string => `Layer ${name} is locked.`;
export const leftSelection = (user: string, layer: string, n: number): string => `${user} locked ${layer}. ${n} entities left your selection.`;
export const blockSelfContained = (name: string, chain: string[]): string => `Block ${name} can't contain itself: ${chain.join(' -> ')}.`;
export const dimensionLost = (handle: string): string => `Dimension ${handle} lost its geometry.`;
export const hatchBroken = (handle: string): string => `Hatch ${handle}: boundary broken. It no longer follows its edges.`;
export const GEOMETRY_CHANGED_LABEL = 'Geometry changed under this markup';

// -- constraints, parameters, xrefs
export const overConstrained = (added: string, existing: string): string => `Over-constrained: ${added} conflicts with ${existing}.`;
export const expressionCycle = (chain: string[]): string => `Expression cycle: ${chain.join(' -> ')}.`;
export const unknownParameter = (name: string): string => `Unknown parameter: ${name}.`;
export const divideByZero = (name: string): string => `Expression divides by zero: ${name}.`;
export const xrefNewVersion = (name: string): string => `${name} has a new version. Reload?`;
export const circularReference = (chain: string[]): string => `Circular reference: ${chain.join(' -> ')}.`;

// -- operations and conflicts
export const undoSuperseded = (user: string, handle: string): string => `Can't undo: ${user} changed ${handle} after you.`;
export const conflictMoved = (user: string, handle: string): string => `${user} moved ${handle} after you.`;
export const conflictChanged = (user: string, handle: string): string => `${user} changed ${handle} after you.`;
export const conflictDeleted = (user: string, handle: string): string => `${user} deleted ${handle}. Your change was dropped.`;
export const conflictLayerDeleted = (user: string, layer: string): string => `${user} deleted layer ${layer}. Your entity is on layer 0.`;
export const conflictRedefined = (user: string, block: string): string => `${user} redefined ${block}. Your insert uses the new one.`;

// -- versions, reviews, issues, RFIs, roles, links
export const versionTransition = (from: string, to: string): string => `A version can't go from ${from} to ${to}.`;
export const replacedBy = (n: number): string => `Replaced by version ${n}`;
export const WAITING_ON_STEP_BEFORE = 'Waiting on the step before.';
export const reviewVoided = (n: number): string => `Review voided: version ${n} replaced this one.`;
export const REVIEW_EXPIRED = 'This review expired.';
export const stepTransition = (from: string, to: string): string => `A review step can't go from ${from} to ${to}.`;
export const utcMinute = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
export const stamp = (verdict: 'Approved' | 'Rejected', user: string, at: string): string => `${verdict} by ${user} at ${at} UTC`;
export const issueTransition = (from: string, to: string): string => `An issue can't go from ${from} to ${to}.`;
export const ISSUE_REOPEN_REFUSED = 'Only a manager or the issue creator can reopen an issue.';
export const CLOSE_RFI_FIRST = 'Close its RFI first.';
export const rfiTransition = (from: string, to: string): string => `An RFI can't go from ${from} to ${to}.`;
export const RFI_ANSWER_REQUIRED = 'Write an answer first.';
export const rfiWithOther = (user: string): string => `This RFI is with ${user}.`;
export const withUser = (user: string): string => `With ${user}`;
export const sheetLockedBy = (user: string): string => `This sheet is locked by ${user}.`;
export const roleNow = (role: string): string => `Your role is now ${role}.`;
export const ACCESS_REVOKED = 'You no longer have access to this drawing.';
/** The sentence of a view link that no longer opens, by the error code the server answers with. */
export const LINK_ENDED = { link_expired: 'This link has expired.', link_revoked: 'This link was turned off.' } as const;
export const exportTransition = (from: string, to: string): string => `An export can't go from ${from} to ${to}.`;
export const EXPORT_NOT_READY = 'That export is not ready yet.';

// -- public pages
export const LANDING_TAGLINE = 'Draw to scale, publish, then review.';
export const NO_DRAWINGS_YET = 'No drawings yet.';

// -- operation validation (shared/model): refusals the brief does not print
export const noEntity = (handle: string): string => `No entity ${handle}.`;
export const xrefReadOnly = (id: string): string => `${id} belongs to an xref and can't be edited.`;
export const noLayer = (name: string): string => `No layer named ${name}.`;
export const layerExists = (name: string): string => `Layer ${name} already exists.`;
export const noLayerState = (name: string): string => `No layer state named ${name}.`;
export const noDimStyle = (name: string): string => `No dimension style named ${name}.`;
export const noConstraint = (id: string): string => `No constraint ${id}.`;
export const noParameter = (name: string): string => `No parameter named ${name}.`;
export const unknownField = (field: string): string => `${field} can't be set here.`;
export const invalidValue = (field: string): string => `${field} has an invalid value.`;
export const NAME_REQUIRED = 'Enter a name.';
export const notAnInsert = (handle: string): string => `${handle} is not a block insert.`;
export const PARAMETER_NAME = 'Parameters are named d followed by digits.';
export const constraintNeeds = (kind: string, what: string): string => `${kind} needs ${what}.`;
export const xrefExists = (name: string): string => `An xref named ${name} already exists.`;

export const VERSION_STATE_LABEL = {
  publishing: 'Publishing',
  published: 'Published',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  voided: 'Voided',
} as const;

// -- server refusals the brief gives no sentence for
export const UNAUTHENTICATED = 'Sign in to continue.';
export const FORBIDDEN = 'Your role does not allow that.';
export const NOT_FOUND = "We couldn't find that.";
export const OPS_RATE_LIMITED = 'Too many changes. Wait a minute and try again.';
export const REQUEST_TOO_LARGE = 'That request is too large.';
export const NOT_JSON = 'The request body must be JSON.';
export const UNSTORABLE_TEXT = "Text can't contain null characters or unpaired surrogates.";
export const STORAGE_UNAVAILABLE = 'File storage is unavailable. Try again in a moment.';
export const SERVER_FAULT = 'The server could not complete that request. Try again in a moment.';
export const FOLDER_NAME = 'Enter a name of up to 120 characters.';
export const DRAWING_NAME_TAKEN = 'A drawing with that name already exists in this folder.';
export const ROLE_NAME = 'Use view, markup, edit or manage.';

// -- sheets, versions, markups, issues, RFIs, exports and uploads: validation sentences the brief leaves open
export const mustBeNumber = (field: string): string => `${field} must be a number.`;
export const SHEET_SIZE = 'Use A3 or A4.';
export const VIEWPORT_SIZE = 'A viewport needs a width and a height above 0.';
export const VIEWPORT_SCALE = 'Use a scale such as 1:50.';
export const FROZEN_LAYERS = 'Frozen layers are a list of layer names.';
export const TITLE_BLOCK_TEXT = 'A title block value is text.';
export const titleBlockFilled = (tag: string): string => `${tag} fills itself and can't be edited.`;
export const titleBlockUnknown = (tag: string): string => `The title block has no ${tag}.`;
export const SHEET_PATCH = 'Send attributes, locked, or both.';
export const LOCKED_FLAG = 'locked is true or false.';
export const MARKUP_KIND = 'Use cloud, arrow or text.';
export const MARKUP_TEXT = 'Markup text is text.';
export const ISSUE_TITLE = 'Enter an issue title.';
export const TRANSITION_TARGET = 'Name the state to move to.';
export const RFI_QUESTION = 'Enter a question.';
export const RFI_ADDRESSEE = 'Choose someone else who has a role on this folder.';
export const EXPORT_FORMAT = 'Use plot.txt or svg.';
export const UNDERLAY_CORNERS = 'Give both corners as numbers: x1, y1, x2 and y2.';

// -- entity list and Properties (geometry)
export const VARIES = '*VARIES*';
export const rowLine = (handle: string, layer: string, from: string, to: string, length: string): string =>
  `Line ${handle}, layer ${layer}, from ${from} to ${to}, length ${length}`;
export const rowCircle = (handle: string, layer: string, centre: string, radius: string, area: string): string =>
  `Circle ${handle}, layer ${layer}, centre ${centre}, radius ${radius}, area ${area}`;
export const rowArc = (handle: string, layer: string, centre: string, radius: string, start: string, end: string, length: string): string =>
  `Arc ${handle}, layer ${layer}, centre ${centre}, radius ${radius}, from ${start} to ${end} degrees, length ${length}`;
export const rowPolyline = (handle: string, layer: string, points: number, length: string, area: string | null): string =>
  `Polyline ${handle}, layer ${layer}, ${points} points, ${area === null ? 'open' : 'closed'}, length ${length}${area === null ? '' : `, area ${area}`}`;
export const rowHatch = (handle: string, layer: string, area: string): string => `Hatch ${handle}, layer ${layer}, area ${area}`;
export const rowDimension = (handle: string, layer: string, kind: string, value: string): string => `Dimension ${handle}, layer ${layer}, ${kind}, value ${value}`;
export const rowInsert = (handle: string, layer: string, block: string, at: string, scale: string, rotation: string): string =>
  `Block ${handle}, layer ${layer}, ${block} at ${at}, scale ${scale}, rotation ${rotation}`;

// -- sheets (geometry)
export const TITLE_BLOCK_TAGS = ['Sheet no', 'Title', 'Drawn by', 'Scale', 'Project', 'Checked by'] as const;
/** The tags that fill themselves and cannot be edited. */
export const TITLE_BLOCK_AUTO_TAGS: readonly string[] = ['Sheet no', 'Title', 'Drawn by', 'Scale'];
export const SCALE_VARIES = 'Varies';

// -- drawing screens: empty panels and review area
export const NO_ENTITIES = 'No entities yet.';
export const NO_PARAMETERS = 'No parameters yet.';
export const NO_XREFS = 'No xrefs attached.';
export const NO_VERSIONS = 'No published versions yet.';
export const NO_ISSUES = 'No issues yet.';
export const NO_MARKUPS = 'No markups yet.';
export const NO_HISTORY = 'Select an entity to read its history.';
export const NO_COMPARE = 'Publish two versions to compare them.';
export const NO_SELECTION = 'Select an entity to read its properties.';
export const CLIP_FORMAT = 'Give the clip as four numbers: x1,y1,x2,y2.';
export const restoredVersion = (n: number): string => `Restored version ${n}.`;
export const compareCounts = (added: number, removed: number, changed: number): string => `Added ${added}, removed ${removed}, changed ${changed}`;
export const historyLine = (user: string, command: string, at: string): string => `${user} ${command} at ${at} UTC`;

// -- xref rows of the Xrefs panel: the numbers arrive formatted
export const xrefPlacement = (source: string, x: string, y: string, scale: string, rotation: string): string => `${source} at ${x},${y}, scale ${scale}, rotation ${rotation}`;
export const xrefClip = (rect: string): string => `Clipped to ${rect}`;
