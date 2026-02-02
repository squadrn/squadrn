/**
 * @squadrn/channel-telegram — Official Telegram channel plugin for Squadrn.
 *
 * Bridges the Telegram Bot API (via long polling) with the Squadrn gateway,
 * allowing agents to receive and send messages through Telegram chats.
 *
 * @module
 */

import type {
  ChannelProvider,
  IncomingMessage,
  OutgoingMessage,
  Plugin,
  PluginAPI,
  PluginManifest,
} from "@squadrn/types";
import rawManifest from "./manifest.json" with { type: "json" };

const manifest = rawManifest as unknown as PluginManifest;
import { TelegramClient } from "./src/client.ts";
import { handleStartCommand, telegramUpdateToIncoming } from "./src/handlers.ts";

const plugin: Plugin = {
  manifest,

  register(core: PluginAPI): Promise<void> {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) {
      throw new Error(
        "TELEGRAM_BOT_TOKEN environment variable is required. " +
          "Create a bot via @BotFather and set the token.",
      );
    }

    const client = new TelegramClient(token, core.log);
    let messageHandler: ((msg: IncomingMessage) => void) | null = null;

    const channel: ChannelProvider = {
      name: "telegram",

      async connect(): Promise<void> {
        await client.startPolling(async (update) => {
          const msg = update.message;

          // Handle /start pairing command
          if (msg?.text?.startsWith("/start")) {
            await handleStartCommand(msg, client, core.storage, core.log);
            return;
          }

          // Convert to IncomingMessage and forward
          const incoming = await telegramUpdateToIncoming(update, client, core.log);
          if (incoming && messageHandler) {
            messageHandler(incoming);
          }
        });
      },

      disconnect(): Promise<void> {
        client.stopPolling();
        return Promise.resolve();
      },

      onMessage(handler: (msg: IncomingMessage) => void): void {
        messageHandler = handler;
      },

      async sendMessage(msg: OutgoingMessage): Promise<void> {
        const replyTo = msg.replyTo ? Number(msg.replyTo) : undefined;
        await client.sendMessage(msg.chatId, msg.content, replyTo);
      },

      async sendTyping(chatId: string): Promise<void> {
        await client.sendChatAction(chatId);
      },
    };

    core.registerChannel!(channel);
    core.log.info("Telegram channel registered");
    return Promise.resolve();
  },

  unregister(): Promise<void> {
    // Client cleanup happens in disconnect() which the gateway calls first.
    return Promise.resolve();
  },
};

export default plugin;
