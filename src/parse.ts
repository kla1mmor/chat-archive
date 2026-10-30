import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { parseHtmlPages } from './parseHtml';
import type { ParsedChat, TgChatExport, TgMessage } from './types';

type Loader = () => Promise<Blob>;

/** Flat view of the picked files: export-relative path -> lazy blob. */
type FileTable = Map<string, Loader>;

const MEDIA_FIELDS = ['photo', 'file', 'thumbnail', 'contact_vcard'] as const;

export class ImportError extends Error {}

function norm(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

/**
 * Reads whatever the user picked: a folder, loose files, a .zip, or result.json.
 * ZIPs are read lazily: only the central directory up front, then one entry at a
 * time when it is stored, so multi-gigabyte archives work on phones too.
 */
export async function readExport(files: File[]): Promise<ParsedChat[]> {
  const table: FileTable = new Map();
  for (const f of files) {
    if (await isZip(f)) {
      const reader = new ZipReader(new BlobReader(f));
      let entries;
      try {
        entries = await reader.getEntries();
      } catch {
        throw new ImportError(`Не удалось открыть архив ${f.name}. Возможно, он повреждён или загружен не до конца.`);
      }
      for (const entry of entries) {
        if (entry.directory || !entry.getData) continue;
        if (entry.encrypted) throw new ImportError('Архив защищён паролем. Создайте ZIP без пароля.');
        table.set(norm(entry.filename), () => entry.getData!(new BlobWriter()));
      }
    } else {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      table.set(norm(rel), async () => f);
    }
  }
  return parseTable(table);
}

async function isZip(f: File) {
  if (/\.zip$/i.test(f.name)) return true;
  if (/\.json$/i.test(f.name) || (f as File & { webkitRelativePath?: string }).webkitRelativePath) return false;
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export async function parseTable(table: FileTable): Promise<ParsedChat[]> {
  const jsonPaths = [...table.keys()].filter((p) => /(^|\/)result\.json$/i.test(p));
  const jsonDirs = new Set(jsonPaths.map(dirname));

  // HTML exports: every folder with messages*.html is one chat (pages in order).
  const htmlDirs = new Map<string, { n: number; path: string }[]>();
  for (const p of table.keys()) {
    const m = p.match(/(^|\/)messages(\d*)\.html$/i);
    if (!m || jsonDirs.has(dirname(p))) continue;
    const list = htmlDirs.get(dirname(p)) ?? [];
    list.push({ n: Number(m[2] || 1), path: p });
    htmlDirs.set(dirname(p), list);
  }

  if (jsonPaths.length === 0 && htmlDirs.size === 0) {
    throw new ImportError(
      'Не найден экспорт Telegram. Выберите папку экспорта, ZIP-архив с ней, result.json или messages.html.',
    );
  }
  const chats: ParsedChat[] = [];
  for (const jsonPath of jsonPaths) {
    const text = await (await table.get(jsonPath)!()).text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ImportError(`Файл ${jsonPath} повреждён или не является JSON.`);
    }
    chats.push(...parseResult(data, dirname(jsonPath), table));
  }
  for (const [dir, pages] of [...htmlDirs].sort(([a], [b]) => a.localeCompare(b))) {
    pages.sort((a, b) => a.n - b.n);
    const html = await Promise.all(pages.map(async (p) => (await table.get(p.path)!()).text()));
    const chat = parseHtmlPages(html);
    if (chat.messages.length) chats.push(toParsed(chat, dir, table));
  }
  return chats;
}

/** Handles both a single-chat export and a full account export. */
export function parseResult(data: unknown, baseDir: string, table: FileTable): ParsedChat[] {
  const d = data as Record<string, any>;
  if (Array.isArray(d?.messages)) return [toParsed(d as TgChatExport, baseDir, table)];

  const lists = [d?.chats?.list, d?.left_chats?.list].filter(Array.isArray) as TgChatExport[][];
  if (lists.length === 0) throw new ImportError('В result.json нет чатов.');
  const selfId = d?.personal_information?.user_id
    ? `user${d.personal_information.user_id}`
    : undefined;
  return lists.flat().map((c) => ({ ...toParsed(c, baseDir, table), selfId }));
}

function toParsed(chat: TgChatExport, baseDir: string, table: FileTable): ParsedChat {
  const media = new Map<string, Loader>();
  const messages: TgMessage[] = [];
  for (const m of chat.messages) {
    if (typeof m?.id !== 'number') continue;
    for (const field of MEDIA_FIELDS) {
      const p = m[field];
      if (typeof p !== 'string' || p.startsWith('(')) continue; // "(File not included...)"
      const full = norm(baseDir + p);
      const loader = table.get(full) ?? table.get(norm(p));
      if (loader) media.set(norm(p), loader);
    }
    messages.push(m);
  }
  return {
    tgId: typeof chat.id === 'number' ? chat.id : undefined,
    name: chat.name || chatTypeName(chat.type) || 'Без названия',
    type: chat.type ?? 'unknown',
    messages,
    media,
  };
}

export function chatTypeName(type?: string) {
  switch (type) {
    case 'saved_messages':
      return 'Избранное';
    case 'personal_chat':
      return 'Личный чат';
    case 'bot_chat':
      return 'Бот';
    case 'private_group':
    case 'private_supergroup':
    case 'public_supergroup':
      return 'Группа';
    case 'private_channel':
    case 'public_channel':
      return 'Канал';
    default:
      return '';
  }
}
