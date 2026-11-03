"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EXAMPLES } from "../lib/examples";
import { useLang } from "../lib/use-lang";
import { TopBar } from "./top-bar";
import { Twin } from "./twin";

/** A real take, the bundled terrace clip with Amara (data/takes/a2cb4adf, 768p, 4 steps): the swap door's showcase.
 *  Its divider starts across her face (31 % from the left), so the swap shows before anyone touches it. */
const SHOWCASE = { original: "/examples/terrace.mp4", swap: "/examples/terrace-amara.mp4" };

/** The way in: the two tools, each shown with its own real work. */
export function Landing() {
  const { t, toggle } = useLang();
  const [hover, setHover] = useState(false);
  const calm = useRef(false);
  useEffect(() => { calm.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);

  return (
    <div className="home">
      <TopBar t={t} onLang={toggle} area="home" />

      <main className="home-main">
        <section className="hero">
          <p className="kicker">{t.home_kicker}</p>
          <h1>{t.home_title}</h1>
          <p className="lede">{t.home_body}</p>
        </section>

        <section className="doors" aria-label="Xólotl">
          <article className="door swap"
            onPointerEnter={() => { if (!calm.current) setHover(true); }}
            onPointerLeave={() => setHover(false)}>
            <div className="door-media">
              <Twin original={SHOWCASE.original} swap={SHOWCASE.swap} showcase active={hover} start={31}
                labels={{ original: t.original, swap: t.swap, play: t.play, pause: t.pause }} />
            </div>
            <div className="door-text">
              <p className="door-kicker">{t.door_swap_kicker}</p>
              <h2><Link href="/swap">{t.door_swap_title}</Link></h2>
              <p>{t.door_swap_body}</p>
              <div className="door-foot">
                <Link className="door-cta" href="/swap">{t.door_swap_cta}<span aria-hidden>→</span></Link>
                <small>{t.door_swap_hint}</small>
              </div>
            </div>
          </article>

          <article className="door create">
            <div className="door-media cast">
              {EXAMPLES.map((example) => (
                <figure key={example.id}>
                  <img src={example.characterPoster} alt={example.name} />
                  <figcaption>{example.name}</figcaption>
                </figure>
              ))}
            </div>
            <div className="door-text">
              <p className="door-kicker">{t.door_create_kicker}<span className="soon">{t.door_create_tag}</span></p>
              <h2><Link href="/create">{t.door_create_title}</Link></h2>
              <p>{t.door_create_body}</p>
              <div className="door-foot">
                <Link className="door-cta quiet" href="/create">{t.door_create_cta}<span aria-hidden>→</span></Link>
                <small>{t.door_create_caption}</small>
              </div>
            </div>
          </article>
        </section>

        <ul className="facts">
          <li>{t.home_fact_weights}</li>
          <li>{t.home_fact_workflow}</li>
          <li>{t.home_fact_local}</li>
        </ul>
      </main>

      <footer className="foot home-foot">
        <span>{t.built_with}</span>
        <span><b>RTX A4000 16 GB</b> · {t.foot_measured}</span>
      </footer>
    </div>
  );
}
