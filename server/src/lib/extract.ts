import path from 'node:path';
import { AppError } from '../errors.js';

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** ~150 pages of text. Beyond this the embedding cost and search time grow for little benefit. */
export const MAX_TEXT_CHARS = 300_000;
export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv'];

export type FileKind = 'pdf' | 'docx' | 'text';

export function kindOf(fileName: string): FileKind {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (['.txt', '.md', '.csv'].includes(ext)) return 'text';
  throw new AppError(415, 'UNSUPPORTED_FILE', `Unsupported file type "${ext || 'none'}". Upload one of: ${SUPPORTED_EXTENSIONS.join(', ')}`);
}

/**
 * Pulls plain text out of an uploaded file. Only the text is kept; the file itself is never stored.
 * The type is decided by the extension and then confirmed by the content (a PDF must start with
 * %PDF, a .docx is a zip), so a renamed file can't slip a different format past the parser.
 */
export async function extractText(buf: Buffer, fileName: string): Promise<{ text: string; kind: FileKind; pages?: number }> {
  const kind = kindOf(fileName);
  let text = '';
  let pages: number | undefined;

  if (kind === 'pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(415, 'UNSUPPORTED_FILE', 'This file is not a valid PDF');
    const { getDocumentProxy, extractText: pdfText } = await import('unpdf');
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const res = await pdfText(pdf, { mergePages: true });
      text = Array.isArray(res.text) ? res.text.join('\n\n') : res.text;
      pages = res.totalPages;
    } catch {
      throw new AppError(422, 'UNREADABLE_FILE', 'Could not read this PDF. It may be damaged or password-protected.');
    }
  } else if (kind === 'docx') {
    if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new AppError(415, 'UNSUPPORTED_FILE', 'This file is not a valid .docx document');
    const mammoth = await import('mammoth');
    try {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } catch {
      throw new AppError(422, 'UNREADABLE_FILE', 'Could not read this Word document.');
    }
  } else {
    text = buf.toString('utf8');
    if (text.includes('\u0000')) throw new AppError(415, 'UNSUPPORTED_FILE', 'This looks like a binary file, not text');
  }

  text = text.replace(/\u0000/g, '').trim();
  if (text.length < 20) {
    throw new AppError(
      422,
      'NO_TEXT',
      kind === 'pdf' ? 'No text found in this PDF. If it is a scanned image, it needs OCR first.' : 'This file has no readable text.',
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new AppError(413, 'TOO_LONG', `This file has ${Math.round(text.length / 1000)}k characters of text; the limit is ${MAX_TEXT_CHARS / 1000}k.`);
  }
  return { text, kind, pages };
}
