/** Channel names used by `picker.ts`. See `app.channels.ts` for why these are duplicated. */
export const IPC = {
  pickerSources: "yoom:picker:sources",
  pickerChoose: "yoom:picker:choose",
  pickerCancel: "yoom:picker:cancel",
} as const;
