"""知识库工具 - 供 Agent 调用的知识库查询工具"""
import logging
from knowledge import wiki_engine, rag_engine

logger = logging.getLogger(__name__)


async def search_knowledge(query: str) -> str:
    """搜索知识库 - 先尝试 RAG 向量检索，再回退到 Wiki 引擎查询
    
    Args:
        query: 用户查询问题
        
    Returns:
        知识库查询结果
    """
    logger.info(f"Knowledge search: {query}")
    
    try:
        # 1. 先尝试 RAG 向量检索
        results = rag_engine.query(query, top_k=3)
        if results:
            context_parts = []
            for r in results:
                context_parts.append(f"[{r['metadata']['doc_id']}]\n{r['content']}")
            context = "\n\n---\n\n".join(context_parts)
            
            answer = await wiki_engine.query(query)
            return f"【知识库查询结果】\n\n{answer}"
        
        # 2. 回退到 Wiki 引擎查询（直接 LLM 回答）
        answer = await wiki_engine.query(query)
        if "暂无" not in answer:
            return f"【知识库查询结果】\n\n{answer}"
        
        return "知识库中没有找到相关信息，请稍后重试或补充文档。"
    
    except Exception as e:
        logger.error(f"Knowledge search failed: {e}")
        return f"知识库查询出错: {str(e)}"


async def list_knowledge_docs() -> str:
    """列出知识库中的所有文档
    
    Returns:
        文档列表
    """
    docs = wiki_engine.list_documents()
    if not docs:
        return "知识库为空"
    
    lines = ["知识库文档列表：\n"]
    for doc in docs:
        status = "✅ 已编译" if doc.get("compiled") else "⏳ 未编译"
        lines.append(f"- {doc['title']} ({doc['id']}) {status}")
    
    return "\n".join(lines)
