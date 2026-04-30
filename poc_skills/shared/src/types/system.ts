// ============================================================
// 系统配置相关类型定义
// ============================================================

export interface SystemConfig {
  apiKey: string;
  apiBaseUrl?: string;
  defaultModel?: string;
  theme?: 'light' | 'dark' | 'auto';
}

export interface SystemConfigUpdate {
  apiKey?: string;
  apiBaseUrl?: string;
  defaultModel?: string;
  theme?: 'light' | 'dark' | 'auto';
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
