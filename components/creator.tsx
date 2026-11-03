"use client";

import Link from "next/link";
import { EXAMPLES } from "../lib/examples";
import { useLang } from "../lib/use-lang";
import { Mark } from "./mark";
import { TopBar } from "./top-bar";

/** The character creator's room. Until the creator lands it says so, and points at the characters the swap already has. */
export function Creator() {
  const { t, toggle } = useLang();
  return (
    <div className="home">
      <TopBar t={t} onLang={toggle} area="create" />
      <main className="home-main waiting">
        <div className="empty">
          <span className="empty-mark" aria-hidden><Mark /></span>
          <h2>{t.create_title}</h2>
          <p>{t.create_body}</p>
          <div className="waiting-cast">
            {EXAMPLES.map((example) => (
              <figure key={example.id}><img src={example.characterPoster} alt={example.name} /><figcaption>{example.name}</figcaption></figure>
            ))}
          </div>
          <Link className="door-cta" href="/swap">{t.create_cta}<span aria-hidden>→</span></Link>
        </div>
      </main>
    </div>
  );
}
