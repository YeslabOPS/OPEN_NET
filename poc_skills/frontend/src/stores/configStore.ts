import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SystemConfig {
  apiKey: string;
  apiBaseUrl: string;
  defaultModel: string;
  theme: 'light' | 'dark' | 'auto';
}

interface ConfigState {
  config: SystemConfig;
  isConfigured: boolean;

  // Actions
  updateConfig: (updates: Partial<SystemConfig>) => void;
  setApiKey: (apiKey: string) => void;
  resetConfig: () => void;
}

const defaultConfig: SystemConfig = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com',
  defaultModel: 'deepseek-chat',
  theme: 'light',
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: defaultConfig,
      isConfigured: false,

      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
          isConfigured: !!(state.config.apiKey || updates.apiKey),
        }));
      },

      setApiKey: (apiKey) => {
        set((state) => ({
          config: { ...state.config, apiKey },
          isConfigured: !!apiKey,
        }));
      },

      resetConfig: () => {
        set({ config: defaultConfig, isConfigured: false });
      },
    }),
    {
      name: 'netops-config-storage',
    }
  )
);
