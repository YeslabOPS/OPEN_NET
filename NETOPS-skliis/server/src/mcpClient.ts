/**
 * MCP 客户端模块
 *
 * 通过 stdio JSON-RPC 与 MCP Server 通信
 * 提供 MCP 工具的 TypeScript 调用接口
 */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const MCP_SCRIPT = path.resolve(__dirname, '../../mcp/run_mcp_server.py');

let mcpProcess: ChildProcess | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: Function; reject: Function }>();
let buffer = '';
let isReady = false;

// 超时时间
const TOOL_TIMEOUT = 60000;

/**
 * 启动 MCP Server 常驻进程
 */
export async function startMCPServer(): Promise<void> {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const mcpDir = path.resolve(__dirname, '../../mcp');

  console.log('[NetOps] 启动 MCP Server 常驻进程...');

  mcpProcess = spawn(pythonCmd, ['-u', MCP_SCRIPT], {
    cwd: mcpDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  // 读取 stdout 响应
  mcpProcess.stdout!.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        const id = msg.id;

        if (id !== undefined && pending.has(id)) {
          const { resolve, reject } = pending.get(id)!;
          pending.delete(id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // 非 JSON 消息（如日志输出），忽略
      }
    }
  });

  // stderr 日志（MCP Server 的日志输出）
  mcpProcess.stderr!.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[MCP] ${msg}`);
  });

  // 进程退出处理
  mcpProcess.on('error', (err) => {
    console.error(`[MCP] 进程错误: ${err.message}`);
  });

  mcpProcess.on('exit', (code, signal) => {
    console.log(`[MCP] 进程退出 (code=${code}, signal=${signal})`);
    mcpProcess = null;
    isReady = false;
    // 清理所有挂起的请求
    for (const [id, { reject }] of pending) {
      reject(new Error('MCP Server 已断开'));
    }
    pending.clear();
    // 非正常退出，3 秒后重启
    if (code !== 0 && signal !== 'SIGTERM') {
      console.log('[MCP] 3 秒后尝试重启...');
      setTimeout(() => startMCPServer(), 3000);
    }
  });

  // 发送初始化请求
  try {
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
    });
    // 发送 initialized 通知
    sendNotification('notifications/initialized');
    isReady = true;

    // 获取可用工具列表并打印
    const toolsResult = await sendRequest('tools/list');
    const toolCount = toolsResult?.tools?.length || 0;
    console.log(`[NetOps] MCP Server 已就绪 (${toolCount} 个工具)`);
  } catch (e: any) {
    console.error(`[NetOps] MCP Server 初始化失败: ${e.message}`);
  }
}

/**
 * 发送 JSON-RPC 通知（无需响应的消息）
 */
function sendNotification(method: string, params: any = {}): void {
  if (!mcpProcess || !mcpProcess.stdin || mcpProcess.killed) return;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  mcpProcess.stdin.write(msg + '\n');
}

/**
 * 发送 JSON-RPC 请求并等待响应
 */
function sendRequest(method: string, params: any = {}): Promise<any> {
  const id = ++requestId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });

  return new Promise((resolve, reject) => {
    if (!mcpProcess || !mcpProcess.stdin || mcpProcess.killed) {
      return reject(new Error('MCP Server 未运行'));
    }

    pending.set(id, { resolve, reject });
    mcpProcess.stdin.write(msg + '\n');

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('MCP 调用超时'));
      }
    }, TOOL_TIMEOUT);
  });
}

/**
 * 调用 MCP 工具
 * @param toolName 工具名称
 * @param args 工具参数
 * @returns 工具返回的文本内容
 */
export async function callMCPTool(toolName: string, args: any = {}): Promise<string> {
  if (!isReady) {
    throw new Error('MCP Server 未就绪');
  }
  const result = await sendRequest('tools/call', { name: toolName, arguments: args });
  if (result?.isError) {
    const text = result?.content?.[0]?.text || '未知错误';
    throw new Error(text);
  }
  return result?.content?.[0]?.text || '';
}

/**
 * 检查 MCP Server 是否就绪
 */
export function isMCPServerReady(): boolean {
  return isReady && mcpProcess !== null && !mcpProcess.killed;
}

/**
 * 关闭 MCP Server
 */
export function stopMCPServer(): void {
  if (mcpProcess) {
    console.log('[NetOps] 正在关闭 MCP Server...');
    const proc = mcpProcess;
    mcpProcess = null;
    isReady = false;
    try {
      proc.kill('SIGTERM');
    } catch {
      try { proc.kill(); } catch { /* ignore */ }
    }
  }
}
