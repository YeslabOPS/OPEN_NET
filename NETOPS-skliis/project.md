# Super Agent 项目规格书

> 网络巡检场景超级代理 (Super Agent) 概念验证项目

---

## 1. 项目概述

### 1.1 项目背景

本项目旨在构建一个面向**网络巡检场景**的 Super Agent 原型系统，作为教学演示用途。

Super Agent 是一种具备自主规划、工具调用和知识增强能力的智能代理系统，能够理解用户意图、制定执行计划、调用外部工具完成任务，并基于知识库提供专业决策支持。

### 1.2 核心定位

- **教学导向**：代码结构清晰，便于理解 Agent 开发的核心概念
- **最小功能集**：聚焦 3 个核心能力，不过度设计
- **可扩展架构**：预留 MCP 工具扩展接口，支持多场景演进

### 1.3 设计理念

基于 Andrej Karpathy 提出的 **LLM Wiki 范式**，本项目采用"编译代替检索"的思路构建知识库，减少对传统 Embedding 向量检索的依赖，降低系统复杂度。

---

## 2. 功能列表

### 2.1 核心功能 (必须实现)

#### Feature 1: RAG 知识库连接

**描述**：Super Agent 能够连接并查询本地知识库，为网络巡检任务提供知识支持。

**技术方案**：
- 采用 **Karpathy LLM Wiki 范式**（编译代替检索）
- 知识库采用 Markdown 文件格式存储，支持分层结构
- 提供知识库 CRUD 操作接口
- 支持自然语言问答查询

**目录结构**：
```
knowledge_base/
├── raw/                    # 原始文档层
├── wiki/                   # LLM 编译后的结构化 Wiki
└── index.json              # 索引文件
```

**能力边界**：
- ✅ 支持多文档编译
- ✅ 支持自然语言问答
- ✅ 支持知识库增删改查
- ❌ 暂不支持多模态（图片/视频）
- ❌ 暂不支持外部知识库（Notion/Obsidian）同步

---

#### Feature 2: 任务规划与执行

**描述**：Super Agent 具备任务规划能力，能够将用户指令分解为可执行的子任务，并按计划顺序执行。

**核心能力**：
- **意图理解**：解析用户自然语言指令，识别任务类型
- **任务分解**：将复杂任务分解为有序的子任务
- **执行调度**：按计划顺序执行子任务，支持条件分支
- **结果汇总**：整合各子任务执行结果，生成最终输出

**执行流程**：
```
用户指令
    │
    ▼
┌─────────────────┐
│   意图理解层     │  ← 识别任务类型、提取关键参数
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   任务规划层     │  ← 分解子任务、生成执行计划
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   执行调度层     │  ← 按计划执行、调用工具、处理异常
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   结果汇总层     │  ← 整合输出、生成报告
└─────────────────┘
```

**能力边界**：
- ✅ 支持单轮任务规划与执行
- ✅ 支持多步任务分解（3-5 步）
- ✅ 支持执行结果回传
- ❌ 暂不支持复杂的多 Agent 协作
- ❌ 暂不支持任务暂停/恢复

---

#### Feature 3: MCP 工具配置与管理

**描述**：Super Agent 支持通过 MCP (Model Context Protocol) 协议配置和调用本地工具，实现与外部系统的交互。

**核心能力**：
- **工具注册**：动态注册可用的 MCP 工具
- **工具发现**：Agent 自动发现可用工具列表
- **工具调用**：按需调用指定工具执行操作
- **SSH 工具**：内置 SSH 连接工具，支持远程网络设备操作

**内置工具**：
| 工具名称 | 功能描述 | 参数 |
|---------|---------|------|
| `ssh_connect` | 建立 SSH 连接 | host, port, username, password/key |
| `ssh_execute` | 执行远程命令 | connection_id, command |
| `ssh_disconnect` | 断开 SSH 连接 | connection_id |
| `file_read` | 读取本地文件 | file_path |
| `file_write` | 写入本地文件 | file_path, content |

**MCP 扩展接口**：
- 提供标准 MCP Server 接口规范
- 支持第三方 MCP 工具按规范接入

**能力边界**：
- ✅ 内置 SSH 工具满足基本需求
- ✅ 支持动态工具注册
- ✅ 提供 MCP 扩展规范
- ❌ 暂不实现完整的 MCP Server 运行时
- ❌ 暂不支持 MCP 客户端连接

---

### 2.2 辅助功能 (项目必需但对用户透明)

| 功能 | 说明 | 必要性理由 |
|------|------|-----------|
| 会话管理 | 管理 Agent 对话历史上下文 | 教学项目，仅需要adk默认session的记忆 |
| 日志记录 | 记录 Agent 执行过程 | 教学调试、问题排查 |
| 配置管理 | 管理 Agent 参数、知识库路径、工具配置 | 环境一致性 |
| 错误处理 | 统一异常捕获与处理 | 系统稳定性 |

---

## 3. 技术栈

### 3.1 后端技术栈

| 层级 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| **Agent 框架** | Google ADK | latest | 多 Agent 编排核心框架 |
| **编程语言** | Python | 3.11+ | ADK 原生支持，便于工具开发 |
| **LLM 调用** | DeepSeek API | - | 国内可用，成本低，效果好 |
| **配置管理** | Pydantic Settings | latest | 类型安全配置 |
| **SSH 连接** | Paramiko | latest | Python SSH 客户端 |
| **HTTP 服务** | FastAPI | latest | 提供 REST API 接口 |
| **WebSocket** | FastAPI + WebSocket | - | 支持流式响应 |
| **配置管理** | Pydantic Settings | latest | 类型安全配置 |

**后端目录结构**：
```
backend/
├── main.py                 # 应用入口
├── agent/                  # Agent 核心模块
│   ├── __init__.py
│   ├── agent.py            # Agent 定义
│   ├── planner.py          # 任务规划器
│   └── executor.py          # 执行调度器
├── tools/                  # 工具模块
│   ├── __init__.py
│   ├── ssh_tool.py         # SSH 工具
│   └── file_tool.py        # 文件操作工具
├── knowledge/              # 知识库模块
│   ├── __init__.py
│   ├── wiki_engine.py      # Wiki 引擎
│   └── rag.py              # RAG 查询
├── api/                    # API 层
│   ├── __init__.py
│   ├── routes.py           # REST 路由
│   └── schemas.py          # 请求/响应模型
└── config.py               # 配置
```

### 3.2 前端技术栈

| 层级 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| **框架** | React | 18+ | 主流前端框架 |
| **构建工具** | Vite | 5+ | 快速开发体验 |
| **UI 库** | Ant Design | 5+ | 企业级组件库 |
| **状态管理** | Zustand | latest | 轻量状态管理 |
| **HTTP 客户端** | Axios | latest | API 调用 |
| **Markdown 渲染** | react-markdown | latest | Wiki 内容渲染 |

**前端目录结构**：
```
frontend/
├── src/
│   ├── main.jsx            # 入口
│   ├── App.jsx             # 根组件
│   ├── pages/              # 页面
│   │   ├── Chat.jsx        # 对话页面
│   │   └── Knowledge.jsx   # 知识库管理
│   ├── components/         # 组件
│   │   ├── AgentChat.jsx   # Agent 对话组件
│   │   ├── PlanView.jsx    # 执行计划展示
│   │   └── ToolPanel.jsx   # 工具管理面板
│   ├── api/                # API 调用
│   │   └── agent.js        # Agent API
│   ├── store/              # 状态管理
│   │   └── useAgentStore.js
│   └── styles/             # 样式
└── index.html
```

### 3.3 技术选型理由

| 组件 | 选择理由 |
|------|---------|
| **Google ADK** | Google 官方 Agent 开发框架，支持多 Agent 层级编排，与本项目需求高度契合 |
| **FastAPI** | 现代 Python Web 框架，类型安全，自动 API 文档 |
| **React + Ant Design** | 成熟生态，组件丰富，适合快速构建管理界面 |
| **DeepSeek API** | 国内可用，API 稳定，成本低，适合教学场景 |
| **Paramiko** | Python SSH 事实标准，稳定可靠 |

---

## 4. 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (React)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  对话界面    │  │ 知识库管理   │  │  执行计划可视化          │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后端 API (FastAPI)                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Agent API                                 ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     ││
│  │  │ 意图理解  │→│ 任务规划  │→│ 执行调度  │→│ 结果汇总  │     ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   知识库模块     │  │   工具模块       │  │   LLM 模块       │
│   (Karpathy     │  │   (MCP 协议)     │  │   DeepSeek API   │
│    LLM Wiki)    │  │   ┌─────────┐   │  │                  │
│                 │  │   │ SSH工具 │   │  │                  │
│  ┌───────────┐  │  │   │ ┌─────┐ │   │  │                  │
│  │knowledge_ │  │  │   │ │ssh_ │ │   │  │                  │
│  │base/      │  │  │   │ │exec │ │   │  │                  │
│  │├── raw/   │  │  │   │ └─────┘ │   │  │                  │
│  │├── wiki/  │  │  │   └─────────┘   │  │                  │
│  │└── index  │  │  │                 │  │                  │
│  └───────────┘  │  └─────────────────┘  └─────────────────┘
└─────────────────┘
```

---

## 5. API 接口设计 (概要)

### 5.1 Agent 对话

```
POST /api/agent/chat
Request:  { "message": "检查核心路由器的CPU状态" }
Response: { "response": "...", "plan": [...], "tools_used": [...] }
```

### 5.2 知识库操作

```
GET    /api/knowledge/list          # 列出文档
POST   /api/knowledge/compile       # 编译文档到 Wiki
GET    /api/knowledge/query         # 查询知识库
DELETE /api/knowledge/{doc_id}      # 删除文档
```

### 5.3 工具管理

```
GET    /api/tools/list              # 列出可用工具
POST   /api/tools/execute            # 执行工具
GET    /api/tools/ssh/status        # SSH 连接状态
```

---

## 6. 部署架构

### 6.1 开发环境

```
前端: localhost:5173 (Vite Dev Server)
后端: localhost:8000 (FastAPI)
LLM:  DeepSeek API (云端)
```

### 6.2 启动顺序

1. 配置 DeepSeek API Key（环境变量 `DEEPSEEK_API_KEY`）
2. 启动后端 (`uv run fastapi dev backend/main.py`)
3. 启动前端 (`cd frontend && npm run dev`)

---

## 7. 项目里程碑

| 阶段 | 目标 | 交付物 |
|------|------|--------|
| M1 | Agent 基础框架搭建 | ADK Agent 初始化、基础对话能力 |
| M2 | 知识库模块实现 | Karpathy LLM Wiki 集成、RAG 查询 |
| M3 | SSH 工具集成 | MCP SSH 工具注册、远程命令执行 |
| M4 | 任务规划能力 | Planner 实现、多步任务分解 |
| M5 | 前端界面开发 | React 对话界面、计划可视化 |
| M6 | 集成联调 | 端到端功能验证 |

---

## 8. 附录

### 8.1 参考资料

- [Google ADK 官方文档](https://adk.dev/)
- [Karpathy LLM Wiki 范式](https://blog.riba2534.cn/blog/2026/karpathy%E7%9A%84llm%E7%9F%A5%E8%AF%86%E5%BA%93-%E7%94%A8%E5%A4%A7%E6%A8%A1%E5%9E%8B%E7%BC%96%E8%AF%91%E4%BD%A0%E7%9A%84%E4%B8%AA%E4%BA%BAwiki/)
- [Agentic RAG 与 MCP 架构](https://cloud.tencent.com/developer/article/2627160)

### 8.2 术语表

| 术语 | 说明 |
|------|------|
| Super Agent | 超级代理，具备规划、推理、工具调用能力的智能体 |
| MCP | Model Context Protocol，模型上下文协议 |
| RAG | Retrieval-Augmented Generation，检索增强生成 |
| LLM Wiki | Karpathy 提出的知识库编译范式 |
| ADK | Agent Development Kit，Google Agent 开发套件 |

---

*文档版本: v1.0*
*创建日期: 2026-05-12*
