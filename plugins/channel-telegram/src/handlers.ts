/**
 * Converts Telegram API objects into Squadrn's `IncomingMessage` type and
 * handles the `/start` pairing flow.
 *
 * @module
 */

import type { Attachment, IncomingMessage, Logger } from "@squadrn/types";
import type { TelegramMessage, TelegramUpdate } from "./types.ts";
import type { TelegramClient } from "./client.ts";

/** Generate a random 6-character pairing code. */
function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}

/** Stored pairing entry. */
export interface PairingEntry {
  code: string;
  chatId: string;
  userId: string;
  userName: string;
  createdAt: number;
}

/** Storage helpers for pairing state. */
export interface PairingStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

/**
 * Handle the `/start` command by generating a pairing code, persisting it,
 * and replying to the user with the code.
 */
export async function handleStartCommand(
  msg: TelegramMessage,
  client: TelegramClient,
  storage: PairingStorage,
  log: Logger,
): Promise<void> {
  const code = generatePairingCode();
  const chatId = String(msg.chat.id);
  const userId = String(msg.from?.id ?? msg.chat.id);
  const userName = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
    : "Unknown";

  const entry: PairingEntry = {
    code,
    chatId,
    userId,
    userName,
    createdAt: Date.now(),
  };

  await storage.set(`pairing:${code}`, entry);
  log.info("Pairing code generated", { code, chatId, userId });

  await client.sendMessage(
    chatId,
    `Your pairing code is: **${code}**\n\nRun \`squadrn agent pair ${code}\` in your terminal to link this chat to an agent.`,
  );
}

/**
 * Convert a Telegram update into an `IncomingMessage`.
 *
 * Returns `null` if the update doesn't contain a usable message (e.g. service messages).
 */
export async function telegramUpdateToIncoming(
  update: TelegramUpdate,
  client: TelegramClient,
  log: Logger,
): Promise<IncomingMessage | null> {
  const msg = update.message;
  if (!msg) return null;

  const text = msg.text ?? msg.caption ?? "";

  // Skip empty messages with no photos
  if (!text && !msg.photo?.length) return null;

  const attachments: Attachment[] = [];

  if (msg.photo?.length) {
    // Telegram sends multiple sizes; pick the largest (last in array)
    const largest = msg.photo[msg.photo.length - 1];
    if (largest) {
      try {
        const url = await client.getFileUrl(largest.file_id);
        attachments.push({
          type: "image",
          url,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        log.warn("Failed to resolve photo URL", { error: String(err) });
      }
    }
  }

  const userName = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
    : undefined;

  return {
    id: String(msg.message_id),
    channelName: "telegram",
    chatId: String(msg.chat.id),
    userId: String(msg.from?.id ?? msg.chat.id),
    userName,
    content: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyTo: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
    timestamp: new Date(msg.date * 1000),
  };
}
