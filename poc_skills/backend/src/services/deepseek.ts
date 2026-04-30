import axios, { AxiosInstance } from 'axios';
import { prisma } from '../lib/prisma.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finishReason: string;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class DeepSeekService {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      timeout: 60000,
    });
  }

  private async getConfig() {
    try {
      const configs = await prisma.systemConfig.findMany();
      const configMap = new Map(configs.map(c => [c.key, c.value]));
      
      if (configMap.has('deepseek_api_key')) {
        this.apiKey = configMap.get('deepseek_api_key')!;
      }
      if (configMap.has('deepseek_base_url')) {
        this.baseUrl = configMap.get('deepseek_base_url')!;
        this.client.defaults.baseURL = `${this.baseUrl}/chat/completions`;
      }
      if (configMap.has('deepseek_model')) {
        this.model = configMap.get('deepseek_model')!;
      }
    } catch (error) {
      console.warn('Failed to load config from database, using env defaults');
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    await this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('DeepSeek API is not configured. Please set API key.');
    }

    const response = await this.client.post<ChatCompletionResponse>('', {
      model: options.model || this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    });

    return response.data;
  }

  async chatStream(
    options: ChatCompletionOptions,
    onChunk: (content: string) => void
  ): Promise<void> {
    await this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('DeepSeek API is not configured. Please set API key.');
    }

    const response = await this.client.post(
      '',
      {
        model: options.model || this.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      },
      {
        responseType: 'stream',
      }
    );

    const stream = response.data;
    const decoder = new TextDecoder();

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const lines = decoder.decode(chunk).split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      });

      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }
}

export const deepseekService = new DeepSeekService();
