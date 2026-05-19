"""
网络连通性检测模块
支持 Ping、TCP 端口检测、DNS 解析等常用网络诊断功能
"""

import subprocess
import socket
import os
import platform
import re
from datetime import datetime
from typing import List, Dict, Optional, Tuple


class PingResult:
    """Ping 检测结果"""
    def __init__(self, target: str, description: str = ""):
        self.target = target
        self.description = description
        self.success = False
        self.rtt_ms = 0.0          # 平均延迟 (ms)
        self.packet_loss = 100      # 丢包率 (%)
        self.error_message = ""

    def __str__(self):
        if self.success:
            return f"[OK] {self.target:20} 延迟={self.rtt_ms:.1f}ms  丢包={self.packet_loss:.0f}%"
        else:
            return f"[FAIL] {self.target:20} {self.error_message}"

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "description": self.description,
            "success": self.success,
            "rtt_ms": self.rtt_ms,
            "packet_loss": self.packet_loss,
            "error": self.error_message,
        }


class TcpResult:
    """TCP 端口检测结果"""
    def __init__(self, target: str, port: int, description: str = ""):
        self.target = target
        self.port = port
        self.description = description
        self.success = False
        self.rtt_ms = 0.0
        self.error_message = ""

    def __str__(self):
        status = "开放" if self.success else "关闭"
        return f"[{'OK' if self.success else 'FAIL'}] {self.target:20}:{self.port:<5} {status}"

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "port": self.port,
            "description": self.description,
            "success": self.success,
            "rtt_ms": self.rtt_ms,
            "error": self.error_message,
        }


class DnsResult:
    """DNS 解析结果"""
    def __init__(self, hostname: str):
        self.hostname = hostname
        self.success = False
        self.ip_address = ""
        self.error_message = ""

    def __str__(self):
        if self.success:
            return f"[OK] {self.hostname:25} -> {self.ip_address}"
        else:
            return f"[FAIL] {self.hostname:25} {self.error_message}"


class ConnectivityChecker:
    """
    网络连通性检测器

    功能:
    - Ping 检测（系统 ping 命令）
    - TCP 端口检测（socket connect）
    - DNS 解析检测
    - 批量检测（对所有设备执行多项检测）
    """

    def __init__(self, verbose: bool = True):
        self.verbose = verbose
        self.results = []

    # ========== Ping 检测 ==========

    def ping(self, target: str, count: int = 3, description: str = "") -> PingResult:
        """
        执行 Ping 检测

        Args:
            target: IP 地址或域名
            count: Ping 次数（默认 3 次）
            description: 描述信息

        Returns:
            PingResult 对象
        """
        result = PingResult(target, description)

        try:
            # 根据操作系统选择 ping 参数
            system = platform.system().lower()
            if system == "windows":
                cmd = ["ping", "-n", str(count), target]
                # Windows 中文输出: "丢失 = 0 (0% 丢失)"  "平均 = 1ms"
                # Windows 英文输出: "Lost = 0 (0% loss)"  "Average = 1ms"
            else:
                cmd = ["ping", "-c", str(count), target]
                loss_pattern = "packet loss"
                rtt_pattern = "rtt avg"

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW if system == "windows" else 0,
            )
            output = proc.stdout + proc.stderr

            if proc.returncode != 0:
                # 解析失败原因
                if "Destination host unreachable" in output or "无法访问目标主机" in output:
                    result.error_message = "目标不可达"
                elif "Request timed out" in output or "请求超时" in output:
                    result.error_message = "请求超时"
                elif "could not find host" in output.lower() or "找不到主机" in output:
                    result.error_message = "找不到主机"
                else:
                    result.error_message = f"Ping 失败 (code={proc.returncode})"
                return result

            # 解析丢包率
            if system == "windows":
                for line in output.splitlines():
                    # 支持中英文: "丢失 = 0 (0% 丢失)" 或 "Lost = 0 (0% loss)"
                    lost_match = re.search(r"(?:丢失|Lost)\s*=\s*(\d+)", line, re.IGNORECASE)
                    if lost_match:
                        result.packet_loss = float(lost_match.group(1)) / count * 100
                        break
                # 解析平均延迟
                for line in output.splitlines():
                    # 支持中英文: "平均 = 1ms" 或 "Average = 1ms"
                    rtt_match = re.search(r"(?:平均|Average)\s*=\s*([\d.]+)\s*ms", line, re.IGNORECASE)
                    if rtt_match:
                        result.rtt_ms = float(rtt_match.group(1))
                        break
            else:
                for line in output.splitlines():
                    if "packet loss" in line:
                        match = re.search(r"(\d+)% packet loss", line)
                        if match:
                            result.packet_loss = float(match.group(1))
                        break
                for line in output.splitlines():
                    if "rtt" in line and "=" in line:
                        match = re.search(r"([\d.]+)/([\d.]+)/([\d.]+)", line)
                        if match:
                            result.rtt_ms = float(match.group(2))
                        break

            result.success = result.packet_loss < 100
            if self.verbose:
                print(f"  {result}")

        except subprocess.TimeoutExpired:
            result.error_message = "Ping 超时"
        except FileNotFoundError:
            result.error_message = "系统 ping 命令不可用"
        except Exception as e:
            result.error_message = str(e)

        return result

    # ========== TCP 端口检测 ==========

    def check_tcp_port(self, target: str, port: int, timeout: int = 5,
                       description: str = "") -> TcpResult:
        """
        检测 TCP 端口是否开放

        Args:
            target: IP 地址
            port: 端口号
            timeout: 超时秒数
            description: 描述信息

        Returns:
            TcpResult 对象
        """
        result = TcpResult(target, port, description)
        import time

        try:
            start = time.time()
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            sock.close()

            result.rtt_ms = (time.time() - start) * 1000
            result.success = True
            if self.verbose:
                print(f"  {result}")

        except socket.timeout:
            result.error_message = "连接超时"
        except (ConnectionRefusedError, ConnectionResetError):
            result.error_message = "连接被拒绝 (设备未启动或端口关闭)"
        except socket.gaierror:
            result.error_message = "DNS 解析失败"
        except OSError as e:
            err = str(e)
            if "refused" in err.lower() or "10061" in err:
                result.error_message = "连接被拒绝 (设备未启动或端口关闭)"
            else:
                result.error_message = err
        except Exception as e:
            result.error_message = str(e)

        return result

    # ========== DNS 解析检测 ==========

    def resolve_dns(self, hostname: str) -> DnsResult:
        """
        DNS 域名解析

        Args:
            hostname: 域名（如 www.example.com）

        Returns:
            DnsResult 对象
        """
        result = DnsResult(hostname)

        try:
            result.ip_address = socket.gethostbyname(hostname)
            result.success = True
            if self.verbose:
                print(f"  {result}")
        except socket.gaierror:
            result.error_message = "DNS 解析失败"
        except Exception as e:
            result.error_message = str(e)

        return result

    # ========== 批量检测 ==========

    def check_device(self, device_info: dict, extra_ports: List[int] = None) -> List[dict]:
        """
        对单台设备执行全面连通性检测

        Args:
            device_info: 设备信息字典
            extra_ports: 额外检测的端口列表

        Returns:
            检测结果列表
        """
        host = device_info["host"]
        name = device_info.get("name", "未知设备")
        results = []

        print(f"\n[{name}] 开始连通性检测...")

        # 1. Ping 检测
        results.append(
            self.ping(host, description=f"{name}-ICMP").to_dict()
        )

        # 2. SSH 端口检测 (22)
        results.append(
            self.check_tcp_port(host, 22, description=f"{name}-SSH").to_dict()
        )

        # 3. 额外端口检测
        if extra_ports:
            for port in extra_ports:
                results.append(
                    self.check_tcp_port(host, port,
                                        description=f"{name}-Port{port}").to_dict()
                )

        return results

    def check_all_devices(self, devices: List[Dict],
                          extra_ports: List[int] = None) -> List[dict]:
        """
        批量检测所有设备

        Args:
            devices: 设备列表
            extra_ports: 额外端口列表

        Returns:
            所有设备的检测结果
        """
        all_results = []
        total = len(devices)

        print(f"\n{'='*60}")
        print(f"  批量网络连通性检测")
        print(f"  目标设备: {total} 台")
        print(f"{'='*60}")

        for i, device in enumerate(devices, 1):
            print(f"\n[{i}/{total}] 检测 {device.get('name', device['host'])} ...")
            device_results = self.check_device(device, extra_ports)
            for r in device_results:
                r["device_name"] = device.get("name", "未知")
            all_results.extend(device_results)

        self._print_summary(all_results, devices)
        return all_results

    def check_common_targets(self, targets: List[str]) -> List[dict]:
        """
        检测常见目标（如网关、DNS、公网等）

        Args:
            targets: 目标列表，每个元素可以是 IP 或 域名

        Returns:
            检测结果列表
        """
        print(f"\n{'='*60}")
        print(f"  常用目标连通性检测")
        print(f"{'='*60}")

        results = []
        for target in targets:
            result = self.ping(target, count=2, description="常用目标")
            results.append(result.to_dict())

        return results

    def _print_summary(self, all_results: List[dict], devices: List[Dict]):
        """打印检测汇总"""
        success = sum(1 for r in all_results if r["success"])
        fail = len(all_results) - success

        print(f"\n{'='*60}")
        print(f"  连通性检测汇总")
        print(f"{'='*60}")
        print(f"  成功: {success}  |  失败: {fail}  |  总计: {len(all_results)}")

        if fail > 0:
            print("\n  检测失败项:")
            for r in all_results:
                if not r["success"]:
                    dev = r.get("device_name", r["target"])
                    print(f"    [FAIL] {dev:12} {r['target']}:{r.get('port','')}  {r.get('error','')}")

        # 按设备统计
        print()
        for device in devices:
            name = device.get("name", "未知")
            host = device["host"]
            dev_results = [r for r in all_results if r.get("target") == host]
            dev_ok = sum(1 for r in dev_results if r["success"])
            dev_total = len(dev_results)
            print(f"    {name:12} ({host:16})  {dev_ok}/{dev_total} 项检测通过")

        print(f"{'='*60}\n")


# 测试
if __name__ == "__main__":
    print("连通性检测模块加载成功")
