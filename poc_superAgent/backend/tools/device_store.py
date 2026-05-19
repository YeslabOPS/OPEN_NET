"""设备存储 - JSON 文件持久化"""
import json
import os
import uuid
import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)

DEVICE_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "devices.json",
)


class DeviceStore:
    """设备存储"""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DEVICE_DB_PATH
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._ensure_db()
    
    def _ensure_db(self):
        """确保数据库文件存在"""
        if not os.path.exists(self.db_path):
            self._save([])
    
    def _load(self) -> list[dict]:
        """加载设备列表"""
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []
    
    def _save(self, devices: list[dict]):
        """保存设备列表"""
        with open(self.db_path, "w", encoding="utf-8") as f:
            json.dump(devices, f, ensure_ascii=False, indent=2)
    
    def list(self) -> list[dict]:
        """列出所有设备"""
        return self._load()
    
    def get(self, device_id: str) -> Optional[dict]:
        """获取单个设备"""
        for d in self._load():
            if d["id"] == device_id:
                return d
        return None
    
    def add(self, device: dict) -> dict:
        """添加设备"""
        devices = self._load()
        
        new_device = {
            "id": str(uuid.uuid4()),
            "name": device.get("name", ""),
            "host": device.get("host", ""),
            "port": device.get("port", 22),
            "username": device.get("username", ""),
            "password": device.get("password", ""),
            "key_path": device.get("key_path", ""),
            "device_type": device.get("device_type", "router"),
            "description": device.get("description", ""),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        
        devices.append(new_device)
        self._save(devices)
        logger.info(f"Device added: {new_device['name']} ({new_device['host']})")
        
        return new_device
    
    def update(self, device_id: str, updates: dict) -> Optional[dict]:
        """更新设备"""
        devices = self._load()
        for i, d in enumerate(devices):
            if d["id"] == device_id:
                # 不允许修改 id 和 created_at
                for key in ["name", "host", "port", "username", "password",
                           "key_path", "device_type", "description"]:
                    if key in updates:
                        d[key] = updates[key]
                d["updated_at"] = datetime.now().isoformat()
                devices[i] = d
                self._save(devices)
                logger.info(f"Device updated: {d['name']}")
                return d
        return None
    
    def delete(self, device_id: str) -> bool:
        """删除设备"""
        devices = self._load()
        for i, d in enumerate(devices):
            if d["id"] == device_id:
                removed = devices.pop(i)
                self._save(devices)
                logger.info(f"Device deleted: {removed['name']}")
                return True
        return False


# 全局实例
device_store = DeviceStore()
