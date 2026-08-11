/**
 * BIINA wordmark. The mark is a simple stacked "brick" glyph — a nod to
 * بنائي / building — rendered in the accent, distinct from generic AI logos.
 */
export function Logo({
  className = '',
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <BrandMark />
      <span className={onDark ? 'text-on-shell' : 'text-ink'}>
        BIINA<span className="text-accent">.ai</span>
      </span>
    </span>
  );
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="rgb(var(--c-accent))" />
      <rect x="8" y="8" width="7" height="7" rx="1.5" fill="rgb(var(--c-on-accent))" />
      <rect x="17" y="8" width="7" height="7" rx="1.5" fill="rgb(var(--c-on-accent))" opacity="0.55" />
      <rect x="8" y="17" width="7" height="7" rx="1.5" fill="rgb(var(--c-on-accent))" opacity="0.55" />
      <rect x="17" y="17" width="7" height="7" rx="1.5" fill="rgb(var(--c-on-accent))" />
    </svg>
  );
}
