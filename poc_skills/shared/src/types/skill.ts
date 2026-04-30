// ============================================================
// Skill 相关类型定义
// ============================================================

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  tools: ToolDefinition[];
  configurations: ConfigSchema[];
  icon?: string;
  enabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParameterSchema;
  handler: string;
}

export interface ParameterSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required: string[];
}

export interface PropertySchema {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface ConfigSchema {
  key: string;
  type: string;
  description?: string;
  default?: unknown;
  required?: boolean;
}

export interface SkillCreateInput {
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  tools: ToolDefinition[];
  configurations?: ConfigSchema[];
  icon?: string;
}

export interface SkillImportSource {
  type: 'file' | 'url';
  source: string;
}
