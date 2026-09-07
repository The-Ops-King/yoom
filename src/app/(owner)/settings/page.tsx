import type { Metadata } from "next";
import { isOwner } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { PasswordGate } from "@/components/password-gate";
import { AlertToggles } from "@/components/settings/alert-toggles";
import { FactoryReset } from "@/components/settings/factory-reset";

export const metadata: Metadata = { title: "Settings · Yoom" };

export default async function SettingsPage() {
  // Page-level gate: the (owner) layout alone does not stop this segment from
  // being rendered into the RSC payload. Refuse before any database read.
  if (!(await isOwner())) return <PasswordGate />;

  const settings = await getSettings();

  return (
    <main className="max-w-xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          View alerts are sent to <code>ALERT_TO_EMAIL</code> via Resend.
        </p>
      </div>
      <AlertToggles settings={settings} />
      <FactoryReset />
    </main>
  );
}
