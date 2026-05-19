"""
设备配置加载模块
从 YAML 文件中读取设备清单信息
"""

import yaml
import os
from typing import List, Dict, Optional


def load_devices(config_path: Optional[str] = None) -> List[Dict]:
    """
    从 YAML 配置文件加载设备列表

    Args:
        config_path: 配置文件路径，默认为项目 config/devices.yaml

    Returns:
        设备信息字典列表

    Raises:
        FileNotFoundError: 配置文件不存在
        yaml.YAMLError: YAML 格式错误
    """
    if config_path is None:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        config_path = os.path.join(base_dir, "config", "devices.yaml")

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"设备配置文件不存在: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    devices = data.get("devices", [])
    if not devices:
        print("[警告] 设备清单为空，请检查配置文件。")

    global_settings = data.get("global_settings", {})

    for device in devices:
        for key, value in global_settings.items():
            if key not in device:
                device[key] = value

    return devices


def get_device_by_name(devices: List[Dict], name: str) -> Optional[Dict]:
    """按设备名称查找设备"""
    for device in devices:
        if device.get("name") == name:
            return device
    return None


def print_device_summary(devices: List[Dict]) -> None:
    """打印设备清单摘要"""
    print(f"\n{'='*60}")
    print(f"{'设备名称':<20} {'IP地址':<16} {'类型':<15}")
    print(f"{'='*60}")
    for dev in devices:
        print(
            f"{dev.get('name', 'N/A'):<20} "
            f"{dev.get('host', 'N/A'):<16} "
            f"{dev.get('device_type', 'N/A'):<15}"
        )
    print(f"{'='*60}")
    print(f"共 {len(devices)} 台设备\n")


if __name__ == "__main__":
    try:
        devices = load_devices()
        print_device_summary(devices)
    except Exception as e:
        print(f"[错误] {e}")
