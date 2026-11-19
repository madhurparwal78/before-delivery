function ascii(bytes: Buffer, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  return bytes.subarray(offset, offset + text.length).toString('latin1') === text;
}

function baseAudioType(contentType: string): string {
  const [base] = contentType.split(';');
  return (base ?? '').trim().toLowerCase();
}

export function signatureMatches(contentType: string, bytes: Buffer): boolean {
  switch (baseAudioType(contentType)) {
    case 'audio/webm':
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3
      );
    case 'audio/ogg':
      return ascii(bytes, 0, 'OggS');
    case 'audio/mp4':
      return ascii(bytes, 4, 'ftyp');
    case 'audio/mpeg': {
      if (ascii(bytes, 0, 'ID3')) return true;
      const second = bytes[1];
      return bytes.length >= 2 && bytes[0] === 0xff && second !== undefined && (second & 0xe0) === 0xe0;
    }
    case 'audio/wav':
      return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE');
    default:
      return false;
  }
}
