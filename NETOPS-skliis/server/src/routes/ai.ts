import { Router, Request, Response } from 'express';
import { chat } from '../ai/service';
import { streamChat, writeSSE } from '../ai/streamService';

export const aiRouter = Router();

/**
 * POST /api/ai/chat
 * AI 对话接口
 */
aiRouter.post('/chat', async (req: Request, res: Response) => {
  const { messages, config, loaded_skills, selected_devices, loaded_topo } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ success: false, error: 'messages 参数无效' });
    return;
  }

  try {
    const result = await chat({ messages, config, loaded_skills, selected_devices, loaded_topo });
    res.json({ success: result.success, data: result.content, reasoning: result.reasoning, error: result.error });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/ai/chat-stream
 * AI 对话流式接口（SSE）- 实时推送 reasoning 和 content
 */
aiRouter.post('/chat-stream', async (req: Request, res: Response) => {
  const { messages, config, loaded_skills, selected_devices, loaded_topo } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ success: false, error: 'messages 参数无效' });
    return;
  }

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    await streamChat({ messages, config, loaded_skills, selected_devices, loaded_topo }, res);
  } catch (e: any) {
    writeSSE(res, 'error', e.message);
    writeSSE(res, 'done', '');
  } finally {
    res.end();
  }
});

/**
 * GET /api/ai/config
 * 获取当前 AI 配置（前端展示用）
 */
aiRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      provider: process.env.AI_PROVIDER || 'deepseek',
      model: process.env.AI_MODEL || 'deepseek-chat',
      hasApiKey: !!process.env.AI_API_KEY,
    },
  });
});
