"""
数据模型定义
用于定义设备、拓扑、连接等数据结构
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict
from enum import Enum
import json


class DeviceType(Enum):
    """设备类型枚举"""
    SWITCH_L2 = "layer2_switch"   # 二层交换机 (S3700)
    SWITCH_L3 = "layer3_switch"   # 三层交换机 (S5700)
    ROUTER = "router"             # 路由器 (AR 系列)
    CLOUD = "cloud"               # 云设备
    UNKNOWN = "unknown"


class ConnectionMethod(Enum):
    """连接方式枚举"""
    TELNET = "telnet"
    SSH = "ssh"


@dataclass
class InterfaceInfo:
    """接口信息"""
    type: str           # 接口类型 (Ethernet, GE, Serial)
    name: str           # 接口名称 (Ethernet, GE)
    count: int          # 接口数量
    prefix: str         # 接口前缀 (如 Ethernet0/0/, GigabitEthernet0/0/)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "InterfaceInfo":
        return cls(**data)


@dataclass
class Device:
    """设备信息"""
    id: str                     # 设备唯一标识 (UUID)
    name: str                   # 设备名称
    model: str                  # 设备型号 (S3700, S5700, AR2240, Cloud)
    com_port: int               # Telnet 端口
    system_mac: str             # 系统 MAC 地址
    interfaces: dict = field(default_factory=dict)  # 接口信息 {type: InterfaceInfo}

    @property
    def device_type(self) -> DeviceType:
        """根据型号推断设备类型"""
        if self.model.startswith("S3"):
            return DeviceType.SWITCH_L2
        elif self.model.startswith("S5") or self.model.startswith("S6"):
            return DeviceType.SWITCH_L3
        elif self.model.startswith("AR"):
            return DeviceType.ROUTER
        elif self.model == "Cloud":
            return DeviceType.CLOUD
        return DeviceType.UNKNOWN

    @property
    def is_configurable(self) -> bool:
        """是否可配置 (排除 Cloud 等虚拟设备)"""
        return self.com_port > 0 and self.model != "Cloud"

    def get_interface_name(self, interface_type: str, index: int) -> Optional[str]:
        """根据类型和索引生成完整接口名"""
        if interface_type in self.interfaces:
            info = self.interfaces[interface_type]
            return f"{info.prefix}{index}"
        return None

    def to_dict(self) -> dict:
        data = asdict(self)
        # 转换 interfaces 中的 InterfaceInfo 对象为 dict
        data["interfaces"] = {k: v.to_dict() if isinstance(v, InterfaceInfo) else v
                              for k, v in self.interfaces.items()}
        data["device_type"] = self.device_type.value
        data["is_configurable"] = self.is_configurable
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Device":
        interfaces = {}
        for k, v in data.get("interfaces", {}).items():
            if isinstance(v, dict):
                interfaces[k] = InterfaceInfo.from_dict(v)
            else:
                interfaces[k] = v
        return cls(
            id=data["id"],
            name=data["name"],
            model=data["model"],
            com_port=data["com_port"],
            system_mac=data["system_mac"],
            interfaces=interfaces
        )


@dataclass
class DeviceConnection:
    """设备连接关系"""
    device_a_id: str            # 设备 A 的 ID
    device_b_id: str            # 设备 B 的 ID
    device_a_name: str = ""     # 设备 A 的名称 (便于阅读)
    device_b_name: str = ""     # 设备 B 的名称
    interface_a: str = ""       # 设备 A 的接口
    interface_b: str = ""       # 设备 B 的接口

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "DeviceConnection":
        return cls(**data)


@dataclass
class Topology:
    """完整拓扑信息"""
    version: str                                    # 拓扑版本
    source_file: str = ""                           # 源文件路径
    devices: list = field(default_factory=list)     # 设备列表
    connections: list = field(default_factory=list) # 连接列表
    device_map: dict = field(default_factory=dict)  # 设备名称 -> Device 映射

    def get_device(self, name: str) -> Optional[Device]:
        """通过名称获取设备"""
        return self.device_map.get(name)

    def get_configurable_devices(self) -> List["Device"]:
        """获取所有可配置的设备"""
        return [d for d in self.devices if d.is_configurable]

    def get_devices_by_model(self, model: str) -> List["Device"]:
        """按型号获取设备"""
        return [d for d in self.devices if d.model == model]

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "source_file": self.source_file,
            "devices": [d.to_dict() for d in self.devices],
            "connections": [c.to_dict() for c in self.connections],
            "device_count": len(self.devices),
            "configurable_count": len(self.get_configurable_devices())
        }

    def to_json(self, file_path: str):
        """保存为 JSON 文件"""
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, data: dict) -> "Topology":
        devices = [Device.from_dict(d) for d in data.get("devices", [])]
        connections = [DeviceConnection.from_dict(c) for c in data.get("connections", [])]

        # 构建设备映射
        device_map = {d.name: d for d in devices}

        return cls(
            version=data.get("version", "unknown"),
            source_file=data.get("source_file", ""),
            devices=devices,
            connections=connections,
            device_map=device_map
        )


@dataclass
class ConnectionConfig:
    """连接配置"""
    host: str = "127.0.0.1"
    port: int = 2000
    method: ConnectionMethod = ConnectionMethod.TELNET
    username: str = ""
    password: str = ""
    timeout: int = 10

    def to_dict(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "method": self.method.value,
            "username": self.username,
            "timeout": self.timeout
            # 不输出 password
        }


@dataclass
class ConnectionResult:
    """连接结果"""
    success: bool
    response_time_ms: int
    error: Optional[str] = None
    output: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# 接口前缀映射表
INTERFACE_PREFIXES = {
    "Ethernet": "Ethernet0/0/",
    "GE": "GigabitEthernet0/0/",
    "GigabitEthernet": "GigabitEthernet0/0/",
    "Serial": "Serial0/0/",
    "XGigabitEthernet": "XGigabitEthernet0/0/",
    "Eth-Trunk": "Eth-Trunk"
}


def get_interface_prefix(interface_name: str) -> str:
    """获取接口前缀"""
    return INTERFACE_PREFIXES.get(interface_name, f"{interface_name}0/0/")
