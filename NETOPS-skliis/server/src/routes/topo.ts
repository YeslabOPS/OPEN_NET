import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const topoRouter = Router();

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const TOPOS_DIR = path.join(PROJECT_ROOT, 'topos');

// 确保 topos 目录存在
if (!fs.existsSync(TOPOS_DIR)) {
  fs.mkdirSync(TOPOS_DIR, { recursive: true });
}

/**
 * POST /api/topo/upload
 * 上传 .topo 拓扑文件（Base64）
 */
topoRouter.post('/upload', async (req: Request, res: Response) => {
  const { filename, content } = req.body;
  if (!filename || !content) {
    res.status(400).json({ success: false, error: '缺少参数: filename, content' });
    return;
  }

  // 安全检查：只允许 .topo 文件
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.topo') {
    res.status(400).json({ success: false, error: '仅支持 .topo 文件' });
    return;
  }

  try {
    const safeName = path.basename(filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]/g, ''));
    const filepath = path.join(TOPOS_DIR, safeName);

    // 文件存在检查（不在安全验证范围，只做提示）
    // 写入文件
    fs.writeFileSync(filepath, content, 'utf-8');

    // 调用 Python 解析器获取摘要
    const { runPython } = require('../pythonBridge');
    const output = await runPython('api/runner.py', ['ensp_load_topology', filepath]);
    const parseResult = JSON.parse(output);

    if (parseResult.success) {
      const summary = parseResult.data.summary;
      res.json({
        success: true,
        data: {
          filename: safeName,
          path: filepath,
          devices_count: summary.devices_count,
          connections_count: summary.connections_count,
          configurable_devices: summary.configurable_devices,
        },
      });
    } else {
      // 文件保存成功但解析失败，仍返回基本信息
      res.json({
        success: true,
        data: {
          filename: safeName,
          path: filepath,
          devices_count: 0,
          connections_count: 0,
          warning: parseResult.error,
        },
      });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: `上传失败: ${e.message}` });
  }
});

/**
 * GET /api/topo/list
 * 获取已上传的拓扑文件列表
 */
topoRouter.get('/list', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(TOPOS_DIR)) {
      res.json({ success: true, data: [] });
      return;
    }
    const files = fs.readdirSync(TOPOS_DIR)
      .filter(f => f.endsWith('.topo'))
      .map(f => {
        const fp = path.join(TOPOS_DIR, f);
        return {
          filename: f,
          path: fp,
          size: fs.statSync(fp).size,
          modified: fs.statSync(fp).mtimeMs,
        };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json({ success: true, data: files });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
