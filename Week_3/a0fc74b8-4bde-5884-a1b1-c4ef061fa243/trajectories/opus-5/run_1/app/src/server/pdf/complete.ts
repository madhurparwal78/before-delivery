import { PdfBuilder, type PageSpec } from './build.ts';
import { ContentStream, fitSize } from './content.ts';
import {
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
  type PdfValue,
} from './model.ts';
import { PdfReader, type Rect } from './reader.ts';
import type { FieldKind, Stroke } from '../../shared/types.ts';

export interface CompletedField {
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  strokes: Stroke[] | null;
}

export interface CertificateSigner {
  order: number;
  name: string;
  email: string;
  signedAt: string;
}

export interface CertificateData {
  title: string;
  documentId: string;
  originalSha256: string;
  pageCount: number;
  signers: CertificateSigner[];
  chainHead: string;
}

const LETTER: Rect = [0, 0, 612, 792];

const drawField = (
  content: ContentStream,
  box: Rect,
  field: CompletedField,
): void => {
  const pageWidth = box[2] - box[0];
  const pageHeight = box[3] - box[1];
  const left = box[0] + field.x * pageWidth;
  const top = box[3] - field.y * pageHeight;
  const width = field.w * pageWidth;
  const height = field.h * pageHeight;
  const bottom = top - height;

  if (field.kind === 'signature' || field.kind === 'initials') {
    if (field.strokes && field.strokes.length > 0) {
      for (const stroke of field.strokes) {
        content.polyline(
          stroke.map(([sx, sy]): [number, number] => [left + sx * width, top - sy * height]),
          1.2,
        );
      }
      return;
    }
    const typed = field.value?.startsWith('typed:') === true ? field.value.slice(6) : '';
    if (typed === '') return;
    const size = fitSize(typed, width * 0.94, Math.min(height * 0.72, 28));
    content.text(typed, left + width * 0.03, bottom + height * 0.28, size);
    return;
  }

  const text = field.value ?? '';
  if (text === '') return;
  const size = fitSize(text, width * 0.96, Math.min(height * 0.7, 14));
  content.text(text, left + width * 0.02, bottom + height * 0.28, size);
};

export const certificateLines = (data: CertificateData): string[] => [
  'Certificate of completion',
  `Document: ${data.title}`,
  `Document ID: ${data.documentId}`,
  `Original SHA-256: ${data.originalSha256}`,
  `Pages in original: ${data.pageCount}`,
  ...data.signers.map(
    (signer) =>
      `Signer ${signer.order}: ${signer.name} <${signer.email}> signed ${signer.signedAt} UTC`,
  ),
  `Audit chain head: ${data.chainHead}`,
];

/**
 * The completed PDF: the original pages with every field value drawn inside its
 * box, followed by exactly one certificate page.
 */
export const buildCompletedPdf = (
  original: Buffer,
  fields: CompletedField[],
  certificate: CertificateData,
): Buffer => {
  const reader = new PdfReader(original);
  const sourcePages = reader.pages();
  const builder = new PdfBuilder();
  const fontNum = builder.add(
    pdfDict({
      Type: pdfName('Font'),
      Subtype: pdfName('Type1'),
      BaseFont: pdfName('Helvetica'),
      Encoding: pdfName('WinAnsiEncoding'),
    }),
  );
  const mapping = new Map<number, number>();
  const pages: PageSpec[] = [];

  sourcePages.forEach((sourcePage, index) => {
    const pageNumber = index + 1;
    const box = sourcePage.cropBox;
    const copiedResources = sourcePage.resources
      ? reader.copyInto(sourcePage.resources, builder, mapping)
      : pdfDict({});
    const formNum = builder.add(
      pdfStream(
        {
          Type: pdfName('XObject'),
          Subtype: pdfName('Form'),
          FormType: pdfNum(1),
          BBox: pdfArray([
            pdfNum(sourcePage.mediaBox[0]),
            pdfNum(sourcePage.mediaBox[1]),
            pdfNum(sourcePage.mediaBox[2]),
            pdfNum(sourcePage.mediaBox[3]),
          ]),
          Resources: copiedResources,
        },
        Buffer.from(reader.pageContent(sourcePage)),
      ),
    );
    const content = new ContentStream();
    content.form('P0');
    for (const field of fields) {
      if (field.page === pageNumber) drawField(content, box, field);
    }
    const contentNum = builder.add(pdfStream({}, content.toBuffer()));
    const resources: PdfValue = pdfDict({
      Font: pdfDict({ F1: pdfRef(fontNum) }),
      XObject: pdfDict({ P0: pdfRef(formNum) }),
    });
    pages.push({ box, resources, contents: pdfRef(contentNum) });
  });

  pages.push(buildCertificatePage(builder, fontNum, sourcePages[0]?.cropBox ?? LETTER, certificate));
  return builder.build(pages);
};

const buildCertificatePage = (
  builder: PdfBuilder,
  fontNum: number,
  box: Rect,
  data: CertificateData,
): PageSpec => {
  const lines = certificateLines(data);
  const content = new ContentStream();
  const marginLeft = box[0] + 54;
  const usableWidth = box[2] - box[0] - 108;
  let cursor = box[3] - 92;

  const [heading = 'Certificate of completion', ...rest] = lines;
  const headingSize = fitSize(heading, usableWidth, 22);
  content.text(heading, marginLeft, cursor, headingSize);
  cursor -= 16;
  content.line(marginLeft, cursor, box[2] - 54, cursor, 0.6);
  cursor -= 26;
  for (const line of rest) {
    const size = fitSize(line, usableWidth, 11);
    content.text(line, marginLeft, cursor, size);
    cursor -= 20;
  }
  const footer = 'Tamper-evident record. Not a certificate-based digital signature.';
  content.text(footer, marginLeft, box[1] + 54, 9);

  const contentNum = builder.add(pdfStream({}, content.toBuffer()));
  return {
    box,
    resources: pdfDict({ Font: pdfDict({ F1: pdfRef(fontNum) }) }),
    contents: pdfRef(contentNum),
  };
};
