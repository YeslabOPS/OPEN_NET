// ============================================================
// Agent 相关类型定义
// ============================================================

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  skills: SkillReference[];
  modelConfig: ModelConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillReference {
  skillId: string;
  enabled: boolean;
  customParams?: Record<string, unknown>;
}

export interface ModelConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface AgentCreateInput {
  name: string;
  description?: string;
  systemPrompt: string;
  skills?: SkillReference[];
  modelConfig?: Partial<ModelConfig>;
}

export interface AgentUpdateInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  skills?: SkillReference[];
  modelConfig?: Partial<ModelConfig>;
}
