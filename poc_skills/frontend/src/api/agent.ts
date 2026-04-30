import apiClient from './index';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { skills: number; conversations: number };
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig?: string;
  enabled?: boolean;
}

export const agentApi = {
  list: async (): Promise<Agent[]> => {
    const res = await apiClient.get('/agents');
    return res || [];
  },

  get: async (id: string): Promise<Agent> => {
    return apiClient.get(`/agents/${id}`);
  },

  create: async (data: CreateAgentInput): Promise<Agent> => {
    return apiClient.post('/agents', data);
  },

  update: async (id: string, data: Partial<CreateAgentInput>): Promise<Agent> => {
    return apiClient.put(`/agents/${id}`, data);
  },

  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/agents/${id}`);
  },
};
