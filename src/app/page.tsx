"use client";

import { useState } from "react";
import { PasswordGate } from "@/components/password-gate";
import { Recorder } from "@/components/recorder";

export default function Home() {
  const [authed] = useState(false);

  if (!authed) {
    return <PasswordGate />;
  }

  return <Recorder password="" />;
}
