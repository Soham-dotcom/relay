// Quick end-to-end check against a running server: node scripts/smoke.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:4000/api';
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const show = (label, r, f = (b) => b) => console.log(`${label}: ${r.status}`, JSON.stringify(f(r.body)).slice(0, 300));

show('health', await call('GET', '/health'));
const sessions = await call('GET', '/sessions');
show('sessions', sessions, (b) => b.map((s) => `${s.title} ${s.kind} ${s.status} open=${s.openItems}`));
const transfer = sessions.body.find((s) => s.kind === 'TRANSFER');
show('brief(transfer)', await call('POST', `/sessions/${transfer.id}/brief`, {}), (b) => ({ source: b.source, headline: b.brief.headline, watchOut: b.brief.watchOut }));
show('bad session', await call('POST', '/sessions', { title: '', scheduledAt: 'nope' }));
const items = await call('GET', '/items?open=true');
show('close without outcome', await call('PATCH', `/items/${items.body[0].id}`, { status: 'DONE' }));
show('unknown route', await call('GET', '/nope'));
show('conflicts', await call('GET', '/conflicts'), (b) => b.map((c) => c.explanation));
