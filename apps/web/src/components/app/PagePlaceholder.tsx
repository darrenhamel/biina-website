import { Icon } from '@/components/Icon';

/** Feature-disabled area placeholder — keeps the IA in place for future phases. */
export function PagePlaceholder({
  icon,
  title,
  comingSoonLabel,
}: {
  icon: string;
  title: string;
  comingSoonLabel: string;
}) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Icon name={icon} width={26} height={26} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">{title}</h1>
        <span className="mt-3 inline-block rounded-full border border-line bg-paper-raised px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
          {comingSoonLabel}
        </span>
      </div>
    </div>
  );
}
