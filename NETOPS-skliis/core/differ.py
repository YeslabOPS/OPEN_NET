"""
配置对比模块
支持对两份配置文件进行行级差异对比，生成可读的 diff 报告
"""

import difflib
import os
import re
from datetime import datetime
from typing import List, Tuple, Optional

from .ssh_client import SSHClient, SSHClientError
from .backup import BackupEngine, BACKUP_COMMANDS


class DiffResult:
    """一次配置对比的结果"""

    def __init__(self, old_name: str, new_name: str):
        self.old_name = old_name          # 旧配置标识
        self.new_name = new_name          # 新配置标识
        self.timestamp = datetime.now()
        self.old_lines = 0                # 旧配置行数
        self.new_lines = 0                # 新配置行数
        self.added_lines = 0              # 新增行数
        self.removed_lines = 0            # 删除行数
        self.changed_lines = 0            # 变更块数
        self.diff_lines: List[str] = []   # diff 内容
        self.error_message = ""

    @property
    def has_changes(self) -> bool:
        return self.added_lines > 0 or self.removed_lines > 0

    def print_summary(self):
        print(f"\n{'='*60}")
        print(f"  对比结果汇总")
        print(f"{'='*60}")
        print(f"  旧配置: {self.old_name}")
        print(f"  新配置: {self.new_name}")
        print(f"  时间:   {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}")

        if not self.has_changes:
            print(f"\n  [相同] 两份配置文件完全一致，无变更。")
        else:
            print(f"\n  [+] 新增: {self.added_lines} 行")
            print(f"  [-] 删除: {self.removed_lines} 行")
            print(f"  [~] 变更块: {self.changed_lines} 处")
        print(f"{'='*60}\n")

    def print_diff(self, max_lines: int = 50):
        """打印 diff 内容（可限制行数）"""
        if not self.diff_lines:
            print("无差异内容。")
            return

        print(f"\n{'='*60}")
        print(f"  Diff 差异明细 (前 {max_lines} 行)")
        print(f"{'='*60}")
        for line in self.diff_lines[:max_lines]:
            print(line)

        if len(self.diff_lines) > max_lines:
            print(f"... (剩余 {len(self.diff_lines) - max_lines} 行省略)")
        print(f"{'='*60}\n")


class ConfigDiffer:
    """
    配置对比器

    功能:
    - 对比两个配置文件（本地文件）
    - 对比当前设备配置与历史备份
    - 生成 diff 报告文件
    """

    def __init__(self):
        self.backup_engine = BackupEngine()

    @staticmethod
    def _read_file(filepath: str) -> List[str]:
        """读取文件内容，按行返回"""
        with open(filepath, "r", encoding="utf-8") as f:
            return f.readlines()

    @staticmethod
    def _normalize_lines(lines: List[str]) -> List[str]:
        """
        规范化行：去除首尾空白，过滤空行和注释头

        Args:
            lines: 原始行列表

        Returns:
            规范化后的行列表
        """
        cleaned = []
        for line in lines:
            stripped = line.strip()
            # 跳过纯空行
            if not stripped:
                continue
            # 去掉备份引擎添加的信息头（所有以"!"开头的注释行）
            if stripped.startswith("!"):
                continue
            cleaned.append(stripped)
        return cleaned

    def compare_files(self, old_file: str, new_file: str) -> DiffResult:
        """
        对比两个本地配置文件

        Args:
            old_file: 旧配置文件路径
            new_file: 新配置文件路径

        Returns:
            DiffResult 对比结果
        """
        result = DiffResult(
            os.path.basename(old_file),
            os.path.basename(new_file),
        )

        try:
            old_lines = self._normalize_lines(self._read_file(old_file))
            new_lines = self._normalize_lines(self._read_file(new_file))

            result.old_lines = len(old_lines)
            result.new_lines = len(new_lines)

            # 使用 difflib 生成统一 diff
            diff = list(difflib.unified_diff(
                old_lines, new_lines,
                fromfile=os.path.basename(old_file),
                tofile=os.path.basename(new_file),
                lineterm="",
            ))

            # 统计变更
            for line in diff:
                if line.startswith("+"):
                    result.added_lines += 1
                elif line.startswith("-"):
                    result.removed_lines += 1

            # 统计变更块数（以 @@ 开头的行）
            result.changed_lines = sum(1 for line in diff if line.startswith("@@"))

            result.diff_lines = diff

        except FileNotFoundError as e:
            result.error_message = f"文件不存在: {e}"
        except Exception as e:
            result.error_message = str(e)

        return result

    def compare_device_vs_backup(self, device_info: dict, backup_file: str) -> DiffResult:
        """
        对比设备当前配置与历史备份文件

        Args:
            device_info: 设备信息
            backup_file: 历史备份文件路径

        Returns:
            DiffResult 对比结果
        """
        result = DiffResult(
            os.path.basename(backup_file),
            f"{device_info.get('name', '设备')}_当前配置",
        )

        try:
            # 1. 读取历史备份
            backup_lines = self._normalize_lines(self._read_file(backup_file))
            result.old_lines = len(backup_lines)

            # 2. 通过 SSH 获取设备当前配置
            device_type = device_info["device_type"]
            command = BACKUP_COMMANDS.get(device_type, "display current-configuration")

            with SSHClient(device_info) as client:
                raw_config = client.send_command(command)

            current_lines = self._normalize_lines(raw_config.splitlines())
            result.new_lines = len(current_lines)

            # 3. 对比
            diff = list(difflib.unified_diff(
                backup_lines, current_lines,
                fromfile=os.path.basename(backup_file),
                tofile=f"{device_info.get('name', 'device')}_current",
                lineterm="",
            ))

            for line in diff:
                if line.startswith("+"):
                    result.added_lines += 1
                elif line.startswith("-"):
                    result.removed_lines += 1

            result.changed_lines = sum(1 for line in diff if line.startswith("@@"))
            result.diff_lines = diff

        except SSHClientError as e:
            result.error_message = f"SSH 连接失败: {e}"
        except FileNotFoundError as e:
            result.error_message = f"备份文件不存在: {e}"
        except Exception as e:
            result.error_message = str(e)

        return result

    def generate_diff_report(self, result: DiffResult, output_dir: str = None) -> Optional[str]:
        """
        生成 diff 报告文件

        Args:
            result: 对比结果
            output_dir: 输出目录，默认备份目录

        Returns:
            报告文件路径，失败返回 None
        """
        if output_dir is None:
            output_dir = self.backup_engine.backup_dir

        os.makedirs(output_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_name = f"diff_report_{timestamp}.txt"
        report_path = os.path.join(output_dir, report_name)

        try:
            with open(report_path, "w", encoding="utf-8") as f:
                f.write("=" * 60 + "\n")
                f.write(f"  配置变更对比报告\n")
                f.write(f"  生成时间: {result.timestamp.strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("=" * 60 + "\n\n")

                f.write(f"旧配置: {result.old_name}\n")
                f.write(f"新配置: {result.new_name}\n\n")

                if not result.has_changes:
                    f.write("两份配置文件完全一致，无变更。\n")
                else:
                    f.write(f"[+] 新增: {result.added_lines} 行\n")
                    f.write(f"[-] 删除: {result.removed_lines} 行\n")
                    f.write(f"[~] 变更块: {result.changed_lines} 处\n\n")

                    f.write("Diff 差异明细:\n")
                    f.write("-" * 40 + "\n")
                    for line in result.diff_lines:
                        f.write(line + "\n")

            print(f"[*] 报告已保存: {report_path}")
            return report_path

        except IOError as e:
            print(f"[FAIL] 报告写入失败: {e}")
            return None

    @staticmethod
    def find_latest_backup(backup_dir: str = None) -> Optional[str]:
        """
        查找最新的备份文件

        Args:
            backup_dir: 备份目录，默认使用 BackupEngine 的默认目录

        Returns:
            最新的 .cfg 文件路径，没有则返回 None
        """
        if backup_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            backup_dir = os.path.join(base_dir, "backups")

        if not os.path.exists(backup_dir):
            return None

        cfg_files = [
            os.path.join(backup_dir, f)
            for f in os.listdir(backup_dir)
            if f.endswith(".cfg") and os.path.isfile(os.path.join(backup_dir, f))
        ]

        if not cfg_files:
            return None

        return max(cfg_files, key=os.path.getmtime)

    @staticmethod
    def list_backup_files(backup_dir: str = None) -> List[str]:
        """列出备份目录下所有 .cfg 文件"""
        if backup_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            backup_dir = os.path.join(base_dir, "backups")

        if not os.path.exists(backup_dir):
            return []

        files = [
            f for f in os.listdir(backup_dir)
            if f.endswith(".cfg") and os.path.isfile(os.path.join(backup_dir, f))
        ]
        return sorted(files, reverse=True)


# 测试
if __name__ == "__main__":
    print("配置对比模块加载成功")
