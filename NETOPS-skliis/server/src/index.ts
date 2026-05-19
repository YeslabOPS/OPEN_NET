import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
// 从项目根目录加载 .env 文件
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { runPython, waitForFastApi } from './pythonBridge';
import { startMCPServer, stopMCPServer, isMCPServerReady } from './mcpClient';
import { devicesRouter } from './routes/devices';
import { aiRouter } from './routes/ai';
import { toolHandlers } from './ai/tools';
import { skillsRouter } from './routes/skills';
import { topoRouter } from './routes/topo';
import { sessionsRouter } from './routes/sessions';
import { handleConnection } from './wsSession';

const app = express();
const PORT = 3001;
const DEFAULT_DEVICE_TYPE = 'huawei';

// Python FastAPI 子进程
let fastApiProcess: ChildProcess | null = null;
const FASTAPI_PORT = parseInt(process.env.FASTAPI_PORT || '3002', 10);

/**
 * 启动 FastAPI 常驻服务
 */
function startFastApi(): void {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.resolve(__dirname, '../../api/fastapi_server.py');

  console.log(`[NetOps] 启动 FastAPI Python 常驻服务 (端口 ${FASTAPI_PORT})...`);

  fastApiProcess = spawn(pythonCmd, ['-u', scriptPath], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, FASTAPI_PORT: String(FASTAPI_PORT), PYTHONUNBUFFERED: '1' },
  });

  fastApiProcess.on('error', (err) => {
    console.error(`[NetOps] FastAPI 启动失败: ${err.message}`);
    console.log('[NetOps] 将继续使用 exec 模式（降级运行）');
    fastApiProcess = null;
  });

  fastApiProcess.on('exit', (code, signal) => {
    console.log(`[NetOps] FastAPI 进程退出 (code=${code}, signal=${signal})`);
    fastApiProcess = null;
    // 如果是非正常退出，3 秒后自动重启
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.log('[NetOps] 3 秒后尝试重启 FastAPI...');
      setTimeout(startFastApi, 3000);
    }
  });
}

/**
 * 优雅关闭 FastAPI 进程
 */
function stopFastApi(): void {
  if (fastApiProcess) {
    console.log('[NetOps] 正在关闭 FastAPI 进程...');
    const proc = fastApiProcess;
    fastApiProcess = null;

    // 先尝试 SIGTERM
    if (process.platform === 'win32') {
      proc.kill(); // Windows 上发送 Ctrl+C 效果
    } else {
      proc.kill('SIGTERM');
    }

    // 3秒后强制关闭
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { }
    }, 3000);
  }
}

// ========== 启动 FastAPI ==========
startFastApi();

// 创建 HTTP 服务器（供 Express + WebSocket 共享端口）
const server = http.createServer(app);

// WebSocket 服务器
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleConnection);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 静态文件
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// ============================================================
// 设备 CRUD API
// ============================================================
app.use('/api/devices', devicesRouter);

// ============================================================
// AI 运维助手 API
// ============================================================
app.use('/api/ai', aiRouter);

// ============================================================
// AI 导出 API - 将 AI 内容导出为文件（MD / HTML / DOCX）
// ============================================================
const EXPORT_DIR = path.resolve(__dirname, '../../exports');

app.post('/api/ai/export', async (req, res) => {
  const { content, format } = req.body;
  if (!content) return res.status(400).json({ success: false, error: '缺少 content 参数' });
  if (!['md', 'html', 'docx'].includes(format)) {
    return res.status(400).json({ success: false, error: '不支持的导出格式，可选: md, html, docx' });
  }
  const toolName = `export_to_${format === 'md' ? 'markdown' : format === 'html' ? 'html' : 'docx'}`;
  const handler = toolHandlers[toolName];
  if (!handler) return res.status(400).json({ success: false, error: `未找到导出处理器: ${toolName}` });
  try {
    const result = await handler({ content });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 文件下载 API - 提供导出文件的下载
// ============================================================
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  // 防止路径穿越攻击
  const safeName = path.basename(filename);
  const filepath = path.join(EXPORT_DIR, safeName);
  if (!filepath.startsWith(EXPORT_DIR)) {
    return res.status(403).json({ success: false, error: '不允许的路径' });
  }
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ success: false, error: '文件不存在或已过期' });
  }
  res.download(filepath, safeName);
});

// ============================================================
// Skills 技能包管理 API
// ============================================================
app.use('/api/skills', skillsRouter);

// ============================================================
// eNSP 拓扑文件管理 API
// ============================================================
app.use('/api/topo', topoRouter);

// ============================================================
// AI 会话管理 API（记忆持久化）
// ============================================================
app.use('/api/ai/sessions', sessionsRouter);

// ============================================================
// 备份 API
// ============================================================
app.get('/api/backup/list', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_list']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/backup/run', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_run']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/backup/run/:host', async (req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_run_device', req.params.host]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/backup/content/:filename', async (req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_content', req.params.filename]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/backup/:filename', async (req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_delete', req.params.filename]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 基线管理（支持多个基线）
app.post('/api/backup/baseline', async (req, res) => {
  const { filename, action } = req.body;
  try {
    if (action === 'clear') {
      const fn = filename || '';
      const out = await runPython('api/runner.py', ['backup_clear_baseline', fn]);
      return res.json(JSON.parse(out));
    }
    const output = await runPython('api/runner.py', ['backup_set_baseline', filename]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/backup/baseline', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['backup_get_baseline']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// SSH / Telnet 命令执行 API
// ============================================================
app.post('/api/ssh/execute', async (req, res) => {
  const { host, username, password, device_type, command, port: bodyPort, protocol: bodyProtocol } = req.body;
  try {
    // 从后端 YAML 中查询完整凭证（含 protocol/port）
    let pwd = password;
    let usr = username;
    let dtype = device_type;
    let proto = bodyProtocol || '';
    let port = bodyPort ? String(bodyPort) : '';
    if (host) {
      try {
        const b64 = Buffer.from(JSON.stringify([host, port || '0'])).toString('base64');
        const credOut = await runPython('api/runner.py', ['device_credentials', b64]);
        const cred = JSON.parse(credOut);
        if (cred.success && cred.data) {
          pwd = pwd || cred.data.password;
          usr = usr || cred.data.username;
          dtype = dtype || cred.data.device_type;
          proto = proto || cred.data.protocol || '';
          port = String(cred.data.port || '');
        }
      } catch {}
    }
    const output = await runPython('api/runner.py', [
      'ssh_connect', host, usr || 'admin', pwd || '', dtype || DEFAULT_DEVICE_TYPE,
      command || 'display version', port, proto
    ]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 连通性检测 API
// ============================================================
app.post('/api/check/ping', async (req, res) => {
  const { target } = req.body;
  try {
    const output = await runPython('api/runner.py', ['ping', target]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/check/port', async (req, res) => {
  const { target, port } = req.body;
  try {
    const output = await runPython('api/runner.py', ['port', target, String(port || 22)]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// MCP 设备在线检测 API（统一入口，替换前端 ping+port 双检测）
// ============================================================
app.post('/api/check/device-online', async (req, res) => {
  const { name } = req.body;
  try {
    if (!isMCPServerReady()) {
      return res.json({ success: false, error: 'MCP Server 未就绪' });
    }
    const output = await callMCPTool('test-connectivity', { devices: [name], method: 'telnet', timeout: 5 });
    res.json({ success: true, data: output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 配置对比 API
// ============================================================
app.post('/api/diff/compare', async (req, res) => {
  const { old_file, new_file } = req.body;
  try {
    const out1 = await runPython('api/runner.py', ['backup_content', old_file]);
    const d1 = JSON.parse(out1);
    if (!d1.success) return res.json({ success: false, error: d1.error });
    const out2 = await runPython('api/runner.py', ['backup_content', new_file]);
    const d2 = JSON.parse(out2);
    if (!d2.success) return res.json({ success: false, error: d2.error });
    // 保存到临时文件对比
    const tempDir = path.join(__dirname, '../../backups');
    const tmp1 = path.join(tempDir, `__tmp_cmp_old_${old_file}`);
    const tmp2 = path.join(tempDir, `__tmp_cmp_new_${new_file}`);
    fs.writeFileSync(tmp1, d1.data, 'utf-8');
    fs.writeFileSync(tmp2, d2.data, 'utf-8');
    const output = await runPython('api/runner.py', ['diff_compare', tmp1, tmp2]);
    const result = JSON.parse(output);
    // 清理临时文件
    try { fs.unlinkSync(tmp1); } catch {}
    try { fs.unlinkSync(tmp2); } catch {}
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/diff/list', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['diff_list']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 自动化巡检 API
// ============================================================
app.post('/api/inspect/run', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_run']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/inspect/run/:host', async (req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_run_device', req.params.host]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 巡检模板管理（逗号分隔命令）
app.get('/api/inspect/template', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_template_get']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/inspect/template', async (req, res) => {
  const { commands } = req.body;
  try {
    const output = await runPython('api/runner.py', ['inspect_template_set', commands || '']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/inspect/template', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_template_delete']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/inspect/list', async (_req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_list']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/inspect/:filename', async (req, res) => {
  try {
    const output = await runPython('api/runner.py', ['inspect_delete', req.params.filename]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 文件读取（报告内容）- 仅允许读取备份目录和报告目录中的文件
// ============================================================
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');
const REPORTS_DIR = path.resolve(__dirname, '../../reports');

function isPathSafe(requestedPath: string): boolean {
  const resolved = path.resolve(requestedPath);
  // Windows 下做大小写不敏感比较
  const lowerResolved = resolved.toLowerCase();
  return lowerResolved.startsWith(BACKUPS_DIR.toLowerCase()) || 
         lowerResolved.startsWith(REPORTS_DIR.toLowerCase());
}

app.get('/api/file/read', async (req, res) => {
  const filepath = req.query.path as string;
  if (!filepath) return res.status(400).json({ success: false, error: '缺少 path 参数' });
  if (!isPathSafe(filepath)) {
    return res.status(403).json({ success: false, error: '不允许访问该路径' });
  }
  try {
    const output = await runPython('api/runner.py', ['read_file', filepath]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// FastAPI 代理路由 - 转发 Express 未处理的路由到 FastAPI 服务
// (调度管理、拓扑详情等仅在 FastAPI 中实现的端点)
// ============================================================
const FASTAPI_BASE_URL = `http://127.0.0.1:${FASTAPI_PORT}`;

async function proxyToFastApi(req: express.Request, res: express.Response): Promise<void> {
  try {
    const targetUrl = `${FASTAPI_BASE_URL}${req.originalUrl}`;
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    };
    if (req.method !== 'GET' && req.method !== 'DELETE' && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }
    const response = await fetch(targetUrl, fetchOptions);
    const text = await response.text();
    try {
      res.json(JSON.parse(text));
    } catch {
      res.status(502).json({ success: false, error: `FastAPI 返回非 JSON: ${text.slice(0, 200)}` });
    }
  } catch (e: any) {
    res.status(502).json({ success: false, error: `FastAPI 代理失败: ${e.message}` });
  }
}

// 调度管理
app.all('/api/schedule/*', proxyToFastApi);

// 仅 FastAPI 有的拓扑端点
app.get('/api/topo/info', proxyToFastApi);
app.post('/api/topo/load', proxyToFastApi);
app.get('/api/topo/devices', proxyToFastApi);
app.delete('/api/topo/clear', proxyToFastApi);

// FastAPI 健康检查
app.get('/api/health', proxyToFastApi);
app.get('/api/devices/list', proxyToFastApi);
app.get('/api/devices/credentials', proxyToFastApi);

// 前端路由回退
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

server.listen(PORT, async () => {
  console.log(`[NetOps] 后端服务已启动: http://localhost:${PORT}`);
  console.log(`[NetOps] Python 根目录: ${path.resolve(__dirname, '../..')}`);
  console.log(`[NetOps] WebSocket 服务已启动: ws://localhost:${PORT}/ws`);

  // 启动 MCP Server（AI 运维助手的设备交互层）
  await startMCPServer();

  // 等待 FastAPI 就绪
  const fastApiReady = await waitForFastApi(20000);
  if (fastApiReady) {
    console.log(`[NetOps] FastAPI Python 常驻服务已就绪 (http://127.0.0.1:${FASTAPI_PORT})`);
    console.log(`[NetOps] 运行模式: FastAPI 常驻模式（高性能）+ MCP 常驻模式`);
  } else {
    console.log(`[NetOps] FastAPI 未就绪，使用 exec 降级模式`);
    console.log(`[NetOps] 运行模式: exec 降级模式 + MCP 常驻模式`);
  }
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[NetOps] 正在关闭服务...');
  stopMCPServer();
  stopFastApi();
  server.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopMCPServer();
  stopFastApi();
  server.close();
  process.exit(0);
});
