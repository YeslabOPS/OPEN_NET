# OSPF 路由协议配置指南

## 概述
OSPF（Open Shortest Path First）是一种基于链路状态的内部网关路由协议。

## 基本配置

### 启用 OSPF
```bash
router ospf 1
  router-id 1.1.1.1
  network 192.168.1.0 0.0.0.255 area 0
  network 10.0.0.0 0.255.255.255 area 0
```

### 配置 OSPF 接口
```bash
interface GigabitEthernet0/0
  ip ospf cost 10
  ip ospf hello-interval 10
  ip ospf dead-interval 40
```

## 常用验证命令
```bash
# 查看 OSPF 邻居
show ip ospf neighbor

# 查看 OSPF 数据库
show ip ospf database

# 查看 OSPF 接口
show ip ospf interface

# 查看路由表
show ip route ospf
```

## 故障排查
- 邻居状态卡在 INIT → 检查 Hello 间隔和 Dead 间隔是否匹配
- 邻居状态卡在 EXSTART/EXCHANGE → 检查 MTU 设置
- 邻居状态卡在 LOADING → 检查 LSA 泛洪是否正常

## 最佳实践
- 使用稳定的 router-id（Loopback 接口 IP）
- 合理划分区域减少 LSA 泛洪
- 配置认证提高安全性
- 使用 passive-interface 减少不必要的邻居建立
