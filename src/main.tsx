import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import { toPng } from "html-to-image";

const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const STORAGE_KEY = "poker_ranges_v4_tree";
const ACTIONS_KEY = "poker_ranges_actions_v1";

const FOLDER_COLORS = [
  "#8ecae6",
  "#ef476f",
  "#06d6a0",
  "#ffd166",
  "#f77f00",
  "#000000",
  "#adb5bd",
  "#6a4c93",
  "#1982c4",
  "#8ac926",
  "#ff595e",
  "#ffca3a",
];

type ActionItem = {
  id: string;
  color: string;
  label: string;
};

type HandActionMap = Record<string, string>;

type RangeItem = {
  id: string;
  name: string;
  hands: HandActionMap;
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
  hands: string[] | Record<string, string>;
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

type FolderModalState =
  | {
      open: false;
    }
  | {
      open: true;
      mode: "create" | "recolor";
      parentFolderId?: string;
      targetFolderId?: string;
      name: string;
      color: string;
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

function defaultActions(): ActionItem[] {
  return [
    { id: uid(), color: "#ef476f", label: "Рейз" },
    { id: uid(), color: "#8ecae6", label: "Колл" },
    { id: uid(), color: "#ffd166", label: "Чек" },
  ];
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

function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveActions(actions: ActionItem[]) {
  localStorage.setItem(ACTIONS_KEY, JSON.stringify(actions));
}

function loadActions(): ActionItem[] {
  try {
    const raw = localStorage.getItem(ACTIONS_KEY);
    if (!raw) return defaultActions();

    const parsed = JSON.parse(raw) as ActionItem[];
    if (!Array.isArray(parsed) || !parsed.length) return defaultActions();

    const valid = parsed.filter((it) => it?.id && it?.color && typeof it?.label === "string");
    return valid.length ? valid : defaultActions();
  } catch {
    return defaultActions();
  }
}

function getFallbackActionId(actions: ActionItem[]) {
  return actions[0]?.id ?? "";
}

function normalizeHands(
  hands: string[] | Record<string, string> | undefined,
  fallbackActionId: string
): HandActionMap {
  if (!hands) return {};

  if (Array.isArray(hands)) {
    const mapped: HandActionMap = {};
    for (const hand of hands) {
      mapped[hand] = fallbackActionId;
    }
    return mapped;
  }

  return hands;
}

function normalizeFolder(folder: LegacyFolder, fallbackActionId: string): Folder {
  return {
    ...folder,
    folders: folder.folders.map((child) => normalizeFolder(child, fallbackActionId)),
    items: folder.items.map((item) => ({
      ...item,
      hands: normalizeHands(item.hands, fallbackActionId),
    })),
  };
}

function loadState(fallbackActionId: string): AppState {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (rawStr) {
      const parsed = JSON.parse(rawStr) as LegacyAppState;
      if (parsed?.root?.id && typeof parsed.selectedFolderId === "string") {
        return {
          root: normalizeFolder(parsed.root, fallbackActionId),
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

function App() {
  const updateInProgressRef = useRef(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const [actions, setActions] = useState<ActionItem[]>(() => loadActions());
  const [currentActionId, setCurrentActionId] = useState<string>(() => {
    const loaded = loadActions();
    return getFallbackActionId(loaded);
  });

  const [selected, setSelected] = useState<HandActionMap>({});
  const [copied, setCopied] = useState(false);

  const [folderModal, setFolderModal] = useState<FolderModalState>({ open: false });

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());

  const [state, setState] = useState<AppState>(() => {
    const loadedActions = loadActions();
    return loadState(getFallbackActionId(loadedActions));
  });

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
    saveActions(actions);
  }, [actions]);

  useEffect(() => {
    if (!actions.find((a) => a.id === currentActionId)) {
      setCurrentActionId(getFallbackActionId(actions));
    }
  }, [actions, currentActionId]);

  const actionsMap = useMemo(() => {
    return Object.fromEntries(actions.map((a) => [a.id, a]));
  }, [actions]);

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

  const exportText = useMemo(() => {
    return selectedList
      .map((hand) => {
        const action = actionsMap[selected[hand]];
        return action ? `${hand}:${action.label}` : hand;
      })
      .join(", ");
  }, [selectedList, selected, actionsMap]);

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
        if (!currentActionId) return next;
        next[label] = currentActionId;
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

  const addAction = () => {
    const newAction: ActionItem = {
      id: uid(),
      color: "#8ecae6",
      label: "Новое действие",
    };

    setActions((prev) => [...prev, newAction]);
    setCurrentActionId(newAction.id);
  };

  const updateActionLabel = (actionId: string, label: string) => {
    setActions((prev) => prev.map((item) => (item.id === actionId ? { ...item, label } : item)));
  };

  const updateActionColor = (actionId: string, color: string) => {
    setActions((prev) => prev.map((item) => (item.id === actionId ? { ...item, color } : item)));
  };

  const removeAction = (actionId: string) => {
    if (actions.length <= 1) {
      alert("Должно остаться хотя бы одно действие.");
      return;
    }

    const action = actions.find((a) => a.id === actionId);
    const ok = confirm(`Удалить действие "${action?.label ?? ""}"?`);
    if (!ok) return;

    const fallbackId = actions.find((a) => a.id !== actionId)?.id ?? "";

    setActions((prev) => prev.filter((a) => a.id !== actionId));
    setSelected((prev) => {
      const next: HandActionMap = {};
      for (const [hand, storedActionId] of Object.entries(prev)) {
        if (storedActionId !== actionId) {
          next[hand] = storedActionId;
        }
      }
      return next;
    });

    if (currentActionId === actionId) {
      setCurrentActionId(fallbackId);
    }
  };

  const openCreateFolderModal = () => {
    if (!currentFolder) return;

    setFolderModal({
      open: true,
      mode: "create",
      parentFolderId: currentFolder.id,
      name: "",
      color: "#8ecae6",
    });
  };

  const openRecolorFolderModal = () => {
    if (!currentFolder) return;
    if (currentFolder.id === "root") {
      alert("Корневую папку красить не надо 🙂");
      return;
    }

    setFolderModal({
      open: true,
      mode: "recolor",
      targetFolderId: currentFolder.id,
      name: currentFolder.name,
      color: currentFolder.color || "#8ecae6",
    });
  };

  const submitFolderModal = () => {
    if (!folderModal.open) return;

    if (folderModal.mode === "create") {
      const name = folderModal.name.trim();
      if (!name) {
        alert("Введите название папки.");
        return;
      }

      const id = uid();
      const parentFolderId = folderModal.parentFolderId;
      if (!parentFolderId) return;

      setState((prev) => ({
        ...prev,
        root: updateFolderTree(prev.root, parentFolderId, (f) => ({
          ...f,
          folders: [...f.folders, { id, name, color: folderModal.color, folders: [], items: [] }],
        })),
        selectedFolderId: id,
        selectedRangeId: null,
      }));
    }

    if (folderModal.mode === "recolor") {
      const targetFolderId = folderModal.targetFolderId;
      if (!targetFolderId) return;

      setState((prev) => ({
        ...prev,
        root: updateFolderTree(prev.root, targetFolderId, (f) => ({
          ...f,
          color: folderModal.color,
        })),
      }));
    }

    setFolderModal({ open: false });
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

    setSelected(normalizeHands(item.hands, getFallbackActionId(actions)));
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
            onClick={openCreateFolderModal}
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
            onClick={openRecolorFolderModal}
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
                  const actionId = selected[label];
                  const isSelected = !!actionId;
                  const action = actionId ? actionsMap[actionId] : null;
                  const baseColor = row === col ? "#ffd166" : row < col ? "#8ecae6" : "#118ab2";

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
                        background: isSelected ? action?.color ?? "#ef476f" : baseColor,
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
              width: 300,
              flex: "0 0 300px",
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 14,
              height: "fit-content",
              background: "white",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Действия непокериста</div>

            <button
              onClick={addAction}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
                marginBottom: 12,
              }}
            >
              + Добавить действие
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {actions.map((action) => {
                const active = currentActionId === action.id;

                return (
                  <div
                    key={action.id}
                    style={{
                      border: active ? "2px solid #333" : "1px solid #ddd",
                      borderRadius: 10,
                      padding: 10,
                      background: active ? "#f8f9fa" : "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => setCurrentActionId(action.id)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "1px solid rgba(0,0,0,0.15)",
                          background: action.color,
                          cursor: "pointer",
                          flex: "0 0 auto",
                        }}
                        title="Сделать действие активным"
                      />
                      <input
                        value={action.label}
                        onChange={(e) => updateActionLabel(action.id, e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          outline: "none",
                          fontSize: 13,
                        }}
                      />
                      <input
                        type="color"
                        value={action.color}
                        onChange={(e) => updateActionColor(action.id, e.target.value)}
                        style={{
                          width: 34,
                          height: 34,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        title="Изменить цвет"
                      />
                      <button
                        onClick={() => removeAction(action.id)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "white",
                          cursor: "pointer",
                        }}
                        title="Удалить действие"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
              Выбери действие и закрашивай руки на таблице.
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

      {folderModal.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setFolderModal({ open: false })}
        >
          <div
            style={{
              width: 420,
              background: "white",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>
              {folderModal.mode === "create" ? "Новая папка" : "Цвет папки"}
            </div>

            {folderModal.mode === "create" && (
              <input
                value={folderModal.name}
                onChange={(e) =>
                  setFolderModal((prev) =>
                    prev.open ? { ...prev, name: e.target.value } : prev
                  )
                }
                placeholder="Название папки"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  outline: "none",
                  marginBottom: 16,
                  fontSize: 14,
                }}
              />
            )}

            <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>Выбери цвет</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {FOLDER_COLORS.map((color) => {
                const active = folderModal.color === color;
                return (
                  <button
                    key={color}
                    onClick={() =>
                      setFolderModal((prev) =>
                        prev.open ? { ...prev, color } : prev
                      )
                    }
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      border: active ? "3px solid #333" : "1px solid #ddd",
                      background: color,
                      cursor: "pointer",
                    }}
                    title={color}
                  />
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setFolderModal({ open: false })}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
              <button
                onClick={submitFolderModal}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#f5f5f5",
                  cursor: "pointer",
                }}
              >
                {folderModal.mode === "create" ? "Создать" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);