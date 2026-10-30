import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { BUILD, UPDATE_BASE } from './version';

/**
 * Over-the-air updates of the web part of the app. The Windows/Android/iOS
 * shells only host this bundle, so a new build can be swapped in without
 * reinstalling. If a new build needs native plugins the installed shell lacks,
 * the user is asked to download the app again instead.
 */

export type UpdateState =
  | { kind: 'none' }
  | { kind: 'downloading'; build: number }
  | { kind: 'ready'; build: number }
  | { kind: 'reinstall'; build: number };

interface RemoteVersion {
  build: number;
  plugins: string[];
}

interface DesktopBridge {
  getText(url: string): Promise<string>;
  installUpdate(url: string, build: number): Promise<void>;
  restart(): void;
}

const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;

export const canSelfUpdate = () => !!desktop || Capacitor.isNativePlatform();

async function fetchRemote(): Promise<RemoteVersion | null> {
  const url = `${UPDATE_BASE}version.json?t=${Date.now()}`;
  try {
    if (desktop) return JSON.parse(await desktop.getText(url));
    // Native HTTP: github.com download links don't send CORS headers.
    const res = await CapacitorHttp.get({ url, responseType: 'json' });
    if (res.status !== 200) return null;
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch (e) {
    console.warn('Update check failed', e);
    return null;
  }
}

/** Must run on every native start, or the updater rolls back to the previous bundle. */
export async function markAppReady() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('CapacitorUpdater')) return;
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  await CapacitorUpdater.notifyAppReady().catch(() => {});
}

export async function checkForUpdate(onState: (s: UpdateState) => void) {
  if (!canSelfUpdate()) return;
  const remote = await fetchRemote();
  if (!remote || !(remote.build > BUILD)) return;

  if (desktop) {
    onState({ kind: 'downloading', build: remote.build });
    try {
      await desktop.installUpdate(`${UPDATE_BASE}web-bundle.zip`, remote.build);
      onState({ kind: 'ready', build: remote.build });
    } catch (e) {
      console.warn('Update download failed', e);
      onState({ kind: 'none' });
    }
    return;
  }

  const missing = remote.plugins.filter((p) => !Capacitor.isPluginAvailable(p));
  if (missing.length) {
    onState({ kind: 'reinstall', build: remote.build });
    return;
  }
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  onState({ kind: 'downloading', build: remote.build });
  try {
    const bundle = await CapacitorUpdater.download({
      url: `${UPDATE_BASE}web-bundle.zip?b=${remote.build}`,
      version: String(remote.build),
    });
    await CapacitorUpdater.next({ id: bundle.id });
    onState({ kind: 'ready', build: remote.build });
  } catch (e) {
    console.warn('Update download failed', e);
    onState({ kind: 'none' });
  }
}

export async function restartIntoUpdate() {
  if (desktop) return desktop.restart();
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  await CapacitorUpdater.reload();
}
