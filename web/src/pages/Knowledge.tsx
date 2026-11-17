import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type KnowledgeDoc, type Visibility } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, VisibilityBadge, VisibilityPicker } from '../ui';
import { fmtDate } from '../format';
import { useMe } from '../hooks';

const ACCEPT = '.pdf,.docx,.txt,.md,.csv';
const MAX_MB = 10;

const fileIcon = (d: KnowledgeDoc) => (d.source === 'MEETING' ? '🗓️' : d.fileType === 'pdf' ? '📕' : d.fileType === 'docx' ? '📘' : d.fileType ? '📃' : '📄');

interface UploadResult {
  title: string;
  fileName: string;
  pages: number | null;
  chars: number;
  chunks: number;
}

export default function KnowledgePage() {
  const qc = useQueryClient();
  const { hash } = useLocation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const docs = useQuery({ queryKey: ['knowledge', query], queryFn: () => api<KnowledgeDoc[]>(`/knowledge${query ? `?q=${encodeURIComponent(query)}` : ''}`) });
  const del = useMutation({ mutationFn: (id: string) => api(`/knowledge/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries() });

  useEffect(() => {
    if (hash && docs.data) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [hash, docs.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Knowledge base</h1>
        <p className="text-sm text-slate-600">
          Team documents, uploaded files and every held meeting. AI links items and decisions to them, and{' '}
          <Link to="/ask" className="font-medium text-teal-700 hover:underline">
            ✦ Ask
          </Link>{' '}
          answers questions from them.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), setQuery(q.trim()))}>
            <input aria-label="Search" className={inputCls} placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          {docs.isLoading && <Loading />}
          <ErrorBox error={docs.error ?? del.error} />
          {docs.data?.length === 0 && <Empty>No documents found.</Empty>}
          {docs.data?.map((d) => (
            <article
              key={d.id}
              id={d.id}
              className={`animate-rise rounded-lg border border-l-4 bg-white p-4 transition hover:shadow-md ${
                { PRIVATE: 'border-l-rose-400', TEAM: 'border-l-slate-400', ORG: 'border-l-emerald-500' }[d.visibility]
              } ${hash === `#${d.id}` ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="text-lg">
                  {fileIcon(d)}
                </span>
                <Badge tone={d.source === 'MEETING' ? 'bg-sky-50 text-sky-700 ring-sky-200' : d.fileName ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : undefined}>
                  {d.source === 'MEETING' ? 'Past meeting' : d.fileName ? 'Uploaded file' : 'Document'}
                </Badge>
                <VisibilityBadge visibility={d.visibility} team={d.team} />
                <h2 className="font-medium text-slate-900">{d.title}</h2>
                <span className="text-xs text-slate-500">{fmtDate(d.createdAt)}</span>
                {d.source === 'DOCUMENT' ? (
                  <Button variant="ghost" className="ml-auto !py-0.5 text-xs" onClick={() => confirm('Delete this document?') && del.mutate(d.id)}>
                    Delete
                  </Button>
                ) : (
                  d.sessionId && (
                    <Link to={`/sessions/${d.sessionId}`} className="ml-auto text-xs text-teal-700 hover:underline">
                      Open session →
                    </Link>
                  )
                )}
              </div>
              {d.fileName && (
                <p className="mt-1 text-xs text-slate-500">
                  📎 {d.fileName} · {(d.chars / 1000).toFixed(d.chars < 10000 ? 1 : 0)}k characters · {d.chunks} searchable passage{d.chunks === 1 ? '' : 's'}
                </p>
              )}
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-slate-700">{d.content}</p>
              {d.links.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked by AI</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {d.links.map((l) => (
                      <li key={l.id}>
                        {l.item ? (
                          <>☐ {l.item.title}</>
                        ) : l.decision ? (
                          <Link className="hover:underline" to={`/sessions/${l.decision.sessionId}`}>
                            ◆ {l.decision.text}
                          </Link>
                        ) : null}
                        <span className="block text-xs text-slate-500">{l.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
        <AddDocument />
      </div>
    </div>
  );
}

/** Upload a file (default) or paste text. Both end up chunked and searchable by Ask. */
function AddDocument() {
  const qc = useQueryClient();
  const me = useMe().data;
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('TEAM');
  const [teamId, setTeamId] = useState(me?.teams[0]?.id ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const team = visibility === 'TEAM' ? teamId || null : null;

  const done = () => {
    setTitle('');
    setContent('');
    setFile(null);
    if (input.current) input.current.value = '';
    qc.invalidateQueries({ queryKey: ['knowledge'] });
  };
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      if (title.trim()) form.append('title', title.trim());
      form.append('visibility', visibility);
      if (team) form.append('teamId', team);
      return api<UploadResult>('/knowledge/upload', { method: 'POST', body: form });
    },
    onSuccess: done,
  });
  const paste = useMutation({
    mutationFn: () => api<{ title: string; chunks: number }>('/knowledge', { method: 'POST', body: { title, content, visibility, teamId: team } }),
    onSuccess: done,
  });

  const pick = (f: File | undefined) => {
    setLocalError(null);
    upload.reset();
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.split(',').includes(ext)) return setLocalError(`"${ext}" files aren't supported. Use PDF, Word (.docx), .txt, .md or .csv.`);
    if (f.size > MAX_MB * 1024 * 1024) return setLocalError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_MB} MB.`);
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };
  const busy = upload.isPending || paste.isPending;

  return (
    <Card title="Add to the knowledge base" className="self-start">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
        {(['upload', 'paste'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-2 py-1.5 font-medium transition ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {m === 'upload' ? '⬆ Upload file' : '✎ Paste text'}
          </button>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'upload') {
            if (file) upload.mutate();
            else setLocalError('Choose a file first.');
          } else paste.mutate();
        }}
      >
        {mode === 'upload' ? (
          <label
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
              dragging ? 'border-teal-500 bg-teal-50' : file ? 'border-teal-300 bg-teal-50/40' : 'border-slate-300 hover:border-teal-400 hover:bg-slate-50'
            }`}
          >
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <>
                <span className="text-2xl">📎</span>
                <span className="mt-1 max-w-full truncate text-sm font-medium text-slate-900">{file.name}</span>
                <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB · click to change</span>
              </>
            ) : (
              <>
                <span className="text-2xl">⬆</span>
                <span className="mt-1 text-sm font-medium text-slate-900">Drop a file or click to choose</span>
                <span className="text-xs text-slate-500">PDF, Word, .txt, .md or .csv · up to {MAX_MB} MB</span>
              </>
            )}
          </label>
        ) : (
          <Field label="Content" hint="Paste a spec, runbook, decision record or notes.">
            <textarea className={inputCls} rows={8} value={content} onChange={(e) => setContent(e.target.value)} required maxLength={50000} />
          </Field>
        )}

        <Field label="Title" hint={mode === 'upload' ? 'Optional: defaults to the file name.' : undefined}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required={mode === 'paste'} maxLength={200} />
        </Field>
        <Field label="Who can see it">
          <div className="[&>div]:sm:grid-cols-1">
            <VisibilityPicker value={visibility} onChange={setVisibility} privateHint="Only you" />
          </div>
        </Field>
        {visibility === 'TEAM' && (me?.teams.length ?? 0) > 1 && (
          <Field label="Team">
            <select className={inputCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {me?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {localError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {localError}
          </p>
        )}
        <ErrorBox error={mode === 'upload' ? upload.error : paste.error} />
        {upload.data && mode === 'upload' && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Added "{upload.data.title}"{upload.data.pages ? `: ${upload.data.pages} page${upload.data.pages === 1 ? '' : 's'}` : ''},{' '}
            {upload.data.chunks} searchable passage{upload.data.chunks === 1 ? '' : 's'}.{' '}
            <Link to="/ask" className="font-medium underline">
              Ask about it →
            </Link>
          </p>
        )}
        {paste.data && mode === 'paste' && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ Added "{paste.data.title}".</p>}

        <Button type="submit" busy={busy} className="w-full">
          {busy ? (mode === 'upload' ? 'Reading and indexing…' : 'Adding…') : mode === 'upload' ? 'Upload and index' : 'Add document'}
        </Button>
      </form>
    </Card>
  );
}
