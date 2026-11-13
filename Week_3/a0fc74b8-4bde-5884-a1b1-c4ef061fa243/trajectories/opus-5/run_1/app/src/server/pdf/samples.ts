import { createHash } from 'node:crypto';
import { PdfBuilder, type PageSpec } from './build.ts';
import { ContentStream, helveticaWidth } from './content.ts';
import { pdfDict, pdfName, pdfRef, pdfStream, type PdfValue } from './model.ts';
import type { Rect } from './reader.ts';

export type SampleName = 'letter-1' | 'letter-3' | 'a4-12';

const LETTER: Rect = [0, 0, 612, 792];
const A4: Rect = [0, 0, 595.28, 841.89];

const SAMPLES: Record<SampleName, { pages: number; box: Rect }> = {
  'letter-1': { pages: 1, box: LETTER },
  'letter-3': { pages: 3, box: LETTER },
  'a4-12': { pages: 12, box: A4 },
};

const buildSample = (name: SampleName): Buffer => {
  const spec = SAMPLES[name];
  const builder = new PdfBuilder();
  const fontNum = builder.add(
    pdfDict({
      Type: pdfName('Font'),
      Subtype: pdfName('Type1'),
      BaseFont: pdfName('Helvetica'),
      Encoding: pdfName('WinAnsiEncoding'),
    }),
  );
  const resources: PdfValue = pdfDict({ Font: pdfDict({ F1: pdfRef(fontNum) }) });
  const width = spec.box[2] - spec.box[0];
  const height = spec.box[3] - spec.box[1];

  const pages: PageSpec[] = [];
  for (let page = 1; page <= spec.pages; page += 1) {
    const heading = `Sample page ${page} of ${spec.pages}`;
    const size = 28;
    const content = new ContentStream();
    content.text(
      heading,
      spec.box[0] + (width - helveticaWidth(heading, size)) / 2,
      spec.box[1] + height - 120,
      size,
    );
    content.line(
      spec.box[0] + 72,
      spec.box[1] + height - 150,
      spec.box[2] - 72,
      spec.box[1] + height - 150,
      0.5,
    );
    content.text('Wickmoor Paper Co. sample document', spec.box[0] + 72, spec.box[1] + height - 180, 12);
    content.text('Prepared for demonstration only.', spec.box[0] + 72, spec.box[1] + height - 200, 12);
    const streamNum = builder.add(pdfStream({}, content.toBuffer()));
    pages.push({ box: spec.box, resources, contents: pdfRef(streamNum) });
  }
  return builder.build(pages);
};

export interface Sample {
  bytes: Buffer;
  sha256: string;
  pageCount: number;
}

const cache = new Map<SampleName, Sample>();

export const sample = (name: SampleName): Sample => {
  const existing = cache.get(name);
  if (existing) return existing;
  const bytes = buildSample(name);
  const built: Sample = {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: SAMPLES[name].pages,
  };
  cache.set(name, built);
  return built;
};

export const isSampleName = (value: string): value is SampleName =>
  value === 'letter-1' || value === 'letter-3' || value === 'a4-12';
