# NetOps Agent Skills

面向计算机网络运维领域的智能 Agent 构建与运行平台。

基于 **"Agent + Skills"** 架构理念设计，为网络运维工程师提供低门槛、高可用的方式，通过组合式配置快速构建专属的运维智能助手。

## 核心特性

- **快速组装**：通过可视化界面组合 Skills，无需编程即可构建 Agent
- **灵活扩展**：支持第三方 Skills 包导入，满足个性化运维场景
- **安全可控**：所有 LLM 调用基于 DeepSeek API，数据不出境
- **开箱即用**：预置网络运维巡检场景，上线即可使用

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端 | React 18 + TypeScript + Ant Design 5 + Zustand |
| 后端 | Node.js 20 + Express + Prisma |
| LLM | DeepSeek API |
| 数据库 | SQLite (开发) / PostgreSQL (生产) |

## 项目结构

```
netops-agent-skills/
├── shared/               # 共享类型和工具库
│   └── src/types/        # TypeScript 类型定义
├── backend/              # 后端服务
│   ├── prisma/           # 数据库模型
│   └── src/              # 源代码
└── frontend/             # 前端应用
    └── src/              # React 源代码
```

## 快速开始

### 前置要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0

### 安装依赖

```bash
# 安装所有依赖
pnpm install
```

### 后端启动

```bash
cd backend

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 生成 Prisma 客户端
pnpm prisma generate

# 初始化数据库
pnpm prisma db push

# 启动开发服务器
pnpm dev
```

### 前端启动

```bash
cd frontend
pnpm dev
```

## 四大核心模块

1. **Agent 组装模块** - 将系统提示词与 Skills 组合生成 Agent 实例
2. **Skills 导入模块** - 管理 Skills 包的导入、验证、存储与分发
3. **聊天组装模块** - 提供用户与 Agent 交互的界面
4. **系统管理模块** - 系统级配置、管理与监控

## 业务场景

### 网络设备巡检（核心场景）

构建网络巡检助手，实现：
- 通过 SSH 连接网络设备
- 执行 CLI 命令（show version, show interface 等）
- 解析输出并生成巡检报告

### 扩展场景

- 告警根因分析
- 配置合规检查

## API 文档

后端服务启动后访问：`http://localhost:8000/api`

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET/POST /api/agents` | Agent 管理 |
| `GET/POST /api/skills` | Skill 管理 |
| `POST /api/chat` | 聊天对话 |

## 许可证

MIT License
