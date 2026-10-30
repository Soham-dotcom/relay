import { open, stat } from 'node:fs/promises';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { OPEN_STATUSES } from './items.js';
import { sessionWhere, type Viewer } from '../access.js';

// ---------- "What I missed" ----------

/**
 * Sessions the viewer was invited to but missed, and hand-overs they are receiving, newest first.
 * These are exactly the moments a catch-up brief exists for.
 */
export async function whatIMissed(viewer: Viewer) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const sessions = await prisma.session.findMany({
    where: {
      AND: [sessionWhere(viewer)],
      OR: [
        { participants: { some: { personId: viewer.id, attendance: 'MISSED' } } },
        { kind: 'TRANSFER', toPersonId: viewer.id, status: { not: 'CLOSED' } },
      ],
      scheduledAt: { gte: since },
    },
    orderBy: { scheduledAt: 'desc' },
    select: {
      id: true,
      title: true,
      kind: true,
      scheduledAt: true,
      visibility: true,
      _count: { select: { decisions: true } },
      items: { where: { status: { in: OPEN_STATUSES } }, select: { ownerId: true } },
    },
  });
  return sessions.map(({ items, _count, ...s }) => ({
    ...s,
    reason: s.kind === 'TRANSFER' ? 'handover' : 'missed',
    decisions: _count.decisions,
    openItems: items.length,
    yourItems: items.filter((i) => i.ownerId === viewer.id).length,
  }));
}

// ---------- My activity (from the log file) ----------

const TAIL_BYTES = 2 * 1024 * 1024;

type LogLine = Record<string, unknown> & { requestId?: string; userId?: string; time?: string; level?: number; msg?: string };

/**
 * Pure function so it can be unit-tested: keeps only lines belonging to requests made by `userId`.
 * A request belongs to a user when any of its lines carries their userId; then every line of that
 * request is included (the access-log line is written after the handler and may lack the userId).
 * Other people's requests are never returned.
 */
export function filterOwnActivity(lines: LogLine[], userId: string, requestId?: string) {
  const mine = new Set(lines.filter((l) => l.userId === userId && l.requestId).map((l) => l.requestId!));
  const wanted = requestId ? (mine.has(requestId) ? new Set([requestId]) : new Set<string>()) : mine;
  const groups = new Map<string, LogLine[]>();
  for (const l of lines) {
    if (!l.requestId || !wanted.has(l.requestId)) continue;
    if (!groups.has(l.requestId)) groups.set(l.requestId, []);
    groups.get(l.requestId)!.push(l);
  }
  return [...groups.entries()]
    .map(([id, ls]) => {
      const access = ls.find((l) => l.req && l.res) as (LogLine & { req: { method: string; url: string }; res: { statusCode: number }; responseTime?: number }) | undefined;
      return {
        requestId: id,
        time: ls[0].time,
        method: access?.req.method ?? null,
        url: access?.req.url ?? null,
        status: access?.res.statusCode ?? null,
        durationMs: access?.responseTime ?? null,
        // Everything except the access line itself, trimmed to the useful fields.
        events: ls
          .filter((l) => l !== access)
          .map(({ time, level, msg, event, op, latencyMs, outcome, attempt, status, code, resource }) => ({ time, level, msg, event, op, latencyMs, outcome, attempt, status, code, resource })),
      };
    })
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

export async function myActivity(viewer: Viewer, requestId?: string, limit = 40) {
  let text = '';
  try {
    const { size } = await stat(config.LOG_FILE);
    const fh = await open(config.LOG_FILE, 'r');
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    await fh.close();
    text = buf.toString('utf8');
  } catch {
    return { available: false, requests: [] };
  }
  const lines: LogLine[] = [];
  for (const raw of text.split('\n')) {
    try {
      if (raw.startsWith('{')) lines.push(JSON.parse(raw));
    } catch {
      /* partial first line of the tail */
    }
  }
  return { available: true, requests: filterOwnActivity(lines, viewer.id, requestId).slice(0, limit) };
}
