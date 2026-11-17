/**
 * Splits a document into overlapping passages for search.
 *
 * Why: one embedding for a whole 30-page PDF is a blurry average, and the model only reads a short
 * excerpt. Passages of ~1,200 characters keep each embedding about one topic, so a question finds
 * the right part of the file. The overlap stops a fact that sits on a boundary from being cut in half.
 * Splits prefer paragraph breaks, then sentence ends, then spaces, so passages stay readable.
 */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (breakAt > size * 0.5) end = start + breakAt + 1;
      else {
        const space = window.lastIndexOf(' ');
        if (space > size * 0.5) end = start + space;
      }
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}
