import { useEffect, useRef, useState } from 'react';
import { chatRange, getDB, getMedia } from '../db';
import { count, duration, fileSize, fullDate, shortDate } from '../format';
import { msgTime } from '../importer';
import { saveFile } from '../native';
import { chatTypeName } from '../parse';
import type { StoredChat, StoredMessage } from '../types';
import { Avatar } from './Message';
import { AudioPlayer } from './Players';

type Category = 'photos' | 'videos' | 'files' | 'audio' | 'links' | 'voice' | 'round' | 'gifs';

interface LinkItem {
  url: string;
  text: string;
  m: StoredMessage;
}

interface Stats {
  photos: StoredMessage[];
  videos: StoredMessage[];
  files: StoredMessage[];
  audio: StoredMessage[];
  voice: StoredMessage[];
  round: StoredMessage[];
  gifs: StoredMessage[];
  links: LinkItem[];
  people: { id: string; name: string; n: number }[];
  total: number;
  first?: number;
  last?: number;
}

const CATEGORIES: { key: Category; icon: string; one: string; few: string; many: string }[] = [
  { key: 'photos', icon: '🖼', one: 'фотография', few: 'фотографии', many: 'фотографий' },
  { key: 'videos', icon: '🎬', one: 'видео', few: 'видео', many: 'видео' },
  { key: 'files', icon: '📄', one: 'файл', few: 'файла', many: 'файлов' },
  { key: 'audio', icon: '🎧', one: 'аудиофайл', few: 'аудиофайла', many: 'аудиофайлов' },
  { key: 'links', icon: '🔗', one: 'ссылка', few: 'ссылки', many: 'ссылок' },
  { key: 'voice', icon: '🎤', one: 'голосовое сообщение', few: 'голосовых сообщения', many: 'голосовых сообщений' },
  { key: 'round', icon: '⏺', one: 'видеосообщение', few: 'видеосообщения', many: 'видеосообщений' },
  { key: 'gifs', icon: '🎞', one: 'GIF', few: 'GIF', many: 'GIF' },
];

const TITLES: Record<Category, string> = {
  photos: 'Фотографии',
  videos: 'Видео',
  files: 'Файлы',
  audio: 'Аудио',
  links: 'Ссылки',
  voice: 'Голосовые сообщения',
  round: 'Видеосообщения',
  gifs: 'GIF',
};

const present = (p?: string) => !!p && !p.startsWith('(');

async function collect(chatKey: string): Promise<Stats> {
  const s: Stats = { photos: [], videos: [], files: [], audio: [], voice: [], round: [], gifs: [], links: [], people: [], total: 0 };
  const people = new Map<string, { id: string; name: string; n: number }>();
  const db = await getDB();
  let cursor = await db.transaction('messages').store.openCursor(chatRange(chatKey));
  while (cursor) {
    const m = cursor.value;
    cursor = await cursor.continue();
    if (m.type === 'service') continue;
    s.total++;
    const t = msgTime(m);
    s.first ??= t;
    s.last = t;
    if (m.from_id) {
      const p = people.get(m.from_id) ?? { id: m.from_id, name: m.from ?? m.from_id, n: 0 };
      p.n++;
      people.set(m.from_id, p);
    }
    if (m.photo) s.photos.push(m);
    else if (m.file !== undefined) {
      switch (m.media_type) {
        case 'video_file':
          s.videos.push(m);
          break;
        case 'animation':
          s.gifs.push(m);
          break;
        case 'voice_message':
          s.voice.push(m);
          break;
        case 'video_message':
          s.round.push(m);
          break;
        case 'audio_file':
          s.audio.push(m);
          break;
        case 'sticker':
          break;
        default:
          s.files.push(m);
      }
    }
    for (const e of m.text_entities ?? []) {
      if (e.type === 'link') s.links.push({ url: e.text, text: e.text, m });
      else if (e.type === 'text_link' && e.href) s.links.push({ url: e.href, text: e.text, m });
    }
  }
  // Newest first, like Telegram's shared media.
  for (const k of ['photos', 'videos', 'files', 'audio', 'voice', 'round', 'gifs', 'links'] as const) s[k].reverse();
  s.people = [...people.values()].sort((a, b) => b.n - a.n);
  return s;
}

/** Loads the media blob only once the tile scrolls into view. */
function LazyThumb({
  chatKey,
  path,
  onClick,
  badge,
  placeholder = '—',
}: {
  chatKey: string;
  path?: string;
  onClick: () => void;
  badge?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!present(path)) return;
    let created = '';
    let alive = true;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const blob = await getMedia(chatKey, path!);
      if (alive && blob) setUrl((created = URL.createObjectURL(blob)));
    });
    io.observe(ref.current!);
    return () => {
      alive = false;
      io.disconnect();
      if (created) URL.revokeObjectURL(created);
    };
  }, [chatKey, path]);
  return (
    <button ref={ref} className="tile" onClick={onClick}>
      {url ? <img src={url} alt="" /> : <span className="tile-missing">{present(path) ? '' : placeholder}</span>}
      {badge && <span className="media-badge tile-badge">{badge}</span>}
    </button>
  );
}

function Viewer({
  chatKey,
  m,
  onClose,
  onJump,
}: {
  chatKey: string;
  m: StoredMessage;
  onClose: () => void;
  onJump: () => void;
}) {
  const path = m.photo ?? m.file;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let created = '';
    if (present(path)) getMedia(chatKey, path!).then((b) => b && setUrl((created = URL.createObjectURL(b))));
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [chatKey, path]);
  return (
    <div className="lightbox" onClick={onClose}>
      {!present(path) ? (
        <div className="viewer-missing">Файл не включён в экспорт</div>
      ) : !url ? null : m.photo ? (
        <img src={url} alt="" />
      ) : (
        <video src={url} controls autoPlay playsInline loop={m.media_type === 'animation'} onClick={(e) => e.stopPropagation()} />
      )}
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {m.from ?? ''} · {fullDate(msgTime(m))}
        </span>
        <button className="btn primary small-btn" onClick={onJump}>
          Перейти к сообщению
        </button>
      </div>
    </div>
  );
}

export function ChatInfo({ chat, onClose, onJump }: { chat: StoredChat; onClose: () => void; onJump: (id: number) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Category | null>(null);
  const [viewing, setViewing] = useState<StoredMessage | null>(null);

  useEffect(() => {
    collect(chat.key).then(setStats);
  }, [chat.key]);

  const jump = (id: number) => {
    setViewing(null);
    onJump(id);
  };

  const isGroup = chat.type.includes('group');

  return (
    <aside className="info-panel">
      <header className="chat-header">
        <button className="icon-btn" onClick={tab ? () => setTab(null) : onClose} aria-label="Назад">
          {tab ? '←' : '✕'}
        </button>
        <div className="chat-title">
          <div className="name">{tab ? TITLES[tab] : 'Информация'}</div>
        </div>
      </header>

      <div className="info-body">
        {!stats ? (
          <div className="progress">
            <div className="spinner" />
          </div>
        ) : tab === null ? (
          <>
            <div className="info-head">
              <Avatar id={chat.tgId ?? chat.key} name={chat.name} size={110} />
              <div className="info-name">{chat.name}</div>
              <div className="muted">
                {[chatTypeName(chat.type), count(stats.total, 'сообщение', 'сообщения', 'сообщений')].filter(Boolean).join(' · ')}
              </div>
              {stats.first && stats.last && (
                <div className="muted small">
                  {new Date(stats.first).toLocaleDateString('ru-RU')} — {new Date(stats.last).toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>

            <div className="info-section">
              {CATEGORIES.map((c) => {
                const n = stats[c.key].length;
                if (!n) return null;
                return (
                  <button key={c.key} className="info-row" onClick={() => setTab(c.key)}>
                    <span className="info-icon">{c.icon}</span>
                    <span>{count(n, c.one, c.few, c.many)}</span>
                  </button>
                );
              })}
              {CATEGORIES.every((c) => stats[c.key].length === 0) && (
                <div className="muted info-row">Нет медиа, файлов и ссылок</div>
              )}
            </div>

            {stats.people.length > 0 && (
              <div className="info-section">
                <div className="info-caption muted small">
                  {isGroup ? count(stats.people.length, 'участник', 'участника', 'участников') : 'Сообщений от каждого'}
                </div>
                {stats.people.map((p) => (
                  <div key={p.id} className="info-row">
                    <Avatar id={p.id} name={p.name} size={36} />
                    <span className="info-person">
                      {p.name}
                      {p.id === chat.selfId && <span className="muted"> (вы)</span>}
                    </span>
                    <span className="muted small">{p.n.toLocaleString('ru-RU')}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : tab === 'photos' || tab === 'videos' || tab === 'gifs' ? (
          <div className="grid">
            {stats[tab].map((m) => (
              <LazyThumb
                key={m.id}
                chatKey={chat.key}
                path={m.photo ?? m.thumbnail}
                badge={tab === 'videos' ? duration(m.duration_seconds) : tab === 'gifs' ? 'GIF' : undefined}
                placeholder={tab === 'photos' ? '—' : '▶'}
                onClick={() => setViewing(m)}
              />
            ))}
          </div>
        ) : tab === 'links' ? (
          <div className="info-list">
            {stats.links.map((l, i) => (
              <div key={i} className="info-item">
                <div className="link-icon">{(l.url.replace(/^https?:\/\/(www\.)?/, '')[0] ?? '?').toUpperCase()}</div>
                <div className="info-item-body">
                  <a href={/^https?:/i.test(l.url) ? l.url : `https://${l.url}`} target="_blank" rel="noreferrer noopener" className="ellipsis">
                    {l.url}
                  </a>
                  {l.text !== l.url && <div className="ellipsis">{l.text}</div>}
                  <button className="link-btn muted small" onClick={() => jump(l.m.id)}>
                    {l.m.from ?? ''} · {shortDate(msgTime(l.m))} · к сообщению
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="info-list">
            {stats[tab].map((m) => (
              <div key={m.id} className="info-item">
                {tab === 'files' ? (
                  <button
                    className="file-icon"
                    disabled={!present(m.file)}
                    onClick={async () => {
                      const b = await getMedia(chat.key, m.file!);
                      if (b) saveFile(b, m.file_name ?? 'file');
                    }}
                  >
                    {(m.file_name?.split('.').pop() ?? '').slice(0, 4).toUpperCase() || '📄'}
                  </button>
                ) : null}
                <div className="info-item-body">
                  {tab === 'files' && (
                    <>
                      <div className="file-name ellipsis">{m.file_name ?? 'Файл'}</div>
                      <div className="muted small">{present(m.file) ? fileSize(m.file_size) : 'не включено в экспорт'}</div>
                    </>
                  )}
                  {tab === 'audio' && (
                    <div className="file-name ellipsis">
                      {m.performer ? `${m.performer} — ` : ''}
                      {m.title ?? m.file_name ?? 'Аудио'}
                    </div>
                  )}
                  {(tab === 'voice' || tab === 'audio' || tab === 'round') &&
                    (present(m.file) ? (
                      tab === 'round' ? (
                        <button className="link-btn" onClick={() => setViewing(m)}>
                          ▶ Видеосообщение {duration(m.duration_seconds)}
                        </button>
                      ) : (
                        <AudioPlayer
                          chatKey={chat.key}
                          path={m.file!}
                          mime={m.mime_type}
                          seconds={m.duration_seconds}
                          variant={tab === 'voice' ? 'voice' : 'music'}
                        />
                      )
                    ) : (
                      <div className="muted small">не включено в экспорт · {duration(m.duration_seconds)}</div>
                    ))}
                  <button className="link-btn muted small" onClick={() => jump(m.id)}>
                    {m.from ?? ''} · {shortDate(msgTime(m))} · к сообщению
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewing && <Viewer chatKey={chat.key} m={viewing} onClose={() => setViewing(null)} onJump={() => jump(viewing.id)} />}
    </aside>
  );
}
