declare module "domino" {
  export function createDocument(html?: string, force?: boolean): Document;
  export function createWindow(html?: string, address?: string): Window;
}
