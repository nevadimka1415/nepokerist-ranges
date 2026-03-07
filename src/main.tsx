import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import { toPng } from "html-to-image";

const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const STORAGE_KEY = "poker_ranges_v5_tree";
const ACTIONS_KEY = "poker_ranges_actions_v2";
const EXPANDED_FOLDERS_KEY = "poker_ranges_expanded_folders_v2";
const FAVORITE_FOLDERS_KEY = "poker_ranges_favorite_folders_v1";
const RECENT_RANGES_KEY = "poker_ranges_recent_ranges_v1";

const PALETTE_COLORS = [
  "#8ecae6",
  "#ef476f",
  "#06d6a0",
  "#f2c85b",
  "#fb8500",
  "#000000",
  "#adb5bd",
  "#6a4c93",
  "#2d8fd5",
  "#84cc16",
  "#ff595e",
  "#f7c737",
];

const ROOT_FOLDER_ID = "root";

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
  | { open: false }
  | {
      open: true;
      mode: "create" | "recolor";
      parentFolderId?: string;
      targetFolderId?: string;
      name: string;
      color: string;
    };

type ActionPaletteModalState =
  | { open: false }
  | {
      open: true;
      actionId: string;
      color: string;
    };

type ContextMenuState =
  | { open: false }
  | {
      open: true;
      x: number;
      y: number;
      folderId: string;
    };

type RecentRangeRef = {
  folderId: string;
  rangeId: string;
  openedAt: number;
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
    { id: uid(), color: "#f2c85b", label: "Чек" },
  ];
}

function defaultRoot(): Folder {
  return {
    id: ROOT_FOLDER_ID,
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
  return {
    root,
    selectedFolderId: root.folders[0]?.id ?? ROOT_FOLDER_ID,
    selectedRangeId: null,
  };
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
    for (const hand of hands) mapped[hand] = fallbackActionId;
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

function loadStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveStringArray(key: string, value: string[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadRecentRanges(): RecentRangeRef[] {
  try {
    const raw = localStorage.getItem(RECENT_RANGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it) =>
        it &&
        typeof it.folderId === "string" &&
        typeof it.rangeId === "string" &&
        typeof it.openedAt === "number"
    );
  } catch {
    return [];
  }
}

function saveRecentRanges(recent: RecentRangeRef[]) {
  localStorage.setItem(RECENT_RANGES_KEY, JSON.stringify(recent));
}

function findFolder(folder: Folder, folderId: string): Folder | null {
  if (folder.id === folderId) return folder;
  for (const child of folder.folders) {
    const found = findFolder(child, folderId);
    if (found) return found;
  }
  return null;
}

function findRange(root: Folder, folderId: string, rangeId: string): { folder: Folder; range: RangeItem } | null {
  const folder = findFolder(root, folderId);
  if (!folder) return null;
  const range = folder.items.find((it) => it.id === rangeId);
  return range ? { folder, range } : null;
}

function updateFolderTree(folder: Folder, folderId: string, updater: (f: Folder) => Folder): Folder {
  if (folder.id === folderId) return updater(folder);
  return {
    ...folder,
    folders: folder.folders.map((child) => updateFolderTree(child, folderId, updater)),
  };
}

function removeFolderTree(folder: Folder, folderId: string): Folder {
  return {
    ...folder,
    folders: folder.folders
      .filter((child) => child.id !== folderId)
      .map((child) => removeFolderTree(child, folderId)),
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

  let nextRoot = updateFolderTree(root, fromFolderId, (folder) => ({
    ...folder,
    items: folder.items.filter((it) => it.id !== rangeId),
  }));

  const moved: RangeItem = { ...item, updatedAt: Date.now() };

  nextRoot = updateFolderTree(nextRoot, toFolderId, (folder) => ({
    ...folder,
    items: [moved, ...folder.items],
  }));

  return { root: nextRoot, moved };
}

function removeFolderFromRoot(root: Folder, folderId: string): { root: Folder; removed: Folder | null } {
  for (const child of root.folders) {
    if (child.id === folderId) {
      return {
        root: {
          ...root,
          folders: root.folders.filter((folder) => folder.id !== folderId),
        },
        removed: child,
      };
    }
  }

  let removed: Folder | null = null;
  const nextFolders = root.folders.map((child) => {
    const result = removeFolderFromRoot(child, folderId);
    if (result.removed) {
      removed = result.removed;
      return result.root;
    }
    return child;
  });

  return {
    root: { ...root, folders: nextFolders },
    removed,
  };
}

function insertFolderIntoRoot(root: Folder, parentFolderId: string, folderToInsert: Folder): Folder {
  if (root.id === parentFolderId) {
    return {
      ...root,
      folders: [...root.folders, folderToInsert],
    };
  }

  return {
    ...root,
    folders: root.folders.map((child) => insertFolderIntoRoot(child, parentFolderId, folderToInsert)),
  };
}

function isDescendantOrSelf(root: Folder, sourceFolderId: string, targetFolderId: string): boolean {
  if (sourceFolderId === targetFolderId) return true;
  const source = findFolder(root, sourceFolderId);
  if (!source) return false;
  return !!findFolder(source, targetFolderId);
}

function moveFolderBetweenFolders(root: Folder, sourceFolderId: string, targetFolderId: string): Folder {
  if (sourceFolderId === targetFolderId) return root;
  if (targetFolderId === sourceFolderId) return root;
  if (isDescendantOrSelf(root, sourceFolderId, targetFolderId)) return root;

  const removed = removeFolderFromRoot(root, sourceFolderId);
  if (!removed.removed) return root;
  return insertFolderIntoRoot(removed.root, targetFolderId, removed.removed);
}

function countAllItems(folder: Folder): number {
  return folder.items.length + folder.folders.reduce((sum, child) => sum + countAllItems(child), 0);
}

function countAllFolders(folder: Folder): number {
  return folder.folders.length + folder.folders.reduce((sum, child) => sum + countAllFolders(child), 0);
}

function collectFolderIds(folder: Folder): string[] {
  return [folder.id, ...folder.folders.flatMap((child) => collectFolderIds(child))];
}

function findFolderPath(folder: Folder, folderId: string, path: Folder[] = []): Folder[] | null {
  const nextPath = [...path, folder];
  if (folder.id === folderId) return nextPath;

  for (const child of folder.folders) {
    const found = findFolderPath(child, folderId, nextPath);
    if (found) return found;
  }

  return null;
}

function folderNameMatches(folder: Folder, query: string): boolean {
  return folder.name.toLowerCase().includes(query.toLowerCase());
}

function collectFolderIdsForSearch(folder: Folder, query: string): string[] {
  const matching = folderNameMatches(folder, query) ? [folder.id] : [];
  return [...matching, ...folder.folders.flatMap((child) => collectFolderIdsForSearch(child, query))];
}

function collectExpandedIdsForMatchingPaths(folder: Folder, query: string, path: string[] = []): string[] {
  const currentPath = [...path, folder.id];
  const children = folder.folders.flatMap((child) => collectExpandedIdsForMatchingPaths(child, query, currentPath));
  if (folderNameMatches(folder, query)) {
    return [...currentPath, ...children];
  }
  return children;
}

function getEmptySelectedActionIds(): Record<string, true> {
  return {};
}

function App() {
  const updateInProgressRef = useRef(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const rangeSearchInputRef = useRef<HTMLInputElement | null>(null);
  const folderSearchInputRef = useRef<HTMLInputElement | null>(null);

  const [actions, setActions] = useState<ActionItem[]>(() => loadActions());
  const [currentActionId, setCurrentActionId] = useState<string>(() => getFallbackActionId(loadActions()));
  const [selectedActionIds, setSelectedActionIds] = useState<Record<string, true>>(getEmptySelectedActionIds);
  const [actionPaletteModal, setActionPaletteModal] = useState<ActionPaletteModalState>({ open: false });

  const [selected, setSelected] = useState<HandActionMap>({});
  const [copied, setCopied] = useState(false);
  const [folderModal, setFolderModal] = useState<FolderModalState>({ open: false });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false });

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());

  const [state, setState] = useState<AppState>(() => loadState(getFallbackActionId(loadActions())));
  const [rangeSearch, setRangeSearch] = useState("");
  const [folderSearch, setFolderSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => loadStringArray(EXPANDED_FOLDERS_KEY));
  const [favoriteFolderIds, setFavoriteFolderIds] = useState<string[]>(() => loadStringArray(FAVORITE_FOLDERS_KEY));
  const [recentRanges, setRecentRanges] = useState<RecentRangeRef[]>(() => loadRecentRanges());

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
    const intervalId = window.setInterval(silentCheckUpdate, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => saveState(state), [state]);
  useEffect(() => saveActions(actions), [actions]);
  useEffect(() => saveStringArray(EXPANDED_FOLDERS_KEY, expandedFolderIds), [expandedFolderIds]);
  useEffect(() => saveStringArray(FAVORITE_FOLDERS_KEY, favoriteFolderIds), [favoriteFolderIds]);
  useEffect(() => saveRecentRanges(recentRanges), [recentRanges]);

  useEffect(() => {
    if (!actions.find((action) => action.id === currentActionId)) {
      setCurrentActionId(getFallbackActionId(actions));
    }
  }, [actions, currentActionId]);

  useEffect(() => {
    const onClick = () => setContextMenu({ open: false });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu({ open: false });
      }
    };

    window.addEventListener("click", onClick);
    window.addEventListener("contextmenu", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("contextmenu", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const actionsMap = useMemo(() => Object.fromEntries(actions.map((action) => [action.id, action])), [actions]);
  const currentFolder = useMemo(() => findFolder(state.root, state.selectedFolderId), [state.root, state.selectedFolderId]);
  const currentRange = useMemo(() => {
    if (!currentFolder || !state.selectedRangeId) return null;
    return currentFolder.items.find((item) => item.id === state.selectedRangeId) ?? null;
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
    const query = rangeSearch.trim().toLowerCase();
    const filtered = query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [currentFolder, rangeSearch]);

  const currentFolderPath = useMemo(() => findFolderPath(state.root, state.selectedFolderId) ?? [], [state.root, state.selectedFolderId]);

  useEffect(() => {
    if (!currentFolderPath.length) return;
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...currentFolderPath.map((folder) => folder.id)])));
  }, [currentFolderPath]);

  const folderSearchMatchIds = useMemo(() => {
    const query = folderSearch.trim();
    if (!query) return [];
    return collectFolderIdsForSearch(state.root, query);
  }, [state.root, folderSearch]);

  useEffect(() => {
    const query = folderSearch.trim();
    if (!query) return;
    const expandedForSearch = collectExpandedIdsForMatchingPaths(state.root, query);
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...expandedForSearch])));
  }, [state.root, folderSearch]);

  const favoriteFolders = useMemo(() => {
    return favoriteFolderIds
      .map((id) => findFolder(state.root, id))
      .filter((folder): folder is Folder => !!folder);
  }, [favoriteFolderIds, state.root]);

  const recentOpenedRanges = useMemo(() => {
    return recentRanges
      .map((entry) => {
        const found = findRange(state.root, entry.folderId, entry.rangeId);
        if (!found) return null;
        return {
          ...entry,
          folder: found.folder,
          range: found.range,
        };
      })
      .filter((it): it is RecentRangeRef & { folder: Folder; range: RangeItem } => !!it)
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 8);
  }, [recentRanges, state.root]);

  const toggleFavoriteFolder = (folderId: string) => {
    if (folderId === ROOT_FOLDER_ID) return;
    setFavoriteFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [folderId, ...prev]
    );
  };

  const addRecentRange = (folderId: string, rangeId: string) => {
    setRecentRanges((prev) => {
      const next = [{ folderId, rangeId, openedAt: Date.now() }, ...prev.filter((it) => !(it.folderId === folderId && it.rangeId === rangeId))];
      return next.slice(0, 15);
    });
  };

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
    const newAction: ActionItem = { id: uid(), color: "#8ecae6", label: "Новое действие" };
    setActions((prev) => [...prev, newAction]);
    setCurrentActionId(newAction.id);
  };

  const updateActionLabel = (actionId: string, label: string) => {
    setActions((prev) => prev.map((item) => (item.id === actionId ? { ...item, label } : item)));
  };

  const updateActionColor = (actionId: string, color: string) => {
    setActions((prev) => prev.map((item) => (item.id === actionId ? { ...item, color } : item)));
  };

  const toggleSelectedAction = (actionId: string) => {
    setSelectedActionIds((prev) => {
      const next = { ...prev };
      if (next[actionId]) delete next[actionId];
      else next[actionId] = true;
      return next;
    });
  };

  const removeAction = (actionId: string) => {
    const ids = [actionId];
    removeSelectedActions(ids);
  };

  const removeSelectedActions = (ids?: string[]) => {
    const actionIds = ids ?? Object.keys(selectedActionIds);
    if (!actionIds.length) {
      alert("Сначала выбери действия, которые нужно удалить.");
      return;
    }

    const uniqueIds = Array.from(new Set(actionIds));
    if (actions.length - uniqueIds.length < 1) {
      alert("Должно остаться хотя бы одно действие.");
      return;
    }

    const ok = confirm(
      uniqueIds.length === 1
        ? `Удалить действие "${actions.find((action) => action.id === uniqueIds[0])?.label ?? ""}"?`
        : `Удалить выбранные действия (${uniqueIds.length})?`
    );
    if (!ok) return;

    const fallbackId = actions.find((action) => !uniqueIds.includes(action.id))?.id ?? "";

    setActions((prev) => prev.filter((action) => !uniqueIds.includes(action.id)));
    setSelected((prev) => {
      const next: HandActionMap = {};
      for (const [hand, actionId] of Object.entries(prev as HandActionMap)) {
        if (!uniqueIds.includes(actionId)) next[hand] = actionId;
      }
      return next;
    });
    setSelectedActionIds({});
    if (uniqueIds.includes(currentActionId)) setCurrentActionId(fallbackId);
  };

  const openCreateFolderModal = (parentFolderId?: string) => {
    const parentId = parentFolderId ?? currentFolder?.id;
    if (!parentId) return;
    setFolderModal({
      open: true,
      mode: "create",
      parentFolderId: parentId,
      name: "",
      color: "#8ecae6",
    });
    setContextMenu({ open: false });
  };

  const openRecolorFolderModal = (targetFolderId?: string) => {
    const folder = findFolder(state.root, targetFolderId ?? currentFolder?.id ?? "");
    if (!folder || folder.id === ROOT_FOLDER_ID) {
      alert("Корневую папку красить не надо 🙂");
      return;
    }
    setFolderModal({
      open: true,
      mode: "recolor",
      targetFolderId: folder.id,
      name: folder.name,
      color: folder.color || "#8ecae6",
    });
    setContextMenu({ open: false });
  };

  const submitFolderModal = () => {
    if (!folderModal.open) return;

    if (folderModal.mode === "create") {
      const name = folderModal.name.trim();
      if (!name) return alert("Введите название папки.");
      const parentFolderId = folderModal.parentFolderId;
      if (!parentFolderId) return;
      const id = uid();

      setState((prev) => ({
        ...prev,
        root: updateFolderTree(prev.root, parentFolderId, (folder) => ({
          ...folder,
          folders: [...folder.folders, { id, name, color: folderModal.color, folders: [], items: [] }],
        })),
        selectedFolderId: id,
        selectedRangeId: null,
      }));
      setExpandedFolderIds((prev) => Array.from(new Set([...prev, parentFolderId, id])));
    }

    if (folderModal.mode === "recolor") {
      const targetFolderId = folderModal.targetFolderId;
      if (!targetFolderId) return;
      setState((prev) => ({
        ...prev,
        root: updateFolderTree(prev.root, targetFolderId, (folder) => ({ ...folder, color: folderModal.color })),
      }));
    }

    setFolderModal({ open: false });
  };

  const renameFolderById = (folderId: string) => {
    const folder = findFolder(state.root, folderId);
    if (!folder) return;
    if (folder.id === ROOT_FOLDER_ID) return alert("Корневую папку переименовывать не надо.");

    const name = prompt("Новое название папки:", folder.name);
    if (!name?.trim()) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (target) => ({ ...target, name: name.trim() })),
    }));
    setContextMenu({ open: false });
  };

  const deleteFolderById = (folderId: string) => {
    const folder = findFolder(state.root, folderId);
    if (!folder) return;
    if (folder.id === ROOT_FOLDER_ID) return alert("Нельзя удалить корневую папку.");

    const hasContent = folder.items.length > 0 || folder.folders.length > 0;
    const ok = confirm(
      hasContent ? `Удалить папку "${folder.name}" и всё внутри?` : `Удалить папку "${folder.name}"?`
    );
    if (!ok) return;

    const folderIdsToRemove = collectFolderIds(folder);

    setState((prev) => {
      const nextRoot = removeFolderTree(prev.root, folder.id);
      const fallbackFolderId = currentFolderPath[currentFolderPath.length - 2]?.id ?? nextRoot.folders[0]?.id ?? ROOT_FOLDER_ID;
      const selectedFolderId = folderIdsToRemove.includes(prev.selectedFolderId) ? fallbackFolderId : prev.selectedFolderId;
      return {
        ...prev,
        root: nextRoot,
        selectedFolderId,
        selectedRangeId: folderIdsToRemove.includes(prev.selectedFolderId) ? null : prev.selectedRangeId,
      };
    });

    setExpandedFolderIds((prev) => prev.filter((id) => !folderIdsToRemove.includes(id)));
    setFavoriteFolderIds((prev) => prev.filter((id) => !folderIdsToRemove.includes(id)));
    setRecentRanges((prev) => prev.filter((entry) => !folderIdsToRemove.includes(entry.folderId)));
    setContextMenu({ open: false });
  };

  const newRange = () => {
    setSelected({});
    setState((prev) => ({ ...prev, selectedRangeId: null }));
  };

  const saveCurrentRange = () => {
    const folder = currentFolder;
    if (!folder) return;

    const name = prompt("Название спектра:", currentRange?.name || "Новый спектр");
    if (!name?.trim()) return;
    const trimmedName = name.trim();
    const now = Date.now();
    const hands = selected;

    setState((prev) => {
      const root = updateFolderTree(prev.root, folder.id, (target) => {
        if (prev.selectedRangeId) {
          return {
            ...target,
            items: target.items.map((item) =>
              item.id === prev.selectedRangeId ? { ...item, name: trimmedName, hands, updatedAt: now } : item
            ),
          };
        }

        const newItem: RangeItem = { id: uid(), name: trimmedName, hands, createdAt: now, updatedAt: now };
        return { ...target, items: [newItem, ...target.items] };
      });

      const updatedFolder = findFolder(root, folder.id);
      const selectedRangeId = prev.selectedRangeId ?? updatedFolder?.items[0]?.id ?? null;
      return { ...prev, root, selectedRangeId };
    });
  };

  const saveAsNew = () => {
    const folder = currentFolder;
    if (!folder) return;
    const defaultName = currentRange ? `${currentRange.name} (копия)` : "Новый спектр";
    const name = prompt("Название нового спектра:", defaultName);
    if (!name?.trim()) return;

    const newItem: RangeItem = {
      id: uid(),
      name: name.trim(),
      hands: selected,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (target) => ({ ...target, items: [newItem, ...target.items] })),
      selectedRangeId: newItem.id,
    }));
  };

  const renameRange = () => {
    const folder = currentFolder;
    const rangeId = state.selectedRangeId;
    if (!folder || !rangeId) return alert("Сначала выбери спектр слева.");
    const item = folder.items.find((it) => it.id === rangeId);
    if (!item) return;
    const name = prompt("Новое название спектра:", item.name);
    if (!name?.trim()) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (target) => ({
        ...target,
        items: target.items.map((it) =>
          it.id === item.id ? { ...it, name: name.trim(), updatedAt: Date.now() } : it
        ),
      })),
    }));
  };

  const loadRange = (rangeId: string, folderId = state.selectedFolderId) => {
    const folder = findFolder(state.root, folderId);
    if (!folder) return;
    const item = folder.items.find((it) => it.id === rangeId);
    if (!item) return;

    setSelected(normalizeHands(item.hands, getFallbackActionId(actions)));
    setState((prev) => ({ ...prev, selectedFolderId: folderId, selectedRangeId: item.id }));
    addRecentRange(folderId, item.id);
  };

  const deleteRange = () => {
    const folder = currentFolder;
    const rangeId = state.selectedRangeId;
    if (!folder || !rangeId) return alert("Сначала выбери спектр слева.");
    const item = folder.items.find((it) => it.id === rangeId);
    if (!item) return;
    const ok = confirm(`Удалить спектр "${item.name}"?`);
    if (!ok) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (target) => ({
        ...target,
        items: target.items.filter((it) => it.id !== rangeId),
      })),
      selectedRangeId: null,
    }));
    setRecentRanges((prev) => prev.filter((entry) => !(entry.folderId === folder.id && entry.rangeId === rangeId)));
  };

  const onDragStartRange = (event: React.DragEvent, rangeId: string) => {
    event.dataTransfer.setData("text/rangeId", rangeId);
    event.dataTransfer.setData("text/fromFolderId", state.selectedFolderId);
    event.dataTransfer.setData("application/x-item-type", "range");
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragStartFolder = (event: React.DragEvent, folderId: string) => {
    event.stopPropagation();
    event.dataTransfer.setData("text/folderId", folderId);
    event.dataTransfer.setData("application/x-item-type", "folder");
    event.dataTransfer.effectAllowed = "move";
  };

  const allowDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDropOnFolder = (event: React.DragEvent, folderId: string) => {
    event.preventDefault();
    const itemType = event.dataTransfer.getData("application/x-item-type");

    if (itemType === "range") {
      const rangeId = event.dataTransfer.getData("text/rangeId");
      const fromFolderId = event.dataTransfer.getData("text/fromFolderId");
      if (!rangeId || !fromFolderId) return;
      setState((prev) => {
        const result = moveRangeBetweenFolders(prev.root, fromFolderId, folderId, rangeId);
        if (!result.moved) return prev;
        return { ...prev, root: result.root, selectedFolderId: folderId, selectedRangeId: result.moved.id };
      });
      setExpandedFolderIds((prev) => Array.from(new Set([...prev, folderId])));
      return;
    }

    if (itemType === "folder") {
      const sourceFolderId = event.dataTransfer.getData("text/folderId");
      if (!sourceFolderId || sourceFolderId === folderId) return;
      if (isDescendantOrSelf(state.root, sourceFolderId, folderId)) return;
      setState((prev) => ({
        ...prev,
        root: moveFolderBetweenFolders(prev.root, sourceFolderId, folderId),
        selectedFolderId: sourceFolderId,
        selectedRangeId: null,
      }));
      setExpandedFolderIds((prev) => Array.from(new Set([...prev, folderId, sourceFolderId])));
    }
  };

  const exportPNG = async () => {
    if (!exportRef.current) return;
    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const fileName = sanitizeFileName(currentRange?.name || "poker-range");
      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error(error);
      alert("Ошибка экспорта PNG");
    }
  };

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const expandAllFolders = () => {
    setExpandedFolderIds(collectFolderIds(state.root));
  };

  const collapseAllFolders = () => {
    const keep = currentFolderPath.map((folder) => folder.id);
    setExpandedFolderIds(keep);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrentRange();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openCreateFolderModal();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        rangeSearchInputRef.current?.focus();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        folderSearchInputRef.current?.focus();
        return;
      }

      if (event.key === "Delete") {
        if (state.selectedRangeId) {
          event.preventDefault();
          deleteRange();
        }
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        if (state.selectedRangeId) renameRange();
        else renameFolderById(state.selectedFolderId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const FolderBreadcrumbs = ({ compact = false }: { compact?: boolean }) => {
    const visiblePath = currentFolderPath.filter((folder) => folder.id !== ROOT_FOLDER_ID);
    if (!visiblePath.length) return null;

    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          fontSize: compact ? 12 : 13,
          color: "#5c6770",
        }}
      >
        {visiblePath.map((folder, index) => {
          const isLast = index === visiblePath.length - 1;
          return (
            <React.Fragment key={folder.id}>
              <button
                onClick={() => setState((prev) => ({ ...prev, selectedFolderId: folder.id, selectedRangeId: null }))}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                  color: isLast ? "#1f2933" : "#5c6770",
                  fontWeight: isLast ? 800 : 500,
                }}
              >
                {folder.name}
              </button>
              {!isLast && <span style={{ color: "#98a2ad" }}>›</span>}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const FolderContextMenu = () => {
    if (!contextMenu.open) return null;
    const folder = findFolder(state.root, contextMenu.folderId);
    if (!folder) return null;

    const itemStyle: React.CSSProperties = {
      width: "100%",
      textAlign: "left",
      padding: "9px 12px",
      border: "none",
      background: "white",
      cursor: "pointer",
      borderRadius: 8,
      fontSize: 13,
    };

    return (
      <div
        style={{
          position: "fixed",
          left: contextMenu.x,
          top: contextMenu.y,
          zIndex: 2000,
          width: 220,
          background: "white",
          border: "1px solid #d8e1ea",
          borderRadius: 12,
          boxShadow: "0 18px 38px rgba(15,23,42,0.18)",
          padding: 8,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ fontWeight: 800, fontSize: 13, padding: "6px 8px 10px", color: "#1f2933" }}>{folder.name}</div>
        <button style={itemStyle} onClick={() => openCreateFolderModal(folder.id)}>+ Создать подпапку</button>
        <button style={itemStyle} onClick={() => renameFolderById(folder.id)}>✏️ Переименовать</button>
        <button style={itemStyle} onClick={() => openRecolorFolderModal(folder.id)}>🎨 Цвет папки</button>
        <button style={itemStyle} onClick={() => toggleFavoriteFolder(folder.id)}>
          {favoriteFolderIds.includes(folder.id) ? "★ Убрать из избранного" : "☆ В избранное"}
        </button>
        <button style={itemStyle} onClick={() => deleteFolderById(folder.id)}>🗑 Удалить</button>
      </div>
    );
  };

  const FolderNode = ({ folder, depth, isLast }: { folder: Folder; depth: number; isLast: boolean }) => {
    const active = folder.id === state.selectedFolderId;
    const hasChildren = folder.folders.length > 0;
    const isExpanded = expandedFolderIds.includes(folder.id);
    const totalItems = countAllItems(folder);
    const ownItems = folder.items.length;
    const isFavorite = favoriteFolderIds.includes(folder.id);
    const matchesFolderSearch = folderSearchMatchIds.includes(folder.id);

    return (
      <div style={{ position: "relative" }}>
        <div style={{ position: "relative", marginLeft: depth * 18 }}>
          {depth > 0 && (
            <div
              style={{
                position: "absolute",
                left: -11,
                top: -8,
                bottom: isLast ? 20 : -8,
                width: 1,
                background: "#d7e0ea",
              }}
            />
          )}
          {depth > 0 && (
            <div
              style={{
                position: "absolute",
                left: -11,
                top: 20,
                width: 11,
                height: 1,
                background: "#d7e0ea",
              }}
            />
          )}

          <div
            draggable={folder.id !== ROOT_FOLDER_ID}
            onDragStart={(event) => onDragStartFolder(event, folder.id)}
            onDragOver={allowDrop}
            onDrop={(event) => onDropOnFolder(event, folder.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ open: true, x: event.clientX + 4, y: event.clientY + 4, folderId: folder.id });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 40,
              padding: "7px 10px",
              borderRadius: 12,
              border: active ? "1px solid #8ecae6" : matchesFolderSearch ? "1px solid #ffe08a" : "1px solid transparent",
              background: active ? "#eaf4ff" : matchesFolderSearch ? "#fff8dd" : "transparent",
              boxShadow: active ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
            }}
            title="ЛКМ — выбрать, ПКМ — меню, drag & drop — перенести"
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) toggleFolderExpanded(folder.id);
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                border: "1px solid #dde3ea",
                background: hasChildren ? "#f8fafc" : "transparent",
                opacity: hasChildren ? 1 : 0.35,
                cursor: hasChildren ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
            >
              {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
            </button>

            <button
              onClick={() => toggleFavoriteFolder(folder.id)}
              style={{
                border: "none",
                background: "transparent",
                cursor: folder.id === ROOT_FOLDER_ID ? "default" : "pointer",
                padding: 0,
                fontSize: 15,
                color: isFavorite ? "#f7b500" : "#c2cad4",
                width: 16,
                flex: "0 0 auto",
              }}
              title={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
              disabled={folder.id === ROOT_FOLDER_ID}
            >
              {isFavorite ? "★" : "☆"}
            </button>

            <div
              onClick={() => setState((prev) => ({ ...prev, selectedFolderId: folder.id, selectedRangeId: null }))}
              style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, cursor: "pointer" }}
            >
              <div style={{ fontSize: 16, width: 18, textAlign: "center", flex: "0 0 auto" }}>{hasChildren && isExpanded ? "📂" : "📁"}</div>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: folder.color,
                  border: "1px solid rgba(0,0,0,0.12)",
                  flex: "0 0 auto",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: active ? 800 : 600,
                    color: "#1f2933",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {folder.name}
                </div>
                <div style={{ fontSize: 11, color: "#7b8794", marginTop: 2 }}>
                  {ownItems} / {totalItems} {folder.folders.length > 0 ? `• папок: ${folder.folders.length}` : ""}
                </div>
              </div>
            </div>
          </div>

          {hasChildren && isExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {folder.folders
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, "ru"))
                .map((child, index, arr) => (
                  <FolderNode key={child.id} folder={child} depth={depth + 1} isLast={index === arr.length - 1} />
                ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{ fontFamily: "system-ui, sans-serif", height: "100vh", display: "flex", background: "#fff" }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        style={{
          width: 430,
          borderRight: "1px solid #e9edf2",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "#fbfcfe",
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#1f2933" }}>Библиотека</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Папки, подпапки, drag & drop, поиск и быстрый доступ
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => openCreateFolderModal()}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d8e1ea",
              background: "white",
              cursor: "pointer",
              flex: 1,
              minWidth: 120,
              fontWeight: 600,
            }}
          >
            + Папка внутри
          </button>
          <button
            onClick={expandAllFolders}
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8e1ea", background: "white", cursor: "pointer" }}
            title="Развернуть всё"
          >
            ⤢
          </button>
          <button
            onClick={collapseAllFolders}
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8e1ea", background: "white", cursor: "pointer" }}
            title="Свернуть всё"
          >
            ⤡
          </button>
        </div>

        <div style={{ border: "1px solid #e9edf2", borderRadius: 14, padding: 12, background: "white" }}>
          <div style={{ fontSize: 12, color: "#667085", marginBottom: 8, fontWeight: 700 }}>Текущий путь</div>
          <FolderBreadcrumbs compact />
        </div>

        <div style={{ border: "1px solid #e9edf2", borderRadius: 14, padding: 12, background: "white", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>Поиск по папкам</div>
          <input
            ref={folderSearchInputRef}
            value={folderSearch}
            onChange={(event) => setFolderSearch(event.target.value)}
            placeholder="Найти папку… (Ctrl+K)"
            style={{ width: "100%", padding: "9px 10px", borderRadius: 10, border: "1px solid #d8e1ea", outline: "none" }}
          />
        </div>

        {favoriteFolders.length > 0 && (
          <div style={{ border: "1px solid #e9edf2", borderRadius: 14, padding: 12, background: "white" }}>
            <div style={{ fontSize: 12, color: "#667085", fontWeight: 700, marginBottom: 8 }}>Избранные папки</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {favoriteFolders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setState((prev) => ({ ...prev, selectedFolderId: folder.id, selectedRangeId: null }))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: folder.id === state.selectedFolderId ? "1px solid #8ecae6" : "1px solid #e9edf2",
                    background: folder.id === state.selectedFolderId ? "#eaf4ff" : "white",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ color: "#f7b500" }}>★</span>
                  <span style={{ fontSize: 16 }}>{folder.folders.length ? "📂" : "📁"}</span>
                  <span style={{ flex: 1 }}>{folder.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>Папки</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", paddingRight: 6, border: "1px solid #e9edf2", borderRadius: 14, padding: 10, background: "white", minHeight: 220 }}>
          {state.root.folders.length === 0 ? (
            <div style={{ fontSize: 13, color: "#667085" }}>Папок пока нет.</div>
          ) : (
            state.root.folders
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "ru"))
              .map((folder, index, arr) => <FolderNode key={folder.id} folder={folder} depth={0} isLast={index === arr.length - 1} />)
          )}
        </div>

        {recentOpenedRanges.length > 0 && (
          <div style={{ border: "1px solid #e9edf2", borderRadius: 14, padding: 12, background: "white" }}>
            <div style={{ fontSize: 12, color: "#667085", fontWeight: 700, marginBottom: 8 }}>Последние открытые спектры</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflow: "auto" }}>
              {recentOpenedRanges.map((entry) => (
                <button
                  key={`${entry.folderId}-${entry.rangeId}`}
                  onClick={() => loadRange(entry.rangeId, entry.folderId)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #e9edf2",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{entry.range.name}</div>
                  <div style={{ fontSize: 11, color: "#667085", marginTop: 2 }}>{entry.folder.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ border: "1px solid #e9edf2", borderRadius: 14, padding: 12, background: "white", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>Спектры в “{currentFolder?.name ?? "?"}”</div>
          <input
            ref={rangeSearchInputRef}
            value={rangeSearch}
            onChange={(event) => setRangeSearch(event.target.value)}
            placeholder="Поиск по спектрам… (Ctrl+F)"
            style={{ width: "100%", padding: "9px 10px", borderRadius: 10, border: "1px solid #d8e1ea", outline: "none" }}
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", border: "1px solid #e9edf2", borderRadius: 14, background: "white", padding: 10 }}>
          {!sortedFilteredItems.length ? (
            <div style={{ color: "#777", fontSize: 13, lineHeight: 1.4 }}>
              {rangeSearch.trim() ? "Ничего не найдено по поиску." : "Тут пока пусто. Собери спектр справа и нажми “Сохранить”."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedFilteredItems.map((item) => {
                const active = item.id === state.selectedRangeId;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(event) => onDragStartRange(event, item.id)}
                    onClick={() => loadRange(item.id)}
                    style={{
                      padding: "9px 10px",
                      borderRadius: 12,
                      border: active ? "1px solid #8ecae6" : "1px solid #e9edf2",
                      background: active ? "#eaf4ff" : "white",
                      boxShadow: active ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
                      cursor: "pointer",
                    }}
                    title="Перетащи на папку слева"
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1f2933" }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "#667085", marginTop: 4 }}>рук: {Object.keys(item.hands).length}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={newRange} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8e1ea", background: "white", cursor: "pointer", flex: 1, fontWeight: 600 }}>Новый</button>
          <button onClick={renameRange} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8e1ea", background: "white", cursor: "pointer" }} title="Переименовать (F2)">✏️</button>
          <button onClick={deleteRange} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8e1ea", background: "white", cursor: "pointer" }} title="Удалить (Delete)">🗑</button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <FolderBreadcrumbs />

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={saveCurrentRange} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Сохранить</button>
          <button onClick={saveAsNew} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Сохранить как…</button>
          <button onClick={copyToClipboard} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: copied ? "#06d6a0" : "white", cursor: "pointer" }}>{copied ? "Скопировано ✓" : "Скопировать"}</button>
          <button onClick={clearAll} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Очистить</button>
          <button onClick={exportPNG} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Экспорт PNG</button>
          <div style={{ marginLeft: "auto" }}><strong>Комбо:</strong> {combos} / 1326 ({percent.toFixed(2)}%)</div>
        </div>

        <div ref={exportRef} style={{ background: "#ffffff", padding: 24, borderRadius: 16, display: "flex", gap: 24, width: "fit-content", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Редактор покерных спектров</h1>
              <div style={{ color: "#666" }}>{currentRange ? `— ${currentRange.name}` : "— новый спектр"}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(13, 40px)", gap: 2, marginTop: 16 }}>
              {Array.from({ length: 13 }).map((_, row) =>
                Array.from({ length: 13 }).map((_, col) => {
                  const label = getLabel(row, col);
                  const actionId = selected[label];
                  const action = actionId ? actionsMap[actionId] : null;
                  const baseColor = row === col ? "#f2c85b" : "#8ecae6";

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
                        background: action ? action.color : baseColor,
                        color: "white",
                        cursor: "pointer",
                        userSelect: "none",
                        borderRadius: 2,
                      }}
                    >
                      {label}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ width: 340, flex: "0 0 340px", border: "1px solid #eee", borderRadius: 12, padding: 14, height: "fit-content", background: "white" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Действия непокериста</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={addAction} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>+ Добавить действие</button>
              <button onClick={() => removeSelectedActions()} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }} title="Удалить выбранные действия">🗑 Выбранные</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {actions.map((action) => {
                const active = currentActionId === action.id;
                const checked = !!selectedActionIds[action.id];
                return (
                  <div
                    key={action.id}
                    style={{
                      border: active ? "2px solid #333" : checked ? "2px solid #8ecae6" : "1px solid #ddd",
                      borderRadius: 10,
                      padding: 10,
                      background: active ? "#f8f9fa" : "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSelectedAction(action.id)} />
                      <button
                        onClick={() => setCurrentActionId(action.id)}
                        style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: action.color, cursor: "pointer", flex: "0 0 auto" }}
                        title="Сделать действие активным"
                      />
                      <input
                        value={action.label}
                        onChange={(event) => updateActionLabel(action.id, event.target.value)}
                        style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", outline: "none", fontSize: 13 }}
                      />
                      <button
                        onClick={() => setActionPaletteModal({ open: true, actionId: action.id, color: action.color })}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
                        title="Выбрать цвет из палитры"
                      >
                        🎨
                      </button>
                      <button
                        onClick={() => removeAction(action.id)}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
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
              Горячие клавиши: Ctrl+S — сохранить, F2 — переименовать, Delete — удалить, Ctrl+Shift+N — новая папка.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Экспорт</div>
          <textarea
            value={exportText}
            readOnly
            rows={4}
            style={{ width: "100%", maxWidth: 1000, padding: 10, borderRadius: 10, border: "1px solid #ddd", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}
          />
        </div>
      </div>

      <FolderContextMenu />

      {folderModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setFolderModal({ open: false })}>
          <div style={{ width: 420, background: "white", borderRadius: 16, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }} onClick={(event) => event.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>{folderModal.mode === "create" ? "Новая папка" : "Цвет папки"}</div>

            {folderModal.mode === "create" && (
              <input
                value={folderModal.name}
                onChange={(event) => setFolderModal((prev) => (prev.open ? { ...prev, name: event.target.value } : prev))}
                placeholder="Название папки"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", outline: "none", marginBottom: 16, fontSize: 14 }}
              />
            )}

            <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>Выбери цвет</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 18 }}>
              {PALETTE_COLORS.map((color) => {
                const active = folderModal.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => setFolderModal((prev) => (prev.open ? { ...prev, color } : prev))}
                    style={{ width: 48, height: 48, borderRadius: 12, border: active ? "3px solid #333" : "1px solid #ddd", background: color, cursor: "pointer" }}
                    title={color}
                  />
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setFolderModal({ open: false })} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Отмена</button>
              <button onClick={submitFolderModal} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#f5f5f5", cursor: "pointer" }}>{folderModal.mode === "create" ? "Создать" : "Сохранить"}</button>
            </div>
          </div>
        </div>
      )}

      {actionPaletteModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001 }} onClick={() => setActionPaletteModal({ open: false })}>
          <div style={{ width: 460, background: "#f5f5f5", borderRadius: 16, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }} onClick={(event) => event.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Цвет действия</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>Выбери цвет</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 18 }}>
              {PALETTE_COLORS.map((color) => {
                const active = actionPaletteModal.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => setActionPaletteModal((prev) => (prev.open ? { ...prev, color } : prev))}
                    style={{ width: 48, height: 48, borderRadius: 12, border: active ? "3px solid #333" : "1px solid #ddd", background: color, cursor: "pointer" }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setActionPaletteModal({ open: false })} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>Отмена</button>
              <button
                onClick={() => {
                  if (!actionPaletteModal.open) return;
                  updateActionColor(actionPaletteModal.actionId, actionPaletteModal.color);
                  setActionPaletteModal({ open: false });
                }}
                style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
              >
                Сохранить
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
