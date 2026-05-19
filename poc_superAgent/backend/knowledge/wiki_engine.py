"""Wiki 引擎 - Karpathy LLM Wiki 范式实现"""
import json
import os
import logging
import re
from datetime import datetime
from typing import Optional
from config import settings
from agent.llm_client import llm_client

logger = logging.getLogger(__name__)

KNOWLEDGE_BASE = settings.knowledge_base_path
INDEX_PATH = os.path.join(KNOWLEDGE_BASE, "index.json")

# LLM 编译提示词模板
COMPILE_PROMPT = """你是一个专业的网络技术文档编译专家。请将以下原始 Markdown 文档编译为结构化的 Wiki 格式。

原始文档：
{content}

编译要求：
1. 提取核心知识点，删除冗余内容
2. 保持技术准确性，保留关键命令和配置示例
3. 以结构化方式组织内容（目录树 → 知识点 → 详细说明）
4. 为每个知识点添加标签分类
5. 输出格式为结构化 Markdown

请输出编译后的 Wiki 内容：
"""

QUERY_PROMPT = """你是一个网络技术专家。根据以下知识库内容回答用户问题。

相关知识：
{context}

用户问题：{question}

请基于以上知识回答，如果知识库中没有相关信息，请明确说明。回答要简洁专业。
"""


class WikiEngine:
    """Wiki 引擎"""

    def __init__(self, knowledge_base_path: str = None):
        self.kb_path = knowledge_base_path or KNOWLEDGE_BASE
        self.raw_dir = os.path.join(self.kb_path, "raw", "docs")
        self.wiki_dir = os.path.join(self.kb_path, "wiki", "compiled")
        self.index_path = os.path.join(self.kb_path, "index.json")

    # ── 索引管理 ──────────────────────────────────────────

    def load_index(self) -> dict:
        """加载索引"""
        if not os.path.exists(self.index_path):
            return {"version": "1.0", "documents": []}
        with open(self.index_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_index(self, index: dict):
        """保存索引"""
        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
        with open(self.index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

    # ── 文档加载 ──────────────────────────────────────────

    def load_documents(self) -> list[dict]:
        """加载所有原始文档"""
        index = self.load_index()
        documents = []
        for doc in index.get("documents", []):
            raw_path = os.path.join(self.kb_path, doc["path"])
            if os.path.exists(raw_path):
                with open(raw_path, "r", encoding="utf-8") as f:
                    content = f.read()
                documents.append({
                    "id": doc["id"],
                    "title": doc["title"],
                    "content": content,
                    "compiled": doc.get("compiled", False),
                    "compiled_path": doc.get("compiled_path", ""),
                })
        return documents

    def load_document(self, doc_id: str) -> Optional[dict]:
        """加载单个文档"""
        index = self.load_index()
        for doc in index.get("documents", []):
            if doc["id"] == doc_id:
                raw_path = os.path.join(self.kb_path, doc["path"])
                if os.path.exists(raw_path):
                    with open(raw_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    return {
                        "id": doc["id"],
                        "title": doc["title"],
                        "content": content,
                        "compiled": doc.get("compiled", False),
                        "compiled_path": doc.get("compiled_path", ""),
                    }
        return None

    # ── 文档提取 ──────────────────────────────────────────

    @staticmethod
    def extract_sections(content: str) -> list[dict]:
        """提取 Markdown 标题层级结构"""
        sections = []
        lines = content.split("\n")
        current_section = None
        current_content = []

        for line in lines:
            header_match = re.match(r"^(#{1,6})\s+(.+)$", line)
            if header_match:
                # 保存上一节
                if current_section:
                    current_section["content"] = "\n".join(current_content).strip()
                    sections.append(current_section)

                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                current_section = {"level": level, "title": title, "content": ""}
                current_content = []
            else:
                current_content.append(line)

        # 保存最后一节
        if current_section:
            current_section["content"] = "\n".join(current_content).strip()
            sections.append(current_section)

        return sections

    # ── LLM 编译 ──────────────────────────────────────────

    async def compile_document(self, doc: dict) -> str:
        """使用 LLM 编译单个文档为结构化 Wiki"""
        prompt = COMPILE_PROMPT.format(content=doc["content"])
        compiled = await llm_client.chat(prompt=prompt)
        return compiled

    async def save_compiled(self, doc_id: str, compiled: str, output_path: str):
        """保存编译结果"""
        full_path = os.path.join(self.kb_path, output_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(compiled)

    async def compile_all(self, progress_callback=None) -> list[dict]:
        """批量编译所有未编译的文档"""
        documents = self.load_documents()
        results = []

        for i, doc in enumerate(documents):
            if doc["compiled"]:
                logger.info(f"Skipping already compiled: {doc['title']}")
                continue

            logger.info(f"Compiling: {doc['title']}")
            try:
                compiled = await self.compile_document(doc)

                output_path = f"wiki/compiled/{doc['id']}.md"
                await self.save_compiled(doc["id"], compiled, output_path)

                # 更新索引
                index = self.load_index()
                for entry in index["documents"]:
                    if entry["id"] == doc["id"]:
                        entry["compiled"] = True
                        entry["compiled_path"] = output_path
                        entry["created_at"] = datetime.now().isoformat()
                        break
                self.save_index(index)

                results.append({"id": doc["id"], "status": "success"})

                if progress_callback:
                    await progress_callback(i + 1, len(documents))

            except Exception as e:
                logger.error(f"Compile failed for {doc['title']}: {e}")
                results.append({"id": doc["id"], "status": "failed", "error": str(e)})

        return results

    async def compile_one(self, doc_id: str) -> dict:
        """编译单个文档"""
        doc = self.load_document(doc_id)
        if not doc:
            return {"id": doc_id, "status": "failed", "error": "Document not found"}

        compiled = await self.compile_document(doc)
        output_path = f"wiki/compiled/{doc['id']}.md"
        await self.save_compiled(doc["id"], compiled, output_path)

        # 更新索引
        index = self.load_index()
        for entry in index["documents"]:
            if entry["id"] == doc["id"]:
                entry["compiled"] = True
                entry["compiled_path"] = output_path
                entry["created_at"] = datetime.now().isoformat()
                break
        self.save_index(index)

        return {"id": doc_id, "status": "success", "compiled_path": output_path}

    # ── 查询 ──────────────────────────────────────────────

    def list_documents(self) -> list[dict]:
        """列出所有文档（包含编译状态）"""
        index = self.load_index()
        return index.get("documents", [])

    def get_wiki_content(self, doc_id: str) -> Optional[str]:
        """获取编译后的 Wiki 内容"""
        index = self.load_index()
        for doc in index.get("documents", []):
            if doc["id"] == doc_id and doc.get("compiled"):
                path = os.path.join(self.kb_path, doc["compiled_path"])
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f:
                        return f.read()
        return None

    async def query(self, question: str) -> str:
        """查询知识库 - 先找相关文档，再用 LLM 回答"""
        index = self.load_index()
        compiled_docs = [d for d in index["documents"] if d.get("compiled")]

        if not compiled_docs:
            return "知识库中暂无已编译的文档，请先编译文档。"

        # 收集所有编译后的内容
        all_content_parts = []
        for doc in compiled_docs:
            content = self.get_wiki_content(doc["id"])
            if content:
                all_content_parts.append(f"## {doc['title']}\n\n{content}")

        context = "\n\n---\n\n".join(all_content_parts)

        # 用 LLM 根据上下文回答
        prompt = QUERY_PROMPT.format(context=context, question=question)
        try:
            answer = await llm_client.chat(prompt=prompt)
            return answer
        except Exception as e:
            logger.error(f"Query failed: {e}")
            return f"查询失败: {str(e)}"


# 全局实例
wiki_engine = WikiEngine()
