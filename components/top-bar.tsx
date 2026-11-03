"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { counted, type Strings } from "../lib/i18n";
import { Mark } from "./mark";

const REPO = "https://github.com/Mguelon/xolotl";

type Health = {
  ok: boolean; proxy: { ok: boolean }; comfyui: { ok: boolean; version: string | null; gpu: string | null; vramGb: number | null };
  missingNodes: string[]; missingModels: string[]; notes: string[];
};

export type Area = "home" | "swap" | "create";

/** The bar on every page: the mark back home, the two tools, whether the GPU is ready, the language and the source. */
export function TopBar({ t, onLang, area }: { t: Strings; onLang: () => void; area: Area }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let stop = false;
    const read = async () => {
      try { const body = await (await fetch("/api/health")).json() as Health; if (!stop) setHealth(body); }
      catch { if (!stop) setHealth(null); }
    };
    void read();
    const timer = window.setInterval(read, 30000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);

  return (
    <header className="top">
      <Link className="brand" href="/" aria-label="Xólotl"><Mark /><span className="brand-name">Xólotl</span></Link>
      <nav className="nav" aria-label="Xólotl">
        <Link href="/swap" aria-current={area === "swap" ? "page" : undefined}>{t.nav_swap}</Link>
        <Link href="/create" aria-current={area === "create" ? "page" : undefined}>{t.nav_create}</Link>
      </nav>
      <div className="top-right">
        <span className={`pill ${health ? (health.ok ? "ok" : "bad") : ""}`} title={health ? [...health.missingNodes, ...health.missingModels, ...health.notes].join("\n") : ""}>
          <span className="dot" aria-hidden />
          {!health ? t.health_checking
            : !health.proxy.ok ? t.health_proxy
            : !health.comfyui.ok ? t.health_bad
            : health.ok ? <><strong>{t.health_ok}</strong>{health.notes.length > 0 ? ` · ${counted(health.notes.length, t.health_adapted_one, t.health_adapted_many)}` : ""}<span className="gpu">{health.comfyui.gpu ? ` · ${health.comfyui.gpu}${health.comfyui.vramGb ? ` ${health.comfyui.vramGb} GB` : ""}` : ""}</span></>
            : counted(health.missingNodes.length + health.missingModels.length, t.health_missing_one, t.health_missing_many)}
        </span>
        <button type="button" className="ghost lang" onClick={onLang} aria-label="Language">{t.lang}</button>
        <a className="ghost" href={REPO} target="_blank" rel="noreferrer" aria-label={t.source}><span className="label">{t.source} </span>↗</a>
      </div>
    </header>
  );
}
