# eNSP-Skills

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**eNSP-Skills** 是一个基于 **MCP 协议** 的华为网络设备管理工具，用于自动化配置 eNSP 模拟器中的路由器/交换机。

> 通过 CodeBuddy / Claude Desktop 等 MCP 客户端，直接用自然语言管理网络设备。

---

## 架构

```
┌─────────────────────────┐
│  用户（你说中文即可）      │
│  "给 AR1 配个 IP"        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  MCP 客户端               │
│  (CodeBuddy / Claude)    │
│  ─ 理解意图               │
│  ─ 调用 MCP Tool          │
└────────┬────────────────┘
         │ JSON-RPC (stdio)
         ▼
┌─────────────────────────┐
│  eNSP MCP Server        │  ← 常驻进程
│  ─ topo_parser.py       │
│  ─ device_manager.py    │
│  ─ connection.py        │
│  ─ models.py            │
└────────┬────────────────┘
         │ Telnet/SSH
         ▼
┌─────────────────────────┐
│  eNSP 模拟器              │
│  (AR1~AR4, LSW1)        │
└─────────────────────────┘
```

## 功能特性

| 功能 | 说明 |
|------|------|
| 拓扑自动发现 | 解析 `.topo` 文件，自动识别设备和连接关系 |
| Telnet/SSH 连接 | 支持 Telnet 和 SSH 两种连接方式 |
| 单设备配置 | 通过设备名自动查找端口并配置 |
| 批量设备配置 | 一次性配置多台设备 |
| 配置验证 | 执行 `display` 命令查询设备状态 |
| 配置保存 | 将回显保存到本地文件 |

## 快速开始

### 1. 安装依赖

```bash
cd ensp
pip install -e .
```

### 2. 在 CodeBuddy 中添加 MCP Server

```bash
# 在项目根目录执行
codebuddy mcp add --scope user ensp -- python -m ensp.server
```

或创建项目级配置 `.mcp.json`：

```json
{
  "mcpServers": {
    "ensp": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "ensp.server"],
      "description": "eNSP 网络设备管理 MCP Server"
    }
  }
}
```

### 3. 重启 CodeBuddy，开始聊天

```
你：发现 eNSP 拓扑
你：列出所有设备
你：给 AR1 配接口 IP 192.168.12.1/24
你：查看 AR1 的路由表
```

## MCP Server 提供的工具

| 工具名 | 功能 |
|--------|------|
| `init-project` | 初始化项目，扫描 `.topo` 文件 |
| `load-topology` | 加载 `.topo` 文件，解析设备 |
| `list-devices` | 列出所有设备（支持筛选） |
| `get-topology-info` | 获取拓扑摘要信息 |
| `test-connectivity` | 测试设备连通性 |
| `configure-device-by-name` | 按设备名配置（最常用） |
| `show-device-by-name` | 按设备名查询信息 |
| `batch-configure` | 批量配置多台设备 |
| `save-to-file` | 保存内容到文件 |

## 项目结构

```
ensp-skills/
├── ensp/                          # 核心 Python 包
│   ├── src/ensp/
│   │   ├── server.py              # 🔥 MCP Server 入口
│   │   ├── topo_parser.py         # .topo 文件解析器
│   │   ├── device_manager.py      # 设备管理器
│   │   ├── connection.py          # Telnet/SSH 连接管理
│   │   └── models.py              # 数据模型
│   └── pyproject.toml             # 依赖：mcp>=1.1.2, paramiko, chardet
├── topo/                          # 拓扑文件目录
│   └── FRR.topo                   # 示例拓扑（4台AR2220 + 1台S5700）
├── log/                           # 日志目录
├── .mcp.json                      # MCP Server 配置（示例）
├── ensp-agent.skill.md            # Agent 工作流 Skill
└── README.md                      # 本文件
```

## 使用示例

### 发现拓扑

```
你：帮我看看网络拓扑
→ CodeBuddy 自动调用 init-project → load-topology → list-devices
→ 返回：发现 5 台设备（AR1-AR4, LSW1）
```

### 配置接口 IP

```
你：给 AR1 的 GE0/0/0 配 IP 192.168.12.1/24
→ CodeBuddy 调用 configure-device-by-name
→ 返回：配置成功，已保存
```

### 部署 OSPF

```
你：在所有路由器上部署 OSPF，进程号 1，区域 0
→ CodeBuddy 逐台调用 configure-device-by-name
→ 返回：4 台路由器配置成功
```

### 验证配置

```
你：查看 AR1 的路由表
→ CodeBuddy 调用 show-device-by-name
→ 返回：显示 OSPF 路由条目
```

## 注意事项

1. **eNSP 必须运行中** 且设备已启动
2. 默认使用 Telnet 连接（端口 2000~2004，自动从拓扑文件读取）
3. MCP Server 是**常驻进程**，由 CodeBuddy 管理生命周期
4. 编码：eNSP 使用 GBK 编码，Server 已自动处理

## 技术栈

- **Python 3.10+** — 核心运行时
- **MCP SDK (>=1.1.2)** — MCP 协议实现
- **Paramiko** — SSH 连接
- **Socket** — Telnet 连接
- **XML.etree** — .topo 文件解析

## 许可证

MIT License
