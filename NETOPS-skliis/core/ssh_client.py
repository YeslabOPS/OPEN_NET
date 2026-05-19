"""
SSH / Telnet 连接核心类
- SSH：基于 netmiko 封装
- Telnet：基于 telnetlib 直连，免账密登录，支持视图感知执行
"""

from netmiko import ConnectHandler, NetMikoTimeoutException, NetMikoAuthenticationException
import telnetlib
import time
import re
from typing import List, Optional, Dict, Any


class SSHClientError(Exception):
    """客户端自定义异常"""
    pass


# ====== 命令视图映射 ======
# 定义哪些命令在用户视图(<>)执行，其余默认在系统视图([])执行
#
# 重要：不要在 USER_VIEW_KEYWORDS 中包含以下命令：
# - 'quit'：在用户视图 quit 会退出 CLI 会话，导致后续所有命令丢失
# - 'shutdown' / 'undo shutdown'：这些是接口子视图命令，不应触发视图切换
USER_VIEW_KEYWORDS = {
    'system-view', 'sys', 'return',
    'save', 'y', 'n',
    'display', 'reset saved-configuration',
    'dir', 'delete', 'rename', 'copy', 'move',
    'startup', 'reboot', 'schedule',
    'screen-length', 'language-mode', 'clock', 'header',
    'user-interface', 'local-user', 'super', 'telnet', 'ssh',
    'ping', 'tracert', 'traceroute', 'debug',
    'terminal',
}

# 以下命令总是需要在用户视图执行（不可进入系统视图）
FORCE_USER_VIEW_KEYWORDS = {
    'save', 'reboot', 'dir', 'delete', 'rename',
    'copy', 'move', 'startup', 'ping', 'tracert', 'traceroute',
    'reset saved-configuration',
}


def get_command_view(cmd: str) -> str:
    """判断命令应该在哪个视图执行
    Returns: 'user' 或 'system'
    """
    stripped = cmd.strip().lower()
    # 空命令或单字符（如 y/n 应答）保持在当前视图
    if not stripped or len(stripped) <= 1:
        return 'keep'
    # 如果匹配强制用户视图命令
    for kw in FORCE_USER_VIEW_KEYWORDS:
        if stripped.startswith(kw):
            return 'user'
    # 检查是否是用户视图命令
    for kw in USER_VIEW_KEYWORDS:
        if stripped == kw or stripped.startswith(kw + ' '):
            return 'user'
    # 其余默认为系统视图命令
    return 'system'


class _TelnetConnection:
    """
    Telnet 连接封装，提供与 netmiko 兼容的 send_command API
    直接使用 telnetlib，不依赖 netmiko 的 prompt 正则匹配
    特性：
      - 免账密登录
      - 不自动执行 screen-length
      - 支持视图感知执行
    """
    # 耗时命令列表，自动延长超时
    LONG_RUNNING_COMMANDS = ["ping", "traceroute", "tracert", "debug"]

    def __init__(self, host, port, username='', password='', timeout=30, device_type="huawei"):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self.device_type = device_type
        self.tn = None
        self._buffer = b""

    @staticmethod
    def detect_mode(output: str) -> str:
        """检测设备当前模式
        华为 VRP:
          <HUAWEI>        用户视图
          [HUAWEI]        系统视图
          [HUAWEI-xxx]    子视图（接口、OSPF等）
        思科 IOS:
          Router>         用户执行模式
          Router#         特权模式
          Router(config)# 全局配置模式
        """
        if not output:
            return "unknown"
        lines = output.strip().splitlines()
        for line in reversed(lines):
            line = line.strip()
            if re.match(r'^<[A-Za-z0-9_-]+>\s*$', line):
                return "user_view"
            if re.match(r'^\[[A-Za-z0-9_-]+-[^\]]*\]\s*$', line):
                return "sub_view"
            if re.match(r'^\[[A-Za-z0-9_-]+\]\s*$', line):
                return "system_view"
            if re.search(r'[#>]$', line):
                if re.search(r'\(config[^)]*\)#$', line):
                    return "sub_view"
                if line.endswith('#'):
                    return "privileged_exec"
                if line.endswith('>'):
                    return "user_exec"
        return "unknown"

    def _read_until_prompt(self, timeout=10):
        """智能等待直到检测到设备提示符或超时"""
        # 只匹配最后一行是否为设备提示符，避免配置内容中的 [V200R003C00] 等误匹配
        prompt_pattern = re.compile(
            r'^(?:<[A-Za-z0-9_-]+>|\[[A-Za-z0-9_-]+(?:-[^\]]*)?\])\s*$'
        )
        output = b""
        start = time.time()
        while time.time() - start < timeout:
            try:
                data = self.tn.read_very_eager()
                if data:
                    output += data
                    clean = output.decode("utf-8", errors="replace")
                    # 只检查最后一行是否为设备提示符（去掉末尾空白）
                    last_line = clean.rstrip().splitlines()[-1] if clean.strip() else ""
                    if last_line and prompt_pattern.match(last_line):
                        return clean
            except Exception:
                pass
            time.sleep(0.1)
        return output.decode("utf-8", errors="replace")

    def connect(self):
        try:
            self.tn = telnetlib.Telnet(self.host, self.port, timeout=self.timeout)
        except Exception as e:
            raise SSHClientError(f"Telnet 连接失败: {e}")

        # === Telnet 免账密登录 ===
        # 仅发送回车处理 "Press RETURN to get started" 等欢迎提示
        time.sleep(0.5)
        self.tn.write(b"\n")
        time.sleep(1)
        try:
            self._buffer = self.tn.read_very_eager()
        except Exception:
            self._buffer = b""
        # 注意：不再执行 screen-length 0 temporary

    def send_command(self, command: str, expect_string: Optional[str] = None) -> str:
        if not self.tn:
            raise SSHClientError("未连接")

        # 检测耗时命令，自动延长超时
        cmd_lower = command.lower().strip()
        timeout = self.timeout
        for lr_cmd in self.LONG_RUNNING_COMMANDS:
            if cmd_lower.startswith(lr_cmd):
                timeout = max(timeout, 15)
                break

        # 发送命令
        self.tn.write(command.encode() + b"\n")

        # 读取输出
        if expect_string:
            try:
                output = self.tn.read_until(expect_string.encode(), timeout=timeout)
                return output.decode("utf-8", errors="replace")
            except Exception:
                output = self.tn.read_very_eager()
                return output.decode("utf-8", errors="replace")

        # 智能等待（检测到提示符立即返回）
        output = self._read_until_prompt(timeout)
        # 更新 buffer 用于模式检测
        self._buffer = output.encode("utf-8", errors="replace") if output else self._buffer
        return output

    def get_device_mode(self) -> str:
        """获取当前设备模式"""
        if self._buffer:
            return self.detect_mode(self._buffer.decode("utf-8", errors="replace"))
        return "unknown"

    def disconnect(self):
        if self.tn:
            try:
                self.tn.close()
            except Exception:
                pass
            self.tn = None

    def send_commands_with_views(self, commands: List[str]) -> str:
        """视图感知批量执行：自动处理 system-view/return 切换
        每次执行命令后通过实际检测设备提示符来确认当前视图，
        不依赖纯状态推测，避免状态漂移。
        """
        output_lines: List[str] = []
        current_view = 'user'  # Telnet 初始在用户视图

        for cmd in commands:
            stripped = cmd.strip()
            if not stripped:
                continue

            # ====== 安全保护：禁止在用户视图执行 quit ======
            # quit 在用户视图会退出 CLI 会话，导致后续命令全部丢失
            if stripped.lower() == 'quit' and current_view == 'user':
                output_lines.append(f"[安全保护] 用户视图中的 quit 已跳过（防止退出 CLI 会话）")
                continue

            required_view = get_command_view(stripped)

            # 视图切换（基于需要的视图 vs 当前实际视图）
            if required_view == 'system' and current_view == 'user':
                output_lines.append(f"[视图切换: 进入系统视图]\n{self.send_command('system-view')}")
                current_view = 'system'
            elif required_view == 'user' and current_view == 'system':
                output_lines.append(f"[视图切换: 返回用户视图]\n{self.send_command('return')}")
                current_view = 'user'

            result = self.send_command(stripped)
            output_lines.append(f"[{stripped}]\n{result}")

            # ====== 关键修复：根据设备实际输出检测当前视图 ======
            # 取代之前的纯名称推测（如 startswith('sys') 误匹配 sysname）
            actual_view = self.detect_mode(result)
            if actual_view == "user_view":
                current_view = 'user'
            elif actual_view == "system_view":
                current_view = 'system'
            elif actual_view == "sub_view":
                # 子视图 [Huawei-xxx] 本质上属于系统视图范畴
                current_view = 'system'
            # else: unknown 或 user_exec/privileged_exec（保留上一次状态）
            # 特殊处理：如果刚执行的是 return/quit，明确回到用户视图
            if stripped.lower() in ('quit', 'return'):
                current_view = 'user'

        # 执行结束时确保回到用户视图
        if current_view == 'system':
            output_lines.append(f"[视图切换: 返回用户视图]\n{self.send_command('return')}")

        return "\n".join(output_lines)

    def send_config_set(self, commands):
        """批量发送配置命令（兼容 netmiko 的 send_config_set API）"""
        output_lines = []
        for cmd in commands:
            result = self.send_command(cmd)
            output_lines.append(f"[{cmd}]\n{result}")
        return "\n".join(output_lines)

    def is_alive(self):
        return self.tn is not None


class SSHClient:
    """
    客户端，用于连接网络设备并执行命令
    自动检测 SSH/Telnet 协议
    """

    SUPPORTED_DEVICE_TYPES = [
        "huawei", "huawei_vrpv8", "cisco_ios", "cisco_xe",
        "cisco_nxos", "cisco_asa", "hp_comware", "hp_procurve",
        "juniper_junos", "arista_eos", "ruijie", "mikrotik_routeros", "linux",
    ]

    def __init__(self, device_info: dict):
        self.device_info = device_info
        self.device_name = device_info.get("name", "未知设备")
        self.host = device_info["host"]
        self.connection = None
        self._is_telnet = False
        self._validate_device_info()

    def _detect_protocol(self) -> str:
        proto = self.device_info.get("protocol", "").lower()
        if proto == "telnet":
            return "telnet"
        port = self.device_info.get("port", 22)
        if port == 23:
            return "telnet"
        return "ssh"

    def _validate_device_info(self):
        # SSH 需要 username 和 password，Telnet 免账密不要求
        proto = self._detect_protocol()
        if proto == 'ssh':
            required_fields = ["host", "username", "password", "device_type"]
        else:
            required_fields = ["host", "device_type"]
        for field in required_fields:
            if field not in self.device_info:
                raise SSHClientError(f"设备信息缺失必填字段 '{field}'")

    def connect(self) -> bool:
        proto = self._detect_protocol()
        port = self.device_info.get("port", 22)
        self._is_telnet = (proto == "telnet")
        print(f"[{self.device_name}] 正在通过 {proto.upper()} 连接 {self.host}:{port} ...")

        if self._is_telnet:
            return self._connect_telnet(port)
        else:
            return self._connect_ssh(port)

    def _connect_ssh(self, port: int) -> bool:
        try:
            connect_params = {
                "device_type": self.device_info["device_type"],
                "host": self.host,
                "port": port,
                "username": self.device_info["username"],
                "password": self.device_info["password"],
                "timeout": self.device_info.get("timeout", 30),
                "verbose": self.device_info.get("verbose", True),
            }
            if "secret" in self.device_info:
                connect_params["secret"] = self.device_info["secret"]

            self.connection = ConnectHandler(**connect_params)
            if "secret" in self.device_info:
                self.connection.enable()

            print(f"[OK] {self.device_name} ({self.host}) SSH 连接成功")
            return True

        except NetMikoAuthenticationException:
            raise SSHClientError(f"[FAIL] {self.device_name} ({self.host}) 认证失败，请检查用户名和密码")
        except NetMikoTimeoutException:
            raise SSHClientError(f"[FAIL] {self.device_name} ({self.host}) 连接超时，请检查网络可达性和端口")
        except Exception as e:
            raise SSHClientError(f"[FAIL] {self.device_name} ({self.host}) SSH 连接失败: {str(e)}")

    def _connect_telnet(self, port: int) -> bool:
        try:
            conn = _TelnetConnection(
                host=self.host,
                port=port,
                username=self.device_info["username"],
                password=self.device_info["password"],
                timeout=self.device_info.get("timeout", 30),
            )
            conn.connect()
            self.connection = conn
            print(f"[OK] {self.device_name} ({self.host}) Telnet 连接成功")
            return True

        except SSHClientError:
            raise
        except Exception as e:
            raise SSHClientError(f"[FAIL] {self.device_name} ({self.host}) Telnet 连接失败: {str(e)}")

    def send_command(self, command: str, expect_string: Optional[str] = None) -> str:
        self._check_connection()
        if self._is_telnet:
            try:
                return self.connection.send_command(command, expect_string=expect_string)
            except Exception as e:
                raise SSHClientError(f"[FAIL] 命令执行失败 '{command}': {str(e)}")
        else:
            try:
                if expect_string:
                    return self.connection.send_command(command, expect_string=expect_string)
                return self.connection.send_command(command)
            except Exception as e:
                raise SSHClientError(f"[FAIL] 命令执行失败 '{command}': {str(e)}")

    def send_commands(self, commands: List[str]) -> str:
        self._check_connection()
        if self._is_telnet:
            return self.connection.send_commands_with_views(commands)
        try:
            return self.connection.send_config_set(commands)
        except Exception as e:
            raise SSHClientError(f"[FAIL] 批量命令执行失败: {str(e)}")

    def send_commands_with_views(self, commands: List[str]) -> str:
        """视图感知批量执行：SSH 环境下手动处理视图切换，
        因为 netmiko 的 send_config_set 会自动进入 config mode，
        我们需要按命令的视图需求精准控制。
        每次执行后通过检测输出中的提示符确认实际视图，避免状态漂移。"""
        self._check_connection()
        output_lines: List[str] = []
        current_view = 'user'

        for cmd in commands:
            stripped = cmd.strip()
            if not stripped:
                continue

            # ====== 安全保护：禁止在用户视图执行 quit ======
            if stripped.lower() == 'quit' and current_view == 'user':
                output_lines.append(f"[安全保护] 用户视图中的 quit 已跳过（防止退出 CLI 会话）")
                continue

            required_view = get_command_view(stripped)

            # 视图切换
            if required_view == 'system' and current_view == 'user':
                output_lines.append(f"[视图切换: 进入系统视图]\n{self.connection.send_command('system-view')}")
                current_view = 'system'
            elif required_view == 'user' and current_view == 'system':
                output_lines.append(f"[视图切换: 返回用户视图]\n{self.connection.send_command('return')}")
                current_view = 'user'

            result = self.connection.send_command(stripped)
            output_lines.append(f"[{stripped}]\n{result}")

            # ====== 关键修复：根据设备实际输出检测当前视图 ======
            # 使用 _TelnetConnection.detect_mode 检测输出中的提示符
            actual_view = _TelnetConnection.detect_mode(result)
            if actual_view == "user_view":
                current_view = 'user'
            elif actual_view == "system_view":
                current_view = 'system'
            elif actual_view == "sub_view":
                current_view = 'system'
            # 特殊处理：return/quit 明确回到用户视图
            if stripped.lower() in ('quit', 'return'):
                current_view = 'user'

        # 确保回到用户视图
        if current_view == 'system':
            output_lines.append(f"[视图切换: 返回用户视图]\n{self.connection.send_command('return')}")

        return "\n".join(output_lines)

    def send_command_timing(self, command: str, delay: float = 1.0) -> str:
        self._check_connection()
        try:
            return self.connection.send_command_timing(command, delay_factor=delay)
        except Exception as e:
            raise SSHClientError(f"[FAIL] 命令执行失败 '{command}': {str(e)}")

    def find_prompt(self) -> str:
        self._check_connection()
        try:
            return self.connection.find_prompt()
        except Exception as e:
            raise SSHClientError(f"[FAIL] 获取提示符失败: {str(e)}")

    def disconnect(self):
        if self.connection:
            try:
                self.connection.disconnect()
                print(f"[{self.device_name}] 连接已断开")
            except Exception:
                pass
            finally:
                self.connection = None

    def _check_connection(self):
        if not self.connection:
            raise SSHClientError("连接未建立，请先调用 connect() 方法")

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
