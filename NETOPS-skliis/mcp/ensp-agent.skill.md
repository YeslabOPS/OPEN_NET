# eNSP Network Device Configuration Agent Skill

This skill provides an automated workflow for configuring Huawei network devices in eNSP simulator via **MCP Server**. It guides through the entire process: topology discovery, device connection, and configuration deployment.

**调用方式**: 通过 MCP 协议调用 MCP Server，无需 LLM 直接执行脚本。

## Workflow Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Step 1         │     │  Step 2         │     │  Step 3         │     │  Step 4         │
│  Discover Topo  │ --> │  Connect Device │ --> │  Configure      │ --> │  Verify Config  │
│  (Read Only)    │     │  (User Input)   │     │  (Apply Config) │     │  (Validate)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Prerequisites

### MCP Server 环境

```bash
# 安装依赖
cd ensp
pip install -e .

# MCP Server 由 CodeBuddy 管理进程，无需手动启动
# CodeBuddy 配置：
codebuddy mcp add --scope user ensp -- python -m ensp.server
```

### eNSP Device Connection

eNSP devices can be connected via:
- **Telnet**: Default protocol, port mapped to localhost (127.0.0.1:2000, 2001, etc.)
- **SSH**: Requires additional configuration

## Usage

```
/ensp-agent [action]
```

**Actions:**
- `discover` - Step 1: Discover network topology
- `connect` - Step 2: Connect to devices (requires port input)
- `configure` - Step 3: Apply configuration to devices
- `verify` - Step 4: Verify configuration
- `full` - Execute all steps in sequence

---

## Step 1: Topology Discovery

### Objective
Discover all network devices and their connections from `.topo` files WITHOUT modifying them.

### Process

1. **Scan for topology files** using MCP tool `init-project`
2. **Parse topology file** using MCP tool `load-topology`
3. **Display discovered topology** using `list-devices`, `get-topology-info`

### MCP Tools to Use
- `init-project(working_dir, auto_load)` - Initialize and scan for topology files
- `load-topology(topo_file)` - Load and parse the .topo file
- `list-devices(filter)` - List all discovered devices
- `get-topology-info()` - Get topology summary

### Example (User Prompt to AI)
```
加载 topo/FRR.topo 文件，列出所有设备
```

### Example Output
```
# Network Topology Discovery Report

## Devices Found (5)

| Name  | Model   | Port | Type   | Interfaces        |
|-------|---------|------|--------|-------------------|
| AR1   | AR2220  | 2000 | Router | 2x GE             |
| AR2   | AR2220  | 2001 | Router | 2x GE             |
| AR3   | AR2220  | 2002 | Router | 2x GE             |
| AR4   | AR2220  | 2003 | Router | 2x GE             |
| LSW1  | S5700   | 2004 | Switch | 24x GE            |

## Connections
AR1 --GE0/0/0--> AR3 --GE0/0/1--> AR2 --GE0/0/0--> AR4
```

### Important Rules
- **NEVER modify .topo files** - they are read-only for discovery
- All parsing is done through MCP tools, not direct file editing

---

## Step 2: Device Connection

### Objective
Establish Telnet connections to eNSP devices. **Requires user to input device ports.**

### Process

1. **Prompt user for connection information**
   ```
   Please confirm device port mappings:
   - AR1: port 2000 (default from topology)
   - AR2: port 2001 (default from topology)
   ...
   Enter ports to connect (e.g., "2000,2001" or "all"): ___
   ```

2. **Test connectivity** using MCP tool `test-connectivity`

3. **Display connection status**

### MCP Tools to Use
- `test-connectivity(devices, method, timeout)` - Test device connections

### Example (User Prompt to AI)
```
测试 AR1 和 AR2 的连通性
```

### Example Interaction
```
# Device Connection Setup

Based on discovered topology, the following ports are available:

| Device | Default Port | Status   |
|--------|--------------|----------|
| AR1    | 2000         | Pending  |
| AR2    | 2001         | Pending  |
| AR3    | 2002         | Pending  |
| AR4    | 2003         | Pending  |

[USER INPUT REQUIRED]
Please specify which devices to connect:
- Enter device names (e.g., "AR1,AR2")
- Or enter "all" to connect all devices

Your input: ___

# Connection Test Results

| Device | Port  | Status   | Response Time |
|--------|-------|----------|---------------|
| AR1    | 2000  | OK       | 15ms          |
| AR2    | 2001  | OK       | 12ms          |
| AR3    | 2002  | OK       | 18ms          |
| AR4    | 2003  | OK       | 14ms          |
```

### Prerequisites
1. eNSP simulator must be running
2. Target devices must be started in eNSP
3. Port mapping must be configured in eNSP

---

## Step 3: Device Configuration

### Objective
Apply configuration commands to connected devices based on user requirements.

### Process

1. **Prompt user for configuration requirements**
2. **Generate configuration commands** based on user input
3. **Apply configuration** using MCP tools:
   - Single device: `configure-device-by-name`
   - Multiple devices: `batch-configure`
4. **Verify and save configuration**

### Critical Configuration Rules

**IMPORTANT: Follow these rules to ensure successful configuration:**

#### Rule 0: Enter System View (Handled by MCP Server)

The MCP Server (`connection.py`) automatically handles entering system view. **You don't need to include `system-view` in the commands list.** The server will:
1. Send `sys` multiple times to enter system view
2. Check for confirmation prompts after each command
3. Save configuration after changes

#### Rule 1: Handle Confirmation Prompts

The MCP Server automatically handles `[Y/N]` confirmation prompts. You don't need to add `Y` to the commands list.

#### Rule 2: Commands Template

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

### MCP Tools to Use
- `configure-device-by-name(device_name, commands, ...)` - Configure a single device
- `batch-configure(devices, ...)` - Configure multiple devices
- `show-device-by-name(device_name, command, ...)` - Verify configuration
- `save-to-file(content, file_path)` - Save configuration backup

### Example (User Prompt to AI)
```
给 AR1 的 GE0/0/0 配置 IP 192.168.12.1/24
```

### Example Configuration Scenarios

#### Scenario A: Interface IP Configuration
```
[USER INPUT]
Configure interface IP addresses:
- AR1 GE0/0/0: 192.168.12.1/24
- AR2 GE0/0/0: 192.168.12.2/24
- AR2 GE0/0/1: 192.168.23.2/24

Commands for AR1:
interface GigabitEthernet0/0/0
ip address 192.168.12.1 255.255.255.0
quit
```

#### Scenario B: OSPF Configuration
```
[USER INPUT]
Configure OSPF routing:
- Process ID: 1
- Area: 0
- Networks: 192.168.0.0 0.0.255.255

Commands for AR1:
ospf 1
area 0
network 192.168.12.0 0.0.0.255
quit
quit
```

#### Scenario C: Custom Commands
```
[USER INPUT]
Enter custom commands for AR1 (one per line):
interface LoopBack0
ip address 1.1.1.1 255.255.255.255
quit
```

### Configuration Result Example
```
# Configuration Results

## AR1
| Status      | Success      |
|-------------|--------------|
| Commands    | 3 executed   |
| Saved       | Yes          |

Output:
[AR1]system-view
[AR1]interface GigabitEthernet0/0/0
[AR1-GigabitEthernet0/0/0]ip address 192.168.12.1 255.255.255.0
[AR1-GigabitEthernet0/0/0]quit
Configuration saved successfully.
```

---

## Step 4: Configuration Verification (MANDATORY!)

### Objective
Verify that the configuration was applied correctly. **MUST verify after every configuration!**

### Verification Methods (Use Both if Possible):

**Method 1: Check Routing Table**
```
display ip routing-table
```

**Method 2: Check Current Configuration**
```
display current-configuration
```

### MCP Tools to Use
- `show-device-by-name(device_name, command)` - Execute show commands

### Example (User Prompt to AI)
```
查看 AR1 的路由表和当前配置
```

### Example Verification Output Check

**Good Result (Static Route Present):**
```
Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface
        2.2.2.2/32  Static  60   0          RD   10.1.12.2       GigabitEthernet0/0/0
```

**Good Result (OSPF Removed):**
```
No OSPF entries found in routing table
```

---

## Complete Workflow Example

### User Request
```
/ensp-agent full
```

### Workflow Steps (AI internal)

#### Phase 1: Discovery
```
# Step 1: Discovering Network Topology

AI 调用 MCP 工具:
1. init-project() → 找到 topo/FRR.topo
2. load-topology(topo_file="topo/FRR.topo") → 解析设备
3. list-devices() → 显示设备列表

Scanning topo/ directory...
Found: topo/FRR.topo

## Topology Summary
- AR1 (AR2220) - Port 2000
- AR2 (AR2220) - Port 2001
- AR3 (AR2220) - Port 2002
- AR4 (AR2220) - Port 2003
- LSW1 (S5700) - Port 2004
```

#### Phase 2: Connection
```
# Step 2: Establishing Device Connections

[ASK USER]
Based on the topology, I found these device ports:
- AR1: 2000
- AR2: 2001
- AR3: 2002
- AR4: 2003

Which devices do you want to connect? (Enter "all" or specific device names)

> all

AI 调用 test-connectivity(devices=["AR1","AR2","AR3","AR4"])
All devices reachable. Ready for configuration.
```

#### Phase 3: Configuration
```
# Step 3: Configure Devices

[ASK USER]
What configuration would you like to apply?

> 给所有路由器配接口 IP 并部署 OSPF

AI 生成配置并逐台调用 configure-device-by-name

Configuring AR1... Done
Configuring AR2... Done
Configuring AR3... Done
Configuring AR4... Done

# Configuration Complete
All 4 devices configured successfully.
```

#### Phase 4: Verification
```
# Step 4: Verify Configuration

AI 调用 show-device-by-name 验证每台设备

Checking AR1 routing table... OSPF routes present ✓
Checking AR2 routing table... OSPF routes present ✓
Checking AR3 routing table... OSPF routes present ✓
Checking AR4 routing table... OSPF routes present ✓

All configurations verified successfully!
```

---

## MCP Tool Reference

| Tool | Description | Step |
|------|-------------|------|
| `init-project` | Initialize and scan project | 1 |
| `load-topology` | Load .topo file | 1 |
| `list-devices` | List discovered devices | 1 |
| `get-topology-info` | Get topology summary | 1 |
| `test-connectivity` | Test device connection | 2 |
| `configure-device-by-name` | Configure single device | 3 |
| `batch-configure` | Configure multiple devices | 3 |
| `show-device-by-name` | Execute show commands | 3 |
| `save-to-file` | Save configuration backup | 3 |

---

## Important Notes

### Read-Only Topology
- The `.topo` files should NEVER be modified
- All discovery is done through MCP tools, not file editing

### User Input Requirements
- Step 2 requires user to confirm/input device ports
- Step 3 requires user to specify configuration requirements
- Always confirm before applying configuration

### Safety Measures
1. Always test connectivity before configuration
2. Show generated commands before execution
3. Require user confirmation for critical changes
4. Save configuration after each successful change
5. **MANDATORY verification after configuration**

### Error Handling
- If device unreachable, skip and continue with others
- If command fails, MCP Server reports error
- Always provide rollback information

---

## Related Skills
- `/ensp-config` - Basic single-device configuration
- `/ensp-agent` - This workflow-based agent skill
