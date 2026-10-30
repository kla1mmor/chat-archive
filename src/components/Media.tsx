import { useEffect, useState } from 'react';
import { getMedia } from '../db';
import { duration, fileSize } from '../format';
import type { StoredMessage } from '../types';

/** Object URL for a stored media file; null while loading, '' if missing. */
export function useMediaUrl(chatKey: string, path?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || path.startsWith('(')) {
      setUrl('');
      return;
    }
    let created = '';
    let alive = true;
    setUrl(null);
    getMedia(chatKey, path).then((blob) => {
      if (!alive) return;
      created = blob ? URL.createObjectURL(blob) : '';
      setUrl(created);
    });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [chatKey, path]);
  return url;
}

function boxSize(w?: number, h?: number, max = 360) {
  if (!w || !h) return { width: max, height: max * 0.66 };
  const scale = Math.min(1, max / w, max / h);
  return { width: Math.max(80, Math.round(w * scale)), height: Math.max(60, Math.round(h * scale)) };
}

function Missing({ label, size }: { label: string; size?: { width: number; height: number } }) {
  return (
    <div className="media-missing" style={size}>
      <span>{label}</span>
      <small>не включено в экспорт</small>
    </div>
  );
}

export function Photo({
  m,
  chatKey,
  onOpen,
}: {
  m: StoredMessage;
  chatKey: string;
  onOpen: (url: string, kind: 'image' | 'video') => void;
}) {
  const url = useMediaUrl(chatKey, m.photo);
  const size = boxSize(m.width, m.height);
  if (url === '') return <Missing label="🖼 Фото" size={size} />;
  return (
    <div className="media-box" style={size}>
      {url && <img src={url} alt="" loading="lazy" onClick={() => onOpen(url, 'image')} />}
    </div>
  );
}

export function MediaContent({
  m,
  chatKey,
  onOpen,
}: {
  m: StoredMessage;
  chatKey: string;
  onOpen: (url: string, kind: 'image' | 'video') => void;
}) {
  const url = useMediaUrl(chatKey, m.file);
  const thumb = useMediaUrl(chatKey, m.thumbnail);
  const missing = url === '';

  switch (m.media_type) {
    case 'sticker': {
      if (missing || /\.tgs$/i.test(m.file ?? '')) {
        // Animated .tgs stickers need a Lottie player; show the emoji instead.
        return thumb ? (
          <img className="sticker" src={thumb} alt={m.sticker_emoji} />
        ) : (
          <div className="sticker sticker-emoji">{m.sticker_emoji ?? '🖼'}</div>
        );
      }
      if (/\.webm$/i.test(m.file ?? ''))
        return url ? <video className="sticker" src={url} autoPlay loop muted playsInline /> : null;
      return url ? <img className="sticker" src={url} alt={m.sticker_emoji} /> : null;
    }
    case 'animation': {
      const size = boxSize(m.width, m.height);
      if (missing) return <Missing label="GIF" size={size} />;
      return (
        <div className="media-box" style={size}>
          {url && <video src={url} autoPlay loop muted playsInline />}
          <span className="media-badge">GIF</span>
        </div>
      );
    }
    case 'video_file': {
      const size = boxSize(m.width, m.height);
      if (missing)
        return thumb ? (
          <div className="media-box" style={size}>
            <img src={thumb} alt="" />
            <span className="media-badge">🎬 {duration(m.duration_seconds)} · нет в экспорте</span>
          </div>
        ) : (
          <Missing label="🎬 Видео" size={size} />
        );
      return (
        <div className="media-box" style={size}>
          {url && (
            <video
              src={url}
              poster={thumb || undefined}
              controls
              preload="metadata"
              playsInline
              onDoubleClick={() => onOpen(url, 'video')}
            />
          )}
        </div>
      );
    }
    case 'video_message':
      if (missing) return <Missing label="⏺ Видеосообщение" size={{ width: 220, height: 220 }} />;
      return url ? <RoundVideo url={url} poster={thumb || undefined} /> : <div className="round-video" />;
    case 'voice_message':
      return (
        <div className="audio-row">
          <span className="audio-icon">🎤</span>
          {missing ? (
            <span className="muted">Голосовое {duration(m.duration_seconds)} · нет в экспорте</span>
          ) : (
            url && <audio src={url} controls preload="metadata" />
          )}
        </div>
      );
    case 'audio_file':
      return (
        <div className="audio-file">
          <div className="audio-title">
            🎵 {m.performer ? `${m.performer} — ` : ''}
            {m.title ?? m.file_name ?? 'Аудио'}
          </div>
          {missing ? (
            <span className="muted">нет в экспорте · {duration(m.duration_seconds)}</span>
          ) : (
            url && <audio src={url} controls preload="metadata" />
          )}
        </div>
      );
  }

  const name = m.file_name ?? m.file?.split('/').pop() ?? 'Файл';
  const ext = (name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
  return (
    <a
      className={missing ? 'file-row missing' : 'file-row'}
      href={url || undefined}
      download={name}
      onClick={(e) => missing && e.preventDefault()}
    >
      <span className="file-icon">{ext || '📄'}</span>
      <span className="file-meta">
        <span className="file-name">{name}</span>
        <span className="muted">{missing ? 'не включено в экспорт' : fileSize(m.file_size)}</span>
      </span>
    </a>
  );
}

function RoundVideo({ url, poster }: { url: string; poster?: string }) {
  return (
    <video
      className="round-video"
      src={url}
      poster={poster}
      playsInline
      onClick={(e) => {
        const v = e.currentTarget;
        if (v.paused) v.play();
        else v.pause();
      }}
    />
  );
}
