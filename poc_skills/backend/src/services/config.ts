import { prisma } from '../lib/prisma.js';

export interface AppConfig {
  deepseek_api_key?: string;
  deepseek_base_url?: string;
  deepseek_model?: string;
}

export class ConfigService {
  async get(key: string): Promise<string | null> {
    const config = await prisma.systemConfig.findUnique({
      where: { key },
    });
    return config?.value || null;
  }

  async set(key: string, value: string): Promise<void> {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getAll(): Promise<Record<string, string>> {
    const configs = await prisma.systemConfig.findMany();
    return configs.reduce((acc, c) => {
      acc[c.key] = c.value;
      return acc;
    }, {} as Record<string, string>);
  }

  async delete(key: string): Promise<void> {
    await prisma.systemConfig.delete({
      where: { key },
    });
  }

  async getDeepSeekConfig(): Promise<AppConfig> {
    const configs = await this.getAll();
    return {
      deepseek_api_key: configs.deepseek_api_key,
      deepseek_base_url: configs.deepseek_base_url || 'https://api.deepseek.com',
      deepseek_model: configs.deepseek_model || 'deepseek-chat',
    };
  }

  async setDeepSeekConfig(config: Partial<AppConfig>): Promise<void> {
    if (config.deepseek_api_key !== undefined) {
      await this.set('deepseek_api_key', config.deepseek_api_key);
    }
    if (config.deepseek_base_url !== undefined) {
      await this.set('deepseek_base_url', config.deepseek_base_url);
    }
    if (config.deepseek_model !== undefined) {
      await this.set('deepseek_model', config.deepseek_model);
    }
  }
}

export const configService = new ConfigService();
