export default function AppLoading() {
  return (
    <div className="grid h-full place-items-center">
      <span
        className="h-7 w-7 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
