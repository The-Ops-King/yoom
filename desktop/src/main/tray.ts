import { join } from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";
import { showPermissionsDialog } from "./permissions";
import {
  createRecorderWindow,
  getRecorderWindow,
  sendToRecorder,
  toggleRecorderWindow,
} from "./windows";
import { IPC } from "../shared/ipc";

let tray: Tray | null = null;

function iconPath(): string {
  // electron-vite emits main to out/main; the build/ folder ships as an
  // extraResource in packaged builds and sits two levels up in dev.
  const packaged = join(process.resourcesPath ?? "", "build", "trayTemplate.png");
  const dev = join(__dirname, "../../build/trayTemplate.png");
  return app.isPackaged ? packaged : dev;
}

export function createTray(): Tray {
  if (tray) return tray;

  let image = nativeImage.createFromPath(iconPath());
  if (image.isEmpty()) {
    // `new Tray(emptyImage)` throws and takes the whole app down. A packaged
    // build with a missing extraResource, or a dev run before `npm run icons`,
    // should still get a (blank) menu-bar item and a working menu.
    image = nativeImage.createEmpty().resize({ width: 16, height: 16 });
  }
  // A template image is recoloured by macOS for light and dark menu bars.
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Yoom");
  refreshTrayMenu();
  return tray;
}

export function refreshTrayMenu(): void {
  if (!tray) return;
  const hasWindow = !!getRecorderWindow();

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open recorder",
        click: () => {
          createRecorderWindow();
        },
      },
      {
        label: "Toggle recording",
        accelerator: "CommandOrControl+Shift+L",
        enabled: hasWindow,
        click: () => {
          if (getRecorderWindow()) sendToRecorder(IPC.shortcut, "toggle");
          else toggleRecorderWindow();
        },
      },
      { type: "separator" },
      { label: "Permissions…", click: () => void showPermissionsDialog() },
      { type: "separator" },
      { label: "Quit Yoom", accelerator: "Command+Q", click: () => app.quit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
