---
name: ospf-config
description: This skill should be used when the user asks to configure OSPF multi-area routing on Huawei VRP network devices (routers/switches), or requests OSPF configuration templates, verification, or troubleshooting in eNSP simulator or real network environments. Also use when the user wants to generate OSPF multi-area configuration documentation similar to lab exercise documents.
---

# OSPF 多区域配置技能

本技能提供华为 VRP 设备上 OSPF 多区域配置的完整指导，包括配置命令、自动化脚本、验证方法、巡检报告和排错指南。覆盖 Area 0 骨干区域、标准区域、Stub/NSSA 区域、ABR/ASBR 配置、路由汇总、认证安全、BFD、GR 等高阶场景。

---

## 触发场景

用户描述以下任一需求时加载此技能：

### 基础配置类
- "配置 OSPF 多区域"
- "给设备配 OSPF，分多个 area"
- "OSPF 怎么配多个区域"
- "需要 OSPF 配置文档"
- "配置 OSPF 区域间路由"

### 角色场景类
- "ABR / 虚链路 / Stub 区域配置"
- "如何配置 OSPF 路由汇总"
- "配置 OSPF 认证（MD5/HMAC-SHA256）"
- "OSPF 引入外部路由"
- "配置 OSPF 默认路由通告"

### 排错优化类
- "OSPF 邻居建立不起来"
- "OSPF 路由缺失/路由环路"
- "OSPF 性能优化"
- "OSPF 巡检检查"
- "OSPF GR / BFD / FRR 配置"
- 任何与 OSPF 多区域部署、配置、验证、排错、优化相关的问题

---

## 快速入口

| 需求 | 入口 |
|------|------|
| **自动化配置** | 使用 `scripts/ospf_config.py` |
| **配置参考文档**（命令手册、实验拓扑、验证方法） | 加载 `references/ospf-reference.md` |
| **巡检报告**（配置后生成详细报告） | 加载 `references/ospf-inspection.md` |
| **设备连接规则** | 参考下方「设备配置核心规则」 |

---

## 设备配置核心规则（必须遵守）

对华为 VRP 设备执行 OSPF 配置时，以下规则必须严格遵守：

### 规则 1：配置前必须进入 system-view

```
system-view           ← 进入系统视图
<OSPF 配置命令序列>    ← 执行配置
return                ← 退出到用户视图
```

### 规则 2：处理 [Y/N] 确认提示

以下 OSPF 相关命令会弹出 `[Y/N]` 确认提示，**必须发送 `Y`**：
- `undo ospf <process-id>` — 删除 OSPF 进程
- `reset ospf process` — 重启 OSPF 进程
- `reset ospf <pid> process` — 重启指定进程
- 所有 `undo` 类命令

### 规则 3：每条命令后必须读取回显

**严禁连续发送命令而不读取回显。** 按以下流程执行：

```
for cmd in commands:
    send(cmd)
    output = read()           # 必须读取回显
    if "[Y/N]" in output:     # 检测确认提示
        send("Y")
        output = read()       # 再次读取确认后的回显
    if "Error" in output:     # 检测错误
        log_error(cmd, output)
```

### 规则 4：错误检测关键字

回显中包含以下关键字时视为执行失败：
- `Error`
- `Unrecognized command`
- `Incomplete command`
- `%`（百分号开头的错误提示，如 `% Unrecognized command`）
- `Too many parameters`
- `Ambiguous command`

### 规则 5：修改 Router-ID 后必须重启 OSPF 进程

```
user-view 或 system-view:
reset ospf process          # 需要确认 Y
```

否则新 Router-ID 不生效。

---

## OSPF 核心概念速览

### LSA 类型

| 类型 | 名称 | 产生者 | 传播范围 | 用途 |
|------|------|--------|---------|------|
| Type 1 | Router LSA | 每台路由器 | 本区域 | 描述路由器接口状态和 Cost |
| Type 2 | Network LSA | DR | 本区域 | 描述广播网络上的所有路由器 |
| Type 3 | Summary LSA | ABR | 整个 OSPF 域 | 通告区域间路由 |
| Type 4 | ASBR Summary LSA | ABR | 整个 OSPF 域 | 通告 ASBR 位置 |
| Type 5 | AS External LSA | ASBR | 整个 OSPF 域 | 通告外部路由 |
| Type 7 | NSSA External LSA | ASBR (NSSA内) | NSSA 区域 | NSSA 区域引入外部路由 |

### OSPF 报文类型

| 类型 | 名称 | 用途 |
|------|------|------|
| 1 | Hello | 发现和维护邻居关系 |
| 2 | DBD (Database Description) | LSDB 摘要交换 |
| 3 | LSR (Link State Request) | 请求特定 LSA |
| 4 | LSU (Link State Update) | 发送 LSA 更新 |
| 5 | LSACK (Link State Acknowledgment) | 确认 LSA 接收 |

### 邻居状态机（关键状态）

```
Down → Init → 2-Way → ExStart → Exchange → Loading → Full
                |                                        |
                └─ (DR/BDR 选举)        (LSDB 同步完成) ─┘
```

- **Down**: 初始状态，未收到 Hello
- **Init**: 收到 Hello，但未看到自己的 Router-ID
- **2-Way**: 互相看到对方（DR/BDR 选举在此状态后完成）
- **ExStart**: 主从协商，确定初始 DBD 序号
- **Exchange**: 交换 DBD 描述包
- **Loading**: 发送 LSR 请求缺失 LSA
- **Full**: 完全邻接，LSDB 同步完成

### LSA 老化规则

- **MaxAge**: 3600 秒（1 小时），LSA 达到 MaxAge 被删除
- **Refresh**: 每 1800 秒（30 分钟）刷新一次 LSA
- **Age 检查**: 正常 LSA Age 应 < 1800，超过说明刷新异常
- **SeqNum**: LSA 序列号范围 0x80000001 ~ 0x7FFFFFFF

---

## 工作流程

### Step 1：了解用户需求

确认以下信息：

1. **设备型号** — AR2220 / AR201 / S5700 / CE12800 等
2. **网络类型** — 广播/P2P/NBMA/P2MP
3. **区域规划** — 多少个区域？哪些设备属于哪些区域？
4. **IP 编址方案** — 各接口 IP 地址和子网掩码
5. **特殊需求**：
   - Stub / Totally Stub / NSSA 区域？
   - 虚链路 (Virtual Link)？
   - OSPF 认证（MD5 / HMAC-SHA256）？
   - 路由汇总 (ABR / ASBR)？
   - 引入外部路由 (import-route)？
   - BFD 联动 / GR / FRR？
6. **故障场景**（如为排错请求）：哪个邻居起不来？什么路由看不到？

### Step 2：生成配置命令

根据区域规划，按以下模板生成每台设备的配置命令。

**OSPF 配置命令模板：**

```
# 进入系统视图
system-view

# 配置接口 IP（根据拓扑）
interface GigabitEthernet0/0/0
 ip address <ip-address> <subnet-mask>
 undo shutdown
 quit

# 配置 Loopback（作为 Router-ID）
interface LoopBack0
 ip address <router-id> 255.255.255.255
 quit

# 启用 OSPF
ospf <process-id> router-id <router-id>
 area <area-id-1>
  network <network-1> <wildcard-mask-1>
  network <network-2> <wildcard-mask-2>
 area <area-id-2>
  network <network-3> <wildcard-mask-3>
 quit

 return
```

**通配符掩码计算：** 通配符掩码 = 子网掩码按位取反
- `255.255.255.0` → `0.0.0.255`
- `255.255.0.0` → `0.0.255.0`
- `255.255.255.252` → `0.0.0.3`
- `255.255.255.255` → `0.0.0.0`（精确匹配主机地址）

### Step 3：执行配置

使用 `scripts/ospf_config.py` 自动化配置，支持以下模式：

| 模式 | 命令 | 说明 |
|------|------|------|
| 单设备交互 | `python ospf_config.py 2000` | 逐条输入命令 |
| 文件加载 | `python ospf_config.py 2000 commands.txt` | 从文件加载命令 |
| 批量配置 | `python ospf_config.py --batch` | 一键配置 6 台设备实验拓扑 |
| 生成命令 | `python ospf_config.py --generate AR1 1.1.1.1` | 输出配置命令到控制台 |

**注意事项：**
- 默认使用 Telnet 连接 127.0.0.1
- 如需 SSH，需先配置设备 SSH 服务
- 批量为 eNSP 实验拓扑预设（端口 2000-2005）
- 脚本会自动完成配置流程

### Step 4：验证配置

配置后必须完整验证，执行以下命令并检查输出：

#### 4.1 基础验证（全部设备）

| 验证项 | 命令 | 预期结果 |
|--------|------|---------|
| 进程状态 | `display ospf brief` | 显示进程已启动 |
| 邻居 | `display ospf peer brief` | 所有邻居 State = Full |
| 接口 | `display ospf interface` | 接口已参与 OSPF，Cost 正确 |
| OSPF 路由 | `display ospf routing` | 学到所有区域路由 |
| IP 路由表 | `display ip routing-table protocol ospf` | 路由已加入（优先级 10） |
| ABR 身份 | `display ospf abr-asbr` | ABR 上显示自身为 ABR |
| LSDB | `display ospf lsdb` | LSDB 同步，LSA 类型完整 |

#### 4.2 深度验证（根据需要）

| 验证项 | 命令 | 说明 |
|--------|------|------|
| 错误统计 | `display ospf error` | 检查错误计数 |
| 接口详情 | `display ospf interface <if-name>` | 查看具体接口参数 |
| LSA 详情 | `display ospf lsdb router self-originate` | 查看自生 LSA |
| 虚链路 | `display ospf vlink` | 配置虚链路时使用 |
| SPF 统计 | `display ospf cumulative` | SPF 运行次数 |
| 全局状态 | `display ospf status` | 进程全局状态 |

### Step 5：生成配置文档

当用户需要类似实验指导书的文档输出时，加载 `references/ospf-reference.md` 并提取/整合以下内容：

1. **实验拓扑** — ASCII 拓扑图 + 设备接口 IP 规划表
2. **完整配置示例** — 每台设备的完整 CLI 配置
3. **验证方法** — 常用的 display 命令及预期输出
4. **进阶配置** — Stub/NSSA/虚链路/认证/汇总等
5. **排错指南** — 常见问题及解决方法

### Step 6：生成详细巡检报告

配置完成后，按以下流程生成巡检报告：

#### 6.1 告知与确认

告知用户将生成巡检报告，确认需要检查的设备范围。

#### 6.2 加载模板

加载 `references/ospf-inspection.md` 获取巡检命令模板和报告结构。

#### 6.3 逐台数据采集

使用 `show-device-by-name` MCP 工具（或其他远程登录方式）对每台设备执行命令：

| 数据项 | 命令 | 建议采集设备 |
|--------|------|------------|
| 邻居状态 | `display ospf peer brief` | 全部设备 |
| OSPF 路由 | `display ospf routing` | 全部设备 |
| IP 路由表 | `display ip routing-table protocol ospf` | 全部设备 |
| LSDB | `display ospf lsdb` | ABR + 每区域选一台 IR |
| ABR 信息 | `display ospf abr-asbr` | ABR |
| 接口信息 | `display ospf interface` | 全部设备 |
| Router LSA | `display ospf lsdb router` | 全部设备 |
| 错误统计 | `display ospf error` | 发现问题时采集 |
| 虚链路 | `display ospf vlink` | 配置了虚链路的设备 |
| 连通性 | `ping -a <src> <dst>` | 跨区域路径 |

**按角色分批采集：**
1. 先对 **ABR**（同时属于多个区域的设备）采集完整信息
2. 再对 **IR**（内部路由器）采集中等量信息
3. 最后做跨区域 **Ping** 验证

#### 6.4 分析数据

对采集的数据进行分析：
- **邻居**：是否全部 Full？数量是否符合拓扑？
- **路由**：路由条目数量、Cost、下一跳是否合理？
- **LSDB**：区域内是否一致？LSA 类型是否完整？
- **ABR/ASBR**：角色识别是否正确？
- **错误统计**：有无异常计数增长？

#### 6.5 生成报告

按模板结构输出完整报告，包含分析说明、检查项判定（✓/✗）和故障排查建议。

---

## 常见配置场景

### 场景 1：双区域 OSPF（简单多区域）

**拓扑：** 2 台路由器，AR1 在 Area 0，AR2 在 Area 1

```
AR1 (Area 0) ──GE0/0/0── AR2 (Area 1)
```

**配置要点：** AR1 是 ABR，需要配置 Area 0 和 Area 1；AR2 是 IR，只需配置 Area 1。

**AR1 配置：**
```
ospf 1 router-id 1.1.1.1
 area 0.0.0.0
  network 172.16.12.0 0.0.0.255
 area 0.0.0.1
  network 172.16.21.0 0.0.0.255
```

**AR2 配置：**
```
ospf 1 router-id 2.2.2.2
 area 0.0.0.1
  network 172.16.21.0 0.0.0.255
  network 2.2.2.2 0.0.0.0
```

### 场景 2：三区域 OSPF（标准多区域）

**拓扑：** 4-6 台路由器，Area 0 包含骨干，各非骨干区域挂接

```
        Area 0
    AR1 ── AR2 ── AR3
     │             │
   Area 1       Area 2
     │             │
    AR4           AR5
```

**配置要点：** AR1 和 AR3 是 ABR，分别配置 Area 0+Area1、Area 0+Area2；AR2 是骨干路由器，只需 Area 0。

### 场景 3：Stub 区域配置

在场景 2 基础上，将 Area 1 配置为 Stub 区域：

```
# ABR (AR1) 上配置
ospf 1
 area 0.0.0.1
  stub [no-summary]        # no-summary 表示 Totally Stub

# IR (AR4) 上配置
ospf 1
 area 0.0.0.1
  stub                     # 同一区域所有路由器必须配置 stub
```

**同时配置** `stub`，ABR 自动生成默认路由注入 Stub 区域。
**注意：** Stub 区域不能配置 `import-route`、不能存在 ASBR、不能配置虚链路。

### 场景 4：NSSA 区域配置

```
# ABR (AR1) 上配置
ospf 1
 area 0.0.0.1
  nssa [no-summary] [default-route-advertise]

# IR (AR4) 上配置
ospf 1
 area 0.0.0.1
  nssa                     # NSSA 区域允许引入少量外部路由
```

**NSSA vs Stub 区别：** NSSA 允许通过 Type 7 LSA 引入外部路由（如静态路由 / RIP），ABR 将 Type 7 转换为 Type 5。

### 场景 5：虚链路 (Virtual Link)

当非骨干区域无法物理直连 Area 0 时，通过虚链路穿越传输区域连接：

```
# 在 ABR1 (Router-ID: 1.1.1.1) 上配置虚链路到 ABR2 (Router-ID: 2.2.2.2)
# 传输区域不能是 Area 0 或 Stub 区域
ospf 1
 area <transit-area-id>
  vlink-peer <peer-router-id>

# 对端 ABR2 也需要配置
ospf 1
 area <transit-area-id>
  vlink-peer 1.1.1.1
```

**验证虚链路：**
```
display ospf vlink
```
- 对端 Router-ID 正确
- 状态为 Full
- 传输区域内路由可达

### 场景 6：OSPF 认证配置

**接口 MD5 认证：**
```
interface GigabitEthernet0/0/0
 ospf authentication-mode md5 1 plain Huawei@123
```

**接口 HMAC-SHA256 认证（V8 及以后版本）：**
```
interface GigabitEthernet0/0/0
 ospf authentication-mode hmac-sha256 1 plain Huawei@123
```

**区域认证（统一认证整个区域）：**
```
ospf 1
 area 0.0.0.0
  authentication-mode md5
```

然后在接口配置密钥：
```
interface GigabitEthernet0/0/0
 ospf authentication-mode md5 1 plain Huawei@123
```

**Keychain 认证（推荐用于生产环境）：**
```
keychain ospf-auth key-id 1
 algorithm hmac-sha256
 key-string plain Huawei@123
#
interface GigabitEthernet0/0/0
 ospf authentication-mode keychain ospf-auth
```

**注意：** 认证模式和密钥在同一链路上必须完全一致，否则邻居无法建立。

### 场景 7：OSPF 路由汇总

**ABR 汇总（区域间路由）：**
```
ospf 1
 area 0.0.0.1
  abr-summary 172.16.0.0 255.255.0.0    # 汇总 Area 1 的网段
```

**ASBR 汇总（外部路由）：**
```
ospf 1
 asbr-summary 10.0.0.0 255.0.0.0        # 汇总引入的外部路由
```

### 场景 8：OSPF 引入外部路由

```
# 引入直连路由（不含 OSPF 运行的接口）
ospf 1
 import-route direct

# 引入静态路由
ospf 1
 import-route static cost 20 type 1

# 引入 RIP
ospf 1
 import-route rip 1 cost 30 type 2

# 通告默认路由
ospf 1
 default-route-advertise always cost 10 type 2
```

**Type 1 vs Type 2：**
- **Type 1** (O E1)：累加内部 Cost + 外部 Cost，适合路径等价/非等价负载场景
- **Type 2** (O E2)：只计算外部 Cost（默认），适合简单外部接入

### 场景 9：OSPF BFD 联动

BFD 提供毫秒级故障检测，比 OSPF Hello（秒级）快得多：

```
# 全局使能 BFD
bfd
 quit

# 接口开启 OSPF BFD
interface GigabitEthernet0/0/0
 ospf bfd enable
 ospf bfd min-tx-interval 100        # 最小发送间隔 100ms
 ospf bfd min-rx-interval 100        # 最小接收间隔 100ms
 ospf bfd detect-multiplier 3         # 检测倍数
```

### 场景 10：OSPF GR (Graceful Restart)

主备倒换或进程重启时保持转发不中断：

```
# 配置 GR
ospf 1
 graceful-restart enable              # 使能 GR
 graceful-restart period 120          # GR 周期 120 秒
```

**验证 GR：**
```
display ospf graceful-restart status
```

---

## OSPF 配置命令速查

### 基础命令

| 命令 | 说明 |
|------|------|
| `ospf [process-id] router-id router-id` | 启用 OSPF 并指定 Router-ID |
| `area area-id` | 创建/进入区域视图 |
| `network network-address wildcard-mask` | 在区域内宣告网段 |
| `display ospf peer brief` | 查看 OSPF 邻居摘要 |
| `display ospf routing` | 查看 OSPF 路由表 |
| `reset ospf process` | 重启 OSPF 进程（需要确认） |
| `undo ospf [process-id]` | 删除 OSPF 进程（需要确认） |

### 接口配置命令

| 命令 | 说明 |
|------|------|
| `ospf cost cost-value` | 配置接口 Cost（范围 1-65535） |
| `ospf dr-priority priority` | 配置 DR 优先级（0-255，0 不参与选举） |
| `ospf timer hello seconds` | 修改 Hello 间隔（1-65535 秒） |
| `ospf timer dead seconds` | 修改 Dead 间隔（1-65535 秒，通常 4 倍 Hello） |
| `ospf network-type {broadcast | p2p | nbma | p2mp}` | 配置网络类型 |
| `ospf authentication-mode md5 key-id plain password` | 配置 MD5 认证 |
| `ospf authentication-mode hmac-sha256 key-id plain password` | 配置 HMAC-SHA256 认证 |
| `ospf authentication-mode keychain keychain-name` | 配置 Keychain 认证 |
| `ospf bfd enable` | 接口使能 BFD |
| `ospf mtu-enable` | 使能 MTU 检查（DBD 包携带 MTU） |
| `ospf silent-interface` | 设置静默接口 |

### 高级配置命令

| 命令 | 说明 |
|------|------|
| `stub [no-summary]` | 配置 Stub 区域 |
| `nssa [no-summary] [default-route-advertise]` | 配置 NSSA 区域 |
| `vlink-peer router-id [hello seconds] [dead seconds] [authentication-mode ...]` | 配置虚链路 |
| `abr-summary network-address mask` | ABR 路由汇总 |
| `asbr-summary network-address mask` | ASBR 外部路由汇总 |
| `import-route [static \| direct \| rip \| bgp] [cost cost] [type 1\|2]` | 引入外部路由 |
| `default-route-advertise [always] [cost cost] [type 1\|2]` | 通告默认路由 |
| `filter-policy {acl-number | ip-prefix} export` | 路由过滤（发布方向） |
| `graceful-restart enable` | 使能 GR |
| `ospf [process-id] description text` | 进程描述 |

### 显示命令汇总

| 命令 | 用途 |
|------|------|
| `display ospf brief` | 进程状态概要 |
| `display ospf peer` | 邻居详细信息 |
| `display ospf peer brief` | 邻居摘要 |
| `display ospf interface` | 接口 OSPF 信息 |
| `display ospf interface <if-name>` | 单个接口详情 |
| `display ospf routing` | OSPF 路由表 |
| `display ip routing-table protocol ospf` | IP 路由表中 OSPF 路由 |
| `display ospf lsdb` | LSDB 概要 |
| `display ospf lsdb router` | Type 1 LSA |
| `display ospf lsdb network` | Type 2 LSA |
| `display ospf lsdb summary` | Type 3 LSA |
| `display ospf lsdb asbr` | Type 4 LSA |
| `display ospf lsdb ase` | Type 5 LSA |
| `display ospf lsdb nssa` | Type 7 LSA |
| `display ospf abr-asbr` | ABR/ASBR 信息 |
| `display ospf vlink` | 虚链路状态 |
| `display ospf error` | 错误统计 |
| `display ospf cumulative` | SPF 运行统计 |
| `display ospf status` | 进程状态 |
| `display ospf graceful-restart status` | GR 状态 |
| `display ospf nexthop` | OSPF 下一跳信息 |
| `display ospf path` | OSPF 路径信息 |

---

## 排错指南

### 邻居无法建立

| 症状 | 状态 | 排查方向 | 检查命令 |
|------|------|---------|---------|
| 未收到任何 Hello | Down | 物理链路是否 UP | `display interface brief` |
| 收到 Hello 但无自己 RID | Init | network 宣告是否覆盖接口 | `display ospf interface` |
| 互相看到对方 RID | 2-Way | 正常状态（广播网络无需担心） | — |
| 主从协商失败 | ExStart | MTU 是否一致 | `display ospf interface <if>` |
| DBD 交换失败 | Exchange | MTU / 认证 / 区域 ID | `display ospf error` |
| LSA 请求失败 | Loading | LSDB 同步异常 | `display ospf lsdb` |
| 完全邻接 | Full | 正常 | — |

### 常见问题排查表

| 问题 | 检查点 | 修复 |
|------|--------|------|
| Hello 间隔不一致 | `display ospf interface` 查看间隔 | 两端保持一致 |
| 区域 ID 不一致 | `display ospf peer` | 修改区域配置 |
| 接口未激活 OSPF | `display ospf interface` | 补全 network 命令 |
| 认证不匹配 | `display ospf error` | 统一认证模式和密钥 |
| MTU 不一致 | 以太网建议保持默认 1500 | 两端统一 MTU |
| Router-ID 冲突 | `display ospf brief` 比对 | 修改冲突 RID 并重启进程 |
| 掩码/通配符错误 | 确认 network 覆盖接口 IP | 检查通配符计算 |
| 防火墙/ACL 阻挡 | 检查接口入方向 ACL | 放通 OSPF (IP 89) |
| 路由缺失 | ABR network 宣告/路由汇总 | 检查宣告范围 |
| Cost 次优 | 检查接口 Cost 值 | 调整 Cost 或参考带宽 |

### 调试命令（实验环境）

```
terminal debugging
terminal monitor
debugging ospf event           # OSPF 事件
debugging ospf packet          # OSPF 报文
debugging ospf lsa             # LSA 更新
undo debugging ospf all        # 关闭调试
```

**注意：** 生产环境严禁开启调试，会导致 CPU 过载。

### 恢复操作

```
# 重启 OSPF 进程（谨慎使用）
reset ospf process

# 重置指定邻居（不重启整个进程）
reset ospf peer <router-id>

# 清除 OSPF 计数器
reset ospf counters

# 删除 OSPF 进程
undo ospf 1
```

---

## 优化与安全建议

| 优化项 | 命令 | 说明 |
|--------|------|------|
| 调整参考带宽 | `bandwidth-reference <value>` | 确保 ≥ 最大链路带宽（单位 Mbps） |
| 静默接口 | `silent-interface LoopBack0` | 抑制未连接其他路由器的接口发 Hello |
| DR/BDR 控制 | `ospf dr-priority 255/0` | 稳定骨干选择稳定设备做 DR |
| P2P 网络类型 | `ospf network-type p2p` | P2P 链路避免 DR 选举，加速收敛 |
| 路由汇总 | `abr-summary` | 减少 LSDB 和路由表规模 |
| Stub/NSSA | `stub / nssa` | 末梢区域减少 LSA 数量 |
| BFD | `ospf bfd enable` | 毫秒级故障检测 |
| GR | `graceful-restart enable` | 主备切换不中断转发 |
| FRR | `loop-free-alternate` | 快速重路由（IP FRR / LFA） |
| 报文认证 | `authentication-mode` | 防止伪造 OSPF 报文攻击 |
| 被动防御 | `silent-interface` | 连接用户侧接口不发送 OSPF |

---

## 脚本资源

`scripts/ospf_config.py` 提供以下能力：

| 模式 | 参数 | 说明 |
|------|------|------|
| 单设备交互 | `python ospf_config.py 2000` | 逐条输入命令执行 |
| 文件命令配置 | `python ospf_config.py 2000 commands.txt` | 从文件加载命令 |
| 生成命令 | `python ospf_config.py --generate <name> <rid>` | 输出配置命令到控制台 |
| 批量配置 | `python ospf_config.py --batch` | 一键配置 6 台设备的完整实验 |
| 验证配置 | `python ospf_config.py --verify <port>` | 执行配置后验证 |

脚本特性：
- Telnet 连接 eNSP 设备（127.0.0.1:port）
- 自动处理 [Y/N] 确认提示
- 错误检测与日志记录
- 支持系统视图/退出/保存全流程
- Loopback + Router-ID 自动关联

---

## 参考文档

- **`references/ospf-reference.md`** — 完整实验拓扑、IP 规划、每台设备 CLI 配置、验证输出示例、排错指南、优化配置
- **`references/ospf-inspection.md`** — 巡检报告生成指南，包含：
  - 完整巡检命令集及关键检查项
  - 按设备角色分别采集数据流程
  - 巡检报告模板（拓扑→邻居→路由→LSDB→连通性→结论→排错）
  - 预期输出样例与故障排查

---

## OSPFv3 速记（IPv6 OSPF）

OSPFv3 与 OSPFv2 关键区别：

| 特性 | OSPFv2 | OSPFv3 |
|------|--------|--------|
| 网络层 | IPv4 | IPv6 |
| Router-ID | 需配置 | 需配置（仍为 32 位） |
| 接口宣告 | `network` 命令 | 直接接口配置 |
| 实例 | 单实例 | 支持多实例 |
| LSA 类型 | Type 1-7 | 新增 Link LSA、Intra-Area-Prefix LSA |
| 认证 | 自带 | 依赖 IPsec |
| 命令前缀 | `ospf` | `ospfv3` |
