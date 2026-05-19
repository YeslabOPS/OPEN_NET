import { useEffect, useState, useRef } from 'react';
import { api, SkillInfo, SkillFileNode } from '../api';

export default function SkillManager() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [fileTree, setFileTree] = useState<SkillFileNode[] | null>(null);
  const [previewSkill, setPreviewSkill] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewPath, setPreviewPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSkills = () => {
    setLoading(true);
    api.getSkills().then(res => {
      if (res.success && res.data) setSkills(res.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { loadSkills(); }, []);

  // 选择文件时自动填入技能包名称
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.zip') && !uploadName.trim()) {
      // 从文件名提取技能包名称（去掉 .zip 后缀）
      const nameFromFile = file.name.replace(/\.zip$/i, '');
      setUploadName(nameFromFile);
    }
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !uploadName.trim()) return;
    if (!file.name.endsWith('.zip')) {
      alert('请上传 ZIP 文件');
      return;
    }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const data = (reader.result as string).split(',')[1];
          resolve(data);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await api.uploadSkill(uploadName.trim(), base64);
      if (res.success) {
        setUploadName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        loadSkills();
      } else {
        alert(`上传失败: ${res.error}`);
      }
    } catch (e: any) {
      alert(`上传失败: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`确定要删除技能包 "${name}" 吗？`)) return;
    const res = await api.deleteSkill(name);
    if (res.success) {
      loadSkills();
    } else {
      alert(`删除失败: ${res.error}`);
    }
  };

  const handlePreview = async (name: string) => {
    setPreviewSkill(name);
    setFileTree(null);
    setPreviewContent('');
    setPreviewPath('');
    const res = await api.getSkillTree(name);
    if (res.success && res.data) {
      setFileTree(res.data);
    }
  };

  const handleFileClick = async (skill: string, filePath: string) => {
    setPreviewPath(filePath);
    setPreviewContent('加载中...');
    const res = await api.readSkillFile(skill, filePath);
    if (res.success && res.data) {
      setPreviewContent(res.data);
    } else if (res.error) {
      setPreviewContent(`[无法预览] ${res.error}`);
    }
  };

  const renderFileTree = (nodes: SkillFileNode[], skill: string, parentPath = '') => {
    return (
      <ul className="skill-tree-list">
        {nodes.map(node => {
          const path = parentPath ? `${parentPath}/${node.name}` : node.name;
          if (node.type === 'dir') {
            return (
              <li key={path} className="skill-tree-dir">
                <span className="skill-tree-icon">📁</span>
                <span>{node.name}</span>
                {node.children && renderFileTree(node.children, skill, path)}
              </li>
            );
          }
          return (
            <li key={path} className={`skill-tree-file ${previewPath === path ? 'active' : ''}`}>
              <span className="skill-tree-file-btn" onClick={() => handleFileClick(skill, path)}>
                <span className="skill-tree-icon">📄</span>
                <span>{node.name}</span>
                <span className="skill-tree-size">({node.size}B)</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="skill-manager">
      <div className="skill-header">
        <h2>技能管理</h2>
        <div className="skill-count">{skills.length} 个技能</div>
      </div>

      {/* 上传区域 */}
      <div className="skill-upload-zone">
        <div className="skill-upload-row">
          <input
            type="text"
            className="skill-upload-name"
            placeholder="技能包名称"
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="skill-upload-file"
            onChange={handleFileChange}
          />
          <button
            className="skill-upload-btn"
            onClick={handleUpload}
            disabled={!uploadName.trim() || uploading}
          >
            {uploading ? '上传中...' : '上传技能包'}
          </button>
        </div>
      </div>

      {/* 技能列表 */}
      {loading ? (
        <div className="skill-loading">加载中...</div>
      ) : skills.length === 0 ? (
        <div className="skill-empty">暂无已安装的技能包，请上传 ZIP 文件。</div>
      ) : (
        <div className="skill-grid">
          {skills.map(skill => (
            <div key={skill.name} className="skill-card">
              <div className="skill-card-icon">🧩</div>
              <div className="skill-card-name">{skill.name}</div>
              <div className="skill-card-meta">
                {skill.files} 个文件 · {(skill.size / 1024).toFixed(1)}KB
              </div>
              <div className="skill-card-actions">
                <button className="skill-card-btn view" onClick={() => handlePreview(skill.name)}>
                  查看文件
                </button>
                <button className="skill-card-btn delete" onClick={() => handleDelete(skill.name)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 文件树弹窗 */}
      {previewSkill && (
        <div className="skill-overlay" onClick={() => { setPreviewSkill(null); setFileTree(null); setPreviewContent(''); }}>
          <div className="skill-dialog" onClick={e => e.stopPropagation()}>
            <div className="skill-dialog-header">
              <h3>📦 {previewSkill}</h3>
              <button className="skill-dialog-close" onClick={() => { setPreviewSkill(null); setFileTree(null); setPreviewContent(''); }}>✕</button>
            </div>
            <div className="skill-dialog-body">
              <div className="skill-dialog-tree">
                <div className="skill-dialog-tree-title">文件结构</div>
                {fileTree ? renderFileTree(fileTree, previewSkill) : <div>加载中...</div>}
              </div>
              <div className="skill-dialog-preview">
                <div className="skill-dialog-preview-title">
                  {previewPath || '点击左侧文件预览'}
                </div>
                <pre className="skill-dialog-preview-content">
                  {previewContent || ''}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
