import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export const skillsRouter = Router();

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');

// 确保 skills 目录存在
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

/**
 * POST /api/skills/upload
 * 上传技能包 ZIP(Base64) - 直接用 adm-zip 解压
 */
skillsRouter.post('/upload', async (req: Request, res: Response) => {
  const { name, data } = req.body;
  if (!name || !data) {
    res.status(400).json({ success: false, error: '缺少参数: name, data' });
    return;
  }
  try {
    const safeName = path.basename(name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, ''));
    const targetDir = path.join(SKILLS_DIR, safeName);

    // 清空已有目录
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }

    // 用 adm-zip 直接解压 base64 数据
    const zip = new AdmZip(Buffer.from(data, 'base64'));
    zip.extractAllTo(targetDir, true);

    // 统计文件数
    let fileCount = 0;
    function countFiles(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile()) fileCount++;
        else if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
      }
    }
    if (fs.existsSync(targetDir)) countFiles(targetDir);

    res.json({ success: true, data: { name: safeName, files: fileCount } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: `上传失败: ${e.message}` });
  }
});

/**
 * GET /api/skills
 * 获取已安装技能列表
 */
skillsRouter.get('/', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      res.json({ success: true, data: [] });
      return;
    }
    const skills: any[] = [];
    for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(SKILLS_DIR, entry.name);
      let fileCount = 0;
      let totalSize = 0;
      function walk(dir: string) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, e.name);
          if (e.isFile()) {
            fileCount++;
            totalSize += fs.statSync(fullPath).size;
          } else if (e.isDirectory()) {
            walk(fullPath);
          }
        }
      }
      walk(dirPath);
      skills.push({
        name: entry.name,
        files: fileCount,
        size: totalSize,
        modified: fs.statSync(dirPath).mtimeMs,
      });
    }
    skills.sort((a, b) => b.modified - a.modified);
    res.json({ success: true, data: skills });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/skills/:name
 * 删除指定技能包
 */
skillsRouter.delete('/:name', (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.name);
    const targetDir = path.join(SKILLS_DIR, safeName);
    if (!fs.existsSync(targetDir)) {
      res.status(404).json({ success: false, error: '技能包不存在' });
      return;
    }
    fs.rmSync(targetDir, { recursive: true });
    res.json({ success: true, data: `已删除: ${safeName}` });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/skills/:name/tree
 * 获取技能包文件树
 */
skillsRouter.get('/:name/tree', (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.name);
    const targetDir = path.join(SKILLS_DIR, safeName);
    if (!fs.existsSync(targetDir)) {
      res.status(404).json({ success: false, error: '技能包不存在' });
      return;
    }
    function buildTree(dir: string): any[] {
      const entries: any[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })) {
        if (e.name.startsWith('.')) continue;
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
          entries.push({ name: e.name, type: 'dir', children: buildTree(fullPath) });
        } else {
          entries.push({ name: e.name, type: 'file', size: fs.statSync(fullPath).size });
        }
      }
      return entries;
    }
    res.json({ success: true, data: buildTree(targetDir) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/skills/:name/read/:path(*)
 * 读取技能包内文件内容
 */
skillsRouter.get('/:name/read/:path(*)', (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.name);
    const targetDir = path.join(SKILLS_DIR, safeName);
    const fullPath = path.resolve(targetDir, req.params.path);
    // 安全校验：禁止路径穿越
    if (!fullPath.startsWith(path.resolve(targetDir))) {
      res.status(403).json({ success: false, error: '路径穿越拒绝访问' });
      return;
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.status(404).json({ success: false, error: '文件不存在' });
      return;
    }
    // 尝试读取文本
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ success: true, data: content });
    } catch {
      res.json({ success: false, error: '不支持读取二进制文件', data: { binary: true, path: req.params.path } });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
