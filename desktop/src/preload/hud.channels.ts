/** Channel names used by `hud.ts`. See `app.channels.ts` for why these are duplicated. */
export const IPC = {
  hudApply: "yoom:hud:apply",
  hudAction: "yoom:hud:action",
  hudInteract: "yoom:hud:interact",
  hudDragStart: "yoom:hud:drag-start",
  hudDragMove: "yoom:hud:drag-move",
  hudDragEnd: "yoom:hud:drag-end",
} as const;
