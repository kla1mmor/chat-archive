import { Capacitor } from '@capacitor/core';

export const isNativeApp = () => Capacitor.isNativePlatform();

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Hands a file to the OS. In the Android/iOS apps a plain download link does
 * nothing, so the file is written to the cache and opened in the share sheet
 * ("Save to Files", messengers, etc.). In browsers and on Windows it downloads.
 */
export async function saveFile(blob: Blob, name: string) {
  if (isNativeApp()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const safe = name.replace(/[\\/:*?"<>|]/g, '_') || 'file';
    const { uri } = await Filesystem.writeFile({
      path: `shared/${Date.now()}-${safe}`,
      data: await toBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: safe, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
