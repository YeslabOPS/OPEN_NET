# 智能运维功能 - 任务清单

> 本文档为 NetOps Agent Skills 项目的「智能运维」功能增强任务清单。
> 对应规格文档：`.spec/SPEC.md` | 原始任务清单：`.spec/TASK_LIST.md`（v0 已全部完成）

---

## 项目现状概览

### 已有功能（v0 已完成）

| 模块 | 说明 |
|------|------|
| Agent 管理 | CRUD + Skill 绑定，`Agent` / `AgentSkill` 表 |
| Skill 管理 | CRUD + 本地/URL 导入，`Skill` 表 |
| 智能对话 | 流式对话 + 工具调用渲染，`Conversation` / `Message` 表 |
| 批量巡检 | SSH 连接设备执行命令，但**结果存 Message 表不持久化**，无模板/历史/定时 |
| 系统配置 | API Key 管理，`SystemConfig` 表 |

### 现有巡检功能的不足

1. **结果不持久化** — `POST /api/inspection` 将结果存入 `Conversation`/`Message`，页面刷新即丢失
2. **无巡检模板** — 每次需手动添加设备，无法复用
3. **无定时任务** — 不支持 cron 周期性自动巡检
4. **无报告生成** — 只有原始命令输出，无结构化分析报告
5. **无 Agent 解析** — 巡检后不会调用 Agent 进行智能分析
6. **无基线对比** — 无法建立基线并在后续巡检中对比偏差
7. **无通知机制** — 巡检结果无处推送，用户需主动查看

### 关键代码文件

| 文件 | 作用 | 改动程度 |
|------|------|---------|
| `backend/prisma/schema.prisma` | 数据库模型，当前有 Agent/Skill/Conversation/Message/SystemConfig/AuditLog | **新增 5 张表** |
| `backend/src/routes/inspection.ts` | 巡检路由，3 个接口（POST / GET /:sessionId / POST /quick） | **大幅重构** |
| `backend/src/services/tools.ts` | SSH 连接工具类 `SSHConnection` | 不变或小改 |
| `backend/src/index.ts` | Express 入口，注册路由 | **新增通知路由** |
| `frontend/src/pages/Inspection.tsx` | 单页面巡检，设备管理 + 执行 + 结果展示 | **拆分为 Tab 容器** |
| `frontend/src/App.tsx` | 路由配置 | **新增路由** |
| `frontend/src/components/Layout/AppLayout.tsx` | 布局 + 侧边菜单 | **新增铃铛 + 菜单项** |

---

## 核心流程设计

### 巡检执行 + Agent 解析流程（第一期核心）

```
触发方式：手动 / 定时任务
    │
    ▼
┌─────────────────────────────────┐
│ 1. 创建 InspectionRecord         │
│    status = running              │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ 2. SSH 连接设备执行命令           │
│    获取原始输出                   │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ 3. reportGenerator 生成结构化     │
│    Markdown 报告                 │
│    → InspectionRecord.reportPath │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ 4. 检查该模板是否已有基线文档      │
│    (BaselineDocument.isActive)   │
└──────┬───────────────┬─────────┘
       │               │
   有基线           无基线
       │               │
       ▼               ▼
┌──────────────┐ ┌──────────────────┐
│ 5a. Agent    │ │ 5b. Agent 读取    │
│ 读取基线.md  │ │ 报告，根据系统     │
│ + 当前报告   │ │ 提示词生成基线     │
│ → 分析偏差   │ │ .md 文档          │
│ → 输出分析结果│ │ → 写入磁盘         │
└──────┬───────┘ │ → DB 存路径       │
       │         └────────┬─────────┘
       │                  │
       ▼                  ▼
┌─────────────────────────────────┐
│ 6. 写入 Notification 表          │
│    type = report / baseline     │
│    isRead = false               │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ 7. 更新 InspectionRecord         │
│    status = success / failed     │
│    summary = Agent 分析摘要       │
└─────────────────────────────────┘
```

### 基线文档管理

- **存储位置**：`backend/data/baselines/{templateId}/baseline_v{version}.md`
- **数据库记录**：`BaselineDocument` 表存 `filePath`，`isActive` 标识当前生效版本
- **生成时机**：某模板关联任务的**首次巡检完成**时，Agent 根据报告内容 + 自身系统提示词生成基线文档
- **对比逻辑**：后续巡检完成时，Agent 读取 `.md` 基线文档 + 当前报告，输出偏差分析
- **更新方式**：用户在通知中心点击"设为新基线" → 调用 regenerate 接口 → Agent 重新生成基线 → 旧文档 `isActive=false`，新文档 `isActive=true`

### 站内信展示

- **铃铛图标**：`AppLayout` 顶部导航栏右侧，Badge 显示未读数，点击弹出 Drawer 展示最近通知列表
- **通知中心页面**：独立路由 `/notifications`，表格展示所有通知，支持按类型（inspection/report/baseline/system）和已读状态筛选
- **巡检分析报告通知**：可展开查看 Agent 分析详情，提供"设为新基线"操作按钮

---

## 数据库模型设计

在 `backend/prisma/schema.prisma` 中新增以下五张表：

```prisma
// 巡检模板
model InspectionTemplate {
  id          String   @id @default(cuid())
  name        String
  description String?
  deviceType  String   // switch | router | firewall | generic
  commands    String   @default("[]") // JSON array: 巡检命令列表
  devices     String   @default("[]") // JSON array: 预设设备列表
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  schedules   InspectionSchedule[]
  records     InspectionRecord[]
  baselines   BaselineDocument[]

  @@map("inspection_templates")
}

// 巡检记录
model InspectionRecord {
  id          String   @id @default(cuid())
  templateId  String?
  agentId     String
  status      String   @default("running") // running | success | failed
  devices     String   @default("[]")       // JSON array: 本次巡检的设备列表
  results     String?  @default("{}")       // JSON object: 巡检原始结果
  reportPath  String?                       // 结构化 Markdown 报告文件路径
  startTime   DateTime @default(now())
  endTime     DateTime?
  summary     String?  @default("{}")      // JSON object: Agent 分析摘要

  template    InspectionTemplate?  @relation(fields: [templateId], references: [id])
  agent       Agent                @relation(fields: [agentId], references: [id])
  notifications Notification[]

  @@index([status])
  @@index([startTime])
  @@map("inspection_records")
}

// 定时巡检任务
model InspectionSchedule {
  id             String   @id @default(cuid())
  templateId     String
  agentId        String
  cronExpression String   // cron 表达式，如 "0 9 * * 1-5" (工作日9点)
  enabled        Boolean  @default(true)
  lastRunTime    DateTime?
  lastRunStatus  String?  // success | failed
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  template       InspectionTemplate @relation(fields: [templateId], references: [id])
  agent          Agent              @relation(fields: [agentId], references: [id])

  @@map("inspection_schedules")
}

// 通知
model Notification {
  id               String   @id @default(cuid())
  userId           String?  // 预留多用户，当前为 null 表示全员
  title            String
  content          String   // 通知正文 / Agent 分析结果
  type             String   // inspection | report | baseline | system
  relatedRecordId  String?  // 关联的 InspectionRecord.id
  isRead           Boolean  @default(false)
  createdAt        DateTime @default(now())

  record           InspectionRecord? @relation(fields: [relatedRecordId], references: [id])

  @@index([isRead, createdAt])
  @@map("notifications")
}

// 基线文档
model BaselineDocument {
  id          String   @id @default(cuid())
  templateId  String
  filePath    String   // 本地磁盘路径，如 data/baselines/{templateId}/baseline_v1.md
  generatedAt DateTime @default(now())
  version     Int      @default(1)
  isActive    Boolean  @default(true)

  template    InspectionTemplate @relation(fields: [templateId], references: [id])

  @@map("baseline_documents")
}
```

> **注意**：`InspectionRecord.agentId` 和 `InspectionSchedule.agentId` 需要在 `Agent` 模型中添加反向关联字段；
> `InspectionSchedule` 使用 `node-cron` 在进程内调度，不依赖外部调度器。

---

## 后端 API 设计

### 巡检模板（在 `inspection.ts` 中扩展）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inspection/templates` | 模板列表 |
| POST | `/api/inspection/templates` | 创建模板 |
| PUT | `/api/inspection/templates/:id` | 更新模板 |
| DELETE | `/api/inspection/templates/:id` | 删除模板 |

### 巡检记录与报告（重构现有接口）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/inspection` | 执行巡检（**重构**：结果持久化到 InspectionRecord，触发报告生成 + Agent 解析） |
| GET | `/api/inspection/records` | 记录列表（分页、状态筛选） |
| GET | `/api/inspection/records/:id` | 记录详情（含报告内容和 Agent 分析结果） |

### 定时任务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/inspection/schedules` | 创建定时任务 |
| PUT | `/api/inspection/schedules/:id` | 更新定时任务（含启用/禁用） |
| DELETE | `/api/inspection/schedules/:id` | 删除定时任务 |
| POST | `/api/inspection/schedules/:id/run` | 手动触发一次 |

### 基线文档

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inspection/baselines/:templateId` | 获取当前生效的基线文档内容 |
| POST | `/api/inspection/baselines/:templateId/regenerate` | 基于最新巡检记录重新生成基线 |

### 通知（新建 `routes/notifications.ts`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications` | 通知列表（分页、未读筛选、类型筛选） |
| GET | `/api/notifications/unread-count` | 未读数量（铃铛轮询用） |
| PUT | `/api/notifications/:id/read` | 标记已读 |
| PUT | `/api/notifications/read-all` | 全部标记已读 |
| DELETE | `/api/notifications/:id` | 删除通知 |

---

## 新增文件清单

```
backend/
├── prisma/schema.prisma                          # [修改] 新增 5 张表 + Agent 反向关联
├── src/
│   ├── index.ts                                   # [修改] 注册 notifications 路由
│   ├── routes/
│   │   ├── inspection.ts                          # [大幅重构] 新增模板/记录/定时/基线路由
│   │   └── notifications.ts                        # [新建] 通知 CRUD 路由
│   ├── services/
│   │   ├── tools.ts                                # [不变] SSHConnection 工具类
│   │   ├── scheduler.ts                           # [新建] 定时任务调度服务（node-cron）
│   │   ├── reportGenerator.ts                     # [新建] 结构化 Markdown 报告生成
│   │   └── agentParser.ts                         # [新建] Agent 报告解析（调用 DeepSeek API）
│   └── data/
│       └── baselines/                              # [新建] 基线 .md 文件存储目录（加入 .gitignore）

frontend/
├── src/
│   ├── App.tsx                                     # [修改] 新增通知中心路由
│   ├── api/
│   │   ├── index.ts                                # [不变] axios 实例
│   │   ├── inspection.ts                           # [新建] 巡检相关 API 封装
│   │   └── notification.ts                         # [新建] 通知相关 API 封装
│   ├── components/
│   │   └── NotificationBell.tsx                    # [新建] 顶部铃铛图标组件
│   ├── components/Layout/
│   │   └── AppLayout.tsx                           # [修改] 集成铃铛、菜单项
│   └── pages/
│       ├── Inspection.tsx                          # [废弃] 拆分为下方子模块
│       ├── Inspection/
│       │   ├── index.tsx                           # [新建] Tab 容器页面
│       │   ├── InspectionNow.tsx                   # [新建] 即时巡检 Tab
│       │   ├── TemplateManagement.tsx              # [新建] 模板管理 Tab
│       │   └── HistoryReports.tsx                  # [新建] 历史报告 Tab
│       └── Notifications.tsx                       # [新建] 通知中心页面
```

---

## 技术决策备忘

| 决策 | 选择 | 理由 |
|------|------|------|
| 基线文档存储 | 本地磁盘 `.md` 文件，DB 存路径 | 用户选择；文件可直接下载查看，DB 只做索引 |
| 基线目录 | `backend/data/baselines/{templateId}/` | 按模板隔离，支持多版本 |
| 定时任务 | `node-cron` 进程内调度 | 轻量，无需外部依赖（Redis 等）；重启时从 DB 加载 |
| Agent 解析 | 调用 DeepSeek API（复用现有 `agentParser`） | 与对话功能同一 LLM，无需额外配置 |
| 前端 Tab 组件 | Ant Design `Tabs` | 与现有 UI 库一致 |
| 通知未读数 | 前端轮询 `GET /api/notifications/unread-count` | 简单可靠，后续可升级为 WebSocket |
| 通知确认方式 | Agent 在聊天页面发消息，用户直接回复确认（第二期） | 用户选择 |
| 站内信展示 | 铃铛下拉 + 独立通知中心页面 | 两者都要 |

---

## 第一期：巡检增强 + Agent 报告解析 + 基线文档 + 站内信

### 数据库建模

- [x] OP01 - 设计 InspectionTemplate 模型（id, name, description, deviceType, commands[JSON], devices[JSON], createdAt, updatedAt）
- [x] OP02 - 设计 InspectionRecord 模型（id, templateId, agentId, status[running/success/failed], devices[JSON], results[JSON], reportPath, startTime, endTime, summary[JSON]）
- [x] OP03 - 设计 InspectionSchedule 模型（id, templateId, agentId, cronExpression, enabled, lastRunTime, lastRunStatus, createdAt, updatedAt）
- [x] OP04 - 设计 Notification 模型（id, userId, title, content, type[inspection/report/baseline/system], relatedRecordId, isRead, createdAt）
- [x] OP05 - 设计 BaselineDocument 模型（id, templateId, filePath, generatedAt, version, isActive）
- [x] OP06 - 在 Agent 模型中添加反向关联字段（records, schedules），编写数据库迁移脚本并应用

### 后端 - 巡检模板管理

- [x] OP07 - 实现 GET /api/inspection/templates 模板列表接口
- [x] OP08 - 实现 POST /api/inspection/templates 创建模板接口
- [x] OP09 - 实现 PUT /api/inspection/templates/:id 更新模板接口
- [x] OP10 - 实现 DELETE /api/inspection/templates/:id 删除模板接口

### 后端 - 巡检记录与报告

- [x] OP11 - 重构现有 POST /api/inspection 接口，巡检结果持久化到 InspectionRecord
- [x] OP12 - 实现 GET /api/inspection/records 巡检记录列表接口（分页、状态筛选）
- [x] OP13 - 实现 GET /api/inspection/records/:id 巡检记录详情接口
- [x] OP14 - 实现 reportGenerator.ts 报告生成服务（结构化 Markdown 报告）

### 后端 - 定时任务调度

- [x] OP15 - 实现 scheduler.ts 定时任务调度服务（基于 node-cron）
- [x] OP16 - 实现 POST /api/inspection/schedules 创建定时任务接口
- [x] OP17 - 实现 PUT /api/inspection/schedules/:id 更新定时任务接口
- [x] OP18 - 实现 DELETE /api/inspection/schedules/:id 删除定时任务接口
- [x] OP19 - 实现 POST /api/inspection/schedules/:id/run 手动触发定时任务接口
- [x] OP20 - 实现定时任务启动时自动加载已有 enabled 任务
- [x] OP21 - 实现定时任务执行完毕后自动触发报告生成 + Agent 解析流程

### 后端 - Agent 报告解析与基线文档

- [x] OP22 - 实现 agentParser.ts Agent 报告解析服务（调用 DeepSeek API）
- [x] OP23 - 实现首次巡检完成时 Agent 生成基线文档（.md 文件写入 backend/data/baselines/）
- [x] OP24 - 实现 GET /api/inspection/baselines/:templateId 获取基线文档接口
- [x] OP25 - 实现 POST /api/inspection/baselines/:templateId/regenerate 重新生成基线接口
- [x] OP26 - 实现非首次巡检完成时 Agent 读取基线文档 + 分析当前报告 + 输出分析结果

### 后端 - 站内信通知

- [x] OP27 - 新建 routes/notifications.ts 通知路由文件
- [x] OP28 - 实现 GET /api/notifications 通知列表接口（分页、未读筛选）
- [x] OP29 - 实现 PUT /api/notifications/:id/read 标记已读接口
- [x] OP30 - 实现 PUT /api/notifications/read-all 全部标记已读接口
- [x] OP31 - 实现 DELETE /api/notifications/:id 删除通知接口
- [x] OP32 - 实现 GET /api/notifications/unread-count 获取未读数量接口
- [x] OP33 - 实现 Agent 分析结果自动写入 Notification 表

### 前端 - 巡检页面重构

- [x] OP34 - 新建 Inspection/index.tsx Tab 容器页面（即时巡检 / 巡检模板 / 历史报告 三个 Tab）
- [x] OP35 - 实现 InspectionNow.tsx 即时巡检 Tab（迁移现有 Inspection.tsx 功能，增加选择模板快速加载）
- [x] OP36 - 实现 TemplateManagement.tsx 模板管理 Tab（卡片式展示，新建/编辑/删除模板）
- [x] OP37 - 实现 HistoryReports.tsx 历史报告 Tab（记录表格，状态/时间筛选，查看报告详情）
- [x] OP38 - 新建 frontend/src/api/inspection.ts 巡检相关 API 封装
- [x] OP39 - 更新 App.tsx 路由，巡检页面指向新的 Tab 容器
- [x] OP40 - 实现巡检报告详情弹窗（展示 MD 报告 + Agent 分析结果）

### 前端 - 站内信

- [x] OP41 - 新建 NotificationBell.tsx 顶部铃铛图标组件（Badge 未读数 + Drawer 下拉通知列表）
- [x] OP42 - 集成 NotificationBell 到 AppLayout.tsx 顶部导航栏
- [x] OP43 - 新建 Notifications.tsx 通知中心页面（表格展示、类型筛选、已读/未读筛选）
- [x] OP44 - 新建 frontend/src/api/notification.ts 通知相关 API 封装
- [x] OP45 - 实现通知中心中"设为新基线"操作按钮（调用 regenerate 接口）
- [x] OP46 - 更新 App.tsx 路由，新增通知中心路由

---

## 第二期：自然语言创建模板/任务 + 聊天确认流程

> 第二期依赖第一期全部完成后启动。核心目标：用户在聊天中用自然语言描述巡检需求，Agent 自动创建模板和定时任务，并通过聊天确认流程让用户审核。

### 后端 - Agent 对话式巡检

- [x] OP47 - 实现自然语言解析巡检需求服务（用户描述 → 结构化模板参数：设备类型、命令、设备列表、频率）
- [x] OP48 - 实现聊天中识别巡检意图并自动创建模板（后端 skill/tool 扩展，新增 `create_inspection_template` 工具）
- [x] OP49 - 实现聊天中识别巡检意图并自动创建定时任务（关联模板 + agent + cron，新增 `create_inspection_schedule` 工具）
- [x] OP50 - 实现聊天确认流程后端接口（Agent 发出确认请求 → 用户回复确认 → 触发任务创建）
- [x] OP51 - 实现聊天消息与 Notification 的关联（任务创建确认结果推送通知）

### 前端 - 聊天增强

- [x] OP52 - 实现聊天中巡检任务确认卡片组件（展示模板摘要 + 确认/取消按钮，自定义消息类型渲染）
- [x] OP53 - 实现确认后自动跳转至巡检模板/任务管理页面
- [x] OP54 - 实现聊天中展示巡检分析结果卡片（内联展示 Agent 分析摘要 + 查看详情链接）

### 前端 - 定时任务管理

- [x] OP55 - 在 Inspection Tab 容器新增"定时任务"Tab
- [x] OP56 - 实现定时任务列表页面（展示 cron 表达式、关联模板、启用/禁用开关、手动触发按钮）
- [x] OP57 - 实现定时任务创建/编辑表单（选择模板、选择 Agent、设置 cron 表达式、启用状态）

---

## 完成统计

### 第一期

| 状态 | 数量 |
|:----:|-----:|
| ✅ 已完成 | **39** |
| ❌ 未完成 | 7 |
| **总计** | **46** |

### 第二期

| 状态 | 数量 |
|:----:|-----:|
| ✅ 已完成 | 11 |
| ❌ 未完成 | 0 |
| **总计** | **11** |

---

**第一期完成度: 85% (39/46)** | **第二期完成度: 100% (11/11)** | **整体完成度: 88% (50/57)**
