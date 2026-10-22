"""Typed Pydantic data transfer objects for model groups, usage, results, and run context.

"""

from typing import Optional, Any, Literal
from pydantic import BaseModel, Field

ModelGroup = Literal["small", "large", "write", "judge"]


class TokenUsage(BaseModel):
    """Input, output, and total token counts for a model completion."""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class LLMResult(BaseModel):
    """Completion text, parsed output, provider metadata, usage, and error state."""
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
    """Optional identity and tracing metadata associated with one LLM call."""
    run_id: Optional[str] = None
    agent_name: Optional[str] = None
    trace_id: Optional[str] = None
    user_id: Optional[str] = None
