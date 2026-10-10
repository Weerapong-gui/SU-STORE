"""Process-wide state shared by the route functions."""
from __future__ import annotations

import threading

visitor_registry: dict[str, float] = {}
VISITOR_ACTIVE_SECONDS = 120  # 2 minutes
test_warning_until: float = 0
lock = threading.Lock()
