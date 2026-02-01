/**
 * Channel plugin types for Squadrn.
 *
 * A channel plugin bridges an external messaging platform (Telegram, Slack, Discord, etc.)
 * with the Squadrn gateway. It receives messages from end-users and delivers agent responses.
 *
 * @module
 */

/**
 * A file or media item attached to a message.
 *
 * Either `url` or `data` (or both) should be provided.
 * `url` is preferred for remote resources; `data` as a `Uint8Array` for inline content.
 */
export interface Attachment {
  /** Media category. */
  type: "image" | "file" | "audio" | "video";

  /**
   * Remote URL where the attachment can be fetched.
   * Mutually optional with `data` — at least one should be present.
   */
  url?: string;

  /**
   * Raw binary content of the attachment.
   * Useful when the file is already in memory or was uploaded directly.
   */
  data?: Uint8Array;

  /** Original filename (e.g. `"report.pdf"`). */
  filename?: string;

  /** MIME type (e.g. `"image/png"`, `"application/pdf"`). */
  mimeType?: string;
}

/**
 * A message received from an external channel.
 *
 * The gateway uses this to route the message to the appropriate agent.
 */
export interface IncomingMessage {
  /** Unique message identifier assigned by the channel. */
  id: string;

  /** Name of the channel plugin that received this message (e.g. `"telegram"`). */
  channelName: string;

  /** Identifier of the chat/conversation/room within the channel. */
  chatId: string;

  /** Identifier of the user who sent the message. */
  userId: string;

  /** Human-readable display name of the sender, if available. */
  userName?: string;

  /** Text content of the message. */
  content: string;

  /** Files or media attached to the message. */
  attachments?: Attachment[];

  /** Identifier of the message this is replying to, if applicable. */
  replyTo?: string;

  /** When the message was sent (as reported by the channel). */
  timestamp: Date;
}

/**
 * A message to be sent through a channel to an end-user.
 */
export interface OutgoingMessage {
  /** Target chat/conversation/room identifier. */
  chatId: string;

  /** Text content to send. */
  content: string;

  /** Identifier of the message to reply to, if applicable. */
  replyTo?: string;

  /** Files or media to attach to the outgoing message. */
  attachments?: Attachment[];
}

/**
 * Interface that channel plugins must implement and register via `core.registerChannel()`.
 *
 * A channel provider manages the connection to an external messaging platform
 * and handles bidirectional message flow.
 *
 * @example
 * ```ts
 * const channel: ChannelProvider = {
 *   name: "telegram",
 *   connect: () => client.startPolling(),
 *   disconnect: () => client.stopPolling(),
 *   onMessage: (handler) => client.on("message", handler),
 *   sendMessage: (msg) => client.send(msg.chatId, msg.content),
 *   sendTyping: (chatId) => client.sendChatAction(chatId, "typing"),
 * };
 * ```
 */
export interface ChannelProvider {
  /** Unique name that identifies this channel (e.g. `"telegram"`, `"slack"`). */
  name: string;

  /** Establish the connection to the external platform. */
  connect(): Promise<void>;

  /** Gracefully disconnect from the external platform. */
  disconnect(): Promise<void>;

  /**
   * Register a handler for incoming messages.
   *
   * The gateway calls this once during plugin registration to receive messages
   * from the channel.
   *
   * @param handler - Callback invoked for each incoming message.
   */
  onMessage(handler: (msg: IncomingMessage) => void): void;

  /**
   * Send a message through this channel.
   *
   * @param msg - The outgoing message to deliver.
   */
  sendMessage(msg: OutgoingMessage): Promise<void>;

  /**
   * Send a typing indicator to a chat.
   *
   * Optional — not all platforms support typing indicators.
   *
   * @param chatId - The chat to show the typing indicator in.
   */
  sendTyping?(chatId: string): Promise<void>;
}
