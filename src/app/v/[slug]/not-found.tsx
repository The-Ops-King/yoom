export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="space-y-3 text-center">
        <p className="font-mono text-sm text-muted-dim">404</p>
        <h1 className="text-lg font-semibold text-foreground">Video not found</h1>
        <p className="text-sm text-muted">
          This recording may have been removed or the link is invalid.
        </p>
      </div>
    </main>
  );
}
