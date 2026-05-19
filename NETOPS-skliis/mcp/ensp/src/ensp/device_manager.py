"""
设备管理器
管理设备信息缓存，提供设备查询功能
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional, List, Dict
from datetime import datetime

from .models import Device, Topology, DeviceConnection
from .topo_parser import TopoParser, TopoParserError

logger = logging.getLogger(__name__)


class DeviceManagerError(Exception):
    """设备管理器异常"""
    pass


class DeviceManager:
    """设备管理器 - 维护设备信息缓存"""

    DEFAULT_CACHE_DIR = "data"
    CACHE_FILE_NAME = "topology.json"

    def __init__(self, cache_dir: str = None, working_dir: str = None):
        """
        初始化设备管理器

        Args:
            cache_dir: 缓存目录路径
            working_dir: 工作目录路径
        """
        self.working_dir = Path(working_dir) if working_dir else Path.cwd()
        self.cache_dir = Path(cache_dir) if cache_dir else self.working_dir / self.DEFAULT_CACHE_DIR
        self.cache_file = self.cache_dir / self.CACHE_FILE_NAME

        self.topology: Optional[Topology] = None
        self._initialized = False
        # 设备 YAML 配置中的端口覆盖（名称 → 端口号）
        # 当 .topo 文件端口与 eNSP 实际端口不一致时使用
        self._yaml_port_overrides: Dict[str, int] = {}

        # 尝试加载 config/devices.yaml 中的端口映射
        self._load_yaml_overrides()

        # 确保缓存目录存在
        self._ensure_cache_dir()

    def _load_yaml_overrides(self):
        """
        从 config/devices.yaml 加载端口覆盖
        解决 .topo 文件端口与 eNSP 实际端口不匹配的问题
        """
        # 计算项目根目录: device_manager.py 在 mcp/ensp/src/ensp/ 下
        # 需要上溯 5 级到达项目根目录
        current = os.path.dirname(os.path.abspath(__file__))
        for _ in range(4):  # ensp → src → ensp → mcp → NETOPS
            current = os.path.dirname(current)
        yaml_path = os.path.join(current, "config", "devices.yaml")

        if not os.path.exists(yaml_path):
            logger.warning(f"devices.yaml 未找到: {yaml_path}")
            return

        try:
            import yaml
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            for dev in data.get("devices", []):
                name = dev.get("name", "")
                port = dev.get("port", 0)
                if name and port:
                    self._yaml_port_overrides[name] = int(port)
            if self._yaml_port_overrides:
                logger.info(f"已加载 {len(self._yaml_port_overrides)} 个设备端口覆盖: {self._yaml_port_overrides}")
        except ImportError:
            logger.warning("PyYAML 未安装，跳过端口覆盖")
        except Exception as e:
            logger.warning(f"加载 devices.yaml 端口覆盖失败: {e}")

    def _ensure_cache_dir(self):
        """确保缓存目录存在"""
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def initialize(self) -> dict:
        """
        初始化设备管理器，尝试从缓存加载拓扑

        Returns:
            初始化状态信息
        """
        result = {
            "status": "success",
            "loaded_from_cache": False,
            "device_count": 0,
            "message": ""
        }

        # 尝试从缓存加载
        if self.cache_file.exists():
            try:
                self.load_from_cache()
                result["loaded_from_cache"] = True
                result["device_count"] = len(self.topology.devices)
                result["message"] = f"从缓存加载了 {result['device_count']} 个设备"
                logger.info(result["message"])
            except Exception as e:
                result["status"] = "warning"
                result["message"] = f"缓存加载失败: {e}"
                logger.warning(result["message"])

        self._initialized = True
        return result

    def load_topology(self, topo_file: str) -> Topology:
        """
        加载并解析拓扑文件

        Args:
            topo_file: 拓扑文件路径 (相对或绝对)

        Returns:
            Topology 对象
        """
        # 处理相对路径
        topo_path = Path(topo_file)
        if not topo_path.is_absolute():
            topo_path = self.working_dir / topo_path

        if not topo_path.exists():
            raise DeviceManagerError(f"拓扑文件不存在: {topo_path}")

        try:
            parser = TopoParser()
            self.topology = parser.parse(str(topo_path))

            # 保存到缓存
            self._save_cache()

            logger.info(f"成功加载拓扑: {len(self.topology.devices)} 个设备")
            return self.topology

        except TopoParserError as e:
            raise DeviceManagerError(f"解析拓扑文件失败: {e}")

    def load_from_cache(self) -> Optional[Topology]:
        """
        从缓存加载拓扑

        Returns:
            Topology 对象或 None
        """
        if not self.cache_file.exists():
            return None

        try:
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.topology = Topology.from_dict(data)
            logger.info(f"从缓存加载拓扑: {len(self.topology.devices)} 个设备")
            return self.topology

        except Exception as e:
            logger.error(f"从缓存加载失败: {e}")
            return None

    def _save_cache(self):
        """保存拓扑到缓存文件"""
        if not self.topology:
            return

        # 添加缓存时间
        data = self.topology.to_dict()
        data["cached_at"] = datetime.now().isoformat()

        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.debug(f"拓扑已缓存到: {self.cache_file}")

    def get_device(self, name: str) -> Optional[Device]:
        """
        通过名称获取设备（自动应用 YAML 端口覆盖）

        Args:
            name: 设备名称

        Returns:
            Device 对象或 None
        """
        if not self.topology:
            # 尝试从缓存加载
            self.load_from_cache()

        if self.topology:
            device = self.topology.get_device(name)
            if device and name in self._yaml_port_overrides:
                yaml_port = self._yaml_port_overrides[name]
                if device.com_port != yaml_port:
                    logger.info(f"设备 '{name}' 端口覆盖: {device.com_port} → {yaml_port} (来自 devices.yaml)")
                    device.com_port = yaml_port
            return device
        return None

    def get_device_by_port(self, port: int) -> Optional[Device]:
        """
        通过端口获取设备

        Args:
            port: Telnet 端口

        Returns:
            Device 对象或 None
        """
        if not self.topology:
            self.load_from_cache()

        if self.topology:
            for device in self.topology.devices:
                if device.com_port == port:
                    return device
        return None

    def get_all_devices(self, exclude_cloud: bool = True) -> List[Device]:
        """
        获取所有设备

        Args:
            exclude_cloud: 是否排除 Cloud 设备

        Returns:
            设备列表
        """
        if not self.topology:
            self.load_from_cache()

        if not self.topology:
            return []

        devices = self.topology.devices
        if exclude_cloud:
            devices = [d for d in devices if d.model != "Cloud"]

        return devices

    def get_configurable_devices(self) -> List[Device]:
        """
        获取所有可配置的设备

        Returns:
            可配置设备列表
        """
        if not self.topology:
            self.load_from_cache()

        if self.topology:
            return self.topology.get_configurable_devices()
        return []

    def get_devices_by_model(self, model: str) -> List[Device]:
        """
        按型号获取设备

        Args:
            model: 设备型号

        Returns:
            设备列表
        """
        if not self.topology:
            self.load_from_cache()

        if self.topology:
            return self.topology.get_devices_by_model(model)
        return []

    def get_device_connections(self, device_name: str) -> List[DeviceConnection]:
        """
        获取设备的所有连接

        Args:
            device_name: 设备名称

        Returns:
            连接列表
        """
        if not self.topology:
            self.load_from_cache()

        if not self.topology:
            return []

        return [c for c in self.topology.connections
                if c.device_a_name == device_name or c.device_b_name == device_name]

    def get_device_list_summary(self) -> List[dict]:
        """
        获取设备列表摘要

        Returns:
            设备摘要列表
        """
        devices = self.get_all_devices(exclude_cloud=True)

        return [
            {
                "name": d.name,
                "model": d.model,
                "com_port": d.com_port,
                "device_type": d.device_type.value,
                "is_configurable": d.is_configurable,
                "interfaces_summary": self._get_interfaces_summary(d)
            }
            for d in devices
        ]

    def _get_interfaces_summary(self, device: Device) -> str:
        """获取接口摘要字符串"""
        parts = []
        for iface_type, info in device.interfaces.items():
            parts.append(f"{info.count}x{info.name}")
        return ", ".join(parts) if parts else "N/A"

    def is_loaded(self) -> bool:
        """检查是否已加载拓扑"""
        return self.topology is not None

    def get_topology_info(self) -> dict:
        """
        获取拓扑信息摘要

        Returns:
            拓扑信息字典
        """
        if not self.topology:
            return {
                "loaded": False,
                "message": "未加载拓扑文件"
            }

        return {
            "loaded": True,
            "version": self.topology.version,
            "source_file": self.topology.source_file,
            "device_count": len(self.topology.devices),
            "configurable_count": len(self.get_configurable_devices()),
            "connection_count": len(self.topology.connections)
        }

    def clear_cache(self):
        """清除缓存"""
        if self.cache_file.exists():
            self.cache_file.unlink()
        self.topology = None
        logger.info("缓存已清除")


# 全局设备管理器实例
_device_manager: Optional[DeviceManager] = None


def get_device_manager() -> DeviceManager:
    """获取全局设备管理器实例"""
    global _device_manager
    if _device_manager is None:
        _device_manager = DeviceManager()
    return _device_manager


def set_device_manager(manager: DeviceManager):
    """设置全局设备管理器实例"""
    global _device_manager
    _device_manager = manager
