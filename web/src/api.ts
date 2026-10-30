export type ItemStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED';
export type SessionStatus = 'PLANNED' | 'HELD' | 'CLOSED';
export type SessionKind = 'MEETING' | 'TRANSFER';
export type Attendance = 'INVITED' | 'ATTENDED' | 'MISSED';
export type Visibility = 'PRIVATE' | 'TEAM' | 'ORG';

export interface TeamRef {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  name: string;
  role: string | null;
  teams: TeamRef[];
}

export interface DemoPerson {
  id: string;
  name: string;
  role: string | null;
  teams: TeamRef[];
}

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
  visibility: Visibility;
  team: TeamRef | null;
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
  visibility: Visibility;
  team: TeamRef | null;
  sessionId: string | null;
  createdAt: string;
  links: { id: string; reason: string; item: { id: string; title: string; status: ItemStatus } | null; decision: { id: string; text: string; sessionId: string } | null }[];
}

export interface MissedSession {
  id: string;
  title: string;
  kind: SessionKind;
  scheduledAt: string;
  visibility: Visibility;
  reason: 'missed' | 'handover';
  decisions: number;
  openItems: number;
  yourItems: number;
}

export interface AskSource {
  id: string;
  title: string;
  source: 'DOCUMENT' | 'MEETING';
  sessionId: string | null;
}

export interface AskResult {
  mode: 'ai' | 'search' | 'none';
  answer: string | null;
  citations: AskSource[];
  sources: AskSource[];
}

export interface ActivityRequest {
  requestId: string;
  time: string;
  method: string | null;
  url: string | null;
  status: number | null;
  durationMs: number | null;
  events: { time: string; level: number; msg: string; event?: string; op?: string; latencyMs?: number; outcome?: string; attempt?: number; code?: string; resource?: string }[];
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

// The sign-in token. localStorage keeps it across reloads; it is sent as a Bearer header, never a cookie,
// so there is no CSRF surface.
const TOKEN_KEY = 'relay.token';
export const auth = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: the session lasts until reload */
    }
    window.dispatchEvent(new Event('relay:auth'));
  },
};

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const token = auth.get();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. It may be waking up; try again in a few seconds.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) auth.set(null); // expired or invalid: back to the sign-in screen
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  }
  return data as T;
}
