import {
  ClientRecord,
  MeResponse,
  Reminder,
  ReturnCounts,
  ReturnRecord,
  StateRecord,
} from '../shared/types';

export type DialogKind =
  | 'add-client'
  | 'register'
  | 'holidays'
  | 'edition'
  | 'mark-filed'
  | 'file-extension'
  | 'record-amendment'
  | 'send-back';

export interface DialogState {
  kind: DialogKind;
  openerKey: string;
  clientId: string | null;
  clientName: string | null;
  stateCode: string | null;
  returnId: string | null;
  fields: Record<string, string>;
  errors: Record<string, string>;
  saving: boolean;
  entering: boolean;
  leaving: boolean;
}

export interface Draft {
  gross_sales: string;
  tax_due: string;
  version: number;
}

export type BandPhase = 'closed' | 'opening' | 'settled';

export interface AppState {
  booted: boolean;
  me: MeResponse | null;
  path: string;
  search: string;
  notFound: boolean;
  returns: ReturnRecord[];
  /** Carried returns whose nominal day falls in the month on screen. */
  ghosts: ReturnRecord[];
  counts: ReturnCounts;
  practiceCounts: ReturnCounts;
  states: StateRecord[];
  clients: ClientRecord[];
  services: { mail: boolean; pdf: boolean };
  announcement: string;
  dialog: DialogState | null;
  dialogFocused: boolean;
  dialogRefocus: boolean;
  drafts: Record<string, Draft>;
  formFields: Record<string, string>;
  formErrors: Record<string, string>;
  saving: Record<string, boolean>;
  detail: ReturnRecord | null;
  reminders: Reminder[];
  focusedDate: string | null;
  pendingDayFocus: string | null;
  openDay: string | null;
  bandPhase: BandPhase;
  selectedReturnId: string | null;
}

const EMPTY_COUNTS: ReturnCounts = { total: 0, overdue: 0, awaiting_approval: 0 };

export function initialState(): AppState {
  return {
    booted: false,
    me: null,
    path: window.location.pathname,
    search: window.location.search,
    notFound: false,
    returns: [],
    ghosts: [],
    counts: { ...EMPTY_COUNTS },
    practiceCounts: { ...EMPTY_COUNTS },
    states: [],
    clients: [],
    services: { mail: true, pdf: true },
    announcement: '',
    dialog: null,
    dialogFocused: false,
    dialogRefocus: false,
    drafts: {},
    formFields: {},
    formErrors: {},
    saving: {},
    detail: null,
    reminders: [],
    focusedDate: null,
    pendingDayFocus: null,
    openDay: null,
    bandPhase: 'closed',
    selectedReturnId: null,
  };
}
