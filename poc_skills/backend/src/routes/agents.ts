import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Validation schemas
const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  modelConfig: z.string().optional(),
  enabled: z.boolean().optional(),
});

const UpdateAgentSchema = CreateAgentSchema.partial();

// GET /api/agents - 获取所有 Agent
router.get('/', async (_req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      include: {
        _count: {
          select: { skills: true, conversations: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: agents });
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agents' });
  }
});

// GET /api/agents/:id - 获取单个 Agent
router.get('/:id', async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: {
        skills: {
          include: { skill: true },
        },
        _count: {
          select: { conversations: true },
        },
      },
    });
    
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agent' });
  }
});

// POST /api/agents - 创建 Agent
router.post('/', async (req, res) => {
  try {
    const data = CreateAgentSchema.parse(req.body);
    
    const agent = await prisma.agent.create({
      data: {
        name: data.name,
        description: data.description,
        systemPrompt: data.systemPrompt,
        modelConfig: data.modelConfig || '{"model":"deepseek-chat"}',
        enabled: data.enabled ?? true,
      },
    });
    
    res.status(201).json({ success: true, data: agent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to create agent:', error);
    res.status(500).json({ success: false, error: 'Failed to create agent' });
  }
});

// PUT /api/agents/:id - 更新 Agent
router.put('/:id', async (req, res) => {
  try {
    const data = UpdateAgentSchema.parse(req.body);
    
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
    });
    
    res.json({ success: true, data: agent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to update agent:', error);
    res.status(500).json({ success: false, error: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:id - 删除 Agent
router.delete('/:id', async (req, res) => {
  try {
    await prisma.agent.delete({
      where: { id: req.params.id },
    });
    
    res.json({ success: true, message: 'Agent deleted' });
  } catch (error) {
    console.error('Failed to delete agent:', error);
    res.status(500).json({ success: false, error: 'Failed to delete agent' });
  }
});

// POST /api/agents/:id/skills - 为 Agent 添加 Skill
router.post('/:id/skills', async (req, res) => {
  try {
    const { skillId, customParams } = req.body;
    
    const agentSkill = await prisma.agentSkill.create({
      data: {
        agentId: req.params.id,
        skillId,
        customParams: customParams || '{}',
      },
      include: { skill: true },
    });
    
    res.status(201).json({ success: true, data: agentSkill });
  } catch (error) {
    console.error('Failed to add skill to agent:', error);
    res.status(500).json({ success: false, error: 'Failed to add skill' });
  }
});

// DELETE /api/agents/:id/skills/:skillId - 从 Agent 移除 Skill
router.delete('/:id/skills/:skillId', async (req, res) => {
  try {
    await prisma.agentSkill.delete({
      where: {
        agentId_skillId: {
          agentId: req.params.id,
          skillId: req.params.skillId,
        },
      },
    });
    
    res.json({ success: true, message: 'Skill removed from agent' });
  } catch (error) {
    console.error('Failed to remove skill from agent:', error);
    res.status(500).json({ success: false, error: 'Failed to remove skill' });
  }
});

export default router;
