"""
Storage and Vector DB abstractions for Ada Deep Research.
"""
from typing import TYPE_CHECKING

from engine.storage.relational_store import RelationalStore

if TYPE_CHECKING:
    from engine.storage.vector_store import AdaVectorStore

def get_vector_store() -> "AdaVectorStore":
    """Return the shared Qdrant vector-store instance.

    Returns:
        Initialized `AdaVectorStore` singleton.

    Raises:
        RuntimeError: When persistent vector storage or embeddings cannot start.
    """
    from engine.storage.vector_store import get_vector_store as _gvs
    return _gvs()

__all__ = ["RelationalStore", "get_vector_store"]
