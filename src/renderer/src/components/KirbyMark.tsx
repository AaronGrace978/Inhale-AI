export function KirbyMark({ size = 46 }: { size?: number }) {
  return (
    <svg className="kirby-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="18" cy="56" rx="7" ry="3.4" fill="#ff5f98" />
      <ellipse cx="46" cy="56" rx="7" ry="3.4" fill="#ff5f98" />
      <ellipse cx="32" cy="58" rx="8" ry="3" fill="#ffd0e4" />
      <path d="M10 32c3.5 1.4 4.2 7.2.2 9.2" stroke="#ff8fbe" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M54 32c-3.5 1.4-4.2 7.2-.2 9.2" stroke="#ff8fbe" strokeWidth="5" strokeLinecap="round" fill="none" />
      <circle cx="32" cy="30" r="22" fill="#ff7eb6" />
      <circle cx="32" cy="30" r="22" fill="url(#kirby-shine)" />
      <ellipse cx="17" cy="34" rx="4.6" ry="2.5" fill="#ffb3d4" />
      <ellipse cx="47" cy="34" rx="4.6" ry="2.5" fill="#ffb3d4" />
      <ellipse cx="25" cy="28" rx="3.1" ry="5.4" fill="#2a1522" />
      <ellipse cx="39" cy="28" rx="3.1" ry="5.4" fill="#2a1522" />
      <ellipse cx="26.1" cy="26.2" rx="1.05" ry="1.5" fill="#fff8fb" />
      <ellipse cx="40.1" cy="26.2" rx="1.05" ry="1.5" fill="#fff8fb" />
      <path d="M29 36.5c1.5 1.8 4.5 1.8 6 0" stroke="#c43770" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <defs>
        <radialGradient id="kirby-shine" cx="32%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="46%" stopColor="#ff7eb6" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}
