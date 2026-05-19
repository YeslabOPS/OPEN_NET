import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(PROJECT_ROOT, 'config', '.ai_sessions');

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionData {
  id: string;
  title: string;
  messages: SessionMessage[];
  selectedDevices?: any[];
  loadedSkills?: string[];
  loadedTopo?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getFilePath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const sessionsStore = {
  /** 列出所有会话（摘要信息，不含完整消息内容） */
  list(): SessionSummary[] {
    ensureDir();
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    return files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
        return {
          id: path.basename(f, '.json'),
          title: data.title || '未命名会话',
          createdAt: data.createdAt || 0,
          updatedAt: data.updatedAt || 0,
          messageCount: (data.messages || []).length,
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as SessionSummary[];
  },

  /** 获取单个会话完整数据 */
  get(id: string): SessionData | null {
    ensureDir();
    const filePath = getFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { id, ...data };
    } catch {
      return null;
    }
  },

  /** 创建新会话 */
  create(title: string): SessionData {
    ensureDir();
    const id = generateId();
    const now = Date.now();
    const session: SessionData = {
      id,
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(getFilePath(id), JSON.stringify(session, null, 2), 'utf-8');
    return session;
  },

  /** 更新会话 */
  update(id: string, updates: Partial<SessionData>): SessionData | null {
    ensureDir();
    const filePath = getFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      Object.assign(data, updates, { updatedAt: Date.now() });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { id, ...data };
    } catch {
      return null;
    }
  },

  /** 删除会话 */
  delete(id: string): boolean {
    const filePath = getFilePath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  },
};
