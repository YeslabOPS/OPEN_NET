import { Router, Request, Response } from 'express';
import { sessionsStore, SessionMessage } from '../ai/sessionsStore';

export const sessionsRouter = Router();

/**
 * GET /api/ai/sessions
 * 获取所有会话列表（摘要）
 */
sessionsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const sessions = sessionsStore.list();
    res.json({ success: true, data: sessions });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/ai/sessions
 * 创建新会话
 */
sessionsRouter.post('/', (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    const session = sessionsStore.create(title || '未命名会话');
    res.json({ success: true, data: session });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/ai/sessions/:id
 * 获取单个会话完整数据
 */
sessionsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const session = sessionsStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: '会话不存在' });
      return;
    }
    res.json({ success: true, data: session });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PUT /api/ai/sessions/:id
 * 更新会话内容（messages、选中的设备、技能、拓扑等）
 */
sessionsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const { messages, selectedDevices, loadedSkills, loadedTopo, title } = req.body;
    const updates: any = {};
    if (messages !== undefined) updates.messages = messages;
    if (selectedDevices !== undefined) updates.selectedDevices = selectedDevices;
    if (loadedSkills !== undefined) updates.loadedSkills = loadedSkills;
    if (loadedTopo !== undefined) updates.loadedTopo = loadedTopo;
    if (title !== undefined) updates.title = title;

    const session = sessionsStore.update(req.params.id, updates);
    if (!session) {
      res.status(404).json({ success: false, error: '会话不存在' });
      return;
    }
    res.json({ success: true, data: session });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/ai/sessions/:id
 * 删除会话
 */
sessionsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = sessionsStore.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: '会话不存在' });
      return;
    }
    res.json({ success: true, data: '已删除' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
