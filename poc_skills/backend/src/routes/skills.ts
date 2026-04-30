import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Validation schemas
const CreateSkillSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  configurations: z.array(z.any()).optional(),
  icon: z.string().optional(),
  enabled: z.boolean().optional(),
  builtIn: z.boolean().optional(),
});

const UpdateSkillSchema = CreateSkillSchema.partial();

// GET /api/skills - 获取所有 Skill
router.get('/', async (req, res) => {
  try {
    const { enabled, search, tags } = req.query;
    
    const where: any = {};
    
    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { description: { contains: search as string } },
      ];
    }
    
    if (tags) {
      const tagList = (tags as string).split(',');
      where.tags = { contains: tagList[0] };
    }
    
    const skills = await prisma.skill.findMany({
      where,
      include: {
        _count: {
          select: { agentSkills: true },
        },
      },
      orderBy: [{ builtIn: 'desc' }, { createdAt: 'desc' }],
    });
    
    res.json({ success: true, data: skills });
  } catch (error) {
    console.error('Failed to fetch skills:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch skills' });
  }
});

// GET /api/skills/:id - 获取单个 Skill
router.get('/:id', async (req, res) => {
  try {
    const skill = await prisma.skill.findUnique({
      where: { id: req.params.id },
      include: {
        agentSkills: {
          include: { agent: true },
        },
      },
    });
    
    if (!skill) {
      return res.status(404).json({ success: false, error: 'Skill not found' });
    }
    
    res.json({ success: true, data: skill });
  } catch (error) {
    console.error('Failed to fetch skill:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch skill' });
  }
});

// POST /api/skills - 创建 Skill
router.post('/', async (req, res) => {
  try {
    const data = CreateSkillSchema.parse(req.body);
    
    const skill = await prisma.skill.create({
      data: {
        name: data.name,
        version: data.version,
        description: data.description,
        author: data.author,
        tags: JSON.stringify(data.tags || []),
        tools: JSON.stringify(data.tools || []),
        configurations: JSON.stringify(data.configurations || []),
        icon: data.icon,
        enabled: data.enabled ?? true,
        builtIn: data.builtIn ?? false,
      },
    });
    
    res.status(201).json({ success: true, data: skill });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to create skill:', error);
    res.status(500).json({ success: false, error: 'Failed to create skill' });
  }
});

// PUT /api/skills/:id - 更新 Skill
router.put('/:id', async (req, res) => {
  try {
    const data = UpdateSkillSchema.parse(req.body);
    
    const updateData: any = { ...data };
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.tools !== undefined) updateData.tools = JSON.stringify(data.tools);
    if (data.configurations !== undefined) updateData.configurations = JSON.stringify(data.configurations);
    
    const skill = await prisma.skill.update({
      where: { id: req.params.id },
      data: updateData,
    });
    
    res.json({ success: true, data: skill });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to update skill:', error);
    res.status(500).json({ success: false, error: 'Failed to update skill' });
  }
});

// DELETE /api/skills/:id - 删除 Skill
router.delete('/:id', async (req, res) => {
  try {
    await prisma.skill.delete({
      where: { id: req.params.id },
    });
    
    res.json({ success: true, message: 'Skill deleted' });
  } catch (error) {
    console.error('Failed to delete skill:', error);
    res.status(500).json({ success: false, error: 'Failed to delete skill' });
  }
});

export default router;
