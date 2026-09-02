/** Channel names used by `bubble.ts`. See `app.channels.ts` for why these are duplicated. */
export const IPC = {
  bubbleApply: "yoom:bubble:apply",
  bubbleCamera: "yoom:bubble:camera",
  bubbleRelease: "yoom:bubble:release",
  bubbleRequestHide: "yoom:bubble:request-hide",
  bubbleCycleShape: "yoom:bubble:cycle-shape",
} as const;
