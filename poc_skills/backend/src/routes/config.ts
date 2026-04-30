import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Validation schemas
const SetConfigSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

// GET /api/config - 获取所有配置
router.get('/', async (_req, res) => {
  try {
    const configs = await prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
    
    res.json({ success: true, data: configs });
  } catch (error) {
    console.error('Failed to fetch config:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch config' });
  }
});

// GET /api/config/:key - 获取单个配置
router.get('/:key', async (req, res) => {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: req.params.key },
    });
    
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found' });
    }
    
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Failed to fetch config:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch config' });
  }
});

// POST /api/config - 设置配置（创建或更新）
router.post('/', async (req, res) => {
  try {
    const data = SetConfigSchema.parse(req.body);
    
    const config = await prisma.systemConfig.upsert({
      where: { key: data.key },
      update: { value: data.value },
      create: { key: data.key, value: data.value },
    });
    
    res.json({ success: true, data: config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to set config:', error);
    res.status(500).json({ success: false, error: 'Failed to set config' });
  }
});

// DELETE /api/config/:key - 删除配置
router.delete('/:key', async (req, res) => {
  try {
    await prisma.systemConfig.delete({
      where: { key: req.params.key },
    });
    
    res.json({ success: true, message: 'Config deleted' });
  } catch (error) {
    console.error('Failed to delete config:', error);
    res.status(500).json({ success: false, error: 'Failed to delete config' });
  }
});

export default router;
