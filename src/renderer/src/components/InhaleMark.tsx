export function InhaleMark({ size = 46 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="22" fill="none" stroke="#ff7eb6" strokeWidth="6" />
      <circle cx="32" cy="32" r="10" fill="#ff7eb6" />
      <circle cx="32" cy="32" r="4" fill="#fff5f9" />
    </svg>
  )
}
