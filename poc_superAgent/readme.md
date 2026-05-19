# Super Agent - 网络巡检场景智能代理

> 基于 Google ADK + DeepSeek 的网络巡检 Super Agent 概念验证项目

## 项目概述

本项目构建了一个面向**网络巡检场景**的 Super Agent 原型系统，具备自主规划、工具调用和知识增强能力。

### 核心功能

| 功能 | 说明 |
|------|------|
| **Agent 对话** | 基于 DeepSeek API 的智能对话，支持流式响应 |
| **任务规划** | 自动识别用户意图，分解巡检任务为可执行子步骤 |
| **知识库 RAG** | Karpathy LLM Wiki 范式 + ChromaDB 向量检索 |
| **SSH 工具** | Paramiko 远程连接，支持网络设备命令执行 |
| **设备管理** | 网络设备 CRUD 管理，连接测试 |
| **可视化界面** | React + Ant Design 对话界面，计划可视化 |

## 技术栈

### 后端
- **框架**: Google ADK + FastAPI
- **LLM**: DeepSeek API
- **向量库**: ChromaDB
- **SSH**: Paramiko
- **配置**: Pydantic Settings

### 前端
- **框架**: React 18 + Vite
- **UI 库**: Ant Design 5
- **状态管理**: Zustand
- **Markdown**: react-markdown

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 20+
- DeepSeek API Key

### 1. 后端启动

```bash
# 进入后端目录
cd backend

# 安装依赖（使用 uv）
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 启动服务
uv run uvicorn main:app --reload
```

后端启动在 `http://localhost:8000`

### 2. 前端启动

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端启动在 `http://localhost:5173`

### 3. 启动顺序

1. 配置 `.env` 中的 `DEEPSEEK_API_KEY`
2. 启动后端 (8000 端口)
3. 启动前端 (5173 端口)
4. 打开浏览器访问 `http://localhost:5173`

## API 文档

后端启动后访问 `http://localhost:8000/docs` 查看 Swagger 文档。

### 主要端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/chat` | 对话 |
| POST | `/api/agent/stream` | 流式对话 |
| POST | `/api/agent/plan` | 任务规划 |
| GET | `/api/agent/session/{id}` | 会话信息 |
| GET | `/api/agent/knowledge/list` | 知识库文档列表 |
| POST | `/api/agent/knowledge/compile` | 编译文档 |
| POST | `/api/agent/knowledge/query` | 知识查询 |
| GET | `/api/devices` | 设备列表 |
| POST | `/api/devices` | 添加设备 |
| POST | `/api/devices/test` | 测试连接 |

## 项目结构

```
├── .spec/                  # 项目规格文档
├── backend/                # Python 后端
│   ├── agent/              # Agent 核心（llm/planner/executor）
│   ├── api/                # REST API
│   ├── tools/              # 工具模块（SSH/MCP/Knowledge）
│   ├── knowledge/          # 知识库（Wiki/RAG）
│   ├── knowledge_base/     # 文档存储
│   ├── config.py           # 配置
│   └── main.py             # 入口
├── frontend/               # React 前端
│   └── src/
│       ├── api/            # API 调用
│       ├── components/     # 组件（AgentChat/PlanView）
│       ├── pages/          # 页面（Chat/Knowledge/Devices）
│       ├── store/          # 状态管理
│       └── styles/         # 样式
└── readme.md
```

## 使用示例

### 对话
```
用户: 检查核心路由器的CPU状态
Agent: [识别到网络巡检任务，已分解子计划]
       1. ssh_connect → 建立连接
       2. ssh_execute → 执行 show process cpu
       3. 分析结果 → 生成报告
```

### 知识查询
```
用户: OSPF 邻居状态卡在 INIT 怎么办？
Agent: [搜索知识库]
       可能原因：Hello/Dead 间隔不匹配
       建议：检查两端接口配置
```

## 许可证

MIT
