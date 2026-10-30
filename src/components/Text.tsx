import { useState, type ReactNode } from 'react';
import type { TextEntity, TgMessage } from '../types';

function entitiesOf(m: Pick<TgMessage, 'text' | 'text_entities'>): TextEntity[] {
  if (m.text_entities) return m.text_entities;
  if (typeof m.text === 'string') return [{ type: 'plain', text: m.text }];
  return m.text.map((p) => (typeof p === 'string' ? { type: 'plain', text: p } : p));
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={shown ? 'spoiler shown' : 'spoiler'} onClick={() => setShown(true)}>
      {children}
    </span>
  );
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|tel:|tg:)/i.test(href)) return href;
  return `https://${href}`;
}

function renderEntity(e: TextEntity, i: number): ReactNode {
  const t = e.text;
  switch (e.type) {
    case 'bold':
      return <b key={i}>{t}</b>;
    case 'italic':
      return <i key={i}>{t}</i>;
    case 'underline':
      return <u key={i}>{t}</u>;
    case 'strikethrough':
      return <s key={i}>{t}</s>;
    case 'spoiler':
      return <Spoiler key={i}>{t}</Spoiler>;
    case 'code':
      return <code key={i}>{t}</code>;
    case 'pre':
      return (
        <pre key={i} data-lang={e.language || undefined}>
          <code>{t}</code>
        </pre>
      );
    case 'blockquote':
    case 'expandable_blockquote':
      return <blockquote key={i}>{t}</blockquote>;
    case 'link':
      return (
        <a key={i} href={safeHref(t)} target="_blank" rel="noreferrer noopener">
          {t}
        </a>
      );
    case 'text_link':
      return (
        <a key={i} href={safeHref(e.href ?? t)} target="_blank" rel="noreferrer noopener" title={e.href}>
          {t}
        </a>
      );
    case 'email':
      return (
        <a key={i} href={`mailto:${t}`}>
          {t}
        </a>
      );
    case 'phone':
      return (
        <a key={i} href={`tel:${t}`}>
          {t}
        </a>
      );
    case 'mention':
    case 'mention_name':
    case 'hashtag':
    case 'cashtag':
    case 'bot_command':
    case 'bank_card':
      return (
        <span key={i} className="link-like">
          {t}
        </span>
      );
    default:
      return <span key={i}>{t}</span>;
  }
}

export function MessageText({ m }: { m: Pick<TgMessage, 'text' | 'text_entities'> }) {
  const parts = entitiesOf(m);
  if (parts.every((p) => !p.text)) return null;
  return <div className="text">{parts.map(renderEntity)}</div>;
}
