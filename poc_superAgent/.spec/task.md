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
- [ ] 创建 `backend/knowledge_base/` 目录结构：
  ```
  knowledge_base/
  ├── raw/                    # 原始文档层
  │   └── docs/               # 网络巡检相关文档
  ├── wiki/                   # LLM 编译后的结构化 Wiki
  │   └── compiled/            # 编译后内容
  └── index.json              # 索引文件
  ```
- [ ] 创建基础索引文件 `index.json`

### 3.2 实现 Wiki 引擎
- [ ] 创建 `backend/knowledge/wiki_engine.py` - Wiki 引擎类：
  - `load_documents(raw_dir)`: 加载原始 Markdown 文档
  - `compile_document(doc)`: 使用 LLM 编译单个文档为结构化 Wiki
  - `compile_all()`: 批量编译所有文档
  - `save_compiled(doc, output_path)`: 保存编译结果
- [ ] 实现文档解析 (Markdown 解析、提取标题层级)
- [ ] 实现 LLM 编译提示词模板
- [ ] 创建示例网络巡检文档 (2-3 篇)

### 3.3 实现 RAG 检索
- [ ] 创建 `backend/knowledge/rag.py` - RAG 查询类：
  - `index_wiki(wiki_dir)`: 索引 Wiki 内容到 ChromaDB
  - `query(question, top_k)`: 检索相关知识
  - `add_document(doc_id, content)`: 添加新文档
  - `delete_document(doc_id)`: 删除文档
- [ ] 配置 ChromaDB 向量存储
- [ ] 实现文档分块 (chunking) 策略
- [ ] 实现嵌入模型配置 (使用 DeepSeek 或本地模型)

### 3.4 集成知识库到 Agent
- [ ] 创建 `backend/tools/knowledge_tool.py` - 知识库工具：
  ```python
  # search_knowledge(query: str) -> str
  # 获取知识库搜索结果
  ```
- [ ] 在 Agent 中注册知识库工具
- [ ] 修改 system prompt，加入知识库调用引导

### 3.5 实现知识库管理 API
- [ ] 在 `backend/api/routes.py` 添加路由：
  - `GET /api/knowledge/list` - 列出所有文档
  - `POST /api/knowledge/compile` - 编译文档
  - `POST /api/knowledge/add` - 添加文档
  - `DELETE /api/knowledge/{doc_id}` - 删除文档
  - `GET /api/knowledge/query` - 查询知识库
  - `POST /api/knowledge/index` - 重新索引
- [ ] 创建对应的 schemas
- [ ] 测试知识库 CRUD 操作

**交付物**: 完整的知识库系统，支持文档编译、索引、查询

---

## Phase 4: SSH 工具模块（Paramiko + MCP）

### 4.1 实现 SSH 连接工具
- [ ] 创建 `backend/tools/ssh_tool.py` - SSH 工具类：
  ```python
  # SSHConnection: host, port, username, password/key
  # connect(): 建立连接
  # execute(command): 执行命令
  # disconnect(): 断开连接
  ```
- [ ] 实现 SSH 连接池管理
- [ ] 实现命令执行和结果捕获
- [ ] 实现连接超时和重试机制
- [ ] 实现文件传输基础功能

### 4.2 实现 MCP Server (简化版)
- [ ] 创建 `backend/tools/mcp_server.py` - MCP Server 框架：
  - `register_tool(tool_def)`: 注册工具
  - `list_tools()`: 列出可用工具
  - `call_tool(tool_name, params)`: 调用工具
- [ ] 定义 MCP 工具规范 (JSON Schema 格式)
- [ ] 创建内置工具定义：
  - `ssh_connect`
  - `ssh_execute`
  - `ssh_disconnect`
  - `file_read`
  - `file_write`

### 4.3 封装 Agent 可调用的工具
- [ ] 创建 `backend/tools/agent_tools.py` - Agent 工具封装：
  ```python
  # @tool decorator 包装的工具函数
  # ssh_connect_tool(host, port, username, password)
  # ssh_execute_tool(connection_id, command)
  # ssh_disconnect_tool(connection_id)
  # read_file_tool(file_path)
  # write_file_tool(file_path, content)
  ```
- [ ] 在 Agent 中注册这些工具
- [ ] 实现工具调用结果格式化

### 4.4 实现设备管理 API
- [ ] 创建 `backend/api/schemas.py` 添加设备模型：
  ```python
  # DeviceCreate, DeviceUpdate, DeviceResponse
  # SSHConnectionRequest, SSHConnectionResponse
  ```
- [ ] 创建 `backend/api/device_routes.py` - 设备管理路由：
  - `GET /api/devices` - 列出设备
  - `POST /api/devices` - 添加设备
  - `GET /api/devices/{id}` - 获取设备详情
  - `PUT /api/devices/{id}` - 更新设备
  - `DELETE /api/devices/{id}` - 删除设备
  - `POST /api/devices/{id}/test` - 测试连接
- [ ] 创建设备存储 (JSON 文件或 SQLite)
- [ ] 测试设备管理 CRUD

**交付物**: SSH 工具系统，支持 Agent 调用远程命令

---

## Phase 5: 任务规划器（意图理解 + 分解）

### 5.1 实现意图识别
- [ ] 在 `backend/agent/planner.py` 实现意图识别：
  - `classify_intent(user_message)`: 识别任务类型
  - 定义意图类型：
    - `NETWORK_INSPECTION`: 网络巡检
    - `DEVICE_QUERY`: 设备查询
    - `KNOWLEDGE_QUERY`: 知识查询
    - `GENERAL`: 通用对话
- [ ] 创建意图识别提示词模板
- [ ] 测试意图识别准确性

### 5.2 实现任务分解
- [ ] 实现子任务结构定义：
  ```python
  # class SubTask:
  #     task_id: str
  #     description: str
  #     tool_name: str
  #     params: dict
  #     depends_on: list[str]
  #     status: str
  ```
- [ ] 实现任务分解器：
  - `decompose(task_description) -> list[SubTask]`
  - 基于 LLM 生成子任务计划
  - 确定任务依赖关系
- [ ] 创建常见网络巡检任务模板：
  - 路由器巡检: [连接SSH, 获取CPU, 获取内存, 获取端口状态, 生成报告]
  - 交换机巡检: [连接SSH, 获取VLAN, 获取MAC表, 获取端口状态]

### 5.3 实现执行调度
- [ ] 在 `backend/agent/executor.py` 实现执行器：
  - `execute_plan(plan)`: 执行整个计划
  - `execute_task(task)`: 执行单个任务
  - `handle_result(task, result)`: 处理执行结果
  - `handle_error(task, error)`: 处理错误
- [ ] 实现任务状态管理：
  - `pending`, `running`, `completed`, `failed`, `skipped`
- [ ] 实现结果汇总：
  - `summarize(results)`: 整合各任务结果生成报告
- [ ] 实现失败跳过机制
- [ ] 测试任务规划和执行流程

### 5.4 集成到 Agent
- [ ] 修改 Agent 主类，集成 Planner 和 Executor
- [ ] 实现计划展示接口
- [ ] 实现执行进度回调
- [ ] 测试端到端任务规划执行

**交付物**: 完整的任务规划执行系统

---

## Phase 6: 前端对话页面 + 计划可视化

### 6.1 搭建前端基础框架
- [ ] 配置 Ant Design 主题和全局样式
- [ ] 创建 `App.jsx` 基础布局
- [ ] 配置路由 (react-router-dom):
  - `/` - 对话页面
  - `/knowledge` - 知识库管理
  - `/devices` - 设备管理

### 6.2 实现对话界面
- [ ] 创建 `src/components/AgentChat.jsx` - 对话组件：
  - 消息列表展示 (用户/Agent 区分)
  - 消息输入框
  - 发送按钮
  - 加载状态显示
- [ ] 实现 `src/api/agent.js` - API 调用：
  - `chat(message)` - 发送消息
  - `streamChat(message)` - 流式对话
  - `getHistory(sessionId)` - 获取历史
- [ ] 实现流式响应前端接收 (EventSource 或 fetch stream)
- [ ] 实现消息时间戳显示
- [ ] 实现滚动到底部自动定位

### 6.3 实现计划可视化
- [ ] 创建 `src/components/PlanView.jsx` - 计划展示组件：
  - 子任务列表
  - 任务状态图标 (pending/running/completed/failed)
  - 任务依赖关系展示
  - 执行进度百分比
- [ ] 创建 `src/components/TaskItem.jsx` - 单个任务项
- [ ] 集成到对话页面 (作为 Agent 回复的一部分或侧边栏)

### 6.4 实现历史记录
- [ ] 创建 `src/store/useAgentStore.js` - Zustand 状态管理：
  - 会话列表
  - 当前会话
  - 消息列表
  - 加载状态
- [ ] 实现历史会话选择
- [ ] 实现新会话创建
- [ ] 实现会话切换

### 6.5 实现 SSH 工具调用展示
- [ ] 在对话中展示工具调用过程
- [ ] 实现工具执行结果展示
- [ ] 实现命令输出格式化

**交付物**: 完整的前端对话界面，支持流式响应和计划可视化

---

## Phase 7: 前端知识库管理页面

### 7.1 实现知识库管理 UI
- [ ] 创建 `src/pages/Knowledge.jsx` - 知识库管理页面
- [ ] 实现文档列表展示 (Ant Design Table)
- [ ] 实现添加文档功能 (Markdown 编辑器或文件上传)
- [ ] 实现删除文档功能 (确认对话框)
- [ ] 实现文档预览 (react-markdown)
- [ ] 实现搜索功能
- [ ] 创建 `src/api/knowledge.js` - 知识库 API 调用

### 7.2 实现设备管理 UI
- [ ] 创建 `src/pages/Devices.jsx` - 设备管理页面
- [ ] 实现设备列表展示
- [ ] 实现添加设备表单 (Ant Design Form)
- [ ] 实现编辑设备
- [ ] 实现删除设备
- [ ] 实现连接测试按钮
- [ ] 实现连接状态指示
- [ ] 创建 `src/api/devices.js` - 设备 API 调用

### 7.3 完善页面布局和导航
- [ ] 实现顶部导航栏
- [ ] 实现侧边栏菜单
- [ ] 实现响应式布局
- [ ] 添加页面加载骨架屏

**交付物**: 完整的前端管理界面

---

## Phase 8: 集成联调 + 错误处理

### 8.1 端到端联调
- [ ] 前后端联调测试：
  - [ ] 对话功能联调
  - [ ] 知识库功能联调
  - [ ] SSH 工具联调
- [ ] 修复发现的问题
- [ ] 测试 WebSocket 流式响应
- [ ] 测试会话管理

### 8.2 实现错误处理
- [ ] 后端统一异常处理 (FastAPI exception handler)
- [ ] 前端错误提示 (Ant Design message/notification)
- [ ] 实现超时重试机制:
  - SSH 连接超时: 10秒，重试2次
  - LLM 调用超时: 60秒，重试1次
  - API 请求超时: 30秒
- [ ] 实现连接失败告警
- [ ] 实现重连机制 (WebSocket)

### 8.3 性能优化
- [ ] 知识库索引性能优化
- [ ] 前端列表虚拟滚动 (大列表优化)
- [ ] API 响应缓存

### 8.4 文档整理
- [ ] 编写 `README.md`:
  - 项目介绍
  - 环境要求
  - 安装步骤
  - 启动说明
  - 使用示例
  - API 文档
- [ ] 编写 `docs/` 技术文档 (可选)
- [ ] 添加必要的注释到代码

### 8.5 演示准备
- [ ] 准备演示脚本和示例数据
- [ ] 准备演示稿 (可选)
- [ ] 最终功能验收

**交付物**: 可交付的完整项目，包含文档

---

## 当前状态

**进度**: Phase 1 (项目初始化) - 未开始

**已完成**:
- 项目需求文档：`.spec/project.md`

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
