"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Progress } from "@comfyorg/sdk";
import { EXAMPLES, type Example } from "../lib/examples";
import { STRINGS, type Lang } from "../lib/i18n";
import { jobErrorMessage } from "../lib/job-error";
import { DEFAULT_STEPS, MAX_SECONDS, MIN_SECONDS, SIZES, type SwapSize } from "../lib/swap";
import { estimateMinutes } from "../lib/estimates";
import type { TakeMeta } from "../lib/takes";
import type { Stage, StageName } from "../lib/stage";
import { Mark } from "./mark";
import { Twin } from "./twin";

type Output = { id: string; name: string; type: string; url: string };
type Job = {
  id: string; status: string; outputs: Output[]; error?: unknown;
  progress?: Progress | null; queuePosition?: number | null; startedAt?: string | null; completedAt?: string | null; take?: TakeMeta | null;
  gpu?: { utilization: number | null; vramUsedGb: number | null; vramTotalGb: number | null } | null;
  stage?: Stage | null; remainingSeconds?: number | null;
};
type Health = {
  ok: boolean; proxy: { ok: boolean }; comfyui: { ok: boolean; version: string | null; gpu: string | null; vramGb: number | null };
  missingNodes: string[]; missingModels: string[];
};
type Phase = "idle" | "submitting" | "running";

const ACTIVE = new Set(["queued", "running", "pending", "in_progress", "starting", "canceling"]);
const STAGES: StageName[] = ["prepare", "encode", "sample", "finish"];
const CANCELED = new Set(["canceled", "cancelled"]);
const REPO = "https://github.com/Mguelon/xolotl";

function useObjectUrl(file: Blob | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

function videoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    const done = (fn: () => void) => { window.clearTimeout(timer); URL.revokeObjectURL(url); fn(); };
    const timer = window.setTimeout(() => done(() => reject(new Error("timeout"))), 8000);
    probe.preload = "metadata";
    probe.onloadedmetadata = () => done(() => resolve(probe.duration));
    probe.onerror = () => done(() => reject(new Error("unreadable")));
    probe.src = url;
  });
}

async function fetchFile(url: string, name: string, type: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${name}.`);
  return new File([await response.blob()], name, { type });
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Tile(props: {
  kind: "clip" | "character"; label: string; hint: string; accept: string; disabled: boolean;
  preview?: string; caption?: string; onPick: (file: File | undefined) => void; onClear: () => void;
}) {
  const [over, setOver] = useState(false);
  if (props.preview) {
    return (
      <div className={`tile ${props.kind} filled`}>
        {props.kind === "clip" ? <video src={props.preview} muted playsInline /> : <img src={props.preview} alt={props.label} />}
        {props.caption && <span className="tile-caption">{props.caption}</span>}
        <button type="button" className="tile-clear" aria-label="Remove" disabled={props.disabled} onClick={props.onClear}>×</button>
      </div>
    );
  }
  return (
    <label
      className={`tile ${props.kind}${over ? " over" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); props.onPick(event.dataTransfer.files?.[0]); }}
    >
      <input type="file" accept={props.accept} disabled={props.disabled} onChange={(event) => props.onPick(event.target.files?.[0])} />
      <span className="tile-label">{props.label}</span>
      <span className="tile-hint">{props.hint}</span>
    </label>
  );
}

export function AppRunner() {
  const [lang, setLang] = useState<Lang>("en");
  const t = STRINGS[lang];
  const [health, setHealth] = useState<Health | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [character, setCharacter] = useState<File | null>(null);
  const [start, setStart] = useState(0);
  const [seconds, setSeconds] = useState(MIN_SECONDS);
  const [size, setSize] = useState<SwapSize>("480p");
  const [direction, setDirection] = useState("");
  const [seed, setSeed] = useState("");
  const [gestures, setGestures] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const submittedAt = useRef<number | null>(null);
  const videoUrl = useObjectUrl(video);
  const characterUrl = useObjectUrl(character);
  const longest = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, duration - start));
  const busy = phase !== "idle";
  const active = !!job && ACTIVE.has(job.status);

  useEffect(() => {
    const saved = window.localStorage.getItem("xolotl-lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  const toggleLang = () => setLang((current) => { const next = current === "en" ? "es" : "en"; window.localStorage.setItem("xolotl-lang", next); return next; });

  const loadTakes = useCallback(async () => {
    try { const body = await (await fetch("/api/takes")).json() as { takes: TakeMeta[] }; setTakes(body.takes); } catch { /* the strip just stays as it was */ }
  }, []);
  useEffect(() => { void loadTakes(); }, [loadTakes]);

  // A take already running (sent from another tab, another machine on the LAN or the API) shows its progress at once.
  useEffect(() => {
    if (job || phase !== "idle") return;
    const running = takes.find((take) => ACTIVE.has(take.status) && take.status !== "canceling");
    if (running) resume(running);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takes, job, phase]);

  useEffect(() => {
    let stop = false;
    const read = async () => { try { const body = await (await fetch("/api/health")).json() as Health; if (!stop) setHealth(body); } catch { if (!stop) setHealth(null); } };
    void read();
    const timer = window.setInterval(read, 30000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`);
        const next = await response.json() as Job & { error?: string };
        if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : t.err_status);
        setJob(next);
        setError(false);
      } catch (cause) {
        setError(true);
        setMessage(cause instanceof Error ? cause.message : t.err_status);
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [job, t.err_status]);

  useEffect(() => {
    if (!job || ACTIVE.has(job.status)) return;
    setPhase("idle");
    void loadTakes();
    if (job.status === "succeeded") { setError(false); setMessage(""); setSelected(job.id); }
    else if (CANCELED.has(job.status)) { setError(false); setMessage(t.canceled); }
    else { setError(true); setMessage(`${t.failed} ${jobErrorMessage(job.error)}`); }
  }, [job, loadTakes, t.failed, t.canceled]);

  async function chooseVideo(file: File | undefined) {
    setVideo(null); setDuration(0); setJob(null); setSelected(null); setError(false); setMessage("");
    if (!file) return;
    try {
      const length = await videoDuration(file);
      if (!(length >= MIN_SECONDS)) throw new Error(t.err_video);
      setVideo(file); setDuration(length); setStart(0);
      setSeconds(Math.min(MAX_SECONDS, Math.floor(length * 10) / 10));
    } catch { setError(true); setMessage(t.err_video); }
  }

  function chooseCharacter(file: File | undefined) {
    setCharacter(file ?? null); setJob(null); setSelected(null);
  }

  async function chooseExample(example: Example) {
    setError(false); setMessage(t.loading_example);
    try {
      const [clip, person] = await Promise.all([
        fetchFile(example.clip, `${example.id}.mp4`, "video/mp4"),
        fetchFile(example.character, `${example.name.toLowerCase()}.png`, "image/png"),
      ]);
      await chooseVideo(clip);
      chooseCharacter(person);
      setDirection(example.direction);
      setMessage((current) => (current === t.loading_example ? "" : current));
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : t.err_submit); }
  }

  function chooseStart(value: number) {
    setStart(value);
    setSeconds((current) => Math.min(current, Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, duration - value))));
  }

  async function transform() {
    if (!video || !character || busy) return;
    setError(false); setJob(null); setSelected(null); setPhase("submitting"); setMessage(t.phase_uploading);
    submittedAt.current = Date.now();
    const form = new FormData();
    form.set("video", video); form.set("character", character);
    form.set("start", String(start)); form.set("seconds", String(seconds)); form.set("size", size);
    form.set("direction", direction); form.set("seed", seed); form.set("gestures", gestures ? "on" : "off");
    try {
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const next = await response.json() as Job & { error?: string };
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : t.err_submit);
      setJob(next); setPhase("running"); setMessage("");
      void loadTakes();
    } catch (cause) {
      setPhase("idle"); setError(true); setMessage(cause instanceof Error ? cause.message : t.err_submit);
    }
  }

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /** The strip's one-word status in the interface language; unknown states show as the server names them. */
  function statusLabel(status: string): string {
    if (status === "queued" || status === "pending") return t.st_queued;
    if (ACTIVE.has(status)) return t.st_running;
    if (status === "succeeded") return t.st_succeeded;
    if (CANCELED.has(status)) return t.st_canceled;
    if (status === "failed" || status === "error" || status === "expired") return t.st_failed;
    return status;
  }

  /** First click arms the control, the second one deletes the take and everything stored with it. */
  async function removeTake(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    try {
      const response = await fetch(`/api/takes/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || t.err_status);
      }
      if (selected === id) setSelected(null);
      if (job?.id === id) setJob(null);
      void loadTakes();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : t.err_status); }
  }

  /** Keep watching a take that is still in the queue or running, e.g. after a reload. */
  function resume(take: TakeMeta) {
    setError(false); setMessage(""); setSelected(null);
    submittedAt.current = new Date(take.createdAt).getTime();
    setJob({ id: take.id, status: take.status, outputs: [], startedAt: take.startedAt ?? null, take });
    setPhase("running");
  }

  async function cancel() {
    if (!job || !ACTIVE.has(job.status) || job.status === "canceling") return;
    try {
      const response = await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      const next = await response.json() as Job & { error?: string };
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : t.err_status);
      setJob(next);
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : t.err_status); }
  }

  const shown = selected ? takes.find((take) => take.id === selected) ?? job?.take ?? null : null;
  const twin = shown?.status === "succeeded" && shown.result
    ? { original: `/api/takes/${shown.id}/clip.mp4`, swap: `/api/takes/${shown.id}/result.mp4`, id: shown.id }
    : job?.status === "succeeded" && job.outputs[0]
      ? { original: videoUrl ?? "", swap: job.outputs.find((output) => /result/i.test(output.name))?.url ?? job.outputs[0].url, id: job.id }
      : null;

  const elapsedMs = job?.startedAt ? now - new Date(job.startedAt).getTime() : submittedAt.current ? now - submittedAt.current : 0;
  const progress = job?.progress ?? null;
  const stage = active && job?.status === "running" ? job.stage ?? null : null;
  const remaining = stage ? job?.remainingSeconds ?? null : null;
  // From ComfyUI's own step count and the measured timings (lib/estimates.ts): the share of the take behind it.
  const percent = remaining !== null ? Math.min(99, Math.round((elapsedMs / 1000 / (elapsedMs / 1000 + remaining)) * 100))
    : stage?.name === "finish" ? 99
    : progress && typeof progress.value === "number" && (progress.value > 0 || (progress.nodesTotal ?? 0) > 0)
      ? Math.round(Math.min(1, Math.max(0, progress.value)) * 100) : null;
  const stageText = !stage ? null
    : stage.name === "sample" && stage.step !== null
      ? t.stage_sample.replace("{s}", String(stage.step)).replace("{n}", String(stage.steps))
        + (stage.windows > 1 ? t.stage_window.replace("{w}", String(stage.window)).replace("{n}", String(stage.windows)) : "")
      : { prepare: t.stage_prepare, encode: t.stage_encode, sample: t.stage_encode, finish: t.stage_finish }[stage.name];
  const phaseText = !job ? message : job.status === "queued" || job.status === "pending"
    ? `${t.phase_queued}${job.queuePosition ? ` #${job.queuePosition}` : ""}`
    : job.status === "canceling" ? t.phase_canceling
    : ACTIVE.has(job.status) ? stageText ?? t.phase_running : job.status === "succeeded" ? t.phase_done : CANCELED.has(job.status) ? t.canceled : t.failed;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" aria-label="Xólotl"><Mark /><span className="brand-name">Xólotl</span></a>
        <p className="tagline">{t.tagline}</p>
        <div className="top-right">
          <span className={`pill ${health ? (health.ok ? "ok" : "bad") : ""}`} title={health ? [...health.missingNodes, ...health.missingModels].join("\n") : ""}>
            <span className="dot" aria-hidden />
            {!health ? t.health_checking
              : !health.proxy.ok ? t.health_proxy
              : !health.comfyui.ok ? t.health_bad
              : health.ok ? <><strong>{t.health_ok}</strong><span className="gpu">{health.comfyui.gpu ? ` · ${health.comfyui.gpu}${health.comfyui.vramGb ? ` ${health.comfyui.vramGb} GB` : ""}` : ""}</span></>
              : `${health.missingNodes.length + health.missingModels.length} missing`}
          </span>
          <button type="button" className="ghost lang" onClick={toggleLang} aria-label="Language">{t.lang}</button>
          <a className="ghost" href={REPO} target="_blank" rel="noreferrer" aria-label={t.source}><span className="label">{t.source} </span>↗</a>
        </div>
      </header>

      <main className="grid">
        <section className="shot" aria-label={t.shot}>
          <div>
            <h2 className="eyebrow"><b>01</b>{t.shot}</h2>
            <Tile kind="clip" label={t.clip_label} hint={t.clip_hint} accept="video/mp4,video/quicktime" disabled={busy}
              preview={videoUrl} caption={video ? `${video.name} · ${seconds.toFixed(seconds % 1 ? 1 : 0)} s` : undefined}
              onPick={(file) => void chooseVideo(file)} onClear={() => void chooseVideo(undefined)} />
          </div>
          {video && duration > MIN_SECONDS + 0.05 && (
            <div className="part">
              <label><span>{t.start} · <b>{start.toFixed(1)} s</b></span>
                <input type="range" min={0} max={Math.max(0, duration - MIN_SECONDS)} step={0.1} value={start} disabled={busy} onChange={(event) => chooseStart(Number(event.target.value))} /></label>
              <label><span>{t.length} · <b>{seconds.toFixed(1)} s</b></span>
                <input type="range" min={MIN_SECONDS} max={longest} step={0.1} value={seconds} disabled={busy} onChange={(event) => setSeconds(Number(event.target.value))} /></label>
            </div>
          )}
          <Tile kind="character" label={t.character_label} hint={t.character_hint} accept="image/png,image/jpeg,image/webp" disabled={busy}
            preview={characterUrl} caption={character?.name} onPick={chooseCharacter} onClear={() => chooseCharacter(undefined)} />
          <label className="field">
            <span className="eyebrow"><b>02</b>{t.direction_label}</span>
            <textarea value={direction} maxLength={500} disabled={busy} onChange={(event) => setDirection(event.target.value)} placeholder={t.direction_hint} />
          </label>
          <div className="row">
            <div className="seg" role="group" aria-label={t.quality}>
              {(Object.keys(SIZES) as SwapSize[]).map((key) => (
                <button key={key} type="button" aria-pressed={size === key} disabled={busy} onClick={() => setSize(key)}>{key}</button>
              ))}
            </div>
            <label className="seed"><span>{t.seed}</span>
              <input inputMode="numeric" value={seed} disabled={busy} onChange={(event) => setSeed(event.target.value.replace(/\D/g, ""))} placeholder={t.seed_random} /></label>
          </div>
          <label className="switch">
            <input type="checkbox" role="switch" checked={gestures} disabled={busy} onChange={(event) => setGestures(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-text"><b>{t.gestures}</b><small>{gestures ? t.gestures_on : t.gestures_off}</small></span>
          </label>
          {(() => {
            const estimate = estimateMinutes(size, video ? seconds : 5, DEFAULT_STEPS, gestures);
            return estimate ? <p className="estimate">{t.eta_for.replace("{a}", String(estimate[0])).replace("{b}", String(estimate[1]))}</p> : null;
          })()}
          <button type="button" className="run" disabled={!video || !character || busy} onClick={() => void transform()}>{busy ? t.working : t.run}</button>
          <p className="note">{t.note_audio}</p>
        </section>

        <section className="stage">
          {twin ? (
            <Twin key={twin.id} original={twin.original} swap={twin.swap} labels={{ original: t.original, swap: t.swap, play: "play", pause: "pause" }} />
          ) : videoUrl ? (
            <div className="frame"><video src={videoUrl} controls muted playsInline /></div>
          ) : (
            <section className="examples">
              <h2>{t.examples}</h2>
              <p>{t.example_hint}</p>
              <div className="example-grid">
                {EXAMPLES.map((example) => (
                  <button type="button" key={example.id} className="example" disabled={busy} onClick={() => void chooseExample(example)}>
                    <img src={example.poster} alt="" />
                    <img className="who" src={example.characterPoster} alt={example.name} />
                    <span className="name">{example.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {twin && shown && (
            <div className="bar">
              <div className="meta">
                <span><b>{shown.settings.size}</b> · {shown.settings.seconds} s</span>
                {shown.elapsedMs ? <span>{mmss(shown.elapsedMs)} {t.elapsed}</span> : null}
                <span>{t.seed} <b>{shown.settings.seed}</b></span>
              </div>
              <div className="actions">
                <div className="rerun" title={t.workflow_hint}>
                  <a className="btn" href={`/api/takes/${shown.id}/workflow.json`} download>{t.workflow}</a>
                  <a className="btn" href={`/api/takes/${shown.id}/clip.mp4`} download={`xolotl-${shown.id.slice(0, 8)}-clip.mp4`}>{t.clip_file}</a>
                  <a className="btn" href={`/api/takes/${shown.id}/${shown.character}`} download={`xolotl-${shown.id.slice(0, 8)}-${shown.character}`}>{t.character_file}</a>
                  <small>{t.rerun_hint}</small>
                </div>
                <a className="btn primary" href={twin.swap} download={`xolotl-${shown.id.slice(0, 8)}.mp4`}>{t.download}</a>
              </div>
            </div>
          )}

          {(busy || active || (message && !twin)) && (
            <div className={`progress${error ? " error" : ""}`} role="status" aria-live="polite">
              <div className="progress-head">
                <span className="phase">{error ? message || t.failed : phaseText || message}</span>
                {(active || busy) && <span className="time">{mmss(elapsedMs)}</span>}
                {job && ACTIVE.has(job.status) && job.status !== "canceling" && <button type="button" className="cancel" onClick={() => void cancel()}>{t.cancel}</button>}
              </div>
              {(active || busy) && !error && (
                <div className={`track${percent === null ? " indeterminate" : ""}`}><div className="fill" style={{ "--p": `${percent ?? 0}%` } as React.CSSProperties} /></div>
              )}
              {stage && !error && (
                <ol className="stages">
                  {STAGES.map((name, index) => {
                    const at = STAGES.indexOf(stage.name);
                    return <li key={name} className={index < at ? "done" : undefined} aria-current={index === at ? "step" : undefined}>
                      {{ prepare: t.step_prepare, encode: t.step_encode, sample: t.step_sample, finish: t.step_finish }[name]}
                    </li>;
                  })}
                </ol>
              )}
              <div className="detail">
                {percent !== null && <span><b>{percent}%</b></span>}
                {progress?.currentNodeClass && <span>{progress.currentNodeClass}</span>}
                {progress?.nodesDone != null && progress.nodesTotal != null && <span>{progress.nodesDone}/{progress.nodesTotal} nodes</span>}
                {!stage && progress?.step != null && progress.steps != null && <span>step {progress.step}/{progress.steps}</span>}
                {job?.gpu && job.gpu.utilization != null && <span>GPU <b>{job.gpu.utilization}%</b>{job.gpu.vramUsedGb != null ? ` · ${job.gpu.vramUsedGb}${job.gpu.vramTotalGb ? ` / ${job.gpu.vramTotalGb}` : ""} GB` : ""}</span>}
                {(active || busy) && !error && (remaining !== null || stage?.name === "finish") && (
                  <span><b>{remaining !== null && remaining >= 60 ? t.left_min.replace("{m}", String(Math.round(remaining / 60))) : t.left_soon}</b></span>
                )}
                {(active || busy) && !error && remaining === null && stage?.name !== "finish" && (() => {
                  const settings = job?.take?.settings;
                  const estimate = settings ? estimateMinutes(settings.size as SwapSize, settings.seconds, settings.steps ?? DEFAULT_STEPS, settings.gestures ?? false) : estimateMinutes(size, seconds);
                  return <span>{estimate ? t.eta_for.replace("{a}", String(estimate[0])).replace("{b}", String(estimate[1])) : t.eta_hint}</span>;
                })()}
              </div>
            </div>
          )}

          <div className="takes">
            <h2 className="eyebrow"><b>03</b>{t.takes}</h2>
            {takes.length === 0 ? <p className="takes-empty">{t.takes_empty}</p> : (
              <div className="take-list">
                {takes.map((take) => (
                  <div className="take-wrap" key={take.id}>
                    <button type="button" className="take" aria-current={selected === take.id} onClick={() => { if (take.status === "succeeded") setSelected(take.id); else if (ACTIVE.has(take.status) && !busy) resume(take); }}>
                      <img src={`/api/takes/${take.id}/${take.character}`} alt="" />
                      <span>
                        <span className="t1"><span>{take.settings.size} · {take.settings.seconds} s</span><span className={`st ${take.status === "succeeded" ? "ok" : ACTIVE.has(take.status) ? "live" : CANCELED.has(take.status) ? "" : "bad"}`} aria-hidden /></span>
                        <span className="t2">{take.elapsedMs ? mmss(take.elapsedMs) : take.status === "running" && take.startedAt ? mmss(now - Date.parse(take.startedAt)) : statusLabel(take.status)} · {new Date(take.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                    </button>
                    {!(ACTIVE.has(take.status) && !CANCELED.has(take.status)) && (
                      <button type="button" className={`take-x${confirmDelete === take.id ? " armed" : ""}`} aria-label={t.delete_label} onClick={() => void removeTake(take.id)} onBlur={() => setConfirmDelete((current) => (current === take.id ? null : current))}>
                        {confirmDelete === take.id ? t.delete_confirm : "×"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>{t.built_with}</span>
        <span><b>RTX A4000 16 GB</b> · {t.foot_measured}</span>
      </footer>
    </div>
  );
}
