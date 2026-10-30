import type { StoredMessage } from './types';
import { plainText } from './db';

const AVATAR_COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];

export function colorFor(id?: string | number | null) {
  const n = Math.abs(Number(String(id ?? '').replace(/\D/g, '')) || hash(String(id ?? '')));
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export function initials(name?: string | null) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? [...words[1]][0] ?? '' : '';
  return (first + second).toUpperCase();
}

export function time(ts: number) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

export function shortDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time(ts);
  const weekAgo = now.getTime() - 6 * 864e5;
  if (ts > weekAgo) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function fullDate(ts: number) {
  return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'medium' });
}

export function fileSize(bytes?: number) {
  if (!bytes) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function duration(sec?: number) {
  if (sec === undefined) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function count(n: number, one: string, few: string, many: string) {
  return `${n.toLocaleString('ru-RU')} ${plural(n, one, few, many)}`;
}

export function serviceText(m: StoredMessage): string {
  const who = m.actor ?? m.from ?? 'Кто-то';
  const members = (m.members ?? []).filter(Boolean).join(', ');
  switch (m.action) {
    case 'create_group':
      return `${who} создал(а) группу «${m.title ?? ''}»`;
    case 'create_channel':
      return `Канал «${m.title ?? ''}» создан`;
    case 'migrate_to_supergroup':
      return 'Группа преобразована в супергруппу';
    case 'migrate_from_group':
      return `Группа «${m.title ?? ''}» преобразована в супергруппу`;
    case 'invite_members':
      return members && members !== who ? `${who} пригласил(а) ${members}` : `${who} вступил(а) в группу`;
    case 'remove_members':
      return members && members !== who ? `${who} удалил(а) ${members}` : `${who} покинул(а) группу`;
    case 'join_group_by_link':
      return `${who} вступил(а) в группу по ссылке`;
    case 'join_group_by_request':
      return `${who} принят(а) в группу`;
    case 'edit_group_title':
      return `${who} изменил(а) название на «${m.title ?? ''}»`;
    case 'edit_group_photo':
      return `${who} изменил(а) фото группы`;
    case 'delete_group_photo':
      return `${who} удалил(а) фото группы`;
    case 'pin_message':
      return `${who} закрепил(а) сообщение`;
    case 'clear_history':
      return 'История очищена';
    case 'phone_call': {
      const missed = m.discard_reason === 'missed' || m.discard_reason === 'busy';
      const dur = m.duration_seconds ? ` (${duration(m.duration_seconds)})` : '';
      return missed ? `Пропущенный звонок` : `Звонок от ${who}${dur}`;
    }
    case 'group_call':
      return `${who} начал(а) видеочат`;
    case 'invite_to_group_call':
      return `${who} пригласил(а) ${members} в видеочат`;
    case 'score_in_game':
      return `${who} набрал(а) ${String(m.score ?? '')} очков`;
    case 'set_messages_ttl':
      return `${who} изменил(а) таймер автоудаления`;
    case 'edit_chat_theme':
      return `${who} изменил(а) тему чата`;
    case 'topic_created':
      return `${who} создал(а) тему «${m.title ?? ''}»`;
    case 'boost_apply':
      return `${who} проголосовал(а) за группу`;
    case 'suggest_profile_photo':
      return `${who} предлагает новое фото профиля`;
    case 'requested_phone_number':
    case 'contact_signup':
      return `${who} теперь в Telegram`;
    case 'allow_sending_messages':
      return `${who} разрешил(а) боту писать`;
    case 'send_payment':
      return `${who} совершил(а) платёж`;
    default: {
      const t = plainText(m);
      return t || `${who}: ${m.action ?? 'служебное сообщение'}`;
    }
  }
}
