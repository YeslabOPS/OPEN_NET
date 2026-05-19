import { useState, useEffect, useCallback } from 'react';
import { api, InspectResult, Device } from '../api';

export default function InspectReport() {
  const [reports, setReports] = useState<{ filename: string; size: number; path: string }[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [inspectResults, setInspectResults] = useState<InspectResult[] | null>(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');

  // 设备选择弹窗
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [devInspRunning, setDevInspRunning] = useState(false);

  // 模板管理弹窗（逗号隔开）
  const [showTemplate, setShowTemplate] = useState(false);
  const [templateCmds, setTemplateCmds] = useState('');
  const [templateMsg, setTemplateMsg] = useState('');

  const [viewReport, setViewReport] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState('');

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, dRes] = await Promise.all([api.getInspectList(), api.getDevices()]);
    if (rRes.success && rRes.data) setReports(rRes.data);
    if (dRes.success && dRes.data) setDevices(dRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runInspectAll = async () => {
    setRunning(true);
    setInspectResults(null);
    const res = await api.runInspect();
    if (res.success && res.data) { setInspectResults(res.data); showMsg('巡检完成'); load(); }
    else { showMsg(`巡检失败: ${res.error}`, 'error'); }
    setRunning(false);
  };

  const runInspectDevice = async (host: string) => {
    setDevInspRunning(true);
    setInspectResults(null);
    const res = await api.runInspectDevice(host);
    if (res.success && res.data) { setInspectResults(res.data); showMsg(`${host} 巡检完成`); load(); }
    else { showMsg(`巡检失败: ${res.error}`, 'error'); }
    setDevInspRunning(false);
    setShowDevicePicker(false);
  };

  const viewReportContent = async (path: string) => {
    setViewReport(path);
    setReportContent('加载中...');
    const res = await api.readFile(path);
    setReportContent(res.success && res.data ? res.data : `加载失败: ${res.error}`);
  };

  const deleteReport = async (filename: string) => {
    if (!window.confirm(`确定删除巡检报告 ${filename}？`)) return;
    const res = await api.deleteInspect(filename);
    if (res.success) { showMsg(`已删除: ${filename}`); load(); }
    else { showMsg(`删除失败: ${res.error}`, 'error'); }
  };

  // 模板管理（逗号分隔）
  const openTemplate = async () => {
    setTemplateMsg('');
    const res = await api.getInspectTemplate();
    if (res.success) { setTemplateCmds(res.data || ''); }
    else { setTemplateMsg('加载失败'); }
    setShowTemplate(true);
  };

  const saveTemplate = async () => {
    const res = await api.setInspectTemplate({ commands: templateCmds });
    if (res.success) { setTemplateMsg('模板已保存'); }
    else { setTemplateMsg(`保存失败: ${res.error}`); }
  };

  const clearTemplate = async () => {
    if (!window.confirm('确定清除自定义模板？')) return;
    const res = await api.deleteInspectTemplate();
    if (res.success) { setTemplateMsg('已清除'); setTemplateCmds(''); }
    else { setTemplateMsg(`清除失败: ${res.error}`); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>自动化巡检</h2>
        <p>一键执行设备全面巡检，支持全部设备和指定设备</p>
      </div>

      {msg && <div className={`alert ${msgType === 'error' ? 'alert-error' : 'alert-success'}`}>{msg}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runInspectAll} disabled={running}>
            {running ? '⏳ 巡检中...' : '📋 全部设备巡检'}
          </button>
          <button className="btn" onClick={() => setShowDevicePicker(true)} disabled={devInspRunning}>
            {devInspRunning ? '⏳ 巡检中...' : '🎯 指定设备巡检'}
          </button>
          <button className="btn" onClick={load}>🔄 刷新</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={openTemplate}>⚙ 巡检模板</button>
        </div>
      </div>

      {/* 指定设备巡检弹窗 */}
      {showDevicePicker && (
        <div className="modal-overlay" onClick={() => setShowDevicePicker(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>选择要巡检的设备</h3><button className="modal-close" onClick={() => setShowDevicePicker(false)}>×</button></div>
            <div className="modal-body">
              {devices.map(d => (
                <div key={d.host} onClick={() => runInspectDevice(d.host)}
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

      {/* 巡检结果 */}
      {inspectResults && inspectResults.map((r, i) => (
        <div className="card" key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              <span className={`status-dot ${r.connected ? 'online' : 'offline'}`} />
              {r.device} ({r.host})
            </div>
            <div>
              <span className="device-type-badge">{r.health_score}/100</span>
              <span style={{ marginLeft: 8, fontSize: 13,
                color: r.health_score >= 80 ? 'var(--success)' : r.health_score >= 60 ? 'var(--warning)' : 'var(--danger)' }}>
                {r.health_score >= 80 ? '优秀' : r.health_score >= 60 ? '良好' : '较差'}
              </span>
            </div>
          </div>
          <div className="progress-bar" style={{ marginBottom: 16 }}>
            <div className="progress-fill" style={{
              width: `${r.health_score}%`,
              background: r.health_score >= 80 ? 'var(--success)' : r.health_score >= 60 ? 'var(--warning)' : 'var(--danger)'
            }} />
          </div>
          <table className="data-table">
            <tbody>
              {r.sysname && <tr><td style={{ width: 100, color: 'var(--text-secondary)' }}>主机名</td><td>{r.sysname}</td></tr>}
              {r.version && <tr><td style={{ color: 'var(--text-secondary)' }}>版本</td><td style={{ fontSize: 13 }}>{r.version}</td></tr>}
              {r.uptime && <tr><td style={{ color: 'var(--text-secondary)' }}>运行时间</td><td style={{ fontSize: 13 }}>{r.uptime}</td></tr>}
              <tr><td style={{ color: 'var(--text-secondary)' }}>接口</td><td>{r.interface_up}/{r.interface_count} UP</td></tr>
              {r.vlan_count > 0 && <tr><td style={{ color: 'var(--text-secondary)' }}>VLAN</td><td>{r.vlan_count}</td></tr>}
              {r.cpu && <tr><td style={{ color: 'var(--text-secondary)' }}>CPU</td><td>{r.cpu}</td></tr>}
              {r.memory && <tr><td style={{ color: 'var(--text-secondary)' }}>内存</td><td>{r.memory}</td></tr>}
              <tr><td style={{ color: 'var(--text-secondary)' }}>连通性</td><td>Ping: {r.ping_ok ? `✅ ${r.ping_rtt.toFixed(0)}ms` : '❌'} | SSH: {r.ssh_port_ok ? '✅' : '❌'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>备份</td><td>{r.backup_success ? `✅ ${r.backup_file}` : '❌'}</td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>变更</td><td style={{ color: r.config_changed ? 'var(--warning)' : 'var(--success)' }}>{r.config_changed ? `有变更 (${r.diff_summary})` : '无变更'}</td></tr>
              {r.errors.length > 0 && (
                <tr><td style={{ color: 'var(--text-secondary)' }}>错误</td><td style={{ color: 'var(--danger)' }}>{r.errors.join('; ')}</td></tr>
              )}
              {r.extra_outputs && r.extra_outputs.length > 0 && (
                <tr><td style={{ color: 'var(--text-secondary)' }}>额外命令</td><td>
                  {r.extra_outputs.map((o, idx) => (
                    <details key={idx} style={{ marginBottom: 4 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>{o.split('\n')[0]}</summary>
                      <div className="code-block" style={{ marginTop: 4, fontSize: 12 }}>{o}</div>
                    </details>
                  ))}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ))}

      {/* 历史报告 */}
      <div className="card">
        <div className="card-title">历史巡检报告 ({reports.length} 个)</div>
        {loading ? <div className="loading"><div className="spinner" /></div> : reports.length === 0 ? (
          <div className="empty-state"><p>暂无巡检报告</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>报告文件</th><th>大小</th><th>操作</th></tr></thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.filename}>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }}>{r.filename}</td>
                  <td>{(r.size / 1024).toFixed(1)} KB</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm" onClick={() => viewReportContent(r.path)}>📄 查看</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteReport(r.filename)}>🗑 删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 模板管理弹窗（逗号分隔） */}
      {showTemplate && (
        <div className="modal-overlay" onClick={() => setShowTemplate(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚙ 巡检额外命令</h3>
              <button className="modal-close" onClick={() => setShowTemplate(false)}>×</button>
            </div>
            <div className="modal-body">
              {templateMsg && <div className={`alert ${templateMsg.includes('失败') || templateMsg.includes('错误') ? 'alert-error' : 'alert-success'}`}>{templateMsg}</div>}
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                输入额外执行的命令，用逗号隔开（执行默认命令后会继续执行这些命令）
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, background: '#f5f5f5', padding: '8px 12px', borderRadius: 6 }}>
                示例：<br/>display logbuffer, display current-configuration | section bgp, display ip routing-table
              </div>
              <textarea value={templateCmds} onChange={e => setTemplateCmds(e.target.value)}
                placeholder="display logbuffer, display current-configuration | section bgp"
                style={{ width: '100%', minHeight: 80, padding: 12, border: '1px solid var(--border-color)',
                  borderRadius: 6, fontFamily: 'Consolas, monospace', fontSize: 13, resize: 'vertical' }} />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={clearTemplate}>清除</button>
              <button className="btn" onClick={() => setShowTemplate(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveTemplate}>保存</button>
            </div>
          </div>
        </div>
      )}

      {viewReport && (
        <div className="modal-overlay" onClick={() => setViewReport(null)}>
          <div className="modal" style={{ maxWidth: 900, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>📋 巡检报告</h3><button className="modal-close" onClick={() => setViewReport(null)}>×</button></div>
            <div className="modal-body"><div className="code-block">{reportContent}</div></div>
            <div className="modal-footer"><button className="btn" onClick={() => setViewReport(null)}>关闭</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
