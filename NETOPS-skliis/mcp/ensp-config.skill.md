# eNSP Network Device Configuration Skill

This skill helps you configure Huawei network devices in eNSP simulator through **MCP Server** (Telnet/SSH connection via MCP protocol).

## Usage

通过 MCP 工具的 `configure-device-by-name` 完成设备配置。

## Prerequisites

### 1. Python Environment

```bash
cd ensp
pip install -e .
```

### 2. MCP Server Configuration

```bash
codebuddy mcp add --scope user ensp -- python -m ensp.server
```

### 3. eNSP Device Connection

eNSP devices can be connected via:
- **Telnet**: Default protocol, port mapped to localhost (127.0.0.1:2000, 2001, etc.)
- **SSH**: Requires additional configuration

## Quick Start

### Configure a Single Device

```
你：给 AR1 的 GE0/0/0 配 IP 192.168.1.1/24
```

AI 内部调用 MCP 工具：
```
Call: configure-device-by-name(device_name="AR1", commands=[
    "interface GigabitEthernet0/0/0",
    "ip address 192.168.1.1 255.255.255.0",
    "quit"
])
```

### Common Configuration Commands

```python
# Enter system view (自动由 MCP Server 处理，不需要在命令列表中包含)
# 直接写配置命令即可：

# Configure Loopback interface (Layer 3)
interface LoopBack 0
ip address 1.1.1.1 255.255.255.255
quit

# Configure VLAN
vlan 10
description VLAN_10
quit

# Configure VLANIF interface
interface Vlanif 10
ip address 192.168.10.1 255.255.255.0
quit
```

## Important Notes

### Device Interface Types

| Router Model | Ethernet Interface | Supports IP? |
|--------------|-------------------|--------------|
| AR201 | Ethernet0/0/x | NO (Layer 2 only) |
| AR2220+ | GigabitEthernet0/0/x | YES (Layer 3) |

For AR201 and similar low-end routers:
- Ethernet interfaces are Layer 2 only
- Use **Loopback** interfaces for IP configuration
- Or use VLAN + VLANIF for Layer 3 routing

### MCP Server 工作流程

```
1. 用户说话 → AI 理解意图
2. AI 决定调用 configure-device-by-name
3. MCP Server 接收请求
4. Server 自动处理：
   a. Telnet 连接 (127.0.0.1:port)
   b. 发送 '\n' 激活会话
   c. 进入 system-view 模式
   d. 逐条执行配置命令（含 [Y/N] 自动处理）
   e. 保存配置 (save + Y)
   f. 关闭连接
5. Server 返回结果给 AI
6. AI 展示结果给用户
```

## Example: Configure Multiple Loopback Interfaces

```
你：给 AR1 配 Loopback0 (1.1.1.1/32) 和 Loopback1 (192.168.10.1/24)
```

AI 调用：
```
Call: configure-device-by-name(device_name="AR1", commands=[
    "interface LoopBack 0",
    "ip address 1.1.1.1 255.255.255.255",
    "quit",
    "interface LoopBack 1",
    "ip address 192.168.10.1 255.255.255.0",
    "quit",
])
```

## Troubleshooting

### "Unrecognized command" Error
- **Cause**: Usually occurs with Ethernet interfaces on low-end routers
- **Solution**: Use Loopback interfaces instead

### Encoding Issues
- **Cause**: Windows console uses GBK, Python may use UTF-8
- **Solution**: MCP Server 已自动处理编码转换

### Connection Timeout
- **Cause**: eNSP device not started or wrong port
- **Solution**: Verify device is running in eNSP, check port mapping

## Related Skills
- `/ensp-agent` - Full workflow-based agent skill (topology discovery + configuration + verification)
