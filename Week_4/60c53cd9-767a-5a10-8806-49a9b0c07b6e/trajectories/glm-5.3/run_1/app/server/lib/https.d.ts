// HTTPS module ambient types: only the request function the Meilisearch client
// needs when the configured URL is https.
declare module 'node:https' {
  import { ClientRequest, IncomingMessage } from 'node:http';
  export function request(
    options: { hostname: string; port: number; method: string; path: string; headers: Record<string, string> },
    callback: (res: IncomingMessage) => void,
  ): ClientRequest;
}
