#!/usr/bin/env python3
"""
Generate Entity Relationship Diagrams (ERD) from SQLModel definitions.

Outputs:
  - docs/ERD.md   (Mermaid ER diagram and data dictionary in GitHub Flavored Markdown)
  - docs/erd.html (Self-contained interactive HTML viewer with zoom/pan using Mermaid.js)
  - docs/erd.dot  (Graphviz DOT format for graphviz/PlantUML rendering)

Usage:
  python scripts/generate_erd.py
  python scripts/generate_erd.py --format md
  python scripts/generate_erd.py --output-dir ./database-docs
  python scripts/generate_erd.py --stdout
"""

import os
import sys
import ast
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional, Set

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def simplify_type(type_str: str) -> str:
    """Map python/SQL types to clean ERD friendly type names."""
    type_lower = type_str.lower()
    if any(t in type_lower for t in ["str", "varchar", "text", "uuid"]):
        return "string"
    if any(t in type_lower for t in ["int", "bigint", "smallint"]):
        return "int"
    if any(t in type_lower for t in ["float", "double", "numeric", "decimal"]):
        return "float"
    if any(t in type_lower for t in ["bool"]):
        return "boolean"
    if any(t in type_lower for t in ["datetime", "timestamp", "date"]):
        return "datetime"
    if any(t in type_lower for t in ["json", "dict", "list"]):
        return "json"
    return "string"


def extract_models_via_sqlmodel() -> Optional[List[Dict[str, Any]]]:
    """Inspect models dynamically via SQLModel metadata if available."""
    try:
        # Prevent premature DB connections
        os.environ.setdefault("DATABASE_URL", "postgresql://localhost/dummy")
        from sqlmodel import SQLModel
        import backend.db.sqlmodel_db  # Registers all models

        tables = []
        for table_name, table in SQLModel.metadata.tables.items():
            columns = []
            for col in table.columns:
                col_type = simplify_type(type(col.type).__name__)
                constraints = []
                if col.primary_key:
                    constraints.append("PK")
                if col.unique:
                    constraints.append("UK")
                if col.index and not col.primary_key and not col.unique:
                    constraints.append("INDEX")
                if col.foreign_keys:
                    constraints.append("FK")

                columns.append({
                    "name": col.name,
                    "type": col_type,
                    "raw_type": str(col.type),
                    "primary_key": col.primary_key,
                    "nullable": col.nullable,
                    "constraints": constraints,
                    "foreign_keys": [fk.target_fullname for fk in col.foreign_keys],
                })

            tables.append({
                "table_name": table_name,
                "class_name": table_name.title().replace("_", ""),
                "columns": columns,
            })
        return tables
    except Exception as e:
        return None


def extract_models_via_ast(file_path: Path) -> List[Dict[str, Any]]:
    """Fallback AST parser for SQLModel definitions without requiring dependencies."""
    if not file_path.exists():
        return []

    with open(file_path, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=str(file_path))

    tables = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            # Check if class inherits SQLModel or has table=True keyword
            is_table = False
            for kw in node.keywords:
                if kw.arg == "table" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                    is_table = True
            
            if not is_table:
                continue

            table_name = None
            columns = []

            for item in node.body:
                # Find __tablename__
                if isinstance(item, ast.Assign):
                    for target in item.targets:
                        if isinstance(target, ast.Name) and target.id == "__tablename__":
                            if isinstance(item.value, ast.Constant):
                                table_name = item.value.value

                # Find Field annotations
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    col_name = item.target.id
                    if col_name.startswith("__"):
                        continue

                    # Determine raw type string
                    raw_type = "str"
                    if isinstance(item.annotation, ast.Name):
                        raw_type = item.annotation.id
                    elif isinstance(item.annotation, ast.Subscript):
                        raw_type = ast.unparse(item.annotation)

                    is_pk = False
                    is_unique = False
                    is_indexed = False
                    is_nullable = "optional" in raw_type.lower() or "none" in raw_type.lower()

                    # Inspect Field(...) kwargs if present
                    if isinstance(item.value, ast.Call):
                        for kw in item.value.keywords:
                            if kw.arg == "primary_key" and isinstance(kw.value, ast.Constant):
                                is_pk = bool(kw.value.value)
                            elif kw.arg == "unique" and isinstance(kw.value, ast.Constant):
                                is_unique = bool(kw.value.value)
                            elif kw.arg == "index" and isinstance(kw.value, ast.Constant):
                                is_indexed = bool(kw.value.value)

                    constraints = []
                    if is_pk:
                        constraints.append("PK")
                    if is_unique:
                        constraints.append("UK")
                    if is_indexed:
                        constraints.append("INDEX")

                    columns.append({
                        "name": col_name,
                        "type": simplify_type(raw_type),
                        "raw_type": raw_type,
                        "primary_key": is_pk,
                        "nullable": is_nullable,
                        "constraints": constraints,
                        "foreign_keys": [],
                    })

            if not table_name:
                table_name = node.name.lower()

            tables.append({
                "table_name": table_name,
                "class_name": node.name,
                "columns": columns,
            })

    return tables


def infer_relationships(tables: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Infer relationships from foreign keys and conventional naming patterns
    (e.g., user_id -> users.id).
    """
    table_names = {t["table_name"] for t in tables}
    table_pks = {}
    for t in tables:
        for col in t["columns"]:
            if col["primary_key"]:
                table_pks[t["table_name"]] = col["name"]
                break

    relationships = []
    seen = set()

    for t in tables:
        src_table = t["table_name"]
        for col in t["columns"]:
            col_name = col["name"]
            
            # Check explicit foreign keys
            target_table = None
            if col.get("foreign_keys"):
                for fk in col["foreign_keys"]:
                    target_table = fk.split(".")[0]
                    break

            # Fallback to standard convention: <target>_id (e.g. user_id -> users)
            if not target_table and col_name.endswith("_id") and col_name != "id":
                prefix = col_name[:-3]
                # Check direct plural or singular matching
                candidates = [prefix, f"{prefix}s", f"{prefix}es"]
                for c in candidates:
                    if c in table_names and c != src_table:
                        target_table = c
                        break

            if target_table and target_table in table_names:
                # Mark column as FK
                if "FK" not in col["constraints"]:
                    col["constraints"].append("FK")

                # Determine relationship cardinality
                # If the foreign key is also primary key in this table -> 1:1 (||--||)
                # If unique -> 1:1 (||--||)
                # Else -> 1:N (||--o{)
                if col["primary_key"] or "UK" in col["constraints"]:
                    rel_type = "||--||"
                    label = "has"
                else:
                    rel_type = "||--o{"
                    label = "has"

                rel_key = f"{target_table}-{src_table}-{col_name}"
                if rel_key not in seen:
                    seen.add(rel_key)
                    relationships.append({
                        "source": target_table,
                        "target": src_table,
                        "rel_type": rel_type,
                        "label": label,
                        "fk_column": col_name,
                    })

    return relationships


def generate_mermaid(tables: List[Dict[str, Any]], relationships: List[Dict[str, str]]) -> str:
    """Generate Mermaid erDiagram syntax."""
    lines = ["erDiagram"]

    # Relationships first
    for rel in relationships:
        lines.append(f"    {rel['source'].upper()} {rel['rel_type']} {rel['target'].upper()} : \"{rel['label']}\"")

    if relationships:
        lines.append("")

    # Entity definitions
    for t in tables:
        lines.append(f"    {t['table_name'].upper()} {{")
        for col in t["columns"]:
            col_type = col["type"]
            col_name = col["name"]
            constraint_tag = ""
            if "PK" in col["constraints"]:
                constraint_tag = "PK"
            elif "FK" in col["constraints"]:
                constraint_tag = "FK"
            elif "UK" in col["constraints"]:
                constraint_tag = "UK"

            tag_str = f" {constraint_tag}" if constraint_tag else ""
            lines.append(f"        {col_type} {col_name}{tag_str}")
        lines.append("    }")
        lines.append("")

    return "\n".join(lines)


def generate_markdown(tables: List[Dict[str, Any]], relationships: List[Dict[str, str]]) -> str:
    """Generate complete Markdown documentation including Mermaid diagram and entity dictionary."""
    mermaid_code = generate_mermaid(tables, relationships)
    
    md_lines = [
        "# Database Entity Relationship Diagram (ERD)",
        "",
        "> Auto-generated from SQLModel definitions in `backend/db/sqlmodel_db.py`.",
        "",
        "## Visual Diagram",
        "",
        "```mermaid",
        mermaid_code,
        "```",
        "",
        "## Relationships",
        "",
        "| Source Entity | Relationship | Target Entity | Foreign Key Column | Description |",
        "|---|:---:|---|---|---|",
    ]

    for rel in relationships:
        desc = "One-to-One" if rel["rel_type"] == "||--||" else "One-to-Many"
        md_lines.append(
            f"| `{rel['source']}` | `{rel['rel_type']}` | `{rel['target']}` | `{rel['fk_column']}` | {desc} |"
        )

    if not relationships:
        md_lines.append("| *None explicitly linked* | - | - | - | - |")

    md_lines.extend([
        "",
        "---",
        "",
        "## Entities & Schema Details",
        "",
    ])

    for t in tables:
        md_lines.append(f"### `{t['table_name']}` ({t['class_name']})")
        md_lines.append("")
        md_lines.append("| Column | Type | Constraints | Nullable |")
        md_lines.append("|---|---|---|:---:|")
        for col in t["columns"]:
            constraints_str = ", ".join(col["constraints"]) if col["constraints"] else "-"
            nullable_str = "Yes" if col["nullable"] else "No"
            md_lines.append(f"| `{col['name']}` | `{col['type']}` | {constraints_str} | {nullable_str} |")
        md_lines.append("")

    return "\n".join(md_lines)


def generate_html(tables: List[Dict[str, Any]], relationships: List[Dict[str, str]]) -> str:
    """Generate interactive HTML page with Mermaid.js and Pan/Zoom support."""
    mermaid_code = generate_mermaid(tables, relationships)
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Entity Relationship Diagram</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
  <style>
    :root {{
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --accent: #38bdf8;
    }}
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }}
    header {{
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
    }}
    h1 {{
      font-size: 1.15rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .badge {{
      background: #0284c7;
      color: white;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 9999px;
    }}
    .controls {{
      display: flex;
      gap: 8px;
    }}
    button {{
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.15s;
    }}
    button:hover {{
      background: var(--border);
    }}
    #canvas-container {{
      flex: 1;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle, #1e293b 1px, transparent 1px);
      background-size: 24px 24px;
    }}
    #diagram {{
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    svg {{
      width: 100% !important;
      height: 100% !important;
    }}
  </style>
</head>
<body>
  <header>
    <h1>Entity Relationship Diagram <span class="badge">{len(tables)} Entities</span></h1>
    <div class="controls">
      <button onclick="panZoom.zoomIn()">Zoom In (+)</button>
      <button onclick="panZoom.zoomOut()">Zoom Out (-)</button>
      <button onclick="panZoom.resetZoom(); panZoom.center();">Reset View</button>
    </div>
  </header>
  <div id="canvas-container">
    <div id="diagram" class="mermaid">
{mermaid_code}
    </div>
  </div>
  <script>
    mermaid.initialize({{
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {{
        darkMode: true,
        background: '#0f172a',
        primaryColor: '#1e293b',
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#38bdf8',
        lineColor: '#94a3b8',
        secondaryColor: '#334155',
        tertiaryColor: '#0f172a'
      }}
    }});

    window.addEventListener('load', () => {{
      setTimeout(() => {{
        const svgElement = document.querySelector('#diagram svg');
        if (svgElement) {{
          window.panZoom = svgPanZoom(svgElement, {{
            zoomEnabled: true,
            controlIconsEnabled: false,
            fit: true,
            center: true,
            minZoom: 0.2,
            maxZoom: 10
          }});
        }}
      }}, 500);
    }});
  </script>
</body>
</html>
"""
    return html


def generate_dot(tables: List[Dict[str, Any]], relationships: List[Dict[str, str]]) -> str:
    """Generate Graphviz DOT syntax."""
    lines = [
        "digraph ERD {",
        "  graph [rankdir=LR, bgcolor=\"#0f172a\", fontname=\"Helvetica\"];",
        "  node [shape=none, fontname=\"Helvetica\", fontcolor=\"#ffffff\"];",
        "  edge [color=\"#38bdf8\", fontcolor=\"#94a3b8\", fontname=\"Helvetica\", fontsize=10];",
        "",
    ]

    for t in tables:
        rows = [
            f"<TR><TD COLSPAN=\"2\" BGCOLOR=\"#0284c7\"><B><FONT COLOR=\"#ffffff\">{t['table_name'].upper()}</FONT></B></TD></TR>"
        ]
        for col in t["columns"]:
            pk_mark = " (PK)" if col["primary_key"] else ""
            fk_mark = " (FK)" if col["name"].endswith("_id") and col["name"] != "id" else ""
            rows.append(
                f"<TR><TD BGCOLOR=\"#1e293b\" ALIGN=\"LEFT\">{col['name']}{pk_mark}{fk_mark}</TD>"
                f"<TD BGCOLOR=\"#1e293b\" ALIGN=\"RIGHT\"><FONT COLOR=\"#94a3b8\">{col['type']}</FONT></TD></TR>"
            )

        table_html = (
            f"  {t['table_name']} [label=<<TABLE BORDER=\"1\" CELLBORDER=\"0\" CELLSPACING=\"1\" COLOR=\"#334155\">"
            + "".join(rows)
            + "</TABLE>>];"
        )
        lines.append(table_html)

    lines.append("")
    for rel in relationships:
        lines.append(f"  {rel['source']} -> {rel['target']} [label=\"{rel['label']}\"];")

    lines.append("}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Generate ERD diagrams from SQLModel models.")
    parser.add_argument("--output-dir", default="./docs", help="Target output directory (default: ./docs)")
    parser.add_argument(
        "--format",
        choices=["all", "md", "html", "dot"],
        default="all",
        help="Format to generate: all, md, html, dot (default: all)",
    )
    parser.add_argument("--stdout", action="store_true", help="Print Mermaid diagram to stdout")
    args = parser.parse_args()

    # 1. Try SQLModel introspection, fallback to AST
    models = extract_models_via_sqlmodel()
    if not models:
        sqlmodel_file = PROJECT_ROOT / "backend" / "db" / "sqlmodel_db.py"
        models = extract_models_via_ast(sqlmodel_file)

    if not models:
        print("❌ Error: No SQLModel models found.", file=sys.stderr)
        sys.exit(1)

    relationships = infer_relationships(models)

    if args.stdout:
        print(generate_mermaid(models, relationships))
        return

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.format in ("all", "md"):
        md_content = generate_markdown(models, relationships)
        md_path = out_dir / "ERD.md"
        md_path.write_text(md_content, encoding="utf-8")
        print(f"✅ Generated Markdown ERD: {md_path}")

    if args.format in ("all", "html"):
        html_content = generate_html(models, relationships)
        html_path = out_dir / "erd.html"
        html_path.write_text(html_content, encoding="utf-8")
        print(f"✅ Generated Interactive HTML ERD: {html_path}")

    if args.format in ("all", "dot"):
        dot_content = generate_dot(models, relationships)
        dot_path = out_dir / "erd.dot"
        dot_path.write_text(dot_content, encoding="utf-8")
        print(f"✅ Generated Graphviz DOT: {dot_path}")

    print(f"\n🎉 Successfully processed {len(models)} tables and {len(relationships)} relationships.")


if __name__ == "__main__":
    main()
