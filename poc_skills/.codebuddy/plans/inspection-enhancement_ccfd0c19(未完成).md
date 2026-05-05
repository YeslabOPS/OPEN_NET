---
name: inspection-enhancement
overview: 完善巡检功能，新增巡检模板管理、定时任务调度、历史报告查看三大模块，前后端同步实现。
design:
  architecture:
    framework: react
  styleKeywords:
    - Professional
    - Clean
    - Data-driven
    - Ant Design
  fontSystem:
    fontFamily: Ant Design Default
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#1890ff"
      - "#096dd9"
      - "#40a9ff"
    background:
      - "#f0f2f5"
      - "#ffffff"
    text:
      - "#000000d9"
      - "#000000a6"
      - "#00000040"
    functional:
      - "#52c41a"
      - "#ff4d4f"
      - "#faad14"
      - "#1890ff"
todos:
  - id: update-schema
    content: 修改 Prisma schema，新增 InspectionTemplate、InspectionRecord、InspectionSchedule 三张表模型
    status: pending
  - id: install-deps
    content: 安装后端依赖 node-cron 和 @types/node-cron，执行 prisma db push 更新数据库
    status: pending
    dependencies:
      - update-schema
  - id: create-scheduler-service
    content: 创建 backend/src/services/scheduler.ts 定时任务调度服务，实现定时任务的加载、添加、移除和执行
    status: pending
    dependencies:
      - install-deps
  - id: update-inspection-routes
    content: 修改 backend/src/routes/inspection.ts，新增模板管理、记录查询、定时任务 CRUD 等 API 路由
    status: pending
    dependencies:
      - create-scheduler-service
  - id: create-frontend-api
    content: 创建 frontend/src/api/inspection.ts，封装巡检模板、记录、定时任务的 API 调用
    status: pending
  - id: create-inspection-pages
    content: 创建前端 Inspection 目录下的 Tab 容器页面和三个子页面（即时巡检、模板管理、历史报告）
    status: pending
    dependencies:
      - create-frontend-api
  - id: update-app-entry
    content: 更新前端路由和布局配置，确保 Inspection 相关页面路由正确，测试完整功能流程
    status: pending
    dependencies:
      - create-inspection-pages
---

## 用户需求

完善巡检功能，支持：

1. **定时任务** - 周期性自动执行巡检
2. **巡检模板** - 预定义设备组和命令模板
3. **历史报告查看** - 持久化巡检结果，支持回溯查看

范围：前后端一起完善。

## 产品概述

面向网络运维领域的智能运维平台，当前巡检功能仅支持手动执行，缺少模板管理、定时调度和历史记录查看能力。完善后将成为完整的智能巡检解决方案。

## 核心功能

- **巡检模板管理**：创建/编辑/删除巡检模板，预定义设备类型、巡检命令、设备列表
- **定时巡检任务**：基于 cron 表达式的定时任务，自动执行巡检并保存结果
- **历史报告查看**：持久化存储巡检记录，支持按时间、设备、状态筛选查看详情
- **即时巡检增强**：支持选择模板快速加载设备和命令，执行即时巡检

## 技术栈选型

- **后端**：Node.js + Express + Prisma + SQLite（保持现有栈不变）
- **定时任务**：node-cron（轻量级 cron 实现，适合此场景）
- **前端**：React 18 + TypeScript + Ant Design 5 + Zustand（保持现有栈不变）

## 实施方案

### 1. 数据库模型设计

在 `backend/prisma/schema.prisma` 中新增三张表：

```
// ============================================================
// 巡检模板
// ============================================================
model InspectionTemplate {
  id          String   @id @default(cuid())
  name        String   // 模板名称
  description String?  // 模板描述
  deviceType  String   @default("generic") // 设备类型
  commands    String   // JSON array，巡检命令列表
  devices     String?  // JSON array，预设设备列表（可选）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关联
  schedules   InspectionSchedule[]
  records     InspectionRecord[]

  @@map("inspection_templates")
}

// ============================================================
// 巡检记录
// ============================================================
model InspectionRecord {
  id            String   @id @default(cuid())
  templateId    String?  // 关联的模板（可选）
  template      InspectionTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  agentId       String   // 执行使用的 Agent
  agent         Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  status        String   @default("running") // running | success | failed
  devices       String   // JSON array，实际巡检设备列表
  results       String?  // JSON array，巡检结果（完成时写入）
  startTime     DateTime @default(now())
  endTime       DateTime?
  summary       String?  // JSON object，{ total, success, failed }

  @@index([startTime])
  @@index([status])
  @@map("inspection_records")
}

// ============================================================
// 定时巡检任务
// ============================================================
model InspectionSchedule {
  id            String   @id @default(cuid())
  templateId    String   // 关联的模板
  template      InspectionTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  agentId       String   // 执行使用的 Agent
  agent         Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  cronExpression String  // cron 表达式，如 "0 2 * * *"
  enabled       Boolean  @default(true)
  lastRunTime   DateTime? // 上次执行时间
  lastRunStatus String?   // 上次执行状态
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("inspection_schedules")
}
```

### 2. 后端 API 设计

在 `backend/src/routes/inspection.ts` 中新增路由：

#### 巡检模板 API

- `GET /api/inspection/templates` - 获取所有模板
- `GET /api/inspection/templates/:id` - 获取单个模板
- `POST /api/inspection/templates` - 创建模板
- `PUT /api/inspection/templates/:id` - 更新模板
- `DELETE /api/inspection/templates/:id` - 删除模板

#### 巡检记录 API

- `GET /api/inspection/records` - 获取巡检记录列表（支持筛选、分页）
- `GET /api/inspection/records/:id` - 获取单个记录详情
- `DELETE /api/inspection/records/:id` - 删除记录

#### 定时任务 API

- `GET /api/inspection/schedules` - 获取所有定时任务
- `POST /api/inspection/schedules` - 创建定时任务
- `PUT /api/inspection/schedules/:id` - 更新定时任务
- `DELETE /api/inspection/schedules/:id` - 删除定时任务
- `POST /api/inspection/schedules/:id/run` - 手动触发执行

#### 定时任务服务

新增 `backend/src/services/scheduler.ts`：

- 使用 node-cron 管理定时任务
- 应用启动时加载所有启用的定时任务
- 提供动态添加/移除定时任务的接口
- 定时任务触发时自动创建 InspectionRecord 并执行巡检

### 3. 前端改造

#### 页面结构改造

将当前 Inspection.tsx 改为 Tab 模式容器页面，包含三个子页面：

- **即时巡检**（现有功能迁移增强）
- **巡检模板**（新增）
- **历史报告**（新增）

#### 新增前端文件

- `frontend/src/api/inspection.ts` - 巡检相关 API 封装
- `frontend/src/pages/Inspection/index.tsx` - Tab 容器页面
- `frontend/src/pages/Inspection/InspectionNow.tsx` - 即时巡检子页面
- `frontend/src/pages/Inspection/TemplateManagement.tsx` - 模板管理子页面
- `frontend/src/pages/Inspection/HistoryReports.tsx` - 历史报告子页面

#### 前端 API 封装（inspection.ts）

```typescript
// 巡检模板 API
export const templateApi = {
  list: () => apiClient.get('/inspection/templates'),
  get: (id: string) => apiClient.get(`/inspection/templates/${id}`),
  create: (data: any) => apiClient.post('/inspection/templates', data),
  update: (id: string, data: any) => apiClient.put(`/inspection/templates/${id}`, data),
  delete: (id: string) => apiClient.delete(`/inspection/templates/${id}`),
};

// 巡检记录 API
export const recordApi = {
  list: (params?: any) => apiClient.get('/inspection/records', { params }),
  get: (id: string) => apiClient.get(`/inspection/records/${id}`),
  delete: (id: string) => apiClient.delete(`/inspection/records/${id}`),
};

// 定时任务 API
export const scheduleApi = {
  list: () => apiClient.get('/inspection/schedules'),
  create: (data: any) => apiClient.post('/inspection/schedules', data),
  update: (id: string, data: any) => apiClient.put(`/inspection/schedules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/inspection/schedules/${id}`),
  run: (id: string) => apiClient.post(`/inspection/schedules/${id}/run`),
};
```

### 4. 实施要点

#### 性能考虑

- 巡检记录列表使用分页查询，避免一次性加载大量数据
- 巡检结果（commands 输出）可能很大，详情接口单独查询
- 定时任务使用 node-cron 的调度，而非数据库轮询，减少资源消耗

#### 可靠性考虑

- 定时任务执行时捕获所有异常，更新 lastRunStatus
- 巡检记录状态机：running -> success/failed
- 模板删除时，已执行的记录保留（templateId 设为 null）

#### 向后兼容

- 现有 `POST /api/inspection` 接口保持不变
- 现有 Inspection.tsx 功能迁移到 InspectionNow.tsx，保持用户体验一致

## 目录结构变更

```
backend/
├── prisma/
│   └── schema.prisma          # [MODIFY] 新增三张表模型
├── src/
│   ├── routes/
│   │   └── inspection.ts      # [MODIFY] 新增模板/记录/定时任务路由
│   └── services/
│       └── scheduler.ts       # [NEW] 定时任务调度服务

frontend/
├── src/
│   ├── api/
│   │   └── inspection.ts      # [NEW] 巡检相关 API 封装
│   └── pages/
│       └── Inspection/
│           ├── index.tsx              # [NEW] Tab 容器页面
│           ├── InspectionNow.tsx      # [NEW] 即时巡检
│           ├── TemplateManagement.tsx # [NEW] 模板管理
│           └── HistoryReports.tsx     # [NEW] 历史报告
```

## 依赖变更

- 后端新增：`node-cron`（定时任务）
- 后端新增：`@types/node-cron`（TypeScript 类型）

## 设计风格

采用现代化、专业化的运维管理界面风格，基于 Ant Design 5 组件库，保持与现有系统一致的视觉风格。

## 页面结构设计

### Inspection 主页面（Tab 容器）

- 使用 Ant Design 的 `Tabs` 组件
- 三个 Tab：即时巡检、巡检模板、历史报告
- 顶部显示页面标题和图标

### 即时巡检页面（InspectionNow.tsx）

基于现有 Inspection.tsx 功能迁移并增强：

- **顶部操作栏**：Agent 选择下拉框 + 模板快速选择下拉框 + 配置按钮
- **统计卡片行**：4 列布局，显示设备总数、巡检成功、巡检失败、成功率
- **设备列表卡片**：
- 标题：巡检设备列表
- 右上角操作：导入按钮、添加按钮、开始巡检按钮
- 表格：IP 地址、端口、用户名、设备类型、操作
- **巡检结果卡片**（执行后显示）：
- 表格：设备、状态、命令数、时间、操作
- 点击"查看详情"弹出 Modal 显示命令执行详情
- **设备编辑 Modal**：表单包含 IP、端口、用户名、密码、设备类型
- **配置 Modal**：修复现有未保存问题，实际保存设备列表到后端

### 巡检模板页面（TemplateManagement.tsx）

- **顶部操作栏**：搜索框（右侧）+ 新建模板按钮（左侧）
- **模板卡片网格**：响应式布局，每个模板显示：
- 模板名称（大标题）
- 设备类型（Tag 标签）
- 命令数量（Statistic）
- 更新时间
- 操作按钮：编辑、删除
- **模板编辑/创建 Modal**：
- 表单：模板名称（必填）、描述、设备类型（Select）
- 命令编辑器（TextArea）：每行一个命令，带语法提示
- 设备列表配置（可折叠）：JSON 编辑器或表格形式
- **交互**：
- 新建/编辑使用 Modal
- 删除使用 Modal.confirm 确认
- 操作反馈使用 message 全局提示

### 历史报告页面（HistoryReports.tsx）

- **顶部筛选栏**：
- 时间范围选择器（DateRangePicker）
- 状态筛选（Select：全部/成功/失败）
- 模板筛选（Select：全部 + 模板列表）
- 搜索按钮、重置按钮
- **报告列表表格**：
- 列：执行时间、模板名称、Agent、设备数、成功数、失败数、状态、耗时、操作
- 分页：默认每页 10 条
- 状态列使用 Tag 颜色区分（成功-绿色、失败-红色、执行中-蓝色）
- **报告详情 Drawer**：
- 右侧弹出，宽度 800px
- 顶部显示概要信息：执行时间、状态、耗时、设备统计
- 设备结果列表：可展开查看每个设备的命令执行详情
- 命令输出使用 `<pre>` 标签显示，支持复制

## 交互设计

- 使用 Ant Design 的 Table、Card、Modal、Drawer、Form、Tabs 等组件
- 列表页面使用分页（Pagination）
- 操作反馈使用 message 全局提示
- 巡检执行使用 Progress 组件显示进度
- 删除操作使用确认对话框
- 表单验证使用 Form.Item 的 rules 属性

## 响应式设计

- 统计卡片在小屏幕下自动调整为 2 列
- 表格支持水平滚动
- Modal 和 Drawer 在移动端全屏显示

## 字体系统

- 使用 Ant Design 默认字体系统
- 等宽字体用于命令和代码显示

## 色彩系统

- 主色调：Ant Design 默认蓝色（#1890ff）
- 成功状态：#52c41a
- 失败状态：#ff4d4f
- 警告状态：#faad14
- 信息状态：#1890ff
- 背景：#f0f2f5（Ant Design 默认背景色）
- 卡片背景：#ffffff