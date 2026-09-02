"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_FRAME } from "@/lib/recording/settings";
import type { FrameConfig } from "@/lib/recording/types";
import * as ops from "@/lib/editor/edit-ops";
import { FramePicker } from "../frame-picker";
import type { StagingContext } from "../types";

export function FrameSection({ ctx }: { ctx: StagingContext }) {
  const frame: FrameConfig = ctx.edits.frame ?? DEFAULT_FRAME;
  // The picker mints an object URL per upload and nothing else owns it (the
  // recorder hook used to). They are never revoked on replacement: undo can
  // put an earlier `src` back, and the export still has to be able to load
  // it. So they are collected and released together when the section goes
  // away.
  const blobs = useRef<string[]>([]);

  useEffect(() => {
    const created = blobs.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.length = 0;
    };
  }, []);

  return (
    <FramePicker
      frame={frame}
      onChange={(patch) => {
        const src = patch.background?.src;
        if (src?.startsWith("blob:") && !blobs.current.includes(src)) blobs.current.push(src);
        ctx.apply((e) => ops.setFrame(e, { ...frame, ...patch }));
      }}
    />
  );
}
