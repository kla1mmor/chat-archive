import type { Reaction, TextEntity, TgChatExport, TgMessage } from './types';

/**
 * Converts Telegram Desktop's HTML export (messages.html, messages2.html, ...)
 * into the same shape as the JSON export. HTML has no chat or user ids, so
 * senders get ids derived from their names, and the chat is matched by name.
 */

const MISSING = '(File not included. Change data exporting settings to download.)';

function txt(el: Element | null | undefined) {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** "01.02.2024 10:20:30 UTC+03:00" -> unix seconds. */
export function parseHtmlDate(title: string): number | undefined {
  const m = title.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?: UTC([+-])(\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, dd, mm, yyyy, hh, mi, ss, sign, oh, om] = m;
  if (sign) {
    const utc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
    const offset = (+oh * 60 + +om) * 60_000 * (sign === '+' ? 1 : -1);
    return Math.floor((utc - offset) / 1000);
  }
  return Math.floor(new Date(+yyyy, +mm - 1, +dd, +hh, +mi, +ss).getTime() / 1000);
}

function isoLocal(unix: number) {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function durationOf(s: string): number | undefined {
  const m = s.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  return (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3];
}

function sizeOf(s: string): number | undefined {
  const m = s.match(/([\d.]+)\s*(B|KB|MB|GB)\b/i);
  if (!m) return undefined;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase() as 'B'];
  return Math.round(parseFloat(m[1]) * mult);
}

function styleSize(img: Element | null) {
  const st = img?.getAttribute('style') ?? '';
  const w = st.match(/width:\s*(\d+)px/);
  const h = st.match(/height:\s*(\d+)px/);
  return w && h ? { width: +w[1], height: +h[1] } : {};
}

function goToId(el: Element | null): number | undefined {
  const s = `${el?.getAttribute('href') ?? ''} ${el?.getAttribute('onclick') ?? ''}`;
  const m = s.match(/go_to_message(\d+)|GoToMessage\((\d+)\)/);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

/** Turns a `.text` element into Telegram text entities. */
export function entitiesFromHtml(root: Element): TextEntity[] {
  const out: TextEntity[] = [];
  const push = (type: string, text: string, extra: Partial<TextEntity> = {}) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (type === 'plain' && last?.type === 'plain') last.text += text;
    else out.push({ type, text, ...extra });
  };
  const walk = (node: Node, inherited?: TextEntity['type']) => {
    if (node.nodeType === 3) {
      push(inherited ?? 'plain', node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return push(inherited ?? 'plain', '\n');
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const onclick = el.getAttribute('onclick') ?? '';
      const t = el.textContent ?? '';
      if (/ShowHashtag/.test(onclick)) return push(t.startsWith('$') ? 'cashtag' : 'hashtag', t);
      if (/ShowBotCommand/.test(onclick)) return push('bot_command', t);
      if (/ShowMentionName/.test(onclick)) return push('mention_name', t);
      if (href.startsWith('mailto:')) return push('email', t);
      if (href.startsWith('tel:')) return push('phone', t);
      if (t.startsWith('@')) return push('mention', t);
      if (href === t || href === `http://${t}` || href === `https://${t}`) return push('link', t);
      return push('text_link', t, { href });
    }
    const map: Record<string, string> = {
      strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline',
      s: 'strikethrough', strike: 'strikethrough', del: 'strikethrough',
      code: 'code', pre: 'pre', blockquote: 'blockquote',
    };
    let type = map[tag];
    if (el.classList.contains('spoiler')) type = 'spoiler';
    if (type === 'pre' || type === 'code') return push(type, el.textContent ?? '');
    el.childNodes.forEach((c) => walk(c, inherited ?? type));
  };
  root.childNodes.forEach((c) => walk(c));
  // Trim the indentation whitespace Telegram puts around the text.
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '');
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
  }
  return out.filter((e) => e.text);
}

function parseMedia(wrap: Element, m: TgMessage) {
  const a = wrap.querySelector('a[href]');
  const href = a?.getAttribute('href') ?? undefined;
  const local = href && !/^(https?:|tg:|mailto:)/.test(href) ? href : undefined;
  const title = txt(wrap.querySelector('.title'));
  const status = txt(wrap.querySelector('.status'));
  const has = (cls: string) => !!wrap.querySelector(`.${cls}`) || wrap.classList.contains(cls);

  if (has('photo_wrap')) {
    m.photo = local ?? MISSING;
    Object.assign(m, styleSize(wrap.querySelector('img')));
  } else if (has('video_file_wrap')) {
    Object.assign(m, { media_type: 'video_file', file: local ?? MISSING, mime_type: 'video/mp4' });
    m.thumbnail = wrap.querySelector('img')?.getAttribute('src') ?? undefined;
    m.duration_seconds = durationOf(txt(wrap.querySelector('.video_duration')));
    Object.assign(m, styleSize(wrap.querySelector('img')));
  } else if (has('animated_wrap')) {
    Object.assign(m, { media_type: 'animation', file: local ?? MISSING, mime_type: 'video/mp4' });
    m.thumbnail = wrap.querySelector('img')?.getAttribute('src') ?? undefined;
    Object.assign(m, styleSize(wrap.querySelector('img')));
  } else if (has('sticker_wrap') || has('media_sticker')) {
    Object.assign(m, { media_type: 'sticker', file: local ?? MISSING });
    m.thumbnail = wrap.querySelector('img')?.getAttribute('src') ?? undefined;
    if (local?.endsWith('.tgs')) m.mime_type = 'application/x-tgsticker';
  } else if (has('media_voice_message')) {
    Object.assign(m, { media_type: 'voice_message', file: local ?? MISSING, mime_type: 'audio/ogg' });
    m.duration_seconds = durationOf(status);
  } else if (has('media_video')) {
    Object.assign(m, { media_type: 'video_message', file: local ?? MISSING, mime_type: 'video/mp4' });
    m.duration_seconds = durationOf(status);
  } else if (has('media_audio_file')) {
    Object.assign(m, { media_type: 'audio_file', file: local ?? MISSING });
    const [performer, ...rest] = title.split(' - ');
    if (rest.length) Object.assign(m, { performer, title: rest.join(' - ') });
    else m.title = title;
    m.duration_seconds = durationOf(status);
  } else if (has('media_photo')) {
    m.photo = MISSING;
  } else if (has('media_contact')) {
    const [first_name, ...last] = title.split(' ');
    m.contact_information = { first_name, last_name: last.join(' '), phone_number: status };
  } else if (has('media_location') || has('media_live_location') || has('media_venue')) {
    const q = (href ?? '').match(/[?&]q=(-?[\d.]+),(-?[\d.]+)/);
    if (q) m.location_information = { latitude: +q[1], longitude: +q[2] };
    if (has('media_venue')) m.place_name = title;
  } else if (has('media_poll')) {
    const answers = [...wrap.querySelectorAll('.answer')].map((el) => {
      const votes = txt(el.querySelector('.details'));
      const text = txt(el).replace(votes, '').replace(/^-\s*/, '').trim();
      return { text, voters: parseInt(votes, 10) || 0, chosen: /chosen/i.test(votes) };
    });
    m.poll = {
      question: txt(wrap.querySelector('.question')),
      closed: /closed|заверш/i.test(txt(wrap.querySelector('.details'))),
      total_voters: parseInt(txt(wrap.querySelector('.total')), 10) || 0,
      answers,
    };
  } else if (local || has('media_file') || title) {
    Object.assign(m, { file: local ?? MISSING, file_name: title || local?.split('/').pop() });
    m.file_size = sizeOf(status);
  }
}

function parseReactions(el: Element | null): Reaction[] | undefined {
  if (!el) return undefined;
  const list = [...el.querySelectorAll('.reaction')].map((r) => {
    const count = parseInt(txt(r.querySelector('.count')), 10) || r.querySelectorAll('.userpic').length || 1;
    const emoji = txt(r.querySelector('.emoji')) || undefined;
    return { type: 'emoji', count, emoji } as Reaction;
  });
  return list.length ? list : undefined;
}

export function parseHtmlPages(pages: string[]): TgChatExport {
  const parser = new DOMParser();
  const messages: TgMessage[] = [];
  let name = '';
  let lastFrom: string | undefined;
  let lastDate = 0;

  for (const html of pages) {
    const doc = parser.parseFromString(html, 'text/html');
    name ||= txt(doc.querySelector('.page_header .text')) || txt(doc.querySelector('title'));

    for (const el of doc.querySelectorAll('.message')) {
      if (el.parentElement?.closest('.message')) continue;
      const id = Number((el.id || '').replace('message', ''));
      if (!Number.isFinite(id) || id <= 0) continue; // negative ids are date separators

      if (el.classList.contains('service')) {
        const text = txt(el.querySelector('.body'));
        messages.push({
          id,
          type: 'service',
          date: isoLocal(lastDate),
          date_unixtime: String(lastDate),
          text,
          text_entities: [{ type: 'plain', text }],
        });
        continue;
      }

      const body = el.querySelector(':scope > .body') ?? el;
      const dateEl = body.querySelector(':scope > .date');
      const unix = parseHtmlDate(dateEl?.getAttribute('title') ?? '') ?? lastDate;
      lastDate = unix;

      const fromEl = body.querySelector(':scope > .from_name');
      if (fromEl) {
        // The name element may contain " via @bot"; keep only the sender.
        lastFrom = txt(fromEl).replace(/\s+via\s+@\S+$/, '');
      }
      const from = lastFrom;

      const m: TgMessage = {
        id,
        type: 'message',
        date: isoLocal(unix),
        date_unixtime: String(unix),
        from,
        from_id: from ? `name:${from}` : undefined,
        text: '',
      };

      const via = txt(fromEl?.querySelector('.details')).match(/via (@\S+)/);
      if (via) m.via_bot = via[1];

      const reply = body.querySelector(':scope > .reply_to');
      if (reply) m.reply_to_message_id = goToId(reply.querySelector('a'));

      // Forwarded messages nest their content inside `.forwarded.body`.
      const fwd = body.querySelector(':scope > .forwarded');
      const content = fwd ?? body;
      if (fwd) {
        const fwdFrom = fwd.querySelector(':scope > .from_name');
        const clone = fwdFrom?.cloneNode(true) as Element | undefined;
        clone?.querySelectorAll('.details, .date').forEach((d) => d.remove());
        m.forwarded_from = txt(clone) || null;
      }

      const media = content.querySelector(':scope > .media_wrap');
      if (media) parseMedia(media, m);

      const textEl = content.querySelector(':scope > .text');
      if (textEl) {
        m.text_entities = entitiesFromHtml(textEl);
        m.text = m.text_entities.map((e) => (e.type === 'plain' ? e.text : e)) as TgMessage['text'];
        if (m.text_entities.every((e) => e.type === 'plain')) m.text = m.text_entities.map((e) => e.text).join('');
      }

      const signature = body.querySelector(':scope > .signature');
      if (signature) m.author = txt(signature);

      m.reactions = parseReactions(body.querySelector('.reactions'));
      if (/edited|изменено/i.test(dateEl?.getAttribute('title') ?? '')) m.edited = m.date;

      messages.push(m);
    }
  }

  const senders = new Set(messages.map((m) => m.from_id).filter(Boolean));
  return {
    name: name || 'Чат из HTML',
    type: senders.size > 2 ? 'private_group' : 'personal_chat',
    messages,
  };
}
