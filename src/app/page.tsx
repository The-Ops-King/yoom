import { isOwner } from "@/lib/auth";
import { shareBaseUrl } from "@/lib/env";
import { PasswordGate } from "@/components/password-gate";
import { Recorder } from "@/components/recorder";

export default async function Home() {
  if (!(await isOwner())) {
    return <PasswordGate />;
  }

  return <Recorder shareBase={shareBaseUrl()} />;
}
