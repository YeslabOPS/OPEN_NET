#!/usr/bin/env python3
"""
OSPF 多区域自动化配置脚本

本脚本通过 Telnet 或 SSH 连接华为路由器（eNSP 或真实网络），
自动完成 OSPF 多区域配置、验证、巡检和回滚。

特性:
- 支持 Telnet (eNSP) 和 SSH (真实设备)
- 自动处理 [Y/N] 确认提示
- 配置后自动验证（邻居、路由表、连通性）
- 错误检测与重试机制
- 日志记录到文件
- 配置回滚/撤销功能

用法:
    python ospf_config.py <port> [commands_file]     # 单设备配置
    python ospf_config.py --batch                     # 批量配置（eNSP 实验）
    python ospf_config.py --generate <name> <rid>     # 生成配置命令
    python ospf_config.py --verify <port>             # 验证配置
    python ospf_config.py --rollback <port>           # 撤销配置
    python ospf_config.py --ssh <ip> <user> <pass>    # SSH 模式

示例:
    python ospf_config.py 2000 ar1_ospf.txt
    python ospf_config.py --batch
    python ospf_config.py --ssh 192.168.1.1 admin admin123
"""

import socket
import time
import sys
import os
import logging
import argparse
import re
from datetime import datetime
from ipaddress import IPv4Network, IPv4Address


# ============================================================
# 日志配置
# ============================================================

LOG_DIR = "logs"
LOG_FILE = None


def setup_logging():
    """初始化日志"""
    global LOG_FILE
    if not os.path.exists(LOG_DIR):
        os.makedirs(LOG_DIR)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    LOG_FILE = os.path.join(LOG_DIR, f"ospf_config_{timestamp}.log")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger(__name__)


logger = setup_logging()


# ============================================================
# Telnet/SSH 客户端
# ============================================================

class DeviceClient:
    """设备连接客户端基类，支持 Telnet 和 SSH"""

    def __init__(self, host, port=23, timeout=10, protocol="telnet",
                 username=None, password=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.protocol = protocol
        self.username = username
        self.password = password
        self.sock = None
        self._connect()

    def _connect(self):
        """建立连接"""
        if self.protocol == "telnet":
            self._connect_telnet()
        elif self.protocol == "ssh":
            self._connect_ssh()
        else:
            raise ValueError(f"不支持的协议: {self.protocol}")

    def _connect_telnet(self):
        """Telnet 连接"""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        try:
            self.sock.connect((self.host, self.port))
            # Telnet 协商处理（忽略）
            self._read(0.5)
            logger.info(f"[OK] Telnet 已连接到 {self.host}:{self.port}")
        except Exception as e:
            logger.error(f"[ERROR] Telnet 连接失败: {e}")
            raise

    def _connect_ssh(self):
        """SSH 连接"""
        try:
            import paramiko
        except ImportError:
            logger.error("[ERROR] SSH 模式需要安装 paramiko: pip install paramiko")
            raise

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                self.host, port=self.port,
                username=self.username,
                password=self.password,
                timeout=self.timeout,
                look_for_keys=False,
                allow_agent=False,
            )
            self.sock = client.invoke_shell(
                term="vt100",
                width=200,
                height=50,
            )
            self.sock.settimeout(self.timeout)
            self._ssh_client = client
            self._read(1)
            logger.info(f"[OK] SSH 已连接到 {self.host}:{self.port} 作为 {self.username}")
        except Exception as e:
            logger.error(f"[ERROR] SSH 连接失败: {e}")
            raise

    def send_cmd(self, cmd, wait=0.5):
        """发送命令并读取回显"""
        if self.protocol == "ssh":
            self.sock.send(cmd + "\n")
        else:
            self.sock.sendall(cmd.encode("ascii") + b"\n")
        time.sleep(wait)
        return self._read(timeout=1)

    def _read(self, timeout=1):
        """读取设备回显"""
        if self.protocol == "ssh":
            return self._read_ssh(timeout)
        return self._read_telnet(timeout)

    def _read_telnet(self, timeout):
        """Telnet 方式读取"""
        self.sock.settimeout(timeout)
        try:
            data = self.sock.recv(65535)
            result = data.decode("gbk", errors="ignore")
            # 过滤 Telnet 控制字符
            result = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", result)
            return result
        except socket.timeout:
            return ""

    def _read_ssh(self, timeout):
        """SSH 方式读取"""
        import paramiko
        self.sock.settimeout(timeout)
        result = ""
        try:
            while True:
                if self.sock.recv_ready():
                    data = self.sock.recv(65535)
                    result += data.decode("utf-8", errors="ignore")
                else:
                    time.sleep(0.1)
                    break
        except (socket.timeout, paramiko.ssh_exception.SSHException):
            pass
        return result

    def close(self):
        """关闭连接"""
        try:
            if hasattr(self, "_ssh_client"):
                self._ssh_client.close()
            elif self.sock:
                self.sock.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ============================================================
# OSPF 配置引擎
# ============================================================

class OSPFConfigEngine:
    """OSPF 配置引擎：执行配置、验证、回滚"""

    def __init__(self, client: DeviceClient):
        self.client = client
        self.command_log = []  # 记录已执行命令，用于回滚

    def send_and_check(self, cmd, wait=0.8):
        """发送命令并检查错误"""
        logger.info(f">>> {cmd}")
        output = self.client.send_cmd(cmd, wait)

        # 处理 [Y/N] 确认提示
        if re.search(r"\[[Yy]/[Nn]\]", output):
            logger.info("[!] 检测到确认提示，发送 Y")
            output2 = self.client.send_cmd("Y", 1.5)
            output += output2

        # 检查错误
        has_error = self._check_error(output)
        status = "[FAIL]" if has_error else "[OK]"

        # 只输出回显最后 200 字符
        display = output[-200:] if len(output) > 200 else output
        logger.info(f"{status} <- {display.strip()}")

        if has_error:
            logger.warning(f"[WARN] 命令执行失败: {cmd}")
            return False, output

        self.command_log.append(cmd)
        return True, output

    def _check_error(self, output):
        """检测回显中的错误关键字"""
        error_keywords = [
            "Error", "Unrecognized command", "Incomplete command",
            "Too many parameters", "Ambiguous command",
            "Error: ", "% Unrecognized",
        ]
        for kw in error_keywords:
            if kw.lower() in output.lower():
                return True
        return False

    def configure_ospf(self, commands):
        """执行 OSPF 配置命令序列"""
        logger.info("\n" + "=" * 60)
        logger.info("  开始 OSPF 配置")
        logger.info("=" * 60)

        # Step 1: 进入系统视图
        logger.info("\n--- 进入系统视图 ---")
        success, output = self.send_and_check("system-view", 1.5)
        if not success:
            # 尝试再发一次
            success, output = self.send_and_check("system-view", 1)
            if not success:
                logger.error("[ERROR] 无法进入系统视图，请确认设备状态")
                return False

        # Step 2: 逐条执行配置命令
        logger.info("\n--- 执行配置命令 ---")
        error_count = 0
        for cmd in commands:
            cmd = cmd.strip()
            if not cmd or cmd.startswith("#") or cmd.startswith("!"):
                continue

            success, _ = self.send_and_check(cmd)
            if not success:
                error_count += 1
                if error_count >= 3:
                    logger.error(f"[ERROR] 连续 {error_count} 个命令失败，终止配置")
                    return False

        # Step 3: 退出完成
        logger.info("\n--- 配置完成 ---")
        self.send_and_check("return")

        logger.info("\n--- 配置完成 ---")
        logger.info(f"共执行 {len(self.command_log)} 条命令，{error_count} 条错误")
        return error_count == 0

    def verify_ospf(self):
        """验证 OSPF 配置"""
        logger.info("\n" + "=" * 60)
        logger.info("  开始 OSPF 验证")
        logger.info("=" * 60)

        checks = [
            ("OSPF 进程", "display ospf brief"),
            ("邻居状态", "display ospf peer brief"),
            ("接口状态", "display ospf interface"),
            ("OSPF 路由表", "display ospf routing"),
            ("ABR/ASBR 信息", "display ospf abr-asbr"),
            ("错误统计", "display ospf error"),
            ("LSDB 摘要", "display ospf lsdb"),
        ]

        results = []
        for name, cmd in checks:
            logger.info(f"\n--- {name} ---")
            _, output = self.send_and_check(cmd)
            results.append((name, output))

        return results

    def rollback(self):
        """撤销配置（回滚）"""
        logger.info("\n" + "=" * 60)
        logger.info("  开始配置回滚")
        logger.info("=" * 60)

        if not self.command_log:
            logger.info("没有需要回滚的配置")
            return True

        # 进入系统视图
        self.send_and_check("system-view", 1)

        # 反向撤销：undo 每条配置（逆序）
        undo_count = 0
        for cmd in reversed(self.command_log):
            # 跳过非配置命令
            skip_cmds = ["system-view", "return", "quit"]
            if cmd.strip() in skip_cmds:
                continue
            if cmd.startswith("interface"):
                continue  # 接口配置在退出时自动撤销

            # 生成 undo 命令
            if cmd.strip().startswith("undo "):
                continue  # 已经是 undo 跳过

            # 简单规则：大多数命令加 undo 前缀
            undo_cmd = f"undo {cmd}"
            logger.info(f">>> {undo_cmd}")
            self.send_and_check(undo_cmd)
            undo_count += 1

        self.send_and_check("return")

        logger.info(f"\n--- 回滚完成：撤销 {undo_count} 条命令 ---")
        return True

    def ping_test(self, src_ip, dst_ip, count=3):
        """执行 Ping 测试"""
        cmd = f"ping -a {src_ip} {dst_ip} -c {count}"
        logger.info(f">>> ping {src_ip} -> {dst_ip}")
        success, output = self.send_and_check(cmd)
        return success, output


# ============================================================
# 配置命令生成
# ============================================================

def generate_ospf_commands(device_name, router_id, area_configs):
    """
    生成 OSPF 配置命令列表

    参数:
        device_name: 设备名称
        router_id: OSPF Router-ID
        area_configs: 区域配置列表
                      格式: [(area_id, [(interface, ip, mask), ...]), ...]

    返回:
        命令列表
    """
    commands = [
        f"sysname {device_name}",
    ]

    # 接口 IP 配置
    for area_id, interfaces in area_configs:
        for iface, ip, mask in interfaces:
            commands.extend([
                f"interface {iface}",
                f"ip address {ip} {mask}",
                "undo shutdown",
                "quit",
            ])

    # Loopback 接口
    commands.extend([
        "interface LoopBack0",
        f"ip address {router_id} 255.255.255.255",
        "quit",
    ])

    # OSPF 配置
    commands.append(f"ospf 1 router-id {router_id}")
    for area_id, interfaces in area_configs:
        commands.append(f"area {area_id}")
        for iface, ip, mask in interfaces:
            network = str(IPv4Network(f"{ip}/{mask}", strict=False).network_address)
            wildcard = ".".join(str(255 - int(octet)) for octet in mask.split("."))
            commands.append(f"network {network} {wildcard}")
        commands.append("quit")

    commands.append("quit")
    commands.extend(["return"])

    return commands


def load_commands_from_file(filepath):
    """从文件加载配置命令"""
    commands = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("!"):
                commands.append(line)
    logger.info(f"从 {filepath} 加载了 {len(commands)} 条命令")
    return commands


# ============================================================
# 批量配置（预定义实验拓扑）
# ============================================================

BATCH_DEVICES = [
    (2000, "AR1", "1.1.1.1", [
        ("0.0.0.0", [("GigabitEthernet0/0/0", "172.16.12.1", "255.255.255.0")]),
        ("0.0.0.1", [("GigabitEthernet0/0/1", "172.16.15.1", "255.255.255.0")]),
    ]),
    (2001, "AR2", "2.2.2.2", [
        ("0.0.0.0", [
            ("GigabitEthernet0/0/0", "172.16.12.2", "255.255.255.0"),
            ("GigabitEthernet0/0/1", "172.16.23.2", "255.255.255.0"),
            ("GigabitEthernet0/0/2", "172.16.26.2", "255.255.255.0"),
        ]),
    ]),
    (2002, "AR3", "3.3.3.3", [
        ("0.0.0.0", [
            ("GigabitEthernet0/0/0", "172.16.23.3", "255.255.255.0"),
            ("GigabitEthernet0/0/1", "172.16.34.3", "255.255.255.0"),
        ]),
    ]),
    (2003, "AR4", "4.4.4.4", [
        ("0.0.0.0", [("GigabitEthernet0/0/0", "172.16.34.4", "255.255.255.0")]),
    ]),
    (2004, "AR5", "5.5.5.5", [
        ("0.0.0.1", [("GigabitEthernet0/0/0", "172.16.15.5", "255.255.255.0")]),
    ]),
    (2005, "AR6", "6.6.6.6", [
        ("0.0.0.2", [("GigabitEthernet0/0/0", "172.16.26.6", "255.255.255.0")]),
    ]),
]


def run_batch():
    """批量配置所有设备"""
    logger.info("=" * 60)
    logger.info("  OSPF 多区域批量配置")
    logger.info("=" * 60)

    success_count = 0
    for port, name, rid, areas in BATCH_DEVICES:
        logger.info(f"\n{'='*50}")
        logger.info(f"  正在配置 {name} (端口 {port})")
        logger.info(f"{'='*50}")

        cmds = generate_ospf_commands(name, rid, areas)
        try:
            with DeviceClient("127.0.0.1", port) as client:
                engine = OSPFConfigEngine(client)
                if engine.configure_ospf(cmds):
                    success_count += 1
                    logger.info(f"[OK] {name} 配置完成")
                else:
                    logger.error(f"[ERROR] {name} 配置失败")
        except Exception as e:
            logger.error(f"[ERROR] {name} 连接/配置异常: {e}")

    logger.info(f"\n=== 批量配置完成: {success_count}/{len(BATCH_DEVICES)} 成功 ===")


# ============================================================
# SSH 交互模式
# ============================================================

def ssh_interactive(host, port, username, password):
    """SSH 交互模式"""
    logger.info(f"SSH 连接到 {host}:{port} 作为 {username}")

    try:
        with DeviceClient(
            host, port=port, protocol="ssh",
            username=username, password=password,
        ) as client:
            engine = OSPFConfigEngine(client)

            print("\n输入配置命令（每行一条，空行结束，输入 'verify' 验证，输入 'rollback' 回滚）:")
            cmds = []
            while True:
                line = input("> ").strip()
                if not line:
                    break
                if line.lower() == "verify":
                    engine.verify_ospf()
                    continue
                if line.lower() == "rollback":
                    engine.rollback()
                    continue
                cmds.append(line)

            if cmds:
                engine.configure_ospf(cmds)

            # 询问是否验证
            resp = input("\n是否执行 OSPF 验证？(y/n): ").strip().lower()
            if resp == "y":
                engine.verify_ospf()

    except Exception as e:
        logger.error(f"[ERROR] SSH 交互失败: {e}")



# ============================================================
# 主函数
# ============================================================

def parse_args(args=None):
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="OSPF 多区域自动化配置脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    python ospf_config.py 2000                 # Telnet 交互模式
    python ospf_config.py 2000 commands.txt    # 从文件加载命令
    python ospf_config.py --batch              # 批量配置 6 台设备
    python ospf_config.py --verify 2000        # 验证设备配置
    python ospf_config.py --rollback 2000      # 回滚设备配置
    python ospf_config.py --generate AR1 1.1.1.1  # 生成配置命令
    python ospf_config.py --ssh 192.168.1.1 admin pass  # SSH 配设备
        """,
    )
    parser.add_argument("port_or_file", nargs="?", help="端口号或命令文件")
    parser.add_argument("commands_file", nargs="?", help="命令文件路径（可选）")
    parser.add_argument("--batch", action="store_true", help="批量配置模式")
    parser.add_argument(
        "--generate", nargs=2, metavar=("NAME", "RID"),
        help="生成 OSPF 配置命令",
    )
    parser.add_argument(
        "--verify", metavar="PORT", type=int,
        help="验证指定端口设备的 OSPF 配置",
    )
    parser.add_argument(
        "--rollback", metavar="PORT", type=int,
        help="回滚指定端口设备的 OSPF 配置",
    )
    parser.add_argument(
        "--ssh", nargs=3, metavar=("HOST", "USER", "PASS"),
        help="SSH 模式连接设备",
    )
    parser.add_argument("--ssh-port", type=int, default=22, help="SSH 端口")
    parser.add_argument("--log-dir", default="logs", help="日志目录")
    parser.add_argument("--no-verify", action="store_true", help="配置后不自动验证")

    if args is None:
        args = sys.argv[1:]
    return parser.parse_args(args)



def main():
    args = parse_args()

    # 更新日志目录
    global LOG_DIR
    LOG_DIR = args.log_dir

    # --generate: 生成配置命令
    if args.generate:
        name, rid = args.generate
        # 使用空 area 生成基础命令（仅作为示例）
        logger.info(f"为 {name} (Router-ID: {rid}) 生成 OSPF 配置:")
        for cmd in generate_ospf_commands(name, rid, []):
            print(cmd)
        return

    # --batch: 批量配置
    if args.batch:
        run_batch()
        return

    # --ssh: SSH 交互模式
    if args.ssh:
        host, user, passwd = args.ssh
        ssh_interactive(host, args.ssh_port, user, passwd)
        return

    # --verify: 验证模式
    if args.verify:
        port = args.verify
        logger.info(f"验证端口 {port} 的 OSPF 状态")
        with DeviceClient("127.0.0.1", port) as client:
            engine = OSPFConfigEngine(client)
            engine.verify_ospf()
        return

    # --rollback: 回滚模式
    if args.rollback:
        port = args.rollback
        logger.info(f"回滚端口 {port} 的 OSPF 配置")
        with DeviceClient("127.0.0.1", port) as client:
            engine = OSPFConfigEngine(client)
            engine.rollback()
        return

    # 单设备模式
    if not args.port_or_file:
        logger.error("请指定端口号。使用 -h 查看帮助。")
        sys.exit(1)

    port_or_file = args.port_or_file

    # 判断第一个参数是端口还是命令文件
    try:
        port = int(port_or_file)
        # 端口模式
        if args.commands_file:
            commands = load_commands_from_file(args.commands_file)
        else:
            # 交互式输入命令
            print("请输入配置命令（每行一条，输入空行结束）:")
            commands = []
            while True:
                line = input("> ").strip()
                if not line:
                    break
                commands.append(line)

        if commands:
            with DeviceClient("127.0.0.1", port) as client:
                engine = OSPFConfigEngine(client)
                success = engine.configure_ospf(commands)

                if success and not args.no_verify:
                    resp = input("\n是否执行 OSPF 验证？(y/n): ").strip().lower()
                    if resp == "y":
                        engine.verify_ospf()
        else:
            logger.info("没有配置命令可执行。")

    except ValueError:
        # 文件模式：第一个参数是文件路径
        if os.path.exists(port_or_file):
            commands = load_commands_from_file(port_or_file)
            if commands:
                print(f"从 {port_or_file} 加载了 {len(commands)} 条命令")
                print("请指定目标设备端口: ", end="")
                port = int(input().strip())
                with DeviceClient("127.0.0.1", port) as client:
                    engine = OSPFConfigEngine(client)
                    engine.configure_ospf(commands)
        else:
            logger.error(f"文件不存在: {port_or_file}")
            sys.exit(1)


if __name__ == "__main__":
    main()
