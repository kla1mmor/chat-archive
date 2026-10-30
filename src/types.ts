// Shapes follow Telegram Desktop's JSON export (result.json).

export interface TextEntity {
  type: string;
  text: string;
  href?: string;
  user_id?: number;
  language?: string;
  document_id?: string;
  collapsed?: boolean;
}

export interface Reaction {
  type: string; // "emoji" | "custom_emoji" | "paid"
  count: number;
  emoji?: string;
  document_id?: string;
  recent?: { from?: string; from_id?: string; date?: string }[];
}

export interface TgMessage {
  id: number;
  type: 'message' | 'service' | string;
  date: string;
  date_unixtime?: string;
  edited?: string;
  edited_unixtime?: string;
  from?: string | null;
  from_id?: string;
  actor?: string | null;
  actor_id?: string;
  action?: string;
  author?: string;
  forwarded_from?: string | null;
  saved_from?: string;
  via_bot?: string;
  reply_to_message_id?: number;
  reply_to_peer_id?: string;
  photo?: string;
  photo_file_size?: number;
  width?: number;
  height?: number;
  file?: string;
  file_name?: string;
  file_size?: number;
  thumbnail?: string;
  media_type?: string;
  mime_type?: string;
  duration_seconds?: number;
  sticker_emoji?: string;
  performer?: string;
  title?: string;
  text: string | (string | TextEntity)[];
  text_entities?: TextEntity[];
  reactions?: Reaction[];
  poll?: {
    question: string;
    closed?: boolean;
    total_voters?: number;
    answers: { text: string; voters: number; chosen?: boolean }[];
  };
  contact_information?: { first_name?: string; last_name?: string; phone_number?: string };
  location_information?: { latitude: number; longitude: number };
  place_name?: string;
  address?: string;
  live_location_period_seconds?: number;
  members?: (string | null)[];
  message_id?: number;
  discard_reason?: string;
  inline_bot_buttons?: { type: string; text: string; data?: string }[][];
  [key: string]: unknown;
}

export interface TgChatExport {
  id?: number;
  name?: string | null;
  type?: string;
  messages: TgMessage[];
}

/** Chat as stored locally. `key` is our own id; `tgId` is Telegram's. */
export interface StoredChat {
  key: string;
  tgId?: number;
  name: string;
  type: string;
  selfId?: string;
  createdAt: number;
  updatedAt: number;
  importCount: number;
  messageCount: number;
  last?: { text: string; date: number; from?: string };
}

export interface StoredMessage extends TgMessage {
  chatKey: string;
}

/** A chat read from an export, before it is written to the database. */
export interface ParsedChat {
  tgId?: number;
  name: string;
  type: string;
  messages: TgMessage[];
  /** Media files referenced by messages, by export-relative path. */
  media: Map<string, () => Promise<Blob>>;
  selfId?: string;
}

export type ImportMode = 'merge' | 'replace' | 'new' | 'skip';

export interface ImportResult {
  chatKey: string | null;
  mode: ImportMode;
  added: number;
  updated: number;
  total: number;
}
