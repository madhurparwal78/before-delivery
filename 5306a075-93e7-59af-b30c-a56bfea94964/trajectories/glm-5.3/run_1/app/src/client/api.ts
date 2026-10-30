import type {
  ApiError,
  FeatureDetail,
  FeatureSummary,
  ImportReport,
  Note,
  NoteListItem,
  Roadmap,
  SearchResults,
  ShareLink,
  User,
  WorkspaceInfo,
} from "../shared/types.js";

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

/** Raised for a 401 so the shell can return to the sign-in page. */
export class SessionEnded extends Error {
  constructor() {
    super("Session ended");
    this.name = "SessionEnded";
  }
}

export class ApiFailure extends Error {
  readonly error: ApiError;
  constructor(error: ApiError) {
    super(error.error.message);
    this.name = "ApiFailure";
    this.error = error;
  }
}

interface PendingHandlers {
  begin(): void;
  end(): void;
}

let pending: PendingHandlers | null = null;

export function setPendingHandler(handler: PendingHandlers): void {
  pending = handler;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { raw?: boolean } = {},
): Promise<T> {
  pending?.begin();
  try {
    const init: RequestInit = { method, credentials: "same-origin" };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const response = await fetch(path, init);
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    const data = text.length === 0 ? undefined : JSON.parse(text);
    if (!response.ok) {
      const apiError = data as ApiError | undefined;
      if (response.status === 401) {
        throw new SessionEnded();
      }
      throw new ApiFailure(
        apiError ?? {
          error: {
            code: "internal_error",
            message: "Something went wrong on our side. Nothing was saved.",
          },
        },
      );
    }
    return data as T;
  } finally {
    pending?.end();
  }
}

export const api = {
  signIn: (email: string, password: string): Promise<{ user: User }> =>
    request("POST", "/api/session", { email, password }),
  signOut: (): Promise<void> => request("DELETE", "/api/session"),
  me: (): Promise<{ user: User; workspace: WorkspaceInfo }> => request("GET", "/api/me"),
  notes: (
    status: string,
    limit: number,
    cursor: string | null,
  ): Promise<{
    notes: NoteListItem[];
    nextCursor: string | null;
    counts: { unprocessed: number; snoozed: number; processed: number };
  }> =>
    request(
      "GET",
      `/api/notes?status=${encodeURIComponent(status)}&limit=${limit}${
        cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`
      }`,
    ),
  note: (id: string): Promise<{ note: Note }> => request("GET", `/api/notes/${id}`),
  createNote: (payload: {
    title: string;
    body: string;
    source: string;
    contactId: string | null;
  }): Promise<{ note: Note }> => request("POST", "/api/notes", payload),
  editNote: (
    id: string,
    payload: { title?: string; body?: string; contactId?: string | null },
  ): Promise<{ note: Note }> => request("PATCH", `/api/notes/${id}`, payload),
  deleteNote: (id: string): Promise<void> => request("DELETE", `/api/notes/${id}`),
  noteStatus: (id: string, to: string): Promise<{ note: Note }> =>
    request("POST", `/api/notes/${id}/status`, { to }),
  snoozeNote: (id: string, until: string): Promise<{ note: Note }> =>
    request("POST", `/api/notes/${id}/snooze`, { until }),
  hierarchy: (): Promise<{
    products: Array<{
      id: string;
      name: string;
      components: Array<{
        id: string;
        name: string;
        features: Array<FeatureSummary & { subfeatures: Array<{ id: string; name: string }> }>;
      }>;
    }>;
  }> => request("GET", "/api/hierarchy"),
  features: (q?: string): Promise<{ features: FeatureSummary[] }> =>
    request("GET", q === undefined ? "/api/features" : `/api/features?q=${encodeURIComponent(q)}`),
  feature: (id: string): Promise<{ feature: FeatureDetail }> =>
    request("GET", `/api/features/${id}`),
  saveDetails: (
    id: string,
    payload: { name?: string; publicDescription?: string },
  ): Promise<{ feature: FeatureDetail }> => request("PATCH", `/api/features/${id}`, payload),
  saveScores: (
    id: string,
    payload: {
      version: number;
      effort?: number;
      confidence?: number;
      fits?: Record<string, number>;
    },
  ): Promise<{ feature: FeatureDetail }> => request("PATCH", `/api/features/${id}/scores`, payload),
  featureStatus: (id: string, to: string): Promise<{ feature: FeatureDetail }> =>
    request("POST", `/api/features/${id}/status`, { to }),
  linkInsight: (payload: {
    noteId: string;
    featureId: string;
    start: number;
    end: number;
    importance: string;
  }): Promise<{
    insight: { id: string; featureName: string };
    feature: FeatureSummary;
    before: { impact: number; priority: number; rank: number };
  }> => request("POST", "/api/insights", payload),
  unlinkInsight: (
    id: string,
  ): Promise<{
    feature: FeatureSummary;
    before: { impact: number; priority: number; rank: number };
  }> => request("DELETE", `/api/insights/${id}`),
  roadmap: (): Promise<Roadmap> => request("GET", "/api/roadmap"),
  move: (payload: {
    featureId: string;
    toReleaseId: string | null;
    toIndex: number;
    expectedOrderVersions: Record<string, number>;
  }): Promise<{ releases: Array<{ releaseId: string; orderVersion: number; featureIds: string[] }> }> =>
    request("POST", "/api/roadmap/moves", payload),
  freeze: (releaseId: string): Promise<{ release: { name: string } }> =>
    request("POST", `/api/releases/${releaseId}/freeze`),
  objectives: (): Promise<{
    objectives: Array<{ id: string; name: string; weight: number }>;
  }> => request("GET", "/api/objectives"),
  saveWeights: (
    id: string,
    weight: number,
  ): Promise<{ objective: { id: string; name: string; weight: number } }> =>
    request("PATCH", `/api/objectives/${id}`, { weight }),
  companies: (): Promise<{
    companies: Array<{
      id: string;
      name: string;
      domains: string[];
      contacts: Array<{ id: string; name: string; email: string }>;
      noteCount: number;
    }>;
  }> => request("GET", "/api/companies"),
  company: (
    id: string,
  ): Promise<{
    company: {
      id: string;
      name: string;
      domains: string[];
      contacts: Array<{ id: string; name: string; email: string }>;
      noteCount: number;
      requests: Array<{
        featureId: string;
        featureName: string;
        status: string;
        releaseName: string | null;
        targetMonth: string | null;
        shipped: boolean;
      }>;
    };
  }> => request("GET", `/api/companies/${id}`),
  merge: (sourceId: string, intoCompanyId: string): Promise<{ company: { name: string } }> =>
    request("POST", `/api/companies/${sourceId}/merge`, { intoCompanyId }),
  search: (q: string): Promise<SearchResults> =>
    request("GET", `/api/search?q=${encodeURIComponent(q)}`),
  previewImport: (csv: string): Promise<ImportReport> =>
    request("POST", "/api/imports", { csv, dryRun: true }),
  runImport: (csv: string): Promise<ImportReport> =>
    request("POST", "/api/imports", { csv, dryRun: false }),
  shareLinks: (): Promise<{ shareLinks: ShareLink[] }> =>
    request("GET", "/api/roadmap/share-links"),
  createShareLink: (
    expiresInSeconds: number | null,
  ): Promise<{ shareLink: ShareLink }> =>
    request("POST", "/api/roadmap/share-links", { expiresInSeconds }),
  regenerateShareLink: (id: string): Promise<{ shareLink: ShareLink }> =>
    request("POST", `/api/roadmap/share-links/${id}/regenerate`),
  revokeShareLink: (id: string): Promise<void> =>
    request("DELETE", `/api/roadmap/share-links/${id}`),
  invite: (
    email: string,
    role: string,
  ): Promise<{ invitation: { email: string } }> =>
    request("POST", "/api/invitations", { email, role }),
  uploadAttachment: (
    noteId: string,
    file: File,
  ): Promise<{
    attachment: { id: string; filename: string; status: string };
  }> =>
    new Promise((resolve, reject) => {
      pending?.begin();
      const form = new FormData();
      form.append("file", file);
      fetch(`/api/notes/${noteId}/attachments`, { method: "POST", body: form, credentials: "same-origin" })
        .then(async (response) => {
          const data = (await response.json()) as
            | { attachment: { id: string; filename: string; status: string } }
            | ApiError;
          if (!response.ok) {
            if (response.status === 401) reject(new SessionEnded());
            else reject(new ApiFailure(data as ApiError));
            return;
          }
          resolve(data as { attachment: { id: string; filename: string; status: string } });
        })
        .finally(() => pending?.end());
    }),
};

export function shipRelease(releaseId: string, key: string): Promise<{
  release: { name: string };
  emailsQueued: number;
}> {
  return fetch(`/api/releases/${releaseId}/ship`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Idempotency-Key": key },
  }).then(async (response) => {
    const data = (await response.json()) as
      | { release: { name: string }; emailsQueued: number }
      | ApiError;
    if (!response.ok) {
      if (response.status === 401) throw new SessionEnded();
      throw new ApiFailure(data as ApiError);
    }
    return data as { release: { name: string }; emailsQueued: number };
  });
}
