import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeTypeDef } from "../nodes";
import { NODE_CATEGORIES } from "../nodes";
import { isIconAsset } from "../utils/pluginIcons";

type Category = "ai" | "data" | "control" | "utilities";

type Props = {
  open: boolean;
  title?: string;
  subtitle?: string;
  options: Record<Category, NodeTypeDef[]>;
  onSelect: (type: string) => void;
  onClose: () => void;
};

const RECENT_KEY = "aa_recent_node_types";

function readRecentTypes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberType(type: string) {
  const next = [type, ...readRecentTypes().filter((x) => x !== type)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export default function NodeCommandPalette({
  open,
  title = "Add node",
  subtitle = "Search actions, triggers, data, AI, and control nodes.",
  options,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const flatOptions = useMemo(
    () =>
      (Object.keys(options) as Category[]).flatMap((category) =>
        (options[category] ?? []).map((node) => ({ ...node, category }))
      ),
    [options]
  );

  const recent = useMemo(() => {
    const byType = new Map(flatOptions.map((node) => [node.type, node]));
    return readRecentTypes().map((type) => byType.get(type)).filter(Boolean) as Array<NodeTypeDef & { category: Category }>;
  }, [flatOptions, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatOptions;
    return flatOptions.filter((node) =>
      [node.type, node.label, node.description, NODE_CATEGORIES[node.category]].some((value) =>
        String(value || "").toLowerCase().includes(q)
      )
    );
  }, [flatOptions, query]);

  const grouped = useMemo(() => {
    const out: Record<Category, Array<NodeTypeDef & { category: Category }>> = {
      ai: [],
      data: [],
      control: [],
      utilities: [],
    };
    for (const node of filtered) out[node.category].push(node);
    return out;
  }, [filtered]);

  if (!open) return null;

  const select = (type: string) => {
    rememberType(type);
    onSelect(type);
  };

  return (
    <div className="nodeCommandPaletteBackdrop" onMouseDown={onClose} role="presentation">
      <section className="nodeCommandPalette" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="nodeCommandPalette__header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <kbd>Esc</kbd>
        </header>
        <input
          ref={inputRef}
          className="nodeCommandPalette__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes, e.g. HTTP, foreach, Telegram..."
        />

        {!query.trim() && recent.length > 0 ? (
          <div className="nodeCommandPalette__section">
            <div className="nodeCommandPalette__sectionTitle">Recent</div>
            <div className="nodeCommandPalette__recent">
              {recent.map((node) => (
                <button key={node.type} type="button" onClick={() => select(node.type)}>
                  <span>{isIconAsset(node.icon) ? <img src={node.icon} alt="" /> : node.icon}</span>
                  {node.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="nodeCommandPalette__list">
          {(Object.keys(grouped) as Category[]).map((category) => {
            const items = grouped[category];
            if (!items.length) return null;
            return (
              <div key={category} className="nodeCommandPalette__section">
                <div className="nodeCommandPalette__sectionTitle">{NODE_CATEGORIES[category]}</div>
                {items.map((node) => (
                  <button key={node.type} type="button" className="nodeCommandPalette__item" onClick={() => select(node.type)}>
                    <span className="nodeCommandPalette__icon">
                      {isIconAsset(node.icon) ? <img src={node.icon} alt="" /> : node.icon}
                    </span>
                    <span>
                      <strong>{node.label}</strong>
                      <small>{node.description || node.type}</small>
                    </span>
                    <code>{node.type}</code>
                  </button>
                ))}
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <div className="nodeCommandPalette__empty">No nodes match “{query}”.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
