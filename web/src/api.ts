export type ItemStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED';
export type SessionStatus = 'PLANNED' | 'HELD' | 'CLOSED';
export type SessionKind = 'MEETING' | 'TRANSFER';
export type Attendance = 'INVITED' | 'ATTENDED' | 'MISSED';

export interface Person {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

export interface DocRef {
  id: string;
  title: string;
  source: 'DOCUMENT' | 'MEETING';
}

export interface Link {
  id: string;
  reason: string;
  score: number;
  doc: DocRef;
}

export interface ItemEvent {
  id: string;
  type: 'CREATED' | 'STATUS_CHANGED' | 'REASSIGNED' | 'DUE_CHANGED' | 'CARRIED_FORWARD' | 'OUTCOME_RECORDED';
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  at: string;
}

export interface ActionItem {
  id: string;
  title: string;
  ownerId: string | null;
  owner: Person | null;
  dueDate: string | null;
  status: ItemStatus;
  outcome: string | null;
  closedAt: string | null;
  events: ItemEvent[];
  links: Link[];
  session: { id: string; title: string; kind: SessionKind };
  originSession: { id: string; title: string };
}

export interface Conflict {
  id: string;
  explanation: string;
  confidence: number;
  status: 'OPEN' | 'DISMISSED' | 'RESOLVED';
  resolution: string | null;
  decision: Decision & { session: { id: string; title: string; scheduledAt: string } };
  pastDecision: Decision & { session: { id: string; title: string; scheduledAt: string } };
}

export interface Decision {
  id: string;
  text: string;
  sessionId: string;
  conflicts?: (Omit<Conflict, 'decision' | 'pastDecision'> & { pastDecision: Conflict['pastDecision'] })[];
  links?: Link[];
}

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  title: string;
  scheduledAt: string;
  status: SessionStatus;
  participants: { person: { id: string; name: string }; attendance: Attendance }[];
  _count: { decisions: number; items: number };
  openItems: number;
}

export interface SessionDetail extends Omit<SessionSummary, '_count' | 'openItems' | 'participants'> {
  agenda: string;
  notes: string;
  summary: string | null;
  participants: { personId: string; person: Person; attendance: Attendance }[];
  decisions: Decision[];
  items: ActionItem[];
  previous: { id: string; title: string } | null;
  next: { id: string; title: string }[];
  fromPerson: Person | null;
  toPerson: Person | null;
}

export interface RecapDraft {
  summary: string;
  decisions: string[];
  actionItems: {
    title: string;
    ownerId: string | null;
    suggestedOwner: string | null;
    dueDate: string | null;
    evidence: string | null;
    /** Set when the AI recognised an item that is already open: saving updates it instead of copying it. */
    existingItemId: string | null;
  }[];
}

export interface Brief {
  source: 'ai' | 'fallback';
  brief: { headline: string; summary: string; keyDecisions: string[]; yourActions: string[]; openItems: string[]; watchOut: string[] };
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  source: 'DOCUMENT' | 'MEETING';
  sessionId: string | null;
  createdAt: string;
  links: { id: string; reason: string; item: { id: string; title: string; status: ItemStatus } | null; decision: { id: string; text: string; sessionId: string } | null }[];
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { path: string; message: string }[];
  requestId?: string;

  constructor(status: number, code: string, message: string, details?: { path: string; message: string }[], requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. It may be waking up; try again in a few seconds.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  }
  return data as T;
}
