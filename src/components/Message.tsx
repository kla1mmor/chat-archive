import { memo, useEffect, useState } from 'react';
import { getMessage, plainText } from '../db';
import { colorFor, fullDate, initials, serviceText, time } from '../format';
import { lastPreview, msgTime } from '../importer';
import type { StoredMessage } from '../types';
import { MediaContent, Photo } from './Media';
import { MessageText } from './Text';

export interface MessageProps {
  m: StoredMessage;
  out: boolean;
  isGroup: boolean;
  isChannel: boolean;
  first: boolean;
  last: boolean;
  highlighted: boolean;
  onJump: (id: number) => void;
  onOpen: (url: string, kind: 'image' | 'video') => void;
}

export function Avatar({ id, name, size = 42 }: { id?: string | number | null; name?: string | null; size?: number }) {
  return (
    <div className="avatar" style={{ background: colorFor(id ?? name), width: size, height: size, fontSize: size * 0.4 }}>
      {initials(name)}
    </div>
  );
}

function ReplyQuote({ chatKey, id, onJump }: { chatKey: string; id: number; onJump: (id: number) => void }) {
  const [target, setTarget] = useState<StoredMessage | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getMessage(chatKey, id).then((r) => alive && setTarget(r ?? null));
    return () => {
      alive = false;
    };
  }, [chatKey, id]);
  if (target === undefined) return <div className="reply-quote">…</div>;
  if (target === null)
    return (
      <div className="reply-quote">
        <div className="reply-text muted">Сообщение удалено или не попало в экспорт</div>
      </div>
    );
  const color = colorFor(target.from_id);
  return (
    <div className="reply-quote" style={{ borderColor: color }} onClick={() => onJump(id)}>
      <div className="reply-name" style={{ color }}>
        {target.from ?? 'Сообщение'}
      </div>
      <div className="reply-text">{lastPreview(target)}</div>
    </div>
  );
}

function Extras({ m }: { m: StoredMessage }) {
  return (
    <>
      {m.poll && (
        <div className="poll">
          <div className="poll-q">📊 {m.poll.question}</div>
          <div className="muted small">{m.poll.closed ? 'Опрос завершён' : 'Опрос'}</div>
          {m.poll.answers.map((a, i) => {
            const pct = m.poll!.total_voters ? Math.round((a.voters / m.poll!.total_voters) * 100) : 0;
            return (
              <div key={i} className="poll-a">
                <div className="poll-a-row">
                  <span>
                    {a.chosen ? '✔ ' : ''}
                    {a.text}
                  </span>
                  <span className="muted">{pct}%</span>
                </div>
                <div className="poll-bar" style={{ width: `${pct}%` }} />
              </div>
            );
          })}
          <div className="muted small">Проголосовало: {m.poll.total_voters ?? 0}</div>
        </div>
      )}
      {m.contact_information && (
        <div className="contact">
          <Avatar name={`${m.contact_information.first_name ?? ''} ${m.contact_information.last_name ?? ''}`} size={40} />
          <div>
            <div className="file-name">
              {m.contact_information.first_name} {m.contact_information.last_name}
            </div>
            <div className="muted">{m.contact_information.phone_number}</div>
          </div>
        </div>
      )}
      {m.location_information && (
        <a
          className="location"
          target="_blank"
          rel="noreferrer noopener"
          href={`https://www.openstreetmap.org/?mlat=${m.location_information.latitude}&mlon=${m.location_information.longitude}#map=16/${m.location_information.latitude}/${m.location_information.longitude}`}
        >
          📍 {m.place_name ?? (m.live_location_period_seconds ? 'Трансляция геопозиции' : 'Геопозиция')}
          {m.address && <div className="muted">{m.address}</div>}
        </a>
      )}
    </>
  );
}

function MessageImpl({ m, out, isGroup, isChannel, first, last, highlighted, onJump, onOpen }: MessageProps) {
  if (m.type === 'service') {
    return (
      <div className="service" data-id={m.id}>
        <span>{serviceText(m)}</span>
      </div>
    );
  }

  const ts = msgTime(m);
  const isSticker = m.media_type === 'sticker' || m.media_type === 'video_message';
  const hasText = plainText(m).length > 0;
  const mediaOnly = (m.photo || m.media_type === 'video_file' || m.media_type === 'animation') && !hasText;
  const showName = !out && first && (isGroup || isChannel);
  const showAvatar = isGroup && !out;
  const nameColor = colorFor(m.from_id);

  const classes = ['bubble'];
  if (isSticker) classes.push('bubble-bare');
  if (mediaOnly) classes.push('bubble-media');
  if (last) classes.push('tail');

  const meta = (
    <span className="meta" title={fullDate(ts)}>
      {m.edited && <span title={m.edited_unixtime ? fullDate(Number(m.edited_unixtime) * 1000) : undefined}>изменено </span>}
      {m.author && isChannel && <span>{m.author}, </span>}
      {time(ts)}
      {out && <span className="checks">✓✓</span>}
    </span>
  );

  return (
    <div className={`msg-row ${out ? 'out' : 'in'} ${last ? 'last' : ''} ${highlighted ? 'highlight' : ''}`} data-id={m.id}>
      {showAvatar && <div className="avatar-slot">{last && <Avatar id={m.from_id} name={m.from} size={34} />}</div>}
      <div className={classes.join(' ')}>
        {showName && (
          <div className="sender" style={{ color: isChannel ? undefined : nameColor }}>
            {m.from ?? 'Удалённый аккаунт'}
          </div>
        )}
        {m.forwarded_from !== undefined && (
          <div className="forwarded">
            Переслано от <b>{m.forwarded_from ?? 'скрытого пользователя'}</b>
          </div>
        )}
        {m.saved_from && !m.forwarded_from && (
          <div className="forwarded">
            Сохранено из <b>{m.saved_from}</b>
          </div>
        )}
        {m.reply_to_message_id !== undefined && (
          <ReplyQuote chatKey={m.chatKey} id={m.reply_to_message_id} onJump={onJump} />
        )}
        {m.photo && <Photo m={m} chatKey={m.chatKey} onOpen={onOpen} />}
        {m.file !== undefined && <MediaContent m={m} chatKey={m.chatKey} onOpen={onOpen} />}
        <Extras m={m} />
        <MessageText m={m} />
        {m.via_bot && <div className="muted small">через {m.via_bot}</div>}
        {m.reactions && m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r, i) => (
              <span
                key={i}
                className="reaction"
                title={r.recent?.map((x) => x.from).filter(Boolean).join(', ')}
              >
                {r.emoji ?? (r.type === 'paid' ? '⭐' : '❤')} {r.count}
              </span>
            ))}
          </div>
        )}
        {meta}
        {m.inline_bot_buttons && (
          <div className="bot-buttons">
            {m.inline_bot_buttons.map((row, i) => (
              <div key={i} className="bot-row">
                {row.map((b, j) => (
                  <span key={j} className="bot-btn">
                    {b.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Message = memo(MessageImpl);
