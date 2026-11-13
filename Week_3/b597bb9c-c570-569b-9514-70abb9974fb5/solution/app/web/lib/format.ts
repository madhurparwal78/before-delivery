/** The first six hexadecimal digits of a checksum, read as a colour. */
export const checksumColour = (sha256: string): string => `#${sha256.slice(0, 6)}`;
