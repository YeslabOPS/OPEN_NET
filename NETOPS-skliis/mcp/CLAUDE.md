# CLAUDE.md — eNSP MCP Server 项目

## 项目概述

本项目是一个 **MCP Server**，用于通过 MCP 协议管理 eNSP 模拟器中的华为网络设备。

**唯一调用方式**: 通过 MCP 协议（stdio JSON-RPC），由 `server.py` 提供 9 个 MCP 工具。
**不再支持** LLM 直接执行 Python 脚本的方式（api.py 已移除）。

## 环境信息

- **Python 路径**: `python`（需 Python 3.10+）
- **依赖**: `paramiko`, `chardet`, `mcp>=1.1.2`
- **目标设备**: 华为交换机、路由器（VRP 系统）
- **连接方式**: SSH / Telnet
- **操作系统**: Windows 宿主机

## 安装与配置

```bash
# 安装依赖
cd ensp
pip install -e .

# 验证安装
python -c "from ensp.server import main; print('MCP Server 模块可用')"
```

MCP Server 启动方式：`python -m ensp.server`（由 CodeBuddy 或其他 MCP 客户端自动管理进程）

## ⚠️ 网络设备配置核心规则（必须严格遵守）

对华为设备执行任何配置时，以下规则必须遵守。**system-view 和 [Y/N] 处理已内置在 `connection.py` 中，但了解规则对正确生成配置命令很重要。**

---

### Rule 1：用户只需提供业务命令

**`configure-device-by-name` 和 `batch-configure` 系统自动处理：**
- `system-view` — 自动进入系统视图（不在用户命令中写）
- `return` — 配置完成后自动返回用户视图
- `[Y/N]` 确认提示 — 自动检测并应答 `Y`

**用户只需提供业务命令**（如接口配置、OSPF 配置），示例：
```
commands = [
    "interface GigabitEthernet0/0/0",
    "ip address 192.168.12.1 255.255.255.0",
    "quit",
    "ospf 1 router-id 1.1.1.1",
    "area 0",
    "network 192.168.12.0 0.0.0.255",
    "quit",
]
```

**注意：** `system-view`、`save`、`y` 不要写在业务命令中，系统会自动处理。

### Rule 2：配置保存由用户按需决定

**系统不再自动保存配置。** 如需保存配置，有以下两种方式：

- **在 `commands` 末尾加上 `["return", "save", "y"]`**
- **调用时传 `save_config=True`**（但建议用命令方式，更可控）

### Rule 3：处理确认提示（[Y/N]）

以下命令执行后会弹出 `[Y/N]` 确认提示，**系统会自动发送 `Y`**：
- `undo ospf <id>`
- `undo interface`
- `undo vlan`
- `reset ospf process`
- **所有 `undo` 类命令**
- `save`（如果包含在命令中）

### Rule 4：每条命令后必须读取回显

已经内置在 `connection.py` 中。每条命令发送后会读取回显并检测错误关键字。

### Rule 5：错误检测关键字

回显中包含以下关键字时视为执行失败（系统会继续执行后续命令但记录错误）：
- `Error`
- `Unrecognized command`
- `Incomplete command`
- `%`（百分号开头的错误提示）

## MCP 工具列表

| 工具名 | 用途 |
|--------|------|
| `init-project` | 扫描工作目录，发现拓扑文件 |
| `load-topology` | 加载 `.topo` 文件，解析设备 |
| `list-devices` | 列出所有设备 |
| `get-topology-info` | 获取拓扑摘要 |
| `test-connectivity` | 测试设备连通性 |
| `configure-device-by-name` | 按设备名配置 |
| `show-device-by-name` | 按设备名查询 |
| `batch-configure` | 批量配置 |
| `save-to-file` | 保存到文件 |
| `reset` | 重置 MCP Server 状态，清除设备缓存（新会话开始前调用） |

## 配置执行流程图

```
开始配置任务
  │
  ├─ 1. 调用 configure-device-by-name(device_name, commands)
  │       commands = [业务命令]  // 不含 system-view/save/y
  │
  ├─ 2. server.py 内部自动处理：
  │     ├─ 查找设备端口
  │     ├─ Telnet/SSH 连接
  │     ├─ 发送 system-view（自动进入系统视图）
  │     ├─ 逐条发送业务命令 + 读取回显
  │     ├─ 自动处理 [Y/N] 确认提示
  │     ├─ 发送 return（回到用户视图）
  │     └─ 关闭连接（不自动 save）
  │
  └─ 3. 调用 show-device-by-name 验证
        如需保存，在 commands 末尾加 return, save, y
```

## 常见配置场景模板

### 接口 IP 配置

```json
{
  "device_name": "AR1",
  "commands": [
    "interface GigabitEthernet0/0/0",
    "ip address 192.168.12.1 255.255.255.0",
    "quit"
  ]
}
```

### OSPF 配置

```json
{
  "device_name": "AR1",
  "commands": [
    "ospf 1 router-id 1.1.1.1",
    "area 0",
    "network 192.168.12.0 0.0.0.255",
    "quit",
    "quit"
  ]
}
```

### VLAN 配置

```json
{
  "device_name": "LSW1",
  "commands": [
    "vlan batch 10 20 30",
    "interface GigabitEthernet0/0/1",
    "port link-type access",
    "port default vlan 10",
    "quit"
  ]
}
```

## 目录与文件规则

- **禁止修改根目录文件**：不得修改项目根目录下的任何已有文件（包括 `.md`、`.py` 等所有文件）。
- **脚本与检查文件放 `log/`**：所有新建的脚本工具及用于检查任务效果的文件必须放在 `log/` 目录中。
