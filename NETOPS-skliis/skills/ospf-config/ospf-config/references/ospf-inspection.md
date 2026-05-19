# OSPF 多区域巡检报告生成指南

## 概述

本指南用于在 OSPF 多区域配置完成后，生成详细的巡检报告。报告内容包括拓扑验证、OSPF 邻居深度检查、路由表分析、LSDB 同步检查、ABR/ASBR 验证、安全认证检查、性能与稳定性评估、连通性测试和配置保存确认。

**巡检原则：**
- **逐层深入**：从概要到细节，从邻居到 LSDB
- **按角色采集**：ABR 采集完整信息，IR 采集核心信息
- **比对验证**：跨设备比对 LSDB 和路由表一致性
- **数据驱动**：用实际采集的数据说话，避免猜测

---

## 一、巡检命令集

### 1.1 系统基本信息

```bash
# 设备版本
display version

# 当前 OSPF 配置（模拟器不支持管道过滤，改用 display ospf brief）
display ospf brief

# 进程概要
display ospf brief
```

### 1.2 OSPF 邻居检查（核心）

```bash
# 邻居摘要（必查）
display ospf peer brief

# 邻居详细信息（邻居异常时查）
display ospf peer
```

**关键检查项：**
- 邻居状态是否全部为 `Full`
- 邻居数量是否符合拓扑预期
- 邻居的 Router-ID 是否正确
- 每个邻居所属的 Area ID 是否正确
- UpTime 是否正常（新建立？还是稳定运行？）

### 1.3 OSPF 接口状态

```bash
# 所有接口
display ospf interface

# 指定接口（查看 Cost、Hello/Dead、DR/BDR 详情）
display ospf interface GigabitEthernet x/x/x
```

**关键检查项：**
- 接口是否参与 OSPF（列出所有应有接口）
- Hello/Dead 间隔值（两端必须一致）
- 接口 Cost 值（是否符合规划）
- 网络类型（Broadcast / P2P / NBMA / P2MP）
- DR/BDR 状态（广播网络）
- 邻居关系状态
- 接口状态（DR / BDR / DROther / P-2-P）

### 1.4 OSPF 路由表

```bash
display ospf routing
```

**关键检查项：**
- 是否学到所有区域的 OSPF 路由
- 路由条目数量和预期是否一致
- Route Cost 是否合理
- 路由类型是否正确（Intra-area / Inter-area / External）
- 是否有重复路由或环路迹象

### 1.5 IP 路由表（OSPF 路由过滤）

```bash
display ip routing-table protocol ospf
```

**关键检查项：**
- OSPF 路由是否已加入全局路由表
- 路由优先级（华为默认 10）
- 下一跳地址是否正确
- Flags 是否都为 D（Download to FIB）
- 路由目的地址和掩码是否正确

### 1.6 OSPF LSDB（链路状态数据库）

```bash
# 查看完整 LSDB
display ospf lsdb

# 按类型查看
display ospf lsdb router
display ospf lsdb network
display ospf lsdb summary
display ospf lsdb asbr
display ospf lsdb ase
display ospf lsdb nssa

# 自生 LSA 查看
display ospf lsdb router self-originate
```

**关键检查项：**
- Type 1 (Router) LSA：每台路由器是否为每个区域生成一条
- Type 2 (Network) LSA：广播网络是否有 DR 生成
- Type 3 (Summary) LSA：ABR 是否正确生成区域间路由
- Type 4 (ASBR Summary) LSA：ASBR 信息是否正确传播
- Type 5 (AS External) LSA：外部路由是否引入
- LSA 的 Age 是否正常（< 1800 表示新鲜，> 3000 将超时）
- Sequence Number 是否在正常增长
- LSDB 在所有路由器上是否一致（同一区域内）

### 1.7 ABR/ASBR 信息

```bash
display ospf abr-asbr
```

**关键检查项：**
- ABR 上是否显示自身为 ABR（`display ospf brief` 中的 ABR: True）
- 是否正确学到其他 ABR/ASBR
- Cost 到达各 ABR/ASBR 是否合理

### 1.8 虚链路状态（如有配置）

```bash
display ospf vlink
```

输出显示虚链路端点 Router-ID 和状态（应为 Full）。

### 1.9 错误统计与性能

```bash
# 错误统计（关键）
display ospf error

# SPF/性能统计
display ospf cumulative

# 进程状态
display ospf status
```

**关键检查项：**
- Hello Errors：Hello 报文错误次数
- Auth Errors：认证失败次数
- MTU Mismatch Errors：MTU 不匹配
- SPF 运行总次数
- 平均 SPF 执行时间

### 1.10 安全认证检查

```bash
# 查看接口认证配置
display ospf interface

# 查看区域认证配置（模拟器不支持管道过滤）
display ospf brief

# 查看 keychain（如使用）
display keychain all
```

### 1.11 连通性测试

```bash
# 跨区域 Ping 测试
ping -a 源地址 目的地址
```

**建议测试路径：**
- 每个区域内部设备互 Ping
- 跨区域设备互 Ping
- Loopback 接口互 Ping
- 建议测试超时等待 3 次

---

## 二、巡检数据采集流程

### 2.1 按设备角色分批采集

**第一批 — ABR（全量采集）：**
| 数据项 | 命令 |
|--------|------|
| 邻居 | `display ospf peer brief` |
| 接口 | `display ospf interface` |
| OSPF 路由 | `display ospf routing` |
| IP 路由表 | `display ip routing-table protocol ospf` |
| LSDB | `display ospf lsdb`（全区域） |
| ABR 信息 | `display ospf abr-asbr` |
| 错误统计 | `display ospf error` |
| SPF 统计 | `display ospf cumulative` |

**第二批 — 骨干路由器：**
| 数据项 | 命令 |
|--------|------|
| 邻居 | `display ospf peer brief` |
| OSPF 路由 | `display ospf routing` |
| IP 路由表 | `display ip routing-table protocol ospf` |
| LSDB | `display ospf lsdb`（Area 0） |

**第三批 — 内部路由器（IR）：**
| 数据项 | 命令 |
|--------|------|
| 邻居 | `display ospf peer brief` |
| OSPF 路由 | `display ospf routing` |
| IP 路由表 | `display ip routing-table protocol ospf` |
| LSDB | `display ospf lsdb`（仅本区域） |

**第四批 — 连通性验证：**
测试跨区域 Ping，记录结果和 RTT。

### 2.2 使用 show-device-by-name MCP 工具

对每台设备逐条执行命令：

```
show-device-by-name(device_name="AR1", command="display ospf peer brief", ...)
show-device-by-name(device_name="AR1", command="display ospf routing", ...)
show-device-by-name(device_name="AR1", command="display ip routing-table protocol ospf", ...)
show-device-by-name(device_name="AR1", command="display ospf lsdb", ...)
```

---

## 三、巡检报告模板

生成巡检报告时，按以下模板结构组织内容：

```markdown
# OSPF 多区域巡检报告

**报告时间：** [YYYY-MM-DD HH:MM]
**巡检范围：** [设备列表]
**拓扑描述：** [简要说明]

---

## 一、拓扑与配置概要

### 1.1 网络拓扑

[ASCII 拓扑图]

### 1.2 设备与 IP 规划表

| 设备 | 接口 | IP 地址 | 子网掩码 | 所属区域 | 角色 |
|------|------|---------|---------|---------|------|
| ... | ... | ... | ... | ... | ... |

### 1.3 路由器角色

| 路由器 | Router-ID | 角色 | 所属区域 |
|--------|-----------|------|---------|
| ... | ... | ... | ... |

### 1.4 配置一致性检查

| 设备 | OSPF 进程号 | Router-ID | 配置面积数 | 配置一致性 |
|------|-------------|-----------|-----------|-----------|
| ... | ... | ... | ... | ✓/✗ |

---

## 二、OSPF 邻居深度检查

### 2.1 邻居关系汇总表

| 设备 | 对端 | 对端 Router-ID | 状态 | 所属区域 | 接口 | UpTime |
|------|------|---------------|------|---------|------|--------|
| AR1 | AR2 | 2.2.2.2 | Full | 0.0.0.0 | GE0/0/0 | 1d2h |
| AR1 | AR5 | 5.5.5.5 | Full | 0.0.0.1 | GE0/0/1 | 1d2h |

**状态判定：**
- ✅ **Full**：完全邻接，LSDB 同步完成
- ✅ **2-Way**：广播网络正常（DR-Other 之间）
- ❌ 其他状态（Init/ExStart/Exchange/Loading）：需排查

### 2.2 邻居异常分析

| 设备 | 对端 | 状态 | 问题分析 |
|------|------|------|---------|
| ... | ... | ... | ... |

### 2.3 DR/BDR 选举状态

| 网段 | DR | BDR | DR 优先级 | DR 是否稳定 |
|------|-----|-----|----------|------------|
| 172.16.12.0/24 | 2.2.2.2 | 1.1.1.1 | 1/1 | ✓ |
| ... | ... | ... | ... | ... |

---

## 三、OSPF 接口分析

### 3.1 接口 OSPF 参数表

| 设备 | 接口 | 状态 | 网络类型 | Cost | Hello/Dead | DR/BDR |
|------|------|------|---------|------|-----------|--------|
| AR1 | GE0/0/0 | DR | Broadcast | 1 | 10/40 | 172.16.12.1/172.16.12.2 |
| ... | ... | ... | ... | ... | ... | ... |

### 3.2 Cost 一致性检查

| 链路 | 端1 Cost | 端2 Cost | 判定 |
|------|----------|----------|------|
| AR1-GE0/0/0 ↔ AR2-GE0/0/0 | 1 | 1 | ✓ 一致 |
| ... | ... | ... | ... |

---

## 四、OSPF 路由表分析

### 4.1 OSPF 路由条目

| 目的网段/前缀 | 掩码 | Cost | 下一跳 | 出接口 | 路由类型 |
|--------------|------|------|--------|--------|---------|
| 172.16.12.0 | 24 | 1 | 直连 | GE0/0/0 | Stub (区域内) |
| 172.16.15.0 | 24 | 1 | 直连 | GE0/0/1 | Stub (区域内) |
| 172.16.23.0 | 24 | 2 | 172.16.12.2 | GE0/0/0 | Inter-area |
| 1.1.1.1 | 32 | 0 | 直连 | Loop0 | Stub |
| ... | ... | ... | ... | ... | ... |

**路由类型标记：**
- `Stub/Transit`：区域内路由（O）
- `Inter-area`：区域间路由（O IA）
- `Type1`：外部路由（O E1）
- `Type2`：外部路由（O E2）

### 4.2 预期路由表校验

| 设备 | 应有路由数 | 实际路由数 | 缺失路由 | 额外路由 | 判定 |
|------|-----------|-----------|---------|---------|------|
| AR1 | N | N | 无 | 无 | ✓ |
| AR2 | N | N | 无 | 无 | ✓ |
| ... | ... | ... | ... | ... | ... |

### 4.3 IP 路由表（OSPF 路由）

| 设备 | 路由条目数 | 优先级 | 下一跳正确性 | 判定 |
|------|-----------|--------|-------------|------|
| AR1 | N | 10 | ✓ | ✓ |
| ... | ... | ... | ... | ... |

---

## 五、LSDB 同步检查

### 5.1 LSA 统计

| 设备 | 区域 | Type 1 | Type 2 | Type 3 | Type 4 | Type 5 | Type 7 |
|------|------|--------|--------|--------|--------|--------|--------|
| AR1 | 0.0.0.0 | N | N | N | N | N | — |
| AR1 | 0.0.0.1 | N | N | — | — | — | — |
| AR2 | 0.0.0.0 | N | N | N | N | N | — |
| ... | ... | ... | ... | ... | ... | ... | ... |

### 5.2 LSA Age 健康检查

| 设备 | 区域 | 最小 Age | 最大 Age | 平均 Age | 判定 |
|------|------|---------|---------|---------|------|
| AR1 | 0.0.0.0 | 120 | 1500 | 800 | ✓ 正常 |
| ... | ... | ... | ... | ... | ... |

**Age 判定规则：** 0-300 刚刚刷新；300-1800 正常；1800-3600 即将超时刷新

### 5.3 LSDB 一致性验证

- ✓ 同一区域内各设备 LSDB 一致（同类型 LSA 数量相同）
- ✓ ABR 上有多区域 LSDB
- ✓ IR 上仅有本区域 LSDB + 区域间汇总 LSA（Type 3）
- ✓ Stub 区域无 Type 4/5 LSA
- ✓ NSSA 区域存在 Type 7 LSA

---

## 六、ABR/ASBR 状态检查

### 6.1 ABR 信息

| 设备 | 自身是否 ABR | 学到的 ABR | Cost | 判定 |
|------|------------|-----------|------|------|
| AR1 | ✓ 是 | 2.2.2.2 | 2 | ✓ |
| AR2 | ✓ 是 | 1.1.1.1 | 2 | ✓ |
| ... | ... | ... | ... | ... |

### 6.2 ASBR 信息（如存在）

| 设备 | ASBR Router-ID | Cost | 所在区域 | 引入路由源 |
|------|---------------|------|---------|-----------|
| ... | ... | ... | ... | ... |

---

## 七、特殊区域与虚链路检查

### 7.1 特殊区域类型

| 区域 | 设备 | 配置类型 | LSDB 验证 | 判定 |
|------|------|---------|-----------|------|
| Area 1 | AR1, AR5 | Stub | 无 Type 4/5 | ✓ |
| ... | ... | ... | ... | ... |

### 7.2 虚链路状态

| 传输区域 | 端1 | 端2 | 状态 |
|---------|------|------|------|
| ... | ... | ... | ... |

---

## 八、安全认证检查

### 8.1 认证配置

| 链路/区域 | 认证类型 | 配置一致性 | 判定 |
|----------|---------|-----------|------|
| Area 0 | MD5 | 两端一致 | ✓ |
| AR1-GE0/0/0 ↔ AR2-GE0/0/0 | MD5 key-id 1 | 一致 | ✓ |
| ... | ... | ... | ... |

### 8.2 认证错误统计

| 设备 | Auth Errors | 判定 |
|------|------------|------|
| AR1 | 0 | ✓ 无认证错误 |
| ... | ... | ... |

---

## 九、性能与稳定性检查

### 9.1 错误统计

| 设备 | Hello Errors | Auth Errors | MTU Errors | LSA Errors |
|------|-------------|-------------|------------|------------|
| AR1 | 0 | 0 | 0 | 0 |
| ... | ... | ... | ... | ... |

### 9.2 SPF 运行统计

| 设备 | SPF 总数 | 平均执行时间 | 运行时长 | 判定 |
|------|---------|------------|---------|------|
| AR1 | 15 | 1ms | 1d2h | ✓ 稳定 |
| ... | ... | ... | ... | ... |

### 9.3 震荡检测

| 设备 | 对端 | 邻居 UP/Down 次数 | 判定 |
|------|------|------------------|------|
| AR1 | AR2 | 0（稳定） | ✓ |
| ... | ... | ... | ... |

---

## 十、连通性测试结果

### 10.1 区域内 Ping

| 源设备 | 源地址 | 目的设备 | 目的地址 | 结果 | RTT |
|--------|--------|---------|---------|------|-----|
| AR5 | 5.5.5.5 | AR1 | 1.1.1.1 | ✓ 通 | Xms |
| ... | ... | ... | ... | ... | ... |

### 10.2 跨区域 Ping

| 源设备 | 源地址 | 目的设备 | 目的地址 | 区域路径 | 结果 | RTT |
|--------|--------|---------|---------|---------|------|-----|
| AR5 | 5.5.5.5 | AR6 | 6.6.6.6 | Area1→Area0→Area2 | ✓ 通 | Xms |
| ... | ... | ... | ... | ... | ... | ... |

### 10.3 Traceroute（可选）

```
# 跨区域路径查看
tracert -a 5.5.5.5 6.6.6.6
```

---

## 十一、配置保存确认

| 设备 | 配置已保存 | 最后保存时间 |
|------|-----------|------------|
| AR1 | ✓ | [时间] |
| AR2 | ✓ | [时间] |
| ... | ... | ... |

---

## 十二、巡检结论

### 12.1 检查项汇总表

| 检查类别 | 检查项 | 结果 | 说明 |
|---------|--------|------|------|
| 基础 | OSPF 进程启动 | ✓/✗ | |
| 邻居 | 全部 Full | ✓/✗ | |
| 邻居 | 数量符合拓扑 | ✓/✗ | |
| 接口 | Cost 两端一致 | ✓/✗ | |
| 接口 | Hello/Dead 一致 | ✓/✗ | |
| 路由 | 路由表完整 | ✓/✗ | |
| 路由 | Cost 合理 | ✓/✗ | |
| IP 路由 | OSPF 路由已注入 | ✓/✗ | |
| IP 路由 | 优先级正确 | ✓/✗ | |
| LSDB | 区域内一致 | ✓/✗ | |
| LSDB | LSA Age 正常 | ✓/✗ | |
| ABR | ABR 正确识别 | ✓/✗ | |
| 认证 | 配置一致 | ✓/✗ | |
| 认证 | 无认证错误 | ✓/✗ | |
| 错误 | 无异常增长 | ✓/✗ | |
| SPF | 频率正常 | ✓/✗ | |
| 震荡 | 无邻居震荡 | ✓/✗ | |
| 连通性 | 区域内互通 | ✓/✗ | |
| 连通性 | 跨区域互通 | ✓/✗ | |
| 配置 | 配置已保存 | ✓/✗ | |

### 12.2 整体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 邻居状态 | ★★★★★ | |
| 路由表 | ★★★★★ | |
| LSDB 同步 | ★★★★★ | |
| 连通性 | ★★★★★ | |
| 性能稳定性 | ★★★★★ | |
| 安全性 | ★★★★★ | |

### 12.3 结论与建议

**配置状态：** OSPF 多区域配置完成，运行 [正常/异常]

**问题发现（如有）：**
1. [问题1] — [建议修复方案]
2. [问题2] — [建议修复方案]

**优化建议：**
- [建议1] 可考虑调整 Cost 值优化路径选择
- [建议2] 建议配置路由汇总减少 LSDB 和路由表规模
- [建议3] 末梢区域可配置 Stub 减少 LSA 数量
- [建议4] 生产环境建议启用 BFD 加速故障检测
- [建议5] 建议配置 OSPF 认证增强安全性
- [建议6] 建议对连接终端的 Loopback 接口配置静默

---

## 十三、故障排查（如发现问题）

### 13.1 邻居问题排查流程

```
邻居非 Full
  │
  ├─ Down ──────────→ 物理链路 / ACL 阻挡 / 接口未参与 OSPF
  │
  ├─ Init ───────────→ network 未覆盖 / Hello 间隔不一致 / 区域 ID 不一致
  │
  ├─ ExStart ────────→ MTU 不一致（启用 `ospf mtu-enable`）
  │
  ├─ Exchange ───────→ 认证不匹配 / DBD 损坏
  │
  └─ Loading ────────→ LSA 请求超时 / LSDB 异常 → `reset ospf process`
```

### 13.2 路由问题排查

| 症状 | 排查方向 | 命令 |
|------|---------|------|
| 缺少某网段路由 | 检查 network 宣告和 ABR 配置 | `display ospf brief` |
| Cost 过大/路径次优 | 检查接口 Cost 和参考带宽 | `display ospf interface` |
| 路由环路 | 检查 ABR 路由汇总掩码 | `display ospf lsdb summary` |
| 默认路由不生效 | 检查 default-route-advertise | `display ospf routing` |
| Stub 区域异常 | 区域内设备是否全部 stub | `display ospf brief` |

### 13.3 常用恢复命令

| 操作 | 命令 | 风险 |
|------|------|------|
| 重启 OSPF 进程 | `reset ospf 1 process` | 中断路由 |
| 重置邻居 | `reset ospf peer <router-id>` | 仅影响指定邻居 |
| 清理错误计数 | `reset ospf counters` | 无风险 |
| 删除进程 | `undo ospf 1` | 完全删除 |

---

## 附录 A：命令速查表

| 目的 | 命令 | 采集设备 |
|------|------|---------|
| 邻居摘要 | `display ospf peer brief` | 全部 |
| 邻居详情 | `display ospf peer` | 异常时 |
| 接口 OSPF 信息 | `display ospf interface` | 全部 |
| 接口详情 | `display ospf interface <if>` | 按需 |
| OSPF 路由表 | `display ospf routing` | 全部 |
| IP 路由表 OSPF  | `display ip routing-table protocol ospf` | 全部 |
| LSDB 摘要 | `display ospf lsdb` | ABR + 每区域 1 台 |
| Router LSA | `display ospf lsdb router` | 全部 |
| Network LSA | `display ospf lsdb network` | ABR |
| Summary LSA | `display ospf lsdb summary` | ABR |
| ASE LSA | `display ospf lsdb ase` | ASBR |
| ABR/ASBR | `display ospf abr-asbr` | ABR |
| 错误统计 | `display ospf error` | 按需 |
| SPF 统计 | `display ospf cumulative` | 按需 |
| 进程状态 | `display ospf status` | 按需 |
| 虚链路 | `display ospf vlink` | 配置了虚链路的设备 |
| 当前配置 | `display ospf brief` | 按需 |
| Ping | `ping -a <src> <dst>` | 测试路径 |
