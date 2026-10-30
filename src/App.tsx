import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteChat, listChats } from './db';
import { count, shortDate } from './format';
import { ImportError, readExport } from './parse';
import type { ParsedChat, StoredChat } from './types';
import { ChatView } from './components/ChatView';
import { ImportDialog } from './components/ImportDialog';
import { Avatar } from './components/Message';

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (entries.length === 0) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(file, 'webkitRelativePath', { value: path + file.name });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export function App() {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [parsed, setParsed] = useState<ParsedChat[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<string>('');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setChats(await listChats());
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined) setUsage(`${(est.usage / 1024 / 1024).toFixed(0)} МБ`);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Only one voice message / video plays at a time, like in messengers.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const t = e.target as HTMLMediaElement;
      if (t.muted) return;
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        if (el !== t && !el.muted && !el.paused) el.pause();
      });
    };
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setReading(true);
    try {
      const result = await readExport(files);
      if (result.length === 0) throw new ImportError('В экспорте нет чатов.');
      navigator.storage?.persist?.();
      setParsed(result);
    } catch (e) {
      setError(e instanceof ImportError ? e.message : `Не удалось прочитать экспорт: ${String(e)}`);
    } finally {
      setReading(false);
    }
  };

  // Opening a chat adds a history entry, so the Android back button and the
  // browser's Back return to the chat list instead of leaving the app.
  const openChat = (key: string) => {
    if (history.state?.chat) history.replaceState({ chat: key }, '');
    else history.pushState({ chat: key }, '');
    setSelected(key);
  };
  const closeChat = () => {
    if (history.state?.chat) history.back();
    else setSelected(null);
  };

  useEffect(() => {
    const onPop = () => setSelected(history.state?.chat ?? null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const chat = chats.find((c) => c.key === selected) ?? null;
  const visible = chats.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div
      className={`app ${chat ? 'has-chat' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(await filesFromDrop(e.dataTransfer));
      }}
    >
      <aside className="sidebar">
        <div className="sidebar-top">
          <input
            className="search-input"
            placeholder="Поиск чатов"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="chat-list">
          {visible.map((c) => (
            <button
              key={c.key}
              className={c.key === selected ? 'chat-item active' : 'chat-item'}
              onClick={() => openChat(c.key)}
            >
              <Avatar id={c.tgId ?? c.key} name={c.name} size={54} />
              <div className="chat-item-body">
                <div className="row-between">
                  <span className="name ellipsis">{c.name}</span>
                  {c.last && <span className="muted small">{shortDate(c.last.date)}</span>}
                </div>
                <div className="muted ellipsis">
                  {c.last?.from && c.type.includes('group') && <span className="from">{c.last.from}: </span>}
                  {c.last?.text ?? 'Нет сообщений'}
                </div>
              </div>
            </button>
          ))}
          {chats.length === 0 && (
            <div className="empty-list muted">Архив пуст. Нажмите «+», чтобы импортировать чат.</div>
          )}
        </div>
        <div className="sidebar-footer muted small">
          {count(chats.length, 'чат', 'чата', 'чатов')}
          {usage && ` · занято ${usage}`}
        </div>
        <div className="fab-wrap">
          <details className="fab-menu">
            <summary className="fab" aria-label="Импорт">
              +
            </summary>
            <div className="menu fab-items">
              <button className="menu-item" onClick={() => folderInput.current?.click()}>
                📁 Выбрать папку экспорта
              </button>
              <button className="menu-item" onClick={() => fileInput.current?.click()}>
                🗜 Выбрать ZIP или result.json
              </button>
            </div>
          </details>
        </div>
        <input
          ref={folderInput}
          type="file"
          hidden
          // @ts-expect-error non-standard but supported by Chromium, Firefox and Safari
          webkitdirectory=""
          multiple
          onChange={(e) => {
            handleFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".zip,.json,application/zip,application/x-zip-compressed,application/json,application/octet-stream"
          onChange={(e) => {
            handleFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </aside>

      <main className="main">
        {chat ? (
          <ChatView
            key={`${chat.key}:${chat.updatedAt}`}
            chat={chat}
            onBack={closeChat}
            onChanged={refresh}
            onDelete={async () => {
              await deleteChat(chat.key);
              closeChat();
              refresh();
            }}
          />
        ) : (
          <div className="welcome">
            <div className="welcome-card">
              <h1>Архив чатов</h1>
              <p>Импортируйте переписку из Telegram и просматривайте её здесь. Всё хранится только на этом устройстве.</p>
              <ol>
                <li>
                  Откройте <b>Telegram Desktop</b> → Настройки → Продвинутые настройки → <b>Экспорт данных</b>, или в
                  нужном чате ⋮ → <b>Экспорт истории чата</b>.
                </li>
                <li>
                  Отметьте фото, видео, голосовые и файлы. Формат: <b>«Машиночитаемый JSON»</b>.
                </li>
                <li>
                  Перетащите папку экспорта сюда или нажмите «+». На телефоне удобнее заархивировать папку в ZIP.
                </li>
              </ol>
              <p className="muted small">
                Повторный импорт того же чата не создаёт дублей: можно дополнить, заменить или сохранить как отдельную
                копию.
              </p>
            </div>
          </div>
        )}
      </main>

      {dragging && <div className="drop-overlay">Отпустите, чтобы импортировать</div>}
      {reading && (
        <div className="modal-backdrop">
          <div className="modal progress">
            <div className="spinner" />
            <div>Читаю экспорт…</div>
          </div>
        </div>
      )}
      {error && (
        <div className="modal-backdrop" onClick={() => setError(null)}>
          <div className="modal">
            <h2>Не получилось</h2>
            <p>{error}</p>
            <div className="modal-actions">
              <button className="btn primary">Понятно</button>
            </div>
          </div>
        </div>
      )}
      {parsed && (
        <ImportDialog
          chats={parsed}
          onClose={() => setParsed(null)}
          onDone={async (key) => {
            setParsed(null);
            await refresh();
            if (key) openChat(key);
          }}
        />
      )}
    </div>
  );
}
