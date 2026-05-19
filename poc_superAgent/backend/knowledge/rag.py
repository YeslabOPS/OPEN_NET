"""RAG 检索 - 基于 ChromaDB 的向量检索"""
import os
import logging
from typing import Optional
import chromadb
from chromadb.config import Settings as ChromaSettings
from config import settings

logger = logging.getLogger(__name__)

# 知识库路径
KNOWLEDGE_BASE = settings.knowledge_base_path
CHROMA_PATH = os.path.join(KNOWLEDGE_BASE, "chroma_db")


class RAGEngine:
    """RAG 检索引擎"""

    def __init__(self, persist_path: str = None):
        self.persist_path = persist_path or CHROMA_PATH
        os.makedirs(self.persist_path, exist_ok=True)

        # 初始化 ChromaDB 客户端（持久化模式）
        self.client = chromadb.PersistentClient(
            path=self.persist_path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )

        # 获取或创建集合
        self.collection_name = "knowledge_wiki"

        # 尝试获取已有集合，或创建新集合
        try:
            self.collection = self.client.get_collection(self.collection_name)
            logger.info(f"Loaded existing collection: {self.collection_name}")
        except (ValueError, chromadb.errors.NotFoundError):
            self.collection = self.client.create_collection(
                name=self.collection_name,
                metadata={"description": "Super Agent Knowledge Wiki"},
            )
            logger.info(f"Created new collection: {self.collection_name}")

    # ── 文本分块 ──────────────────────────────────────────

    @staticmethod
    def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
        """将文本分块"""
        chunks = []
        if not text:
            return chunks

        # 按段落分割
        paragraphs = text.split("\n\n")
        current_chunk = ""
        current_len = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            para_len = len(para)

            # 如果当前块为空，直接开始
            if current_len == 0:
                current_chunk = para
                current_len = para_len
            # 如果加上新段落不超过限制，追加
            elif current_len + para_len < chunk_size:
                current_chunk += "\n\n" + para
                current_len += para_len
            else:
                # 保存当前块，开始新块（带重叠）
                chunks.append(current_chunk)
                # 对新块添加重叠内容（取最后一段）
                sentences = current_chunk.split("。")
                overlap_text = "。".join(sentences[-2:]) if len(sentences) > 2 else current_chunk
                current_chunk = overlap_text + "\n\n" + para
                current_len = len(overlap_text) + para_len

        # 保存最后一块
        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    # ── 索引管理 ──────────────────────────────────────────

    def index_wiki(self, wiki_dir: str) -> int:
        """索引 Wiki 目录下的所有编译文档"""
        if not os.path.exists(wiki_dir):
            logger.warning(f"Wiki directory not found: {wiki_dir}")
            return 0

        indexed_count = 0
        for filename in os.listdir(wiki_dir):
            if filename.endswith(".md"):
                filepath = os.path.join(wiki_dir, filename)
                doc_id = filename.replace(".md", "")

                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()

                # 分块
                chunks = self.chunk_text(content)
                if not chunks:
                    continue

                # 生成 ID
                chunk_ids = [f"{doc_id}_{i}" for i in range(len(chunks))]

                prepared_ids = []
                prepared_docs = []
                prepared_metas = []

                for i, (cid, chunk) in enumerate(zip(chunk_ids, chunks)):
                    prepared_ids.append(cid)
                    prepared_docs.append(chunk)
                    prepared_metas.append({"doc_id": doc_id, "chunk_index": i})

                # 添加/更新到集合
                try:
                    # 检查是否已有这些 ID
                    existing_ids = set()
                    try:
                        existing = self.collection.get(ids=prepared_ids)
                        if existing and existing["ids"]:
                            existing_ids = set(existing["ids"])
                    except Exception:
                        pass

                    new_ids = [id_ for id_ in prepared_ids if id_ not in existing_ids]
                    new_docs = [chunk for id_, chunk in zip(prepared_ids, prepared_docs) if id_ not in existing_ids]
                    new_metas = [meta for id_, meta in zip(prepared_ids, prepared_metas) if id_ not in existing_ids]

                    if new_ids:
                        self.collection.add(
                            ids=new_ids,
                            documents=new_docs,
                            metadatas=new_metas,
                        )

                    indexed_count += len(prepared_ids)
                    logger.info(f"Indexed {doc_id}: {len(prepared_ids)} chunks")

                except Exception as e:
                    logger.error(f"Failed to index {doc_id}: {e}")

        logger.info(f"Indexing complete: {indexed_count} chunks indexed")
        return indexed_count

    def add_document(self, doc_id: str, content: str) -> int:
        """添加单个文档到索引"""
        chunks = self.chunk_text(content)
        if not chunks:
            return 0

        chunk_ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id, "chunk_index": i} for i in range(len(chunks))]

        self.collection.add(
            ids=chunk_ids,
            documents=chunks,
            metadatas=metadatas,
        )

        logger.info(f"Added document {doc_id}: {len(chunks)} chunks")
        return len(chunks)

    def delete_document(self, doc_id: str) -> int:
        """删除文档的所有分块"""
        try:
            # 查询所有匹配的 ID
            results = self.collection.get(where={"doc_id": doc_id})
            if results and results["ids"]:
                self.collection.delete(ids=results["ids"])
                deleted_count = len(results["ids"])
                logger.info(f"Deleted document {doc_id}: {deleted_count} chunks removed")
                return deleted_count
            return 0
        except Exception as e:
            logger.error(f"Failed to delete {doc_id}: {e}")
            return 0

    def clear_all(self):
        """清空所有索引"""
        try:
            self.client.delete_collection(self.collection_name)
            self.collection = self.client.create_collection(
                name=self.collection_name,
                metadata={"description": "Super Agent Knowledge Wiki"},
            )
            logger.info("Cleared all indexes")
        except Exception as e:
            logger.error(f"Failed to clear indexes: {e}")

    # ── 查询 ──────────────────────────────────────────────

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        """检索相关知识"""
        try:
            total = self.collection.count()
            if total == 0:
                return []
            
            n_results = min(top_k, total)
            results = self.collection.query(
                query_texts=[question],
                n_results=n_results,
                include=["documents", "metadatas", "distances"],
            )

            if not results or not results["ids"][0]:
                return []

            items = []
            for i in range(len(results["ids"][0])):
                items.append({
                    "id": results["ids"][0][i],
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else 0,
                })

            return items

        except Exception as e:
            logger.error(f"RAG query failed: {e}")
            return []

    def count(self) -> int:
        """获取文档总数"""
        return self.collection.count()


# 全局实例
rag_engine = RAGEngine()
