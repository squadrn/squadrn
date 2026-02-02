/**
 * Telegram Bot API types used by the channel plugin.
 *
 * Only the subset of the Telegram API that we consume is modelled here.
 * See https://core.telegram.org/bots/api for the full specification.
 *
 * @module
 */

/** Telegram user object. */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Telegram chat object. */
export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** A single photo size returned by the Telegram API. */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Telegram message object (subset of fields we use). */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
}

/** A single update from the Telegram Bot API. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Standard envelope for all Telegram Bot API responses. */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Error thrown when a Telegram API call fails. */
export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly statusCode: number,
    public readonly description: string,
  ) {
    super(`Telegram API error on ${method}: [${statusCode}] ${description}`);
    this.name = "TelegramApiError";
  }
}
