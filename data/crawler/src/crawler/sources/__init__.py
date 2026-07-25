"""数据源注册表。"""

from __future__ import annotations

from crawler.sources.base import CollectRequest, DataSource
from crawler.sources.csv_import import CsvImportSource
from crawler.sources.platform import PlatformSource
from crawler.sources.sample import SampleSource

SOURCES: dict[str, DataSource] = {
    PlatformSource.name: PlatformSource(),
    SampleSource.name: SampleSource(),
    CsvImportSource.name: CsvImportSource(),
}


def get_source(name: str) -> DataSource:
    if name not in SOURCES:
        known = ", ".join(sorted(SOURCES))
        raise KeyError(f"未知数据源 {name!r}，可选: {known}")
    return SOURCES[name]


__all__ = [
    "CollectRequest",
    "DataSource",
    "SOURCES",
    "get_source",
]
