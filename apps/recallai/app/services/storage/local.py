"""Local disk storage for uploads."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class StorageProvider(Protocol):
    name: str

    def save(self, group_id: str, filename: str, data: bytes) -> str: ...

    def read(self, path: str) -> bytes: ...


class LocalStorageProvider:
    name = "local"

    def __init__(self, root: str) -> None:
        self.root = Path(root)

    def save(self, group_id: str, filename: str, data: bytes) -> str:
        # The name is rebuilt from a uuid and the suffix only: an uploaded name
        # is attacker-controlled and must never steer the path.
        suffix = Path(filename).suffix[:16]
        directory = self.root / str(group_id)
        directory.mkdir(parents=True, exist_ok=True)

        target = directory / f"{uuid.uuid4().hex}{suffix}"
        target.write_bytes(data)
        return str(target)

    def read(self, path: str) -> bytes:
        return Path(path).read_bytes()
