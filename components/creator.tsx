"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  GROUPS, SECONDS, SHEET_KINDS, STEPS, describeBody, headCount, headPrompt, initialPicks, word,
  type Group, type Picks, type Step, type Value,
} from "../lib/character";
import type { Lang, Strings } from "../lib/i18n";
import { useLang } from "../lib/use-lang";
import { Mark } from "./mark";
import { TopBar } from "./top-bar";

type Version = { id: string; url: string };

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
 * that step's picture, and the page never moves to another step by itself.
 */
export function Creator() {
  const { lang, t, toggle } = useLang();
  const [step, setStep] = useState<Step>("head");
  const [picks, setPicks] = useState<Record<Step, Picks>>(() => ({ head: initialPicks("head"), body: initialPicks("body"), sheet: initialPicks("sheet") }));
  // Each step's versions and the one chosen. Generation fills them once it is wired to ComfyUI; a picture of your own is
  // the head's first version as it is.
  const [versions, setVersions] = useState<Record<Step, Version[]>>({ head: [], body: [], sheet: [] });
  const [picture, setPicture] = useState<File | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) { setPictureUrl(null); return; }
    const url = URL.createObjectURL(picture);
    setPictureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);
  const [chosen, setChosen] = useState<Record<Step, string | null>>({ head: null, body: null, sheet: null });
  const [ask, setAsk] = useState("");
  const [notice, setNotice] = useState("");

  const index = STEPS.indexOf(step);
  const name = typeof picks.sheet.name === "string" ? picks.sheet.name.trim() : "";
  const stepName: Record<Step, string> = { head: t.cr_step_head, body: t.cr_step_body, sheet: t.cr_step_sheet };
  const runLabel: Record<Step, string> = { head: t.cr_run_head, body: t.cr_run_body, sheet: t.cr_run_sheet };
  const emptyTitle: Record<Step, string> = { head: t.cr_empty_head, body: t.cr_empty_body, sheet: t.cr_empty_sheet };
  const emptyBody: Record<Step, string> = { head: t.cr_empty_head_body, body: t.cr_empty_body_body, sheet: t.cr_empty_sheet_body };
  const chatPlaceholder: Record<Step, string> = { head: t.cr_chat_head, body: t.cr_chat_body, sheet: t.cr_chat_sheet };
  const the: Record<Step, string> = { head: t.cr_the_head, body: t.cr_the_body, sheet: t.cr_the_sheet };

  const current = versions[step].find((v) => v.id === chosen[step]) ?? versions[step].at(-1) ?? null;
  const own = picks.head.start === "picture";
  const needs = step === "head" && own && !picture ? t.cr_need_picture
    : step === "body" && versions.head.length === 0 ? t.cr_needs_head
    : step === "sheet" && versions.body.length === 0 ? t.cr_needs_body : "";
  const heads = headCount(picks.head);
  const eta = step === "head" && own ? t.cr_eta_picture
    : step === "head"
    ? t.cr_eta_head.replace("{n}", String(heads)).replace("{m}", String(Math.max(1, Math.round((SECONDS.headLoad + heads * SECONDS.head) / 60))))
    : t.cr_eta_minutes.replace("{m}", String(Math.round((step === "body" ? SECONDS.body : picks.sheet.kind === "full" ? SECONDS.sheetFull : SECONDS.sheetSimple) / 60)));
  const said = step === "head" ? headPrompt(picks.head) : step === "body" ? describeBody(picks.body, picks.head) : "";
  const shown = GROUPS[step].filter((group) => !group.when || group.when(picks[step]));

  const set = (id: string, value: Value) => setPicks((all) => ({ ...all, [step]: { ...all[step], [id]: value } }));
  // Each step opens at the top of its buttons, wherever the last one was scrolled to.
  const body = useRef<HTMLDivElement>(null);
  const go = (next: Step) => { setStep(next); setNotice(""); body.current?.scrollTo({ top: 0 }); };

  function run() {
    if (needs) return;
    if (step === "head" && own && pictureUrl) {
      // Your own character is the head as it is: the body and the sheet are drawn from it, in its style.
      const version = { id: `own-${Date.now()}`, url: pictureUrl };
      setVersions((all) => ({ ...all, head: [...all.head, version] }));
      setChosen((all) => ({ ...all, head: version.id }));
      setNotice("");
      return;
    }
    setNotice(t.cr_not_wired);
  }
  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!ask.trim()) return;
    setNotice(current ? t.cr_not_wired : t.cr_need_image.replace("{step}", the[step]));
  }

  // Ctrl+Enter (⌘+Enter on a Mac) runs the step from anywhere on the page, as its button would.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); runRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            <button type="button" className="run" disabled={!!needs} onClick={run}>
              <span>{step === "head" && own ? t.cr_run_picture : runLabel[step]}</span><kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-head">
            <div>
              <p className="kicker">{t.cr_step.replace("{n}", String(index + 1))} · {stepName[step]}</p>
              <h1 className="stage-title">{name || t.cr_new}</h1>
            </div>
            <div className="stage-side roster">
              <span className="cast-label">{t.cr_cast}</span>
              <span className="cast-empty">{t.cr_cast_empty}</span>
            </div>
          </div>

          <div className="screen canvas">
            {versions[step].length > 0 ? (
              <div className="versions" aria-label={t.cr_versions}>
                {versions[step].map((version, i) => (
                  <button key={version.id} type="button" aria-current={current?.id === version.id}
                    aria-label={`${t.cr_versions} ${i + 1}`} onClick={() => setChosen((all) => ({ ...all, [step]: version.id }))}>
                    <img src={version.url} alt="" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="versions-empty"><b>{t.cr_versions}</b>{t.cr_versions_empty}</p>
            )}
            {current ? <img className="preview" src={current.url} alt="" /> : (
              <div className="empty">
                <span className="empty-mark" aria-hidden><Mark /></span>
                <h2>{emptyTitle[step]}</h2>
                <p>{needs || emptyBody[step]}</p>
              </div>
            )}
            {notice && <p className="notice" role="status">{notice}</p>}
          </div>

          <form className="ask" onSubmit={send}>
            <textarea value={ask} rows={1} placeholder={chatPlaceholder[step]} aria-label={chatPlaceholder[step]}
              onChange={(event) => setAsk(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); send(); } }} />
            <button type="submit" className="btn primary" disabled={!ask.trim()}>{t.cr_send}</button>
            <small>{t.cr_chat_hint}</small>
          </form>
        </section>
      </main>
    </div>
  );
}
