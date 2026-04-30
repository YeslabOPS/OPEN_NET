import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { connectDatabase } from './lib/prisma.js';

// 路由
import agentsRouter from './routes/agents.js';
import skillsRouter from './routes/skills.js';
import conversationsRouter from './routes/conversations.js';
import configRouter from './routes/config.js';
import chatRouter from './routes/chat.js';
import importRouter from './routes/import.js';
import inspectionRouter from './routes/inspection.js';

// 加载环境变量
config();

const app = express();
const PORT = process.env.PORT || 8000;

// 中间件
app.use(cors());
app.use(express.json());

// 路由占位
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api', (_req, res) => {
  res.json({
    name: 'NetOps Agent Skills API',
    version: '0.1.0',
    endpoints: {
      health: '/api/health',
      agents: '/api/agents',
      skills: '/api/skills',
      conversations: '/api/conversations',
      config: '/api/config',
    },
  });
});

// 挂载路由
app.use('/api/agents', agentsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/config', configRouter);
app.use('/api/chat', chatRouter);
app.use('/api/skills', importRouter); // Skill 导入路由
app.use('/api/inspection', inspectionRouter); // 批量巡检路由

// 启动服务器
async function startServer() {
  try {
    await connectDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📚 API docs available at http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
