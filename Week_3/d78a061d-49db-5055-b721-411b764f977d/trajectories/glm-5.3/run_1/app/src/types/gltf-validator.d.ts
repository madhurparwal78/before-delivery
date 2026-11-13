declare module 'gltf-validator' {
  export interface ValidatorIssues {
    numErrors: number;
    numWarnings: number;
    numInfos: number;
    numHints: number;
    messages: { code: string; message: string; severity: number; pointer?: string }[];
    truncated: boolean;
  }
  export interface ValidatorResult {
    issuer?: string;
    validatorVersion?: string;
    issues: ValidatorIssues;
  }
  export interface ValidationOptions {
    uri?: string;
    format?: string;
    maxIssues?: number;
    ignorePoints?: boolean;
    ignoreLines?: boolean;
    ignoreTextures?: boolean;
    maxWarnings?: number;
  }
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<ValidatorResult>;
  export function validateString(json: string, options?: ValidationOptions): Promise<ValidatorResult>;
  export function version(): string;
  export function supportedExtensions(): string[];
}
