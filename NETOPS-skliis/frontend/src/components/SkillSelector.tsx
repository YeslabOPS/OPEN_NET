import { useEffect, useState } from 'react';
import { api, SkillInfo } from '../api';

interface SkillSelectorProps {
  selected: string[];
  onChange: (skills: string[]) => void;
}

export default function SkillSelector({ selected, onChange }: SkillSelectorProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getSkills().then(res => {
      if (res.success && res.data) setSkills(res.data);
    }).catch(() => {});
  }, []);

  const toggleSkill = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter(s => s !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  if (skills.length === 0) return null;

  return (
    <div className="ai-panel-section">
      <div className="ai-panel-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>🧩 已加载技能</span>
        {selected.length > 0 && (
          <span style={{
            background: '#3182CE', color: '#fff', borderRadius: '10px',
            padding: '1px 8px', fontSize: '12px', lineHeight: '18px'
          }}>
            {selected.length}
          </span>
        )}
      </div>
      <div className="ai-skill-selector">
        {skills.map(skill => {
          const isActive = selected.includes(skill.name);
          return (
            <label
              key={skill.name}
              className={`ai-skill-item ${isActive ? 'active' : ''}`}
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => toggleSkill(skill.name)}
              />
              <span className="ai-skill-name">{skill.name}</span>
              <span className="ai-skill-count">{skill.files} 文件</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
