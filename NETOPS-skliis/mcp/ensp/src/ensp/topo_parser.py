"""
拓扑文件解析器
解析 eNSP 的 .topo XML 文件，提取设备信息和连接关系
"""

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional, Dict, List
import logging

from .models import (
    Device,
    DeviceConnection,
    Topology,
    InterfaceInfo,
    get_interface_prefix
)

logger = logging.getLogger(__name__)


class TopoParserError(Exception):
    """拓扑解析异常"""
    pass


class TopoParser:
    """eNSP 拓扑文件解析器"""

    def __init__(self):
        self.devices: Dict[str, Device] = {}
        self.connections: List[DeviceConnection] = []
        self.device_name_map: Dict[str, Device] = {}
        self.version: str = "unknown"

    def parse(self, topo_file: str) -> Topology:
        """
        解析 .topo XML 文件

        Args:
            topo_file: 拓扑文件路径

        Returns:
            Topology 对象
        """
        topo_path = Path(topo_file)
        if not topo_path.exists():
            raise TopoParserError(f"拓扑文件不存在: {topo_file}")

        # 清空之前的数据
        self.devices.clear()
        self.connections.clear()
        self.device_name_map.clear()

        try:
            # eNSP 导出时声明 encoding="UNICODE"，但实际内容为 GBK 编码
            # 需要先以 GBK 解码，替换编码声明后再编码为 UTF-8 解析
            with open(topo_file, 'rb') as f:
                raw = f.read()

            # 检测实际编码（eNSP 内容通常为 GBK）
            content = raw.decode('gbk', errors='replace')

            # 替换不标准的编码声明
            content = content.replace('encoding="UNICODE"', 'encoding="UTF-8"')
            content = content.replace("encoding='UNICODE'", "encoding='UTF-8'")

            # 编码为 UTF-8 供 XML 解析器使用
            utf8_bytes = content.encode('utf-8')
            tree = ET.ElementTree(ET.fromstring(utf8_bytes))
            root = tree.getroot()

            # 解析版本
            self.version = root.get("version", "unknown")

            # 解析设备
            self._parse_devices(root)

            # 解析连接关系
            self._parse_lines(root)

            # 更新连接中的设备名称
            self._update_connection_names()

            logger.info(f"成功解析拓扑文件: {len(self.devices)} 个设备, {len(self.connections)} 条连接")

            return Topology(
                version=self.version,
                source_file=str(topo_path.absolute()),
                devices=list(self.devices.values()),
                connections=self.connections,
                device_map=self.device_name_map
            )

        except ET.ParseError as e:
            raise TopoParserError(f"XML 解析错误: {e}")
        except Exception as e:
            raise TopoParserError(f"解析拓扑文件时出错: {e}")

    def _parse_devices(self, root: ET.Element):
        """解析设备元素"""
        devices_elem = root.find("devices")
        if devices_elem is None:
            return

        for dev_elem in devices_elem.findall("dev"):
            try:
                device = self._parse_device(dev_elem)
                self.devices[device.id] = device
                self.device_name_map[device.name] = device
            except Exception as e:
                logger.warning(f"解析设备时出错: {e}")
                continue

    def _parse_device(self, dev_elem: ET.Element) -> Device:
        """解析单个设备元素"""
        device_id = dev_elem.get("id", "")
        name = dev_elem.get("name", "")
        model = dev_elem.get("model", "")
        com_port = int(dev_elem.get("com_port", "0"))
        system_mac = dev_elem.get("system_mac", "")

        # 处理中文乱码 (eNSP 使用 GBK 编码，XML 声明为 UNICODE)
        name = self._fix_encoding(name)

        # 解析接口信息
        interfaces = self._parse_interfaces(dev_elem)

        return Device(
            id=device_id,
            name=name,
            model=model,
            com_port=com_port,
            system_mac=system_mac,
            interfaces=interfaces
        )

    def _parse_interfaces(self, dev_elem: ET.Element) -> Dict[str, InterfaceInfo]:
        """解析设备的接口信息"""
        interfaces = {}

        for slot in dev_elem.findall(".//slot"):
            for iface in slot.findall("interface"):
                iface_type = iface.get("sztype", "")
                iface_name = iface.get("interfacename", "")
                iface_count = int(iface.get("count", "0"))

                if iface_type and iface_count > 0:
                    prefix = get_interface_prefix(iface_name)
                    interfaces[iface_type] = InterfaceInfo(
                        type=iface_type,
                        name=iface_name,
                        count=iface_count,
                        prefix=prefix
                    )

        return interfaces

    def _parse_lines(self, root: ET.Element):
        """解析连接线元素"""
        lines_elem = root.find("lines")
        if lines_elem is None:
            return

        for line_elem in lines_elem.findall("line"):
            try:
                connections = self._parse_line(line_elem)
                self.connections.extend(connections)
            except Exception as e:
                logger.warning(f"解析连接线时出错: {e}")
                continue

    def _parse_line(self, line_elem: ET.Element) -> List[DeviceConnection]:
        """解析单条连接线"""
        connections = []

        src_id = line_elem.get("srcDeviceID", "")
        dst_id = line_elem.get("destDeviceID", "")

        if not src_id or not dst_id:
            return connections

        src_device = self.devices.get(src_id)
        dst_device = self.devices.get(dst_id)

        if not src_device or not dst_device:
            return connections

        for pair in line_elem.findall("interfacePair"):
            src_index = int(pair.get("srcIndex", "0"))
            dst_index = int(pair.get("tarIndex", "0"))

            # 推断接口名
            src_interface = self._infer_interface_name(src_device, src_index)
            dst_interface = self._infer_interface_name(dst_device, dst_index)

            connections.append(DeviceConnection(
                device_a_id=src_id,
                device_b_id=dst_id,
                device_a_name=src_device.name,
                device_b_name=dst_device.name,
                interface_a=src_interface,
                interface_b=dst_interface
            ))

        return connections

    def _infer_interface_name(self, device: Device, index: int) -> str:
        """根据设备类型和索引推断接口名"""
        # 优先使用 GE 接口
        if "GE" in device.interfaces:
            info = device.interfaces["GE"]
            return f"{info.prefix}{index}"
        # 其次使用 Ethernet 接口
        elif "Ethernet" in device.interfaces:
            info = device.interfaces["Ethernet"]
            return f"{info.prefix}{index}"
        else:
            # 默认格式
            return f"GE0/0/{index}"

    def _update_connection_names(self):
        """更新连接中的设备名称"""
        for conn in self.connections:
            src_device = self.devices.get(conn.device_a_id)
            dst_device = self.devices.get(conn.device_b_id)
            if src_device:
                conn.device_a_name = src_device.name
            if dst_device:
                conn.device_b_name = dst_device.name

    @staticmethod
    def _fix_encoding(text: str) -> str:
        """
        修复 eNSP XML 中的中文乱码
        eNSP 导出的 XML 文件声明为 UNICODE 编码，但实际是 GBK
        """
        if not text:
            return text

        try:
            # 尝试 latin1 -> gbk 转换
            fixed = text.encode('latin1').decode('gbk')
            return fixed
        except (UnicodeDecodeError, UnicodeEncodeError):
            # 如果转换失败，返回原文
            return text


def parse_topo_file(topo_file: str) -> Topology:
    """
    解析拓扑文件的便捷函数

    Args:
        topo_file: 拓扑文件路径

    Returns:
        Topology 对象
    """
    parser = TopoParser()
    return parser.parse(topo_file)
