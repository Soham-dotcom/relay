import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type KnowledgeDoc } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, fmtDate } from '../ui';

export default function KnowledgePage() {
  const qc = useQueryClient();
  const { hash } = useLocation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ title: '', content: '' });
  const docs = useQuery({ queryKey: ['knowledge', query], queryFn: () => api<KnowledgeDoc[]>(`/knowledge${query ? `?q=${encodeURIComponent(query)}` : ''}`) });
  const add = useMutation({
    mutationFn: () => api('/knowledge', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ title: '', content: '' });
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/knowledge/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries() });

  useEffect(() => {
    if (hash && docs.data) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [hash, docs.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Knowledge base</h1>
        <p className="text-sm text-slate-600">Team documents plus every held meeting. AI links action items and decisions to the documents that help with them.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), setQuery(q.trim()))}>
            <input aria-label="Search" className={inputCls} placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          {docs.isLoading && <Loading />}
          <ErrorBox error={docs.error ?? del.error} />
          {docs.data?.length === 0 && <Empty>No documents found.</Empty>}
          {docs.data?.map((d) => (
            <article key={d.id} id={d.id} className={`rounded-lg border bg-white p-4 ${hash === `#${d.id}` ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={d.source === 'MEETING' ? 'bg-sky-50 text-sky-700 ring-sky-200' : undefined}>{d.source === 'MEETING' ? 'Past meeting' : 'Document'}</Badge>
                <h2 className="font-medium text-slate-900">{d.title}</h2>
                <span className="text-xs text-slate-500">{fmtDate(d.createdAt)}</span>
                {d.source === 'DOCUMENT' ? (
                  <Button variant="ghost" className="ml-auto !py-0.5 text-xs" onClick={() => confirm('Delete this document?') && del.mutate(d.id)}>Delete</Button>
                ) : (
                  d.sessionId && <Link to={`/sessions/${d.sessionId}`} className="ml-auto text-xs text-teal-700 hover:underline">Open session →</Link>
                )}
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-slate-700">{d.content}</p>
              {d.links.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked by AI</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {d.links.map((l) => (
                      <li key={l.id}>
                        {l.item ? <>☐ {l.item.title}</> : l.decision ? <Link className="hover:underline" to={`/sessions/${l.decision.sessionId}`}>◆ {l.decision.text}</Link> : null}
                        <span className="block text-xs text-slate-500">{l.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
        <Card title="Add a document">
          <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
            <Field label="Title">
              <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
            </Field>
            <Field label="Content" hint="Paste a spec, runbook, decision record or notes.">
              <textarea className={inputCls} rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required maxLength={50000} />
            </Field>
            <ErrorBox error={add.error} />
            <Button type="submit" busy={add.isPending}>Add document</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
