import { Router, Request, Response } from 'express';
import { runPython } from '../pythonBridge';

export const devicesRouter = Router();

// GET /api/devices
devicesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const output = await runPython('api/runner.py', ['devices']);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/devices - 添加设备（参数 Base64 编码）
devicesRouter.post('/', async (req: Request, res: Response) => {
  const { name, host, port, username, password, device_type, secret, description, protocol } = req.body;
  if (!name || !host || !username || !password || !device_type) {
    return res.status(400).json({ success: false, error: '缺少必填字段: name, host, username, password, device_type' });
  }
  try {
    const b64 = Buffer.from(JSON.stringify([name, host, String(port || 22), username, password, device_type, secret || '', description || '', protocol || 'ssh'])).toString('base64');
    const output = await runPython('api/runner.py', ['device_add', b64]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/devices/:host - 更新设备（参数 Base64 编码）
devicesRouter.put('/:host', async (req: Request, res: Response) => {
  const { name, port, username, password, device_type, secret, description, protocol } = req.body;
  const host = req.params.host;
  try {
    const b64 = Buffer.from(JSON.stringify([host, name, String(port || ''), username, password, device_type, secret || '', description || '', protocol || ''])).toString('base64');
    const output = await runPython('api/runner.py', ['device_update', b64]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/devices/:host - 删除设备（支持 ?port= 参数区分同名IP设备）
devicesRouter.delete('/:host', async (req: Request, res: Response) => {
  const host = req.params.host;
  const port = req.query.port || '0';
  try {
    const b64 = Buffer.from(JSON.stringify([host, String(port)])).toString('base64');
    const output = await runPython('api/runner.py', ['device_delete', b64]);
    res.json(JSON.parse(output));
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
