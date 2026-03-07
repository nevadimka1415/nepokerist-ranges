import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import { toPng } from "html-to-image";

const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const STORAGE_KEY = "poker_ranges_v4_tree";
const ACTIONS_KEY = "poker_ranges_actions_v1";
const EXPANDED_FOLDERS_KEY = "poker_ranges_expanded_folders_v1";

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

type PaintTool = "brush" | "rectangle";

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



const CALC_SUITS = [
  { id: "s", label: "♠" },
  { id: "h", label: "♥" },
  { id: "d", label: "♦" },
  { id: "c", label: "♣" },
] as const;

type CalcStats = {
  win: number;
  tie: number;
  equity: number;
};

type CalcResult = {
  player1: CalcStats;
  player2: CalcStats;
  board: string[];
  simulations: number;
};

function getSuitLabel(suitId: string) {
  return CALC_SUITS.find((item) => item.id === suitId)?.label ?? "?";
}

function formatCardLabel(card: string) {
  if (!card) return "—";
  return `${card[0]}${getSuitLabel(card[1])}`;
}

function buildDeck() {
  const deck: string[] = [];
  for (const rank of ranks) {
    for (const suit of CALC_SUITS) {
      deck.push(`${rank}${suit.id}`);
    }
  }
  return deck;
}

function getRankValue(rank: string) {
  return "23456789TJQKA".indexOf(rank) + 2;
}

function compareScore(a: number[], b: number[]) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function getStraightHigh(values: number[]) {
  const unique = Array.from(new Set(values)).sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) {
      return slice[0] === 1 ? 5 : slice[0];
    }
  }
  return 0;
}

function evaluateFive(cards: string[]) {
  const ranksOnly = cards.map((card) => card[0]);
  const suitsOnly = cards.map((card) => card[1]);
  const values = ranksOnly.map(getRankValue).sort((a, b) => b - a);
  const flush = suitsOnly.every((suit) => suit === suitsOnly[0]);
  const straightHigh = getStraightHigh(values);

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0]?.[1] === 4) {
    const kicker = groups.find((item) => item[1] === 1)?.[0] ?? 0;
    return [7, groups[0][0], kicker];
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0]?.[1] === 3) {
    const kickers = groups.filter((item) => item[1] === 1).map((item) => item[0]).sort((a, b) => b - a);
    return [3, groups[0][0], ...kickers];
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((item) => item[1] === 2).map((item) => item[0]).sort((a, b) => b - a);
    const kicker = groups.find((item) => item[1] === 1)?.[0] ?? 0;
    return [2, pairs[0], pairs[1], kicker];
  }
  if (groups[0]?.[1] === 2) {
    const kickers = groups.filter((item) => item[1] === 1).map((item) => item[0]).sort((a, b) => b - a);
    return [1, groups[0][0], ...kickers];
  }
  return [0, ...values];
}

function evaluateSeven(cards: string[]) {
  let best: number[] | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const score = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScore(score, best) > 0) {
              best = score;
            }
          }
        }
      }
    }
  }
  return best ?? [0];
}

function sampleCards(deck: string[], count: number) {
  const source = [...deck];
  for (let i = source.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [source[i], source[j]] = [source[j], source[i]];
  }
  return source.slice(0, count);
}

function calculatePokerEquity(player1: string[], player2: string[], board: string[]) {
  const allUsed = [...player1, ...player2, ...board].filter(Boolean);
  if (player1.length !== 2 || player2.length !== 2) {
    return { error: "Заполни по две карты каждому игроку." as const };
  }
  if (new Set(allUsed).size !== allUsed.length) {
    return { error: "Одна и та же карта выбрана несколько раз." as const };
  }

  const missingBoard = 5 - board.length;
  const deck = buildDeck().filter((card) => !allUsed.includes(card));
  const simulations = Math.max(800, Math.min(2500, missingBoard === 0 ? 1 : 1500));

  let win1 = 0;
  let win2 = 0;
  let tie = 0;

  const runs = missingBoard === 0 ? 1 : simulations;
  for (let i = 0; i < runs; i += 1) {
    const drawn = missingBoard === 0 ? [] : sampleCards(deck, missingBoard);
    const fullBoard = [...board, ...drawn];
    const score1 = evaluateSeven([...player1, ...fullBoard]);
    const score2 = evaluateSeven([...player2, ...fullBoard]);
    const cmp = compareScore(score1, score2);
    if (cmp > 0) win1 += 1;
    else if (cmp < 0) win2 += 1;
    else tie += 1;
  }

  const total = win1 + win2 + tie || 1;
  return {
    result: {
      player1: {
        win: (win1 / total) * 100,
        tie: (tie / total) * 100,
        equity: ((win1 + tie / 2) / total) * 100,
      },
      player2: {
        win: (win2 / total) * 100,
        tie: (tie / total) * 100,
        equity: ((win2 + tie / 2) / total) * 100,
      },
      board,
      simulations: runs,
    } satisfies CalcResult,
  };
}

function CardPicker({
  label,
  value,
  onChange,
  allowEmpty = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const rank = value ? value[0] : "";
  const suit = value ? value[1] : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <select
          value={rank}
          onChange={(e) => {
            const nextRank = e.target.value;
            if (!nextRank) {
              onChange("");
              return;
            }
            onChange(`${nextRank}${suit || "s"}`);
          }}
          style={{ ...calcSelectStyle, width: 62 }}
        >
          {allowEmpty && <option value="">–</option>}
          {ranks.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={suit}
          onChange={(e) => {
            const nextSuit = e.target.value;
            if (!nextSuit) {
              onChange("");
              return;
            }
            onChange(`${rank || "A"}${nextSuit}`);
          }}
          style={{ ...calcSelectStyle, width: 66 }}
        >
          {allowEmpty && <option value="">–</option>}
          {CALC_SUITS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {allowEmpty && (
          <button onClick={() => onChange("")} style={calcMiniButtonStyle} title="Очистить карту">
            ×
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#0f172a", minHeight: 18 }}>{formatCardLabel(value)}</div>
    </div>
  );
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

function loadExpandedFolderIds(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveExpandedFolderIds(ids: string[]) {
  localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(ids));
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

function countAllItems(folder: Folder): number {
  return folder.items.length + folder.folders.reduce((sum, child) => sum + countAllItems(child), 0);
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

function getCombosForHand(hand: string) {
  if (hand.length === 2) return 6;
  if (hand.endsWith("s")) return 4;
  return 12;
}

function getLabelsInRectangle(startRow: number, startCol: number, endRow: number, endCol: number) {
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const labels: string[] = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      labels.push(getLabel(row, col));
    }
  }

  return labels;
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
  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [rectanglePreview, setRectanglePreview] = useState<string[]>([]);
  const [calcPlayer1, setCalcPlayer1] = useState<string[]>(["As", "Ah"]);
  const [calcPlayer2, setCalcPlayer2] = useState<string[]>(["Js", "Qh"]);
  const [calcBoard, setCalcBoard] = useState<string[]>(["", "", "", "", ""]);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState("");

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());
  const dragStartCellRef = useRef<{ row: number; col: number } | null>(null);

  const [state, setState] = useState<AppState>(() => {
    const loadedActions = loadActions();
    return loadState(getFallbackActionId(loadedActions));
  });

  const [search, setSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => loadExpandedFolderIds());

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
    saveExpandedFolderIds(expandedFolderIds);
  }, [expandedFolderIds]);

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
      total += getCombosForHand(hand);
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

  const actionStats = useMemo(() => {
    const stats: Array<ActionItem & { combos: number; hands: number; percent: number }> = actions.map((action) => ({
      ...action,
      combos: 0,
      hands: 0,
      percent: 0,
    }));
    const byId = new Map<string, ActionItem & { combos: number; hands: number; percent: number }>(
      stats.map((item) => [item.id, item])
    );

    for (const [hand, actionId] of Object.entries(selected)) {
      const target = byId.get(actionId);
      if (!target) continue;
      target.hands += 1;
      target.combos += getCombosForHand(hand);
    }

    for (const item of stats) {
      item.percent = (item.combos / 1326) * 100;
    }

    return stats.filter((item) => item.hands > 0 || item.id === currentActionId);
  }, [actions, selected, currentActionId]);

  const sortedFilteredItems = useMemo(() => {
    const items = currentFolder?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [currentFolder, search]);

  const currentFolderPath = useMemo(() => {
    return findFolderPath(state.root, state.selectedFolderId) ?? [];
  }, [state.root, state.selectedFolderId]);

  useEffect(() => {
    if (!currentFolderPath.length) return;

    const pathIds = collectAncestorIds(currentFolderPath);
    setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...pathIds])));
  }, [currentFolderPath]);

  useEffect(() => {
    const board = calcBoard.filter(Boolean);
    const result = calculatePokerEquity(calcPlayer1.filter(Boolean), calcPlayer2.filter(Boolean), board);
    if ("error" in result) {
      setCalcError(result.error);
      setCalcResult(null);
      return;
    }
    setCalcError("");
    setCalcResult(result.result);
  }, [calcPlayer1, calcPlayer2, calcBoard]);

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

  const applyLabelsBulk = (labels: string[], mode: "add" | "remove") => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const label of labels) {
        if (mode === "add") {
          if (!currentActionId) continue;
          next[label] = currentActionId;
        } else {
          delete next[label];
        }
      }
      return next;
    });
  };

  const endDrag = () => {
    if (paintTool === "rectangle" && dragStartCellRef.current && rectanglePreview.length) {
      applyLabelsBulk(rectanglePreview, dragModeRef.current);
    }
    isDraggingRef.current = false;
    visitedRef.current = new Set();
    dragStartCellRef.current = null;
    setRectanglePreview([]);
  };

  const clearAll = () => setSelected({});

  const fillByKind = (kind: "pairs" | "suited" | "offsuit" | "all") => {
    const labels: string[] = [];
    for (let row = 0; row < 13; row += 1) {
      for (let col = 0; col < 13; col += 1) {
        const label = getLabel(row, col);
        if (kind === "all") labels.push(label);
        else if (kind === "pairs" && row === col) labels.push(label);
        else if (kind === "suited" && row < col) labels.push(label);
        else if (kind === "offsuit" && row > col) labels.push(label);
      }
    }
    applyLabelsBulk(labels, "add");
  };

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
          next[hand] = String(storedActionId);
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

      setExpandedFolderIds((prev) => Array.from(new Set([...prev, parentFolderId, id])));
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

    const trimmedName = name.trim();
    if (!trimmedName) return;

    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({ ...f, name: trimmedName })),
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

    setExpandedFolderIds((prev) => prev.filter((id) => id !== folder.id));
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
      const root = updateFolderTree(prev.root, folderId, (f) => {
        if (prev.selectedRangeId) {
          const items = f.items.map((it) =>
            it.id === prev.selectedRangeId ? { ...it, name: trimmedName, hands, updatedAt: now } : it
          );
          return { ...f, items };
        }

        const newItem = {
          id: uid(),
          name: trimmedName,
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

    const trimmedName = name.trim();
    if (!trimmedName) return;

    const now = Date.now();
    const newItem: RangeItem = {
      id: uid(),
      name: trimmedName,
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

    const trimmedName = name.trim();
    if (!trimmedName) return;

    const now = Date.now();
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folder.id, (f) => ({
        ...f,
        items: f.items.map((it) => (it.id === item.id ? { ...it, name: trimmedName, updatedAt: now } : it)),
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

    setExpandedFolderIds((prev) => Array.from(new Set([...prev, folderId])));
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

  const FolderBreadcrumbs = ({ compact = false }: { compact?: boolean }) => {
    const visiblePath = currentFolderPath.filter((folder) => folder.id !== "root");

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
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    selectedFolderId: folder.id,
                    selectedRangeId: null,
                  }))
                }
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

  const FolderNode = ({ folder, depth }: { folder: Folder; depth: number }) => {
    const active = folder.id === state.selectedFolderId;
    const hasChildren = folder.folders.length > 0;
    const isExpanded = expandedFolderIds.includes(folder.id);
    const totalItems = countAllItems(folder);
    const ownItems = folder.items.length;

    return (
      <div style={{ position: "relative" }}>
        <div
          style={{
            marginLeft: depth * 14,
            position: "relative",
          }}
        >
          {depth > 0 && (
            <div
              style={{
                position: "absolute",
                left: -8,
                top: 0,
                bottom: -8,
                width: 1,
                background: "#e3e8ee",
              }}
            />
          )}

          <div
            onDragOver={allowDrop}
            onDrop={(e) => onDropOnFolder(e, folder.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 12,
              padding: "8px 10px",
              background: active ? "#eaf4ff" : "white",
              border: active ? "1px solid #8ecae6" : "1px solid #e9edf2",
              boxShadow: active ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
              cursor: "pointer",
              minHeight: 42,
            }}
            title="Можно перетаскивать спектры на папку"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleFolderExpanded(folder.id);
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                border: "1px solid #dde3ea",
                background: hasChildren ? "#f8fafc" : "transparent",
                cursor: hasChildren ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5c6770",
                flex: "0 0 auto",
                opacity: hasChildren ? 1 : 0.35,
              }}
              title={hasChildren ? (isExpanded ? "Свернуть" : "Развернуть") : "Нет вложенных папок"}
            >
              {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
            </button>

            <div
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  selectedFolderId: folder.id,
                  selectedRangeId: null,
                }))
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                flex: 1,
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 14,
                  borderRadius: 4,
                  background: folder.color,
                  border: "1px solid rgba(0,0,0,0.12)",
                  flex: "0 0 auto",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
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
                <div
                  style={{
                    fontSize: 11,
                    color: "#7b8794",
                    display: "flex",
                    gap: 8,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <span>в папке: {ownItems}</span>
                  <span>всего: {totalItems}</span>
                  {folder.folders.length > 0 && <span>подпапок: {folder.folders.length}</span>}
                </div>
              </div>
            </div>
          </div>

          {hasChildren && isExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {folder.folders.map((child) => (
                <FolderNode key={child.id} folder={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{ fontFamily: "system-ui", height: "100vh", display: "flex", background: "#fff" }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        style={{
          width: 400,
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
            Дерево папок, вложенность и быстрый доступ к спектрам
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={openCreateFolderModal}
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
            onClick={renameFolder}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d8e1ea",
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
              borderRadius: 10,
              border: "1px solid #d8e1ea",
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
              borderRadius: 10,
              border: "1px solid #d8e1ea",
              background: "white",
              cursor: "pointer",
            }}
            title="Удалить папку"
          >
            🗑
          </button>
        </div>

        <div
          style={{
            border: "1px solid #e9edf2",
            borderRadius: 14,
            padding: 12,
            background: "white",
          }}
        >
          <div style={{ fontSize: 12, color: "#667085", marginBottom: 8, fontWeight: 700 }}>
            Текущий путь
          </div>
          <FolderBreadcrumbs compact />
        </div>

        <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>Папки</div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            overflow: "auto",
            paddingRight: 6,
            border: "1px solid #e9edf2",
            borderRadius: 14,
            padding: 10,
            background: "white",
            minHeight: 220,
          }}
        >
          {state.root.folders.map((f) => (
            <FolderNode key={f.id} folder={f} depth={0} />
          ))}
        </div>

        <div
          style={{
            marginTop: 2,
            border: "1px solid #e9edf2",
            borderRadius: 14,
            padding: 12,
            background: "white",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>
            Спектры в “{currentFolder?.name ?? "?"}”
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию…"
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 10,
              border: "1px solid #d8e1ea",
              outline: "none",
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            border: "1px solid #e9edf2",
            borderRadius: 14,
            background: "white",
            padding: 10,
          }}
        >
          {!sortedFilteredItems.length ? (
            <div style={{ color: "#777", fontSize: 13, lineHeight: 1.4 }}>
              {search.trim()
                ? "Ничего не найдено по поиску."
                : "Тут пока пусто. Собери спектр справа и нажми “Сохранить”."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedFilteredItems.map((it) => {
                const active = it.id === state.selectedRangeId;
                return (
                  <div
                    key={it.id}
                    draggable
                    onDragStart={(e) => onDragStartRange(e, it.id)}
                    onClick={() => loadRange(it.id)}
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
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1f2933" }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: "#667085", marginTop: 4 }}>
                      рук: {Object.keys(it.hands).length}
                    </div>
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
              borderRadius: 10,
              border: "1px solid #d8e1ea",
              background: "white",
              cursor: "pointer",
              flex: 1,
              fontWeight: 600,
            }}
          >
            Новый
          </button>
          <button
            onClick={renameRange}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d8e1ea",
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
              borderRadius: 10,
              border: "1px solid #d8e1ea",
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
        <FolderBreadcrumbs />

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
          <button
            onClick={() => setPaintTool("brush")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: paintTool === "brush" ? "1px solid #2d8fd5" : "1px solid #ddd",
              background: paintTool === "brush" ? "#eaf4ff" : "white",
              cursor: "pointer",
            }}
          >
            Кисть
          </button>
          <button
            onClick={() => setPaintTool("rectangle")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: paintTool === "rectangle" ? "1px solid #2d8fd5" : "1px solid #ddd",
              background: paintTool === "rectangle" ? "#eaf4ff" : "white",
              cursor: "pointer",
            }}
          >
            Прямоугольник
          </button>
          <button
            onClick={() => fillByKind("pairs")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Все пары
          </button>
          <button
            onClick={() => fillByKind("suited")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Все одномастные
          </button>
          <button
            onClick={() => fillByKind("offsuit")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Все разномастные
          </button>
          <button
            onClick={() => fillByKind("all")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Весь диапазон
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
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Редактор покерных спектров</h1>
              <div style={{ color: "#666" }}>{currentRange ? `— ${currentRange.name}` : "— новый спектр"}</div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#667085" }}>
              Кисть — тянет текущим действием. Прямоугольник — закрашивает область. Alt + протягивание — стирает.
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
                  const baseColor = row === col ? "#ffd166" : row < col ? "#8ecae6" : "#8ecae6";

                  return (
                    <div
                      key={`${row}-${col}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        isDraggingRef.current = true;
                        visitedRef.current = new Set();
                        dragModeRef.current = e.altKey ? "remove" : "add";

                        if (paintTool === "rectangle") {
                          dragStartCellRef.current = { row, col };
                          setRectanglePreview([label]);
                        } else {
                          apply(label);
                        }
                      }}
                      onMouseEnter={() => {
                        setHoveredCell(label);
                        if (!isDraggingRef.current) return;

                        if (paintTool === "rectangle") {
                          const start = dragStartCellRef.current;
                          if (!start) return;
                          setRectanglePreview(getLabelsInRectangle(start.row, start.col, row, col));
                          return;
                        }

                        apply(label);
                      }}
                      onMouseLeave={() => {
                        setHoveredCell((prev) => (prev === label ? null : prev));
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
                        cursor: paintTool === "rectangle" ? "crosshair" : "pointer",
                        userSelect: "none",
                        borderRadius: 2,
                        outline: rectanglePreview.includes(label) ? "2px solid #1f2933" : hoveredCell === label ? "2px solid rgba(31,41,51,0.55)" : "none",
                        outlineOffset: -2,
                        transform: hoveredCell === label ? "scale(1.04)" : "scale(1)",
                        transition: "transform 0.08s ease, outline 0.08s ease",
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

            <div style={{ marginTop: 14, borderTop: "1px solid #eef2f6", paddingTop: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Процент по действиям</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {actionStats.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "16px 1fr auto",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 4,
                        background: item.color,
                        border: "1px solid rgba(0,0,0,0.12)",
                        display: "inline-block",
                      }}
                    />
                    <span style={{ color: "#334155" }}>
                      {item.label}: {item.combos} комбо / {item.hands} рук
                    </span>
                    <strong style={{ color: "#0f172a" }}>{item.percent.toFixed(2)}%</strong>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
              Выбери действие и закрашивай руки на таблице.
            </div>
          </div>

          <div
            style={{
              width: 360,
              flex: "0 0 360px",
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 14,
              height: "fit-content",
              background: "white",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Покерный калькулятор</div>

            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Две руки, до пяти общих карт и автоматический расчёт эквити.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={calcSectionStyle}>
                <div style={calcSectionTitleStyle}>Общие карты</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {calcBoard.map((card, index) => (
                    <CardPicker
                      key={`board-${index}`}
                      label={`Стол ${index + 1}`}
                      value={card}
                      onChange={(next) =>
                        setCalcBoard((prev) => prev.map((item, itemIndex) => (itemIndex === index ? next : item)))
                      }
                    />
                  ))}
                </div>
              </div>

              <div style={calcSectionStyle}>
                <div style={calcPlayerHeaderStyle}>Игрок 1</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 10 }}>
                  {calcPlayer1.map((card, index) => (
                    <CardPicker
                      key={`p1-${index}`}
                      label={`Карта ${index + 1}`}
                      value={card}
                      allowEmpty={false}
                      onChange={(next) =>
                        setCalcPlayer1((prev) => prev.map((item, itemIndex) => (itemIndex === index ? next : item)))
                      }
                    />
                  ))}
                </div>
                <div style={calcStatsGridStyle}>
                  <div><span style={calcMetricLabelStyle}>Победа</span><strong>{calcResult ? `${calcResult.player1.win.toFixed(2)}%` : "—"}</strong></div>
                  <div><span style={calcMetricLabelStyle}>Ничья</span><strong>{calcResult ? `${calcResult.player1.tie.toFixed(2)}%` : "—"}</strong></div>
                  <div><span style={calcMetricLabelStyle}>Эквити</span><strong>{calcResult ? `${calcResult.player1.equity.toFixed(2)}%` : "—"}</strong></div>
                </div>
              </div>

              <div style={calcSectionStyle}>
                <div style={calcPlayerHeaderStyle}>Игрок 2</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 10 }}>
                  {calcPlayer2.map((card, index) => (
                    <CardPicker
                      key={`p2-${index}`}
                      label={`Карта ${index + 1}`}
                      value={card}
                      allowEmpty={false}
                      onChange={(next) =>
                        setCalcPlayer2((prev) => prev.map((item, itemIndex) => (itemIndex === index ? next : item)))
                      }
                    />
                  ))}
                </div>
                <div style={calcStatsGridStyle}>
                  <div><span style={calcMetricLabelStyle}>Победа</span><strong>{calcResult ? `${calcResult.player2.win.toFixed(2)}%` : "—"}</strong></div>
                  <div><span style={calcMetricLabelStyle}>Ничья</span><strong>{calcResult ? `${calcResult.player2.tie.toFixed(2)}%` : "—"}</strong></div>
                  <div><span style={calcMetricLabelStyle}>Эквити</span><strong>{calcResult ? `${calcResult.player2.equity.toFixed(2)}%` : "—"}</strong></div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => {
                  setCalcPlayer1(["As", "Ah"]);
                  setCalcPlayer2(["Js", "Qh"]);
                  setCalcBoard(["", "", "", "", ""]);
                }}
                style={toolbarSmallButtonStyle}
              >
                Сбросить
              </button>
              <div style={{ fontSize: 11, color: calcError ? "#b42318" : "#64748b", textAlign: "right" }}>
                {calcError || (calcResult ? `Симуляций: ${calcResult.simulations}` : "")}
              </div>
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
                  setFolderModal((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))
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