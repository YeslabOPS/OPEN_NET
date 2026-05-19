import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Device } from '../api';

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

type ConnState = 'disconnected' | 'connecting' | 'connected';

export default function InteractiveCLI() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const dataDisposable = useRef<{ dispose: () => void } | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [connState, setConnState] = useState<ConnState>('disconnected');
  const [loadingDevices, setLoadingDevices] = useState(true);

  // 加载设备列表
  useEffect(() => {
    fetch('/api/devices')
      .then(r => r.json())
      .then(res => {
        if (res.success && Array.isArray(res.data)) {
          setDevices(res.data);
          if (res.data.length > 0) {
            setSelectedDevice(res.data[0].host);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDevices(false));
  }, []);

  // 向终端写入内容的辅助函数
  const writeTerm = useCallback((text: string) => {
    if (term.current) term.current.write(text);
  }, []);

  // 初始化 xterm.js 终端
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'Consolas', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#e5e5e5',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(el);
    term.current = terminal;
    fitAddon.current = fit;

    // 写入初始信息
    terminal.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m');
    terminal.writeln('\x1b[1;36m║    NetOps 交互式终端（实时模式）       ║\x1b[0m');
    terminal.writeln('\x1b[1;36m║  连接设备后，所有按键实时发送到设备     ║\x1b[0m');
    terminal.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m');
    terminal.write('\r\n');

    // 注册 onData：每个按键/组合键的原始数据实时发送到设备
    const disposable = terminal.onData((data: string) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'key', data }));
      }
    });
    dataDisposable.current = disposable;

    // 首次适配
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
    });

    // ResizeObserver 自动适配
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { if (fitAddon.current) fitAddon.current.fit(); } catch {}
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      disposable.dispose();
      dataDisposable.current = null;
      terminal.dispose();
      term.current = null;
      fitAddon.current = null;
    };
  }, []);

  // 连接 WebSocket
  const connectDevice = useCallback(() => {
    if (!selectedDevice || ws.current) return;

    const device = devices.find(d => d.host === selectedDevice);
    if (!device) {
      writeTerm('\r\n\x1b[31m未找到设备信息\x1b[0m\r\n');
      return;
    }

    setConnState('connecting');

    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      // 简化：只发送 host，后端会自动查找完整凭证
      socket.send(JSON.stringify({
        type: 'connect',
        device: {
          host: device.host,
        },
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'connected':
            setConnState('connected');
            writeTerm(`\x1b[32m✓ ${msg.message || '连接成功'}\x1b[0m\r\n`);
            break;
          case 'data':
            // 设备回显的原始终端数据（base64），使用 TextDecoder 正确处理 UTF-8
            try {
              const binaryStr = atob(msg.payload);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const raw = new TextDecoder('utf-8').decode(bytes);
              writeTerm(raw);
            } catch {
              // base64 解码失败忽略
            }
            break;
          case 'error':
            writeTerm(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`);
            break;
          case 'system':
            writeTerm(`\r\n\x1b[36m${msg.data}\x1b[0m\r\n`);
            break;
          case 'exit':
            writeTerm(`\r\n\x1b[33m${msg.data || '会话已关闭'}\x1b[0m\r\n`);
            // 关闭 WebSocket——onclose 会自动清理状态（不移除 onclose，让它自然执行）
            disconnectDevice();
            break;
          default:
            if (msg.data) writeTerm(msg.data);
        }
      } catch {}
    };

    socket.onclose = () => {
      setConnState('disconnected');
      ws.current = null;
      writeTerm(`\r\n\x1b[33m连接已断开\x1b[0m\r\n`);
    };

    socket.onerror = () => {
      setConnState('disconnected');
      writeTerm(`\r\n\x1b[31m连接错误\x1b[0m\r\n`);
    };
  }, [selectedDevice, devices, writeTerm]);

  const disconnectDevice = useCallback(() => {
    if (ws.current) {
      try { ws.current.close(); } catch {}
      ws.current = null;
    }
    setConnState('disconnected');
    writeTerm(`\r\n\x1b[33m会话已断开\x1b[0m\r\n`);
  }, [writeTerm]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (ws.current) {
        try { ws.current.close(); } catch {}
        ws.current = null;
      }
    };
  }, []);

  // 粘贴：将文本逐字符模拟输入
  const handlePaste = useCallback(async () => {
    if (connState !== 'connected' || !ws.current) {
      writeTerm('\r\n\x1b[31m未连接设备\x1b[0m\r\n');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      // 逐段发送，模拟输入
      const chunkSize = 50;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.substring(i, i + chunkSize);
        ws.current.send(JSON.stringify({ type: 'key', data: chunk }));
        // 小延迟避免设备缓冲区溢出
        await new Promise(r => setTimeout(r, 10));
      }
    } catch {
      writeTerm('\r\n\x1b[31m无法读取剪贴板\x1b[0m\r\n');
    }
  }, [connState, writeTerm]);

  return (
    <div className="cli-page">
      <div className="cli-toolbar">
        <div className="cli-toolbar-left">
          <label className="cli-label">选择设备:</label>
          <select
            className="cli-select"
            value={selectedDevice}
            onChange={e => setSelectedDevice(e.target.value)}
            disabled={connState !== 'disconnected'}
          >
            {loadingDevices ? (
              <option value="">加载中...</option>
            ) : devices.length === 0 ? (
              <option value="">暂无设备</option>
            ) : (
              devices.map(d => (
                <option key={d.host} value={d.host}>
                  {d.name || d.host} ({d.host}) - {d.device_type}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="cli-toolbar-center">
          <span className={`cli-status ${connState}`}>
            {connState === 'disconnected' && '● 未连接'}
            {connState === 'connecting' && '◌ 连接中...'}
            {connState === 'connected' && '● 已连接'}
          </span>
        </div>

        <div className="cli-toolbar-right">
          {connState === 'disconnected' ? (
            <button
              className="cli-btn cli-btn-connect"
              onClick={connectDevice}
              disabled={!selectedDevice || devices.length === 0}
            >
              连接设备
            </button>
          ) : (
            <button
              className="cli-btn cli-btn-disconnect"
              onClick={disconnectDevice}
            >
              断开连接
            </button>
          )}
          <button
            className="cli-btn cli-btn-paste"
            onClick={handlePaste}
            disabled={connState !== 'connected'}
            title="粘贴命令"
          >
            粘贴
          </button>
        </div>
      </div>

      <div className="cli-terminal-wrapper" ref={terminalRef} />

      <div className="cli-footer">
        <span>所有按键实时发送到设备 · 设备回显实时显示 · 支持 Ctrl+C/Tab/方向键</span>
      </div>
    </div>
  );
}
