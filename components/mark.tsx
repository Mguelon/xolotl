/** Xicalcoliuhqui — the stepped fret of Mesoamerican stonework, as the Xólotl mark. */
export function Mark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M2.5 21.5V8.5h6v6.5h6V2.5h7" />
      <path d="M8.5 21.5h13V9.5" opacity="0.38" />
    </svg>
  );
}
