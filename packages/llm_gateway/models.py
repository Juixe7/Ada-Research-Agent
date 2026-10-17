from typing import Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

ModelGroup = Literal["small", "large", "write", "judge"]


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class LLMResult(BaseModel):
    content: str = ""
    parsed: Optional[Any] = None
    model: str = ""
    group: str = "small"
    usage: TokenUsage = Field(default_factory=TokenUsage)
    latency_ms: float = 0.0
    cost_estimate: float = 0.0
    cache_hit: bool = False
    degraded: bool = False
    error: Optional[str] = None


class RunContext(BaseModel):
    run_id: Optional[str] = None
    agent_name: Optional[str] = None
    trace_id: Optional[str] = None
    user_id: Optional[str] = None
