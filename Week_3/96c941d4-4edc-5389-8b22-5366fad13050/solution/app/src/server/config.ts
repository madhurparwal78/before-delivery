export interface DatabaseConfig {
  url: string;
}

export interface ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SearchConfig {
  url: string;
  apiKey: string;
}

export interface ServerConfig {
  port: number;
  database: DatabaseConfig | null;
  objects: ObjectStoreConfig | null;
  search: SearchConfig | null;
  diagnostics: string[];
}

const DEFAULT_PORT = 4173;

function required(name: string, missing: string[]): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    missing.push(name);
    return '';
  }
  return raw;
}

function readPort(): number {
  const raw = process.env.APP_PUBLIC_PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`APP_PUBLIC_PORT must be a valid port number, received ${raw}`);
  }
  return parsed;
}

export function loadConfig(): ServerConfig {
  const diagnostics: string[] = [];

  const databaseMissing: string[] = [];
  const url = required('DATABASE_URL', databaseMissing);

  const objectMissing: string[] = [];
  const endpoint = required('S3_ENDPOINT', objectMissing);
  const region = required('S3_REGION', objectMissing);
  const bucket = required('S3_BUCKET', objectMissing);
  const forcePathStyle = required('S3_FORCE_PATH_STYLE', objectMissing);
  const accessKeyId = required('S3_ACCESS_KEY_ID', objectMissing);
  const secretAccessKey = required('S3_SECRET_ACCESS_KEY', objectMissing);

  const searchMissing: string[] = [];
  const searchUrl = required('MEILISEARCH_URL', searchMissing);
  const apiKey = required('MEILISEARCH_API_KEY', searchMissing);

  for (const group of [databaseMissing, objectMissing, searchMissing]) {
    for (const name of group) diagnostics.push(`${name} is not configured; dependent requests are unavailable.`);
  }

  return {
    port: readPort(),
    database: databaseMissing.length === 0 ? { url } : null,
    objects:
      objectMissing.length === 0
        ? {
            endpoint,
            region,
            bucket,
            forcePathStyle: forcePathStyle === 'true',
            accessKeyId,
            secretAccessKey,
          }
        : null,
    search: searchMissing.length === 0 ? { url: searchUrl, apiKey } : null,
    diagnostics,
  };
}
