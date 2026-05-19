import { useState, useEffect, useCallback } from 'react';
import { api, BackupFile, Device } from '../api';

export default function DeviceBackup() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [baselines, setBaselines] = useState<string[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [viewFile, setViewFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');

  // 单设备备份弹窗
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [devBackupRunning, setDevBackupRunning] = useState(false);

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, blRes, dRes] = await Promise.all([api.getBackupList(), api.getBaseline(), api.getDevices()]);
    if (bRes.success && bRes.data) setBackups(bRes.data);
    if (blRes.success) setBaselines(blRes.data || []);
    if (dRes.success && dRes.data) setDevices(dRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runBackupAll = async () => {
    setRunning(true);
    const res = await api.runBackup();
    if (res.success) { showMsg('全部设备备份完成'); load(); }
    else { showMsg(`备份失败: ${res.error}`, 'error'); }
    setRunning(false);
  };

  const runBackupDevice = async (host: string) => {
    setDevBackupRunning(true);
    const res = await api.runBackupDevice(host);
    if (res.success) { showMsg(`设备 ${host} 备份完成`); load(); }
    else { showMsg(`备份失败: ${res.error}`, 'error'); }
    setDevBackupRunning(false);
    setShowDevicePicker(false);
  };

  const viewContent = async (f: string) => {
    setViewFile(f);
    setFileContent('加载中...');
    const res = await api.getBackupContent(f);
    setFileContent(res.success && res.data ? res.data : `加载失败: ${res.error}`);
  };

  const deleteBackup = async (f: string) => {
    if (!window.confirm(`确定删除备份文件 ${f}？`)) return;
    const res = await api.deleteBackup(f);
    if (res.success) { showMsg(`已删除: ${f}`); load(); }
    else { showMsg(`删除失败: ${res.error}`, 'error'); }
  };

  const toggleBaseline = async (f: string) => {
    if (baselines.includes(f)) {
      const res = await api.clearBaseline(f);
      if (res.success) { showMsg(`已移除基线: ${f}`); load(); }
      else { showMsg(res.error || '操作失败', 'error'); }
    } else {
      const res = await api.setBaseline(f);
      if (res.success) { showMsg(`基线已添加: ${f}`); load(); }
      else { showMsg(res.error || '操作失败', 'error'); }
    }
  };

  const clearAllBaselines = async () => {
    if (!window.confirm('确定清除所有基线？')) return;
    const res = await api.clearBaseline();
    if (res.success) { showMsg('已清除所有基线'); load(); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>配置备份</h2>
        <p>设备配置备份管理，支持全部备份和单设备备份，设置基线用于对比</p>
      </div>

      {msg && <div className={`alert ${msgType === 'error' ? 'alert-error' : 'alert-success'}`}>{msg}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runBackupAll} disabled={running}>
            {running ? '⏳ 全部备份中...' : '📦 全部设备备份'}
          </button>
          <button className="btn" onClick={() => setShowDevicePicker(true)} disabled={devBackupRunning}>
            {devBackupRunning ? '⏳ 备份中...' : '📀 指定设备备份'}
          </button>
          <button className="btn" onClick={load}>🔄 刷新</button>
          <div style={{ flex: 1 }} />
          {baselines.length > 0 && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⭐ {baselines.length} 个基线
              <button className="btn btn-sm btn-danger" onClick={clearAllBaselines}>清除全部</button>
            </span>
          )}
        </div>
      </div>

      {/* 指定设备备份弹窗 */}
      {showDevicePicker && (
        <div className="modal-overlay" onClick={() => setShowDevicePicker(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>选择要备份的设备</h3><button className="modal-close" onClick={() => setShowDevicePicker(false)}>×</button></div>
            <div className="modal-body">
              {devices.map(d => (
                <div key={d.host} onClick={() => runBackupDevice(d.host)}
                  style={{ padding: '10px 12px', cursor: 'pointer', borderRadius: 6, marginBottom: 4,
                    border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{d.name}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{d.host}</span>
                </div>
              ))}
            </div>
            <div className="modal-footer"><button className="btn" onClick={() => setShowDevicePicker(false)}>取消</button></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">备份文件列表 ({backups.length} 个)</div>
        {loading ? <div className="loading"><div className="spinner" /></div> : backups.length === 0 ? (
          <div className="empty-state"><p>暂无备份文件，点击"全部设备备份"创建</p></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>文件名</th><th>大小</th><th>基线</th><th>操作</th></tr>
            </thead>
            <tbody>
              {backups.map(f => {
                const isBase = baselines.includes(f.filename);
                return (
                  <tr key={f.filename} style={{ background: isBase ? '#fff7e6' : undefined }}>
                    <td style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}>{f.filename}</td>
                    <td>{(f.size / 1024).toFixed(1)} KB</td>
                    <td>
                      <button className={`btn btn-sm ${isBase ? 'btn-primary' : ''}`}
                        onClick={() => toggleBaseline(f.filename)}>
                        {isBase ? '⭐ 基线' : '设基线'}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => viewContent(f.filename)}>📄 查看</button>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteBackup(f.filename)}>🗑 删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {viewFile && (
        <div className="modal-overlay" onClick={() => setViewFile(null)}>
          <div className="modal" style={{ maxWidth: 900 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>📄 {viewFile}</h3><button className="modal-close" onClick={() => setViewFile(null)}>×</button></div>
            <div className="modal-body"><div className="code-block">{fileContent}</div></div>
            <div className="modal-footer"><button className="btn" onClick={() => setViewFile(null)}>关闭</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
