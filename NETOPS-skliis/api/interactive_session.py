"""
交互式终端会话管理器 V5（SSH + Telnet）
- SSH: 使用 paramiko
- Telnet: 使用 telnetlib
- 通过 TCP socket 接收键盘输入，避免 Windows 管道问题
"""
import sys
import json
import os
import base64
import threading
import socket
import time

API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(API_DIR)
sys.path.insert(0, PROJECT_ROOT)

# 读取设备信息
if len(sys.argv) < 2:
    print(json.dumps({"type": "error", "data": "缺少设备信息参数"}), flush=True)
    sys.exit(1)

try:
    device_json = base64.b64decode(sys.argv[1]).decode('utf-8')
    DEVICE = json.loads(device_json)
except Exception as e:
    print(json.dumps({"type": "error", "data": f"设备信息解析失败: {e}"}), flush=True)
    sys.exit(1)

HOST = DEVICE.get("host", "")
PORT = int(DEVICE.get("port", 22))
USERNAME = DEVICE.get("username", "admin")
PASSWORD = DEVICE.get("password", "")
PROTOCOL = DEVICE.get("protocol", "").lower()
# 根据端口推断协议（端口 23 为 telnet，其余默认 ssh）
if not PROTOCOL:
    PROTOCOL = "telnet" if PORT == 23 else "ssh"

stdout_fd = sys.stdout.buffer


def _send(obj):
    try:
        line = json.dumps(obj, ensure_ascii=False).encode('utf-8') + b'\n'
        stdout_fd.write(line)
        stdout_fd.flush()
    except Exception:
        pass


def _err(msg):
    _send({"type": "error", "data": msg})


# ========== 通用：TCP key server + pipe 框架 ==========

def run_interactive(send_fn, recv_fn, close_fn, protocol_name):
    """通用交互循环
    Args:
        send_fn: 发送数据到设备的函数 (bytes) -> None
        recv_fn: 从设备接收数据的函数 (size) -> bytes
        close_fn: 关闭连接的函数 () -> None
    """
    # 创建本地 TCP server 接收按键
    key_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    key_server.bind(('127.0.0.1', 0))
    key_server.listen(1)
    key_server.settimeout(1.0)
    key_port = key_server.getsockname()[1]

    _send({"type": "connected", "message": f"{protocol_name}连接成功", "key_port": key_port})

    stop = threading.Event()
    key_conn = [None]

    # 线程1: 接收 TCP 按键
    def pipe_keys():
        try:
            conn, _ = key_server.accept()
            key_conn[0] = conn
            conn.settimeout(0.5)
            while not stop.is_set():
                try:
                    raw = conn.recv(4096)
                    if not raw:
                        break
                    send_fn(raw)
                except socket.timeout:
                    continue
                except OSError as e:
                    if hasattr(e, 'errno') and e.errno in (10035, 10054):
                        time.sleep(0.05)
                        continue
                    break
                except Exception:
                    break
        except socket.timeout:
            pass
        finally:
            stop.set()

    # 线程2: 设备输出 → stdout
    def pipe_channel():
        while not stop.is_set():
            try:
                data = recv_fn(4096)
                if data:
                    payload = base64.b64encode(data).decode('ascii')
                    _send({"type": "data", "payload": payload})
                else:
                    if not stop.is_set():
                        _send({"type": "exit", "data": f"{protocol_name}连接已关闭"})
                    stop.set()
                    return
            except socket.timeout:
                time.sleep(0.02)
                continue
            except OSError as e:
                if hasattr(e, 'errno') and e.errno in (11, 35, 10035):
                    time.sleep(0.02)
                    continue
                if not stop.is_set():
                    _send({"type": "exit", "data": f"{protocol_name}连接异常: {e}"})
                stop.set()
                return
            except Exception as ex:
                if not stop.is_set():
                    _send({"type": "exit", "data": f"{protocol_name}连接异常断开: {ex}"})
                stop.set()
                return

    t1 = threading.Thread(target=pipe_keys, daemon=True)
    t2 = threading.Thread(target=pipe_channel, daemon=True)
    t1.start()
    t2.start()

    t1.join()
    stop.set()

    if key_conn[0]:
        try:
            key_conn[0].close()
        except Exception:
            pass
    try:
        key_server.close()
    except Exception:
        pass

    t2.join(timeout=2)
    close_fn()


# ========== SSH 会话 ==========

def ssh_session():
    import paramiko
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD,
                    look_for_keys=False, allow_agent=False, timeout=30)
    except Exception as e:
        _err(f"SSH连接失败: {e}")
        return

    try:
        channel = ssh.invoke_shell(term='xterm-256color')
    except Exception:
        try:
            channel = ssh.invoke_shell()
        except Exception as e2:
            _err(f"invoke_shell失败: {e2}")
            ssh.close()
            return

    channel.setblocking(0)

    run_interactive(
        send_fn=lambda data: channel.send(data),
        recv_fn=lambda size: channel.recv(size),
        close_fn=lambda: (channel.close(), ssh.close()),
        protocol_name="SSH",
    )


# ========== Telnet 会话 ==========

def telnet_session():
    import telnetlib
    try:
        tn = telnetlib.Telnet(HOST, PORT, timeout=30)
    except Exception as e:
        _err(f"Telnet连接失败: {e}")
        return

    # 设置 socket 超时，使 read_some 变为非阻塞（每 0.1s 超时）
    if tn.sock:
        try:
            tn.sock.settimeout(0.1)
        except Exception:
            pass

    class TelnetChannel:
        def __init__(self, tn_conn):
            self.tn = tn_conn

        def send(self, data: bytes):
            # Telnet 协议退格键使用 \x08 (BS/Ctrl+H) 而非 \x7f (DEL)
            # 前端 xterm.js 按下 Backspace 发送的是 \x7f，需转换否则退键无效
            data = data.replace(b'\x7f', b'\x08')
            self.tn.write(data)

        def recv(self, size: int) -> bytes:
            try:
                data = self.tn.read_some()
                return data
            except socket.timeout:
                # 无数据可读，让 pipe_channel 重试
                raise
            except EOFError:
                return b""
            except Exception:
                return b""

        def close(self):
            try:
                self.tn.close()
            except Exception:
                pass

    channel = TelnetChannel(tn)

    run_interactive(
        send_fn=lambda data: channel.send(data),
        recv_fn=lambda size: channel.recv(size),
        close_fn=lambda: channel.close(),
        protocol_name="Telnet",
    )


# ========== 入口 ==========

def main():
    if PROTOCOL == "telnet":
        telnet_session()
    else:
        ssh_session()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        try:
            tb = traceback.format_exc()
            _send({"type": "error", "data": f"Python异常: {e}\n{tb}"})
        except Exception:
            pass
        sys.exit(1)
