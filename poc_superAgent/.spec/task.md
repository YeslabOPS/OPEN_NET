# Super Agent POC - 任务拆分文档

> 本文档用于快速理解项目进度和当前阶段，新 session 可直接阅读此文件跟进。

---

## Phase 1: 项目初始化

### 1.1 创建后端项目结构
- [x] 使用 uv init 初始化 Python 后端项目，创建 backend/ 目录
- [x] 创建 backend/ 子目录结构：
  ```
  backend/
  ├── agent/           # Agent 核心模块
  ├── tools/           # 工具模块
  ├── knowledge/       # 知识库模块
  ├── api/             # API 层
  └── config.py        # 配置
  ```
- [x] 在每个子目录创建 `__init__.py` 文件

### 1.2 创建前端项目结构
- [x] 使用 Vite + React 初始化前端项目 `npm create vite@latest frontend -- --template react`
- [x] 创建前端目录结构：
  ```
  frontend/src/
  ├── pages/           # 页面
  ├── components/      # 组件
  ├── api/             # API 调用
  ├── store/           # 状态管理
  └── styles/          # 样式
  ```

### 1.3 配置基础依赖
- [x] 在 backend/pyproject.toml 添加依赖：
  - `google-adk>=1.0.0`
  - `fastapi>=0.115.0`
  - `uvicorn>=0.32.0`
  - `paramiko>=3.4.0`
  - `pydantic>=2.10.0`
  - `pydantic-settings>=2.6.0`
  - `chromadb>=0.4.0`
  - `httpx>=0.27.0`
  - `python-multipart>=0.0.20`
- [x] 运行 `uv sync` 安装依赖
- [x] 在 frontend/ 安装依赖：
  - `npm install antd @ant-design/icons axios zustand react-markdown`
- [x] 验证依赖安装成功

**交付物**: 完整的项目目录结构，依赖安装完成

---

## Phase 2: ADK Agent 框架 + DeepSeek API

### 2.1 配置 DeepSeek API
- [x] 创建 `backend/config.py`，配置 Pydantic Settings
- [x] 配置项包括：
  - `DEEPSEEK_API_KEY`: API 密钥
  - `DEEPSEEK_BASE_URL`: API 地址 (https://api.deepseek.com)
  - `DEEPSEEK_MODEL`: 模型名称 (如 deepseek-chat)
  - `LOG_LEVEL`: 日志级别
- [x] 创建 `.env.example` 文件示例
- [x] 配置日志记录 (logging)

### 2.2 实现基础 Agent 类
- [x] 创建 `backend/agent/__init__.py` 导出模块
- [x] 创建 `backend/agent/agent.py` - Agent 定义：
  ```python
  # Agent 核心类，包含:
  # - model 配置
  # - system prompt
  # - 会话管理
  ```
- [x] 创建 `backend/agent/planner.py` - 任务规划器框架
- [x] 创建 `backend/agent/executor.py` - 执行调度器框架
- [x] 创建 `backend/agent/__init__.py` 导出主要类
- [x] 创建 `backend/agent/llm_client.py` - DeepSeek LLM 客户端

### 2.3 实现基础对话功能
- [x] 创建 `backend/api/schemas.py` - Pydantic 请求/响应模型
- [x] 创建 `backend/api/routes.py` - REST API 路由
- [x] 创建 `backend/main.py` - FastAPI 应用入口
- [x] 实现流式响应 (StreamingResponse)
- [x] 测试对话 API

**交付物**: 可运行的 Agent 对话服务，支持流式响应

启动命令: `uv run uvicorn main:app --reload`

**交付物**: 可运行的 Agent 对话服务，支持流式响应

---

## Phase 3: 知识库模块（Wiki 引擎 + RAG）

### 3.1 搭建知识库目录结构
- [x] 创建 `backend/knowledge_base/` 目录结构
- [x] 创建基础索引文件 `index.json`
- [x] 创建 3 篇示例网络巡检文档（巡检指南、故障排查、OSPF 配置）

### 3.2 实现 Wiki 引擎
- [x] 创建 `backend/knowledge/wiki_engine.py` - Wiki 引擎类
- [x] 实现文档解析 (Markdown 解析、提取标题层级)
- [x] 实现 LLM 编译提示词模板
- [x] 实现文档加载、LLM 编译、索引管理

### 3.3 实现 RAG 检索
- [x] 创建 `backend/knowledge/rag.py` - RAG 查询类
- [x] 配置 ChromaDB 向量存储（持久化模式）
- [x] 实现文档分块 (chunking) 策略
- [x] 实现文档增删改查接口

### 3.4 集成知识库到 Agent
- [x] 创建 `backend/tools/knowledge_tool.py` - 知识库工具
- [x] 在 Agent 中注册知识库工具 (search_knowledge, list_knowledge_docs)
- [x] 修改 system prompt，加入知识库调用引导

### 3.5 实现知识库管理 API
- [x] 在 `backend/api/routes.py` 添加知识库路由
- [x] 创建对应的 schemas (DocumentInfo, KnowledgeQueryRequest/Response)
- [x] 测试知识库 API

**交付物**: 完整的知识库系统，支持文档编译、索引、查询

**交付物**: 完整的知识库系统，支持文档编译、索引、查询

---

## Phase 4: SSH 工具模块（Paramiko + MCP）

### 4.1 实现 SSH 连接工具
- [x] 创建 `backend/tools/ssh_tool.py` - SSH 连接工具类
  - `SSHConnection`: 连接管理、命令执行、断开
  - `SSHPool`: 连接池管理
- [x] 实现连接超时和重试机制

### 4.2 实现 MCP Server (简化版)
- [x] 创建 `backend/tools/mcp_server.py` - MCP Server 框架
- [x] 定义 MCP 工具规范 (JSON Schema 格式)
- [x] 创建内置工具定义：`ssh_connect`, `ssh_execute`, `ssh_disconnect`, `list_connections`

### 4.3 封装 Agent 可调用的工具
- [x] 创建 `backend/tools/agent_tools.py` - Agent 工具封装
- [x] 在 Agent 中注册这些工具（executor 注册 6 个工具）
- [x] 实现工具调用结果格式化
- [x] 更新 system prompt 加入 SSH 工具

### 4.4 实现设备管理 API
- [x] 创建 `backend/tools/device_store.py` - JSON 文件持久化存储
- [x] 创建 `backend/api/device_routes.py` - 设备管理路由
- [x] 路由注册到 main.py
- [x] 测试设备管理 CRUD

**交付物**: SSH 工具系统，支持 Agent 调用远程命令

**交付物**: SSH 工具系统，支持 Agent 调用远程命令

---

## Phase 5: 任务规划器（意图理解 + 分解）

### 5.1 实现意图识别
- [x] 实现 `classify_intent(user_message)`: 识别任务类型
- [x] 定义 4 种意图类型: NETWORK_INSPECTION, DEVICE_QUERY, KNOWLEDGE_QUERY, GENERAL
- [x] 创建意图识别提示词模板
- [x] 测试意图识别准确性

### 5.2 实现任务分解
- [x] 实现子任务结构定义 (SubTask dataclass)
- [x] 实现任务分解器 `decompose(task_description) -> list[SubTask]`
- [x] 基于 LLM 生成子任务计划，确定依赖关系

### 5.3 实现执行调度
- [x] 实现 `execute_plan` / `execute_task` / 状态管理
- [x] 实现任务状态: pending, running, completed, failed, skipped
- [x] 实现结果汇总 `summarize_results()` 和失败跳过机制

### 5.4 集成到 Agent
- [x] 修改 Agent 主类，集成 Planner
- [x] `chat` 响应含 plan 数据
- [x] `POST /api/agent/plan` 规划端点
- [x] 测试端到端任务规划

**交付物**: 完整的任务规划执行系统

---

## Phase 6: 前端对话页面 + 计划可视化

### 6.1 搭建前端基础框架
- [x] 配置 Ant Design 主题和全局样式
- [x] 创建 `App.jsx` 基础布局（含路由）
- [x] 配置路由 `/` - 对话页面

### 6.2 实现对话界面
- [x] 创建 `src/components/AgentChat.jsx` - 完整对话组件
  - 消息列表（用户/Agent 气泡区分）
  - 输入框 + 发送按钮 + Enter 发送
  - 加载状态和流式响应动画
  - 自动滚动到底部
- [x] 创建 `src/api/agent.js` - API 调用（plain + stream + plan）
- [x] 实现流式响应前端接收 (fetch stream + SSE 解析)
- [x] markdown 渲染 (react-markdown)

### 6.3 实现计划可视化
- [x] 创建 `src/components/PlanView.jsx` - 计划展示组件
  - 子任务列表 + 状态标签
  - 执行进度百分比
  - 任务结果展示
  - 执行摘要
- [x] 集成到对话页面（侧边栏按钮切换）

### 6.4 实现历史记录
- [x] 创建 `src/store/useAgentStore.js` - Zustand 状态管理
  - 会话列表、当前会话、消息列表
  - 流式状态、计划状态
- [x] 实现新会话创建
- [x] 实现清空对话

### 6.5 实现 SSH 工具调用展示
- [ ] PlanView 已支持展示工具调用结果（待前端联调完善）

**交付物**: 完整的前端对话界面，支持流式响应和计划可视化

---

## Phase 7: 前端知识库管理页面

### 7.1 实现知识库管理 UI
- [x] 创建 `src/pages/Knowledge.jsx` - 知识库管理页面
- [x] 实现文档列表展示 (Ant Design Table)
- [x] 实现编译全部/单个功能
- [x] 实现文档预览 (Drawer + react-markdown)
- [x] 实现知识库查询功能
- [x] 创建 `src/api/knowledge.js` - 知识库 API 调用

### 7.2 实现设备管理 UI
- [x] 创建 `src/pages/Devices.jsx` - 设备管理页面
- [x] 实现设备列表展示
- [x] 实现添加/编辑设备表单 (Ant Design Form + Modal)
- [x] 实现删除设备 (Popconfirm)
- [x] 实现连接测试按钮
- [x] 创建 `src/api/devices.js` - 设备 API 调用

### 7.3 完善页面布局和导航
- [x] 实现侧边栏菜单 (Sider + Menu)
- [x] 实现路由切换 (3 个页面: 对话/知识库/设备管理)

**交付物**: 完整的前端管理界面

---

## Phase 8: 集成联调 + 错误处理

### 8.1 端到端联调
- [x] 前后端联调测试：
  - [x] 对话功能联调
  - [x] 知识库功能联调
  - [x] SSH 工具联调
- [x] 测试流式响应
- [x] 测试会话管理

### 8.2 实现错误处理
- [x] 后端统一异常处理 (FastAPI exception handler)
- [x] 前端错误提示 (Ant Design message/notification)
- [x] 实现超时重试机制:
  - SSH 连接超时: 10秒，重试2次
  - LLM 调用超时: 60秒，重试1次
  - API 请求超时: 30秒

### 8.3 性能优化
- [ ] 知识库索引性能优化（后续可优化）
- [ ] 前端列表虚拟滚动（后续可优化）
- [ ] API 响应缓存（后续可优化）

### 8.4 文档整理
- [x] 编写 `README.md`:
  - 项目介绍
  - 环境要求
  - 安装步骤
  - 启动说明
  - 使用示例
  - API 文档

### 8.5 演示准备
- [x] 1. 启动后端: `uv run uvicorn main:app --reload`
- [x] 2. 启动前端: `npm run dev`
- [x] 3. 打开 http://localhost:5173
- [x] 4. 测试对话功能
- [x] 5. 测试知识库查询
- [x] 6. 测试设备管理

**交付物**: 可交付的完整项目，包含文档

**交付物**: 可交付的完整项目，包含文档

---

## 当前状态

**进度**: All Phases Completed 🎉

**已完成**:
- Phase 1: 项目初始化 ✅
- Phase 2: ADK Agent 框架 + DeepSeek API ✅
- Phase 3: 知识库模块（Wiki 引擎 + RAG）✅
- Phase 4: SSH 工具模块（Paramiko + MCP）✅
- Phase 5: 任务规划器（意图理解 + 分解）✅
- Phase 6: 前端对话页面 + 计划可视化 ✅
- Phase 7: 前端知识库管理页面 ✅
- Phase 8: 集成联调 + 错误处理 ✅

---

## 执行检查清单

每个 Phase 开始前检查:
- [ ] 代码已提交 (git commit)
- [ ] 上一阶段交付物完成
- [ ] 有测试用例验证

每个 Phase 完成后检查:
- [ ] 功能测试通过
- [ ] 代码符合 project.md 规格
- [ ] 更新本文档状态
- [ ] 提交代码

---

*文档版本: v1.1*
*创建日期: 2026-05-12*
*更新日期: 2026-05-15*
