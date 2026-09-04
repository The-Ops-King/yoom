import Link from "next/link";

export default function VideoNotFound() {
  return (
    <main className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-lg font-semibold text-foreground">Recording not found</h1>
      <p className="text-sm text-muted">
        It may have been deleted, or the link is wrong.
      </p>
      <Link href="/library" className="text-sm text-accent-text hover:underline">
        Back to the library
      </Link>
    </main>
  );
}
