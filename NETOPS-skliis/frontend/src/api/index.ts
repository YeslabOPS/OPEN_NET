const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export interface Device {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  device_type: string;
  secret?: string;
  description?: string;
  protocol?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BackupFile {
  filename: string;
  size: number;
  path: string;
}

export interface PingResult {
  target: string;
  reachable: boolean;
  rtt_ms: number;
  packet_loss: number;
}

export interface PortResult {
  target: string;
  port: number;
  open: boolean;
  rtt_ms: number;
}

export interface SkillInfo {
  name: string;
  files: number;
  size: number;
  modified: number;
}

export interface SkillFileNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: SkillFileNode[];
}

export interface DiffResult {
  old_name: string;
  new_name: string;
  added: number;
  removed: number;
  changed_blocks: number;
  has_changes: boolean;
  diff: string[];
}

export interface InspectResult {
  device: string;
  host: string;
  connected: boolean;
  version: string;
  uptime: string;
  sysname: string;
  interface_count: number;
  interface_up: number;
  vlan_count: number;
  cpu: string;
  memory: string;
  backup_success: boolean;
  backup_file: string;
  ping_ok: boolean;
  ping_rtt: number;
  ssh_port_ok: boolean;
  config_changed: boolean;
  diff_summary: string;
  health_score: number;
  errors: string[];
  extra_outputs: string[];
}

export const api = {
  // 设备 CRUD
  getDevices: () => request<ApiResponse<Device[]>>('/devices'),
  addDevice: (d: Omit<Device, 'secret' | 'description'> & { secret?: string; description?: string }) =>
    request<ApiResponse<string>>('/devices', { method: 'POST', body: JSON.stringify(d) }),
  updateDevice: (host: string, d: Partial<Device>) =>
    request<ApiResponse<string>>(`/devices/${encodeURIComponent(host)}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteDevice: (host: string, port?: number) =>
    request<ApiResponse<string>>(`/devices/${encodeURIComponent(host)}?port=${port || 0}`, { method: 'DELETE' }),

  // 备份
  getBackupList: () => request<ApiResponse<BackupFile[]>>('/backup/list'),
  runBackup: () => request<ApiResponse<any>>('/backup/run', { method: 'POST' }),
  runBackupDevice: (host: string) => request<ApiResponse<any>>(`/backup/run/${encodeURIComponent(host)}`, { method: 'POST' }),
  getBackupContent: (filename: string) =>
    request<ApiResponse<string>>(`/backup/content/${encodeURIComponent(filename)}`),
  deleteBackup: (filename: string) =>
    request<ApiResponse<string>>(`/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  setBaseline: (filename: string) =>
    request<ApiResponse<string>>('/backup/baseline', { method: 'POST', body: JSON.stringify({ filename }) }),
  getBaseline: () => request<ApiResponse<string[]>>('/backup/baseline'),
  clearBaseline: (filename?: string) =>
    request<ApiResponse<string>>('/backup/baseline', { method: 'POST', body: JSON.stringify({ action: 'clear', filename: filename || '' }) }),

  // SSH
  sshExecute: (params: {
    host: string; username: string; password: string;
    device_type: string; command: string; port?: number;
  }) => request<ApiResponse<string>>('/ssh/execute', {
    method: 'POST', body: JSON.stringify(params),
  }),

  // 连通性
  ping: (target: string) =>
    request<ApiResponse<PingResult>>('/check/ping', {
      method: 'POST', body: JSON.stringify({ target }),
    }),
  checkPort: (target: string, port: number = 22) =>
    request<ApiResponse<PortResult>>('/check/port', {
      method: 'POST', body: JSON.stringify({ target, port }),
    }),

  // MCP 设备在线检测（统一入口，适用于 eNSP Telnet 设备）
  checkDeviceOnline: (name: string) =>
    request<ApiResponse<string>>('/check/device-online', {
      method: 'POST', body: JSON.stringify({ name }),
    }),

  // 对比
  getDiffList: () => request<ApiResponse<{ filename: string; size: number }[]>>('/diff/list'),
  diffCompare: (old_file: string, new_file: string) =>
    request<ApiResponse<DiffResult>>('/diff/compare', {
      method: 'POST', body: JSON.stringify({ old_file, new_file }),
    }),

  // 巡检
  runInspect: () => request<ApiResponse<InspectResult[]>>('/inspect/run', { method: 'POST' }),
  runInspectDevice: (host: string) => request<ApiResponse<InspectResult[]>>(`/inspect/run/${encodeURIComponent(host)}`, { method: 'POST' }),
  getInspectList: () => request<ApiResponse<{ filename: string; size: number; path: string }[]>>('/inspect/list'),
  deleteInspect: (filename: string) =>
    request<ApiResponse<string>>(`/inspect/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  getInspectTemplate: () => request<ApiResponse<any>>('/inspect/template'),
  setInspectTemplate: (data: any) =>
    request<ApiResponse<string>>('/inspect/template', { method: 'PUT', body: JSON.stringify(data) }),
  deleteInspectTemplate: () => request<ApiResponse<string>>('/inspect/template', { method: 'DELETE' }),

  // 文件
  readFile: (path: string) =>
    request<ApiResponse<string>>(`/file/read?path=${encodeURIComponent(path)}`),

  // AI
  aiChat: (messages: { role: string; content: string }[], loadedSkills?: string[], selectedDevices?: Device[], loadedTopo?: string) =>
    request<ApiResponse<string> & { reasoning?: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, loaded_skills: loadedSkills, selected_devices: selectedDevices, loaded_topo: loadedTopo }),
    }),
  aiConfig: () => request<ApiResponse<any>>('/ai/config'),

  // AI 会话管理（记忆持久化）
  aiListSessions: () => request<ApiResponse<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }[]>>('/ai/sessions'),
  aiCreateSession: (title?: string) => request<ApiResponse<any>>('/ai/sessions', { method: 'POST', body: JSON.stringify({ title: title || '新会话' }) }),
  aiGetSession: (id: string) => request<ApiResponse<any>>(`/ai/sessions/${encodeURIComponent(id)}`),
  aiUpdateSession: (id: string, data: any) =>
    request<ApiResponse<any>>(`/ai/sessions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  aiDeleteSession: (id: string) => request<ApiResponse<string>>(`/ai/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // AI 导出 - 将 AI 回答内容导出为文件
  exportContent: (content: string, format: 'md' | 'html' | 'docx') =>
    request<ApiResponse<{ filename: string; path: string }>>('/ai/export', {
      method: 'POST',
      body: JSON.stringify({ content, format }),
    }),
  getDownloadUrl: (filename: string) => `${API_BASE}/download/${encodeURIComponent(filename)}`,

  // AI 流式对话（SSE）- 实时推送推理过程和回答
  aiChatStream: (
    messages: { role: string; content: string }[],
    callbacks: {
      onReasoning: (text: string) => void;
      onContent: (text: string) => void;
      onDone: () => void;
      onError: (err: string) => void;
    },
    loadedSkills?: string[],
    selectedDevices?: Device[],
    loadedTopo?: string
  ) => {
    const controller = new AbortController();
    const promise = fetch(`${API_BASE}/ai/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        loaded_skills: loadedSkills,
        selected_devices: selectedDevices,
        loaded_topo: loadedTopo,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !response.body) {
        callbacks.onError(`HTTP ${response.status}`);
        callbacks.onDone();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);

          try {
            const event = JSON.parse(payload);
            switch (event.type) {
              case 'reasoning':
                callbacks.onReasoning(event.data);
                break;
              case 'content':
                callbacks.onContent(event.data);
                break;
              case 'error':
                callbacks.onError(event.data);
                break;
              case 'done':
                callbacks.onDone();
                break;
            }
          } catch {}
        }
      }
      callbacks.onDone();
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message);
        callbacks.onDone();
      }
    });

    // 返回 abort 函数
    return () => controller.abort();
  },

  // Topo 拓扑文件上传
  uploadTopo: (filename: string, content: string) =>
    request<ApiResponse<{ filename: string; path: string; devices_count: number; connections_count: number }>>('/topo/upload', {
      method: 'POST', body: JSON.stringify({ filename, content }),
    }),

  // 拓扑详情
  getTopologyInfo: () => request<ApiResponse<any>>('/topo/info'),
  listTopoFiles: () => request<ApiResponse<{ filename: string; path: string; size: number; modified: number }[]>>('/topo/list'),
  loadTopoFile: (filepath: string) =>
    request<ApiResponse<any>>(`/topo/load?filepath=${encodeURIComponent(filepath)}`, { method: 'POST' }),

  // 定时任务调度
  getScheduleList: () => request<ApiResponse<any[]>>('/schedule/list'),
  addSchedule: (data: any) => request<ApiResponse<any>>('/schedule/add', { method: 'POST', body: JSON.stringify(data) }),
  updateSchedule: (data: any) => request<ApiResponse<any>>('/schedule/update', { method: 'POST', body: JSON.stringify(data) }),
  deleteSchedule: (id: string) =>
    request<ApiResponse<string>>(`/schedule/delete?id=${encodeURIComponent(id)}`, { method: 'POST' }),
  triggerSchedule: (id: string) =>
    request<ApiResponse<string>>(`/schedule/trigger?id=${encodeURIComponent(id)}`, { method: 'POST' }),

  // Skills
  getSkills: () => request<ApiResponse<SkillInfo[]>>('/skills'),
  uploadSkill: (name: string, data: string) =>
    request<ApiResponse<any>>('/skills/upload', {
      method: 'POST', body: JSON.stringify({ name, data }),
    }),
  deleteSkill: (name: string) =>
    request<ApiResponse<string>>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getSkillTree: (name: string) =>
    request<ApiResponse<SkillFileNode[]>>(`/skills/${encodeURIComponent(name)}/tree`),
  readSkillFile: (name: string, path: string) =>
    request<ApiResponse<string>>(`/skills/${encodeURIComponent(name)}/read/${encodeURIComponent(path)}`),
};
