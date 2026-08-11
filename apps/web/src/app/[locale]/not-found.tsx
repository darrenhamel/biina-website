import Link from 'next/link';

export default function LocaleNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6 text-center">
      <div>
        <p className="text-5xl font-extrabold tracking-tight text-ink">404</p>
        <p className="mt-2 text-ink-soft">This page could not be found.</p>
        <Link href="/en" className="btn-primary mt-5">
          Go home
        </Link>
      </div>
    </div>
  );
}
