"""
eNSP .topo 文件解析器
自包含实现，仅使用 Python 标准库（xml.etree.ElementTree）
支持标准 slot 格式和 NE 系列 slot-index 格式
"""

import xml.etree.ElementTree as ET
import os
from typing import List, Optional, Dict, Any

# ============================================================
# 设备类型分类
# ============================================================

ROUTER_MODELS = {
    "AR201", "AR1220", "AR2220", "AR2240", "AR3260",
    "Router", "NE40E", "NE5000E", "NE9000", "R250D",
}
SWITCH_MODELS = {"S3700", "S5700", "CE6800", "CE12800", "CX"}
FIREWALL_MODELS = {"USG5500", "USG6000V"}
WIRELESS_MODELS = {
    "AC6005", "AC6605",
    "AP2050", "AP3030", "AP4030", "AP4050", "AP5030",
    "AP6050", "AP7030", "AP7050", "AP8030", "AP8130", "AP9131",
    "AD9430", "STA", "Cellphone",
}
ENDPOINT_MODELS = {"PC", "Laptop", "Server", "Client", "MCS"}
OTHER_MODELS = {"Cloud", "FRSW", "HUB"}


def classify_device(model: str) -> str:
    """根据型号返回设备类型分类"""
    if model in ROUTER_MODELS:
        return "router"
    if model in SWITCH_MODELS:
        return "switch"
    if model in FIREWALL_MODELS:
        return "firewall"
    if model in WIRELESS_MODELS:
        return "wireless"
    if model in ENDPOINT_MODELS:
        return "endpoint"
    if model in OTHER_MODELS:
        return model.lower()
    return "unknown"


# ============================================================
# 接口名生成
# ============================================================

def _build_interface_list(slot_elems: list) -> List[str]:
    """
    从 <slot> 子元素构建接口名列表（按顺序编号）。

    处理两种格式:
    1. 标准格式: <interface sztype="Ethernet" interfacename="GE" count="2" />
       -> GE0/0/0, GE0/0/1（同类接口跨多个元素时索引连续递增）

    2. NE 系列格式: <interface category="Ethernet" type="GE" slotIndex="1" cardIndex="0" interfaceIndex="0" />
       -> GE1/0/0
    """
    interfaces = []
    for slot in slot_elems:
        slot_num = slot.get("number", "")
        # 追踪每个 (接口名, slot) 组合的当前起始序号，避免同名接口索引重复
        name_counter: Dict[str, int] = {}
        for intf in slot.findall("interface"):
            # 标准格式
            ifname = intf.get("interfacename")
            if ifname:
                try:
                    count = int(intf.get("count", "1"))
                except (ValueError, TypeError):
                    count = 1
                # 推断 slot 编号：slot17（主控板）视为 slot 0
                if slot_num.startswith("slot"):
                    try:
                        slot_idx = int(slot_num[4:])
                        if slot_idx == 17:
                            slot_idx = 0
                    except ValueError:
                        slot_idx = 0
                else:
                    slot_idx = 0
                # 同类接口跨多个元素时，索引从上次结束位置继续递增
                key = f"{ifname}_{slot_idx}"
                if key not in name_counter:
                    name_counter[key] = 0
                for _ in range(count):
                    interfaces.append(f"{ifname}{slot_idx}/0/{name_counter[key]}")
                    name_counter[key] += 1
                continue

            # NE 系列格式
            intf_type = intf.get("type", "GE")
            slot_idx = intf.get("slotIndex", "")
            card_idx = intf.get("cardIndex", "0")
            intf_idx = intf.get("interfaceIndex", "0")
            interfaces.append(f"{intf_type}{slot_idx}/{card_idx}/{intf_idx}")

    return interfaces


# ============================================================
# 数据模型
# ============================================================

class TopoDevice:
    """拓扑中的设备"""

    def __init__(self, dev_id: str, name: str, model: str,
                 com_port: int, interfaces: List[str],
                 cx: float = 0, cy: float = 0):
        self.id = dev_id
        self.name = name
        self.model = model
        self.com_port = com_port
        self.interfaces = interfaces
        self.device_type = classify_device(model)
        self.is_configurable = self.device_type in ("router", "switch", "firewall")
        self.cx = cx
        self.cy = cy

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "model": self.model,
            "com_port": self.com_port,
            "interfaces": self.interfaces,
            "device_type": self.device_type,
            "is_configurable": self.is_configurable,
            "position": {"x": self.cx, "y": self.cy},
        }

    def __repr__(self) -> str:
        return f"TopoDevice({self.name}, {self.model}, {self.device_type})"


class TopoConnection:
    """拓扑中的设备间连线"""

    def __init__(self, device_a_name: str, device_b_name: str,
                 interface_a: str, interface_b: str,
                 line_type: str = "Copper"):
        self.device_a_name = device_a_name
        self.device_b_name = device_b_name
        self.interface_a = interface_a
        self.interface_b = interface_b
        self.line_type = line_type

    def to_dict(self) -> dict:
        return {
            "device_a": self.device_a_name,
            "device_b": self.device_b_name,
            "interface_a": self.interface_a,
            "interface_b": self.interface_b,
            "line_type": self.line_type,
        }

    def __repr__(self) -> str:
        return (f"TopoConnection({self.device_a_name}:{self.interface_a} "
                f"<-> {self.device_b_name}:{self.interface_b})")


class Topology:
    """完整的拓扑信息"""

    def __init__(self, version: str, source_file: str = ""):
        self.version = version
        self.source_file = source_file
        self.devices: List[TopoDevice] = []
        self.connections: List[TopoConnection] = []
        self.labels: List[dict] = []
        self.shapes: List[dict] = []

    def get_device_by_id(self, dev_id: str) -> Optional[TopoDevice]:
        for d in self.devices:
            if d.id == dev_id:
                return d
        return None

    def get_device_by_name(self, name: str) -> Optional[TopoDevice]:
        for d in self.devices:
            if d.name == name:
                return d
        return None

    def get_configurable_devices(self) -> List[TopoDevice]:
        return [d for d in self.devices if d.is_configurable]

    def summary(self) -> dict:
        return {
            "source_file": self.source_file,
            "version": self.version,
            "devices_count": len(self.devices),
            "connections_count": len(self.connections),
            "configurable_devices": len(self.get_configurable_devices()),
            "labels_count": len(self.labels),
        }

    def to_dict(self) -> dict:
        return {
            "source_file": self.source_file,
            "version": self.version,
            "devices": [d.to_dict() for d in self.devices],
            "connections": [c.to_dict() for c in self.connections],
            "labels": self.labels,
            "shapes": self.shapes,
            "summary": self.summary(),
        }


# ============================================================
# 解析器
# ============================================================

class TopoParseError(Exception):
    """拓扑解析错误"""
    pass


class TopoParser:
    """eNSP .topo 文件解析器"""

    @staticmethod
    def parse(filepath: str) -> Topology:
        """
        解析 .topo 文件，返回 Topology 对象。

        参数:
            filepath: .topo 文件绝对路径

        返回:
            Topology 对象

        抛出:
            TopoParseError: 当文件不存在或格式错误时
        """
        if not os.path.exists(filepath):
            raise TopoParseError(f"文件不存在: {filepath}")

        try:
            # .topo 文件使用非标准 encoding="UNICODE"，需要先读取再强制 UTF-8 解析
            with open(filepath, "rb") as f:
                raw = f.read()
            # 去除 XML 声明中的 encoding 属性，强制用 UTF-8 解析
            xml_str = raw.decode("utf-8", errors="replace")
            # 如果声明中有非标准编码，删除 encoding 部分
            if "encoding=\"UNICODE\"" in xml_str:
                xml_str = xml_str.replace('encoding="UNICODE"', 'encoding="UTF-8"')
            root = ET.fromstring(xml_str)
        except ET.ParseError as e:
            raise TopoParseError(f"XML 解析失败: {e}")

        if root.tag != "topo":
            raise TopoParseError(f"不是有效的 .topo 文件（根标签为 {root.tag}）")

        version = root.get("version", "")
        topology = Topology(version=version, source_file=os.path.basename(filepath))

        # 解析设备
        devices_elem = root.find("devices")
        if devices_elem is not None:
            TopoParser._parse_devices(devices_elem, topology)

        # 解析连线
        lines_elem = root.find("lines")
        if lines_elem is not None:
            TopoParser._parse_lines(lines_elem, topology)

        # 解析形状
        shapes_elem = root.find("shapes")
        if shapes_elem is not None:
            TopoParser._parse_shapes(shapes_elem, topology)

        # 解析文本标签
        txttips_elem = root.find("txttips")
        if txttips_elem is not None:
            TopoParser._parse_txttips(txttips_elem, topology)

        return topology

    @staticmethod
    def _parse_devices(devices_elem: ET.Element, topology: Topology):
        for dev_elem in devices_elem.findall("dev"):
            dev_id = dev_elem.get("id", "")
            name = dev_elem.get("name", "")
            model = dev_elem.get("model", "")
            try:
                com_port = int(dev_elem.get("com_port", "0"))
            except (ValueError, TypeError):
                com_port = 0
            try:
                cx = float(dev_elem.get("cx", "0"))
            except (ValueError, TypeError):
                cx = 0
            try:
                cy = float(dev_elem.get("cy", "0"))
            except (ValueError, TypeError):
                cy = 0

            # 收集所有 slot
            slots = dev_elem.findall("slot")
            interfaces = _build_interface_list(slots)

            device = TopoDevice(
                dev_id=dev_id, name=name, model=model,
                com_port=com_port, interfaces=interfaces,
                cx=cx, cy=cy,
            )
            topology.devices.append(device)

    @staticmethod
    def _parse_lines(lines_elem: ET.Element, topology: Topology):
        for line_elem in lines_elem.findall("line"):
            src_id = line_elem.get("srcDeviceID", "")
            dst_id = line_elem.get("destDeviceID", "")

            if_pair = line_elem.find("interfacePair")
            if if_pair is None:
                continue

            line_type = if_pair.get("lineName", "Copper")
            try:
                src_index = int(if_pair.get("srcIndex", "0"))
            except (ValueError, TypeError):
                src_index = 0
            try:
                tar_index = int(if_pair.get("tarIndex", "0"))
            except (ValueError, TypeError):
                tar_index = 0

            src_dev = topology.get_device_by_id(src_id)
            dst_dev = topology.get_device_by_id(dst_id)

            src_name = src_dev.name if src_dev else src_id
            dst_name = dst_dev.name if dst_dev else dst_id

            src_iface = (src_dev.interfaces[src_index]
                         if src_dev and src_index < len(src_dev.interfaces)
                         else f"port{src_index}")
            dst_iface = (dst_dev.interfaces[tar_index]
                         if dst_dev and tar_index < len(dst_dev.interfaces)
                         else f"port{tar_index}")

            conn = TopoConnection(
                device_a_name=src_name,
                device_b_name=dst_name,
                interface_a=src_iface,
                interface_b=dst_iface,
                line_type=line_type,
            )
            topology.connections.append(conn)

    @staticmethod
    def _parse_shapes(shapes_elem: ET.Element, topology: Topology):
        for shape in shapes_elem.findall("shape"):
            topology.shapes.append({
                "type": shape.get("type", ""),
                "color": shape.get("color", ""),
                "position": shape.get("upleftcorner", ""),
                "width": shape.get("width", "0"),
                "height": shape.get("height", "0"),
            })

    @staticmethod
    def _parse_txttips(txttips_elem: ET.Element, topology: Topology):
        for tip in txttips_elem.findall("txttip"):
            content = tip.get("content", "")
            if content.strip():
                topology.labels.append({
                    "content": content,
                    "position": {
                        "left": tip.get("left", "0"),
                        "top": tip.get("top", "0"),
                    },
                })

    @staticmethod
    def parse_str(xml_content: str, filename: str = "") -> Topology:
        """从 XML 字符串解析拓扑"""
        if not xml_content.strip():
            raise TopoParseError("XML 内容为空")
        # 处理非标准 encoding
        if "encoding=\"UNICODE\"" in xml_content[:200]:
            xml_content = xml_content.replace('encoding="UNICODE"', 'encoding="UTF-8"')
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            raise TopoParseError(f"XML 解析失败: {e}")

        if root.tag != "topo":
            raise TopoParseError(f"不是有效的 .topo 文件（根标签为 {root.tag}）")

        version = root.get("version", "")
        topology = Topology(version=version, source_file=filename)

        devices_elem = root.find("devices")
        if devices_elem is not None:
            TopoParser._parse_devices(devices_elem, topology)

        lines_elem = root.find("lines")
        if lines_elem is not None:
            TopoParser._parse_lines(lines_elem, topology)

        shapes_elem = root.find("shapes")
        if shapes_elem is not None:
            TopoParser._parse_shapes(shapes_elem, topology)

        txttips_elem = root.find("txttips")
        if txttips_elem is not None:
            TopoParser._parse_txttips(txttips_elem, topology)

        return topology


# ============================================================
# 便捷函数
# ============================================================

def load_topo(filepath: str) -> dict:
    """加载并解析 .topo 文件，返回 dict（供 runner.py 调用）"""
    try:
        topology = TopoParser.parse(filepath)
        return {"success": True, "data": topology.to_dict()}
    except TopoParseError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": f"解析异常: {e}"}


def load_topo_from_str(xml_content: str, filename: str = "") -> dict:
    """从 XML 字符串解析 .topo，返回 dict"""
    try:
        topology = TopoParser.parse_str(xml_content, filename)
        return {"success": True, "data": topology.to_dict()}
    except TopoParseError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": f"解析异常: {e}"}


# ============================================================
# 简单自测（命令行执行时）
# ============================================================

if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 2:
        result = load_topo(sys.argv[1])
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("用法: python api/ensp_parser.py <path_to_topo_file>")
