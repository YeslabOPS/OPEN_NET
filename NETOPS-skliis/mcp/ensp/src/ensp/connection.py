"""
连接管理器
管理设备的 Telnet 和 SSH 连接
"""

import socket
import time
import asyncio
import logging
import re
from typing import Optional, Union, List, Dict
from dataclasses import dataclass

import paramiko

from .models import Device, ConnectionMethod, ConnectionConfig, ConnectionResult

logger = logging.getLogger(__name__)


class ConnectionError(Exception):
    """连接异常"""
    pass


class TelnetConnection:
    """
    基于 Socket 的 Telnet 连接
    用于连接 eNSP 模拟器中的设备
    """

    def __init__(self, config: ConnectionConfig):
        self.config = config
        self.sock: Optional[socket.socket] = None
        self._connected = False

    async def connect(self) -> ConnectionResult:
        """
        建立 Telnet 连接（非阻塞方式，不阻塞事件循环）

        Returns:
            ConnectionResult 对象
        """
        start_time = time.time()

        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.setblocking(False)
            loop = asyncio.get_event_loop()
            await asyncio.wait_for(
                loop.sock_connect(self.sock, (self.config.host, self.config.port)),
                timeout=self.config.timeout
            )

            self._connected = True
            response_time = int((time.time() - start_time) * 1000)

            logger.debug(f"Telnet 连接成功: {self.config.host}:{self.config.port}")
            return ConnectionResult(
                success=True,
                response_time_ms=response_time
            )

        except asyncio.TimeoutError:
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error="连接超时"
            )
        except (ConnectionRefusedError, ConnectionResetError):
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error="连接被拒绝 (设备可能未启动)"
            )
        except OSError as e:
            response_time = int((time.time() - start_time) * 1000)
            err_msg = str(e)
            if "refused" in err_msg.lower() or "10061" in err_msg:
                err_msg = "连接被拒绝 (设备可能未启动)"
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error=err_msg
            )
        except Exception as e:
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error=str(e)
            )

    async def verify_connected(self, timeout: float = 2.0) -> ConnectionResult:
        """
        验证设备是否真实在线（尝试接收 Telnet 协商数据）
        仅在连通性测试中使用，配置/执行命令时不调用此方法（避免消耗 banner 数据）

        Args:
            timeout: 等待设备响应数据的超时秒数

        Returns:
            ConnectionResult 对象
        """
        start_time = time.time()
        if not self._connected or not self.sock:
            return ConnectionResult(
                success=False,
                response_time_ms=int((time.time() - start_time) * 1000),
                error="未连接到设备"
            )

        try:
            loop = asyncio.get_event_loop()
            # 使用 MSG_PEEK 窥视数据而不消耗它
            import select
            # 先检查是否有数据可读（不阻塞）
            readable, _, _ = select.select([self.sock], [], [], timeout)
            if not readable:
                return ConnectionResult(
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error="连接成功但设备无响应 (设备可能正在启动中或端口被其他服务占用)"
                )
            response_time = int((time.time() - start_time) * 1000)
            logger.debug(f"设备 {self.config.port} 真实在线验证通过")
            return ConnectionResult(
                success=True,
                response_time_ms=response_time
            )
        except Exception as e:
            return ConnectionResult(
                success=False,
                response_time_ms=int((time.time() - start_time) * 1000),
                error=f"设备验证失败: {e}"
            )

    async def send_command(self, cmd: str, wait_time: float = 1.5) -> str:
        """
        发送命令并获取输出

        Args:
            cmd: 要发送的命令
            wait_time: 等待时间 (秒)

        Returns:
            命令输出
        """
        if not self._connected or not self.sock:
            raise ConnectionError("未连接到设备")

        try:
            # 发送命令（非阻塞 socket 上 sendall 可能抛 BlockingIOError）
            try:
                self.sock.sendall((cmd + "\n").encode('ascii', errors='ignore'))
            except BlockingIOError:
                await asyncio.sleep(0.1)
                self.sock.sendall((cmd + "\n").encode('ascii', errors='ignore'))

            # 等待响应（yield 控制权给事件循环）
            await asyncio.sleep(wait_time)

            # 接收数据
            output = ""
            self.sock.setblocking(False)
            try:
                while True:
                    data = self.sock.recv(65535)
                    if not data:
                        break
                    # eNSP 设备通常使用 GBK 编码
                    output += data.decode('gbk', errors='ignore')
            except BlockingIOError:
                pass
            finally:
                self.sock.setblocking(True)
                self.sock.settimeout(self.config.timeout)

            return output

        except Exception as e:
            logger.error(f"发送命令失败: {e}")
            raise ConnectionError(f"发送命令失败: {e}")

    def close(self):
        """关闭连接"""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected


class SSHConnection:
    """
    基于 Paramiko 的 SSH 连接
    用于连接已配置 SSH 的设备
    """

    def __init__(self, config: ConnectionConfig):
        self.config = config
        self.client: Optional[paramiko.SSHClient] = None
        self.shell = None
        self._connected = False

    async def connect(self) -> ConnectionResult:
        """
        建立 SSH 连接（在线程池中执行阻塞的 paramiko 调用，不阻塞事件循环）

        Returns:
            ConnectionResult 对象
        """
        start_time = time.time()

        if not self.config.username or not self.config.password:
            return ConnectionResult(
                success=False,
                response_time_ms=0,
                error="SSH 连接需要用户名和密码"
            )

        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            loop = asyncio.get_event_loop()

            # paramiko 是阻塞库，在 executor 中执行避免卡事件循环
            await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: self.client.connect(
                        hostname=self.config.host,
                        port=self.config.port,
                        username=self.config.username,
                        password=self.config.password,
                        look_for_keys=False,
                        allow_agent=False,
                        timeout=self.config.timeout
                    )
                ),
                timeout=self.config.timeout + 5
            )

            self.shell = await asyncio.wait_for(
                loop.run_in_executor(None, self.client.invoke_shell),
                timeout=10
            )
            self._connected = True

            response_time = int((time.time() - start_time) * 1000)
            logger.debug(f"SSH 连接成功: {self.config.host}:{self.config.port}")
            return ConnectionResult(
                success=True,
                response_time_ms=response_time
            )

        except asyncio.TimeoutError:
            response_time = int((time.time() - start_time) * 1000)
            if self.client:
                try:
                    self.client.close()
                except Exception:
                    pass
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error="SSH 连接超时"
            )
        except paramiko.AuthenticationException:
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error="认证失败 (用户名或密码错误)"
            )
        except paramiko.SSHException as e:
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error=f"SSH 错误: {e}"
            )
        except Exception as e:
            response_time = int((time.time() - start_time) * 1000)
            return ConnectionResult(
                success=False,
                response_time_ms=response_time,
                error=str(e)
            )

    async def send_command(self, cmd: str, wait_time: float = 1.5) -> str:
        """
        发送命令并获取输出

        Args:
            cmd: 要发送的命令
            wait_time: 等待时间 (秒)

        Returns:
            命令输出
        """
        if not self._connected or not self.shell:
            raise ConnectionError("未连接到设备")

        try:
            self.shell.send(f"{cmd}\n")
            await asyncio.sleep(wait_time)

            output = ""
            while self.shell.recv_ready():
                output += self.shell.recv(65535).decode('utf-8', errors='ignore')

            return output

        except Exception as e:
            logger.error(f"发送命令失败: {e}")
            raise ConnectionError(f"发送命令失败: {e}")

    def close(self):
        """关闭连接"""
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None
            self.shell = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected


class ConnectionManager:
    """连接管理器"""

    def __init__(self):
        self._connections: Dict[str, Union[TelnetConnection, SSHConnection]] = {}

    def create_connection(
        self,
        device: Device,
        method: ConnectionMethod = ConnectionMethod.TELNET,
        username: str = "",
        password: str = "",
        timeout: int = 10
    ) -> Union[TelnetConnection, SSHConnection]:
        """
        创建连接对象

        Args:
            device: 设备对象
            method: 连接方式
            username: 用户名 (SSH 需要)
            password: 密码 (SSH 需要)
            timeout: 超时时间

        Returns:
            连接对象
        """
        config = ConnectionConfig(
            host="127.0.0.1",
            port=device.com_port,
            method=method,
            username=username,
            password=password,
            timeout=timeout
        )

        if method == ConnectionMethod.TELNET:
            return TelnetConnection(config)
        else:
            return SSHConnection(config)

    async def test_connectivity(
        self,
        device: Device,
        method: ConnectionMethod = ConnectionMethod.TELNET,
        timeout: int = 5
    ) -> ConnectionResult:
        """
        测试设备连通性（包含连接后数据验证，确保设备真实在线）

        Args:
            device: 设备对象
            method: 连接方式
            timeout: 超时时间

        Returns:
            ConnectionResult 对象
        """
        conn = self.create_connection(device, method, timeout=timeout)
        try:
            result = await conn.connect()
            if not result.success:
                return result

            # Telnet 连接成功后，额外验证设备是否真实在线（能收到数据）
            if method == ConnectionMethod.TELNET:
                verify_result = await conn.verify_connected(timeout=2.0)
                if not verify_result.success:
                    return verify_result

            return result
        finally:
            conn.close()

    async def batch_test(
        self,
        devices: List[Device],
        method: ConnectionMethod = ConnectionMethod.TELNET,
        timeout: int = 5
    ) -> List[dict]:
        """
        批量测试设备连通性

        Args:
            devices: 设备列表
            method: 连接方式
            timeout: 超时时间

        Returns:
            测试结果列表
        """
        results = []

        for device in devices:
            result = await self.test_connectivity(device, method, timeout)
            results.append({
                "device": device.name,
                "model": device.model,
                "com_port": device.com_port,
                "connectivity": "ok" if result.success else "failed",
                "response_time_ms": result.response_time_ms,
                "error": result.error
            })

        return results

    async def execute_commands(
        self,
        device: Device,
        commands: List[str],
        method: ConnectionMethod = ConnectionMethod.TELNET,
        username: str = "",
        password: str = "",
        wait_time: float = 1.5
    ) -> dict:
        """
        在设备上执行命令（含视图感知，自动处理 system-view/return 切换）

        Args:
            device: 设备对象
            commands: 命令列表
            method: 连接方式
            username: 用户名
            password: 密码
            wait_time: 命令等待时间

        Returns:
            执行结果字典
        """
        result = {
            "device": device.name,
            "com_port": device.com_port,
            "method": method.value,
            "success": False,
            "output": "",
            "error": None
        }

        conn = self.create_connection(device, method, username, password)

        try:
            # 连接设备
            connect_result = await conn.connect()
            if not connect_result.success:
                result["error"] = connect_result.error
                return result

            # 等待初始提示符
            await asyncio.sleep(1)

            # 执行命令（视图感知执行）
            output = ""
            current_view = 'user'  # 初始在用户视图

            for cmd in commands:
                cmd_stripped = cmd.strip()
                if not cmd_stripped or cmd_stripped.startswith('#'):
                    continue

                # 判断命令需要的视图
                required_view = 'user'
                for kw in ['display', 'save', 'ping', 'tracert', 'traceroute',
                           'dir', 'delete', 'copy', 'move', 'reset', 'reboot',
                           'system-view', 'sys', 'return', 'quit']:
                    if cmd_stripped.lower() == kw or cmd_stripped.lower().startswith(kw + ' '):
                        required_view = 'user'
                        break
                else:
                    # 配置类命令需要在系统视图执行
                    required_view = 'system'

                # 视图切换
                if required_view == 'system' and current_view == 'user':
                    sv_out = await conn.send_command("system-view", 2.0)
                    output += sv_out
                    current_view = 'system'
                elif required_view == 'user' and current_view == 'system':
                    ret_out = await conn.send_command("return", 1.0)
                    output += ret_out
                    current_view = 'user'

                cmd_output = await conn.send_command(cmd_stripped, wait_time)
                output += cmd_output

                # 检测 [Y/N] 确认提示并自动应答
                if '[Y/N]' in cmd_output or '[y/n]' in cmd_output:
                    y_output = await conn.send_command("Y", 1.0)
                    output += y_output

                # 通过输出检测实际视图
                if '<' in cmd_output and '>' in cmd_output:
                    last_line = cmd_output.strip().splitlines()[-1] if cmd_output.strip() else ""
                    if re.match(r'^<[A-Za-z0-9_-]+>\s*$', last_line):
                        current_view = 'user'
                    elif re.match(r'^\[[A-Za-z0-9_-]+(?:-[^\]]*)?\]\s*$', last_line):
                        if '-' in last_line.split('[')[1].split(']')[0]:
                            current_view = 'system'  # 子视图也视为系统视图
                        else:
                            current_view = 'system'

            result["success"] = True
            result["output"] = output

        except Exception as e:
            result["error"] = str(e)

        finally:
            conn.close()

        return result

    async def configure_device(
        self,
        device: Device,
        commands: List[str],
        method: ConnectionMethod = ConnectionMethod.TELNET,
        username: str = "",
        password: str = "",
        save_config: bool = False
    ) -> dict:
        """
        配置设备
        系统自动处理：连接 → 进入 system-view → 执行业务命令 → 退出 → 断连
        不再自动执行 save（如需保存，请在 commands 中加入 save/y）

        Args:
            device: 设备对象
            commands: 配置命令列表（只需写业务命令，不含 system-view/save）
            method: 连接方式
            username: 用户名
            password: 密码
            save_config: 是否保存配置（默认 False，不再自动保存）

        Returns:
            配置结果字典
        """
        result = {
            "device": device.name,
            "com_port": device.com_port,
            "method": method.value,
            "success": False,
            "commands_executed": 0,
            "output": "",
            "saved": False,
            "error": None
        }

        conn = self.create_connection(device, method, username, password)

        try:
            # 连接设备
            connect_result = await conn.connect()
            if not connect_result.success:
                result["error"] = connect_result.error
                return result

            # 等待设备就绪（Telnet 登录完成）
            await asyncio.sleep(2)

            # 直接进入系统视图（设备当前在用户视图 <Huawei>）
            output = await conn.send_command("system-view", 2.0)
            if any(kw in output for kw in ['Error', 'Unrecognized', 'Incomplete command', '%']):
                # 可能已经在系统视图中，尝试重试
                output = await conn.send_command("system-view", 1.5)

            # 执行业务配置命令
            for cmd in commands:
                cmd_stripped = cmd.strip()
                if not cmd_stripped or cmd_stripped.startswith('#'):
                    continue
                cmd_output = await conn.send_command(cmd_stripped, 1.5)
                output += cmd_output
                result["commands_executed"] += 1

                # 检测 [Y/N] 确认提示并自动应答
                if '[Y/N]' in cmd_output or '[y/n]' in cmd_output:
                    y_output = await conn.send_command("Y", 1.0)
                    output += y_output

            # 返回用户视图
            await conn.send_command("return", 0.5)
            output += "\n"

            # 保存配置（仅在 save_config=True 时）
            if save_config:
                save_out = await conn.send_command("save", 1.5)
                output += save_out
                if '[Y/N]' in save_out or '[y/n]' in save_out:
                    y_save = await conn.send_command("Y", 3.0)
                    output += y_save
                result["saved"] = (
                    "successfully" in output.lower() or
                    "成功" in output or
                    "Info:" in output
                )

            result["success"] = True
            result["output"] = output

        except Exception as e:
            result["error"] = str(e)

        finally:
            conn.close()

        return result


# 全局连接管理器实例
_connection_manager: Optional[ConnectionManager] = None


def get_connection_manager() -> ConnectionManager:
    """获取全局连接管理器实例"""
    global _connection_manager
    if _connection_manager is None:
        _connection_manager = ConnectionManager()
    return _connection_manager
