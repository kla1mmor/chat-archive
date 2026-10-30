import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredChat, StoredMessage } from './types';

interface ArchiveDB extends DBSchema {
  chats: { key: string; value: StoredChat; indexes: { tgId: number } };
  messages: { key: [string, number]; value: StoredMessage };
  media: { key: [string, string]; value: { chatKey: string; path: string; blob: Blob } };
}

export type DB = IDBPDatabase<ArchiveDB>;

let dbPromise: Promise<DB> | null = null;

export function getDB(name = 'tg-archive'): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB<ArchiveDB>(name, 1, {
      upgrade(db) {
        const chats = db.createObjectStore('chats', { keyPath: 'key' });
        chats.createIndex('tgId', 'tgId');
        db.createObjectStore('messages', { keyPath: ['chatKey', 'id'] });
        db.createObjectStore('media', { keyPath: ['chatKey', 'path'] });
      },
    });
  }
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDBCache() {
  dbPromise = null;
}

const MIN_ID = -Infinity;
const MAX_ID = Infinity;

export function chatRange(chatKey: string, from = MIN_ID, to = MAX_ID) {
  return IDBKeyRange.bound([chatKey, from], [chatKey, to]);
}

export async function listChats(): Promise<StoredChat[]> {
  const db = await getDB();
  const chats = await db.getAll('chats');
  return chats.sort((a, b) => (b.last?.date ?? 0) - (a.last?.date ?? 0));
}

export async function getChat(key: string) {
  return (await getDB()).get('chats', key);
}

export async function putChat(chat: StoredChat) {
  await (await getDB()).put('chats', chat);
}

export async function findChatsByTgId(tgId: number): Promise<StoredChat[]> {
  return (await getDB()).getAllFromIndex('chats', 'tgId', tgId);
}

/** Up to `limit` messages with id < beforeId, oldest first. */
export async function messagesBefore(chatKey: string, beforeId: number, limit: number) {
  const db = await getDB();
  const out: StoredMessage[] = [];
  let cursor = await db
    .transaction('messages')
    .store.openCursor(IDBKeyRange.bound([chatKey, MIN_ID], [chatKey, beforeId], false, true), 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out.reverse();
}

/** Up to `limit` messages with id > afterId, oldest first. */
export async function messagesAfter(chatKey: string, afterId: number, limit: number) {
  const db = await getDB();
  const out: StoredMessage[] = [];
  let cursor = await db
    .transaction('messages')
    .store.openCursor(IDBKeyRange.bound([chatKey, afterId], [chatKey, MAX_ID], true, false));
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export async function getMessage(chatKey: string, id: number) {
  return (await getDB()).get('messages', [chatKey, id]);
}

export async function getMedia(chatKey: string, path: string): Promise<Blob | undefined> {
  return (await (await getDB()).get('media', [chatKey, path]))?.blob;
}

export async function deleteChat(chatKey: string) {
  const db = await getDB();
  const tx = db.transaction(['chats', 'messages', 'media'], 'readwrite');
  await Promise.all([
    tx.objectStore('chats').delete(chatKey),
    tx.objectStore('messages').delete(chatRange(chatKey)),
    tx.objectStore('media').delete(IDBKeyRange.bound([chatKey, ''], [chatKey, '￿'])),
    tx.done,
  ]);
}

/** Messages whose text contains `query`, newest first. */
export async function searchMessages(
  chatKey: string,
  query: string,
  limit = 200,
): Promise<StoredMessage[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = await getDB();
  const out: StoredMessage[] = [];
  let cursor = await db.transaction('messages').store.openCursor(chatRange(chatKey), 'prev');
  while (cursor && out.length < limit) {
    if (plainText(cursor.value).toLowerCase().includes(q)) out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export function plainText(m: { text: StoredMessage['text'] }): string {
  if (typeof m.text === 'string') return m.text;
  return m.text.map((p) => (typeof p === 'string' ? p : p.text)).join('');
}
