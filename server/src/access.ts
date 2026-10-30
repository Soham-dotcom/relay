/*
 * Every visibility rule lives in this file. Two tools:
 *
 * 1. Prisma "where" filters (sessionWhere, docWhere, itemWhere) that every read query adds, so a
 *    user can only ever load what they may see. Hiding things only in the UI would be bypassable.
 * 2. Audiences (the set of people who can see a record), used where the AI combines two records:
 *    a knowledge link or a decision conflict is only allowed when everyone who can see the first
 *    record can also see the second. Otherwise the AI would leak a private title into a team page.
 */
import type { Prisma, Visibility } from '@prisma/client';
import { prisma } from './db.js';
import { notFound } from './errors.js';
import { logger } from './logger.js';

export interface Viewer {
  id: string;
  name: string;
  teamIds: string[];
}

export async function loadViewer(personId: string): Promise<Viewer | null> {
  const p = await prisma.person.findUnique({ where: { id: personId }, include: { memberships: true } });
  return p ? { id: p.id, name: p.name, teamIds: p.memberships.map((m) => m.teamId) } : null;
}

// ---------- Query filters ----------

/** Org-wide sessions, sessions of my teams, and any session I take part in. */
export function sessionWhere(v: Viewer): Prisma.SessionWhereInput {
  return {
    OR: [{ visibility: 'ORG' }, { visibility: 'TEAM', teamId: { in: v.teamIds } }, { participants: { some: { personId: v.id } } }],
  };
}

/** Standalone docs by their own visibility; meeting docs follow their session. */
export function docWhere(v: Viewer): Prisma.KnowledgeDocWhereInput {
  return {
    OR: [
      { sessionId: null, visibility: 'ORG' },
      { sessionId: null, visibility: 'TEAM', teamId: { in: v.teamIds } },
      { sessionId: null, createdById: v.id },
      { session: sessionWhere(v) },
    ],
  };
}

/** An item is visible with its session, and always to its owner (people must see their own tasks). */
export function itemWhere(v: Viewer): Prisma.ActionItemWhereInput {
  return { OR: [{ session: sessionWhere(v) }, { ownerId: v.id }] };
}

// ---------- Guards: 404 (not 403) so a private record's existence is not revealed ----------

async function deny(resource: string, id: string, v: Viewer, exists: boolean): Promise<never> {
  if (exists) logger.warn({ event: 'access.denied', resource, resourceId: id, viewerId: v.id }, 'access denied');
  throw notFound(resource[0].toUpperCase() + resource.slice(1));
}

export async function assertSessionVisible(v: Viewer, id: string) {
  if (await prisma.session.count({ where: { id, AND: [sessionWhere(v)] } })) return;
  return deny('session', id, v, (await prisma.session.count({ where: { id } })) > 0);
}

export async function assertItemVisible(v: Viewer, id: string) {
  if (await prisma.actionItem.count({ where: { id, AND: [itemWhere(v)] } })) return;
  return deny('action item', id, v, (await prisma.actionItem.count({ where: { id } })) > 0);
}

export async function assertDocVisible(v: Viewer, id: string) {
  if (await prisma.knowledgeDoc.count({ where: { id, AND: [docWhere(v)] } })) return;
  return deny('document', id, v, (await prisma.knowledgeDoc.count({ where: { id } })) > 0);
}

export function conflictWhere(v: Viewer): Prisma.DecisionConflictWhereInput {
  return { decision: { session: sessionWhere(v) }, pastDecision: { session: sessionWhere(v) } };
}

export async function assertConflictVisible(v: Viewer, id: string) {
  if (await prisma.decisionConflict.count({ where: { id, AND: [conflictWhere(v)] } })) return;
  return deny('conflict', id, v, (await prisma.decisionConflict.count({ where: { id } })) > 0);
}

// ---------- Audiences: who can see a record ----------

export interface Directory {
  everyone: Set<string>;
  members: Map<string, Set<string>>;
}

export async function loadDirectory(): Promise<Directory> {
  const [people, links] = await Promise.all([prisma.person.findMany({ select: { id: true } }), prisma.teamMember.findMany()]);
  const members = new Map<string, Set<string>>();
  for (const l of links) {
    if (!members.has(l.teamId)) members.set(l.teamId, new Set());
    members.get(l.teamId)!.add(l.personId);
  }
  return { everyone: new Set(people.map((p) => p.id)), members };
}

export interface SessionScope {
  visibility: Visibility;
  teamId: string | null;
  participantIds: string[];
}

export function sessionAudience(s: SessionScope, dir: Directory): Set<string> {
  if (s.visibility === 'ORG') return dir.everyone;
  const people = new Set(s.participantIds);
  if (s.visibility === 'TEAM' && s.teamId) for (const id of dir.members.get(s.teamId) ?? []) people.add(id);
  return people;
}

export function docAudience(d: { visibility: Visibility; teamId: string | null; createdById: string | null; session: SessionScope | null }, dir: Directory): Set<string> {
  if (d.session) return sessionAudience(d.session, dir);
  if (d.visibility === 'ORG') return dir.everyone;
  const people = new Set(d.createdById ? [d.createdById] : []);
  if (d.visibility === 'TEAM' && d.teamId) for (const id of dir.members.get(d.teamId) ?? []) people.add(id);
  return people;
}

/** True when everyone in `inner` is also in `outer`. */
export function covers(outer: Set<string>, inner: Set<string>): boolean {
  for (const id of inner) if (!outer.has(id)) return false;
  return true;
}

export async function loadSessionScope(sessionId: string): Promise<SessionScope> {
  const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, include: { participants: { select: { personId: true } } } });
  return { visibility: s.visibility, teamId: s.teamId, participantIds: s.participants.map((p) => p.personId) };
}

export const scopeInclude = { participants: { select: { personId: true } } } as const;
export const toScope = (s: { visibility: Visibility; teamId: string | null; participants: { personId: string }[] }): SessionScope => ({
  visibility: s.visibility,
  teamId: s.teamId,
  participantIds: s.participants.map((p) => p.personId),
});
