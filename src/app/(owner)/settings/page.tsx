import type { Metadata } from "next";
import { getSettings } from "@/lib/db";
import { AlertToggles } from "@/components/settings/alert-toggles";

export const metadata: Metadata = { title: "Settings · Yoom" };

export default async function SettingsPage() {
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
    </main>
  );
}
