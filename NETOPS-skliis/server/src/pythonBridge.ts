/**
 * Python Bridge - 混合模式
 *
 * 优先通过 HTTP 请求 FastAPI 常驻服务（端口 3002），
 * 如果 FastAPI 不可用，自动回退到 exec 模式（安全降级）。
 */
import { exec } from 'child_process';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// FastAPI 服务地址
const FASTAPI_HOST = process.env.FASTAPI_HOST || '127.0.0.1';
const FASTAPI_PORT = parseInt(process.env.FASTAPI_PORT || '3002', 10);
const FASTAPI_BASE = `http://${FASTAPI_HOST}:${FASTAPI_PORT}`;

// 缓存：是否检测到 FastAPI 可用
let fastApiAvailable: boolean | null = null; // null = 未检测
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30000; // 30 秒重新检测

// ========== 命令到端点的映射 ==========

interface RouteMapping {
  method: string;
  path: string | ((args: string[]) => string);
  buildParams?: (args: string[]) => Record<string, any>;
}

const COMMAND_TO_API: Record<string, RouteMapping> = {
  // 设备管理
  devices: { method: 'GET', path: '/api/devices/list' },
  device_credentials: {
    method: 'GET', path: '/api/devices/credentials',
    buildParams: (args) => {
      // tools.ts 传入的是 base64([host, port])，需要解码
      let host = args[0] || '';
      let port = 0;
      try {
        const decoded = JSON.parse(Buffer.from(host, 'base64').toString('utf-8'));
        if (Array.isArray(decoded) && decoded.length >= 1) {
          host = decoded[0] || '';
          port = parseInt(decoded[1]) || 0;
        }
      } catch {
        // 如果不是 base64 格式（如直接从 Express 路由调用），按原始参数处理
        port = parseInt(args[1]) || 0;
      }
      return { host, port };
    },
  },
  device_add: {
    method: 'POST', path: '/api/devices/add',
    buildParams: (args) => {
      // args[0] 是 Base64 编码的 JSON 数组
      try {
        const decoded = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf-8'));
        const [name, host, port, username, password, device_type, secret, description, protocol] = decoded;
        return { name, host, port: parseInt(port) || 22, username, password, device_type, secret, description, protocol: protocol || 'ssh' };
      } catch {
        return {};
      }
    },
  },
  device_update: {
    method: 'PUT', path: '/api/devices/update',
    buildParams: (args) => {
      // args[0] 是 Base64 编码的 JSON 数组 [host, name, port, ...]
      try {
        const decoded = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf-8'));
        const [host, name, port, username, password, device_type, secret, description, protocol] = decoded;
        return { host, name, port: port ? parseInt(port) : undefined, username, password, device_type, secret, description, protocol };
      } catch {
        return {};
      }
    },
  },
  device_delete: {
    method: 'DELETE', path: '/api/devices/delete',
    buildParams: (args) => {
      // args[0] 是 Base64 编码的 JSON 数组 [host, port]
      try {
        const decoded = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf-8'));
        const [host, port] = decoded;
        return { host, port: parseInt(port) || 0 };
      } catch {
        return {};
      }
    },
  },

  // 备份
  backup_run: { method: 'POST', path: '/api/backup/run' },
  backup_run_device: {
    method: 'POST', path: (args: string[]) => `/api/backup/run/${encodeURIComponent(args[0] || '')}`,
  },
  backup_list: { method: 'GET', path: '/api/backup/list' },
  backup_content: {
    method: 'GET', path: (args: string[]) => `/api/backup/content/${encodeURIComponent(args[0] || '')}`,
  },
  backup_delete: {
    method: 'DELETE', path: (args: string[]) => `/api/backup/${encodeURIComponent(args[0] || '')}`,
  },
  backup_set_baseline: {
    method: 'POST', path: '/api/backup/baseline',
    buildParams: (args) => ({ filename: args[0] || '', action: 'add' }),
  },
  backup_get_baseline: { method: 'GET', path: '/api/backup/baseline' },
  backup_clear_baseline: {
    method: 'POST', path: '/api/backup/baseline',
    buildParams: (args) => ({ filename: args[0] || '', action: 'clear' }),
  },

  // SSH
  ssh_connect: { method: 'POST', path: '/api/ssh/execute', buildParams: (args) => {
    const [host, username, password, device_type, command, port, protocol] = args;
    return { host, username, password, device_type, command, port: port ? parseInt(port) : undefined, protocol };
  }},
  ssh_connect_batch: { method: 'POST', path: '/api/ssh/batch', buildParams: (args) => {
    const [host, username, password, device_type, commands_json, port, protocol] = args;
    return { host, username, password, device_type, commands: JSON.parse(commands_json || '[]'), port: port ? parseInt(port) : undefined, protocol };
  }},

  // 连通性
  ping: { method: 'POST', path: '/api/check/ping', buildParams: (args) => ({ target: args[0] || '' }) },
  port: { method: 'POST', path: '/api/check/port', buildParams: (args) => ({ target: args[0] || '', port: parseInt(args[1]) || 22 }) },

  // 对比
  diff_compare: { method: 'POST', path: '/api/diff/compare', buildParams: (args) => ({ old_file: args[0] || '', new_file: args[1] || '' }) },
  diff_list: { method: 'GET', path: '/api/diff/list' },

  // 巡检
  inspect_run: { method: 'POST', path: '/api/inspect/run' },
  inspect_run_device: { method: 'POST', path: (args: string[]) => `/api/inspect/run/${encodeURIComponent(args[0] || '')}` },
  inspect_list: { method: 'GET', path: '/api/inspect/list' },
  inspect_delete: { method: 'DELETE', path: (args: string[]) => `/api/inspect/${encodeURIComponent(args[0] || '')}` },
  inspect_template_get: { method: 'GET', path: '/api/inspect/template' },
  inspect_template_set: { method: 'PUT', path: '/api/inspect/template', buildParams: (args) => ({ commands: args[0] || '' }) },
  inspect_template_delete: { method: 'DELETE', path: '/api/inspect/template' },

  // 拓扑
  ensp_load_topology: { method: 'POST', path: (args: string[]) => `/api/topo/load?filepath=${encodeURIComponent(args[0] || '')}` },
  ensp_get_topology_info: { method: 'GET', path: '/api/topo/info' },
  ensp_list_devices: { method: 'GET', path: '/api/topo/devices' },
  ensp_clear_topology: { method: 'DELETE', path: '/api/topo/clear' },

  // 文件
  read_file: { method: 'GET', path: '/api/file/read', buildParams: (args) => ({ path: args[0] || '' }) },
};

// ========== FastAPI HTTP 客户端 ==========

async function callFastApi(command: string, args: string[] = []): Promise<string> {
  const mapping = COMMAND_TO_API[command];
  if (!mapping) {
    throw new Error(`FastAPI 未映射命令: ${command}`);
  }

  const mappingPath = mapping.path;
  const pathStr = typeof mappingPath === 'function' ? mappingPath(args) : mappingPath;
  const url = `${FASTAPI_BASE}${pathStr}`;

  let body: Record<string, any> | undefined;
  let queryParams: string = '';

  if (mapping.buildParams) {
    const params = mapping.buildParams(args);

    if (mapping.method === 'GET' || mapping.method === 'DELETE') {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.set(k, String(v));
        }
      }
      queryParams = searchParams.toString();
    } else {
      body = params;
    }
  }

  const fullUrl = queryParams ? `${url}?${queryParams}` : url;

  try {
    const response = await fetch(fullUrl, {
      method: mapping.method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(300000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`FastAPI HTTP ${response.status}: ${text}`);
    }

    const result = await response.json();
    return JSON.stringify(result);
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error('FastAPI 请求超时');
    }
    throw e;
  }
}

// ========== exec 回退模式 ==========

function callExec(command: string, args: string[] = []): Promise<string> {
  const script = 'api/runner.py';
  const scriptPath = path.resolve(PROJECT_ROOT, script);
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  return new Promise((resolve, reject) => {
    // 对于 base64 JSON 参数的命令，需要特殊处理
    let cmdArgs: string[];
    if (['device_add', 'device_update', 'device_delete', 'device_credentials'].includes(command)) {
      // arg[0] 已经是调用方编码好的 base64 JSON 字符串（或编码前的原始值），直接透传
      const b64 = args[0] || '';
      cmdArgs = [command, b64];
    } else {
      cmdArgs = [command, ...args];
    }

    const escapedArgs = cmdArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
    const cmd = `"${pythonCmd}" "${scriptPath}" ${escapedArgs}`;

    exec(cmd, {
      cwd: PROJECT_ROOT,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300000,
    }, (error, stdout, stderr) => {
      if (error) {
        if (stdout && stdout.includes('"success"')) {
          const start = stdout.indexOf('{');
          const end = stdout.lastIndexOf('}');
          if (start >= 0 && end > start) {
            const jsonStr = stdout.substring(start, end + 1);
            try {
              JSON.parse(jsonStr);
              return resolve(jsonStr);
            } catch { }
          }
        }
        return reject(new Error(stderr || error.message));
      }
      const start = stdout.indexOf('{');
      const end = stdout.lastIndexOf('}');
      if (start >= 0 && end > start) {
        resolve(stdout.substring(start, end + 1));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ========== 健康检查 ==========

async function checkFastApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FASTAPI_BASE}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data: any = await response.json();
      return data.success === true;
    }
    return false;
  } catch {
    return false;
  }
}

// ========== 对外接口 ==========

/**
 * 调用 Python 脚本并获取 JSON 输出
 * 优先使用 FastAPI（如果可用），否则回退到 exec
 */
export async function runPython(script: string, args: string[] = []): Promise<string> {
  const command = args[0] || '';

  // 如果 FastAPI 之前可用，直接调用
  if (fastApiAvailable) {
    try {
      const result = await callFastApi(command, args.slice(1));
      return result;
    } catch (e: any) {
      console.warn(`[pythonBridge] FastAPI 调用失败 (${command}): ${e.message}，回退到 exec`);
      fastApiAvailable = false;
    }
  }

  // FastAPI 不可用或第一次失败 → 使用 exec
  return callExec(command, args.slice(1));
}

/**
 * 检查 FastAPI 是否可用
 */
export async function isFastApiAvailable(): Promise<boolean> {
  if (fastApiAvailable === null || Date.now() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
    fastApiAvailable = await checkFastApiHealth();
    lastHealthCheck = Date.now();
  }
  return fastApiAvailable;
}

/**
 * 等待 FastAPI 就绪（带超时）
 */
export async function waitForFastApi(timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFastApiHealth()) {
      fastApiAvailable = true;
      lastHealthCheck = Date.now();
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  fastApiAvailable = false;
  return false;
}
