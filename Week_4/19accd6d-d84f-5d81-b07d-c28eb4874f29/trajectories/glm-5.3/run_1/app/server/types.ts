export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number; from: string };
  meili: { url: string; apiKey: string; index: string };
  autobakeMs: number;
  regexBudgetMs: number;
  inputMaxBytes: number;
  fileMaxBytes: number;
  outputDisplayBytes: number;
  versionsKept: number;
  teamMax: number;
  shareTtlChoices: string[];
  inviteTtlSeconds: number;
  verifyTtlSeconds: number;
  grading: boolean;
}


export function config(): Config {
  return globalThis.__wringbenchConfig;
}

declare global {
  // eslint-disable-next-line no-var
  var __wringbenchConfig: Config;
}
