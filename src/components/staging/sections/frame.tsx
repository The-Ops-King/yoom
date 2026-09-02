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
      onChange={(patch) => {
        // The picker mints an object URL per upload and nothing else owns it
        // (the recorder hook used to). This section unmounts whenever the
        // rail collapses it, so the screen holds the URLs instead and
        // releases them when staging itself goes away.
        const src = patch.background?.src;
        if (src) ctx.registerBlobUrl(src);
        ctx.apply((e) => ops.setFrame(e, { ...frame, ...patch }));
      }}
    />
  );
}
