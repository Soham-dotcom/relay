import { z } from 'zod';

/*
 * Every prompt says the same three things: use only the given text, never guess, and reply in
 * one exact JSON shape. The zod schema next to each prompt is what the reply is checked against.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

// ---------- Recap: raw notes -> summary, decisions, action items ----------

export const recapSchema = z.object({
  summary: z.string().min(1),
  decisions: z.array(z.string().min(1)).max(30),
  actionItems: z
    .array(
      z.object({
        title: z.string().min(1),
        owner: z.string().nullable(),
        dueDate: isoDate,
        evidence: z.string().nullable(),
        existingItemId: z.string().nullable().default(null),
      }),
    )
    .max(40),
});

export const RECAP_SYSTEM = `You turn messy meeting notes, chat logs, email threads or transcripts into a structured recap.
Rules:
- Use ONLY the information in the input. Never invent people, dates, decisions or tasks.
- A decision is something the group agreed or chose. Open questions are not decisions.
- An action item is a concrete task someone must do. Its title starts with a verb.
- owner: the person's name exactly as written in the participant list if the text names them, else null.
- dueDate: YYYY-MM-DD if the text gives a date, or a relative date ("tomorrow", "by Thursday") resolved from the MEETING DATE, else null.
- evidence: a short quote from the input that supports the item, or null.
- existingItemId: if the task is one of the "Already open items" listed (same work, even if worded differently), its id; else null. Never create a second copy of an open item.
- summary: 2-4 plain sentences.
Reply with ONLY this JSON: {"summary": string, "decisions": string[], "actionItems": [{"title": string, "owner": string|null, "dueDate": string|null, "evidence": string|null, "existingItemId": string|null}]}`;

export function recapPrompt(p: {
  title: string;
  meetingDate: string;
  participants: string[];
  agenda: string;
  openItems: { id: string; title: string; owner: string }[];
  raw: string;
}) {
  return `Meeting: ${p.title}
Meeting date: ${p.meetingDate}
Participants: ${p.participants.join(', ') || '(none listed)'}
Agenda: ${p.agenda || '(none)'}
Already open items: ${p.openItems.length ? JSON.stringify(p.openItems) : '(none)'}

Input to recap:
"""
${p.raw}
"""`;
}

// ---------- Catch-up brief for someone who missed it or is taking over ----------

export const briefSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  keyDecisions: z.array(z.string()).max(10),
  yourActions: z.array(z.string()).max(15),
  openItems: z.array(z.string()).max(20),
  watchOut: z.array(z.string()).max(10),
});

export const BRIEF_SYSTEM = `You write a short catch-up brief for a colleague who missed a meeting or is taking over someone's work.
Rules:
- Use ONLY the facts in the JSON context. If something is not in it, do not mention it.
- Be concrete: names, dates, statuses. No filler.
- yourActions: open items owned by the reader (empty if there is no reader or none are owned).
- openItems: other open items the reader should know about, with owner and due date.
- watchOut: overdue items, items carried forward several times, open decision conflicts, unassigned items.
- Call an item overdue ONLY if its "overdue" field is true. "today" in the context is the real current date.
- headline: one sentence. summary: at most 4 sentences.
Reply with ONLY this JSON: {"headline": string, "summary": string, "keyDecisions": string[], "yourActions": string[], "openItems": string[], "watchOut": string[]}`;

// ---------- Knowledge linking ----------

export const linkSchema = z.object({
  links: z.array(
    z.object({
      targetId: z.string(),
      docId: z.string(),
      reason: z.string().min(1),
      relevance: z.number().min(0).max(1),
    }),
  ),
});

export const LINK_SYSTEM = `You connect action items and decisions to the team's knowledge base documents.
For each target you get candidate documents. Keep a link only if the document genuinely helps someone
working on that target (background, an earlier decision, a spec, a runbook). Skip weak, word-level matches.
reason: one sentence saying what in the document is useful for the target.
Only use targetId and docId values that appear in the input.
Reply with ONLY this JSON: {"links": [{"targetId": string, "docId": string, "reason": string, "relevance": number between 0 and 1}]}`;

// ---------- Ask Relay: answers from the knowledge base, with citations ----------

export const askSchema = z.object({
  found: z.boolean(),
  answer: z.string(),
  citations: z.array(z.string()).max(6),
});

export const ASK_SYSTEM = `You answer a team member's question using ONLY the documents provided (team documents and past meeting records).
Rules:
- If the documents do not contain the answer, set found=false, answer="", citations=[]. Never guess or use outside knowledge.
- Otherwise answer in 1-4 plain sentences with concrete facts (names, dates, numbers).
- Documents are sorted oldest first and each has a date. If they disagree (for example a decision was later changed),
  the document with the LATEST date wins: give that answer and say what it replaced and when.
- citations: the docId of every document you used. Only use docId values from the input.
Reply with ONLY this JSON: {"found": boolean, "answer": string, "citations": string[]}`;

// ---------- Special feature: decision conflict check ----------

export const conflictSchema = z.object({
  conflicts: z.array(
    z.object({
      decisionId: z.string(),
      pastDecisionId: z.string(),
      explanation: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export const CONFLICT_SYSTEM = `You check whether newly recorded team decisions contradict earlier decisions.
A conflict means both cannot be followed at the same time (e.g. "launch on 1 Nov" vs "launch moved to 15 Nov",
"use Postgres" vs "use MongoDB"). A new decision that only refines, adds detail to, or is unrelated to an old one is NOT a conflict.
An explicit reversal IS a conflict worth flagging, so people know the old decision is outdated.
explanation: one or two sentences naming what clashes.
confidence: how sure you are that it is a real conflict (0-1).
Only use ids that appear in the input. Return an empty list when nothing conflicts.
Reply with ONLY this JSON: {"conflicts": [{"decisionId": string, "pastDecisionId": string, "explanation": string, "confidence": number}]}`;
