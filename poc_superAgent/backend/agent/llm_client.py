"""LLM 客户端 - DeepSeek API 调用封装"""
import httpx
import logging
from typing import AsyncIterator, Optional
from config import settings

logger = logging.getLogger(__name__)


class DeepSeekLLM:
    """DeepSeek LLM 客户端"""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.api_key = api_key or settings.deepseek_api_key
        self.base_url = base_url or settings.deepseek_base_url
        self.model = model or settings.deepseek_model
        self.max_tokens = settings.llm_max_tokens
        self.timeout = settings.llm_timeout
        
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY is required")
    
    @property
    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
    
    async def generate(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        stream: bool = False,
    ) -> dict | AsyncIterator[dict]:
        """生成文本"""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": self.max_tokens,
            "stream": stream,
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            if stream:
                async def stream_response():
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/chat/completions",
                        headers=self.headers,
                        json=payload,
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data = line[6:]
                                if data.strip() == "[DONE]":
                                    break
                                yield data
                
                return stream_response()
            else:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
    
    async def chat(self, prompt: str, history: list[dict] = None) -> str:
        """简单对话"""
        messages = history or []
        messages.append({"role": "user", "content": prompt})
        
        response = await self.generate(messages)
        return response["choices"][0]["message"]["content"]
    
    async def chat_stream(self, prompt: str, history: list[dict] = None) -> AsyncIterator[str]:
        """流式对话"""
        messages = history or []
        messages.append({"role": "user", "content": prompt})
        
        stream = await self.generate(messages, stream=True)
        async for line in stream:
            import json
            try:
                data = json.loads(line)
                delta = data.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    yield content
            except json.JSONDecodeError:
                continue


# 全局 LLM 实例
llm_client = DeepSeekLLM()
