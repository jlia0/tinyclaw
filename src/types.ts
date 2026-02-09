export interface QueueMessage {
  channel: string;
  sender: string;
  senderId?: string;
  message: string;
  timestamp: number;
  messageId: string;
}

export interface ResponseMessage {
  channel: string;
  sender: string;
  message: string;
  originalMessage: string;
  timestamp: number;
  messageId: string;
}

export interface TaskIndexEntry {
  id: number;
  title: string;
  status: string;
  due: string | null;
  priority: string;
  source_channel: string;
  recurrence: string | null;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
