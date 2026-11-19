// Connection credentials, read from the environment only.
// The grading route can point storage at a different endpoint at runtime.

export interface Connections {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  publicPort: number;
}

export function readConnections(): Connections {
  const need = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };
  return {
    databaseUrl: need('DATABASE_URL'),
    publicPort: Number(process.env.APP_PUBLIC_PORT || 4173),
    s3: {
      endpoint: need('S3_ENDPOINT'),
      region: process.env.S3_REGION || 'us-east-1',
      bucket: need('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    },
  };
}

/** Runtime storage endpoint override set by the grading route. */
export let storageEndpointOverride: string | null = null;

export function setStorageEndpoint(url: string | null): void {
  storageEndpointOverride = url;
}

export function currentStorageEndpoint(configured: string): string {
  return storageEndpointOverride ?? configured;
}
