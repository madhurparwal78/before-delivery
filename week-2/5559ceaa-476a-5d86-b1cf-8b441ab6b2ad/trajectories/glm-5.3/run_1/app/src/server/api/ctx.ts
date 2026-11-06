export interface Bus {
  publish(projectId: string, frame: Record<string, unknown>): void;
  closeSockets(projectId: string, userId: string, code: number, reason: string): void;
  onlineFor(projectId: string): string[];
}
