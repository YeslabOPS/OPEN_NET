# NetOps Agent Skills - 任务清单 (v0)

## 一、项目初始化

### 1.1 代码仓库搭建

- [ ] 创建 Monorepo 项目结构（frontend / backend / shared）
- [ ] 编写 README.md 项目说明文档

### 1.2 后端项目初始化

- [ ] 初始化 Node.js 项目，安装依赖
- [ ] 配置 TypeScript 编译选项
- [ ] 配置 Prisma ORM 与数据库模型
- [ ] 编写 .env.example 环境变量模板

### 1.3 前端项目初始化

- [ ] 使用 Vite 创建 React + TypeScript 项目
- [ ] 安装 Ant Design、Zustand 等依赖
- [ ] 配置路由 (React Router)
- [ ] 配置全局样式与主题

---

## 二、后端核心功能

### 2.1 基础框架搭建

- [ ] 搭建 Express/Fastify 基础服务
- [ ] 配置 CORS 与请求日志中间件
- [ ] 实现统一的错误处理与响应格式
- [ ] 配置环境变量读取

### 2.2 数据库模型设计

- [ ] 设计 Agent 表结构（id, name, systemPrompt, modelConfig, createdAt...）
- [ ] 设计 Skill 表结构（id, name, version, description, tools, config...）
- [ ] 设计 Conversation 表结构（id, agentId, messages, createdAt...）
- [ ] 编写数据库迁移脚本
- [ ] 编写 Prisma Seed 初始化数据

### 2.3 Agent 组装模块

- [ ] 实现 Agent CRUD API（创建、查询、更新、删除）
- [ ] 实现 PromptBuilder 构建器
- [ ] 实现 SkillsLoader 加载器
- [ ] 实现 AgentRuntime 运行时
- [ ] 实现 ContextManager 上下文管理器

### 2.4 Skills 导入模块

- [ ] 实现 Skill CRUD API
- [ ] 实现 Skill JSON Schema 验证
- [ ] 实现本地文件导入功能
- [ ] 实现远程 URL 导入功能

### 2.5 LLM 网关模块

- [ ] 实现 DeepSeek API 客户端封装
- [ ] 实现流式响应支持
- [ ] 实现 Agent 聊天 API（对话补全）
- [ ] 实现工具调用解析与路由

---

## 三、前端核心功能

### 3.1 布局与导航

- [ ] 实现顶部导航栏
- [ ] 实现侧边栏菜单
- [ ] 实现响应式布局
- [ ] 实现页面路由配置

### 3.2 Agent 管理页面

- [ ] 实现 Agent 列表展示
- [ ] 实现 Agent 创建表单
- [ ] 实现 Agent 编辑表单
- [ ] 实现 Agent 删除确认

### 3.3 Skill 管理页面

- [ ] 实现 Skill 列表展示
- [ ] 实现 Skill 导入功能（本地文件）
- [ ] 实现 Skill 导入功能（URL）
- [ ] 实现 Skill 详情查看

### 3.4 聊天界面

- [ ] 实现对话消息列表组件
- [ ] 实现用户消息输入框
- [ ] 实现流式响应渲染
- [ ] 实现工具调用卡片展示
- [ ] 实现消息时间戳显示

### 3.5 系统配置页面

- [ ] 实现 API Key 配置表单
- [ ] 实现配置保存与读取

---

## 四、业务场景实现

### 4.1 内置巡检 Skill

- [ ] 定义网络设备巡检 Skill 结构
- [ ] 实现 connect_device 工具（SSH 连接）
- [ ] 实现 execute_command 工具（CLI 执行）
- [ ] 实现 parse_output 工具（输出解析）

### 4.2 巡检助手 Agent

- [ ] 编写网络巡检系统提示词
- [ ] 配置预置 Agent 模板
- [ ] 实现批量巡检功能
