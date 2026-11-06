export const ACCEPTED_FORM_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export type AcceptedFormType = (typeof ACCEPTED_FORM_TYPES)[number];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXTENSIONS: Record<AcceptedFormType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function contentMatches(declaredType: AcceptedFormType, data: Buffer): boolean {
  switch (declaredType) {
    case 'application/pdf':
      return data.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/jpeg':
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/png':
      return data.subarray(0, 8).equals(PNG_SIGNATURE);
  }
}

/** The declared type must be one we accept and the bytes must actually be that type. */
export function acceptedFormType(declaredType: string, data: Buffer): AcceptedFormType | null {
  const candidate = ACCEPTED_FORM_TYPES.find((type) => type === declaredType);
  if (candidate === undefined || !contentMatches(candidate, data)) {
    return null;
  }
  return candidate;
}

export function extensionFor(type: AcceptedFormType): string {
  return EXTENSIONS[type];
}
