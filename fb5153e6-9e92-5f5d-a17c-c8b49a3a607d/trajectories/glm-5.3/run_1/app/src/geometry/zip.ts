import AdmZip from 'adm-zip';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function isZip(data: Buffer): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

export function readZip(data: Buffer): ZipEntry[] {
  const zip = new AdmZip(data);
  return zip.getEntries().map(entry => ({ name: entry.entryName, data: entry.getData() }));
}

export function pathEscapes(name: string): boolean {
  return name.includes('..') || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.startsWith('/');
}

export function isPng(data: Buffer): boolean {
  return data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
}

export function isJpeg(data: Buffer): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
