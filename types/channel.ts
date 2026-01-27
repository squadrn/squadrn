export interface Attachment {
  type: "image" | "file" | "audio" | "video";
  url: string;
  name?: string;
  mimeType?: string;
}

export interface IncomingMessage {
  id: string;
  channelName: string;
  chatId: string;
  userId: string;
  userName?: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  timestamp: Date;
}

export interface OutgoingMessage {
  chatId: string;
  content: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export interface ChannelProvider {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
}
