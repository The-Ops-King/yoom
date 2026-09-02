"use client";

import { DEFAULT_FRAME } from "@/lib/recording/settings";
import type { FrameConfig } from "@/lib/recording/types";
import * as ops from "@/lib/editor/edit-ops";
import { FramePicker } from "../frame-picker";
import type { StagingContext } from "../types";

export function FrameSection({ ctx }: { ctx: StagingContext }) {
  const frame: FrameConfig = ctx.edits.frame ?? DEFAULT_FRAME;
  return (
    <FramePicker
      frame={frame}
      onChange={(patch) => ctx.apply((e) => ops.setFrame(e, { ...frame, ...patch }))}
    />
  );
}
