// Skills + playbook builder for the OpenLex hub (Phase 7.2).
// Skills are SKILL.md files: bundled starters plus the firm's own in the
// workspace skills/ folder. Run one in Word or the CLI with "/name".
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, ClipboardList } from 'lucide-react'

interface Engine { call: (method: string, path: string, body?: unknown) => Promise<any> }
interface SkillRow { name: string; title?: string; description?: string; source: 'bundled' | 'firm'; overrides?: string; error?: string }

const card = 'p-5 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const btn = 'px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'
const ghost = 'px-3 py-1.5 rounded border border-tobacco text-cream text-sm hover:bg-deep-brown disabled:opacity-50'

const BLANK = '---\nname: my-skill\ntitle: My skill\ndescription: One sentence: when should this skill be used?\ntriggers: [phrases, a lawyer might type]\noutput: suggestions\n---\n1. …\n2. …\n\nOutput: …\n'

export function SkillsPanel({ e, activeMatter, docs }: { e: Engine; activeMatter: string; docs: { name: string; path: string }[] }) {
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [content, setContent] = useState('')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => { setSkills((await e.call('GET', '/api/skills')).skills) }, [e])
  useEffect(() => { load().catch((err) => setMsg(err.message)) }, [load])

  const open = async (name: string) => {
    try { setContent((await e.call('GET', `/api/skills/get?name=${encodeURIComponent(name)}`)).content); setMsg('') } catch (err: any) { setMsg(err.message) }
  }
  const draft = async () => {
    setBusy(true); setMsg('Drafting…')
    try { const r = await e.call('POST', '/api/skills/draft', { request, matterId: activeMatter || null }); setContent(r.content); setMsg('Draft ready. Review it, then save.') } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }
  const save = async () => {
    try { const r = await e.call('POST', '/api/skills', { content }); setMsg(`Saved /${r.skill.name} (firm skill).`); await load() } catch (err: any) { setMsg(err.message) }
  }
  const remove = async (name: string) => {
    if (!confirm(`Delete the firm skill /${name}?`)) return
    try { await e.call('POST', '/api/skills/delete', { name }); await load(); setMsg(`Deleted /${name}.`) } catch (err: any) { setMsg(err.message) }
  }

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-serif text-xl text-parchment mb-1"><Sparkles size={18} /> Skills</h2>
      <p className="text-antique text-sm mb-3">Reusable instructions for the assistant. Start a message with <code>/name</code> in Word or the CLI; OpenLex also suggests a matching skill. Firm skills live in the workspace <code>skills/</code> folder and replace a bundled one with the same name.</p>
      <ul className="text-sm space-y-1 mb-3">
        {skills.map((s) => (
          <li key={s.name} className="flex items-start gap-2">
            <button className="text-left flex-1 hover:text-accent" onClick={() => open(s.name)}>
              <span className="text-cream">/{s.name}</span> <span className="text-antique">— {s.error ? <span className="text-amber-400">{s.error}</span> : s.description}</span>
            </button>
            <span className="text-xs text-antique shrink-0">{s.source}{s.overrides ? ' (overrides bundled)' : ''}</span>
            {s.source === 'firm' && <button className="text-xs text-antique hover:text-accent" onClick={() => remove(s.name)}>delete</button>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={input} placeholder="Describe a new skill, e.g. “check supplier contracts against our 60-day payment rule”" value={request} onChange={(ev) => setRequest(ev.target.value)} />
        <button className={ghost} disabled={busy || !request.trim()} onClick={draft}>Draft</button>
        <button className={ghost} onClick={() => setContent(BLANK)}>Blank</button>
      </div>
      {content && (
        <div className="mt-2 grid gap-2">
          <textarea className={input + ' font-mono min-h-[220px]'} value={content} onChange={(ev) => setContent(ev.target.value)} />
          <div className="flex gap-2"><button className={btn} onClick={save}>Save as firm skill</button><button className={ghost} onClick={() => setContent('')}>Close</button></div>
        </div>
      )}
      {msg && <p className="text-cream text-sm mt-2">{msg}</p>}
      <PlaybookBuilder e={e} activeMatter={activeMatter} docs={docs} />
    </section>
  )
}

function PlaybookBuilder({ e, activeMatter, docs }: { e: Engine; activeMatter: string; docs: { name: string; path: string }[] }) {
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [focus, setFocus] = useState('')
  const [json, setJson] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const draft = async () => {
    setBusy(true); setMsg('Reading the precedents…')
    try {
      const r = await e.call('POST', '/api/workflows/playbooks/draft', { files: picked, matterId: activeMatter || null, title, focus })
      setJson(JSON.stringify(r.playbook, null, 2))
      setName(title || 'firm-playbook')
      setMsg(`${r.playbook.checks.length} checks from ${r.documents.join(', ')}${r.unproven ? ` · ${r.unproven} without a firm standard (no verbatim proof in the precedents)` : ''}. Edit, then save.`)
    } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }
  const save = async () => {
    try { const r = await e.call('POST', '/api/workflows/playbooks', { name, playbook: JSON.parse(json) }); setMsg(`Saved playbook "${r.name}" (${r.checks} checks). Use it in Review documents or /run_playbook.`) } catch (err: any) { setMsg(err.message) }
  }

  return (
    <div className="mt-5 pt-4 border-t border-tobacco">
      <p className="flex items-center gap-2 text-parchment text-sm mb-2"><ClipboardList size={14} /> Playbook from your precedents</p>
      <p className="text-antique text-xs mb-2">Pick up to five of the firm's standard documents. OpenLex derives the review checklist and the firm's position on each point; a position is kept only if it is quoted verbatim from a precedent.</p>
      <div className="max-h-32 overflow-auto border border-tobacco rounded p-2 mb-2">
        {docs.length === 0 && <p className="text-antique text-xs">No documents in the active matter's folders.</p>}
        {docs.map((d) => (
          <label key={d.path} className="flex items-center gap-2 text-cream text-sm">
            <input type="checkbox" checked={picked.includes(d.path)} disabled={!picked.includes(d.path) && picked.length >= 5}
              onChange={(ev) => setPicked(ev.target.checked ? [...picked, d.path] : picked.filter((p) => p !== d.path))} /> {d.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={input} placeholder="Title, e.g. Our NDA standard" value={title} onChange={(ev) => setTitle(ev.target.value)} />
        <input className={input} placeholder="Focus (optional)" value={focus} onChange={(ev) => setFocus(ev.target.value)} />
        <button className={ghost} disabled={busy || !picked.length} onClick={draft}>Build</button>
      </div>
      {json && (
        <div className="mt-2 grid gap-2">
          <textarea className={input + ' font-mono min-h-[200px]'} value={json} onChange={(ev) => setJson(ev.target.value)} />
          <div className="flex gap-2"><input className={input} placeholder="file name" value={name} onChange={(ev) => setName(ev.target.value)} /><button className={btn} onClick={save}>Save playbook</button></div>
        </div>
      )}
      {msg && <p className="text-cream text-sm mt-2">{msg}</p>}
    </div>
  )
}
