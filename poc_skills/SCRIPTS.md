# NetOps Agent Skills - 启动脚本

## 环境要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0

## 安装依赖

```bash
# 在项目根目录执行
pnpm install
```

## 后端启动

```bash
# 进入后端目录
cd backend

# 复制环境变量配置
cp .env.example .env
# 编辑 .env，填入您的 DEEPSEEK_API_KEY

# 生成 Prisma 客户端
pnpm prisma generate

# 初始化数据库
pnpm prisma db push

# 初始化内置数据
pnpm prisma seed

# 启动开发服务器
pnpm dev
```

后端服务地址: http://localhost:8000

## 前端启动

```bash
# 新开一个终端，进入前端目录
cd frontend

# 安装依赖（如果还没安装）
pnpm install

# 启动开发服务器
pnpm dev
```

前端服务地址: http://localhost:3000

## 快速开始流程

1. 启动后端服务
2. 启动前端服务
3. 打开浏览器访问 http://localhost:3000
4. 进入「系统配置」页面，配置 DeepSeek API Key
5. 进入「智能对话」页面，开始使用网络巡检助手

## 可用脚本

### 根目录
- `pnpm dev` - 同时启动前后端开发服务器
- `pnpm build` - 构建所有项目
- `pnpm clean` - 清理所有构建产物

### 后端
- `pnpm dev` - 启动开发服务器（热重载）
- `pnpm build` - 构建生产版本
- `pnpm prisma:generate` - 生成 Prisma 客户端
- `pnpm prisma:push` - 推送数据库变更
- `pnpm prisma:seed` - 初始化种子数据

### 前端
- `pnpm dev` - 启动 Vite 开发服务器
- `pnpm build` - 构建生产版本
- `pnpm preview` - 预览生产构建
