"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GROUPS, SECONDS, SHEET_KINDS, STEPS, bodyPrompt, editPrompt, headCount, headPrompt, initialPicks, word,
  type Group, type Picks, type Step, type Value,
} from "../lib/character";
import type { CharacterJob, CharacterMeta } from "../lib/characters";
import type { Lang, Strings } from "../lib/i18n";
import { useLang } from "../lib/use-lang";
import { Mark } from "./mark";
import { TopBar } from "./top-bar";

type Version = { id: string; url: string };
type Rostered = { id: string; name: string; updatedAt: string; head: string | null };

// The job states that end a job, as lib/comfy.ts has them; any other state is still on its way.
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "canceled", "error", "expired"]);
const running = (status: string) => !TERMINAL.has(status);
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fileUrl = (id: string, file: string) => `/api/characters/${id}/files/${file}`;
/** «20 s» under a minute, to the nearest five seconds; «2 min» from there. */
const about = (seconds: number) => seconds < 60 ? `${Math.max(5, Math.round(seconds / 5) * 5)} s` : `${Math.round(seconds / 60)} min`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status}`);
  return body;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** One option group: the style cards, chips (one or several), a range or a few words. */
function Control({ group, value, lang, t, note, onChange }: {
  group: Group; value: Value | undefined; lang: Lang; t: Strings; note?: string; onChange: (value: Value) => void;
}) {
  const label = word(group, lang);
  const hint = group.hint ? word(group.hint, lang) : null;
  if (group.kind === "image") return null; // the creator draws it: it holds a file, not a pick

  if (group.kind === "style") {
    return (
      <fieldset className="opt-group">
        <legend>{label}</legend>
        <div className="styles">
          {group.choices.map((choice) => (
            <button key={choice.id} type="button" className="style-card" aria-pressed={value === choice.id} onClick={() => onChange(choice.id)}>
              <img src={`/styles/${choice.id}.webp`} alt="" loading="lazy" />
              <span>{word(choice, lang)}</span>
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (group.kind === "range") {
    const n = typeof value === "number" ? value : group.initial;
    return (
      <label className="opt-group">
        <span className="legend">{label}<b>{n} {word(group.unit, lang)}</b></span>
        <input type="range" min={group.min} max={group.max} value={n} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
    );
  }
  if (group.kind === "text") {
    const props = { value: typeof value === "string" ? value : "", placeholder: word(group.placeholder, lang) };
    return (
      <label className="opt-group">
        <span className="legend">{label}</span>
        {group.line
          ? <input type="text" maxLength={60} {...props} onChange={(event) => onChange(event.target.value)} />
          : <textarea className="short" maxLength={320} {...props} onChange={(event) => onChange(event.target.value)} />}
      </label>
    );
  }

  const many = group.kind === "many";
  const picked = many ? (Array.isArray(value) ? value : []) : typeof value === "string" && value ? [value] : [];
  const full = many && picked.length >= group.max;
  const choose = (id: string) => {
    if (many) onChange(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
    else onChange(picked.includes(id) && !group.required ? "" : id);
  };
  return (
    <fieldset className="opt-group">
      <legend>{label}{many && <small>{` · ${t.cr_max.replace("{n}", String(group.max))}`}</small>}</legend>
      <div className="opts">
        {group.choices.map((choice) => {
          const on = picked.includes(choice.id);
          return (
            <button key={choice.id} type="button" className="opt" aria-pressed={on} disabled={full && !on} onClick={() => choose(choice.id)}>
              {choice.swatch && <span className="sw" style={{ background: choice.swatch }} aria-hidden />}
              {word(choice, lang)}
            </button>
          );
        })}
      </div>
      {(note || hint) && <small className="opt-hint">{note ?? hint}</small>}
    </fieldset>
  );
}

/** The picture of a character that already exists, dropped or chosen; shown as it is. */
function PictureDrop({ label, hint, drop, url, onPick }: { label: string; hint: string | null; drop: string; url: string | null; onPick: (file: File | null) => void }) {
  return (
    <div className="opt-group">
      <span className="legend">{label}</span>
      <label className={`drop${url ? " filled" : ""}`}>
        {url ? <img src={url} alt="" /> : <span><b>{drop}</b><small>PNG · JPEG · WebP</small></span>}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onPick(event.target.files?.[0] ?? null)} />
      </label>
      {hint && <small className="opt-hint">{hint}</small>}
    </div>
  );
}

/**
 * The character creator: the head, then the body and its clothes, then the sheet (atelier's steps), each step with its
 * buttons on the right (Higgsfield's and Cheapsfield's way of choosing), the step's picture and its versions on the left,
 * and a box underneath to change anything on that picture in words. The step pressed is the mode: the box changes
 * that step's picture, and the page never moves to another step by itself. Everything runs on ComfyUI with FLUX.2
 * [klein] 4B (lib/creator-comfy.ts); the character lives in data/characters (lib/characters.ts).
 */
export function Creator() {
  const { lang, t, toggle } = useLang();
  const [step, setStep] = useState<Step>("head");
  const [picks, setPicks] = useState<Record<Step, Picks>>(() => ({ head: initialPicks("head"), body: initialPicks("body"), sheet: initialPicks("sheet") }));
  const [character, setCharacter] = useState<CharacterMeta | null>(null);
  const [job, setJob] = useState<CharacterJob | null>(null);
  const [roster, setRoster] = useState<Rostered[]>([]);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [picture, setPicture] = useState<File | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!picture) { setPictureUrl(null); return; }
    const url = URL.createObjectURL(picture);
    setPictureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  const loadRoster = useCallback(async () => {
    try { setRoster((await call<{ characters: Rostered[] }>("/api/characters")).characters); } catch { /* the roster just stays */ }
  }, []);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const index = STEPS.indexOf(step);
  const name = typeof picks.sheet.name === "string" ? picks.sheet.name.trim() : "";
  const stepName: Record<Step, string> = { head: t.cr_step_head, body: t.cr_step_body, sheet: t.cr_step_sheet };
  const runLabel: Record<Step, string> = { head: t.cr_run_head, body: t.cr_run_body, sheet: t.cr_run_sheet };
  const emptyTitle: Record<Step, string> = { head: t.cr_empty_head, body: t.cr_empty_body, sheet: t.cr_empty_sheet };
  const emptyBody: Record<Step, string> = { head: t.cr_empty_head_body, body: t.cr_empty_body_body, sheet: t.cr_empty_sheet_body };
  const chatPlaceholder: Record<Step, string> = { head: t.cr_chat_head, body: t.cr_chat_body, sheet: t.cr_chat_sheet };
  const the: Record<Step, string> = { head: t.cr_the_head, body: t.cr_the_body, sheet: t.cr_the_sheet };
  const working: Record<CharacterJob["kind"], string> = { heads: t.cr_working_heads, body: t.cr_working_body, edit: t.cr_working_edit, sheet: t.cr_working_sheet };

  const versions: Record<Step, Version[]> = {
    head: character?.versions.head.map((v) => ({ id: v.id, url: fileUrl(character.id, v.file) })) ?? [],
    body: character?.versions.body.map((v) => ({ id: v.id, url: fileUrl(character.id, v.file) })) ?? [],
    sheet: character?.versions.sheet.map((v) => ({ id: v.id, url: fileUrl(character.id, v.file) })) ?? [],
  };
  const chosenOf = (s: Step) => versions[s].find((v) => v.id === character?.chosen[s]) ?? versions[s].at(-1) ?? null;
  const current = chosenOf(step);
  const busy = sending || (!!job && running(job.status));
  const own = picks.head.start === "picture";
  // Your own picture, while it is the chosen head, stands in for the body: a mascot drawn whole needs no body step.
  const pictureHead = character?.versions.head.find((v) => v.id === character.chosen.head)?.source === "picture";
  const front = chosenOf("body") ?? (pictureHead ? chosenOf("head") : null);
  const needs = step === "head" && own && !picture ? t.cr_need_picture
    : step === "body" && !chosenOf("head") ? t.cr_needs_head
    : step === "sheet" && !front ? t.cr_needs_body : "";
  const heads = headCount(picks.head);
  const eta = step === "head" && own ? t.cr_eta_picture
    : step === "head"
    ? t.cr_eta_head.replace("{n}", String(heads)).replace("{t}", about(SECONDS.headLoad + heads * SECONDS.head))
    : t.cr_eta.replace("{t}", about(step === "body" ? SECONDS.body : SECONDS.sheetSimple));
  const said = step === "head" ? headPrompt(picks.head) : step === "body" ? bodyPrompt(picks.head, picks.body) : "";
  const shown = GROUPS[step].filter((group) => !group.when || group.when(picks[step]));

  const set = (id: string, value: Value) => setPicks((all) => ({ ...all, [step]: { ...all[step], [id]: value } }));
  // Each step opens at the top of its buttons, wherever the last one was scrolled to.
  const body = useRef<HTMLDivElement>(null);
  const go = (next: Step) => { setStep(next); setNotice(""); setPicking(null); body.current?.scrollTo({ top: 0 }); };

  /** The character being made; the first thing sent creates it. */
  async function ensure(): Promise<CharacterMeta> {
    if (character) return character;
    const made = await call<CharacterMeta>("/api/characters", json("POST", { picks }));
    setCharacter(made);
    return made;
  }

  async function start(send: (c: CharacterMeta) => Promise<CharacterJob>) {
    setSending(true);
    setNotice("");
    try {
      const c = await ensure();
      const next = await send(c);
      setJob(next);
      setNow(Date.now());
    } catch (error) {
      setNotice(`${t.cr_failed} ${error instanceof Error ? error.message : ""}`);
    } finally {
      setSending(false);
    }
  }

  async function run() {
    if (needs || busy) return;
    if (step === "head" && own && picture) {
      setSending(true);
      try {
        const c = await ensure();
        const form = new FormData();
        form.append("picture", picture);
        form.append("picks", JSON.stringify(picks));
        setCharacter(await call<CharacterMeta>(`/api/characters/${c.id}/picture`, { method: "POST", body: form }));
        setNotice("");
        void loadRoster();
      } catch (error) {
        setNotice(`${t.cr_failed} ${error instanceof Error ? error.message : ""}`);
      } finally {
        setSending(false);
      }
      return;
    }
    if (step === "head") {
      await start((c) => call<CharacterJob>(`/api/characters/${c.id}/heads`, json("POST", { prompt: headPrompt(picks.head), count: heads, picks })));
      return;
    }
    if (step === "body") {
      const from = chosenOf("head");
      if (!from) return;
      await start((c) => call<CharacterJob>(`/api/characters/${c.id}/edits`, json("POST", { kind: "body", from: from.id, prompt: bodyPrompt(picks.head, picks.body), picks })));
      return;
    }
    await start((c) => call<CharacterJob>(`/api/characters/${c.id}/sheet`, json("POST", { name, picks })));
  }

  async function send() {
    const asked = ask.trim();
    if (!asked || busy) return;
    if (!current) { setNotice(t.cr_need_image.replace("{step}", the[step])); return; }
    if (step === "sheet") { setNotice(t.cr_sheet_chat); return; }
    setAsk("");
    await start((c) => call<CharacterJob>(`/api/characters/${c.id}/edits`, json("POST", { kind: "edit", step, from: current.id, prompt: editPrompt(asked), picks })));
  }

  async function choose(s: Step, versionId: string) {
    if (!character) return;
    setCharacter({ ...character, chosen: { ...character.chosen, [s]: versionId } });
    try { setCharacter(await call<CharacterMeta>(`/api/characters/${character.id}`, json("PATCH", { chosen: { [s]: versionId } }))); } catch { /* the choice stays on screen */ }
  }

  async function open(id: string | null) {
    setJob(null); setPicking(null); setNotice(""); setPicture(null);
    if (!id) {
      setCharacter(null);
      setPicks({ head: initialPicks("head"), body: initialPicks("body"), sheet: initialPicks("sheet") });
      return;
    }
    try {
      const c = await call<CharacterMeta>(`/api/characters/${id}`);
      setCharacter(c);
      setPicks({ head: { ...initialPicks("head"), ...c.picks.head }, body: { ...initialPicks("body"), ...c.picks.body }, sheet: { ...initialPicks("sheet"), ...c.picks.sheet, name: c.name || c.picks.sheet?.name || "" } });
    } catch (error) {
      setNotice(`${t.cr_failed} ${error instanceof Error ? error.message : ""}`);
    }
  }

  // The running job, every two seconds; its pictures become versions when it is done.
  useEffect(() => {
    if (!job || !character || !running(job.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await call<{ job: CharacterJob; character: CharacterMeta }>(`/api/characters/${character.id}/jobs/${job.id}`);
        setCharacter(next.character);
        setJob(next.job);
        setNow(Date.now());
        if (next.job.status === "succeeded") {
          if (next.job.kind === "heads" && next.job.made.length > 1) setPicking(next.job.made);
          void loadRoster();
        } else if (!running(next.job.status)) {
          setNotice(`${t.cr_failed} ${next.job.error ?? next.job.status}`);
        }
      } catch (error) {
        setNotice(`${t.cr_failed} ${error instanceof Error ? error.message : ""}`);
        setJob(null);
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [job, character, loadRoster, t.cr_failed]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  // Ctrl+Enter (⌘+Enter on a Mac) runs the step from anywhere on the page, as its button would.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void runRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const round = picking ? versions.head.filter((v) => picking.includes(v.id)) : [];
  // What the swap gets: the sheet, with the back for a performer who turns; without one, the body or your own picture.
  const cast = chosenOf("sheet") ?? front;
  const elapsed = job ? now - Date.parse(job.createdAt) : 0;

  return (
    <div className="app">
      <TopBar t={t} onLang={toggle} area="create" />
      <main className="workspace creator">
        <aside className="panel" aria-label={t.cr_title}>
          <div className="steps" role="tablist" aria-label={t.cr_title}>
            {STEPS.map((s, i) => (
              <button key={s} type="button" role="tab" aria-selected={step === s} className={`step-tab${versions[s].length ? " done" : ""}`} onClick={() => go(s)}>
                <span className="n" aria-hidden>{versions[s].length ? "✓" : i + 1}</span>
                <span>{stepName[s]}</span>
              </button>
            ))}
          </div>
          <div className="panel-body" role="tabpanel" ref={body}>
            {shown.map((group) => group.kind === "image" ? (
              <PictureDrop key={`${step}-${group.id}`} label={word(group, lang)} hint={group.hint ? word(group.hint, lang) : null}
                drop={t.cr_drop} url={pictureUrl} onPick={setPicture} />
            ) : (
              <Control key={`${step}-${group.id}`} group={group} value={picks[step][group.id]} lang={lang} t={t}
                note={step === "sheet" && group.id === "kind" ? word(SHEET_KINDS[String(picks.sheet.kind)] ?? SHEET_KINDS.simple, lang) : undefined}
                onChange={(value) => set(group.id, value)} />
            ))}
          </div>
          <div className="panel-foot">
            {said && (
              <details className="said">
                <summary>{t.cr_prompt}</summary>
                <p>{said}</p>
              </details>
            )}
            <p className="estimate">{needs || eta}</p>
            <button type="button" className="run" disabled={!!needs || busy} onClick={() => void run()}>
              <span>{busy ? t.working : step === "head" && own ? t.cr_run_picture : runLabel[step]}</span><kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-head">
            <div>
              <p className="kicker">{t.cr_step.replace("{n}", String(index + 1))} · {stepName[step]}</p>
              <h1 className="stage-title">{name || character?.name || t.cr_new}</h1>
            </div>
            <div className="stage-side roster" aria-label={t.cr_cast}>
              <span className="cast-label">{t.cr_cast}</span>
              {roster.length === 0 ? <span className="cast-empty">{t.cr_cast_empty}</span> : roster.slice(0, 6).map((c) => (
                <button key={c.id} type="button" className="who" aria-current={character?.id === c.id} title={c.name || t.cr_unnamed} onClick={() => void open(c.id)}>
                  {c.head ? <img src={c.head} alt={c.name || t.cr_unnamed} /> : <span aria-hidden>?</span>}
                </button>
              ))}
              <button type="button" className="who new" title={t.cr_new} onClick={() => void open(null)} aria-label={t.cr_new}>+</button>
            </div>
          </div>

          <div className={`screen canvas${busy ? " working" : ""}`}>
            {versions[step].length > 0 ? (
              <div className="versions" aria-label={t.cr_versions}>
                {versions[step].map((version, i) => (
                  <button key={version.id} type="button" aria-current={current?.id === version.id}
                    aria-label={`${t.cr_versions} ${i + 1}`} onClick={() => { setPicking(null); void choose(step, version.id); }}>
                    <img src={version.url} alt="" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="versions-empty"><b>{t.cr_versions}</b>{t.cr_versions_empty}</p>
            )}
            {step === "head" && round.length > 1 ? (
              <div className="pick">
                <p className="pick-title">{t.cr_pick}<small>{t.cr_pick_hint}</small></p>
                <div className="pick-grid">
                  {round.map((version) => (
                    <button key={version.id} type="button" aria-pressed={current?.id === version.id} onClick={() => { void choose("head", version.id); setPicking(null); }}>
                      <img src={version.url} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            ) : current ? <img className="preview" src={current.url} alt="" /> : (
              <div className="empty">
                <span className="empty-mark" aria-hidden><Mark /></span>
                <h2>{emptyTitle[step]}</h2>
                <p>{needs || emptyBody[step]}</p>
              </div>
            )}
            {busy && job && (
              <div className="progress" role="status">
                <div className="progress-head">
                  <span className="phase">{working[job.kind]}</span>
                  <span className="time">{mmss(elapsed)} {t.elapsed}</span>
                </div>
                <div className="track indeterminate"><div className="fill" /></div>
              </div>
            )}
            {notice && <p className="notice" role="status">{notice}</p>}
            {character && cast && !busy && (
              <Link className="use" href={`/swap?character=${character.id}`}>{t.cr_use} <span aria-hidden>→</span></Link>
            )}
          </div>

          <form className="ask" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea value={ask} rows={1} placeholder={chatPlaceholder[step]} aria-label={chatPlaceholder[step]} disabled={step === "sheet"}
              onChange={(event) => setAsk(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); void send(); } }} />
            <button type="submit" className="btn primary" disabled={!ask.trim() || busy}>{t.cr_send}</button>
            <small>{t.cr_chat_hint}</small>
          </form>
        </section>
      </main>
    </div>
  );
}
