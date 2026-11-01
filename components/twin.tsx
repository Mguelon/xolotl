"use client";

import { useEffect, useRef, useState } from "react";

type Props = { original: string; swap: string; labels: { original: string; swap: string; play: string; pause: string } };

/** Original and swap in one frame. The swap sits on top, clipped at the divider; both videos run in step. */
export function Twin({ original, swap, labels }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [x, setX] = useState(50);
  const [playing, setPlaying] = useState(false);
  const dragging = useRef(false);

  useEffect(() => {
    const lead = b.current, follow = a.current;
    if (!lead || !follow) return;
    const sync = () => { if (Math.abs(follow.currentTime - lead.currentTime) > 0.08) follow.currentTime = lead.currentTime; };
    const onPlay = () => { void follow.play().catch(() => {}); setPlaying(true); };
    const onPause = () => { follow.pause(); setPlaying(false); };
    lead.addEventListener("timeupdate", sync);
    lead.addEventListener("seeked", sync);
    lead.addEventListener("play", onPlay);
    lead.addEventListener("pause", onPause);
    lead.addEventListener("ended", onPause);
    return () => {
      lead.removeEventListener("timeupdate", sync);
      lead.removeEventListener("seeked", sync);
      lead.removeEventListener("play", onPlay);
      lead.removeEventListener("pause", onPause);
      lead.removeEventListener("ended", onPause);
    };
  }, [original, swap]);

  function place(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setX(Math.min(97, Math.max(3, ((clientX - rect.left) / rect.width) * 100)));
  }

  function toggle() {
    const lead = b.current;
    if (!lead) return;
    if (lead.paused) void lead.play().catch(() => {}); else lead.pause();
  }

  return (
    <div
      ref={box}
      className="frame twin"
      style={{ "--x": `${x}%` } as React.CSSProperties}
      onPointerDown={(event) => { dragging.current = true; (event.target as Element).setPointerCapture?.(event.pointerId); place(event.clientX); }}
      onPointerMove={(event) => { if (dragging.current) place(event.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setX((v) => Math.max(3, v - 2));
        if (event.key === "ArrowRight") setX((v) => Math.min(97, v + 2));
        if (event.key === " ") { event.preventDefault(); toggle(); }
      }}
      tabIndex={0}
      role="slider"
      aria-label={`${labels.original} / ${labels.swap}`}
      aria-valuenow={Math.round(x)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <video ref={a} className="original" src={original} muted playsInline preload="auto" />
      <video ref={b} className="swap" src={swap} playsInline preload="auto" />
      <div className="divider" aria-hidden />
      <div className="handle" aria-hidden>‹›</div>
      <span className="tag left">{labels.original}</span>
      <span className="tag right">{labels.swap}</span>
      <button type="button" className="play" onPointerDown={(event) => event.stopPropagation()} onClick={toggle}>
        {playing ? `❚❚ ${labels.pause}` : `▶ ${labels.play}`}
      </button>
    </div>
  );
}
