import { contextBridge, ipcRenderer } from "electron";
import { IPC, type PickerPayload } from "../shared/ipc";

contextBridge.exposeInMainWorld("__yoomPicker", {
  onSources(cb: (payload: PickerPayload) => void): void {
    ipcRenderer.on(IPC.pickerSources, (_e, payload: PickerPayload) => cb(payload));
  },
  choose(id: string): void {
    ipcRenderer.send(IPC.pickerChoose, { id });
  },
  cancel(): void {
    ipcRenderer.send(IPC.pickerCancel);
  },
});
