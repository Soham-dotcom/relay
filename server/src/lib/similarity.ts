export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was we were will with our not no yes all any can should would'.split(' '),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Share of the query's words found in the text (0..1). Used when embeddings are unavailable. */
export function keywordScore(query: string, text: string): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const t = tokens(text);
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.size;
}

/** Ranks candidates by embedding similarity when both vectors exist, else by keyword overlap. */
export function rankCandidates<T>(
  query: { text: string; vector: number[] | null },
  candidates: T[],
  get: (c: T) => { text: string; vector: number[] },
  limit: number,
): { item: T; score: number }[] {
  return candidates
    .map((c) => {
      const { text, vector } = get(c);
      const score =
        query.vector?.length && vector.length === query.vector.length
          ? cosine(query.vector, vector)
          : keywordScore(query.text, text);
      return { item: c, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
