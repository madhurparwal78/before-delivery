import type {
  Access,
  ActivityEntry,
  DrawingObject,
  ExportRecord,
  FileItem,
  Issue,
  Layer,
  Layout,
  ShareLink,
  Trace,
  Units,
  Xref,
} from "../shared/types.js";

export interface MeResponse {
  user: { id: string; name: string; email: string; time_zone: string; verified: boolean };
  trial: { days_left: number; ended: boolean };
  now: string;
}

export interface FolderResponse {
  folder: { id: string; name: string; parent_id: string | null };
  items: FileItem[];
}

export interface DrawingResponse {
  id: string;
  name: string;
  folder_id: string | null;
  owner: { name: string };
  units: Units;
  plot_style: "Monochrome" | "Color" | "Grayscale";
  version: number;
  access: Access;
  layers: Layer[];
  objects: DrawingObject[];
  intersections: Array<[number, number]>;
  layouts: Layout[];
  xrefs: Xref[];
  traces: Trace[];
}

export interface CommandResponse {
  version: number;
  created: string[];
  modified: string[];
  erased: string[];
  locked: string[];
  objects: DrawingObject[];
  history: string | null;
  announcement?: string | null;
}

export interface MeasureResponse {
  distance: number;
  angle: number;
  delta_x: number;
  delta_y: number;
  text: string;
  units: Units;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}

export interface IssuesResponse {
  issues: Issue[];
}

export interface SharesResponse {
  shares: ShareLink[];
}

export interface ShareResponse {
  share: ShareLink;
}

export interface ExportsResponse {
  exports: ExportRecord[];
}

export interface ExportResponse {
  export: ExportRecord;
}

export interface VersionsResponse {
  versions: Array<{
    number: number;
    created_at: string;
    created_label: string;
    actor: string;
    size_bytes: number;
    size_label: string;
    object_key: string;
  }>;
}

export interface RestoreResponse {
  file_version: number;
  version: number;
}

export interface UploadResponse {
  drawing: FileItem & { folder_id: string | null };
  file_version: number;
  imported: number;
  skipped: number;
}

export interface LinkInfoResponse {
  drawing: { id: string; name: string };
  access: "view" | "markup" | "edit";
  status: "active";
  expires_at: string | null;
  time_zone: string;
  expiry_label: string;
}

export interface InviteResponse {
  invite: "sent";
  sent_to: string;
}

export interface SupportFilesResponse {
  linetypes: string[];
  plot_styles: string[];
  blocks: string[];
  templates: string[];
  text_styles: string[];
}

export interface RevisionsResponse {
  revisions: Array<{ letter: string; footer_note: string; effective_date: string }>;
}

export interface CollaboratorsResponse {
  collaborators: Array<{ name: string; state: "Editing" | "Viewing" | "Away" }>;
}

export interface TraceResponse {
  trace: Trace;
}

export interface QuoteResponse {
  quote: { number: string; amount: string; currency: string; sent_to: string };
}
