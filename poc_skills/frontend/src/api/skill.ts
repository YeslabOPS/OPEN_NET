import apiClient from './index';

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string;
  tools: string;
  configurations: string;
  icon?: string;
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { agentSkills: number };
}

export interface CreateSkillInput {
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  tools?: string[];
  configurations?: any[];
  icon?: string;
  enabled?: boolean;
  builtIn?: boolean;
}

export const skillApi = {
  list: async (params?: { enabled?: boolean; search?: string }): Promise<Skill[]> => {
    const res = await apiClient.get('/skills', { params });
    return res || [];
  },

  get: async (id: string): Promise<Skill> => {
    return apiClient.get(`/skills/${id}`);
  },

  create: async (data: CreateSkillInput): Promise<Skill> => {
    return apiClient.post('/skills', data);
  },

  update: async (id: string, data: Partial<CreateSkillInput>): Promise<Skill> => {
    return apiClient.put(`/skills/${id}`, data);
  },

  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/skills/${id}`);
  },

  importFromFile: async (file: File): Promise<Skill> => {
    const formData = new FormData();
    formData.append('content', await file.text());
    return apiClient.post('/skills/import/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  importFromUrl: async (url: string): Promise<Skill> => {
    return apiClient.post(`/skills/import/url?url=${encodeURIComponent(url)}`);
  },

  validateImport: async (data: any): Promise<{ valid: boolean; name: string; toolsCount: number }> => {
    return apiClient.post('/skills/import/validate', { data });
  },
};
