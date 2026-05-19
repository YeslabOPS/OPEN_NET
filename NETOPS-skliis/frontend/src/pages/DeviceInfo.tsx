import { useState, useEffect, useCallback } from 'react';
import { api, Device } from '../api';

export default function DeviceInfo() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 连通性状态：ping + 端口检测
  const [connMap, setConnMap] = useState<Record<string, {reachable: boolean; rtt: number; portOpen: boolean; portChecked: boolean}>>({});

  // 添加/编辑设备弹窗
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceForm, setDeviceForm] = useState({ name: '', host: '', port: 22, username: '', password: '', device_type: 'huawei', secret: '', description: '', protocol: 'ssh' });
  const [saveMsg, setSaveMsg] = useState('');

  // 命令执行弹窗
  const [execDevice, setExecDevice] = useState<Device | null>(null);
  const [execCmd, setExecCmd] = useState('display version');
  const [execOutput, setExecOutput] = useState('');
  const [execLoading, setExecLoading] = useState(false);

  // CLI 交互弹窗
  const [cliDevice, setCliDevice] = useState<Device | null>(null);
  const [cliHistory, setCliHistory] = useState<{cmd: string; out: string}[]>([]);
  const [cliInput, setCliInput] = useState('');
  const [cliLoading, setCliLoading] = useState(false);

  // 设备加载
  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await api.getDevices();
    if (res.success && res.data) {
      setDevices(res.data);
      // Telnet 设备走 MCP 检测，SSH 设备走 ping+port
      for (const d of res.data) {
        const isTelnet = d.protocol === 'telnet' || d.port === 23;
        if (isTelnet) {
          checkMCPOnline(d);
        } else {
          checkConnect(d);
        }
      }
    } else {
      setError(res.error || '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // Telnet 设备 → 走 MCP test-connectivity 检测
  const checkMCPOnline = async (d: Device) => {
    setConnMap(prev => ({
      ...prev,
      [d.host]: { reachable: false, rtt: 0, portOpen: false, portChecked: false },
    }));
    const res = await api.checkDeviceOnline(d.name);
    if (res.success && res.data) {
      // 解析 MCP 返回的 markdown，提取设备状态
      const isOnline = res.data.includes('✓');
      setConnMap(prev => ({
        ...prev,
        [d.host]: { reachable: false, rtt: 0, portOpen: isOnline, portChecked: true },
      }));
    } else {
      setConnMap(prev => ({
        ...prev,
        [d.host]: { reachable: false, rtt: 0, portOpen: false, portChecked: true },
      }));
    }
  };

  // SSH 设备 → 走 ping + 端口检测
  const checkConnect = async (d: Device) => {
    const host = d.host;
    const port = d.port || 22;
    // 先检测 ICMP Ping
    const p = await api.ping(host);
    const pingReachable = p.success && p.data ? p.data.reachable : false;
    const pingRtt = p.success && p.data ? p.data.rtt_ms : 0;
    // 再检测设备端口是否开放（这才是真正的在线判断依据）
    const cp = await api.checkPort(host, port);
    const portOpen = cp.success && cp.data ? cp.data.open : false;
    setConnMap(prev => ({
      ...prev,
      [host]: { reachable: pingReachable, rtt: pingRtt, portOpen, portChecked: true },
    }));
  };

  // 添加设备
  const openAdd = () => {
    setEditingDevice(null);
    setDeviceForm({ name: '', host: '', port: 22, username: '', password: '', device_type: 'huawei', secret: '', description: '', protocol: 'ssh' });
    setShowDeviceModal(true);
  };

  const openEdit = (d: Device) => {
    setEditingDevice(d);
    setDeviceForm({ ...d, port: d.port || 22, secret: d.secret || '', description: d.description || '', protocol: d.protocol || 'ssh' });
    setShowDeviceModal(true);
  };

  const saveDevice = async () => {
    setSaveMsg('');
    // Telnet 免账密，只验证名称和IP即可
    if (!deviceForm.name || !deviceForm.host) {
      setSaveMsg('请填写必填项（名称和 IP 地址）');
      return;
    }
    if (deviceForm.protocol !== 'telnet') {
      // SSH 需要验证用户名和密码
      if (!deviceForm.username) {
        setSaveMsg('SSH 设备请填写用户名');
        return;
      }
      if (!editingDevice && !deviceForm.password) {
        setSaveMsg('请填写密码');
        return;
      }
    }
    let res;
    if (editingDevice) {
      res = await api.updateDevice(editingDevice.host, deviceForm);
    } else {
      res = await api.addDevice(deviceForm);
    }
    if (res.success) {
      setSaveMsg('保存成功');
      setShowDeviceModal(false);
      loadDevices();
    } else {
      setSaveMsg(res.error || '保存失败');
    }
  };

  const deleteDevice = async (d: Device) => {
    const label = `${d.name} (${d.host}:${d.port})`;
    if (!window.confirm(`确定删除设备 ${label}？`)) return;
    const res = await api.deleteDevice(d.host, d.port);
    if (res.success) {
      loadDevices();
    } else {
      alert(res.error);
    }
  };

  // 执行命令
  const execCommand = async () => {
    if (!execDevice) return;
    setExecLoading(true);
    setExecOutput('');
    const res = await api.sshExecute({
      host: execDevice.host, username: execDevice.username, password: execDevice.password,
      device_type: execDevice.device_type, command: execCmd, port: execDevice.port,
    });
    setExecOutput(res.success && res.data ? res.data : `[错误] ${res.error}`);
    setExecLoading(false);
  };

  // 单设备备份
  const [backupMsg, setBackupMsg] = useState('');
  const backupSingleDevice = async (host: string) => {
    setBackupMsg(`${host} 备份中...`);
    const res = await api.runBackupDevice(host);
    setBackupMsg(res.success ? `${host} 备份完成` : `${host} 备份失败`);
    setTimeout(() => setBackupMsg(''), 3000);
  };

  // CLI 发送命令
  const cliSend = async () => {
    if (!cliDevice || !cliInput.trim()) return;
    const cmd = cliInput.trim();
    setCliInput('');
    setCliLoading(true);
    setCliHistory(prev => [...prev, { cmd, out: '' }]);
    const res = await api.sshExecute({
      host: cliDevice.host, username: cliDevice.username, password: cliDevice.password,
      device_type: cliDevice.device_type, command: cmd, port: cliDevice.port,
    });
    const output = res.success && res.data ? res.data : `[错误] ${res.error}`;
    setCliHistory(prev => prev.map((h, i) => i === prev.length - 1 ? { ...h, out: output } : h));
    setCliLoading(false);
  };

  if (loading) return <div className="loading"><div className="spinner" /><p>加载设备列表...</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>设备信息</h2>
        <p>管理网络设备，查看状态并执行运维操作</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {backupMsg && <div className={`alert ${backupMsg.includes('失败') ? 'alert-error' : 'alert-success'}`}>{backupMsg}</div>}

      {/* 统计：端口检测优先，端口开=在线 */}
      <div className="stat-row">
        <div className="stat-card"><div className="stat-value">{devices.length}</div><div className="stat-label">设备总数</div></div>
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--success)'}}>
            {devices.filter(d => connMap[d.host]?.portChecked && connMap[d.host]?.portOpen).length}
          </div>
          <div className="stat-label">在线</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--danger)'}}>
            {devices.filter(d => connMap[d.host]?.portChecked && !connMap[d.host]?.portOpen).length}
          </div>
          <div className="stat-label">离线</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{color:'var(--text-secondary)'}}>
            {devices.filter(d => !connMap[d.host]?.portChecked).length}
          </div>
          <div className="stat-label">检测中</div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={openAdd}>➕ 添加设备</button>
          <button className="btn" onClick={loadDevices}>🔄 刷新</button>
          <button className="btn" onClick={() => devices.forEach(d => checkConnect(d))}>🔍 检测连通性</button>
        </div>
      </div>

      {/* 设备列表表格 */}
      <div className="card">
        <div className="card-title">设备列表</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>状态</th><th>名称</th><th>IP:端口</th><th>协议</th><th>类型</th><th>端口状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {devices.map(d => {
              const c = connMap[d.host];
              const portOpen = c?.portChecked ? c?.portOpen : undefined;
              return (
                <tr key={d.host}>
                  <td>
                    <span className={`status-dot ${portOpen === true ? 'online' : portOpen === false ? 'offline' : 'unknown'}`} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{d.name}</td>
                  <td>{d.host}:{d.port}</td>
                  <td><span className="device-type-badge">{d.protocol || (d.port === 23 ? 'telnet' : 'ssh')}</span></td>
                  <td><span className="device-type-badge">{d.device_type}</span></td>
                  <td style={{ fontSize: 13 }}>
                    {!c?.portChecked ? '⏳' : portOpen ? `✅ 端口开放` : '❌ 端口关闭'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => { setExecDevice(d); setExecOutput(''); setExecCmd('display version'); }}>▶ 命令</button>
                      <button className="btn btn-sm" onClick={() => { setCliDevice(d); setCliHistory([]); }}>💻 CLI</button>
                      <button className="btn btn-sm" onClick={() => backupSingleDevice(d.host)}>📦 备份</button>
                      <button className="btn btn-sm" onClick={() => openEdit(d)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteDevice(d)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {devices.length === 0 && <div className="empty-state"><div className="empty-state-icon">📡</div><p>暂无设备，点击"添加设备"添加</p></div>}
      </div>

      {/* 添加/编辑设备弹窗 */}
      {showDeviceModal && (
        <div className="modal-overlay" onClick={() => setShowDeviceModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingDevice ? '编辑设备' : '添加设备'}</h3><button className="modal-close" onClick={() => setShowDeviceModal(false)}>×</button></div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: 12 }}>
                {saveMsg && <div className={`alert ${saveMsg.includes('成功') ? 'alert-success' : 'alert-error'}`}>{saveMsg}</div>}
                <input placeholder="设备名称 *" value={deviceForm.name} onChange={e => setDeviceForm({...deviceForm, name: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <input placeholder="IP 地址 *" value={deviceForm.host} onChange={e => setDeviceForm({...deviceForm, host: e.target.value})} style={{width:'100%', padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                  </div>
                  <select value={deviceForm.protocol} onChange={e => {
                    const proto = e.target.value;
                    setDeviceForm({...deviceForm, protocol: proto, port: proto === 'telnet' ? 23 : 22 });
                  }} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6, width: 100}}>
                    <option value="ssh">SSH</option>
                    <option value="telnet">Telnet</option>
                  </select>
                  <input placeholder="端口" type="number" value={deviceForm.port} onChange={e => setDeviceForm({...deviceForm, port: parseInt(e.target.value) || 22})} style={{width:75, padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                </div>
                <input placeholder={deviceForm.protocol === 'telnet' ? '用户名（Telnet 可选）' : '用户名 *'} value={deviceForm.username} onChange={e => setDeviceForm({...deviceForm, username: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                <input placeholder={deviceForm.protocol === 'telnet' ? '密码（Telnet 可选）' : '密码 *'} type="password" value={deviceForm.password} onChange={e => setDeviceForm({...deviceForm, password: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                <select value={deviceForm.device_type} onChange={e => setDeviceForm({...deviceForm, device_type: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}}>
                  <option value="huawei">华为 (huawei)</option>
                  <option value="cisco_ios">思科 IOS (cisco_ios)</option>
                  <option value="cisco_xe">思科 IOS-XE</option>
                  <option value="hp_comware">H3C/HP Comware</option>
                  <option value="ruijie">锐捷 (ruijie)</option>
                </select>
                <input placeholder="Enable 密码（思科可选）" type="password" value={deviceForm.secret} onChange={e => setDeviceForm({...deviceForm, secret: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
                <input placeholder="备注描述（可选）" value={deviceForm.description} onChange={e => setDeviceForm({...deviceForm, description: e.target.value})} style={{padding: 8, border: '1px solid var(--border-color)', borderRadius: 6}} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowDeviceModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveDevice}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 命令执行弹窗 */}
      {execDevice && (
        <div className="modal-overlay" onClick={() => setExecDevice(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>▶ 执行命令 - {execDevice.name}</h3><button className="modal-close" onClick={() => setExecDevice(null)}>×</button></div>
            <div className="modal-body">
              <div style={{marginBottom:12, fontSize:13, color:'var(--text-secondary)'}}>{execDevice.host}:{execDevice.port} | {execDevice.device_type}</div>
              <div style={{display:'flex',gap:8,marginBottom:12}}>
                <input value={execCmd} onChange={e => setExecCmd(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && execCommand()}
                  placeholder="输入命令" style={{flex:1,padding:'8px 12px',border:'1px solid var(--border-color)',borderRadius:6,fontSize:14}} />
                <button className="btn btn-primary" onClick={execCommand} disabled={execLoading}>{execLoading ? '⏳' : '执行'}</button>
              </div>
              {execOutput && <div className="code-block">{execOutput}</div>}
            </div>
            <div className="modal-footer"><button className="btn" onClick={() => setExecDevice(null)}>关闭</button></div>
          </div>
        </div>
      )}

      {/* CLI 交互弹窗 */}
      {cliDevice && (
        <div className="modal-overlay" onClick={() => setCliDevice(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh' }}>
            <div className="modal-header">
              <h3>💻 CLI 交互式 - {cliDevice.name}</h3>
              <button className="modal-close" onClick={() => setCliDevice(null)}>×</button>
            </div>
            <div className="modal-body" style={{ background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'Consolas, monospace', fontSize: 13 }}>
              <div style={{ marginBottom: 8, color: '#888' }}>已连接 {cliDevice.host}:{cliDevice.port}，输入命令，exit 退出</div>
              <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 8 }}>
                {cliHistory.map((h, i) => (
                  <div key={i}>
                    <div style={{ color: '#6a9955' }}>{cliDevice.name}&gt; {h.cmd}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{h.out}</div>
                  </div>
                ))}
                {cliLoading && <div style={{ color: '#888' }}>执行中...</div>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ color: '#6a9955' }}>{cliDevice.name}&gt;</span>
                <input value={cliInput} onChange={e => setCliInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && cliInput.trim().toLowerCase() === 'exit') { setCliDevice(null); } else if (e.key === 'Enter') cliSend(); }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#d4d4d4', outline: 'none', fontFamily: 'Consolas, monospace', fontSize: 13 }}
                  placeholder={cliLoading ? '等待中...' : ''} disabled={cliLoading} />
              </div>
            </div>
            <div className="modal-footer" style={{ background: '#1e1e1e' }}>
              <button className="btn" style={{ borderColor: '#555', color: '#ccc' }} onClick={() => setCliHistory([])}>清屏</button>
              <button className="btn btn-primary" onClick={() => setCliDevice(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
