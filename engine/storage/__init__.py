"""
Storage and Vector DB abstractions for Ada Deep Research.
"""
from engine.storage.relational_store import RelationalStore

def get_vector_store():
    from engine.storage.vector_store import get_vector_store as _gvs
    return _gvs()

__all__ = ["RelationalStore", "get_vector_store"]
