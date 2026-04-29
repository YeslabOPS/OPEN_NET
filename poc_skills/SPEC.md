# NetOps Agent Skills 系统 - 技术规格文档

## 一、项目概述

### 1.1 项目定位

NetOps Agent Skills 是一个面向计算机网络运维领域的智能 Agent 构建与运行平台。该系统基于 "Agent + Skills" 架构理念设计，旨在为网络运维工程师提供一种低门槛、高可用的方式，通过组合式配置快速构建专属的运维智能助手。

### 1.2 目标用户

- **初级运维工程师**：需要快速上手自动化巡检、告警分析等日常工作
- **资深运维专家**：需要灵活组装定制化 Agent，处理复杂故障场景
- **运维团队负责人**：需要统一管理团队内的 Agent 模板与 Skills 包

### 1.3 核心价值

- **快速组装**：通过可视化界面组合 Skills，无需编程即可构建 Agent
- **灵活扩展**：支持第三方 Skills 包导入，满足个性化运维场景
- **安全可控**：所有 LLM 调用基于 DeepSeek API，数据不出境
- **开箱即用**：预置网络运维巡检场景，上线即可使用

---

## 二、技术栈

### 2.1 核心技术架构

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | React 18 + TypeScript | 类型安全，组件化开发 |
| **UI 组件库** | Ant Design 5 | 企业级组件，支持深色主题 |
| **状态管理** | Zustand | 轻量级状态管理，支持持久化 |
| **后端框架** | FastAPI (Python 3.10+) | 高性能异步 API 框架 |
| **LLM 集成** | DeepSeek API | 智谱 AI 大语言模型支持 |
| **数据库** | SQLite (开发) / PostgreSQL (生产) | 结构化数据持久化 |
| **Skills 架构** | JSON Schema + Plugin 模式 | 标准化 Skills 定义与加载 |

### 2.2 第三方依赖

```
# 前端依赖
react: ^18.2.0
antd: ^5.12.0
zustand: ^4.4.0
axios: ^1.6.0

# 后端依赖
fastapi: ^0.104.0
uvicorn: ^0.24.0
pydantic: ^2.5.0
httpx: ^0.25.0
```

---

## 三、模块描述

### 3.1 Agent 组装模块 (Agent Assembly)

#### 3.1.1 功能描述

Agent 组装模块是系统的核心引擎，负责将系统提示词（System Prompt）与选定的 Skills 组合，生成可与 LLM 对话的完整 Agent 实例。

#### 3.1.2 核心组件

| 组件 | 职责 |
|------|------|
| **PromptBuilder** | 构建系统提示词，支持变量插值与模板语法 |
| **SkillsLoader** | 加载已启用的 Skills，解析其工具定义 |
| **AgentRuntime** | 管理 Agent 生命周期，封装 LLM 调用逻辑 |
| **ContextManager** | 管理对话上下文，支持多轮对话与记忆 |

#### 3.1.3 接口定义

```typescript
interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  skills: SkillReference[];
  modelConfig: ModelConfig;
}

interface SkillReference {
  skillId: string;
  enabled: boolean;
  customParams?: Record<string, any>;
}
```

### 3.2 Skills 导入模块 (Skills Import)

#### 3.2.1 功能描述

Skills 导入模块负责管理 Skills 包的导入、验证、存储与分发。每个 Skill 代表一种可被 Agent 调用的工具能力。

#### 3.2.2 Skill 结构定义

```typescript
interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  tools: ToolDefinition[];
  configurations: ConfigSchema[];
  icon?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParameterSchema;
  handler: string; // 工具处理函数标识
}

interface ParameterSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required: string[];
}
```

#### 3.2.3 核心功能

| 功能 | 说明 |
|------|------|
| **本地导入** | 支持从本地 JSON/YAML 文件导入 Skill 包 |
| **URL 导入** | 支持从远程 URL 拉取 Skill 包 |
| **版本管理** | 支持 Skill 版本升级与回滚 |
| **依赖解析** | 自动解析 Skill 间的依赖关系 |
| **沙箱验证** | 在沙箱环境中验证 Skill 安全性 |

### 3.3 聊天组装模块 (Chat Assembly)

#### 3.3.1 功能描述

聊天组装模块提供用户与 Agent 交互的界面，负责组装用户消息、调用 Agent、解析工具调用、渲染结果。

#### 3.3.2 对话流程

```
用户输入 → 消息组装 → Agent 推理 → 响应解析
    ↓                        ↓
消息渲染 ← 结果格式化 ← 工具调用 ← 意图识别
```

#### 3.3.3 核心功能

| 功能 | 说明 |
|------|------|
| **消息组装** | 将用户输入组装为标准消息格式 |
| **流式输出** | 支持 LLM 流式响应，实时显示输出 |
| **工具调用** | 解析 LLM 返回的工具调用，执行对应工具 |
| **多轮对话** | 自动维护对话历史，支持上下文记忆 |
| **会话管理** | 支持多会话切换、历史记录导出 |

### 3.4 系统管理模块 (System Management)

#### 3.4.1 功能描述

提供系统级的配置、管理与监控功能。

#### 3.4.2 核心功能

| 功能 | 说明 |
|------|------|
| **API 配置** | 配置 DeepSeek API Key 与模型参数 |
| **Agent 管理** | CRUD 操作 Agent 实例，模板复制 |
| **日志审计** | 记录所有 API 调用与工具执行日志 |
| **性能监控** | 监控响应延迟、Token 消耗等指标 |

---

## 四、业务场景

### 4.1 核心场景：网络设备巡检

#### 4.1.1 场景描述

网络运维工程师需要定期对核心交换机、路由器、防火墙等设备进行巡检，查看设备状态、端口信息、告警日志等。传统方式需要逐台登录设备查看，效率低下且容易遗漏。

#### 4.1.2 解决方案

通过 Agent + Skills 架构，构建**网络巡检助手**：

1. **预置 Skill：网络设备巡检**
   - 工具：`connect_device` - 建立 SSH 连接
   - 工具：`execute_command` - 执行 CLI 命令
   - 工具：`parse_output` - 解析命令输出

2. **系统提示词模板**
   ```
   你是一名资深网络运维工程师，负责执行网络设备巡检任务。
   请按照以下流程执行：
   1. 连接目标设备（使用提供的 IP 和凭证）
   2. 执行巡检命令（show version, show interface, show log）
   3. 分析输出结果，识别异常
   4. 生成巡检报告
   ```

3. **对话示例**
   ```
   用户：帮我巡检 192.168.1.1 这台交换机
   
   Agent：正在连接 192.168.1.1...
   → 执行 show version
   → 执行 show interface brief
   → 执行 show log
   → 分析完成，发现 2 条异常告警
   
   巡检报告：
   ✅ 设备运行正常
   ⚠️ 端口 Gi0/1 带宽利用率超过 80%
   ⚠️ 检测到 1 条 ACL 匹配失败记录
   ```

#### 4.1.3 价值体现

| 维度 | 提升效果 |
|------|---------|
| **效率** | 单台设备巡检从 10 分钟缩短至 30 秒 |
| **覆盖率** | 可批量巡检 100+ 设备，不遗漏任何一台 |
| **准确性** | 基于 LLM 分析，减少人工判断失误 |
| **可追溯** | 自动生成巡检报告，便于审计归档 |

### 4.2 扩展场景：告警根因分析

#### 4.2.1 场景描述

当网络出现告警时，运维人员需要快速定位根因，分析影响范围，制定恢复策略。

#### 4.2.2 Skill 组合

- `log_collector`：采集设备日志
- `topology_viewer`：查看网络拓扑
- `config_compare`：对比配置变更
- `knowledge_base`：查询运维知识库

### 4.3 扩展场景：配置合规检查

#### 4.3.1 场景描述

定期检查网络设备配置是否符合安全基线，发现违规配置并告警。

#### 4.3.2 Skill 组合

- `config_extractor`：导出设备配置
- `policy_checker`：检查合规策略
- `report_generator`：生成合规报告

---

## 五、系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                      前端 (React)                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │Agent管理 │  │Skill管理│  │聊天界面 │  │系统配置 │    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘    │
└───────┼───────────┼───────────┼───────────┼───────────┘
        │           │           │           │
        └───────────┴─────┬─────┴───────────┘
                          │ HTTP/REST
        ┌─────────────────┴─────────────────┐
        │           后端 (FastAPI)           │
        │  ┌─────────┐  ┌─────────┐        │
        │  │ Agent   │  │ Skills  │        │
        │  │ Assembly│  │ Loader  │        │
        │  └────┬────┘  └────┬────┘        │
        │       │            │              │
        │  ┌────┴────────────┴────┐        │
        │  │    LLM Gateway        │        │
        │  │    (DeepSeek API)     │        │
        │  └──────────┬───────────┘        │
        │             │                      │
        │  ┌──────────┴───────────┐         │
        │  │     数据库层          │         │
        │  │ Agent/Skill/会话存储   │         │
        │  └───────────────────────┘         │
        └───────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │   DeepSeek API      │
              │   (LLM 大模型)       │
              └─────────────────────┘
```

---

## 六、部署说明

### 6.1 环境要求

| 环境 | 最低配置 |
|------|---------|
| CPU | 2 核 |
| 内存 | 4 GB |
| 硬盘 | 20 GB |
| 网络 | 可访问 DeepSeek API |

### 6.2 快速启动

```bash
# 1. 克隆项目
git clone https://github.com/your-org/netops-agent-skills.git
cd netops-agent-skills

# 2. 安装后端依赖
cd backend
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 4. 启动后端
uvicorn main:app --reload --port 8000

# 5. 启动前端（新窗口）
cd frontend
npm install
npm run dev
```

### 6.3 端口说明

| 端口 | 服务 |
|------|------|
| 3000 | 前端开发服务器 |
| 8000 | 后端 API 服务 |

---

## 七、Roadmap

| 版本 | 目标 | 预计时间 |
|------|------|---------|
| v0.1 | MVP，基础 Agent + 内置巡检 Skill | Week 1-2 |
| v0.2 | 支持自定义 Skill 导入 | Week 3-4 |
| v0.3 | 多会话管理与历史记录 | Week 5-6 |
| v1.0 | 生产可用版本，权限管理 | Week 7-8 |

---

## 八、许可证

本项目采用 MIT 许可证开源。
