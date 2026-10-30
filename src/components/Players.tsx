import { useEffect, useRef, useState } from 'react';
import { canPlayOggOpus, isOgg, oggToWav } from '../audio';
import { getMedia } from '../db';
import { duration } from '../format';

/**
 * Object URL that the current browser can actually play: Ogg/Opus is converted
 * to WAV where it isn't supported natively (iPhone). Conversion runs on demand.
 */
function usePlayableAudio(chatKey: string, path: string, mime?: string) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const created = useRef('');

  useEffect(
    () => () => {
      if (created.current) URL.revokeObjectURL(created.current);
    },
    [],
  );

  const load = async (): Promise<string | null> => {
    if (src) return src;
    setState('loading');
    try {
      let blob = await getMedia(chatKey, path);
      if (!blob) throw new Error('missing');
      if (isOgg(path, mime) && !canPlayOggOpus()) blob = await oggToWav(blob);
      created.current = URL.createObjectURL(blob);
      setSrc(created.current);
      setState('idle');
      return created.current;
    } catch (e) {
      console.warn('Audio load failed', path, e);
      setState('error');
      return null;
    }
  };
  return { src, state, load };
}

export function AudioPlayer({
  chatKey,
  path,
  mime,
  seconds,
  variant,
}: {
  chatKey: string;
  path: string;
  mime?: string;
  seconds?: number;
  variant: 'voice' | 'music';
}) {
  const { src, state, load } = usePlayableAudio(chatKey, path, mime);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [len, setLen] = useState(seconds ?? 0);

  const toggle = async () => {
    const a = audio.current!;
    if (!a.paused) {
      a.pause();
      return;
    }
    const url = await load();
    if (!url) return;
    if (a.src !== url) a.src = url;
    try {
      await a.play();
    } catch (e) {
      console.warn('play() failed', e);
    }
  };

  const seek = async (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current!;
    if (!src || !len) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * len;
  };

  const icon = state === 'loading' ? '…' : state === 'error' ? '!' : playing ? '❚❚' : '▶';
  return (
    <div className={`player ${variant}`}>
      <button className="play-btn" onClick={toggle} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
        {icon}
      </button>
      <div className="player-body">
        <div className="track" onClick={seek}>
          <div className="track-fill" style={{ width: len ? `${(pos / len) * 100}%` : 0 }} />
        </div>
        <div className="muted small">
          {state === 'error'
            ? 'Не удалось воспроизвести'
            : playing || pos > 0
              ? `${duration(pos)} / ${duration(len)}`
              : duration(len)}
        </div>
      </div>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
      />
    </div>
  );
}

/** Round video message: tap to play with sound, ring shows progress. */
export function RoundVideo({ url, poster, seconds }: { url: string; poster?: string; seconds?: number }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pos, setPos] = useState(0);
  const R = 108;
  const C = 2 * Math.PI * R;
  return (
    <div className="round-wrap">
      <video
        className="round-video"
        src={url}
        poster={poster}
        playsInline
        preload="metadata"
        onClick={(e) => {
          const v = e.currentTarget;
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          e.currentTarget.currentTime = 0;
          setProgress(0);
          setPos(0);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setPos(v.currentTime);
          if (v.duration) setProgress(v.currentTime / v.duration);
        }}
      />
      <svg className="round-ring" viewBox="0 0 220 220">
        <circle cx="110" cy="110" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
      </svg>
      {!playing && <span className="round-play">▶</span>}
      <span className="media-badge round-time">{duration(playing || pos ? pos : seconds)}</span>
    </div>
  );
}

let lottiePromise: Promise<typeof import('lottie-web/build/player/lottie_light').default> | null = null;
const loadLottie = () =>
  (lottiePromise ??= import('lottie-web/build/player/lottie_light').then((m) => m.default));

/** Animated .tgs sticker (gzipped Lottie JSON). Plays only while on screen. */
export function TgsSticker({ chatKey, path, emoji, thumb }: { chatKey: string; path: string; emoji?: string; thumb?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let anim: { play(): void; pause(): void; destroy(): void } | null = null;
    let observer: IntersectionObserver | null = null;
    let alive = true;
    (async () => {
      try {
        const blob = await getMedia(chatKey, path);
        if (!blob) throw new Error('missing');
        const { gunzipSync, strFromU8 } = await import('fflate');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
        const lottie = await loadLottie();
        if (!alive || !box.current) return;
        anim = lottie.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData: JSON.parse(json),
        });
        setReady(true);
        observer = new IntersectionObserver(([e]) => (e.isIntersecting ? anim?.play() : anim?.pause()));
        observer.observe(box.current);
      } catch (e) {
        console.warn('TGS failed', path, e);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      observer?.disconnect();
      anim?.destroy();
    };
  }, [chatKey, path]);

  if (failed)
    return thumb ? (
      <img className="sticker" src={thumb} alt={emoji} />
    ) : (
      <div className="sticker sticker-emoji">{emoji ?? '🖼'}</div>
    );
  return (
    <div className="sticker" ref={box}>
      {!ready && thumb && <img className="sticker" src={thumb} alt={emoji} />}
    </div>
  );
}

/** .webm video sticker, falls back to the thumbnail where VP9 isn't supported. */
export function VideoSticker({ url, thumb, emoji }: { url: string; thumb?: string; emoji?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return thumb ? (
      <img className="sticker" src={thumb} alt={emoji} />
    ) : (
      <div className="sticker sticker-emoji">{emoji ?? '🖼'}</div>
    );
  return <video className="sticker" src={url} autoPlay loop muted playsInline onError={() => setFailed(true)} />;
}
