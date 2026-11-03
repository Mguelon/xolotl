import { useEffect, useState } from "react";
import { STRINGS, type Lang } from "./i18n";

const KEY = "xolotl-lang";

/** The interface language, the same on every page: kept in localStorage, English until the saved choice is read. */
export function useLang() {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  const toggle = () => setLang((current) => {
    const next = current === "en" ? "es" : "en";
    window.localStorage.setItem(KEY, next);
    return next;
  });
  return { lang, t: STRINGS[lang], toggle };
}
