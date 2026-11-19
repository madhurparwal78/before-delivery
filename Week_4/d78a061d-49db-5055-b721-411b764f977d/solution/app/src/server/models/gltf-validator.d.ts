declare module 'gltf-validator' {
  interface ValidatorIssues {
    numErrors: number;
    numWarnings: number;
    numInfos: number;
    numHints: number;
  }
  interface ValidatorReport {
    issues: ValidatorIssues;
  }
  export function validateBytes(bytes: Uint8Array): Promise<ValidatorReport>;
}
