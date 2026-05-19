"""SSH 连接工具 - 基于 Paramiko 的 SSH 客户端"""
import uuid
import logging
from typing import Optional
from paramiko import SSHClient, AutoAddPolicy, AuthenticationException, SSHException
from config import settings

logger = logging.getLogger(__name__)


class SSHConnection:
    """SSH 连接"""
    
    def __init__(self, host: str, port: int = 22, username: str = None, 
                 password: str = None, key_path: str = None):
        self.connection_id = str(uuid.uuid4())
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.key_path = key_path
        self._client: Optional[SSHClient] = None
        self._connected = False
    
    async def connect(self) -> bool:
        """建立 SSH 连接"""
        try:
            self._client = SSHClient()
            self._client.set_missing_host_key_policy(AutoAddPolicy())
            
            kwargs = {
                "hostname": self.host,
                "port": self.port,
                "username": self.username,
                "timeout": settings.ssh_timeout,
            }
            
            if self.password:
                kwargs["password"] = self.password
            if self.key_path:
                kwargs["key_filename"] = self.key_path
            
            self._client.connect(**kwargs)
            self._connected = True
            logger.info(f"SSH connected: {self.username}@{self.host}:{self.port} ({self.connection_id})")
            return True
            
        except AuthenticationException:
            logger.error(f"SSH auth failed: {self.username}@{self.host}")
            raise
        except SSHException as e:
            logger.error(f"SSH error: {e}")
            raise
        except Exception as e:
            logger.error(f"SSH connect failed: {e}")
            raise
    
    async def execute(self, command: str) -> dict:
        """执行远程命令"""
        if not self._connected or not self._client:
            raise SSHException("Not connected")
        
        stdin, stdout, stderr = self._client.exec_command(command, timeout=30)
        exit_code = stdout.channel.recv_exit_status()
        
        output = stdout.read().decode("utf-8", errors="replace")
        error = stderr.read().decode("utf-8", errors="replace")
        
        logger.info(f"SSH exec [{self.connection_id}]: {command}")
        
        return {
            "connection_id": self.connection_id,
            "command": command,
            "exit_code": exit_code,
            "stdout": output,
            "stderr": error,
        }
    
    async def disconnect(self):
        """断开连接"""
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
        self._connected = False
        logger.info(f"SSH disconnected: {self.connection_id}")
    
    @property
    def is_connected(self) -> bool:
        return self._connected


class SSHPool:
    """SSH 连接池"""
    
    def __init__(self):
        self._connections: dict[str, SSHConnection] = {}
    
    def create(self, host: str, port: int = 22, username: str = None,
               password: str = None, key_path: str = None) -> SSHConnection:
        """创建连接"""
        conn = SSHConnection(host, port, username, password, key_path)
        self._connections[conn.connection_id] = conn
        return conn
    
    def get(self, connection_id: str) -> Optional[SSHConnection]:
        """获取连接"""
        return self._connections.get(connection_id)
    
    async def remove(self, connection_id: str):
        """移除连接"""
        conn = self._connections.pop(connection_id, None)
        if conn:
            await conn.disconnect()
    
    def list(self) -> list[dict]:
        """列出所有连接"""
        return [
            {
                "connection_id": cid,
                "host": conn.host,
                "port": conn.port,
                "username": conn.username,
                "connected": conn.is_connected,
            }
            for cid, conn in self._connections.items()
        ]
    
    async def disconnect_all(self):
        """断开所有连接"""
        for conn in self._connections.values():
            await conn.disconnect()
        self._connections.clear()


# 全局连接池
ssh_pool = SSHPool()
