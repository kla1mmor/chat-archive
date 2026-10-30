import { chatRange, getDB, findChatsByTgId, plainText } from './db';
import type { ImportMode, ImportResult, ParsedChat, StoredChat, StoredMessage } from './types';

const BATCH = 1000;

export type Progress = (done: number, total: number, stage: 'messages' | 'media') => void;

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stored chats that a parsed chat is a re-import of. */
export async function findExisting(chat: ParsedChat): Promise<StoredChat[]> {
  if (chat.tgId !== undefined) return findChatsByTgId(chat.tgId);
  const db = await getDB();
  return (await db.getAll('chats')).filter(
    (c) => c.tgId === undefined && c.name === chat.name && c.type === chat.type,
  );
}

function guessSelfId(chat: ParsedChat): string | undefined {
  if (chat.selfId) return chat.selfId;
  if (chat.type === 'saved_messages') return chat.messages.find((m) => m.from_id)?.from_id;
  if ((chat.type === 'personal_chat' || chat.type === 'bot_chat') && chat.tgId !== undefined) {
    const peer = `user${chat.tgId}`;
    return chat.messages.find((m) => m.from_id && m.from_id !== peer)?.from_id;
  }
  return undefined;
}

/**
 * Writes a parsed chat to the database.
 * - merge:   upsert by Telegram message id into `targetKey`; old messages not in the export stay.
 * - replace: wipe `targetKey`'s messages and media, then write the export.
 * - new:     always a separate chat, even if the same chat was imported before.
 */
export async function importChat(
  chat: ParsedChat,
  mode: ImportMode,
  targetKey?: string,
  onProgress?: Progress,
): Promise<ImportResult> {
  if (mode === 'skip') return { chatKey: null, mode, added: 0, updated: 0, total: 0 };
  const db = await getDB();
  const now = Date.now();

  let stored: StoredChat | undefined;
  if (mode !== 'new') {
    if (!targetKey) throw new Error(`Mode "${mode}" needs a target chat`);
    stored = await db.get('chats', targetKey);
    if (!stored) throw new Error('Target chat not found');
  }

  const key = stored?.key ?? newKey();
  if (mode === 'replace') {
    const tx = db.transaction(['messages', 'media'], 'readwrite');
    await Promise.all([
      tx.objectStore('messages').delete(chatRange(key)),
      tx.objectStore('media').delete(IDBKeyRange.bound([key, ''], [key, '￿'])),
      tx.done,
    ]);
  }

  const existingIds = new Set<number>();
  if (mode === 'merge') {
    for (const k of await db.getAllKeys('messages', chatRange(key))) existingIds.add(k[1]);
  }

  let added = 0;
  let updated = 0;
  const total = chat.messages.length;
  for (let i = 0; i < total; i += BATCH) {
    const tx = db.transaction('messages', 'readwrite');
    for (const m of chat.messages.slice(i, i + BATCH)) {
      if (existingIds.has(m.id)) updated++;
      else added++;
      tx.store.put({ ...m, chatKey: key } as StoredMessage);
    }
    await tx.done;
    onProgress?.(Math.min(i + BATCH, total), total, 'messages');
  }

  let mediaDone = 0;
  for (const [path, load] of chat.media) {
    // Blobs are loaded outside the transaction: IndexedDB commits on any foreign await.
    const exists = mode === 'merge' && (await db.getKey('media', [key, path])) !== undefined;
    if (!exists) {
      try {
        const blob = await load();
        await db.put('media', { chatKey: key, path, blob });
      } catch (e) {
        console.warn('Не удалось прочитать файл', path, e);
      }
    }
    onProgress?.(++mediaDone, chat.media.size, 'media');
  }

  const messageCount = await db.count('messages', chatRange(key));
  const lastCursor = await db.transaction('messages').store.openCursor(chatRange(key), 'prev');
  const lastMsg = lastCursor?.value;

  let name = chat.name;
  if (mode === 'new' && (await findExisting(chat)).length > 0) {
    name = `${chat.name} (копия от ${new Date(now).toLocaleDateString('ru-RU')})`;
  }

  const result: StoredChat = {
    key,
    tgId: chat.tgId,
    name,
    type: chat.type,
    selfId: stored?.selfId ?? guessSelfId(chat),
    createdAt: stored?.createdAt ?? now,
    updatedAt: now,
    importCount: (stored?.importCount ?? 0) + 1,
    messageCount,
    last: lastMsg
      ? {
          text: lastPreview(lastMsg),
          date: msgTime(lastMsg),
          from: lastMsg.from ?? undefined,
        }
      : undefined,
  };
  await db.put('chats', result);
  return { chatKey: key, mode, added, updated, total: messageCount };
}

export function msgTime(m: { date: string; date_unixtime?: string }): number {
  if (m.date_unixtime) return Number(m.date_unixtime) * 1000;
  return new Date(m.date).getTime();
}

export function lastPreview(m: StoredMessage): string {
  const t = plainText(m);
  if (m.type === 'service') return t || 'Служебное сообщение';
  if (t) return t.slice(0, 200);
  if (m.photo) return 'Фотография';
  switch (m.media_type) {
    case 'sticker':
      return `${m.sticker_emoji ?? ''} Стикер`.trim();
    case 'voice_message':
      return 'Голосовое сообщение';
    case 'video_message':
      return 'Видеосообщение';
    case 'video_file':
      return 'Видео';
    case 'animation':
      return 'GIF';
    case 'audio_file':
      return m.title ?? 'Аудио';
  }
  if (m.file) return m.file_name ?? 'Файл';
  if (m.poll) return `📊 ${m.poll.question}`;
  if (m.contact_information) return 'Контакт';
  if (m.location_information) return 'Геопозиция';
  return 'Сообщение';
}
