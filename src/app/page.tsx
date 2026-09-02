import { isOwner } from "@/lib/auth";
import { PasswordGate } from "@/components/password-gate";
import { Recorder } from "@/components/recorder";

export default async function Home() {
  if (!(await isOwner())) {
    return <PasswordGate />;
  }

  return <Recorder />;
}
