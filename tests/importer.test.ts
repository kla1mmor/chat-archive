import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMedia, listChats, messagesAfter, resetDBCache } from '../src/db';
import { findExisting, importChat } from '../src/importer';
import { parseResult } from '../src/parse';
import type { TgMessage } from '../src/types';

function msg(id: number, text: string, extra: Partial<TgMessage> = {}): TgMessage {
  return {
    id,
    type: 'message',
    date: '2024-01-01T10:00:00',
    date_unixtime: String(1704103200 + id),
    from: id % 2 ? 'Аня' : 'Я',
    from_id: id % 2 ? 'user42' : 'user1',
    text,
    ...extra,
  };
}

function exportOf(messages: TgMessage[], files: Record<string, string> = {}) {
  const table = new Map(Object.entries(files).map(([p, c]) => [p, async () => new Blob([c])]));
  return parseResult({ id: 42, name: 'Аня', type: 'personal_chat', messages }, 'ChatExport/', table)[0];
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDBCache();
});

describe('import', () => {
  it('imports a chat with media', async () => {
    const chat = exportOf([msg(1, 'привет', { photo: 'photos/p1.jpg' }), msg(2, 'ок')], {
      'ChatExport/photos/p1.jpg': 'JPEG',
    });
    const r = await importChat(chat, 'new');
    expect(r).toMatchObject({ added: 2, updated: 0, total: 2 });
    const [stored] = await listChats();
    expect(stored).toMatchObject({ tgId: 42, name: 'Аня', messageCount: 2, selfId: 'user1' });
    expect(await (await getMedia(stored.key, 'photos/p1.jpg'))!.text()).toBe('JPEG');
  });

  it('merge does not duplicate messages and adds new ones', async () => {
    const first = await importChat(exportOf([msg(1, 'a'), msg(2, 'b')]), 'new');
    const again = exportOf([msg(1, 'a'), msg(2, 'b (изменено)'), msg(3, 'c')]);
    const existing = await findExisting(again);
    expect(existing.map((c) => c.key)).toEqual([first.chatKey]);

    const r = await importChat(again, 'merge', first.chatKey!);
    expect(r).toMatchObject({ added: 1, updated: 2, total: 3 });
    expect(await listChats()).toHaveLength(1);
    const msgs = await messagesAfter(first.chatKey!, -Infinity, 100);
    expect(msgs.map((m) => m.text)).toEqual(['a', 'b (изменено)', 'c']);
  });

  it('merge keeps messages missing from a partial export', async () => {
    const first = await importChat(exportOf([msg(1, 'a'), msg(2, 'b')]), 'new');
    const r = await importChat(exportOf([msg(3, 'c')]), 'merge', first.chatKey!);
    expect(r.total).toBe(3);
  });

  it('replace drops old messages and media', async () => {
    const first = await importChat(
      exportOf([msg(1, 'a', { photo: 'photos/old.jpg' }), msg(2, 'b')], {
        'ChatExport/photos/old.jpg': 'OLD',
      }),
      'new',
    );
    const r = await importChat(exportOf([msg(5, 'e')]), 'replace', first.chatKey!);
    expect(r).toMatchObject({ added: 1, total: 1 });
    expect(await getMedia(first.chatKey!, 'photos/old.jpg')).toBeUndefined();
    expect(await listChats()).toHaveLength(1);
  });

  it('new creates a separate chat on re-import', async () => {
    await importChat(exportOf([msg(1, 'a')]), 'new');
    await importChat(exportOf([msg(1, 'a')]), 'new');
    const chats = await listChats();
    expect(chats).toHaveLength(2);
    expect(chats.some((c) => c.name.startsWith('Аня (копия'))).toBe(true);
  });

  it('parses a full account export', () => {
    const chats = parseResult(
      {
        personal_information: { user_id: 1 },
        chats: { list: [{ id: 5, name: 'A', type: 'private_group', messages: [msg(1, 'x')] }] },
        left_chats: { list: [{ id: 6, name: 'B', type: 'public_channel', messages: [] }] },
      },
      '',
      new Map(),
    );
    expect(chats.map((c) => [c.tgId, c.selfId])).toEqual([
      [5, 'user1'],
      [6, 'user1'],
    ]);
  });
});
