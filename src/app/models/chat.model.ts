export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  files?: AttachedFile[];
  loading?: boolean;
}

export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  url?: string;
}