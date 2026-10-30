import { readFileSync } from 'node:fs';
import { BlobReader, BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { encodeWav, oggToWav } from '../src/audio';
import { readExport } from '../src/parse';

configure({ useWebWorkers: false });

describe('zip import', () => {
  it('reads a nested export from a zip, loading media lazily', async () => {
    const zw = new ZipWriter(new BlobWriter('application/zip'));
    const result = {
      id: 7,
      name: 'Группа',
      type: 'private_group',
      messages: [{ id: 1, type: 'message', date: '2024-01-01T00:00:00', text: '', photo: 'photos/a.jpg' }],
    };
    await zw.add('ChatExport_2024/result.json', new TextReader(JSON.stringify(result)));
    await zw.add('ChatExport_2024/photos/a.jpg', new BlobReader(new Blob(['IMG'])));
    const zipBlob = await zw.close();
    // No .zip extension: detected by its signature, as with some Android pickers.
    const [chat] = await readExport([new File([zipBlob], 'document')]);
    expect(chat).toMatchObject({ tgId: 7, name: 'Группа' });
    expect(await (await chat.media.get('photos/a.jpg')!()).text()).toBe('IMG');
  });
});

describe('audio', () => {
  it('writes a valid WAV header', async () => {
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5])], 48000);
    const v = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(44 + 6);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff - 0.5));
  });

  it('decodes Ogg/Opus voice messages to WAV', async () => {
    const ogg = new Blob([readFileSync(new URL('./fixtures/voice.ogg', import.meta.url))]);
    const wav = await oggToWav(ogg);
    expect(wav.type).toBe('audio/wav');
    // 3 seconds at 48 kHz, 16-bit mono ≈ 288 KB
    expect(wav.size).toBeGreaterThan(250_000);
  });
});
