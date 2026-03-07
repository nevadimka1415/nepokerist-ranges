import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import { toPng } from "html-to-image";

const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const STORAGE_KEY = "poker_ranges_v6_tree";
const ACTIONS_KEY = "poker_ranges_actions_v3";
const EXPANDED_FOLDERS_KEY = "poker_ranges_expanded_folders_v3";
const FAVORITE_FOLDERS_KEY = "poker_ranges_favorite_folders_v2";
const RECENT_RANGES_KEY = "poker_ranges_recent_ranges_v2";
const ROOT_FOLDER_ID = "root";

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

const FOLDER_COLORS = PALETTE_COLORS;
const ACTION_DEFAULT_COLOR = "#2d8fd5";

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

type ActionPaletteState =
  | { open: false }
  | {
      open: true;
      actionId: string;
    };

type FolderContextMenuState =
  | { open: false }
  | {
      open: true;
      folderId: string;
      x: number;
      y: number;
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
  const first = root.folders[0]?.id ?? ROOT_FOLDER_ID;
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

function saveStringArray(key: string, items: string[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

function loadExpandedFolderIds(): string[] {
  return loadStringArray(EXPANDED_FOLDERS_KEY);
}

function saveExpandedFolderIds(ids: string[]) {
  saveStringArray(EXPANDED_FOLDERS_KEY, ids);
}

function loadFavoriteFolderIds(): string[] {
  return loadStringArray(FAVORITE_FOLDERS_KEY);
}

function saveFavoriteFolderIds(ids: string[]) {
  saveStringArray(FAVORITE_FOLDERS_KEY, ids);
}

function loadRecentRangeIds(): string[] {
  return loadStringArray(RECENT_RANGES_KEY);
}

function saveRecentRangeIds(ids: string[]) {
  saveStringArray(RECENT_RANGES_KEY, ids.slice(0, 12));
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

function countAllItems(folder: Folder): number {
  return folder.items.length + folder.folders.reduce((sum, child) => sum + countAllItems(child), 0);
}

function countAllFolders(folder: Folder): number {
  return folder.folders.length + folder.folders.reduce((sum, child) => sum + countAllFolders(child), 0);
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

function collectAncestorIds(folderPath: Folder[]): string[] {
  return folderPath.map((folder) => folder.id);
}

function collectFolderIds(folder: Folder, includeRoot = false): string[] {
  const current = includeRoot || folder.id !== ROOT_FOLDER_ID ? [folder.id] : [];
  return [...current, ...folder.folders.flatMap((child) => collectFolderIds(child, true))];
}

function flattenVisibleFolderIds(folder: Folder, expandedFolderIds: string[], search: string): string[] {
  const normalized = search.trim().toLowerCase();
  const result: string[] = [];

  const walk = (node: Folder) => {
    if (node.id !== ROOT_FOLDER_ID) result.push(node.id);
    const shouldShowChildren = normalized ? true : expandedFolderIds.includes(node.id);
    if (shouldShowChildren) {
      for (const child of node.folders) walk(child);
    }
  };

  for (const child of folder.folders) walk(child);
  return result;
}

function findRangeById(folder: Folder, rangeId: string): { range: RangeItem; folderId: string } | null {
  const foundItem = folder.items.find((item) => item.id === rangeId);
  if (foundItem) return { range: foundItem, folderId: folder.id };
  for (const child of folder.folders) {
    const found = findRangeById(child, rangeId);
    if (found) return found;
  }
  return null;
}

function findRangeFolderPath(folder: Folder, rangeId: string, path: Folder[] = []): Folder[] | null {
  const nextPath = [...path, folder];
  if (folder.items.some((item) => item.id === rangeId)) return nextPath;
  for (const child of folder.folders) {
    const found = findRangeFolderPath(child, rangeId, nextPath);
    if (found) return found;
  }
  return null;
}

function matchesFolderSearch(folder: Folder, search: string): boolean {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  if (folder.name.toLowerCase().includes(normalized)) return true;
  return folder.folders.some((child) => matchesFolderSearch(child, search));
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

function isDescendantFolder(root: Folder, sourceFolderId: string, targetFolderId: string): boolean {
  const source = findFolder(root, sourceFolderId);
  if (!source) return false;
  return !!findFolder(source, targetFolderId);
}

function detachFolderFromTree(folder: Folder, folderId: string): { root: Folder; removed: Folder | null } {
  let removed: Folder | null = null;

  function walk(node: Folder): Folder {
    return {
      ...node,
      folders: node.folders
        .filter((child) => {
          if (child.id === folderId) {
            removed = child;
            return false;
          }
          return true;
        })
        .map((child) => walk(child)),
    };
  }

  return { root: walk(folder), removed };
}

function moveFolderTree(root: Folder, folderId: string, targetFolderId: string): Folder {
  if (folderId === targetFolderId) return root;
  if (targetFolderId === ROOT_FOLDER_ID && folderId === ROOT_FOLDER_ID) return root;
  if (isDescendantFolder(root, folderId, targetFolderId)) return root;

  const { root: detachedRoot, removed } = detachFolderFromTree(root, folderId);
  if (!removed) return root;

  return updateFolderTree(detachedRoot, targetFolderId, (folder) => ({
    ...folder,
    folders: [...folder.folders, removed],
  }));
}

function removeActionFromHands(hands: HandActionMap, removedIds: Set<string>): HandActionMap {
  const next: HandActionMap = {};
  for (const [hand, actionId] of Object.entries(hands)) {
    if (!removedIds.has(actionId)) next[hand] = actionId;
  }
  return next;
}

function updateActionsInTree(folder: Folder, removedIds: Set<string>): Folder {
  return {
    ...folder,
    items: folder.items.map((item) => ({
      ...item,
      hands: removeActionFromHands(item.hands, removedIds),
    })),
    folders: folder.folders.map((child) => updateActionsInTree(child, removedIds)),
  };
}

function getFolderIcon(isExpanded: boolean) {
  return isExpanded ? "📂" : "📁";
}

function App() {
  const updateInProgressRef = useRef(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const actionPaletteAnchorRef = useRef<string | null>(null);
  const folderHoverExpandTimeoutRef = useRef<number | null>(null);

  const [actions, setActions] = useState<ActionItem[]>(() => loadActions());
  const [currentActionId, setCurrentActionId] = useState<string>(() => getFallbackActionId(loadActions()));
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [actionPaletteState, setActionPaletteState] = useState<ActionPaletteState>({ open: false });

  const [selected, setSelected] = useState<HandActionMap>({});
  const [copied, setCopied] = useState(false);
  const [folderModal, setFolderModal] = useState<FolderModalState>({ open: false });
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState>({ open: false });

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());
  const draggingFolderIdRef = useRef<string | null>(null);
  const dragEnterFolderIdRef = useRef<string | null>(null);
  const lastSelectedFolderIdRef = useRef<string | null>(null);

  const [state, setState] = useState<AppState>(() => loadState(getFallbackActionId(loadActions())));
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => loadExpandedFolderIds());
  const [favoriteFolderIds, setFavoriteFolderIds] = useState<string[]>(() => loadFavoriteFolderIds());
  const [recentRangeIds, setRecentRangeIds] = useState<string[]>(() => loadRecentRangeIds());
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [spectrumSearch, setSpectrumSearch] = useState("");
  const [folderSearch, setFolderSearch] = useState("");

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
  useEffect(() => saveExpandedFolderIds(expandedFolderIds), [expandedFolderIds]);
  useEffect(() => saveFavoriteFolderIds(favoriteFolderIds), [favoriteFolderIds]);
  useEffect(() => saveRecentRangeIds(recentRangeIds), [recentRangeIds]);

  useEffect(() => {
    const closeContextMenu = () => setFolderContextMenu({ open: false });
    window.addEventListener("click", closeContextMenu);
    return () => window.removeEventListener("click", closeContextMenu);
  }, []);

  useEffect(() => {
    if (!actions.find((a) => a.id === currentActionId)) {
      setCurrentActionId(getFallbackActionId(actions));
    }
    setSelectedActionIds((prev) => prev.filter((id) => actions.some((action) => action.id === id)));
  }, [actions, currentActionId]);

  const actionsMap = useMemo(() => Object.fromEntries(actions.map((a) => [a.id, a])), [actions]);

  const currentFolder = useMemo(() => findFolder(state.root, state.selectedFolderId), [state.root, state.selectedFolderId]);

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

  const currentFolderPath = useMemo(() => findFolderPath(state.root, state.selectedFolderId) ?? [], [state.root, state.selectedFolderId]);

  useEffect(() => {
    if (!currentFolderPath.length) return;
    const pathIds = collectAncestorIds(currentFolderPath);
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...pathIds])));
  }, [currentFolderPath]);

  const sortedFilteredItems = useMemo(() => {
    const items = currentFolder?.items ?? [];
    const q = spectrumSearch.trim().toLowerCase();
    const filtered = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [currentFolder, spectrumSearch]);

  useEffect(() => {
    const normalized = folderSearch.trim().toLowerCase();
    if (!normalized) return;
    const matches: string[] = [];
    const collectMatches = (folder: Folder) => {
      for (const child of folder.folders) {
        if (matchesFolderSearch(child, normalized)) matches.push(child.id);
        collectMatches(child);
      }
    };
    collectMatches(state.root);
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...matches])));
  }, [folderSearch, state.root]);

  const visibleFolderIds = useMemo(
    () => flattenVisibleFolderIds(state.root, expandedFolderIds, folderSearch),
    [state.root, expandedFolderIds, folderSearch]
  );

  const favoriteFolders = useMemo(
    () => favoriteFolderIds.map((id) => findFolder(state.root, id)).filter(Boolean) as Folder[],
    [favoriteFolderIds, state.root]
  );

  const recentRanges = useMemo(
    () =>
      recentRangeIds
        .map((id) => findRangeById(state.root, id))
        .filter(Boolean) as Array<{ range: RangeItem; folderId: string }>,
    [recentRangeIds, state.root]
  );

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
    draggingFolderIdRef.current = null;
    dragEnterFolderIdRef.current = null;
    if (folderHoverExpandTimeoutRef.current) {
      window.clearTimeout(folderHoverExpandTimeoutRef.current);
      folderHoverExpandTimeoutRef.current = null;
    }
  };

  const clearAll = () => setSelected({});

  const addAction = () => {
    const newAction: ActionItem = {
      id: uid(),
      color: ACTION_DEFAULT_COLOR,
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

  const toggleActionSelection = (actionId: string) => {
    setSelectedActionIds((prev) =>
      prev.includes(actionId) ? prev.filter((id) => id !== actionId) : [...prev, actionId]
    );
  };

  const removeAction = (actionId: string) => {
    if (actions.length <= 1) {
      alert("Должно остаться хотя бы одно действие.");
      return;
    }
    const action = actions.find((a) => a.id === actionId);
    const ok = confirm(`Удалить действие "${action?.label ?? ""}"?`);
    if (!ok) return;
    const removedIds = new Set([actionId]);
    const fallbackId = actions.find((a) => a.id !== actionId)?.id ?? "";
    setActions((prev) => prev.filter((a) => a.id !== actionId));
    setSelected((prev) => removeActionFromHands(prev, removedIds));
    setState((prev) => ({ ...prev, root: updateActionsInTree(prev.root, removedIds) }));
    setSelectedActionIds((prev) => prev.filter((id) => id !== actionId));
    if (currentActionId === actionId) setCurrentActionId(fallbackId);
  };

  const removeSelectedActions = () => {
    if (!selectedActionIds.length) return;
    if (selectedActionIds.length >= actions.length) {
      alert("Нельзя удалить все действия сразу. Должно остаться хотя бы одно.");
      return;
    }
    const ok = confirm(`Удалить выбранные действия: ${selectedActionIds.length}?`);
    if (!ok) return;
    const removedIds = new Set<string>(selectedActionIds);
    const fallbackId = actions.find((a) => !removedIds.has(a.id))?.id ?? "";
    setActions((prev) => prev.filter((action) => !removedIds.has(action.id)));
    setSelected((prev) => removeActionFromHands(prev, removedIds));
    setState((prev) => ({ ...prev, root: updateActionsInTree(prev.root, removedIds) }));
    if (removedIds.has(currentActionId)) setCurrentActionId(fallbackId);
    setSelectedActionIds([]);
  };

  const openCreateFolderModal = (parentFolderId = state.selectedFolderId) => {
    setFolderModal({
      open: true,
      mode: "create",
      parentFolderId,
      name: "",
      color: "#8ecae6",
    });
  };

  const openRecolorFolderModal = (targetFolderId = state.selectedFolderId) => {
    const folder = findFolder(state.root, targetFolderId);
    if (!folder) return;
    if (folder.id === ROOT_FOLDER_ID) {
      alert("Корневую папку красить не надо 🙂");
      return;
    }
    setFolderModal({
      open: true,
      mode: "recolor",
      targetFolderId,
      name: folder.name,
      color: folder.color || "#8ecae6",
    });
  };

  const submitFolderModal = () => {
    if (!folderModal.open) return;

    if (folderModal.mode === "create") {
      const name = folderModal.name.trim();
      if (!name) return alert("Введите название папки.");
      const id = uid();
      const parentFolderId = folderModal.parentFolderId;
      if (!parentFolderId) return;
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
      setSelectedFolderIds([id]);
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

  const renameFolder = (folderId = state.selectedFolderId) => {
    const folder = findFolder(state.root, folderId);
    if (!folder) return;
    if (folder.id === ROOT_FOLDER_ID) return alert("Корневую папку переименовывать не надо.");
    const name = prompt("Новое название папки:", folder.name);
    if (!name) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (item) => ({ ...item, name: trimmedName })),
    }));
  };

  const deleteFoldersByIds = (folderIds: string[]) => {
    const unique = Array.from(new Set(folderIds)).filter((id) => id !== ROOT_FOLDER_ID);
    if (!unique.length) return;
    const ok = confirm(unique.length === 1 ? "Удалить выбранную папку?" : `Удалить выбранные папки: ${unique.length}?`);
    if (!ok) return;

    setState((prev) => {
      let nextRoot = prev.root;
      for (const folderId of unique) {
        nextRoot = removeFolderTree(nextRoot, folderId);
      }
      const fallback = nextRoot.folders[0]?.id ?? ROOT_FOLDER_ID;
      const selectedFolderId = unique.includes(prev.selectedFolderId) ? fallback : prev.selectedFolderId;
      const selectedRangeId = unique.includes(prev.selectedFolderId) ? null : prev.selectedRangeId;
      return { root: nextRoot, selectedFolderId, selectedRangeId };
    });

    setExpandedFolderIds((prev) => prev.filter((id) => !unique.includes(id)));
    setFavoriteFolderIds((prev) => prev.filter((id) => !unique.includes(id)));
    setSelectedFolderIds((prev) => prev.filter((id) => !unique.includes(id)));
  };

  const deleteFolder = (folderId = state.selectedFolderId) => {
    deleteFoldersByIds([folderId]);
  };

  const toggleFavoriteFolder = (folderId: string) => {
    setFavoriteFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [folderId, ...prev.filter((id) => id !== folderId)]
    );
  };

  const expandAllFolders = () => {
    setExpandedFolderIds(collectFolderIds(state.root));
  };

  const collapseAllFolders = () => {
    const keep = currentFolderPath.map((folder) => folder.id);
    setExpandedFolderIds(Array.from(new Set(keep)));
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
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const now = Date.now();
    const hands = selected;

    setState((prev) => {
      const folderId = folder.id;
      const root = updateFolderTree(prev.root, folderId, (node) => {
        if (prev.selectedRangeId) {
          return {
            ...node,
            items: node.items.map((it) =>
              it.id === prev.selectedRangeId ? { ...it, name: trimmedName, hands, updatedAt: now } : it
            ),
          };
        }
        const newItem: RangeItem = { id: uid(), name: trimmedName, hands, createdAt: now, updatedAt: now };
        return { ...node, items: [newItem, ...node.items] };
      });
      const updatedFolder = findFolder(root, folderId)!;
      const selectedRangeId = prev.selectedRangeId ?? updatedFolder.items[0]?.id ?? null;
      return { ...prev, root, selectedRangeId };
    });
  };

  const saveAsNew = () => {
    const folder = currentFolder;
    if (!folder) return;
    const defaultName = currentRange ? `${currentRange.name} (копия)` : "Новый спектр";
    const name = prompt("Название нового спектра:", defaultName);
    if (!name) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const now = Date.now();
    const newItem: RangeItem = { id: uid(), name: trimmedName, hands: selected, createdAt: now, updatedAt: now };
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (node) => ({ ...node, items: [newItem, ...node.items] })),
      selectedRangeId: newItem.id,
    }));
    setRecentRangeIds((prev) => [newItem.id, ...prev.filter((id) => id !== newItem.id)].slice(0, 12));
  };

  const renameRange = () => {
    const folder = currentFolder;
    if (!folder) return;
    if (!state.selectedRangeId) return alert("Сначала выбери спектр слева.");
    const item = folder.items.find((it) => it.id === state.selectedRangeId);
    if (!item) return;
    const name = prompt("Новое название спектра:", item.name);
    if (!name) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const now = Date.now();
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (node) => ({
        ...node,
        items: node.items.map((it) => (it.id === item.id ? { ...it, name: trimmedName, updatedAt: now } : it)),
      })),
    }));
  };

  const loadRange = (rangeId: string) => {
    const lookup = findRangeById(state.root, rangeId);
    if (!lookup) return;
    const folder = findFolder(state.root, lookup.folderId);
    if (!folder) return;
    setSelected(normalizeHands(lookup.range.hands, getFallbackActionId(actions)));
    setState((prev) => ({ ...prev, selectedFolderId: folder.id, selectedRangeId: lookup.range.id }));
    const rangePath = findRangeFolderPath(state.root, lookup.range.id) ?? [];
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...rangePath.map((f) => f.id)])));
    setRecentRangeIds((prev) => [lookup.range.id, ...prev.filter((id) => id !== lookup.range.id)].slice(0, 12));
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
      root: updateFolderTree(prev.root, folder.id, (node) => ({
        ...node,
        items: node.items.filter((it) => it.id !== prev.selectedRangeId),
      })),
      selectedRangeId: null,
    }));
    setRecentRangeIds((prev) => prev.filter((id) => id !== item.id));
  };

  const onDragStartRange = (e: React.DragEvent, rangeId: string) => {
    e.dataTransfer.setData("text/rangeId", rangeId);
    e.dataTransfer.setData("text/fromFolderId", state.selectedFolderId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragStartFolder = (e: React.DragEvent, folderId: string) => {
    draggingFolderIdRef.current = folderId;
    e.dataTransfer.setData("text/folderId", folderId);
    e.dataTransfer.effectAllowed = "move";
  };

  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const autoScrollFolderList = (clientY: number) => {
    const container = folderListRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const threshold = 60;
    if (clientY < rect.top + threshold) container.scrollTop -= 24;
    if (clientY > rect.bottom - threshold) container.scrollTop += 24;
  };

  const onDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const rangeId = e.dataTransfer.getData("text/rangeId");
    const fromFolderId = e.dataTransfer.getData("text/fromFolderId");
    const draggedFolderId = e.dataTransfer.getData("text/folderId");

    if (rangeId && fromFolderId) {
      setState((prev) => {
        const { root, moved } = moveRangeBetweenFolders(prev.root, fromFolderId, folderId, rangeId);
        if (!moved) return prev;
        return { ...prev, root, selectedFolderId: folderId, selectedRangeId: moved.id };
      });
      setExpandedFolderIds((prev) => Array.from(new Set([...prev, folderId])));
      return;
    }

    if (draggedFolderId) {
      if (draggedFolderId === folderId) return;
      if (isDescendantFolder(state.root, draggedFolderId, folderId)) {
        alert("Нельзя переместить папку внутрь самой себя или её дочерней папки.");
        return;
      }
      setState((prev) => ({
        ...prev,
        root: moveFolderTree(prev.root, draggedFolderId, folderId),
      }));
      setExpandedFolderIds((prev) => Array.from(new Set([...prev, folderId])));
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

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const handleFolderSelection = (folderId: string, e?: React.MouseEvent) => {
    const isShift = !!e?.shiftKey;
    const isCtrlLike = !!(e?.ctrlKey || e?.metaKey);
    setState((prev) => ({ ...prev, selectedFolderId: folderId, selectedRangeId: null }));

    if (isShift && lastSelectedFolderIdRef.current) {
      const fromIndex = visibleFolderIds.indexOf(lastSelectedFolderIdRef.current);
      const toIndex = visibleFolderIds.indexOf(folderId);
      if (fromIndex >= 0 && toIndex >= 0) {
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        setSelectedFolderIds(visibleFolderIds.slice(start, end + 1));
      } else {
        setSelectedFolderIds([folderId]);
      }
    } else if (isCtrlLike) {
      setSelectedFolderIds((prev) =>
        prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
      );
    } else {
      setSelectedFolderIds([folderId]);
    }

    lastSelectedFolderIdRef.current = folderId;
  };

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
          marginBottom: compact ? 0 : 10,
        }}
      >
        {visiblePath.map((folder, index) => {
          const isLast = index === visiblePath.length - 1;
          return (
            <React.Fragment key={folder.id}>
              <button
                onClick={() => handleFolderSelection(folder.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                  color: isLast ? "#1f2933" : "#5c6770",
                  fontWeight: isLast ? 700 : 500,
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

  const FolderNode = ({ folder, depth, parentHasNext }: { folder: Folder; depth: number; parentHasNext: boolean[] }) => {
    const hasChildren = folder.folders.length > 0;
    const isExpanded = folderSearch.trim() ? true : expandedFolderIds.includes(folder.id);
    const isSelected = selectedFolderIds.includes(folder.id);
    const isPrimary = folder.id === state.selectedFolderId;
    const totalItems = countAllItems(folder);
    const ownItems = folder.items.length;
    const isFavorite = favoriteFolderIds.includes(folder.id);
    const isSearchMatch = folderSearch.trim()
      ? folder.name.toLowerCase().includes(folderSearch.trim().toLowerCase())
      : false;

    if (folderSearch.trim() && !matchesFolderSearch(folder, folderSearch)) {
      return null;
    }

    return (
      <div style={{ position: "relative" }}>
        <div style={{ position: "relative", marginLeft: depth * 16 }}>
          {parentHasNext.map((hasNext, index) =>
            hasNext ? (
              <div
                key={index}
                style={{
                  position: "absolute",
                  left: index * 16 + 7,
                  top: -8,
                  bottom: -8,
                  width: 1,
                  background: "#d7dee7",
                }}
              />
            ) : null
          )}

          {depth > 0 && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: -9,
                  top: 0,
                  width: 10,
                  height: 1,
                  background: "#d7dee7",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: -9,
                  top: -12,
                  bottom: 16,
                  width: 1,
                  background: "#d7dee7",
                }}
              />
            </>
          )}

          <div
            draggable
            onDragStart={(e) => onDragStartFolder(e, folder.id)}
            onDragOver={(e) => {
              allowDrop(e);
              autoScrollFolderList(e.clientY);
              if (dragEnterFolderIdRef.current !== folder.id) {
                dragEnterFolderIdRef.current = folder.id;
                if (folderHoverExpandTimeoutRef.current) {
                  window.clearTimeout(folderHoverExpandTimeoutRef.current);
                }
                folderHoverExpandTimeoutRef.current = window.setTimeout(() => {
                  if (hasChildren) {
                    setExpandedFolderIds((prev) => Array.from(new Set([...prev, folder.id])));
                  }
                }, 450);
              }
            }}
            onDrop={(e) => onDropOnFolder(e, folder.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              handleFolderSelection(folder.id);
              setFolderContextMenu({ open: true, folderId: folder.id, x: e.clientX, y: e.clientY });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 10,
              padding: "5px 8px",
              background: isPrimary ? "#eaf4ff" : isSelected ? "#f4f7fb" : "white",
              border: isPrimary ? "1px solid #8ecae6" : isSelected ? "1px solid #d7dee7" : "1px solid transparent",
              boxShadow: isPrimary ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
              cursor: "pointer",
              minHeight: 32,
              marginBottom: 3,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleFolderExpanded(folder.id);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: "1px solid #dde3ea",
                background: hasChildren ? "#f8fafc" : "transparent",
                cursor: hasChildren ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5c6770",
                flex: "0 0 auto",
                opacity: hasChildren ? 1 : 0.3,
                fontSize: 11,
              }}
              title={hasChildren ? (isExpanded ? "Свернуть" : "Развернуть") : "Нет вложенных папок"}
            >
              {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFavoriteFolder(folder.id);
              }}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                fontSize: 14,
                width: 16,
              }}
              title={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
            >
              {isFavorite ? "★" : "☆"}
            </button>

            <div
              onClick={(e) => handleFolderSelection(folder.id, e)}
              style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}
            >
              <div style={{ fontSize: 15, width: 18, textAlign: "center" }}>{getFolderIcon(isExpanded)}</div>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: folder.color,
                  border: "1px solid rgba(0,0,0,0.12)",
                  flex: "0 0 auto",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: isPrimary ? 800 : 600,
                    color: isSearchMatch ? "#0f172a" : "#1f2933",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                  }}
                >
                  {folder.name}
                </div>
                <div style={{ fontSize: 10, color: "#7b8794", marginTop: 2 }}>
                  {ownItems} / {totalItems}
                  {folder.folders.length > 0 ? ` • ${folder.folders.length} пап.` : ""}
                </div>
              </div>
            </div>
          </div>

          {hasChildren && isExpanded && (
            <div>
              {folder.folders.map((child, index) => (
                <FolderNode
                  key={child.id}
                  folder={child}
                  depth={depth + 1}
                  parentHasNext={[...parentHasNext, index < folder.folders.length - 1]}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentRange();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openCreateFolderModal();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const folderInput = document.getElementById("folder-search-input") as HTMLInputElement | null;
        folderInput?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const spectrumInput = document.getElementById("range-search-input") as HTMLInputElement | null;
        spectrumInput?.focus();
      }
      if (e.key === "F2") {
        e.preventDefault();
        if (selectedFolderIds.length > 0) renameFolder(selectedFolderIds[0]);
        else renameRange();
      }
      if (e.key === "Delete") {
        const target = e.target as HTMLElement | null;
        const tagName = target?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea") return;
        e.preventDefault();
        if (selectedFolderIds.length > 1) deleteFoldersByIds(selectedFolderIds);
        else if (selectedFolderIds.length === 1) deleteFolder(selectedFolderIds[0]);
        else if (state.selectedRangeId) deleteRange();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      style={{ fontFamily: "system-ui", height: "100vh", display: "flex", background: "#fff" }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        style={{
          width: 420,
          borderRight: "1px solid #e9edf2",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "#fbfcfe",
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#1f2933" }}>Библиотека</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            Компактное дерево папок, поиск, избранное и быстрый доступ к спектрам
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => openCreateFolderModal()}
            style={toolbarButtonStylePrimary}
          >
            + Папка внутри
          </button>
          <button onClick={() => renameFolder()} style={toolbarIconButtonStyle} title="Переименовать папку">
            ✏️
          </button>
          <button onClick={() => openRecolorFolderModal()} style={toolbarIconButtonStyle} title="Цвет папки">
            🎨
          </button>
          <button onClick={() => deleteFoldersByIds(selectedFolderIds.length ? selectedFolderIds : [state.selectedFolderId])} style={toolbarIconButtonStyle} title="Удалить выбранные папки">
            🗑
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={expandAllFolders} style={toolbarSmallButtonStyle}>Развернуть всё</button>
          <button onClick={collapseAllFolders} style={toolbarSmallButtonStyle}>Свернуть всё</button>
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>Текущий путь</div>
          <FolderBreadcrumbs compact />
        </div>

        {!!favoriteFolders.length && (
          <div style={panelStyle}>
            <div style={panelTitleStyle}>Избранные папки</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {favoriteFolders.map((folder) => (
                <button key={folder.id} onClick={() => handleFolderSelection(folder.id)} style={chipStyle}>
                  ★ {folder.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!!recentRanges.length && (
          <div style={panelStyle}>
            <div style={panelTitleStyle}>Последние спектры</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflow: "auto" }}>
              {recentRanges.slice(0, 6).map(({ range, folderId }) => {
                const folder = findFolder(state.root, folderId);
                return (
                  <button key={range.id} onClick={() => loadRange(range.id)} style={recentRangeButtonStyle}>
                    <span style={{ fontWeight: 600 }}>{range.name}</span>
                    <span style={{ color: "#7b8794", fontSize: 11 }}>{folder?.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={panelStyle}>
          <div style={panelTitleStyle}>Поиск папок</div>
          <input
            id="folder-search-input"
            value={folderSearch}
            onChange={(e) => setFolderSearch(e.target.value)}
            placeholder="Найти папку..."
            style={searchInputStyle}
          />
          {!!selectedFolderIds.length && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#667085" }}>
              Выбрано папок: <strong>{selectedFolderIds.length}</strong>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>Папки</div>

        <div ref={folderListRef} style={{ ...panelStyle, flex: 1, overflow: "auto", minHeight: 220, padding: 8 }}>
          {state.root.folders.map((folder, index) => (
            <FolderNode key={folder.id} folder={folder} depth={0} parentHasNext={[index < state.root.folders.length - 1]} />
          ))}
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>Спектры в “{currentFolder?.name ?? "?"}”</div>
          <input
            id="range-search-input"
            value={spectrumSearch}
            onChange={(e) => setSpectrumSearch(e.target.value)}
            placeholder="Поиск по спектрам..."
            style={searchInputStyle}
          />
        </div>

        <div style={{ ...panelStyle, flex: 1, overflow: "auto", padding: 8 }}>
          {!sortedFilteredItems.length ? (
            <div style={{ color: "#777", fontSize: 13, lineHeight: 1.4 }}>
              {spectrumSearch.trim() ? "Ничего не найдено по поиску." : "Тут пока пусто. Собери спектр справа и нажми “Сохранить”."}
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
                      padding: "8px 9px",
                      borderRadius: 10,
                      border: active ? "1px solid #8ecae6" : "1px solid #e9edf2",
                      background: active ? "#eaf4ff" : "white",
                      boxShadow: active ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
                      cursor: "pointer",
                    }}
                    title="Перетащи на папку слева"
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1f2933" }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: "#667085", marginTop: 2 }}>
                      рук: {Object.keys(it.hands).length}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={newRange} style={toolbarButtonStylePrimary}>Новый</button>
          <button onClick={renameRange} style={toolbarIconButtonStyle} title="Переименовать спектр">✏️</button>
          <button onClick={deleteRange} style={toolbarIconButtonStyle} title="Удалить спектр">🗑</button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>
        <FolderBreadcrumbs />

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <button onClick={saveCurrentRange} style={secondaryButtonStyle}>Сохранить</button>
          <button onClick={saveAsNew} style={secondaryButtonStyle}>Сохранить как…</button>
          <button onClick={copyToClipboard} style={{ ...secondaryButtonStyle, background: copied ? "#06d6a0" : "white" }}>
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
          <button onClick={clearAll} style={secondaryButtonStyle}>Очистить</button>
          <button onClick={exportPNG} style={secondaryButtonStyle}>Экспорт PNG</button>
          <div style={{ marginLeft: "auto" }}>
            <strong>Комбо:</strong> {combos} / 1326 ({percent.toFixed(2)}%)
          </div>
        </div>

        <div
          ref={exportRef}
          style={{
            background: "#ffffff",
            padding: 20,
            borderRadius: 16,
            display: "flex",
            gap: 20,
            width: "fit-content",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
          }}
        >
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
                  const isSelected = !!actionId;
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
                        background: isSelected ? action?.color ?? "#ef476f" : baseColor,
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

          <div style={{ width: 330, flex: "0 0 330px", border: "1px solid #eee", borderRadius: 14, padding: 14, height: "fit-content", background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Действия непокериста</div>
              <button onClick={removeSelectedActions} style={toolbarSmallButtonStyle} disabled={!selectedActionIds.length}>
                🗑 Выбранные
              </button>
            </div>

            <button onClick={addAction} style={{ ...toolbarButtonStylePrimary, width: "100%", marginBottom: 10 }}>
              + Добавить действие
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actions.map((action) => {
                const active = currentActionId === action.id;
                const checked = selectedActionIds.includes(action.id);
                return (
                  <div
                    key={action.id}
                    style={{
                      border: active ? "2px solid #2d8fd5" : "1px solid #d8e1ea",
                      borderRadius: 12,
                      padding: 10,
                      background: active ? "#f8fbff" : "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleActionSelection(action.id)} />
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
                        style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", outline: "none", fontSize: 13 }}
                      />
                      <button onClick={() => setActionPaletteState({ open: true, actionId: action.id })} style={toolbarIconButtonStyle} title="Палитра цвета">
                        🎨
                      </button>
                      <button onClick={() => removeAction(action.id)} style={toolbarIconButtonStyle} title="Удалить действие">
                        🗑
                      </button>
                    </div>
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                      {PALETTE_COLORS.map((color) => {
                        const colorActive = action.color === color;
                        return (
                          <button
                            key={color}
                            onMouseEnter={() => {
                              actionPaletteAnchorRef.current = action.id;
                            }}
                            onClick={() => updateActionColor(action.id, color)}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 9,
                              border: colorActive ? "3px solid #1f2933" : "1px solid #d8e1ea",
                              background: color,
                              cursor: "pointer",
                              boxSizing: "border-box",
                            }}
                            title={color}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
              Выбери действие и закрашивай руки на таблице. Чекбоксом можно отметить несколько действий и удалить их одной кнопкой.
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
        <div style={modalOverlayStyle} onClick={() => setFolderModal({ open: false })}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>
              {folderModal.mode === "create" ? "Новая папка" : "Цвет папки"}
            </div>

            {folderModal.mode === "create" && (
              <input
                value={folderModal.name}
                onChange={(e) => setFolderModal((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))}
                placeholder="Название папки"
                style={{ ...searchInputStyle, marginBottom: 16, padding: "10px 12px" }}
              />
            )}

            <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>Выбери цвет</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 18 }}>
              {FOLDER_COLORS.map((color) => {
                const active = folderModal.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => setFolderModal((prev) => (prev.open ? { ...prev, color } : prev))}
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
              <button onClick={() => setFolderModal({ open: false })} style={secondaryButtonStyle}>Отмена</button>
              <button onClick={submitFolderModal} style={secondaryButtonStyle}>
                {folderModal.mode === "create" ? "Создать" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionPaletteState.open && (
        <div style={modalOverlayStyle} onClick={() => setActionPaletteState({ open: false })}>
          <div style={{ ...modalCardStyle, width: 470 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Цвет действия</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>Выбери цвет для закрашивания рук</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 18 }}>
              {PALETTE_COLORS.map((color) => {
                const action = actions.find((item) => item.id === actionPaletteState.actionId);
                const active = action?.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => updateActionColor(actionPaletteState.actionId, color)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      border: active ? "3px solid #333" : "1px solid #ddd",
                      background: color,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setActionPaletteState({ open: false })} style={secondaryButtonStyle}>Готово</button>
            </div>
          </div>
        </div>
      )}

      {folderContextMenu.open && (
        <div
          style={{
            position: "fixed",
            top: folderContextMenu.y,
            left: folderContextMenu.x,
            background: "white",
            border: "1px solid #d8e1ea",
            borderRadius: 10,
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
            zIndex: 1200,
            minWidth: 220,
            padding: 6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuButton onClick={() => { openCreateFolderModal(folderContextMenu.folderId); setFolderContextMenu({ open: false }); }}>Создать подпапку</ContextMenuButton>
          <ContextMenuButton onClick={() => { renameFolder(folderContextMenu.folderId); setFolderContextMenu({ open: false }); }}>Переименовать</ContextMenuButton>
          <ContextMenuButton onClick={() => { openRecolorFolderModal(folderContextMenu.folderId); setFolderContextMenu({ open: false }); }}>Сменить цвет</ContextMenuButton>
          <ContextMenuButton onClick={() => { toggleFavoriteFolder(folderContextMenu.folderId); setFolderContextMenu({ open: false }); }}>
            {favoriteFolderIds.includes(folderContextMenu.folderId) ? "Убрать из избранного" : "Добавить в избранное"}
          </ContextMenuButton>
          <ContextMenuButton onClick={() => { deleteFolder(folderContextMenu.folderId); setFolderContextMenu({ open: false }); }}>Удалить</ContextMenuButton>
        </div>
      )}
    </div>
  );
}

function ContextMenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: 8,
        border: "none",
        background: "white",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#f5f8fb";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "white";
      }}
    >
      {children}
    </button>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid #e9edf2",
  borderRadius: 14,
  padding: 10,
  background: "white",
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#667085",
  marginBottom: 8,
  fontWeight: 700,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #d8e1ea",
  outline: "none",
};

const toolbarButtonStylePrimary: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #d8e1ea",
  background: "white",
  cursor: "pointer",
  flex: 1,
  minWidth: 120,
  fontWeight: 600,
};

const toolbarIconButtonStyle: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 10,
  border: "1px solid #d8e1ea",
  background: "white",
  cursor: "pointer",
};

const toolbarSmallButtonStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 9,
  border: "1px solid #d8e1ea",
  background: "white",
  cursor: "pointer",
  fontSize: 12,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
};

const recentRangeButtonStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  border: "1px solid #e9edf2",
  background: "white",
  padding: "6px 8px",
  borderRadius: 8,
  cursor: "pointer",
};

const chipStyle: React.CSSProperties = {
  border: "1px solid #d8e1ea",
  background: "white",
  borderRadius: 999,
  padding: "5px 9px",
  cursor: "pointer",
  fontSize: 12,
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.25)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalCardStyle: React.CSSProperties = {
  width: 420,
  background: "white",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
