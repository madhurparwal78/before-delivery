"""The built-in connector catalog and the one place catalog search is decided."""

from __future__ import annotations

from dataclasses import dataclass

@dataclass(frozen=True)
class ConnectorDefinition:
    name: str
    type: str
    category: str
    availability: tuple[str, ...]
    runnable: bool

    @property
    def slug(self) -> str:
        return self.name.lower().replace(" ", "-")

    @property
    def id(self) -> str:
        return self.slug


BUILT_IN_DEFINITIONS: tuple[ConnectorDefinition, ...] = (
    ConnectorDefinition("Sample Commerce API", "source", "Finance & Ops Analytics", ("cloud", "oss", "hybrid"), True),
    ConnectorDefinition("PostgreSQL", "source", "Databases", ("cloud", "oss", "hybrid"), False),
    ConnectorDefinition("MySQL", "source", "Databases", ("cloud", "oss", "hybrid"), False),
    ConnectorDefinition("MongoDB", "source", "Databases", ("cloud", "oss"), False),
    ConnectorDefinition("Ticket Desk", "source", "Sales & Support Analytics", ("cloud", "hybrid"), False),
    ConnectorDefinition("CRM Cloud", "source", "Sales & Support Analytics", ("cloud",), False),
    ConnectorDefinition("Ad Network", "source", "Marketing Analytics", ("cloud", "oss"), False),
    ConnectorDefinition("Product Events", "source", "Product Analytics", ("cloud", "oss", "hybrid"), False),
    ConnectorDefinition("File Drop CSV", "source", "Files", ("cloud", "oss", "hybrid"), False),
    ConnectorDefinition("Issue Tracker", "source", "Engineering Analytics", ("cloud", "oss"), False),
    ConnectorDefinition("Docs Workspace", "source", "Unstructured", ("cloud",), False),
    ConnectorDefinition("Team Calendar", "source", "Others", ("oss",), False),
    ConnectorDefinition("Wayline Warehouse", "destination", "Warehouses and Lakes", ("cloud", "oss", "hybrid"), True),
    ConnectorDefinition("Cloud Warehouse", "destination", "Warehouses and Lakes", ("cloud", "hybrid"), False),
    ConnectorDefinition("Lakehouse Tables", "destination", "Warehouses and Lakes", ("cloud", "oss"), False),
    ConnectorDefinition("Object Storage", "destination", "Files", ("cloud", "oss", "hybrid"), False),
    ConnectorDefinition("Vector Store", "destination", "Unstructured", ("cloud",), False),
)

SAMPLE_COMMERCE_ID = "sample-commerce-api"
WAYLINE_WAREHOUSE_ID = "wayline-warehouse"


def search_matches(query: str, name: str) -> bool:
    """Catalog search: a literal, case-insensitive substring of the definition name."""
    return query.casefold() in name.casefold()
