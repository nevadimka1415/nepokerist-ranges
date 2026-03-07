import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import { toPng } from "html-to-image";

const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const STORAGE_KEY = "poker_ranges_v3_tree";
const COLOR_LABELS_KEY = "poker_ranges_color_labels_v1";

const COLORS = {
  red: "#ef476f",
  green: "#06d6a0",
  blue: "#4cc9f0",
  yellow: "#ffd166",
  orange: "#f77f00",
  black: "#000000",
} as const;

type ColorKey = keyof typeof COLORS;
type HandColorMap = Record<string, ColorKey>;

type RangeItem = {
  id: string;
  name: string;
  hands: HandColorMap;
  createdAt: number;
  updatedAt: number;
};

type Folder = {
  id: string;
  name: string;
  color: string;
  folders: Folder[];
  items: RangeItem[];
};

type AppState = {
  root: Folder;
  selectedFolderId: string;
  selectedRangeId: string | null;
};

type LegacyRangeItem = {
  id: string;
  name: string;
  hands: string[] | HandColorMap;
  createdAt: number;
  updatedAt: number;
};

type LegacyFolder = {
  id: string;
  name: string;
  color: string;
  folders: LegacyFolder[];
  items: LegacyRangeItem[];
};

type LegacyAppState = {
  root: LegacyFolder;
  selectedFolderId: string;
  selectedRangeId: string | null;
};

function getLabel(row: number, col: number) {
  if (row === col) return ranks[row] + ranks[col];
  if (row < col) return ranks[row] + ranks[col] + "s";
  return ranks[col] + ranks[row] + "o";
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function sanitizeFileName(name: string) {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function defaultRoot(): Folder {
  return {
    id: "root",
    name: "Библиотека",
    color: "#e9ecef",
    folders: [
      {
        id: uid(),
        name: "Мои спектры",
        color: "#8ecae6",
        folders: [],
        items: [],
      },
    ],
    items: [],
  };
}

function defaultState(): AppState {
  const root = defaultRoot();
  const first = root.folders[0].id;
  return { root, selectedFolderId: first, selectedRangeId: null };
}

function defaultColorLabels(): Record<ColorKey, string> {
  return {
    red: "Красный",
    green: "Зелёный",
    blue: "Голубой",
    yellow: "Жёлтый",
    orange: "Оранжевый",
    black: "Чёрный",
  };
}

function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveColorLabels(labels: Record<ColorKey, string>) {
  localStorage.setItem(COLOR_LABELS_KEY, JSON.stringify(labels));
}

function normalizeHands(hands: string[] | HandColorMap | undefined): HandColorMap {
  if (!hands) return {};

  if (Array.isArray(hands)) {
    const mapped: HandColorMap = {};
    for (const hand of hands) {
      mapped[hand] = "red";
    }
    return mapped;
  }

  return hands;
}

function normalizeFolder(folder: LegacyFolder): Folder {
  return {
    ...folder,
    folders: folder.folders.map(normalizeFolder),
    items: folder.items.map((item) => ({
      ...item,
      hands: normalizeHands(item.hands),
    })),
  };
}

function loadState(): AppState {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (rawStr) {
      const parsed = JSON.parse(rawStr) as LegacyAppState;
      if (parsed?.root?.id && typeof parsed.selectedFolderId === "string") {
        return {
          root: normalizeFolder(parsed.root),
          selectedFolderId: parsed.selectedFolderId,
          selectedRangeId: parsed.selectedRangeId ?? null,
        };
      }
    }
    return defaultState();
  } catch {
    return defaultState();
  }
}

function loadColorLabels(): Record<ColorKey, string> {
  try {
    const rawStr = localStorage.getItem(COLOR_LABELS_KEY);
    if (rawStr) {
      const parsed = JSON.parse(rawStr) as Partial<Record<ColorKey, string>>;
      return {
        ...defaultColorLabels(),
        ...parsed,
      };
    }
    return defaultColorLabels();
  } catch {
    return defaultColorLabels();
  }
}

function findFolder(folder: Folder, folderId: string): Folder | null {
  if (folder.id === folderId) return folder;
  for (const child of folder.folders) {
    const found = findFolder(child, folderId);
    if (found) return found;
  }
  return null;
}

function updateFolderTree(folder: Folder, folderId: string, updater: (f: Folder) => Folder): Folder {
  if (folder.id === folderId) return updater(folder);
  return {
    ...folder,
    folders: folder.folders.map((ch) => updateFolderTree(ch, folderId, updater)),
  };
}

function removeFolderTree(folder: Folder, folderId: string): Folder {
  return {
    ...folder,
    folders: folder.folders
      .filter((ch) => ch.id !== folderId)
      .map((ch) => removeFolderTree(ch, folderId)),
  };
}

function moveRangeBetweenFolders(
  root: Folder,
  fromFolderId: string,
  toFolderId: string,
  rangeId: string
): { root: Folder; moved?: RangeItem } {
  if (fromFolderId === toFolderId) return { root };

  const from = findFolder(root, fromFolderId);
  const to = findFolder(root, toFolderId);
  if (!from || !to) return { root };

  const item = from.items.find((it) => it.id === rangeId);
  if (!item) return { root };

  let nextRoot = updateFolderTree(root, fromFolderId, (f) => ({
    ...f,
    items: f.items.filter((it) => it.id !== rangeId),
  }));

  const now = Date.now();
  const moved: RangeItem = { ...item, updatedAt: now };

  nextRoot = updateFolderTree(nextRoot, toFolderId, (f) => ({
    ...f,
    items: [moved, ...f.items],
  }));

  return { root: nextRoot, moved };
}

function pickColor(initialColor: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = initialColor;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("blur", onBlur);
      input.remove();
    };

    const onChange = () => {
      const value = input.value;
      cleanup();
      resolve(value);
    };

    const onBlur = () => {
      window.setTimeout(() => {
        if (document.body.contains(input)) {
          cleanup();
          resolve(null);
        }
      }, 100);
    };

    input.addEventListener("change", onChange);
    input.addEventListener("blur", onBlur);

    document.body.appendChild(input);
    input.click();
  });
}

function App() {
  const updateInProgressRef = useRef(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const [selected, setSelected] = useState<HandColorMap>({});
  const [copied, setCopied] = useState(false);
  const [currentColor, setCurrentColor] = useState<ColorKey>("red");
  const [colorLabels, setColorLabels] = useState<Record<ColorKey, string>>(() => loadColorLabels());

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());

  const [state, setState] = useState<AppState>(() => loadState());
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function silentCheckUpdate() {
      if (updateInProgressRef.current) return;

      try {
        updateInProgressRef.current = true;

        const update = await check();

        if (!cancelled && update) {
          console.log("Update available:", update.version);
          await update.downloadAndInstall();
          window.location.reload();
        }
      } catch (error) {
        console.error("Updater error:", error);
      } finally {
        updateInProgressRef.current = false;
      }
    }

    silentCheckUpdate();

    const intervalId = window.setInterval(() => {
      silentCheckUpdate();
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    saveColorLabels(colorLabels);
  }, [colorLabels]);

  const currentFolder = useMemo(() => findFolder(state.root, state.selectedFolderId), [state]);

  const currentRange = useMemo(() => {
    if (!currentFolder || !state.selectedRangeId) return null;
    return currentFolder.items.find((it) => it.id === state.selectedRangeId) || null;
  }, [currentFolder, state.selectedRangeId]);

  const selectedList = useMemo(() => Object.keys(selected).sort(), [selected]);

  const combos = useMemo(() => {
    let total = 0;
    for (const hand of Object.keys(selected)) {
      if (hand.length === 2) total += 6;
      else if (hand.endsWith("s")) total += 4;
      else total += 12;
    }
    return total;
  }, [selected]);

  const percent = useMemo(() => (combos / 1326) * 100, [combos]);
  const exportText = useMemo(() => selectedList.join(", "), [selectedList]);

  const sortedFilteredItems = useMemo(() => {
    const items = currentFolder?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [currentFolder, search]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      alert("Не удалось скопировать автоматически. Выдели текст и скопируй вручную.");
    }
  };

  const apply = (label: string) => {
    if (visitedRef.current.has(label)) return;
    visitedRef.current.add(label);

    setSelected((prev) => {
      const next = { ...prev };

      if (dragModeRef.current === "add") {
        next[label] = currentColor;
      } else {
        delete next[label];
      }

      return next;
    });
  };

  const endDrag = () => {
    isDraggingRef.current = false;
    visitedRef.current = new Set();
  };

  const clearAll = () => setSelected({});

  const createSubFolder = async () => {
    const parent = currentFolder;
    if (!parent) return;

    const name = prompt("Название папки:");
    if (!name) return;

    const color = await pickColor("#8ecae6");
    if (!color) return;

    const id = uid();

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, parent.id, (f) => ({
        ...f,
        folders: [...f.folders, { id, name, color, folders: [], items: [] }],
      })),
      selectedFolderId: id,
      selectedRangeId: null,
    }));
  };

  const renameFolder = () => {
    const folder = currentFolder;
    if (!folder) return;
    if (folder.id === "root") return alert("Корневую папку переименовывать не надо.");

    const name = prompt("Новое название папки:", folder.name);
    if (!name) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({ ...f, name })),
    }));
  };

  const recolorFolder = async () => {
    const folder = currentFolder;
    if (!folder) return;
    if (folder.id === "root") return alert("Корневую папку красить не надо 🙂");

    const color = await pickColor(folder.color || "#8ecae6");
    if (!color) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({ ...f, color })),
    }));
  };

  const deleteFolder = () => {
    const folder = currentFolder;
    if (!folder) return;
    if (folder.id === "root") return alert("Нельзя удалить корневую папку.");

    const hasContent = folder.items.length > 0 || folder.folders.length > 0;
    const ok = confirm(
      hasContent ? `Удалить папку "${folder.name}" и всё внутри?` : `Удалить папку "${folder.name}"?`
    );
    if (!ok) return;

    setState((prev) => {
      const nextRoot = removeFolderTree(prev.root, folder.id);
      const fallback = nextRoot.folders[0]?.id ?? "root";
      const selectedFolderId = prev.selectedFolderId === folder.id ? fallback : prev.selectedFolderId;
      return { ...prev, root: nextRoot, selectedFolderId, selectedRangeId: null };
    });
  };

  const newRange = () => {
    setSelected({});
    setState((prev) => ({ ...prev, selectedRangeId: null }));
  };

  const saveCurrentRange = () => {
    const folder = currentFolder;
    if (!folder) return;

    const name = prompt("Название спектра:", currentRange?.name || "Новый спектр");
    if (!name) return;

    const now = Date.now();
    const hands = selected;

    setState((prev) => {
      const folderId = folder.id;
      const root = updateFolderTree(prev.root, folderId, (f) => {
        if (prev.selectedRangeId) {
          const items = f.items.map((it) =>
            it.id === prev.selectedRangeId ? { ...it, name, hands, updatedAt: now } : it
          );
          return { ...f, items };
        }

        const newItem = {
          id: uid(),
          name,
          hands,
          createdAt: now,
          updatedAt: now,
        } as RangeItem;

        return { ...f, items: [newItem, ...f.items] };
      });

      const updatedFolder = findFolder(root, folderId)!;
      const selectedRangeId = prev.selectedRangeId ?? (updatedFolder.items[0]?.id ?? null);

      return { ...prev, root, selectedRangeId };
    });
  };

  const saveAsNew = () => {
    const folder = currentFolder;
    if (!folder) return;

    const defaultName = currentRange ? `${currentRange.name} (копия)` : "Новый спектр";
    const name = prompt("Название нового спектра:", defaultName);
    if (!name) return;

    const now = Date.now();
    const newItem: RangeItem = {
      id: uid(),
      name,
      hands: selected,
      createdAt: now,
      updatedAt: now,
    };

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({
        ...f,
        items: [newItem, ...f.items],
      })),
      selectedRangeId: newItem.id,
    }));
  };

  const renameRange = () => {
    const folder = currentFolder;
    if (!folder) return;
    if (!state.selectedRangeId) return alert("Сначала выбери спектр слева.");

    const item = folder.items.find((it) => it.id === state.selectedRangeId);
    if (!item) return;

    const name = prompt("Новое название спектра:", item.name);
    if (!name) return;

    const now = Date.now();
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({
        ...f,
        items: f.items.map((it) => (it.id === item.id ? { ...it, name, updatedAt: now } : it)),
      })),
    }));
  };

  const loadRange = (rangeId: string) => {
    const folder = currentFolder;
    if (!folder) return;

    const item = folder.items.find((it) => it.id === rangeId);
    if (!item) return;

    setSelected(normalizeHands(item.hands));
    setState((prev) => ({ ...prev, selectedRangeId: item.id }));
  };

  const deleteRange = () => {
    const folder = currentFolder;
    if (!folder) return;
    if (!state.selectedRangeId) return alert("Сначала выбери спектр слева.");

    const item = folder.items.find((it) => it.id === state.selectedRangeId);
    if (!item) return;

    const ok = confirm(`Удалить спектр "${item.name}"?`);
    if (!ok) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({
        ...f,
        items: f.items.filter((it) => it.id !== prev.selectedRangeId),
      })),
      selectedRangeId: null,
    }));
  };

  const onDragStartRange = (e: React.DragEvent, rangeId: string) => {
    e.dataTransfer.setData("text/rangeId", rangeId);
    e.dataTransfer.setData("text/fromFolderId", state.selectedFolderId);
    e.dataTransfer.effectAllowed = "move";
  };

  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();

    const rangeId = e.dataTransfer.getData("text/rangeId");
    const fromFolderId = e.dataTransfer.getData("text/fromFolderId");
    if (!rangeId || !fromFolderId) return;

    setState((prev) => {
      const { root, moved } = moveRangeBetweenFolders(prev.root, fromFolderId, folderId, rangeId);
      if (!moved) return prev;
      return { ...prev, root, selectedFolderId: folderId, selectedRangeId: moved.id };
    });
  };

  const exportPNG = async () => {
    if (!exportRef.current) return;

    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const rangeName = currentRange?.name || "Новый спектр";
      const fileName = sanitizeFileName(rangeName || "poker-range");

      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error(error);
      alert("Ошибка экспорта PNG");
    }
  };

  const FolderNode = ({ folder, depth }: { folder: Folder; depth: number }) => {
    const active = folder.id === state.selectedFolderId;

    return (
      <div>
        <div
          onClick={() => setState((prev) => ({ ...prev, selectedFolderId: folder.id, selectedRangeId: null }))}
          onDragOver={allowDrop}
          onDrop={(e) => onDropOnFolder(e, folder.id)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #eee",
            background: active ? "#f5f5f5" : "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: depth * 12,
          }}
          title="Можно перетаскивать спектры на папку"
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: folder.color,
              border: "1px solid rgba(0,0,0,0.12)",
              flex: "0 0 auto",
            }}
          />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {folder.name}
          </span>
          <span style={{ color: "#777", fontSize: 12 }}>{folder.items.length}</span>
        </div>

        {folder.folders.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {folder.folders.map((ch) => (
              <FolderNode key={ch.id} folder={ch} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ fontFamily: "system-ui", height: "100vh", display: "flex" }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        style={{
          width: 360,
          borderRight: "1px solid #eee",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16 }}>Библиотека</div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={createSubFolder}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              flex: 1,
              minWidth: 110,
            }}
          >
            + Папка
          </button>
          <button
            onClick={renameFolder}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
            title="Переименовать папку"
          >
            ✏️
          </button>
          <button
            onClick={recolorFolder}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
            title="Цвет папки"
          >
            🎨
          </button>
          <button
            onClick={deleteFolder}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
            title="Удалить папку"
          >
            🗑
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#666" }}>Папки (вложенные)</div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            overflow: "auto",
            paddingRight: 6,
          }}
        >
          {state.root.folders.map((f) => (
            <FolderNode key={f.id} folder={f} depth={0} />
          ))}
        </div>

        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            Спектры в “{currentFolder?.name ?? "?"}”
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию…"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              outline: "none",
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", marginTop: 8 }}>
          {!sortedFilteredItems.length ? (
            <div style={{ color: "#777", fontSize: 13, lineHeight: 1.4 }}>
              {search.trim()
                ? "Ничего не найдено по поиску."
                : "Тут пока пусто. Собери спектр справа и нажми “Сохранить”."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sortedFilteredItems.map((it) => {
                const active = it.id === state.selectedRangeId;
                return (
                  <div
                    key={it.id}
                    draggable
                    onDragStart={(e) => onDragStartRange(e, it.id)}
                    onClick={() => loadRange(it.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #eee",
                      background: active ? "#eaf4ff" : "white",
                      cursor: "pointer",
                    }}
                    title="Перетащи на папку слева"
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>рук: {Object.keys(it.hands).length}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={newRange}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              flex: 1,
            }}
          >
            Новый
          </button>
          <button
            onClick={renameRange}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
            title="Переименовать спектр"
          >
            ✏️
          </button>
          <button
            onClick={deleteRange}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
            title="Удалить спектр"
          >
            🗑
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <button
            onClick={saveCurrentRange}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Сохранить
          </button>
          <button
            onClick={saveAsNew}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Сохранить как…
          </button>
          <button
            onClick={copyToClipboard}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: copied ? "#06d6a0" : "white",
              cursor: "pointer",
            }}
          >
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
          <button
            onClick={clearAll}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Очистить
          </button>
          <button
            onClick={exportPNG}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Экспорт PNG
          </button>
          <div style={{ marginLeft: "auto" }}>
            <strong>Комбо:</strong> {combos} / 1326 ({percent.toFixed(2)}%)
          </div>
        </div>

        <div
          ref={exportRef}
          style={{
            background: "#ffffff",
            padding: 24,
            borderRadius: 16,
            display: "flex",
            gap: 24,
            width: "fit-content",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h1 style={{ margin: 0 }}>Редактор покерных спектров</h1>
              <div style={{ color: "#666" }}>{currentRange ? `— ${currentRange.name}` : "— новый спектр"}</div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(13, 40px)",
                gap: 2,
                marginTop: 16,
              }}
            >
              {Array.from({ length: 13 }).map((_, row) =>
                Array.from({ length: 13 }).map((_, col) => {
                  const label = getLabel(row, col);
                  const color = selected[label];
                  const isSelected = !!color;
                  const baseColor = row === col ? "#ffd166" : row < col ? "#06d6a0" : "#118ab2";

                  return (
                    <div
                      key={`${row}-${col}`}
                      onMouseDown={() => {
                        isDraggingRef.current = true;
                        visitedRef.current = new Set();
                        dragModeRef.current = selected[label] ? "remove" : "add";
                        apply(label);
                      }}
                      onMouseEnter={() => {
                        if (isDraggingRef.current) apply(label);
                      }}
                      style={{
                        width: 40,
                        height: 40,
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: isSelected ? COLORS[color] : baseColor,
                        color: "white",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      {label}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div
            style={{
              width: 260,
              flex: "0 0 260px",
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 14,
              height: "fit-content",
              background: "white",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Цвета диапазона</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(Object.keys(COLORS) as ColorKey[]).map((key) => {
                const active = currentColor === key;

                return (
                  <div
                    key={key}
                    style={{
                      border: active ? "2px solid #333" : "1px solid #ddd",
                      borderRadius: 10,
                      padding: 10,
                      background: active ? "#f8f9fa" : "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={() => setCurrentColor(key)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "1px solid rgba(0,0,0,0.15)",
                          background: COLORS[key],
                          cursor: "pointer",
                          flex: "0 0 auto",
                        }}
                        title={`Выбрать цвет ${colorLabels[key]}`}
                      />
                      <input
                        value={colorLabels[key]}
                        onChange={(e) =>
                          setColorLabels((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          outline: "none",
                          fontSize: 13,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
              Выбери цвет и закрашивай руки на таблице.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Экспорт</div>
          <textarea
            value={exportText}
            readOnly
            rows={4}
            style={{
              width: "100%",
              maxWidth: 1000,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ddd",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
            }}
          />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);