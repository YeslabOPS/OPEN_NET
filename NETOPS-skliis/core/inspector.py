"""
自动化巡检引擎
整合 SSH 连接、配置备份、配置对比、连通性检测，生成综合巡检报告
"""

import os
import json
import re
import time
import platform
from datetime import datetime
from typing import List, Dict, Optional

from .ssh_client import SSHClient, SSHClientError
from .device_loader import load_devices
from .backup import BackupEngine
from .differ import ConfigDiffer
from .checker import ConnectivityChecker
from .executor import Executor


# 不同设备类型的巡检命令
INSPECT_COMMANDS = {
    "huawei": {
        "version": "display version",
        "sysname": "display current-configuration | include sysname",
        "uptime": "display version",
        "interface": "display interface brief",
        "vlan": "display vlan",
        "mac": "display mac-address",
        "arp": "display arp",
        "cpu": "display cpu-usage",
        "memory": "display memory-usage",
    },
    "cisco_ios": {
        "version": "show version",
        "sysname": "show running-config | include hostname",
        "uptime": "show version",
        "interface": "show ip interface brief",
        "vlan": "show vlan brief",
        "mac": "show mac address-table",
        "arp": "show arp",
        "cpu": "show process cpu sorted",
        "memory": "show memory statistics",
    },
}

# 默认的巡检命令（用于未列出的设备类型）
DEFAULT_COMMANDS = {
    "version": "display version",
    "interface": "display interface brief",
}


class DeviceInspectResult:
    """单台设备的巡检结果"""
    def __init__(self, device_info: dict):
        self.device_name = device_info.get("name", "未知设备")
        self.host = device_info["host"]
        self.device_type = device_info["device_type"]
        self.connected = False
        self.version = ""
        self.uptime = ""
        self.sysname = ""
        self.interface_count = 0
        self.interface_up = 0
        self.vlan_count = 0
        self.cpu_usage = ""
        self.memory_usage = ""
        self.backup_file = ""
        self.backup_success = False
        self.ping_ok = False
        self.ping_rtt = 0.0
        self.ssh_port_ok = False
        self.config_changed = False
        self.diff_summary = ""
        self.errors: List[str] = []
        self.extra_outputs: List[str] = []

    @property
    def health_score(self) -> int:
        """健康评分 (0-100)"""
        score = 100
        if not self.connected:
            score -= 50
        if not self.ping_ok:
            score -= 20
        if not self.ssh_port_ok:
            score -= 15
        if not self.backup_success:
            score -= 10
        if self.config_changed:
            score -= 5
        if self.errors:
            score -= len(self.errors) * 5
        return max(0, score)

    def to_dict(self) -> dict:
        return {
            "device": self.device_name,
            "host": self.host,
            "type": self.device_type,
            "connected": self.connected,
            "version": self.version,
            "uptime": self.uptime,
            "sysname": self.sysname,
            "interface_count": self.interface_count,
            "interface_up": self.interface_up,
            "vlan_count": self.vlan_count,
            "cpu": self.cpu_usage,
            "memory": self.memory_usage,
            "backup_success": self.backup_success,
            "backup_file": self.backup_file,
            "ping_ok": self.ping_ok,
            "ping_rtt": self.ping_rtt,
            "ssh_port_ok": self.ssh_port_ok,
            "config_changed": self.config_changed,
            "diff_summary": self.diff_summary,
            "health_score": self.health_score,
            "errors": self.errors,
            "extra_outputs": self.extra_outputs,
        }


class Inspector:
    """
    自动化巡检引擎

    一次巡检会执行：
    1. 连通性检测 (Ping + SSH端口)
    2. SSH 连接，收集设备信息（版本、接口、CPU等）
    3. 备份配置
    4. 配置变更检测（对比历史备份）
    5. 生成综合巡检报告
    """

    def __init__(self, output_dir: str = "reports", template_file: str = None):
        self.output_dir = output_dir
        self._ensure_output_dir()
        self.backup_engine = BackupEngine()
        self.checker = ConnectivityChecker(verbose=False)
        self.differ = ConfigDiffer()
        self.results: List[DeviceInspectResult] = []
        # 加载额外命令（逗号分隔的模板）
        self.extra_commands: List[str] = []
        if template_file and os.path.exists(template_file):
            try:
                with open(template_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                cmds_str = data.get("commands", "")
                if cmds_str:
                    self.extra_commands = [c.strip() for c in cmds_str.split(",") if c.strip()]
            except Exception:
                pass

    def _ensure_output_dir(self):
        if not os.path.isabs(self.output_dir):
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.output_dir = os.path.join(base_dir, self.output_dir)
        os.makedirs(self.output_dir, exist_ok=True)

    def _get_commands(self, device_type: str) -> dict:
        """获取设备类型的巡检命令"""
        # 精确匹配
        if device_type in INSPECT_COMMANDS:
            return INSPECT_COMMANDS[device_type]
        # 前缀匹配（如 huawei_vrpv8 -> huawei、cisco_xe -> cisco_ios）
        for key in INSPECT_COMMANDS:
            if device_type.startswith(key) or key.startswith(device_type):
                return INSPECT_COMMANDS[key]
        # 末尾匹配（如 cisco_xe 需要匹配 cisco_ios）
        for key in INSPECT_COMMANDS:
            key_prefix = key.split('_')[0]
            dev_prefix = device_type.split('_')[0]
            if key_prefix == dev_prefix:
                return INSPECT_COMMANDS[key]
        return DEFAULT_COMMANDS

    def _parse_version(self, output: str, device_type: str) -> str:
        """从 version 输出中提取版本信息"""
        lines = output.splitlines()
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            # 华为: "VRP (R) software, Version 8.180..."
            if "version" in stripped.lower() and "software" in stripped.lower():
                return stripped
            # 思科: "Cisco IOS Software, ... Version 15.2..."
            if "cisco" in stripped.lower() and "software" in stripped.lower():
                return stripped
        # 取第一行非空
        for line in lines:
            if line.strip():
                return line.strip()
        return "未知"

    def _parse_uptime(self, output: str, device_type: str) -> str:
        """从 version 输出中提取 uptime"""
        lines = output.splitlines()
        for line in lines:
            if "uptime" in line.lower():
                return line.strip()
        return ""

    def _parse_sysname(self, output: str, device_type: str) -> str:
        """从 sysname 命令输出提取主机名"""
        for line in output.splitlines():
            stripped = line.strip()
            # 华为: sysname HUAWEI
            # 思科: hostname Router
            if stripped.startswith("sysname") or stripped.startswith("hostname"):
                return stripped
        return ""

    def _parse_interface_stats(self, output: str, device_type: str) -> tuple:
        """统计接口数量和 UP 数量"""
        total = 0
        up = 0
        for line in output.splitlines():
            stripped = line.strip()
            # 跳过标题行和分隔线
            if not stripped or stripped.startswith("-") or "Interface" in stripped or "Protocol" in stripped:
                continue
            # 华为: "GigabitEthernet0/0/0    up     up       ..."
            # 思科: "GigabitEthernet0/0      10.0.0.1 YES NVRAM up"
            if stripped.startswith(("Gigabit", "Fast", "Ethernet", "Loop", "Vlanif", "Vlan", "NULL",
                                     "10GE", "25GE", "40GE", "100GE", "Eth", "XGE",
                                     "Serial", "Tunnel", "Port-channel", "Port-Channel",
                                     "Management", "Mgmt", "FortyGigabit", "HundredGigE",
                                     "TwentyFiveGigE", "TenGigabitEthernet", "AppGigabitEthernet",
                                     "Virtual-Access", "Dialer", "Cellular", "Async", "Wlan",
                                     "Wlan-Radio", "M-Ethernet", "MTunnel")):
                total += 1
                if " up" in stripped.lower() or "up" in [s.lower() for s in stripped.split()[:3]]:
                    up += 1
        return total, up

    def _parse_vlan_count(self, output: str) -> int:
        """统计 VLAN 数量"""
        count = 0
        for line in output.splitlines():
            stripped = line.strip()
            if stripped and stripped[0].isdigit():
                # 华为/思科 VLAN 列表行以数字开头
                parts = stripped.split()
                if parts and parts[0].isdigit():
                    count += 1
        return count

    def _parse_cpu(self, output: str) -> str:
        """提取 CPU 使用率"""
        # 华为: "CPU Usage: 5%"
        match = re.search(r"CPU\s*Usage\s*[:：]\s*(\d+)%", output, re.IGNORECASE)
        if match:
            return f"{match.group(1)}%"
        # 其他格式：找第一个百分比数字
        match = re.search(r"(\d+)%\s*(?:总)?", output)
        if match:
            return f"{match.group(1)}%"
        return ""

    def _parse_memory(self, output: str) -> str:
        """提取内存使用信息"""
        # 华为: "Memory Usage: 30%"
        match = re.search(r"Memory\s*Usage\s*[:：]\s*(\d+)%", output, re.IGNORECASE)
        if match:
            return f"{match.group(1)}%"
        return ""

    def inspect_device(self, device_info: dict) -> DeviceInspectResult:
        """
        巡检单台设备

        Args:
            device_info: 设备信息

        Returns:
            DeviceInspectResult 巡检结果
        """
        result = DeviceInspectResult(device_info)
        name = result.device_name
        host = device_info["host"]

        print(f"\n[{name}] 开始巡检...", end="")

        # ======== 步骤1: Ping 检测 ========
        ping = self.checker.ping(host, count=2)
        result.ping_ok = ping.success
        result.ping_rtt = ping.rtt_ms
        print(" P" if ping.success else " p", end="")

        # ======== 步骤2: 端口检测（根据协议自动选择目标端口） ========
        proto = device_info.get("protocol", "").lower()
        dev_port = device_info.get("port", 22)
        # Telnet 设备: 检测实际 Telnet 端口；SSH 设备: 检测端口 22
        check_port = 22 if (proto != "telnet" and dev_port != 23) else int(dev_port)
        tcp = self.checker.check_tcp_port(host, check_port, timeout=3)
        result.ssh_port_ok = tcp.success
        label = "T" if check_port != 22 else "S"
        print(label if tcp.success else label.lower(), end="")

        if not tcp.success:
            result.errors.append(f"{'Telnet' if check_port != 22 else 'SSH'} 端口 {check_port} 不通")
            print(" [跳过]")
            return result

        # ======== 步骤3: SSH 连接采集信息 ========
        commands = self._get_commands(device_info["device_type"])

        try:
            with SSHClient(device_info) as client:
                result.connected = True
                print(" H", end="")

                # 执行各巡检命令
                for key in ["version", "sysname", "interface", "vlan", "cpu", "memory"]:
                    cmd = commands.get(key, "")
                    if not cmd:
                        continue
                    try:
                        output = client.send_command(cmd)

                        if key == "version":
                            result.version = self._parse_version(output, device_info["device_type"])
                            result.uptime = self._parse_uptime(output, device_info["device_type"])
                        elif key == "sysname":
                            result.sysname = self._parse_sysname(output, device_info["device_type"])
                        elif key == "interface":
                            total, up = self._parse_interface_stats(output, device_info["device_type"])
                            result.interface_count = total
                            result.interface_up = up
                        elif key == "vlan":
                            result.vlan_count = self._parse_vlan_count(output)
                        elif key == "cpu":
                            result.cpu_usage = self._parse_cpu(output)
                        elif key == "memory":
                            result.memory_usage = self._parse_memory(output)
                    except SSHClientError:
                        pass

                    print(".", end="")

                # 额外命令（用户自定义模板）
                for extra_cmd in self.extra_commands:
                    try:
                        extra_out = client.send_command(extra_cmd)
                        result.extra_outputs.append(f">>> {extra_cmd}\n{extra_out}")
                        print("E", end="")
                    except SSHClientError:
                        pass

        except SSHClientError as e:
            result.errors.append(f"SSH 连接失败: {str(e)}")
            print(" [FAIL]")
            return result

        # ======== 步骤4: 配置备份 ========
        try:
            backup_result = self.backup_engine.backup_device(device_info)
            result.backup_success = backup_result.success
            result.backup_file = backup_result.filename
            print("B", end="")
        except Exception as e:
            result.errors.append(f"备份失败: {e}")
            print("b", end="")

        # ======== 步骤5: 配置变更检测 ========
        if result.backup_success:
            # 查找该设备的上一份备份（除当前这份外）
            all_backups = self.backup_engine.list_backups()
            device_backups = [f for f in all_backups if name in f and f != result.backup_file]
            if device_backups:
                try:
                    old_backup = os.path.join(self.backup_engine.backup_dir, device_backups[0])
                    new_backup = os.path.join(self.backup_engine.backup_dir, result.backup_file)
                    diff = self.differ.compare_files(old_backup, new_backup)
                    result.config_changed = diff.has_changes
                    if diff.has_changes:
                        added = diff.added_lines
                        removed = diff.removed_lines
                        changed = diff.changed_lines
                        result.diff_summary = f"+{added} / -{removed} / ~{changed}"
                    else:
                        result.diff_summary = "无变更"
                except Exception as e:
                    result.diff_summary = f"对比失败: {e}"

        print(" [完成]")
        return result

    def inspect_all(self, devices: List[Dict], max_workers: int = 5) -> List[DeviceInspectResult]:
        """巡检所有设备（并行执行）

        Args:
            devices: 设备列表
            max_workers: 最大并行数，默认 5

        Returns:
            巡检结果列表
        """
        total = len(devices)
        print(f"\n{'='*60}")
        print(f"  自动化巡检 - 开始")
        print(f"  设备数量: {total} 台")
        print(f"  并行数: {min(max_workers, total)}")
        print(f"  开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  巡检目录: {self.output_dir}")
        print(f"{'='*60}\n")

        self.results = []
        start_time = time.time()

        from concurrent.futures import ThreadPoolExecutor, as_completed
        workers = min(max_workers, total)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_map = {executor.submit(self.inspect_device, device): device for device in devices}
            for future in as_completed(future_map):
                device = future_map[future]
                try:
                    result = future.result()
                    self.results.append(result)
                except Exception as e:
                    result = DeviceInspectResult(device)
                    result.errors.append(f"巡检异常: {str(e)}")
                    self.results.append(result)
                    print(f"\n[{device.get('name', '?')}] 巡检失败: {e}")

        elapsed = time.time() - start_time
        self._print_summary(elapsed)
        self.generate_report()
        return self.results

    def _print_summary(self, elapsed: float):
        """打印巡检汇总"""
        total = len(self.results)
        ok = sum(1 for r in self.results if r.connected)
        fail = total - ok

        avg_score = sum(r.health_score for r in self.results) / max(total, 1)

        print(f"\n{'='*60}")
        print(f"  巡检汇总")
        print(f"{'='*60}")
        print(f"  总耗时: {elapsed:.1f} 秒")
        print(f"  连接成功: {ok}  |  失败: {fail}  |  总计: {total}")
        print(f"  平均健康分: {avg_score:.0f}/100")
        print()

        for r in self.results:
            score = r.health_score
            if score >= 80:
                grade = "优"
            elif score >= 60:
                grade = "良"
            else:
                grade = "差"
            print(f"  [{'OK' if r.connected else 'XX'}] {r.device_name:12} ({r.host:16}) "
                  f"健康分={score:3d}({grade}) ", end="")
            if r.config_changed:
                print("变更", end="")
            print()

        print(f"{'='*60}\n")

    def generate_report(self) -> str:
        """生成优化后的巡检报告文件"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"inspect_report_{timestamp}.txt"
        filepath = os.path.join(self.output_dir, filename)

        S = "="  # 分隔符
        total = len(self.results)
        ok_count = sum(1 for r in self.results if r.connected)
        avg_score = sum(r.health_score for r in self.results) / max(total, 1)

        with open(filepath, "w", encoding="utf-8") as f:
            # ====== 报头 ======
            f.write(f"{S*66}\n")
            f.write(f"   网络设备自动化巡检报告\n")
            f.write(f"{S*66}\n")
            f.write(f"   生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"   运行环境: {platform.system()} {platform.release()}\n")
            f.write(f"{S*66}\n\n")

            # ====== 汇总看板 ======
            f.write(f"  ┌─{'─'*40}─┐\n")
            f.write(f"  │ {'健康评分汇总看板'.center(38)} │\n")
            f.write(f"  ├─{'─'*40}─┤\n")
            f.write(f"  │ 设备总数: {str(total).rjust(3)} 台")
            f.write(f"  │ 在线: {str(ok_count).rjust(3)} 台")
            f.write(f"  │ 离线: {str(total - ok_count).rjust(3)} 台  │\n")
            f.write(f"  │ 平均健康分: {f'{avg_score:.0f}'.rjust(3)}/100")
            f.write(f"  │ {'优秀':>4}: {sum(1 for r in self.results if r.health_score >= 80):>2}台")
            f.write(f"  │ {'良好':>4}: {sum(1 for r in self.results if 60 <= r.health_score < 80):>2}台")
            f.write(f"  │ {'较差':>4}: {sum(1 for r in self.results if r.health_score < 60):>2}台 │\n")
            f.write(f"  └─{'─'*40}─┘\n\n")

            # 健康条
            bar_len = 40
            excellent = int(sum(1 for r in self.results if r.health_score >= 80) / max(total, 1) * bar_len)
            good = int(sum(1 for r in self.results if 60 <= r.health_score < 80) / max(total, 1) * bar_len)
            poor = bar_len - excellent - good
            f.write(f"   健康分布: ")
            f.write(f"{'█' * excellent}{'▓' * good}{'░' * poor}")
            f.write(f"  (优{'█'}{excellent*100//max(bar_len,1):d}% ")
            f.write(f"良{'▓'}{good*100//max(bar_len,1):d}% ")
            f.write(f"差{'░'}{poor*100//max(bar_len,1):d}%)\n\n")

            # ====== 各设备详情 ======
            for r in self.results:
                score = r.health_score
                if score >= 80: grade = "优秀"
                elif score >= 60: grade = "良好"
                else: grade = "较差"

                # 健康条
                s_bar = int(score / 100 * 30)
                health_bar = f"{'█' * s_bar}{'░' * (30 - s_bar)} {score:3d}/100"

                f.write(f"{S*66}\n")
                f.write(f"  设备: {r.device_name}  ({r.host})\n")
                f.write(f"  类型: {r.device_type}  |  健康: {health_bar} [{grade}]\n")
                f.write(f"{S*66}\n")

                f.write(f"\n  {'[连通性]':-<40}\n")
                f.write(f"    Ping:\t  {'[OK]' if r.ping_ok else '[FAIL]'}  "
                        f"{f'延迟={r.ping_rtt:.1f}ms' if r.ping_ok else '不通'}\n")
                f.write(f"    SSH(22):\t  {'[OK]' if r.ssh_port_ok else '[FAIL]'}  "
                        f"{'开放' if r.ssh_port_ok else '关闭'}\n")

                f.write(f"\n  {'[系统信息]':-<40}\n")
                f.write(f"    连接状态:\t  {'成功' if r.connected else '失败'}\n")
                if r.sysname: f.write(f"    主机名:\t  {r.sysname}\n")
                if r.version: f.write(f"    版本:\t  {r.version}\n")
                if r.uptime: f.write(f"    运行时间:\t  {r.uptime}\n")

                f.write(f"\n  {'[接口信息]':-<40}\n")
                f.write(f"    接口总数:\t  {r.interface_count}\n")
                f.write(f"    UP 接口:\t  {r.interface_up}\n")
                if r.interface_count > 0:
                    ratio = r.interface_up / r.interface_count * 100
                    bar_if = int(ratio / 100 * 20)
                    f.write(f"    UP 比例:\t  {'█' * bar_if}{'░' * (20 - bar_if)} {ratio:.0f}%\n")
                if r.vlan_count > 0: f.write(f"    VLAN 数:\t  {r.vlan_count}\n")

                if r.cpu_usage or r.memory_usage:
                    f.write(f"\n  {'[资源使用]':-<40}\n")
                    if r.cpu_usage:
                        try:
                            cpu_val = int(r.cpu_usage.replace('%', ''))
                            bar_cpu = int(cpu_val / 100 * 20)
                            f.write(f"    CPU:\t  {'█' * bar_cpu}{'░' * (20 - bar_cpu)} {r.cpu_usage}\n")
                        except:
                            f.write(f"    CPU:\t  {r.cpu_usage}\n")
                    if r.memory_usage:
                        try:
                            mem_val = int(r.memory_usage.replace('%', ''))
                            bar_mem = int(mem_val / 100 * 20)
                            f.write(f"    内存:\t  {'█' * bar_mem}{'░' * (20 - bar_mem)} {r.memory_usage}\n")
                        except:
                            f.write(f"    内存:\t  {r.memory_usage}\n")

                f.write(f"\n  {'[备份/配置]':-<40}\n")
                f.write(f"    配置备份:\t  {'[OK]' if r.backup_success else '[FAIL]'}\n")
                if r.backup_file: f.write(f"    备份文件:\t  {r.backup_file}\n")
                f.write(f"    配置变更:\t  {'有变更' if r.config_changed else '无变更'}\n")
                if r.diff_summary: f.write(f"    变更详情:\t  {r.diff_summary}\n")

                if r.errors:
                    f.write(f"\n  {'[错误]':-<40}\n")
                    for err in r.errors:
                        f.write(f"    ! {err}\n")

                if r.extra_outputs:
                    f.write(f"\n  {'[额外命令输出]':-<40}\n")
                    for out in r.extra_outputs:
                        lines = out.split('\n', 1)
                        f.write(f"    >> {lines[0]}\n")
                        if len(lines) > 1:
                            for l in lines[1].split('\n'):
                                f.write(f"       {l}\n")

                f.write("\n")

            # ====== 尾部汇总 ======
            f.write(f"{S*66}\n")
            f.write(f"  报告结束\n")
            f.write(f"{S*66}\n")
            f.write(f"  共 {total} 台设备  |  正常: {ok_count}  |  异常: {total - ok_count}\n")
            f.write(f"  平均健康分: {avg_score:.0f}/100\n")
            f.write(f"  评分分布: 优秀 {sum(1 for r in self.results if r.health_score >= 80)}台")
            f.write(f"  良好 {sum(1 for r in self.results if 60 <= r.health_score < 80)}台")
            f.write(f"  较差 {sum(1 for r in self.results if r.health_score < 60)}台\n")
            f.write(f"{S*66}\n")

        print(f"[*] 巡检报告已保存: {filepath}")
        return filepath


# 测试
if __name__ == "__main__":
    print("巡检引擎模块加载成功")
