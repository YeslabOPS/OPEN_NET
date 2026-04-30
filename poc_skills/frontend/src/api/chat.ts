import apiClient from './index';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  createdAt: string;
}

export interface ChatRequest {
  agentId: string;
  message: string;
  conversationId?: string;
  stream?: boolean;
}

export interface ChatResponse {
  conversationId: string;
  message: ChatMessage;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export const chatApi = {
  send: async (data: ChatRequest): Promise<ChatResponse> => {
    return apiClient.post('/chat', data);
  },

  getHistory: async (conversationId: string): Promise<ChatMessage[]> => {
    return apiClient.get(`/conversations/${conversationId}/messages`);
  },

  listConversations: async (): Promise<Array<{ id: string; title?: string; agentId: string }>> => {
    return apiClient.get('/conversations');
  },
};
