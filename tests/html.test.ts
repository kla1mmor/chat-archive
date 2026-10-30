// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHtmlDate, parseHtmlPages } from '../src/parseHtml';
import { parseTable } from '../src/parse';

const html = readFileSync(join(__dirname, 'fixtures/messages.html'), 'utf8');

describe('HTML export', () => {
  it('parses dates with a UTC offset', () => {
    expect(parseHtmlDate('01.09.2026 09:15:00 UTC+05:00')).toBe(Date.UTC(2026, 8, 1, 4, 15) / 1000);
  });

  it('parses messages like the JSON export', () => {
    const chat = parseHtmlPages([html]);
    expect(chat.name).toBe('Аня Петрова');
    expect(chat.type).toBe('personal_chat');
    const byId = Object.fromEntries(chat.messages.map((m) => [m.id, m]));
    expect(Object.keys(byId).map(Number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);

    expect(byId[10].from).toBe('Аня Петрова');
    expect(byId[10].text_entities).toEqual([
      { type: 'plain', text: 'Привет! ' },
      { type: 'bold', text: 'Жирный' },
      { type: 'plain', text: ' и ' },
      { type: 'link', text: 'ссылка', href: undefined },
      { type: 'plain', text: '\nвторая строка ' },
      { type: 'spoiler', text: 'тайна' },
    ].map((e) => (e.type === 'link' ? { type: 'text_link', text: 'ссылка', href: 'https://example.com' } : e)));
    expect(byId[10].reactions).toEqual([{ type: 'emoji', count: 2, emoji: '❤' }]);

    // "joined" messages inherit the previous sender
    expect(byId[11]).toMatchObject({ from: 'Аня Петрова', photo: 'photos/photo_1@01-09-2026_09-16-00.jpg', width: 260 });
    expect(byId[12]).toMatchObject({
      from: 'Алихан',
      reply_to_message_id: 10,
      media_type: 'voice_message',
      duration_seconds: 7,
    });
    expect(byId[13]).toMatchObject({ from: 'Алихан', forwarded_from: 'Новости', text: 'Пересланный текст' });
    expect(byId[14]).toMatchObject({ type: 'service', text: 'Аня Петрова pinned this message' });
    expect(byId[15]).toMatchObject({ media_type: 'sticker', file: 'stickers/sticker.webp' });
    expect(byId[16].photo).toMatch(/^\(File not included/);
    expect(byId[17]).toMatchObject({ file: 'files/отчёт.pdf', file_name: 'отчёт.pdf', text: 'Документ' });
    expect(byId[17].file_size).toBe(1572864);
  });

  it('reads multi-page HTML exports from a folder', async () => {
    const page2 = html.replace(/id="message(\d+)"/g, (_, n) => `id="message${Number(n) + 100}"`);
    // jsdom's Blob has no .text(), so files are stubbed.
    const file = (s: string) => async () => ({ text: async () => s }) as unknown as Blob;
    const table = new Map([
      ['ChatExport/messages2.html', file(page2)],
      ['ChatExport/messages.html', file(html)],
      ['ChatExport/photos/photo_1@01-09-2026_09-16-00.jpg', file('IMG')],
    ]);
    const [chat] = await parseTable(table);
    expect(chat.messages).toHaveLength(16);
    expect(chat.messages[0].id).toBe(10);
    expect(chat.messages[15].id).toBe(117);
    expect(chat.tgId).toBeUndefined();
    expect([...chat.media.keys()]).toEqual(['photos/photo_1@01-09-2026_09-16-00.jpg']);
  });
});
