// ============================================================
// 消息与对话相关类型定义
// ============================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'success' | 'error';
}

export interface Conversation {
  id: string;
  agentId: string;
  title?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatRequest {
  agentId: string;
  message: string;
  conversationId?: string;
  stream?: boolean;
}

export interface ChatResponse {
  conversationId: string;
  message: Message;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
