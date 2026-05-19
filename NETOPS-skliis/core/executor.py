"""
命令执行器
支持批量连接多台设备、批量执行命令并收集结果
"""

from .ssh_client import SSHClient, SSHClientError
from typing import List, Dict, Optional
import time


class Executor:
    def __init__(self, verbose: bool = True):
        self.verbose = verbose
        self.results = []

    def execute_single(self, device_info: dict, command: str) -> dict:
        result = {
            "device": device_info.get("name", "未知"),
            "host": device_info["host"],
            "command": command,
            "success": False,
            "output": "",
        }
        try:
            with SSHClient(device_info) as client:
                output = client.send_command(command)
                result["success"] = True
                result["output"] = output
                if self.verbose:
                    print(f"\n[OK] {result['device']} 命令执行成功")
        except SSHClientError as e:
            result["output"] = str(e)
            if self.verbose:
                print(f"\n[FAIL] {result['device']} 执行失败: {e}")
        return result

    def execute_multi_commands(self, device_info: dict, commands: List[str]) -> dict:
        result = {
            "device": device_info.get("name", "未知"),
            "host": device_info["host"],
            "commands": commands,
            "success": False,
            "outputs": {},
        }
        try:
            with SSHClient(device_info) as client:
                for cmd in commands:
                    output = client.send_command(cmd)
                    result["outputs"][cmd] = output
                result["success"] = True
                if self.verbose:
                    print(f"[OK] {result['device']} 全部命令执行成功")
        except SSHClientError as e:
            if self.verbose:
                print(f"[FAIL] {result['device']} 执行失败: {e}")
            for cmd in commands:
                if cmd not in result["outputs"]:
                    result["outputs"][cmd] = str(e)
        return result

    def batch_execute(self, devices: List[Dict], command: str) -> List[Dict]:
        results = []
        total = len(devices)
        print(f"\n{'='*60}")
        print(f"批量执行命令: {command}")
        print(f"目标设备: {total} 台")
        print(f"{'='*60}")

        for i, device in enumerate(devices, 1):
            print(f"\n[{i}/{total}] 正在处理 {device.get('name', device['host'])} ...")
            if i > 1:
                time.sleep(0.5)
            result = self.execute_single(device, command)
            results.append(result)

        self._print_summary(results)
        return results

    def _print_summary(self, results: List[Dict]):
        success_count = sum(1 for r in results if r["success"])
        fail_count = len(results) - success_count
        print(f"\n{'='*60}")
        print(f"执行汇总")
        print(f"{'='*60}")
        print(f"成功: {success_count} | 失败: {fail_count} | 总计: {len(results)}")
        if fail_count > 0:
            print("\n失败设备:")
            for r in results:
                if not r["success"]:
                    print(f"  - {r['device']} ({r['host']}): {r['output']}")
        print(f"{'='*60}\n")
