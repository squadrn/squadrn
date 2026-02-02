/**
 * Telegram Bot API client using native `fetch`.
 *
 * Handles long polling for updates, sending messages, and chat actions.
 * Includes automatic retry with exponential backoff on transient errors.
 *
 * @module
 */

import type { Logger } from "@squadrn/types";
import type { TelegramApiResponse, TelegramMessage, TelegramUpdate } from "./types.ts";
import { TelegramApiError } from "./types.ts";

const BASE_URL = "https://api.telegram.org";

/** Long-polling timeout in seconds sent to Telegram. */
const POLL_TIMEOUT_SECONDS = 30;

/** Maximum retry delay in milliseconds. */
const MAX_RETRY_DELAY_MS = 30_000;

/** Base retry delay in milliseconds. */
const BASE_RETRY_DELAY_MS = 1_000;

export class TelegramClient {
  readonly #token: string;
  readonly #log: Logger;
  #offset = 0;
  #running = false;
  #abortController: AbortController | null = null;

  constructor(token: string, log: Logger) {
    this.#token = token;
    this.#log = log;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Start the long-polling loop. Calls `onUpdate` for each received update. */
  async startPolling(onUpdate: (update: TelegramUpdate) => void): Promise<void> {
    this.#running = true;
    this.#abortController = new AbortController();
    let retries = 0;

    this.#log.info("Starting Telegram long-polling loop");

    while (this.#running) {
      try {
        const updates = await this.#getUpdates();
        retries = 0; // reset on success

        for (const update of updates) {
          this.#offset = update.update_id + 1;
          try {
            onUpdate(update);
          } catch (err) {
            this.#log.error("Error in update handler", {
              updateId: update.update_id,
              error: String(err),
            });
          }
        }
      } catch (err) {
        if (!this.#running) break; // graceful shutdown

        retries++;
        const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** (retries - 1), MAX_RETRY_DELAY_MS);
        this.#log.warn("Polling error, retrying", {
          attempt: retries,
          delayMs: delay,
          error: String(err),
        });
        await this.#sleep(delay);
      }
    }
  }

  /** Stop the long-polling loop gracefully. */
  stopPolling(): void {
    this.#running = false;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#log.info("Telegram polling stopped");
  }

  /** Send a text message. */
  async sendMessage(
    chatId: string,
    text: string,
    replyToMessageId?: number,
  ): Promise<TelegramMessage> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    };
    if (replyToMessageId !== undefined) {
      body["reply_to_message_id"] = replyToMessageId;
    }
    return await this.#call<TelegramMessage>("sendMessage", body);
  }

  /** Send a "typing…" chat action indicator. */
  async sendChatAction(chatId: string, action = "typing"): Promise<void> {
    await this.#call<boolean>("sendChatAction", { chat_id: chatId, action });
  }

  /** Get a direct download URL for a file by its `file_id`. */
  async getFileUrl(fileId: string): Promise<string> {
    const file = await this.#call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) {
      throw new TelegramApiError("getFile", 0, "file_path missing from response");
    }
    return `${BASE_URL}/file/bot${this.#token}/${file.file_path}`;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  async #getUpdates(): Promise<TelegramUpdate[]> {
    return await this.#call<TelegramUpdate[]>("getUpdates", {
      offset: this.#offset,
      timeout: POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message"],
    }, POLL_TIMEOUT_SECONDS + 10);
  }

  async #call<T>(method: string, body: Record<string, unknown>, timeoutSeconds = 10): Promise<T> {
    const url = `${BASE_URL}/bot${this.#token}/${method}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    // Combine with the global abort (for shutdown)
    const onGlobalAbort = () => controller.abort();
    this.#abortController?.signal.addEventListener("abort", onGlobalAbort);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = (await res.json()) as TelegramApiResponse<T>;

      if (!data.ok || data.result === undefined) {
        throw new TelegramApiError(
          method,
          data.error_code ?? res.status,
          data.description ?? "Unknown error",
        );
      }

      return data.result;
    } finally {
      clearTimeout(timeoutId);
      this.#abortController?.signal.removeEventListener("abort", onGlobalAbort);
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
