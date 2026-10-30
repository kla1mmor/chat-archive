import { useEffect, useState } from 'react';
import { count } from '../format';
import { findExisting, importChat } from '../importer';
import type { ImportMode, ImportResult, ParsedChat, StoredChat } from '../types';
import { Avatar } from './Message';

interface Row {
  chat: ParsedChat;
  existing: StoredChat[];
  mode: ImportMode;
  target?: string;
}

const MODE_LABELS: Record<ImportMode, string> = {
  merge: 'Дополнить существующий',
  replace: 'Заменить существующий',
  new: 'Создать новый чат',
  skip: 'Пропустить',
};

const MODE_HINTS: Record<ImportMode, string> = {
  merge: 'Новые сообщения добавятся, уже имеющиеся обновятся. Дублей не будет.',
  replace: 'Старая версия чата удалится целиком и заменится этим экспортом.',
  new: 'Появится отдельный чат-копия, существующий не изменится.',
  skip: 'Этот чат не будет импортирован.',
};

export function ImportDialog({
  chats,
  onClose,
  onDone,
}: {
  chats: ParsedChat[];
  onClose: () => void;
  onDone: (openKey: string | null) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<{ name: string; r: ImportResult }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      chats.map(async (chat) => {
        const existing = await findExisting(chat);
        return {
          chat,
          existing,
          mode: existing.length ? 'merge' : 'new',
          target: existing[0]?.key,
        } as Row;
      }),
    ).then(setRows);
  }, [chats]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const setAll = (mode: ImportMode) =>
    setRows((rs) => rs!.map((r) => (r.existing.length || mode === 'new' || mode === 'skip' ? { ...r, mode } : r)));

  const run = async () => {
    const out: { name: string; r: ImportResult }[] = [];
    try {
      for (const [i, row] of rows!.entries()) {
        const prefix = rows!.length > 1 ? `Чат ${i + 1} из ${rows!.length}: ` : '';
        setProgress(`${prefix}${row.chat.name}`);
        const r = await importChat(row.chat, row.mode, row.target, (done, total, stage) =>
          setProgress(
            `${prefix}${row.chat.name} — ${stage === 'messages' ? 'сообщения' : 'медиафайлы'} ${done} / ${total}`,
          ),
        );
        out.push({ name: row.chat.name, r });
      }
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const anyExisting = rows?.some((r) => r.existing.length > 0);

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Импорт чатов</h2>
        {error && <div className="error">Ошибка: {error}</div>}

        {results ? (
          <>
            <div className="import-list">
              {results.map(({ name, r }, i) => (
                <div key={i} className="import-row">
                  <div className="file-name">{name}</div>
                  <div className="muted small">
                    {r.mode === 'skip'
                      ? 'пропущен'
                      : `${MODE_LABELS[r.mode]}: добавлено ${r.added}, обновлено ${r.updated}, всего ${count(
                          r.total,
                          'сообщение',
                          'сообщения',
                          'сообщений',
                        )}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onDone(results.find((x) => x.r.chatKey)?.r.chatKey ?? null)}>
                Готово
              </button>
            </div>
          </>
        ) : progress ? (
          <div className="progress">
            <div className="spinner" />
            <div>{progress}</div>
            <div className="muted small">Не закрывайте приложение до окончания импорта.</div>
          </div>
        ) : !rows ? (
          <div className="progress">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {anyExisting && rows.length > 1 && (
              <div className="bulk">
                <span className="muted small">Для всех уже импортированных:</span>
                {(['merge', 'replace', 'new', 'skip'] as ImportMode[]).map((m) => (
                  <button key={m} className="chip" onClick={() => setAll(m)}>
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            )}
            <div className="import-list">
              {rows.map((row, i) => (
                <div key={i} className="import-row">
                  <div className="import-head">
                    <Avatar id={row.chat.tgId} name={row.chat.name} size={36} />
                    <div>
                      <div className="file-name">{row.chat.name}</div>
                      <div className="muted small">
                        {count(row.chat.messages.length, 'сообщение', 'сообщения', 'сообщений')} ·{' '}
                        {count(row.chat.media.size, 'файл', 'файла', 'файлов')}
                      </div>
                    </div>
                  </div>
                  {row.existing.length > 0 ? (
                    <>
                      <div className="notice">
                        Этот чат уже есть в архиве
                        {row.existing.length > 1 ? ` (${row.existing.length} копии)` : ''}.
                      </div>
                      <div className="mode-options">
                        {(['merge', 'replace', 'new', 'skip'] as ImportMode[]).map((m) => (
                          <label key={m} className={row.mode === m ? 'mode active' : 'mode'}>
                            <input type="radio" checked={row.mode === m} onChange={() => update(i, { mode: m })} />
                            {MODE_LABELS[m]}
                          </label>
                        ))}
                      </div>
                      {row.existing.length > 1 && (row.mode === 'merge' || row.mode === 'replace') && (
                        <select value={row.target} onChange={(e) => update(i, { target: e.target.value })}>
                          {row.existing.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name} — {c.messageCount} сообщ.
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="muted small">{MODE_HINTS[row.mode]}</div>
                    </>
                  ) : (
                    <label className="mode-inline">
                      <input
                        type="checkbox"
                        checked={row.mode !== 'skip'}
                        onChange={(e) => update(i, { mode: e.target.checked ? 'new' : 'skip' })}
                      />
                      Импортировать как новый чат
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Отмена
              </button>
              <button className="btn primary" onClick={run} disabled={rows.every((r) => r.mode === 'skip')}>
                Импортировать
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
