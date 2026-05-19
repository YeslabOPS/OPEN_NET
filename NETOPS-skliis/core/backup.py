"""
配置备份模块
支持批量备份多台网络设备的配置文件，按时间戳归档保存
"""

import os
import re
from datetime import datetime
from typing import List, Dict, Optional
from .ssh_client import SSHClient, SSHClientError

BACKUP_COMMANDS = {
    "huawei": "display current-configuration",
    "huawei_vrpv8": "display current-configuration",
    "cisco_ios": "show running-config",
    "cisco_xe": "show running-config",
    "cisco_nxos": "show running-config",
    "cisco_asa": "show running-config",
    "hp_comware": "display current-configuration",
    "hp_procurve": "show running-config",
    "juniper_junos": "show configuration",
    "arista_eos": "show running-config",
    "ruijie": "show running-config",
    "mikrotik_routeros": "/export",
    "linux": "cat /etc/network/interfaces",
}

DEFAULT_BACKUP_DIR = "backups"


class BackupResult:
    def __init__(self, device_info: dict):
        self.device_name = device_info.get("name", "未知设备")
        self.host = device_info["host"]
        self.device_type = device_info["device_type"]
        self.success = False
        self.config_content = ""
        self.filename = ""
        self.error_message = ""
        self.timestamp = datetime.now()

    def to_dict(self) -> dict:
        return {
            "device": self.device_name,
            "host": self.host,
            "device_type": self.device_type,
            "success": self.success,
            "filename": self.filename,
            "error": self.error_message,
            "timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "config_size": len(self.config_content),
        }


class BackupEngine:
    def __init__(self, backup_dir: str = DEFAULT_BACKUP_DIR):
        self.backup_dir = backup_dir
        self.results: List[BackupResult] = []
        self._ensure_backup_dir()

    def _ensure_backup_dir(self):
        if not os.path.isabs(self.backup_dir):
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.backup_dir = os.path.join(base_dir, self.backup_dir)
        os.makedirs(self.backup_dir, exist_ok=True)
        print(f"[*] 备份目录: {self.backup_dir}")

    def _get_backup_command(self, device_type: str) -> str:
        return BACKUP_COMMANDS.get(device_type, "display current-configuration")

    def _generate_filename(self, device_name: str) -> str:
        safe_name = re.sub(r'[\\/*?:"<>|]', "_", device_name)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{safe_name}_{timestamp}.cfg"

    def _sanitize_config(self, config: str, device_type: str) -> str:
        lines = config.splitlines()
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped:
                cleaned_lines.append(line.rstrip())
        header = [
            f"! ====================================================",
            f"! 设备配置备份",
            f"! 备份时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"! 设备类型: {device_type}",
            f"! ====================================================",
            "",
        ]
        return "\n".join(header + cleaned_lines)

    def backup_device(self, device_info: dict) -> BackupResult:
        result = BackupResult(device_info)
        command = self._get_backup_command(device_info["device_type"])
        print(f"\n[{result.device_name}] 正在备份...")
        print(f"  设备: {result.host}")
        print(f"  命令: {command}")

        try:
            with SSHClient(device_info) as client:
                config_output = client.send_command(command)

            result.config_content = self._sanitize_config(config_output, device_info["device_type"])
            result.filename = self._generate_filename(result.device_name)
            filepath = os.path.join(self.backup_dir, result.filename)

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(result.config_content)

            result.success = True
            file_size = len(result.config_content)
            print(f"  [OK] 备份成功 -> {result.filename} ({file_size} 字符)")

        except SSHClientError as e:
            result.success = False
            result.error_message = str(e)
            print(f"  [FAIL] 备份失败: {e}")
        except IOError as e:
            result.success = False
            result.error_message = f"文件写入失败: {e}"
            print(f"  [FAIL] 文件写入失败: {e}")

        return result

    def backup_all(self, devices: List[Dict]) -> List[BackupResult]:
        self.results = []
        total = len(devices)
        print(f"\n{'='*60}")
        print(f"  批量配置备份")
        print(f"  备份目录: {self.backup_dir}")
        print(f"  目标设备: {total} 台")
        print(f"{'='*60}")

        for i, device in enumerate(devices, 1):
            print(f"\n[{i}/{total}] 开始备份...")
            result = self.backup_device(device)
            self.results.append(result)

        self._print_summary()
        return self.results

    def _print_summary(self):
        success_count = sum(1 for r in self.results if r.success)
        fail_count = len(self.results) - success_count
        print(f"\n{'='*60}")
        print(f"  备份汇总报告")
        print(f"{'='*60}")
        print(f"  成功: {success_count}  |  失败: {fail_count}  |  总计: {len(self.results)}")
        print(f"  备份目录: {self.backup_dir}\n")
        for r in self.results:
            status = "[OK]" if r.success else "[FAIL]"
            print(f"  {status} {r.device_name:12} ({r.host:16})", end="")
            if r.success:
                print(f"  -> {r.filename}")
            else:
                print(f"  -> {r.error_message}")
        print(f"{'='*60}\n")

    def generate_report_file(self) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_filename = f"backup_report_{timestamp}.txt"
        report_path = os.path.join(self.backup_dir, report_filename)

        with open(report_path, "w", encoding="utf-8") as f:
            f.write("=" * 60 + "\n")
            f.write(f"  备份汇总报告\n")
            f.write(f"  生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 60 + "\n\n")
            for r in self.results:
                status = "成功" if r.success else "失败"
                f.write(f"设备: {r.device_name} ({r.host})\n")
                f.write(f"类型: {r.device_type}\n")
                f.write(f"状态: {status}\n")
                if r.success:
                    f.write(f"文件: {r.filename}\n")
                    f.write(f"大小: {len(r.config_content)} 字符\n")
                else:
                    f.write(f"错误: {r.error_message}\n")
                f.write("-" * 40 + "\n")

        print(f"[*] 报告已保存: {report_path}")
        return report_path

    def list_backups(self) -> List[str]:
        if not os.path.exists(self.backup_dir):
            return []
        files = [
            f for f in os.listdir(self.backup_dir)
            if f.endswith(".cfg") and os.path.isfile(os.path.join(self.backup_dir, f))
        ]
        return sorted(files, reverse=True)
