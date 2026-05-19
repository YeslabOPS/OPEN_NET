import { useState, useEffect, useCallback } from 'react';
import { api, BackupFile, DiffResult } from '../api';

interface DiffLine {
  type: 'same' | 'add' | 'remove' | 'context';
  oldNum: number;
  newNum: number;
  text: string;
}

function parseDiff(diff: string[], oldName: string, newName: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let inHunk = false;

  for (const line of diff) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue; // 文件名头
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      // @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLineNum = parseInt(match[1]) - 1;
        newLineNum = parseInt(match[2]) - 1;
      }
      continue;
    }
    if (!inHunk) continue;

    const content = line.substring(1);
    if (line.startsWith(' ')) {
      oldLineNum++;
      newLineNum++;
      lines.push({ type: 'same', oldNum: oldLineNum, newNum: newLineNum, text: content });
    } else if (line.startsWith('+')) {
      newLineNum++;
      lines.push({ type: 'add', oldNum: 0, newNum: newLineNum, text: content });
    } else if (line.startsWith('-')) {
      oldLineNum++;
      lines.push({ type: 'remove', oldNum: oldLineNum, newNum: 0, text: content });
    } else {
      lines.push({ type: 'context', oldNum: 0, newNum: 0, text: line });
    }
  }
  return lines;
}

/** 将 diff 行转换为双栏渲染数据 */
function buildColumns(parsed: DiffLine[]) {
  interface ColRow { oldNum: number; newNum: number; oldText: string; newText: string; type: string; }
  const cols: ColRow[] = [];

  let i = 0;
  while (i < parsed.length) {
    const cur = parsed[i];
    if (cur.type === 'same') {
      cols.push({ oldNum: cur.oldNum, newNum: cur.newNum, oldText: cur.text, newText: cur.text, type: 'same' });
      i++;
    } else if (cur.type === 'add') {
      cols.push({ oldNum: 0, newNum: cur.newNum, oldText: '', newText: cur.text, type: 'add' });
      i++;
    } else if (cur.type === 'remove') {
      // 检查下一行是否是 add（表示修改）
      if (i + 1 < parsed.length && parsed[i + 1].type === 'add') {
        cols.push({
          oldNum: cur.oldNum, newNum: parsed[i + 1].newNum,
          oldText: cur.text, newText: parsed[i + 1].text, type: 'modify'
        });
        i += 2;
      } else {
        cols.push({ oldNum: cur.oldNum, newNum: 0, oldText: cur.text, newText: '', type: 'remove' });
        i++;
      }
    } else {
      i++;
    }
  }
  return cols;
}

export default function ConfigDiff() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [baselines, setBaselines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOld, setSelectedOld] = useState('');
  const [selectedNew, setSelectedNew] = useState('');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState<any[]>([]);
  const [showOnlyBaseline, setShowOnlyBaseline] = useState(true);

  // 过滤后的备份列表（旧配置只显示基线）
  const baselineBackups = showOnlyBaseline
    ? backups.filter(f => baselines.includes(f.filename))
    : backups;

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, blRes] = await Promise.all([api.getBackupList(), api.getBaseline()]);
    if (bRes.success && bRes.data) {
      setBackups(bRes.data);
      if (bRes.data.length >= 2) {
        // 基线列表优先作为旧配置
        if (blRes.success && blRes.data && blRes.data.length > 0) {
          setSelectedOld(blRes.data[0]);
        } else {
          setSelectedOld(bRes.data[bRes.data.length - 1].filename);
        }
        setSelectedNew(bRes.data[0].filename);
      }
    }
    if (blRes.success) setBaselines(blRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runDiff = async () => {
    if (!selectedOld || !selectedNew) { setError('请选择两个备份文件'); return; }
    if (selectedOld === selectedNew) { setError('请选择不同的文件'); return; }
    setDiffLoading(true);
    setError('');
    setDiffResult(null);
    setColumns([]);
    const res = await api.diffCompare(selectedOld, selectedNew);
    if (res.success && res.data) {
      setDiffResult(res.data);
      const parsed = parseDiff(res.data.diff, res.data.old_name, res.data.new_name);
      setColumns(buildColumns(parsed));
    } else {
      setError(res.error || '对比失败');
    }
    setDiffLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>配置对比</h2>
        <p>双栏对比备份文件差异，变更行自动标红</p>
      </div>

      <div className="card">
        <div className="card-title">选择对比文件</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              旧配置 {showOnlyBaseline ? `(仅基线 ${baselines.length} 个)` : '(全部)'}
              <button className="btn btn-sm" style={{ marginLeft: 8, fontSize: 11 }}
                onClick={() => setShowOnlyBaseline(!showOnlyBaseline)}>
                {showOnlyBaseline ? '显示全部' : '仅基线'}
              </button>
            </div>
            <select value={selectedOld} onChange={e => setSelectedOld(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid var(--border-color)', borderRadius: 6 }}>
              {(showOnlyBaseline && baselineBackups.length > 0 ? baselineBackups : backups).map(f => (
                <option key={f.filename} value={f.filename}>
                  {f.filename} {baselines.includes(f.filename) ? '⭐' : ''}
                </option>
              ))}
            </select>
            {showOnlyBaseline && baselineBackups.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>暂无基线，请在备份页设置</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>新配置</div>
            <select value={selectedNew} onChange={e => setSelectedNew(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid var(--border-color)', borderRadius: 6 }}>
              {backups.filter(f => f.filename !== selectedOld).map(f => (
                <option key={f.filename} value={f.filename}>
                  {f.filename} {baselines.includes(f.filename) ? '⭐' : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={runDiff} disabled={diffLoading} style={{ height: 38 }}>
            {diffLoading ? '⏳ 对比中...' : '📊 开始对比'}
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {diffResult && (
        <>
          <div className="card">
            <div className="card-title">对比结果</div>
            {diffResult.has_changes ? (
              <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="stat-card"><div className="stat-value" style={{color:'var(--danger)'}}>{diffResult.removed}</div><div className="stat-label">删除/修改行</div></div>
                <div className="stat-card"><div className="stat-value" style={{color:'var(--success)'}}>{diffResult.added}</div><div className="stat-label">新增行</div></div>
                <div className="stat-card"><div className="stat-value" style={{color:'var(--warning)'}}>{diffResult.changed_blocks}</div><div className="stat-label">变更块</div></div>
              </div>
            ) : (
              <div className="alert alert-success" style={{ margin: 0 }}>两份配置文件完全一致，无变更。</div>
            )}
          </div>

          {/* 双栏对比 */}
          {columns.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)' }}>
                <div style={{ flex: 1, padding: '10px 16px', fontWeight: 600, fontSize: 13, background: '#fafafa', borderRight: '1px solid var(--border-color)' }}>
                  📄 旧: {diffResult.old_name}
                </div>
                <div style={{ flex: 1, padding: '10px 16px', fontWeight: 600, fontSize: 13, background: '#fafafa' }}>
                  📄 新: {diffResult.new_name}
                </div>
              </div>
              <div style={{ display: 'flex', fontFamily: 'Consolas, "Courier New", monospace', fontSize: 12, lineHeight: 1.6, maxHeight: 600, overflow: 'auto' }}>
                {/* 左栏 - 旧配置 */}
                <div style={{ flex: 1, borderRight: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  {columns.map((col, idx) => (
                    <div key={idx} style={{
                      display: 'flex', minHeight: 20,
                      background: col.type === 'remove' ? '#fff1f0' : col.type === 'modify' ? '#fff1f0' : 'transparent',
                    }}>
                      <span style={{
                        width: 48, textAlign: 'right', paddingRight: 8, userSelect: 'none',
                        color: '#999', background: col.type === 'remove' || col.type === 'modify' ? '#ffccc7' : '#f5f5f5',
                        borderRight: '1px solid var(--border-color)', flexShrink: 0,
                      }}>
                        {col.oldNum || ''}
                      </span>
                      <span style={{
                        flex: 1, paddingLeft: 8, whiteSpace: 'pre', overflow: 'hidden',
                        background: col.type === 'remove' ? '#ffd8d8' : col.type === 'modify' ? '#ffd8d8' : 'transparent',
                        color: col.type === 'remove' || col.type === 'modify' ? '#820014' : undefined,
                      }}>
                        {col.type === 'add' ? '' : col.oldText}
                      </span>
                    </div>
                  ))}
                </div>
                {/* 右栏 - 新配置 */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {columns.map((col, idx) => (
                    <div key={idx} style={{
                      display: 'flex', minHeight: 20,
                      background: col.type === 'add' ? '#f6ffed' : col.type === 'modify' ? '#fff1f0' : 'transparent',
                    }}>
                      <span style={{
                        width: 48, textAlign: 'right', paddingRight: 8, userSelect: 'none',
                        color: '#999', background: col.type === 'add' ? '#b7eb8f' : col.type === 'modify' ? '#ffccc7' : '#f5f5f5',
                        borderRight: '1px solid var(--border-color)', flexShrink: 0,
                      }}>
                        {col.newNum || ''}
                      </span>
                      <span style={{
                        flex: 1, paddingLeft: 8, whiteSpace: 'pre', overflow: 'hidden',
                        background: col.type === 'add' ? '#d9f7be' : col.type === 'modify' ? '#ffd8d8' : 'transparent',
                        color: col.type === 'add' ? '#135200' : col.type === 'modify' ? '#820014' : undefined,
                      }}>
                        {col.type === 'remove' ? '' : col.newText}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!diffResult && !diffLoading && (
        <div className="card">
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <div className="empty-state-icon">📊</div>
            <p>选择新旧配置后点击"开始对比"</p>
          </div>
        </div>
      )}
    </div>
  );
}
