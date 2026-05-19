import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';
import { WebSocket } from 'ws';
import { runPython } from './pythonBridge';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface SessionInfo {
  ws: WebSocket;
  process: ChildProcess;
  deviceHost: string;
  keySocket: net.Socket | null;   // TCP socket for sending keystrokes
}

const sessions = new Map<WebSocket, SessionInfo>();

/**
 * 处理新的 WebSocket 连接
 */
export function handleConnection(ws: WebSocket) {
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(ws, msg);
    } catch {
      // 非 JSON 数据忽略
    }
  });

  ws.on('close', () => cleanupSession(ws));
  ws.on('error', () => cleanupSession(ws));

  ws.send(JSON.stringify({
    type: 'system',
    data: 'WebSocket 已连接\n请选择设备并点击"连接设备"开始交互式会话'
  }));
}

/**
 * 处理消息分派
 */
async function handleMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case 'connect':
      ws.send(JSON.stringify({
        type: 'system',
        data: `正在连接 ${msg.device?.host || '设备'} ...`
      }));
      await startSession(ws, msg.device);
      break;
    case 'key':
      sendKey(ws, msg.data);
      break;
    case 'disconnect':
      cleanupSession(ws);
      ws.send(JSON.stringify({ type: 'system', data: '会话已断开' }));
      break;
    default:
      break;
  }
}

/**
 * 启动 Python 交互会话进程
 */
async function startSession(ws: WebSocket, device: any) {
  cleanupSession(ws);

  const host = device?.host;
  const port = device?.port;
  // 始终从 YAML 查询完整凭证（覆盖前端传入的 host-only 对象）
  if (host) {
    try {
      const safePort = (port !== undefined && port !== null) ? port : 0;
      // 使用独立的 HTTP fetch 查询凭证（不走 pythonBridge 的 base64 编码路径）
      const FASTAPI_PORT = parseInt(process.env.FASTAPI_PORT || '3002', 10);
      const credUrl = `http://127.0.0.1:${FASTAPI_PORT}/api/devices/credentials?host=${encodeURIComponent(host)}&port=${safePort}`;
      try {
        const credRes = await fetch(credUrl, { signal: AbortSignal.timeout(5000) });
        if (credRes.ok) {
          const credResult: any = await credRes.json();
          if (credResult.success && credResult.data) {
            device = { ...device, ...credResult.data };
          }
        }
      } catch {
        // FastAPI 不可用，走 exec 回退
        const b64 = Buffer.from(JSON.stringify([host, safePort])).toString('base64');
        const out = await runPython('api/runner.py', ['device_credentials', b64]);
        const credResult = JSON.parse(out);
        if (credResult.success) {
          device = { ...device, ...credResult.data };
        }
      }
    } catch {
      // 凭证查询失败
    }
  }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.resolve(PROJECT_ROOT, 'api/interactive_session.py');
  const deviceB64 = Buffer.from(JSON.stringify(device)).toString('base64');

  const proc = spawn(pythonCmd, [scriptPath, deviceB64], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONWARNINGS: 'ignore',
    },
  });

  const session: SessionInfo = {
    ws,
    process: proc,
    deviceHost: host || device?.host || 'unknown',
    keySocket: null,
  };
  sessions.set(ws, session);

  // 处理 Python stdout
  let lineBuffer = '';
  proc.stdout!.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line.trim());
          forwardMessage(ws, msg, session);
        } catch {
          // 非 JSON 行忽略
        }
      }
    }
  });

  const flushBuffer = () => {
    if (lineBuffer.trim()) {
      try {
        const msg = JSON.parse(lineBuffer.trim());
        forwardMessage(ws, msg, session);
      } catch {}
    }
  };

  proc.on('exit', () => {
    flushBuffer();
    ws.send(JSON.stringify({ type: 'system', data: '会话已结束' }));
    sessions.delete(ws);
  });

  proc.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', data: `进程启动失败: ${err.message}` }));
    sessions.delete(ws);
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (!msg) return;
    if (msg.includes('DeprecationWarning') || msg.includes('Python 3.8')) return;
    ws.send(JSON.stringify({ type: 'error', data: msg }));
  });
}

/**
 * 转发 Python 消息到前端，并处理 connected 消息中的 key_port
 */
function forwardMessage(ws: WebSocket, msg: any, session: SessionInfo) {
  switch (msg.type) {
    case 'data':
      ws.send(JSON.stringify({ type: 'data', payload: msg.payload }));
      break;
    case 'connected':
      // 如果 Python 返回了 key_port，建立 TCP 连接用于发送按键
      if (msg.key_port) {
        const sock = net.createConnection({ host: '127.0.0.1', port: msg.key_port }, () => {
          session.keySocket = sock;
        });
        sock.on('error', () => {});
      }
      ws.send(JSON.stringify({ type: 'connected', message: msg.message }));
      break;
    case 'exit':
      ws.send(JSON.stringify(msg));
      break;
    case 'error':
      ws.send(JSON.stringify({ type: 'error', data: msg.data }));
      break;
    default:
      ws.send(JSON.stringify(msg));
  }
}

/**
 * 发送按键——通过 TCP socket 而非 stdin
 */
function sendKey(ws: WebSocket, keyData: string) {
  const session = sessions.get(ws);
  if (!session || session.process.killed) {
    return;
  }
  // 优先通过 TCP socket 发送
  if (session.keySocket && !session.keySocket.destroyed) {
    try {
      session.keySocket.write(keyData);
      return;
    } catch {
      // fallback to stdin
    }
  }
  // 备用：通过 stdin 发送
  try {
    if (session.process.stdin && !session.process.killed) {
      session.process.stdin.write(keyData);
    }
  } catch {
    // ignore
  }
}

/**
 * 清理会话
 */
function cleanupSession(ws: WebSocket) {
  const session = sessions.get(ws);
  if (session) {
    // 关闭 TCP socket
    if (session.keySocket && !session.keySocket.destroyed) {
      try { session.keySocket.destroy(); } catch {}
    }
    try {
      if (session.process.stdin && !session.process.killed) {
        session.process.stdin.end();
      }
    } catch {}
    try {
      if (!session.process.killed) {
        session.process.kill('SIGTERM');
        if (process.platform === 'win32') {
          setTimeout(() => {
            try { if (!session.process.killed) session.process.kill('SIGKILL'); } catch {}
          }, 1000);
        }
      }
    } catch {}
    sessions.delete(ws);
  }
}

/**
 * 获取活跃会话数
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}
