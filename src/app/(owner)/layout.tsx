import Link from "next/link";
import { isOwner } from "@/lib/auth";
import { PasswordGate } from "@/components/password-gate";
import { YoomLogo } from "@/components/logo";

/**
 * Everything under `(owner)` is private. The group adds no URL segment, so the
 * routes stay `/library` and `/settings`.
 *
 * Rendering the gate (rather than redirecting to `/`) matches `src/app/page.tsx`
 * and keeps the URL intact, so signing in lands the owner back where they were.
 */
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isOwner())) {
    return <PasswordGate />;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col gap-6 px-[clamp(20px,5vw,72px)] py-6">
      <header className="flex items-center justify-between border-b border-border-subtle pb-4">
        <Link href="/" aria-label="Yoom home">
          <YoomLogo size="sm" />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Record
          </Link>
          <Link
            href="/library"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Library
          </Link>
          <Link
            href="/settings"
            className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            Settings
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
