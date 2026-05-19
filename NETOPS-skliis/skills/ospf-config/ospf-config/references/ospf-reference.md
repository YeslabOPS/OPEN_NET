# OSPF 多区域配置参考文档

## 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| v2.0 | 2026-05 | 增强 LSA 详解、OSPF 报文、网络类型、BFD/GR/FRR 等高阶特性、新增拓扑案例 |

---

## 一、实验拓扑

本实验使用 6 台华为路由器（AR2220）组建 OSPF 多区域网络，包含骨干区域（Area 0）和两个非骨干区域（Area 1、Area 2），并涉及 ABR、骨干路由器、内部路由器三种角色。

### 1.1 物理拓扑

```
                    Area 0 (骨干区域)
    ┌──────────────────────────────────────────────────────────────────┐
    │                                                                   │
    │   GE0/0/0          GE0/0/0          GE0/0/0          GE0/0/0     │
    │ 172.16.12.0/24   172.16.23.0/24   172.16.34.0/24  172.16.45.0/24│
    │  ┌─────┐   .1   .2  ┌─────┐   .2  .3 ┌─────┐   .3  .4 ┌─────┐  │
    │  │ AR1 │────────────│ AR2 │──────────│ AR3 │──────────│ AR4 │  │
    │  └─────┘            └─────┘          └─────┘          └─────┘  │
    │      │                    │                                       │
    │      │ GE0/0/1            │ GE0/0/2                               │
    │      │ 172.16.15.0/24     │ 172.16.26.0/24                        │
    │      │                    │                                       │
    │  Area 1                Area 2                                     │
    │  ┌─────┐                ┌─────┐                                   │
    │  │ AR5 │                │ AR6 │                                   │
    │  └─────┘                └─────┘                                   │
    │                                                                   │
    └───────────────────────────────────────────────────────────────────┘
```

### 1.2 简化拓扑（4 设备版本）

```
        Area 0
    AR1 ── AR2 ── AR3 ── AR4
     │             │
   Area 1       Area 2
     │             │
    AR5           AR6
```

### 1.3 设备与接口 IP 规划

| 设备 | 接口 | IP 地址 | 子网掩码 | 所属区域 | 角色 |
|------|------|---------|---------|---------|------|
| AR1 | GE0/0/0 | 172.16.12.1 | 255.255.255.0 | Area 0 | ABR |
| AR1 | GE0/0/1 | 172.16.15.1 | 255.255.255.0 | Area 1 | — |
| AR1 | LoopBack0 | 1.1.1.1 | 255.255.255.255 | —（Router-ID） | — |
| AR2 | GE0/0/0 | 172.16.12.2 | 255.255.255.0 | Area 0 | 骨干路由器 |
| AR2 | GE0/0/1 | 172.16.23.2 | 255.255.255.0 | Area 0 | — |
| AR2 | GE0/0/2 | 172.16.26.2 | 255.255.255.0 | Area 2 | — |
| AR2 | LoopBack0 | 2.2.2.2 | 255.255.255.255 | —（Router-ID） | — |
| AR3 | GE0/0/0 | 172.16.23.3 | 255.255.255.0 | Area 0 | ABR |
| AR3 | GE0/0/1 | 172.16.34.3 | 255.255.255.0 | Area 0 | — |
| AR3 | LoopBack0 | 3.3.3.3 | 255.255.255.255 | —（Router-ID） | — |
| AR4 | GE0/0/0 | 172.16.34.4 | 255.255.255.0 | Area 0 | 内部路由器 |
| AR4 | LoopBack0 | 4.4.4.4 | 255.255.255.255 | —（Router-ID） | — |
| AR5 | GE0/0/0 | 172.16.15.5 | 255.255.255.0 | Area 1 | 内部路由器 |
| AR5 | LoopBack0 | 5.5.5.5 | 255.255.255.255 | —（Router-ID） | — |
| AR6 | GE0/0/0 | 172.16.26.6 | 255.255.255.0 | Area 2 | 内部路由器 |
| AR6 | LoopBack0 | 6.6.6.6 | 255.255.255.255 | —（Router-ID） | — |

---

## 二、OSPF 核心概念详解

### 2.1 OSPF 区域类型

| 区域类型 | 接收 LSA 类型 | 特点 | 适用场景 |
|---------|-------------|------|---------|
| 骨干区域 (Area 0) | Type 1-5 | 所有非骨干区域必须直连或通过虚链路连接 | 路由交换核心 |
| 标准区域 | Type 1-5 | 接收区域内、区域间和外部路由 | 通用区域 |
| Stub 区域 | Type 1/2/3 | 无 Type 4/5，ABR 注入默认路由 | 末梢网络，无外部路由 |
| Totally Stub | Type 1/2 + 默认 | 无 Type 3/4/5，仅一条默认路由 | 极简末梢网络 |
| NSSA | Type 1/2/3/7 | 允许引入少量外部（Type 7 → Type 5） | 需引入外部路由的末梢网络 |
| Totally NSSA | Type 1/2 + Type 7 + 默认 | 无 Type 3，NSSA 的完全区域 | 需引入外部路由的极简末梢 |

### 2.2 路由器类型

| 路由器类型 | 定义 | 本拓扑示例 |
|-----------|------|-----------|
| 内部路由器 (IR) | 所有接口属于同一区域 | AR4（全 Area 0）、AR5（全 Area 1）、AR6（全 Area 2） |
| 区域边界路由器 (ABR) | 接口属于多个区域，至少一个在 Area 0 | AR1（Area 0+1）、AR2（Area 0+2） |
| 骨干路由器 (BR) | 至少一个接口在 Area 0 | AR2（仅 Area 0 接口）、AR3（仅 Area 0 接口） |
| 自治系统边界路由器 (ASBR) | 引入外部路由到 OSPF | 任何配置了 `import-route` 的设备 |

**注意：** 一台设备可以同时是 ABR + ASBR 或 骨干路由器 + ASBR。

### 2.3 LSA 类型详解

#### Type 1 — Router LSA

- **产生者：** 每台路由器为每个所属区域产生
- **传播范围：** 仅限本区域
- **内容：** 路由器的所有 OSPF 接口信息（IP、Cost、链路类型）
- **关键字段：** V（虚链路端点）、E（ASBR）、B（ABR）标志位
- **华为查看命令：** `display ospf lsdb router`

#### Type 2 — Network LSA

- **产生者：** 广播网络上的 DR
- **传播范围：** 仅限本区域
- **内容：** 该网段上所有连接的路由器列表（含 DR 本身）
- **华为查看命令：** `display ospf lsdb network`

#### Type 3 — Summary LSA

- **产生者：** ABR
- **传播范围：** 整个 OSPF 域（不同区域间传递）
- **内容：** 一个网段的路由信息（前缀 + 掩码 + Cost）
- **华为查看命令：** `display ospf lsdb summary`
- **过滤：** 在 ABR 上可通过 `filter-policy` 或 `abr-summary` 影响

#### Type 4 — ASBR Summary LSA

- **产生者：** ASBR 所在区域的 ABR
- **传播范围：** 整个 OSPF 域（Stub/NSSA 除外）
- **内容：** 通告 ASBR 的位置（ASBR 的 Router-ID + Cost）
- **华为查看命令：** `display ospf lsdb asbr`

#### Type 5 — AS External LSA

- **产生者：** ASBR
- **传播范围：** 整个 OSPF 域（Stub/NSSA 除外）
- **内容：** 引入的外部路由（前缀 + 掩码 + Cost + E1/E2 类型）
- **华为查看命令：** `display ospf lsdb ase`

#### Type 7 — NSSA External LSA

- **产生者：** NSSA 区域内的 ASBR
- **传播范围：** NSSA 区域内
- **转换：** ABR 将 Type 7 转换为 Type 5 注入骨干区域
- **华为查看命令：** `display ospf lsdb nssa`

### 2.4 OSPF 报文类型

| 类型号 | 报文名称 | 用途 | 重要字段 |
|--------|---------|------|---------|
| 1 | Hello | 发现/维护邻居、DR/BDR 选举 | Router-ID、邻居列表、Hello/Dead 间隔、Area ID |
| 2 | DBD | LSDB 摘要交换、主从协商 | 接口 MTU（可选）、LSA 头部列表、I/M/MS 位 |
| 3 | LSR | 请求缺失的完整 LSA | LSA 类型、ID、产生者 Router-ID |
| 4 | LSU | 响应 LSR/Flood LSA 更新 | 一个或多个完整 LSA |
| 5 | LSACK | 可靠 Flooding 机制确认 | LSA 头部列表 |

### 2.5 OSPF 邻居状态机

```
                      ┌─────────┐
                      │  Down   │
                      └────┬────┘
                           │ 接口 UP / 启用 OSPF
                      ┌────▼────┐
                      │  Init   │ ← 收到 Hello 报文
                      └────┬────┘
                           │ Hello 中包含自己的 Router-ID
                      ┌────▼────┐
                      │ 2-Way   │ ← DR/BDR 选举发生在此状态后
                      └────┬────┘
                           │ 决定建立邻接（非 DR-Other 间）
                      ┌────▼─────┐
                      │  ExStart  │ ← 主从协商，确定初始 DBD 序号
                      └────┬─────┘
                           │ 主从确定
                      ┌────▼──────┐
                      │ Exchange  │ ← 交换 DBD 包
                      └────┬──────┘
                           │ DBD 交换完成
                      ┌────▼──────┐
                      │  Loading  │ ← 发送 LSR 请求缺失 LSA
                      └────┬──────┘
                           │ LSDB 完全同步
                      ┌────▼────┐
                      │  Full   │
                      └─────────┘
```

### 2.6 SPF 计算原理

1. **触发条件：** LSDB 发生变化（新增/更新/删除 LSA）
2. **计算过程：** 每台路由器以自己为根，基于 Dijkstra 算法计算最短路径树
3. **结果产出：** 生成 OSPF 路由表条目
4. **优化手段：**
   - **Incremental SPF (I-SPF)：** 只重新计算受影响部分（华为默认使能）
   - **Partial SPF (PRC)：** 只计算路由变化，不重新运行 SPF
5. **查看统计：** `display ospf cumulative`

### 2.7 网络类型与 DR/BDR 选举

| 网络类型 | 默认 Hello/Dead | DR 选举 | 特点 |
|---------|----------------|---------|------|
| Broadcast | 10s / 40s | 是 | 默认以太网类型，需要 DR |
| NBMA | 30s / 120s | 是 | 非广播多路访问，需配置邻居 |
| P2MP | 30s / 120s | 否 | 通过单播建立，无需 DR |
| P2P | 10s / 40s | 否 | 点到点链路，快速建立 |

**DR/BDR 选举规则：**
1. 优先级最高者成为 DR，次高者成为 BDR
2. 优先级相同则 Router-ID 大者优先
3. DR/BDR 选举是非抢占的（但网络中断后重新选举）
4. 优先级 0 表示不参与选举
5. **关键：** 只有 DR 和 BDR 之间、DR 和所有 Router 之间建立 Full 邻接；DR-Other 之间只到 2-Way

---

## 三、OSPF 多区域配置命令

### 3.1 启用 OSPF 并配置 Router-ID

```
system-view
ospf [process-id] router-id router-id
```

- `process-id`：OSPF 进程号，范围 1-65535，默认 1
- `router-id`：路由器标识符，推荐使用 Loopback 接口地址
- **Router-ID 优先级：** 手动配置 > Loopback 最大 IP > 物理接口最大 IP

### 3.2 创建区域并宣告网段

```
ospf [process-id]
 area area-id
  network network-address wildcard-mask
```

- `area-id`：0 表示骨干区域，非 0 为普通区域（可使用整数或点分十进制）
- `network-address`：网段地址
- `wildcard-mask`：通配符掩码 = 子网掩码按位取反

**通配符掩码快速参考：**

| 子网掩码 | 通配符掩码 |
|---------|-----------|
| 255.255.255.0 | 0.0.0.255 |
| 255.255.255.252 | 0.0.0.3 |
| 255.255.255.248 | 0.0.0.7 |
| 255.255.0.0 | 0.0.255.0 |
| 255.255.255.255 | 0.0.0.0（精确匹配） |
| 0.0.0.0 | 255.255.255.255（匹配所有） |

### 3.3 配置接口开销 (Cost)

```
interface GigabitEthernet x/x/x
 ospf cost cost-value
```

- Cost 默认 = 参考带宽(100Mbps) / 接口带宽(Mbps)
- GE 接口默认 Cost = 100/1000 = 1
- 10GE 接口默认 Cost = 100/10000 = 1（实际上限为 1）
- 可全局修改参考带宽：`bandwidth-reference <value>`（需在 ospf 进程视图外配置）

**Cost 参考值：**

| 接口类型 | 带宽 | 默认参考 100M | 推荐参考 10000M |
|---------|------|-------------|--------------|
| 10M 以太网 | 10Mbps | 10 | 1000 |
| 100M 快速以太网 | 100Mbps | 1 | 100 |
| 1000M 千兆以太网 | 1000Mbps | 1 | 10 |
| 10G 万兆 | 10000Mbps | 1 | 1 |
| POS/CPOS | 155M | 1 | 65 |

**建议：** 若网络中混有 GE 和 10GE 链路，建议调整参考带宽使 Cost 有区分度。

### 3.4 配置 OSPF 认证

**接口认证（明文）：**
```
interface GigabitEthernet x/x/x
 ospf authentication-mode simple plain password
```

**接口认证（MD5）：**
```
interface GigabitEthernet x/x/x
 ospf authentication-mode md5 key-id plain password
```

**接口认证（HMAC-SHA256，V8+）：**
```
interface GigabitEthernet x/x/x
 ospf authentication-mode hmac-sha256 key-id plain password
```

**接口认证（Keychain，推荐生产环境）：**
```
keychain ospf-auth key-id 1
 algorithm hmac-sha256
 key-string plain Huawei@123
 quit
#
interface GigabitEthernet x/x/x
 ospf authentication-mode keychain ospf-auth
```

**区域认证（统一认证整个区域）：**
```
ospf [process-id]
 area area-id
  authentication-mode [simple | md5]
```

**认证配置检查命令：** `display ospf interface <if-name>`，查看 Authentication 字段。

### 3.5 配置 Stub 区域

```
ospf [process-id]
 area area-id
  stub [no-summary]
```

- `stub`：标准 Stub，阻止 Type 4/5 LSA
- `stub no-summary`：Totally Stub，阻止 Type 3/4/5 LSA
- **必须：** 同一区域内所有路由器都配置 `stub`
- **禁止：** Stub 区域内不能配置 `import-route`、不能有 ASBR、不能配虚链路

### 3.6 配置 NSSA 区域

```
ospf [process-id]
 area area-id
  nssa [no-summary] [default-route-advertise]
```

- `nssa`：标准 NSSA，允许 Type 7 LSA
- `nssa no-summary`：Totally NSSA，阻止 Type 3 LSA
- `nssa default-route-advertise`：ABR 生成默认路由注入 NSSA

### 3.7 配置虚链路 (Virtual Link)

当非骨干区域没有与骨干区域物理直连时，需要通过虚链路连接。

**使用条件：**
1. 传输区域不能是 Area 0
2. 传输区域不能是 Stub/Totally Stub
3. 两端 ABR 的 Router-ID 必须正确指定

```
# ABR1 上
ospf [process-id]
 area transit-area-id
  vlink-peer abr2-router-id

# ABR2 上
ospf [process-id]
 area transit-area-id
  vlink-peer abr1-router-id
```

**验证：**
```
display ospf vlink
```

预期输出应显示 `State: Full`。

### 3.8 引入外部路由

```
ospf [process-id]
 import-route [rip | static | direct | bgp] [cost cost] [type 1|2] [tag tag]
```

**外部路由类型选择：**

| 类型 | Cost 计算 | 适用场景 |
|------|----------|---------|
| Type 1 (E1) | 外部 Cost + 内部累加 Cost | 多出口等价/不等价负载 |
| Type 2 (E2) | 仅外部 Cost（默认） | 单出口简单接入 |

**默认路由通告：**
```
ospf [process-id]
 default-route-advertise [always] [cost cost] [type 1|2]
```

- 不加 `always` 时，仅当设备已有默认路由时才通告
- 加 `always` 时，无条件通告默认路由

---

## 四、完整配置示例

### AR1（ABR — 同时属于 Area 0 和 Area 1）

```bash
system-view
sysname AR1

# 配置接口 IP
interface GigabitEthernet0/0/0
 ip address 172.16.12.1 255.255.255.0
 undo shutdown
 quit

interface GigabitEthernet0/0/1
 ip address 172.16.15.1 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 1.1.1.1 255.255.255.255
 quit

# 启用 OSPF
ospf 1 router-id 1.1.1.1
 area 0.0.0.0
  network 172.16.12.0 0.0.0.255
 area 0.0.0.1
  network 172.16.15.0 0.0.0.255
 quit
```

### AR2（骨干路由器 — 仅属于 Area 0）

```bash
system-view
sysname AR2

interface GigabitEthernet0/0/0
 ip address 172.16.12.2 255.255.255.0
 undo shutdown
 quit

interface GigabitEthernet0/0/1
 ip address 172.16.23.2 255.255.255.0
 undo shutdown
 quit

interface GigabitEthernet0/0/2
 ip address 172.16.26.2 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 2.2.2.2 255.255.255.255
 quit

ospf 1 router-id 2.2.2.2
 area 0.0.0.0
  network 172.16.12.0 0.0.0.255
  network 172.16.23.0 0.0.0.255
  network 172.16.26.0 0.0.0.255
 quit
```

### AR3（骨干路由器 — 仅属于 Area 0）

```bash
system-view
sysname AR3

interface GigabitEthernet0/0/0
 ip address 172.16.23.3 255.255.255.0
 undo shutdown
 quit

interface GigabitEthernet0/0/1
 ip address 172.16.34.3 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 3.3.3.3 255.255.255.255
 quit

ospf 1 router-id 3.3.3.3
 area 0.0.0.0
  network 172.16.23.0 0.0.0.255
  network 172.16.34.0 0.0.0.255
 quit
```

### AR4（内部路由器 — Area 0）

```bash
system-view
sysname AR4

interface GigabitEthernet0/0/0
 ip address 172.16.34.4 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 4.4.4.4 255.255.255.255
 quit

ospf 1 router-id 4.4.4.4
 area 0.0.0.0
  network 172.16.34.0 0.0.0.255
  network 4.4.4.4 0.0.0.0
 quit
```

### AR5（内部路由器 — Area 1）

```bash
system-view
sysname AR5

interface GigabitEthernet0/0/0
 ip address 172.16.15.5 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 5.5.5.5 255.255.255.255
 quit

ospf 1 router-id 5.5.5.5
 area 0.0.0.1
  network 172.16.15.0 0.0.0.255
  network 5.5.5.5 0.0.0.0
 quit
```

### AR6（内部路由器 — Area 2）

```bash
system-view
sysname AR6

interface GigabitEthernet0/0/0
 ip address 172.16.26.6 255.255.255.0
 undo shutdown
 quit

interface LoopBack0
 ip address 6.6.6.6 255.255.255.255
 quit

ospf 1 router-id 6.6.6.6
 area 0.0.0.2
  network 172.16.26.0 0.0.0.255
  network 6.6.6.6 0.0.0.0
 quit
```

---

## 五、OSPF 配置验证命令

### 5.1 查看 OSPF 邻居

```bash
display ospf peer brief
```

**预期输出（AR1 上）：**
```
         OSPF Process 1 with Router-ID 1.1.1.1
                  Peer Statistic Information
-------------------------------------------------------------------
 Area Id          Interface                        Neighbor id      State
 0.0.0.0         GigabitEthernet0/0/0              2.2.2.2          Full
 0.0.0.1         GigabitEthernet0/0/1              5.5.5.5          Full
-------------------------------------------------------------------
```

**邻居详细查看：**
```bash
display ospf peer
```

可看到邻居详细信息，包括：DR/BDR 地址、DBD 序号、邻居 UpTime、Dead 计时等。

### 5.2 查看 OSPF 接口

```bash
display ospf interface
display ospf interface GigabitEthernet 0/0/0
```

**关键输出字段说明：**
- **State**：接口状态（DR / BDR / DROther / P-2-P）
- **DR / BDR**：当前网络的 DR 和 BDR 地址
- **Hello / Dead**：当前间隔时间
- **Cost**：接口 Cost 值
- **Transmit Delay**：LSA 传输延迟（默认 1s）
- **Type**：网络类型（Broadcast / P2P 等）

### 5.3 查看 OSPF 路由表

```bash
display ospf routing
```

**预期输出（AR5 上 — Area 1 内部路由器）：**
```
         OSPF Process 1 with Router-ID 5.5.5.5
                  Routing Table
-------------------------------------------------------------------
 Routing for network
 Destination        Cost  Type       NextHop         AdvRouter
 172.16.15.0/24     1     Stub       5.5.5.5         5.5.5.5
 172.16.12.0/24     2     Inter-area 172.16.15.1     1.1.1.1
 172.16.23.0/24     3     Inter-area 172.16.15.1     1.1.1.1
 172.16.26.0/24     4     Inter-area 172.16.15.1     1.1.1.1
 172.16.34.0/24     4     Inter-area 172.16.15.1     1.1.1.1
 1.1.1.1/32         1     Stub       172.16.15.1     1.1.1.1
 2.2.2.2/32         2     Inter-area 172.16.15.1     1.1.1.1
 3.3.3.3/32         3     Inter-area 172.16.15.1     1.1.1.1
 4.4.4.4/32         4     Inter-area 172.16.15.1     1.1.1.1
 6.6.6.6/32         5     Inter-area 172.16.15.1     1.1.1.1
-------------------------------------------------------------------
```

**路由类型标记：**
- `Stub` / `Transit`：区域内路由（O）
- `Inter-area`：区域间路由（O IA）
- `Type1` / `Type2`：外部路由（O E1 / O E2）

### 5.4 查看 IP 路由表（OSPF 路由）

```bash
display ip routing-table protocol ospf
```

**预期输出：**
```
Route Flags: R - relay, D - download to fib
------------------------------------------------------------------------------
Public routing table : OSPF
         Destinations : 6        Routes : 6

OSPF routing table status : <Active>
         Destinations : 6        Routes : 6

Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface
    172.16.12.0/24  OSPF    10   2           D   172.16.15.1     GE0/0/0
    172.16.23.0/24  OSPF    10   3           D   172.16.15.1     GE0/0/0
    ...
```

**路由优先级：**

| 路由来源 | 华为默认优先级 |
|---------|-------------|
| OSPF (区域内/区域间) | 10 |
| OSPF (外部 E1) | 150 |
| OSPF (外部 E2) | 150 |
| 静态 | 60 |
| RIP | 100 |
| BGP | 255 |

### 5.5 查看 OSPF LSDB

```bash
# 完整 LSDB
display ospf lsdb

# 按类型查看
display ospf lsdb router
display ospf lsdb network
display ospf lsdb summary
display ospf lsdb asbr
display ospf lsdb ase
display ospf lsdb nssa

# 自生 LSA
display ospf lsdb router self-originate
```

**预期输出（AR1 LSDB）：**
```
         OSPF Process 1 with Router-ID 1.1.1.1
                  Link State Database
-------------------------------------------------------------------
         Area: 0.0.0.0
 Type      LinkState ID    AdvRouter          Age  Len   Sequence   Metric
 Router    1.1.1.1         1.1.1.1           1235  48    8000000A       1
 Router    2.2.2.2         2.2.2.2           1230  60    8000000D       1
 Network   172.16.12.2     2.2.2.2           1230  32    80000003       0
 Sum-Net   172.16.15.0     1.1.1.1           1235  28    80000001       1
 Sum-Net   172.16.26.0     2.2.2.2           1231  28    80000001       1
 Sum-ASBR  2.2.2.2         2.2.2.2           1231  28    80000001       1
```

**Age 判定规则：**
- 0-300：刚刚刷新
- 300-1800：正常
- 1800-3600：即将超时刷新
- 3600 (MaxAge)：将被删除

### 5.6 查看 ABR/ASBR 信息

```bash
display ospf abr-asbr
```

**预期输出（ABR 上）：**
```
         OSPF Process 1 with Router-ID 1.1.1.1
                  Routing Table to ABR and ASBR
-------------------------------------------------------------------
 Type          Destination       Area          Cost  NextHop         RtType
 ABR           2.2.2.2           0.0.0.0       2     172.16.12.2     Area
 ASBR          --
```

**Self 识别：** 如果自身是 ABR，输出中显示 `Routing Table to ABR and ASBR`，但不包含自身。

也可以通过 `display ospf brief` 查看：
```
         OSPF Process 1 with Router-ID 1.1.1.1
                  OSPF Protocol Status
-------------------------------------------------------------------
...
 Area Count: 2             Router ID: 1.1.1.1
 SPF Count: 15
 ABR: True                  ASBR: False
...
```

### 5.7 查看错误统计

```bash
display ospf error
```

**关键检查项：**
- **Hello Errors**：Hello 报文错误（间隔、掩码不一致）
- **Auth Errors**：认证失败次数
- **MTU Mismatch Errors**：MTU 不匹配
- **Bad LSDB**：LSDB 异常
- **LSA Errors**：LSA 校验失败

### 5.8 OSPF 性能统计

```bash
display ospf cumulative
```

**关键指标：**
- SPF 运行次数
- 平均 SPF 执行时间
- LSA 产生数量
- 路由计算次数

```bash
display ospf status
```

显示进程状态，包括：Router-ID、外部路由计数、区域计数、SPF 定时器等。

### 5.9 调试 OSPF（实验环境使用）

```bash
terminal debugging
terminal monitor
debugging ospf event
debugging ospf packet hello        # 仅 Hello 包
debugging ospf packet dd           # 仅 DBD 包
debugging ospf lsa
# 关闭所有调试
undo debugging ospf all
```

**注意：** 生产环境严禁开启调试，会导致 CPU 过载。

---

## 六、高阶特性配置

### 6.1 OSPF BFD（快速故障检测）

BFD 提供毫秒级故障检测，将 OSPF 收敛时间从秒级降低到毫秒级。

```
# 全局使能 BFD
bfd
 quit

# 接口使能 OSPF BFD
interface GigabitEthernet0/0/0
 ospf bfd enable
 ospf bfd min-tx-interval 100      # 发送间隔 100ms
 ospf bfd min-rx-interval 100      # 接收间隔 100ms
 ospf bfd detect-multiplier 3       # 检测倍数（3x100ms=300ms 检测到故障）
```

**验证 BFD：**
```bash
display bfd session all
display bfd session verbose
```

### 6.2 OSPF GR (Graceful Restart)

主备倒换或进程重启时保持转发不中断。

**IETF GR 模式：**
```
ospf 1
 graceful-restart enable
 graceful-restart period 120        # GR 周期（秒），默认 120
```

**验证 GR：**
```bash
display ospf graceful-restart status
```

### 6.3 OSPF FRR (Fast ReRoute)

提供链路故障后的快速切换（50ms 以内）。

```
# 全局使能 FRR
ospf 1
 frr
  loop-free-alternate               # 使能 LFA 计算备用路径
```

**验证 FRR：**
```bash
display ospf frr
display ospf routing           # 查看备份下一跳
```

### 6.4 OSPF IP FRR / LFA

```
ospf 1
 loop-free-alternate
```

适用于环形或网状拓扑，自动计算无环备用路径。

### 6.5 路由过滤

**基于 LSDB 的过滤（影响 OSPF 路由表但不影响 LSDB）：**
```
ospf 1
 filter-policy {acl-number | ip-prefix} export [area-id | interface]
```

**基于接口的 LSA 过滤（影响 LSDB）：**
```
interface GigabitEthernet0/0/0
 ospf filter-lsa-out {all | summary | ase | nssa}
```

### 6.6 OSPF 路由标记 (Tag)

在引入或过滤外部路由时使用 Tag 进行标识：

```
ospf 1
 import-route static tag 100
 default-route-advertise always tag 200
```

---

## 七、常见配置问题与排错

### 7.1 邻居无法建立

#### 问题分析流程图

```
邻居非 Full
  │
  ├─ Down ─────────→ 物理链路状态？→ `display interface brief`
  │                       ↓ 正常
  │                    → 接口是否参与 OSPF？→ `display ospf interface`
  │                       ↓ 参与
  │                    → 对端设备是否运行 OSPF？
  │                       ↓ 运行
  │                    → ACL/防火墙阻挡？→ `display acl all`
  │
  ├─ Init ──────────→ network 宣告是否包含接口网段？
  │                       ↓
  │                    → Hello/Dead 间隔一致？→ `display ospf interface`
  │                       ↓
  │                    → 区域 ID 一致？
  │                       ↓
  │                    → 认证配置匹配？
  │
  ├─ 2-Way ─────────→ 广播网络正常（DR-Other 间只到 2-Way）
  │
  ├─ ExStart ───────→ MTU 不一致（DBD 包 MTU 值）
  │                       ↓
  │                    → 接口 MTU > 1500 且差值悬殊？
  │                       ↓ 修复
  │                    → `ospf mtu-enable` 使能 MTU 检查
  │
  ├─ Exchange ──────→ 区域 ID 不一致
  │                       ↓
  │                    → 认证不匹配
  │                       ↓
  │                    → DBD 包损坏（链路质量问题）
  │
  └─ Loading ───────→ LSA 请求超时
                          ↓
                       → 对端 LSDB 损坏
                          ↓
                       → `reset ospf process` 重启进程
```

#### 检查表

| 问题 | 检查点 | 命令 | 修复 |
|------|--------|------|------|
| Hello 间隔不一致 | 两端 Hello/Dead | `display ospf interface` | 统一间隔 |
| 区域 ID 不一致 | 两端 area 配置 | `display ospf brief` | 修改区域 |
| 接口未激活 OSPF | network 命令覆盖 | `display ospf interface` | 补全 network |
| 认证不匹配 | 认证模式和密钥 | `display ospf error`（Auth Errors） | 统一配置 |
| MTU 不一致 | 接口 MTU | `display ospf interface <if>` | 统一 MTU |
| 网络类型不一致 | 两端网络类型 | `display ospf interface <if>` | 统一网络类型 |
| 子网掩码不一致 | 接口掩码 | `display ip interface brief` | 统一掩码（广播网络要求一致） |
| 静默接口误配 | 接口是否 silent | `display ospf interface`（Silent: True） | 取消 silent |
| Router-ID 冲突 | 同域内唯一性 | `display ospf brief` | 修改冲突 RID |
| ACL/Debug 过滤 | OSPF (IP 89) 被丢弃 | `display acl all` | 放通 OSPF |
| 优先级 0 | DR/BDR 选举影响 | `display ospf interface` | 调整优先级 |

### 7.2 路由不可达

| 症状 | 排查方向 | 命令 |
|------|---------|------|
| 缺少某网段路由 | 检查该网段所在设备 network 是否宣告 | `display ospf brief` |
| 区域间路由缺失 | ABR 是否正确 | `display ospf abr-asbr` |
| 骨干不连续 | 非骨干区域是否直连 Area 0 | 拓扑检查 |
| Cost 过大致路径次优 | 接口 Cost 配置 | `display ospf interface` |
| 路由环路 | ABR 路由汇总掩码（汇总掩码不能比实际掩码小太多） | `display ospf lsdb summary` |
| 默认路由不生效 | default-route-advertise 配置 | 确认配置 |
| Stub 区域收到外部路由 | 区域内设备是否全部配置 stub | `display ospf brief` |
| 虚链路不通 | 传输区域可达性 | `display ospf vlink`, `ping` |

### 7.3 Router-ID 冲突

- Router-ID 必须在 OSPF 域内唯一
- 推荐使用 Loopback 接口地址作为 Router-ID
- 修改 Router-ID 后必须重启 OSPF 进程：

```
# 修改 Router-ID
ospf 1 router-id 7.7.7.7
 quit
# 必须重启进程
reset ospf 1 process
y
```

### 7.4 虚链路排错

```
display ospf vlink
```

**检查要点：**
1. 对端 Router-ID 是否正确
2. 传输区域路由是否可达（`ping` 对端 Router-ID）
3. 传输区域不能是 Area 0、Stub、NSSA
4. 两端都必须配置 vlink-peer
5. 虚链路在 OSPF 接口上看不到，但在 `display ospf vlink` 可见

### 7.5 LSDB 不一致

**现象：** 同一区域设备 `display ospf lsdb` 内容不同

**排查步骤：**
1. 检查 Age：是否有 LSA Age 达到 MaxAge
2. 检查 AdvRouter：是否有未知设备生成 LSA
3. 检查 Sequence Number：是否有序号跳跃
4. 检查 `display ospf error`：是否有 LSA 校验错误
5. 解决方案：`reset ospf process` 重启 OSPF 进程

### 7.6 OSPF 震荡排查

**现象：** 邻居频繁 UP/Down，路由表频繁变化

**排查方向：**
1. **物理链路不稳定：** `display interface brief` 检查 flapping
2. **Hello/Dead 时间不匹配：** `display ospf interface`
3. **DR 震荡：** 检查 DR 优先级配置
4. **SPF 频繁触发：** `display ospf cumulative` 查看 SPF 计数
5. **外部路由引入震荡：** 检查 `import-route` 的源路由表稳定性
6. **LSA 频繁更新：** `display ospf lsdb` 关注 Age 重置频繁的 LSA
7. **STP/RSTP 导致：** 交换机上确认端口状态，配置边缘端口

---

## 八、OSPF 优化与安全

### 8.1 调整参考带宽

```
bandwidth-reference 10000         # 将参考带宽改为 10000Mbps
```

在包含千兆/万兆混合链路的网络中，确保 Cost 有足够区分度。

### 8.2 调整 Hello/Dead 间隔

```
interface GigabitEthernet x/x/x
 ospf timer hello 10             # 1-65535 秒
 ospf timer dead 40              # 1-65535 秒，通常为 Hello 的 4 倍
```

- 广播网络默认：Hello 10s / Dead 40s
- NBMA 网络默认：Hello 30s / Dead 120s
- P2P 网络默认：Hello 10s / Dead 40s
- **提速收敛：** 可将 Hello 降为 3-5s、Dead 设为 12-20s（注意 CPU 负载）

### 8.3 DR/BDR 选举控制

```
interface GigabitEthernet x/x/x
 ospf dr-priority 255            # 高性能设备设置为 255，确保成为 DR
 ospf dr-priority 0              # 不希望成为 DR 的设备设为 0
```

- DR 选举是非抢占的
- 范围 0-255，0 表示不参与选举
- 优先级越高越优先成为 DR
- 若要强制重新选举，需重启接口或重启 OSPF 进程

### 8.4 静默接口 (Silent Interface)

```
ospf [process-id]
 silent-interface { all | interface-type interface-number }
```

- 抑制该接口上的 OSPF 报文发送（不发送 Hello）
- 用于连接终端设备的接口（Loopback、接 PC 的接口等）
- **Loopback 接口建议配置为 silent**，减少不必要的 LSA 更新

### 8.5 路由汇总

**ABR 汇总（区域间路由）：**
```
ospf [process-id]
 area area-id
  abr-summary network-address mask [advertise | not-advertise]
```

**ASBR 汇总（外部路由）：**
```
ospf [process-id]
 asbr-summary network-address mask [tag tag]
```

**汇总实践建议：**
- 汇总是单向的（对进入骨干方向起效）
- 汇总后可以减少 LSDB 和路由表规模
- 汇总掩码必须包含被汇总的子网
- 使用 `not-advertise` 抑制不想通告的路由

### 8.6 默认路由通告

```
ospf [process-id]
 default-route-advertise [always] [cost cost] [type 1|2] [tag tag]
```

- 在 ASBR 上使用
- `always`：无条件通告（即使没有默认路由）
- 不加 `always`：仅在已有默认路由时通告

### 8.7 网络安全加固

| 安全措施 | 命令/方法 | 说明 |
|---------|----------|------|
| 报文认证 | `authentication-mode md5/hmac-sha256` | 防止伪造 OSPF 报文攻击 |
| 静默接口 | `silent-interface` | 连接用户侧接口不发送 OSPF |
| TTL 安全检查 | `ospf ttl-check` | 检查 OSPF 报文的 TTL ≥ 255 |
| Keychain 滚动密钥 | `keychain` | 密钥定期更换，生产环境推荐 |
| BGP + OSPF 互引控制 | `route-policy` | 精确控制路由引入和发布 |
| 被动防御 | ACL 限制 OSPF 报文来源 | 仅允许已知邻居的 OSPF 报文 |

**OSPF TTL 安全检查（V8+）：**
```
ospf [process-id]
 ttl-check
```

---

## 九、性能监控与维护

### 9.1 日常监控命令

| 目的 | 命令 | 建议频率 |
|------|------|---------|
| 邻居状态 | `display ospf peer brief` | 每天 |
| 路由变化 | `display ospf routing` | 变更后 |
| 错误检查 | `display ospf error` | 每周 |
| SPF 统计 | `display ospf cumulative` | 每周 |
| LSDB 年龄 | `display ospf lsdb` | 每周 |
| 进程状态 | `display ospf status` | 每周 |
| 接口状态 | `display ospf interface` | 变更后 |

### 9.2 故障恢复操作

```
# 重启 OSPF 进程（谨慎！会中断路由）
reset ospf 1 process

# 重置指定邻居（不影响其他邻居）
reset ospf peer <router-id>

# 清除错误计数器
reset ospf counters

# 清除 OSPF 进程
undo ospf 1
```

### 9.3 配置备份

```
# 导出配置到 FTP/TFTP
tftp 192.168.1.100 put vrpcfg.zip
```

---

## 十、完整实验步骤总结

### Step 1: 搭建拓扑
在 eNSP 中拖入 6 台 AR2220 路由器，按拓扑图连线。

### Step 2: 配置接口 IP
为所有设备接口配置 IP 地址，确认接口物理状态为 UP。
`display interface brief` 检查接口状态。

### Step 3: 配置 OSPF 多区域
按区域规划配置 OSPF，ABR 需配置多个 area。

### Step 4: 验证 OSPF 邻居
`display ospf peer brief` → 确认所有邻居状态为 Full。

### Step 5: 查看路由表
`display ip routing-table protocol ospf` → 确认学到所有网段路由。

### Step 6: 检查 LSDB 同步
`display ospf lsdb` → 确认同一区域内 LSDB 一致。

### Step 7: 测试连通性
`ping -a source-ip destination-ip` → 跨区域互 Ping 测试。

### Step 8: 进阶验证（按需）
- ABR 验证：`display ospf abr-asbr`
- 虚链路验证：`display ospf vlink`
- 错误检查：`display ospf error`
- SPF 统计：`display ospf cumulative`

---

## 附录 A：OSPFv3 与 OSPFv2 对比

| 特性 | OSPFv2 | OSPFv3 |
|------|--------|--------|
| 网络层 | IPv4 | IPv6 |
| Router-ID | 需手动配置 | 需手动配置（仍为 32 位） |
| 接口宣告 | `network` 命令 | 在接口视图下直接使能 |
| 实例 | 单实例 | 多实例（实例 ID 0-255） |
| 认证 | 自身认证机制 | 依赖 IPsec |
| LSA 类型 | Type 1-5 | Type 1-5 + Link LSA + Intra-Area-Prefix LSA |
| 命令前缀 | `ospf` | `ospfv3` |

**OSPFv3 配置示例：**
```
ospfv3 1
 router-id 1.1.1.1
 area 0.0.0.0
#
interface GigabitEthernet0/0/0
 ospfv3 1 area 0.0.0.0
 ipv6 enable
 ipv6 address 2001:db8:12::1/64
```

## 附录 B：命令索引

| 命令 | 章节 | 用途 |
|------|------|------|
| `ospf [process-id] router-id` | 3.1 | 启用 OSPF |
| `network ... wildcard` | 3.2 | 宣告网段 |
| `ospf cost` | 3.3 | 设置接口 Cost |
| `authentication-mode` | 3.4 | 配置认证 |
| `stub [no-summary]` | 3.5 | 配置 Stub 区域 |
| `nssa [...]` | 3.6 | 配置 NSSA 区域 |
| `vlink-peer` | 3.7 | 配置虚链路 |
| `import-route` | 3.8 | 引入外部路由 |
| `default-route-advertise` | 3.8 | 通告默认路由 |
| `ospf bfd enable` | 6.1 | BFD 联动 |
| `graceful-restart enable` | 6.2 | 使能 GR |
| `loop-free-alternate` | 6.3 | 使能 FRR |
| `filter-policy` | 6.5 | 路由过滤 |
| `abr-summary` | 8.5 | 区域间路由汇总 |
| `asbr-summary` | 8.5 | 外部路由汇总 |
| `silent-interface` | 8.4 | 静默接口 |
| `bandwidth-reference` | 8.1 | 参考带宽 |
