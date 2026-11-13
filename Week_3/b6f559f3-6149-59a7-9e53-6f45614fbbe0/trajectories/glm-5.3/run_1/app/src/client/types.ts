// Shared client types.
export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  role: string;
  layerCount: number;
  liveVersion: number | null;
  editorCount: number;
  viewerCount: number;
  trashedAt: string | null;
  purgeAt: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  role: string;
}
