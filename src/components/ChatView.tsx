import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatRange, getDB, messagesAfter, messagesBefore, putChat, searchMessages } from '../db';
import { count, dayLabel, fullDate, shortDate } from '../format';
import { lastPreview, msgTime } from '../importer';
import { chatTypeName } from '../parse';
import type { StoredChat, StoredMessage } from '../types';
import { Avatar, Message } from './Message';

const PAGE = 100;
const MAX_LOADED = 600;
const GROUP_GAP = 10 * 60 * 1000;

type ScrollIntent = { kind: 'bottom' } | { kind: 'to'; id: number } | { kind: 'anchor'; id: number; top: number };

function sameGroup(a?: StoredMessage, b?: StoredMessage) {
  if (!a || !b || a.type === 'service' || b.type === 'service') return false;
  if (a.from_id !== b.from_id) return false;
  const ta = msgTime(a);
  const tb = msgTime(b);
  return Math.abs(tb - ta) < GROUP_GAP && new Date(ta).toDateString() === new Date(tb).toDateString();
}

export function ChatView({
  chat,
  onBack,
  onDelete,
  onChanged,
}: {
  chat: StoredChat;
  onBack: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [msgs, setMsgs] = useState<StoredMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [showDown, setShowDown] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoredMessage[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; n: number }[] | null>(null);
  const [selfDismissed, setSelfDismissed] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const intent = useRef<ScrollIntent | null>(null);
  const loading = useRef(false);

  const isChannel = chat.type.includes('channel');
  const isGroup = chat.type.includes('group');

  const loadLatest = useCallback(async () => {
    const page = await messagesBefore(chat.key, Infinity, PAGE);
    intent.current = { kind: 'bottom' };
    setMsgs(page);
    setHasOlder(page.length === PAGE);
    setHasNewer(false);
  }, [chat.key]);

  useEffect(() => {
    setMsgs([]);
    setResults(null);
    setQuery('');
    setSearchOpen(false);
    setMenuOpen(false);
    setPeople(null);
    loadLatest();
  }, [loadLatest]);

  const anchorOn = (id: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) intent.current = { kind: 'anchor', id, top: el.getBoundingClientRect().top };
  };

  const loadOlder = async () => {
    if (loading.current || !hasOlder || msgs.length === 0) return;
    loading.current = true;
    const older = await messagesBefore(chat.key, msgs[0].id, PAGE);
    anchorOn(msgs[0].id);
    let next = [...older, ...msgs];
    if (next.length > MAX_LOADED) {
      next = next.slice(0, MAX_LOADED);
      setHasNewer(true);
    }
    setHasOlder(older.length === PAGE);
    setMsgs(next);
    loading.current = false;
  };

  const loadNewer = async () => {
    if (loading.current || !hasNewer || msgs.length === 0) return;
    loading.current = true;
    const last = msgs[msgs.length - 1].id;
    const newer = await messagesAfter(chat.key, last, PAGE);
    anchorOn(last);
    let next = [...msgs, ...newer];
    if (next.length > MAX_LOADED) {
      next = next.slice(next.length - MAX_LOADED);
      setHasOlder(true);
    }
    setHasNewer(newer.length === PAGE);
    setMsgs(next);
    loading.current = false;
  };

  const jumpTo = useCallback(
    async (id: number) => {
      if (msgs.some((m) => m.id === id)) {
        intent.current = { kind: 'to', id };
        setHighlight(id);
        setMsgs((x) => [...x]);
        return;
      }
      const before = await messagesBefore(chat.key, id, PAGE / 2);
      const after = await messagesAfter(chat.key, id - 0.5, PAGE / 2);
      if (!after.length || after[0].id !== id) return;
      intent.current = { kind: 'to', id };
      setHighlight(id);
      setHasOlder(before.length === PAGE / 2);
      setHasNewer(after.length === PAGE / 2);
      setMsgs([...before, ...after]);
    },
    [chat.key, msgs],
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    const it = intent.current;
    if (!list || !it) return;
    intent.current = null;
    if (it.kind === 'bottom') list.scrollTop = list.scrollHeight;
    else {
      const el = list.querySelector<HTMLElement>(`[data-id="${it.id}"]`);
      if (!el) return;
      if (it.kind === 'to') el.scrollIntoView({ block: 'center' });
      else list.scrollTop += el.getBoundingClientRect().top - it.top;
    }
  }, [msgs]);

  useEffect(() => {
    if (highlight === null) return;
    const t = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(t);
  }, [highlight]);

  const onScroll = () => {
    const el = listRef.current!;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowDown(hasNewer || fromBottom > 600);
    if (el.scrollTop < 400) loadOlder();
    if (fromBottom < 400) loadNewer();
  };

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(async () => setResults(query.trim() ? await searchMessages(chat.key, query) : null), 250);
    return () => clearTimeout(t);
  }, [query, searchOpen, chat.key]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const loadPeople = useCallback(async () => {
    const db = await getDB();
    const map = new Map<string, { id: string; name: string; n: number }>();
    let cursor = await db.transaction('messages').store.openCursor(chatRange(chat.key));
    while (cursor) {
      const m = cursor.value;
      if (m.from_id && m.type !== 'service') {
        const p = map.get(m.from_id) ?? { id: m.from_id, name: m.from ?? m.from_id, n: 0 };
        p.n++;
        map.set(m.from_id, p);
      }
      cursor = await cursor.continue();
    }
    setPeople([...map.values()].sort((a, b) => b.n - a.n));
  }, [chat.key]);

  const askSelf = !chat.selfId && !isChannel && !selfDismissed;
  useEffect(() => {
    if (askSelf) loadPeople();
  }, [askSelf, loadPeople]);

  const openMenu = async () => {
    setMenuOpen((v) => !v);
    if (!people) loadPeople();
  };

  const setSelf = async (selfId: string) => {
    await putChat({ ...chat, selfId: selfId || undefined });
    onChanged();
  };

  const openMedia = useCallback((url: string, kind: 'image' | 'video') => setLightbox({ url, kind }), []);

  const subtitle = [chatTypeName(chat.type), count(chat.messageCount, 'сообщение', 'сообщения', 'сообщений')]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Назад">
          ←
        </button>
        {searchOpen ? (
          <input
            className="search-input"
            autoFocus
            placeholder="Поиск по чату"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : (
          <>
            <Avatar id={chat.tgId ?? chat.key} name={chat.name} size={40} />
            <div className="chat-title">
              <div className="name">{chat.name}</div>
              <div className="muted small">{subtitle}</div>
            </div>
          </>
        )}
        <button
          className="icon-btn"
          aria-label="Поиск"
          onClick={() => {
            setSearchOpen((v) => !v);
            setResults(null);
            setQuery('');
          }}
        >
          {searchOpen ? '✕' : '🔍'}
        </button>
        <button className="icon-btn" aria-label="Меню" onClick={openMenu}>
          ⋮
        </button>
        {menuOpen && (
          <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
            <label className="menu-item">
              <span>Мои сообщения (справа):</span>
              <select value={chat.selfId ?? ''} onChange={(e) => setSelf(e.target.value)}>
                <option value="">— никто —</option>
                {people === null && chat.selfId && <option value={chat.selfId}>{chat.selfId}</option>}
                {people?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.n})
                  </option>
                ))}
              </select>
            </label>
            <div className="menu-item muted small">
              Импортов: {chat.importCount} · обновлён {fullDate(chat.updatedAt)}
            </div>
            <button
              className="menu-item danger"
              onClick={() => {
                if (confirm(`Удалить чат «${chat.name}» из архива? Это нельзя отменить.`)) onDelete();
              }}
            >
              Удалить чат
            </button>
          </div>
        )}
      </header>

      {askSelf && people && people.length > 1 && (
        <div className="self-banner">
          <span>Какие сообщения ваши? Они будут справа.</span>
          <div className="self-options">
            {people.slice(0, 4).map((p) => (
              <button key={p.id} className="chip" onClick={() => setSelf(p.id)}>
                {p.name}
              </button>
            ))}
            <button className="chip muted" onClick={() => setSelfDismissed(true)}>
              Позже
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="search-results">
          <div className="muted small search-count">
            {results.length ? `Найдено: ${results.length}${results.length >= 200 ? '+' : ''}` : 'Ничего не найдено'}
          </div>
          {results.map((m) => (
            <button
              key={m.id}
              className="search-result"
              onClick={() => {
                jumpTo(m.id);
                setResults(null);
              }}
            >
              <Avatar id={m.from_id} name={m.from} size={36} />
              <div className="search-result-body">
                <div className="row-between">
                  <b>{m.from ?? chat.name}</b>
                  <span className="muted small">{shortDate(msgTime(m))}</span>
                </div>
                <div className="muted ellipsis">{lastPreview(m)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        <div className="messages-inner">
          {!hasOlder && msgs.length > 0 && <div className="service"><span>Начало истории</span></div>}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const next = msgs[i + 1];
            const t = msgTime(m);
            const newDay = !prev || new Date(msgTime(prev)).toDateString() !== new Date(t).toDateString();
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="date-sep">
                    <span>{dayLabel(t)}</span>
                  </div>
                )}
                <Message
                  m={m}
                  out={!!chat.selfId && m.from_id === chat.selfId}
                  isGroup={isGroup}
                  isChannel={isChannel}
                  first={newDay || !sameGroup(prev, m)}
                  last={!sameGroup(m, next)}
                  highlighted={highlight === m.id}
                  onJump={jumpTo}
                  onOpen={openMedia}
                />
              </div>
            );
          })}
        </div>
      </div>

      {showDown && (
        <button className="down-btn" aria-label="Вниз" onClick={loadLatest}>
          ↓
        </button>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          {lightbox.kind === 'image' ? (
            <img src={lightbox.url} alt="" />
          ) : (
            <video src={lightbox.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </section>
  );
}
