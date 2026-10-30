/** True when the browser can play Ogg/Opus itself (Safari on iOS often can't). */
export function canPlayOggOpus(): boolean {
  if (typeof document === 'undefined') return false;
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs="opus"') !== '' || a.canPlayType('audio/ogg') !== '';
}

export function isOgg(path?: string, mime?: string) {
  return /\.(ogg|oga|opus)$/i.test(path ?? '') || /ogg|opus/i.test(mime ?? '');
}

/** Encodes PCM channels as a 16-bit WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numCh = Math.max(1, channels.length);
  const len = channels[0]?.length ?? 0;
  const dataBytes = len * numCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Decodes an Ogg/Opus blob to WAV with a WebAssembly decoder (loaded on demand). */
export async function oggToWav(blob: Blob): Promise<Blob> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder');
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = await decoder.decodeFile(new Uint8Array(await blob.arrayBuffer()));
    return encodeWav(channelData, sampleRate);
  } finally {
    decoder.free();
  }
}
