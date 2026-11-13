// The API client: fetch helpers, session, service status, latest-save wins.

import type {
  User, ProgrammeDetail, ProgrammeSummary, WorkDetail, RentalSet, Notice,
  FolderSummary, FolderDetail, FolderPage, ServiceStatus, Scan, Part,
} from "../shared/domain.js";

export interface ApiError extends Error {
  status: number;
  body: { error: string; message: string; [key: string]: unknown };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  options: { headers?: Record<string, string>; multipart?: FormData } = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers };
  if (options.multipart) {
    init.body = options.multipart;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(path, init);
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { headers?: Record<string, string>; multipart?: FormData } = {}
): Promise<T> {
  const response = await request(method, path, body, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = new Error(String(parsed.message ?? "Request failed.")) as ApiError;
    error.status = response.status;
    error.body = parsed as ApiError["body"];
    throw error;
  }
  return parsed as T;
}

export type UploadResult = Record<string, unknown>;

export function uploadWithProgress(
  path: string,
  multipart: FormData,
  idempotencyKey: string,
  onProgress: (sent: number, total: number) => void
): Promise<UploadResult> {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(multipart);
  }).then((xhr) => {
    if (xhr.status === 0) throw new Error("network");
    const parsed = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>;
    if (xhr.status >= 400) {
      const error = new Error(String(parsed.message ?? "Request failed.")) as ApiError;
      error.status = xhr.status;
      error.body = parsed as ApiError["body"];
      throw error;
    }
    return parsed as unknown as UploadResult;
  });
}

// ------------------------------------------------------------------- session

export interface AppModel {
  user: User | null;
  status: ServiceStatus | null;
}

export class Client {
  user: User | null = null;
  status: ServiceStatus | null = null;

  async signIn(email: string, passcode: string): Promise<User> {
    const result = await api<{ user: User }>("POST", "/api/session", { email, passcode });
    this.user = result.user;
    return result.user;
  }

  async signOut(): Promise<void> {
    await api("DELETE", "/api/session");
    this.user = null;
  }

  async readSession(): Promise<User | null> {
    try {
      const result = await api<{ user: User }>("GET", "/api/session");
      this.user = result.user;
      return result.user;
    } catch {
      this.user = null;
      return null;
    }
  }

  async readStatus(): Promise<ServiceStatus | null> {
    try {
      const result = await api<ServiceStatus>("GET", "/api/status");
      this.status = result;
      return result;
    } catch {
      return null;
    }
  }
}

// -------------------------------------------------------------------- routes

export const routes = {
  signIn: "/",
  desk: (programmeId?: string, workId?: string) =>
    programmeId ? `/desk/${programmeId}${workId ? `?work=${workId}` : ""}` : "/desk",
  rentals: "/rentals",
  section: "/section",
  folderList: "/folder",
  folder: (programmeId: string, partId?: string) =>
    `/folder/${programmeId}${partId ? `/${partId}` : ""}`,
};

export function landingRoute(user: User): string {
  switch (user.role) {
    case "principal_librarian":
    case "assistant_librarian":
      return routes.desk();
    case "section_principal":
      return routes.section;
    case "player":
      return routes.folderList;
  }
}

export const apiRoutes = {
  catalogue: () => "/api/catalogue",
  programmes: () => "/api/programmes",
  programme: (id: string) => `/api/programmes/${id}`,
  createProgramme: () => "/api/programmes",
  stringCount: (id: string) => `/api/programmes/${id}/string-count`,
  addWork: (id: string) => `/api/programmes/${id}/works`,
  transition: (id: string) => `/api/programmes/${id}/transition`,
  publish: (id: string) => `/api/programmes/${id}/publish`,
  notices: (id: string) => `/api/programmes/${id}/notices`,
  work: (id: string) => `/api/works/${id}`,
  cuts: (workId: string) => `/api/works/${workId}/cuts`,
  cut: (cutId: string) => `/api/cuts/${cutId}`,
  holdings: (partId: string) => `/api/parts/${partId}/holdings`,
  marks: (partId: string) => `/api/parts/${partId}/marks`,
  scans: (partId: string) => `/api/parts/${partId}/scans`,
  scanFile: (scanId: string) => `/api/scans/${scanId}/file`,
  folders: () => "/api/folders",
  folder: (programmeId: string) => `/api/folders/${programmeId}`,
  folderPage: (programmeId: string, partId: string) =>
    `/api/folders/${programmeId}/parts/${partId}`,
  rentalSets: () => "/api/rental-sets",
  rentalSet: (id: string) => `/api/rental-sets/${id}`,
  rentalTransition: (id: string) => `/api/rental-sets/${id}/transition`,
  checkIn: (id: string) => `/api/rental-sets/${id}/check-in`,
};

export type { ProgrammeDetail, ProgrammeSummary, WorkDetail, RentalSet, Notice, FolderSummary, FolderDetail, FolderPage, Scan, Part };
