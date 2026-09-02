"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { YoomLogo } from "./logo";

export function PasswordGate() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.refresh();
      } else {
        setError("Invalid password");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-surface/50 p-8 backdrop-blur">
        <div className="space-y-2 flex flex-col items-center">
          <YoomLogo size="lg" />
          <p className="text-sm text-muted">
            Enter password to start recording
          </p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder-muted-dim outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
          autoFocus
        />
        {error && (
          <p className="text-sm text-red-400/90 text-center">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover shadow-lg shadow-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
