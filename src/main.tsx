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
const FAVORITE_RANGES_KEY = "poker_ranges_favorite_ranges_v1";
const THEME_KEY = "poker_ranges_theme_v1";
const THEME_SATURATION_KEY = "poker_ranges_theme_saturation_v1";
const CALC_PRESETS_KEY = "poker_ranges_calc_presets_v1";
const SPECTRUM_DRAFT_KEY = "poker_ranges_spectrum_draft_v1";
const SPECTRUM_HISTORY_KEY = "poker_ranges_spectrum_history_v1";
const SAVED_PROJECTS_KEY = "poker_ranges_saved_projects_v1";
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
const HAND_SPLIT_SEPARATOR = "||";

type DecodedHandAction = {
  primaryId: string | null;
  secondaryId: string | null;
};

function decodeHandAction(value: unknown): DecodedHandAction {
  if (!value) return { primaryId: null, secondaryId: null };
  const [rawPrimary, rawSecondary] = String(value).split(HAND_SPLIT_SEPARATOR);
  const primaryId = rawPrimary?.trim() || null;
  const secondaryId = rawSecondary?.trim() || null;
  return { primaryId, secondaryId };
}

function encodeHandAction(primaryId: string | null | undefined, secondaryId?: string | null) {
  const primary = primaryId?.trim();
  const secondary = secondaryId?.trim();
  if (!primary) return "";
  if (!secondary || secondary === primary) return primary;
  return `${primary}${HAND_SPLIT_SEPARATOR}${secondary}`;
}

function getHandActionIds(value: unknown) {
  const decoded = decodeHandAction(value);
  return [decoded.primaryId, decoded.secondaryId].filter(Boolean) as string[];
}

function getPrimaryHandActionId(value: unknown) {
  return decodeHandAction(value).primaryId;
}

function getHandActionDisplayLabel(value: unknown, actionsMap: Record<string, ActionItem>) {
  const ids = getHandActionIds(value);
  if (!ids.length) return "Без действия";
  return ids.map((id) => actionsMap[id]?.label ?? "Без действия").join(" / ");
}

function getHandActionBackground(
  value: unknown,
  actionsMap: Record<string, ActionItem>,
  fallbackColor: string
) {
  const decoded = decodeHandAction(value);
  const primaryColor = decoded.primaryId ? actionsMap[decoded.primaryId]?.color ?? fallbackColor : fallbackColor;
  const secondaryColor = decoded.secondaryId ? actionsMap[decoded.secondaryId]?.color ?? primaryColor : null;
  if (!decoded.primaryId) return fallbackColor;
  if (!secondaryColor) return primaryColor;
  return `linear-gradient(135deg, ${primaryColor} 0 49.5%, ${secondaryColor} 50.5% 100%)`;
}

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


type PaintTool = "brush" | "rectangle";
type CardModalState =
  | { open: false }
  | {
      open: true;
      kind: "board" | "player" | "dead";
      cardIndex: number;
      playerId?: string;
    };


const CALC_SUITS = [
  { id: "s", label: "♠" },
  { id: "h", label: "♥" },
  { id: "d", label: "♦" },
  { id: "c", label: "♣" },
] as const;

type CalcMode = "holdem" | "omaha";
type OmahaCardsCount = 4 | 5 | 6 | 7;

type CalcStats = {
  win: number;
  tie: number;
  equity: number;
};

type CalcPlayer = {
  id: string;
  name: string;
  cards: string[];
  sourceType?: "hand" | "range";
  rangeId?: string;
};

type CalcResult = {
  players: CalcStats[];
  board: string[];
  simulations: number;
};

type ThemeMode = "light" | "dark";
type ThemeSaturation = "soft" | "normal" | "rich";
type UIMode = "spectrum" | "calculator";

type CalcPreset = {
  id: string;
  name: string;
  mode: CalcMode;
  players: CalcPlayer[];
  board: string[];
  deadCards: string[];
};

type SpectrumDraft = {
  hands: HandActionMap;
  selectedFolderId: string;
  selectedRangeId: string | null;
  rangeName: string;
  updatedAt: number;
};

type SpectrumHistoryEntry = {
  id: string;
  label: string;
  timestamp: number;
  hands: HandActionMap;
  handCount: number;
  combos: number;
};

type SavedProjectSnapshot = {
  state: AppState;
  actions: ActionItem[];
  currentActionId: string;
  selectedActionIds: string[];
  selected: HandActionMap;
  expandedFolderIds: string[];
  favoriteFolderIds: string[];
  favoriteRangeIds: string[];
  recentRangeIds: string[];
  themeMode: ThemeMode;
  themeSaturation: ThemeSaturation;
  calcMode: CalcMode;
  calcPlayers: CalcPlayer[];
  calcBoard: string[];
  calcDeadCards: string[];
  calcPresets: CalcPreset[];
  spectrumHistory: SpectrumHistoryEntry[];
  draftInfo: SpectrumDraft | null;
  selectedCalcPresetId: string;
};

type SavedProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: SavedProjectSnapshot;
};

type RangeCompareSummary = {
  leftHands: number;
  rightHands: number;
  leftCombos: number;
  rightCombos: number;
  sharedHands: number;
  sharedCombos: number;
  leftOnlyHands: number;
  leftOnlyCombos: number;
  rightOnlyHands: number;
  rightOnlyCombos: number;
  sameActionHands: number;
  similarityPercent: number;
  sharedLabels: string[];
  leftOnlyLabels: string[];
  rightOnlyLabels: string[];
};


type TrainingQuestion = {
  hand: string;
  correctActionId: string | null;
  answeredActionId: string | null;
  isCorrect: boolean | null;
  sourceLabel: string;
};

type TrainingHistoryEntry = {
  id: string;
  hand: string;
  expectedLabel: string;
  actualLabel: string;
  isCorrect: boolean;
  sourceLabel: string;
  timestamp: number;
};

type BreakdownRow = {
  label: string;
  hands: number;
  combos: number;
  percent: number;
};

type RangeBreakdown = {
  totalHands: number;
  totalCombos: number;
  base: BreakdownRow[];
  traits: BreakdownRow[];
};

type StreetAnalysisBucket = {
  key: string;
  label: string;
  combos: number;
  percent: number;
};

type StreetAnalysis = {
  street: string;
  board: string[];
  totalCombos: number;
  buckets: StreetAnalysisBucket[];
};

type RangeBoardAnalytics = {
  availableCombos: number;
  blockedCombos: number;
  currentStreet: StreetAnalysis;
  streets: StreetAnalysis[];
};

type RangeStructureRow = {
  key: string;
  label: string;
  hands: number;
  combos: number;
  percentOfRange: number;
  percentOfAll: number;
};

type RangeStructureSummary = {
  totalHands: number;
  totalCombos: number;
  percentOfAll: number;
  rows: RangeStructureRow[];
  actionRows: RangeStructureRow[];
  availableOnBoard?: {
    availableCombos: number;
    blockedCombos: number;
    availablePercentOfRange: number;
  };
};

type BoardAnalyzerSummary = {
  street: string;
  board: string[];
  highCard: string;
  pairedness: string;
  suitTexture: string;
  connectivity: string;
  broadwayCount: number;
  wheelPotential: boolean;
  straightPressure: string;
  flushPressure: string;
  rankSpan: number;
  notes: string[];
};

type ThemePalette = {
  appBg: string;
  sidebarBg: string;
  sidebarBorder: string;
  mainBg: string;
  panelBg: string;
  panelBorder: string;
  textPrimary: string;
  textSecondary: string;
  buttonBg: string;
  buttonBorder: string;
  buttonText: string;
  buttonHoverBg: string;
  buttonActiveBg: string;
  buttonActiveBorder: string;
  buttonDisabledBg: string;
  buttonDisabledBorder: string;
  buttonDisabledText: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  calcBg: string;
  calcBorder: string;
  calcCardBg: string;
  calcSoftBg: string;
  calcInputBg: string;
  calcButtonBg: string;
  calcButtonBorder: string;
  calcButtonText: string;
  calcActiveButtonBg: string;
  calcActiveButtonBorder: string;
  calcText: string;
  calcMuted: string;
  calcCardFaceBg: string;
  calcCardFaceBorder: string;
  calcCardShadow: string;
};


function getLabel(row: number, col: number) {
  if (row === col) return ranks[row] + ranks[col];
  if (row < col) return ranks[row] + ranks[col] + "s";
  return ranks[col] + ranks[row] + "o";
};

function getAllHandLabels() {
  const labels: string[] = [];
  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      labels.push(getLabel(row, col));
    }
  }
  return labels;
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


function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== "undefined";
}

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
            if (!best || compareScore(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best ?? [0];
}

function evaluateOmaha(handCards: string[], boardCards: string[]) {
  let best: number[] | null = null;
  for (let a = 0; a < handCards.length - 1; a += 1) {
    for (let b = a + 1; b < handCards.length; b += 1) {
      for (let c = 0; c < boardCards.length - 2; c += 1) {
        for (let d = c + 1; d < boardCards.length - 1; d += 1) {
          for (let e = d + 1; e < boardCards.length; e += 1) {
            const score = evaluateFive([handCards[a], handCards[b], boardCards[c], boardCards[d], boardCards[e]]);
            if (!best || compareScore(score, best) > 0) best = score;
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

function clampOmahaCardsCount(value: number): OmahaCardsCount {
  if (value >= 7) return 7;
  if (value >= 6) return 6;
  if (value >= 5) return 5;
  return 4;
}

function inferOmahaCardsPerPlayer(players: CalcPlayer[]): OmahaCardsCount {
  const maxCards = players.reduce((maxValue, player) => {
    const length = Array.isArray(player.cards) ? player.cards.length : 0;
    return Math.max(maxValue, length);
  }, 4);
  return clampOmahaCardsCount(maxCards);
}

function getCardsPerPlayer(mode: CalcMode, omahaCardsPerPlayer: number = 4) {
  return mode === "holdem" ? 2 : clampOmahaCardsCount(omahaCardsPerPlayer);
}

function createDefaultCalcPlayers(mode: CalcMode, omahaCardsPerPlayer: OmahaCardsCount = 4): CalcPlayer[] {
  if (mode === "holdem") {
    return [
      createCalcPlayer(0, "holdem", ["As", "Ah"]),
      createCalcPlayer(1, "holdem", ["Js", "Qh"]),
    ];
  }

  const playerOneCards = ["As", "Ah", "Kd", "Qc", "Jc", "Td", "9h"].slice(0, omahaCardsPerPlayer);
  const playerTwoCards = ["Ks", "Kh", "Qd", "Jd", "Tc", "8s", "7h"].slice(0, omahaCardsPerPlayer);

  return [
    createCalcPlayer(0, "omaha", playerOneCards, omahaCardsPerPlayer),
    createCalcPlayer(1, "omaha", playerTwoCards, omahaCardsPerPlayer),
  ];
}

function getHoldemPresetCombos(preset: string): string[][] {
  const upper = preset.trim().toUpperCase();
  if (!upper) return [];

  if (upper.length === 2) {
    const rank = upper[0];
    const combos: string[][] = [];
    for (let a = 0; a < CALC_SUITS.length - 1; a += 1) {
      for (let b = a + 1; b < CALC_SUITS.length; b += 1) {
        combos.push([`${rank}${CALC_SUITS[a].id}`, `${rank}${CALC_SUITS[b].id}`]);
      }
    }
    return combos;
  }

  if (upper.length === 3) {
    const r1 = upper[0];
    const r2 = upper[1];
    const kind = upper[2];
    const combos: string[][] = [];
    if (kind === "S") {
      for (const suit of CALC_SUITS) combos.push([`${r1}${suit.id}`, `${r2}${suit.id}`]);
      return combos;
    }
    if (kind === "O") {
      for (const s1 of CALC_SUITS) {
        for (const s2 of CALC_SUITS) {
          if (s1.id === s2.id) continue;
          combos.push([`${r1}${s1.id}`, `${r2}${s2.id}`]);
        }
      }
      return combos;
    }
  }

  return [];
}




function flattenCalcRanges(folder: Folder): Array<{ id: string; name: string; hands: HandActionMap }> {
  const ranges = folder.items.map((item) => ({ id: item.id, name: item.name, hands: item.hands }));
  for (const child of folder.folders) {
    ranges.push(...flattenCalcRanges(child));
  }
  return ranges;
}

function buildConcreteCombosFromHandLabel(label: string) {
  const combos: string[][] = [];
  const r1 = label[0];
  const r2 = label[1];

  if (label.length === 2) {
    for (let a = 0; a < CALC_SUITS.length - 1; a += 1) {
      for (let b = a + 1; b < CALC_SUITS.length; b += 1) {
        combos.push([`${r1}${CALC_SUITS[a].id}`, `${r2}${CALC_SUITS[b].id}`]);
      }
    }
    return combos;
  }

  if (label.endsWith("s")) {
    for (const suit of CALC_SUITS) {
      combos.push([`${r1}${suit.id}`, `${r2}${suit.id}`]);
    }
    return combos;
  }

  for (const s1 of CALC_SUITS) {
    for (const s2 of CALC_SUITS) {
      if (s1.id === s2.id) continue;
      combos.push([`${r1}${s1.id}`, `${r2}${s2.id}`]);
    }
  }
  return combos;
}

function buildRangeCombos(rangeHands: HandActionMap) {
  const combos: string[][] = [];
  for (const label of Object.keys(rangeHands)) {
    combos.push(...buildConcreteCombosFromHandLabel(label));
  }
  return combos;
}



function isBroadwayRank(rank: string) {
  return ["A", "K", "Q", "J", "T"].includes(rank);
}

function getRankGap(label: string) {
  if (label.length < 2) return 0;
  const first = ranks.indexOf(label[0]);
  const second = ranks.indexOf(label[1]);
  if (first < 0 || second < 0) return 99;
  return Math.abs(first - second);
}

function sumCombosForHands(hands: string[]) {
  return hands.reduce((sum, hand) => sum + getCombosForHand(hand), 0);
}

function createBreakdownRow(label: string, hands: string[], totalCombos: number): BreakdownRow {
  const combos = sumCombosForHands(hands);
  return {
    label,
    hands: hands.length,
    combos,
    percent: totalCombos ? (combos / totalCombos) * 100 : 0,
  };
}

function getRangeBreakdown(rangeHands: HandActionMap): RangeBreakdown {
  const hands = Object.keys(rangeHands);
  const totalCombos = sumCombosForHands(hands);

  return {
    totalHands: hands.length,
    totalCombos,
    base: [
      createBreakdownRow("Пары", hands.filter((hand) => hand.length === 2), totalCombos),
      createBreakdownRow("Suited", hands.filter((hand) => hand.endsWith("s")), totalCombos),
      createBreakdownRow("Offsuit", hands.filter((hand) => hand.endsWith("o")), totalCombos),
    ],
    traits: [
      createBreakdownRow(
        "Broadways",
        hands.filter((hand) => isBroadwayRank(hand[0]) && isBroadwayRank(hand[1])),
        totalCombos
      ),
      createBreakdownRow(
        "Axs",
        hands.filter((hand) => hand.endsWith("s") && hand[0] === "A"),
        totalCombos
      ),
      createBreakdownRow(
        "Suited connectors",
        hands.filter((hand) => hand.endsWith("s") && getRankGap(hand) === 1),
        totalCombos
      ),
      createBreakdownRow(
        "Suited one-gappers",
        hands.filter((hand) => hand.endsWith("s") && getRankGap(hand) === 2),
        totalCombos
      ),
      createBreakdownRow(
        "Pocket TT+",
        hands.filter((hand) => hand.length === 2 && "AKQJT".includes(hand[0])),
        totalCombos
      ),
      createBreakdownRow(
        "Wheel aces",
        hands.filter((hand) => hand[0] === "A" && ["2", "3", "4", "5"].includes(hand[1])),
        totalCombos
      ),
    ],
  };
}

function buildAvailableRangeComboEntries(rangeHands: HandActionMap, boardCards: string[]) {
  const board = boardCards.filter(Boolean);
  const blocked = new Set(board);
  const entries: Array<{ label: string; actionId: string; cards: string[] }> = [];

  for (const [label, actionValue] of Object.entries(rangeHands)) {
    const actionId = getPrimaryHandActionId(actionValue) ?? "";
    const combos = buildConcreteCombosFromHandLabel(label);
    for (const combo of combos) {
      if (new Set(combo).size !== combo.length) continue;
      if (combo.some((card) => blocked.has(card))) continue;
      entries.push({ label, actionId, cards: combo });
    }
  }

  return entries;
}

function getStraightDrawType(values: number[]) {
  const unique = Array.from(new Set(values));
  if (unique.includes(14)) unique.push(1);
  const uniqueSet = new Set(unique);

  let hasGutshot = false;

  for (let start = 1; start <= 10; start += 1) {
    const sequence = [start, start + 1, start + 2, start + 3, start + 4];
    const presentCount = sequence.filter((value) => uniqueSet.has(value)).length;
    if (presentCount !== 4) continue;
    const missing = sequence.find((value) => !uniqueSet.has(value));
    if (missing == null) continue;
    if (missing === sequence[0] || missing === sequence[4]) {
      return "oesd" as const;
    }
    hasGutshot = true;
  }

  return hasGutshot ? ("gutshot" as const) : ("none" as const);
}

function analyzeConcreteComboOnBoard(holeCards: string[], boardCards: string[]) {
  const allCards = [...holeCards, ...boardCards];
  const score = evaluateSeven(allCards);
  const category = score[0] ?? 0;
  const boardValues = boardCards.map((card) => getRankValue(card[0]));
  const holeValues = holeCards.map((card) => getRankValue(card[0]));
  const highestBoardRank = boardValues.length ? Math.max(...boardValues) : 0;

  const boardRankSet = new Set(boardValues);
  const topPairWithHole = holeValues.some((value) => value === highestBoardRank && boardRankSet.has(value));
  const overpair = holeValues.length === 2 && holeValues[0] === holeValues[1] && holeValues[0] > highestBoardRank;

  const suitCounts = new Map<string, number>();
  for (const card of allCards) {
    suitCounts.set(card[1], (suitCounts.get(card[1]) ?? 0) + 1);
  }
  const maxSuitCount = Math.max(...Array.from(suitCounts.values()), 0);

  const straightDraw = boardCards.length < 5 && category < 4
    ? getStraightDrawType(allCards.map((card) => getRankValue(card[0])))
    : "none";

  return {
    pairPlus: category >= 1,
    topPairPlus: category >= 2 || overpair || topPairWithHole,
    twoPairPlus: category >= 2,
    tripsPlus: category >= 3,
    straightPlus: category >= 4,
    flushPlus: category >= 5,
    fullHousePlus: category >= 6,
    flushDraw: boardCards.length < 5 && category < 5 && maxSuitCount >= 4,
    oesd: straightDraw === "oesd",
    gutshot: straightDraw === "gutshot",
    overcards:
      boardCards.length < 5 &&
      category === 0 &&
      holeValues.length === 2 &&
      holeValues.every((value) => value > highestBoardRank),
  };
}

function getStreetLabel(boardLength: number) {
  if (boardLength === 3) return "Флоп";
  if (boardLength === 4) return "Тёрн";
  return "Ривер";
}

function formatBoardCardsInline(cards: string[]) {
  return cards.length ? cards.map((card) => formatCardLabel(card)).join(" ") : "—";
}

function analyzeRangeBoard(rangeHands: HandActionMap, boardCards: string[]): RangeBoardAnalytics | null {
  const board = boardCards.filter(Boolean);
  if (board.length < 3) return null;

  const streetBoards = [
    board.slice(0, 3),
    board.length >= 4 ? board.slice(0, 4) : null,
    board.length >= 5 ? board.slice(0, 5) : null,
  ].filter(Boolean) as string[][];

  const allConcreteCombos = buildAvailableRangeComboEntries(rangeHands, []);
  const bucketDefs = [
    { key: "pairPlus", label: "Пара+" },
    { key: "topPairPlus", label: "Топ-пара+" },
    { key: "twoPairPlus", label: "Две пары+" },
    { key: "tripsPlus", label: "Сет / трипс+" },
    { key: "straightPlus", label: "Стрит+" },
    { key: "flushPlus", label: "Флеш+" },
    { key: "flushDraw", label: "Флеш-дро" },
    { key: "oesd", label: "OESD" },
    { key: "gutshot", label: "Гатшот" },
    { key: "overcards", label: "2 оверкарты" },
  ] as const;

  const streets = streetBoards.map((streetBoard) => {
    const entries = buildAvailableRangeComboEntries(rangeHands, streetBoard);
    const counts = Object.fromEntries(bucketDefs.map((bucket) => [bucket.key, 0])) as Record<
      (typeof bucketDefs)[number]["key"],
      number
    >;

    for (const entry of entries) {
      const flags = analyzeConcreteComboOnBoard(entry.cards, streetBoard);
      for (const bucket of bucketDefs) {
        if (flags[bucket.key]) counts[bucket.key] += 1;
      }
    }

    const totalCombos = entries.length;

    return {
      street: getStreetLabel(streetBoard.length),
      board: streetBoard,
      totalCombos,
      buckets: bucketDefs.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        combos: counts[bucket.key],
        percent: totalCombos ? (counts[bucket.key] / totalCombos) * 100 : 0,
      })),
    } satisfies StreetAnalysis;
  });

  const currentStreet = streets[streets.length - 1];
  const blockedCombos = Math.max(allConcreteCombos.length - currentStreet.totalCombos, 0);

  return {
    availableCombos: currentStreet.totalCombos,
    blockedCombos,
    currentStreet,
    streets,
  };
}


function createRangeStructureRow(
  key: string,
  label: string,
  hands: string[],
  totalCombos: number
): RangeStructureRow {
  const combos = sumCombosForHands(hands);
  return {
    key,
    label,
    hands: hands.length,
    combos,
    percentOfRange: totalCombos ? (combos / totalCombos) * 100 : 0,
    percentOfAll: (combos / 1326) * 100,
  };
}

function getRangeStructureSummary(
  rangeHands: HandActionMap,
  actionsMap: Record<string, ActionItem>,
  boardCards: string[]
): RangeStructureSummary {
  const hands = Object.keys(rangeHands);
  const totalCombos = sumCombosForHands(hands);

  const rows: RangeStructureRow[] = [
    createRangeStructureRow("pairs", "Пары", hands.filter((hand) => hand.length === 2), totalCombos),
    createRangeStructureRow("suited", "Suited", hands.filter((hand) => hand.endsWith("s")), totalCombos),
    createRangeStructureRow("offsuit", "Offsuit", hands.filter((hand) => hand.endsWith("o")), totalCombos),
    createRangeStructureRow(
      "broadways",
      "Broadways",
      hands.filter((hand) => isBroadwayRank(hand[0]) && isBroadwayRank(hand[1])),
      totalCombos
    ),
    createRangeStructureRow(
      "axs",
      "Axs",
      hands.filter((hand) => hand.endsWith("s") && hand[0] === "A"),
      totalCombos
    ),
    createRangeStructureRow(
      "suited_connectors",
      "Suited connectors",
      hands.filter((hand) => hand.endsWith("s") && getRankGap(hand) === 1),
      totalCombos
    ),
    createRangeStructureRow(
      "suited_one_gappers",
      "Suited one-gappers",
      hands.filter((hand) => hand.endsWith("s") && getRankGap(hand) === 2),
      totalCombos
    ),
  ].filter((row) => row.hands > 0);

  const groupedHands = new Map<string, string[]>();
  for (const [hand, actionValue] of Object.entries(rangeHands)) {
    const label = getHandActionDisplayLabel(actionValue, actionsMap);
    const list = groupedHands.get(label) ?? [];
    list.push(hand);
    groupedHands.set(label, list);
  }

  const actionRows = Array.from(groupedHands.entries())
    .map(([label, actionHands]) => createRangeStructureRow(`action_${label}`, label, actionHands, totalCombos))
    .sort((a, b) => b.combos - a.combos);

  const board = boardCards.filter(Boolean);
  const availableOnBoard =
    board.length >= 3
      ? (() => {
          const allCombos = buildAvailableRangeComboEntries(rangeHands, []);
          const availableCombos = buildAvailableRangeComboEntries(rangeHands, board).length;
          const blockedCombos = Math.max(allCombos.length - availableCombos, 0);
          return {
            availableCombos,
            blockedCombos,
            availablePercentOfRange: totalCombos ? (availableCombos / totalCombos) * 100 : 0,
          };
        })()
      : undefined;

  return {
    totalHands: hands.length,
    totalCombos,
    percentOfAll: (totalCombos / 1326) * 100,
    rows,
    actionRows,
    availableOnBoard,
  };
}

function getBoardConnectivity(values: number[]) {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  if (unique.length <= 1) return { label: "Несвязанный", span: 0 };
  const span = unique[unique.length - 1] - unique[0];
  const gaps = unique.slice(1).map((value, index) => value - unique[index]);
  const maxGap = Math.max(...gaps, 0);

  if (getStraightHigh(values) > 0) return { label: "Стрит уже на доске", span };
  if (span <= 4 && maxGap <= 2) return { label: "Очень связный", span };
  if (span <= 5 && maxGap <= 3) return { label: "Связный", span };
  if (span <= 7) return { label: "Средняя связность", span };
  return { label: "Несвязный", span };
}

function getBoardSuitTexture(boardCards: string[]) {
  const suitCounts = new Map<string, number>();
  for (const card of boardCards) {
    suitCounts.set(card[1], (suitCounts.get(card[1]) ?? 0) + 1);
  }

  const maxSuitCount = Math.max(...Array.from(suitCounts.values()), 0);
  const uniqueSuits = suitCounts.size;

  if (boardCards.length === 3) {
    if (maxSuitCount === 3) return { texture: "Монотонный флоп", pressure: "Флеш уже возможен" };
    if (maxSuitCount === 2) return { texture: "Двухмастный флоп", pressure: "Есть флеш-дро" };
    return { texture: "Радужный флоп", pressure: "Флеш-дро нет" };
  }

  if (maxSuitCount >= 5) return { texture: "Пятикарточный флеш", pressure: "Флеш на доске" };
  if (maxSuitCount === 4) return { texture: "4 к флешу", pressure: "Очень сильное флеш-давление" };
  if (maxSuitCount === 3) return { texture: uniqueSuits === 3 ? "Радужный runout" : "3 к флешу", pressure: "Умеренное флеш-давление" };
  if (maxSuitCount === 2) return { texture: "Двухмастный runout", pressure: "Слабое флеш-давление" };
  return { texture: "Радужный runout", pressure: "Флеш-давления нет" };
}

function getBoardPairedness(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = Array.from(counts.values()).sort((a, b) => b - a);

  if (groups[0] >= 3) return "Трипс на доске";
  const pairCount = groups.filter((count) => count === 2).length;
  if (pairCount >= 2) return "Две пары на доске";
  if (pairCount === 1) return "Спаренная доска";
  return "Неспаренная доска";
}

function getBoardStraightPressure(values: number[]) {
  const unique = Array.from(new Set(values));
  if (unique.includes(14)) unique.push(1);
  const uniqueSet = new Set(unique);

  if (getStraightHigh(values) > 0) return "Стрит уже собран на доске";

  let fourToStraight = false;
  let threeConnected = false;

  for (let start = 1; start <= 10; start += 1) {
    const sequence = [start, start + 1, start + 2, start + 3, start + 4];
    const present = sequence.filter((value) => uniqueSet.has(value)).length;
    if (present >= 4) fourToStraight = true;
    if (present >= 3) threeConnected = true;
  }

  if (fourToStraight) return "4 к стриту";
  if (threeConnected) return "Есть сильная стрит-связность";
  return "Стрит-давление низкое";
}

function analyzeBoardTexture(boardCards: string[]): BoardAnalyzerSummary | null {
  const board = boardCards.filter(Boolean);
  if (board.length < 3) return null;

  const values = board.map((card) => getRankValue(card[0]));
  const connectivity = getBoardConnectivity(values);
  const suitTexture = getBoardSuitTexture(board);
  const broadwayCount = board.filter((card) => isBroadwayRank(card[0])).length;
  const wheelPotential = board.some((card) => card[0] === "A") || board.some((card) => ["2", "3", "4", "5"].includes(card[0]));
  const pairedness = getBoardPairedness(values);
  const straightPressure = getBoardStraightPressure(values);
  const highCard = board.reduce((best, card) => (getRankValue(card[0]) > getRankValue(best[0]) ? card : best), board[0]);

  const notes: string[] = [];
  if (pairedness !== "Неспаренная доска") notes.push(pairedness);
  if (suitTexture.texture !== "Радужный флоп" && suitTexture.texture !== "Радужный runout") notes.push(suitTexture.texture);
  if (connectivity.label !== "Несвязанный") notes.push(connectivity.label);
  if (broadwayCount >= 2) notes.push(`Бродвей-карт: ${broadwayCount}`);
  if (wheelPotential) notes.push("Есть wheel-потенциал");

  return {
    street: getStreetLabel(board.length),
    board,
    highCard: formatCardLabel(highCard),
    pairedness,
    suitTexture: suitTexture.texture,
    connectivity: connectivity.label,
    broadwayCount,
    wheelPotential,
    straightPressure,
    flushPressure: suitTexture.pressure,
    rankSpan: connectivity.span,
    notes,
  };
}




function isPairHandLabel(label: string) {
  return /^[AKQJT98765432]{2}$/.test(label) && label[0] === label[1];
}

function isSuitedOffsuitLabel(label: string) {
  return /^[AKQJT98765432]{2}[so]$/.test(label) && label[0] !== label[1];
}

function isSupportedHandLabel(label: string) {
  return isPairHandLabel(label) || isSuitedOffsuitLabel(label);
}

function buildPairRangeFromPlus(token: string) {
  const rankIndex = ranks.indexOf(token[0]);
  if (rankIndex < 0) return [];
  const result: string[] = [];
  for (let index = rankIndex; index >= 0; index -= 1) {
    result.push(`${ranks[index]}${ranks[index]}`);
  }
  return result;
}

function buildNonPairRangeFromPlus(token: string) {
  const firstRank = token[0];
  const secondRank = token[1];
  const suffix = token[2];
  const firstIndex = ranks.indexOf(firstRank);
  const secondIndex = ranks.indexOf(secondRank);
  if (firstIndex < 0 || secondIndex < 0 || secondIndex <= firstIndex) return [];
  const result: string[] = [];
  for (let index = secondIndex; index > firstIndex; index -= 1) {
    result.push(`${firstRank}${ranks[index]}${suffix}`);
  }
  return result;
}

function expandPlusToken(token: string) {
  if (/^[AKQJT98765432]{2}\+$/.test(token) && token[0] === token[1]) {
    return buildPairRangeFromPlus(token.slice(0, 2));
  }
  if (/^[AKQJT98765432]{2}[so]\+$/.test(token) && token[0] !== token[1]) {
    return buildNonPairRangeFromPlus(token.slice(0, 3));
  }
  return [];
}

function expandDashToken(token: string) {
  const parts = token.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return [];
  const [start, end] = parts;
  if (!isSupportedHandLabel(start) || !isSupportedHandLabel(end)) return [];

  if (isPairHandLabel(start) && isPairHandLabel(end)) {
    const startIndex = ranks.indexOf(start[0]);
    const endIndex = ranks.indexOf(end[0]);
    if (startIndex < 0 || endIndex < 0) return [];
    const step = startIndex <= endIndex ? 1 : -1;
    const result: string[] = [];
    for (let index = startIndex; ; index += step) {
      result.push(`${ranks[index]}${ranks[index]}`);
      if (index === endIndex) break;
    }
    return result;
  }

  if (isSuitedOffsuitLabel(start) && isSuitedOffsuitLabel(end) && start[2] === end[2]) {
    const startFirstIndex = ranks.indexOf(start[0]);
    const startSecondIndex = ranks.indexOf(start[1]);
    const endFirstIndex = ranks.indexOf(end[0]);
    const endSecondIndex = ranks.indexOf(end[1]);
    if ([startFirstIndex, startSecondIndex, endFirstIndex, endSecondIndex].some((index) => index < 0)) return [];

    if (start[0] === end[0]) {
      const step = startSecondIndex <= endSecondIndex ? 1 : -1;
      const result: string[] = [];
      for (let index = startSecondIndex; ; index += step) {
        result.push(`${start[0]}${ranks[index]}${start[2]}`);
        if (index === endSecondIndex) break;
      }
      return result;
    }

    const firstSteps = Math.abs(endFirstIndex - startFirstIndex);
    const secondSteps = Math.abs(endSecondIndex - startSecondIndex);
    if (firstSteps !== secondSteps) return [];

    const firstStep = startFirstIndex <= endFirstIndex ? 1 : -1;
    const secondStep = startSecondIndex <= endSecondIndex ? 1 : -1;
    const result: string[] = [];
    for (let offset = 0; offset <= firstSteps; offset += 1) {
      const firstIndex = startFirstIndex + offset * firstStep;
      const secondIndex = startSecondIndex + offset * secondStep;
      result.push(`${ranks[firstIndex]}${ranks[secondIndex]}${start[2]}`);
    }
    return result;
  }

  return [];
}

function parseEquilabLikeRange(input: string) {
  const tokens = input
    .toUpperCase()
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const hands = new Set<string>();
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    let expanded: string[] = [];

    if (isSupportedHandLabel(token)) {
      expanded = [token];
    } else if (token.includes("+")) {
      expanded = expandPlusToken(token);
    } else if (token.includes("-")) {
      expanded = expandDashToken(token);
    }

    if (!expanded.length) {
      invalidTokens.push(token);
      continue;
    }

    for (const hand of expanded) {
      if (isSupportedHandLabel(hand)) hands.add(hand);
    }
  }

  return {
    hands: Array.from(hands),
    invalidTokens,
  };
}

function groupHandsByActionText(hands: HandActionMap, actionsMap: Record<string, ActionItem>) {
  const groups = new Map<string, string[]>();

  for (const [hand, actionId] of Object.entries(hands)) {
    const label = actionsMap[actionId]?.label ?? "Без действия";
    const next = groups.get(label) ?? [];
    next.push(hand);
    groups.set(label, next);
  }

  return Array.from(groups.entries())
    .map(([label, items]) => `${label}: ${items.sort().join(", ")}`)
    .join("\n");
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function calculatePokerEquityAdvanced(
  mode: CalcMode,
  players: CalcPlayer[],
  board: string[],
  deadCards: string[],
  rangesById: Record<string, HandActionMap>
) {
  if (players.length < 2) return { error: "Нужно минимум два игрока." as const };

  const omahaCardsPerPlayer = inferOmahaCardsPerPlayer(players);
  const cardsPerPlayer = getCardsPerPlayer(mode, omahaCardsPerPlayer);
  const preparedPlayers = normalizePlayersForMode(players, mode, omahaCardsPerPlayer);

  if (mode !== "holdem" && preparedPlayers.some((player) => player.sourceType === "range")) {
    return { error: "Range vs Range пока поддерживается только для Техасского холдема." as const };
  }

  for (const player of preparedPlayers) {
    if (player.sourceType === "range") {
      if (!player.rangeId) return { error: "Выбери спектр для игрока." as const };
      const rangeHands = rangesById[player.rangeId] ?? {};
      if (!Object.keys(rangeHands).length) return { error: "У выбранного спектра нет рук." as const };
      continue;
    }

    const filled = player.cards.filter(Boolean);
    if (filled.length != cardsPerPlayer) {
      return {
        error:
          mode === "holdem"
            ? "Для Техасского холдема каждому игроку нужно выбрать 2 карты."
            : `Для Омахи каждому игроку нужно выбрать ${cardsPerPlayer} карты.`,
      };
    }
  }

  const fixedUsed = [
    ...board.filter(Boolean),
    ...deadCards.filter(Boolean),
    ...preparedPlayers.flatMap((player) => (player.sourceType === "range" ? [] : player.cards.filter(Boolean))),
  ];

  if (new Set(fixedUsed).size !== fixedUsed.length) {
    return { error: "Одна и та же карта выбрана несколько раз." as const };
  }

  const missingBoard = 5 - board.length;
  const baseRuns = missingBoard === 0 ? 1 : Math.max(1400, Math.min(5000, 1800 + preparedPlayers.length * 220));
  const targetRuns = preparedPlayers.some((player) => player.sourceType === "range") ? Math.max(baseRuns, 2200) : baseRuns;

  const rangeCombosById = new Map<string, string[][]>();
  for (const player of preparedPlayers) {
    if (player.sourceType === "range" && player.rangeId) {
      if (!rangeCombosById.has(player.rangeId)) {
        rangeCombosById.set(player.rangeId, buildRangeCombos(rangesById[player.rangeId] ?? {}));
      }
    }
  }

  const stats = preparedPlayers.map(() => ({ win: 0, tie: 0, equity: 0 }));
  let simulations = 0;
  let attempts = 0;
  const maxAttempts = targetRuns * 30;

  while (simulations < targetRuns && attempts < maxAttempts) {
    attempts += 1;
    const used = new Set<string>([...board.filter(Boolean), ...deadCards.filter(Boolean)]);
    const concreteHands: string[][] = [];
    let invalid = false;

    for (const player of preparedPlayers) {
      if (player.sourceType === "range") {
        const pool = player.rangeId ? rangeCombosById.get(player.rangeId) ?? [] : [];
        const validCombos = pool.filter((combo) => combo.every((card) => !used.has(card)));
        if (!validCombos.length) {
          invalid = true;
          break;
        }
        const picked = validCombos[Math.floor(Math.random() * validCombos.length)];
        picked.forEach((card) => used.add(card));
        concreteHands.push(picked);
      } else {
        const cards = player.cards.filter(Boolean);
        if (cards.some((card) => used.has(card))) {
          invalid = true;
          break;
        }
        cards.forEach((card) => used.add(card));
        concreteHands.push(cards);
      }
    }

    if (invalid) continue;

    const deck = buildDeck().filter((card) => !used.has(card));
    const drawn = missingBoard === 0 ? [] : sampleCards(deck, missingBoard);
    const fullBoard = [...board, ...drawn];

    const scores = concreteHands.map((cards) =>
      mode === "holdem" ? evaluateSeven([...cards, ...fullBoard]) : evaluateOmaha(cards, fullBoard)
    );

    let bestScore = scores[0];
    for (let scoreIndex = 1; scoreIndex < scores.length; scoreIndex += 1) {
      if (compareScore(scores[scoreIndex], bestScore) > 0) bestScore = scores[scoreIndex];
    }

    const winners: number[] = [];
    scores.forEach((score, index) => {
      if (compareScore(score, bestScore) === 0) winners.push(index);
    });

    if (winners.length === 1) {
      stats[winners[0]].win += 1;
      stats[winners[0]].equity += 1;
    } else {
      winners.forEach((winnerIndex) => {
        stats[winnerIndex].tie += 1;
        stats[winnerIndex].equity += 1 / winners.length;
      });
    }

    simulations += 1;
  }

  if (simulations === 0) {
    return { error: "Не удалось подобрать непересекающиеся комбинации для выбранных спектров." as const };
  }

  return {
    result: {
      players: stats.map((item) => ({
        win: (item.win / simulations) * 100,
        tie: (item.tie / simulations) * 100,
        equity: (item.equity / simulations) * 100,
      })),
      board,
      simulations,
    } satisfies CalcResult,
  };
}


function createCalcPlayer(index: number, mode: CalcMode, cards?: string[], omahaCardsPerPlayer: OmahaCardsCount = 4): CalcPlayer {
  const cardsPerPlayer = getCardsPerPlayer(mode, omahaCardsPerPlayer);
  return {
    id: uid(),
    name: `Игрок ${index + 1}`,
    cards: Array.from({ length: cardsPerPlayer }, (_, cardIndex) => cards?.[cardIndex] ?? ""),
    sourceType: "hand",
    rangeId: "",
  };
}

function normalizePlayersForMode(players: CalcPlayer[], mode: CalcMode, omahaCardsPerPlayer: OmahaCardsCount = 4): CalcPlayer[] {
  const cardsPerPlayer = getCardsPerPlayer(mode, omahaCardsPerPlayer);
  return players.map((player, index) => ({
    ...player,
    name: player.name || `Игрок ${index + 1}`,
    cards: Array.from({ length: cardsPerPlayer }, (_, cardIndex) => player.cards[cardIndex] ?? ""),
    sourceType: player.sourceType ?? "hand",
    rangeId: player.rangeId ?? "",
  }));
}

function calculatePokerEquity(mode: CalcMode, players: CalcPlayer[], board: string[]) {
  if (players.length < 2) return { error: "Нужно минимум два игрока." as const };

  const omahaCardsPerPlayer = inferOmahaCardsPerPlayer(players);
  const cardsPerPlayer = getCardsPerPlayer(mode, omahaCardsPerPlayer);
  const preparedPlayers = normalizePlayersForMode(players, mode, omahaCardsPerPlayer);

  for (const player of preparedPlayers) {
    const filled = player.cards.filter(Boolean);
    if (filled.length !== cardsPerPlayer) {
      return {
        error:
          mode === "holdem"
            ? "Для Техасского холдема каждому игроку нужно выбрать 2 карты."
            : `Для Омахи каждому игроку нужно выбрать ${cardsPerPlayer} карты.`,
      };
    }
  }

  const allUsed = [...board.filter(Boolean), ...preparedPlayers.flatMap((player) => player.cards.filter(Boolean))];
  if (new Set(allUsed).size !== allUsed.length) {
    return { error: "Одна и та же карта выбрана несколько раз." as const };
  }

  const missingBoard = 5 - board.length;
  const deck = buildDeck().filter((card) => !allUsed.includes(card));
  const runs = missingBoard === 0 ? 1 : Math.max(1400, Math.min(5000, 1800 + preparedPlayers.length * 220));
  const stats = preparedPlayers.map(() => ({ win: 0, tie: 0, equity: 0 }));

  for (let i = 0; i < runs; i += 1) {
    const drawn = missingBoard === 0 ? [] : sampleCards(deck, missingBoard);
    const fullBoard = [...board, ...drawn];

    const scores = preparedPlayers.map((player) =>
      mode === "holdem" ? evaluateSeven([...player.cards, ...fullBoard]) : evaluateOmaha(player.cards, fullBoard)
    );

    let bestScore = scores[0];
    for (let scoreIndex = 1; scoreIndex < scores.length; scoreIndex += 1) {
      if (compareScore(scores[scoreIndex], bestScore) > 0) bestScore = scores[scoreIndex];
    }

    const winners: number[] = [];
    scores.forEach((score, index) => {
      if (compareScore(score, bestScore) === 0) winners.push(index);
    });

    if (winners.length === 1) {
      stats[winners[0]].win += 1;
      stats[winners[0]].equity += 1;
    } else {
      winners.forEach((winnerIndex) => {
        stats[winnerIndex].tie += 1;
        stats[winnerIndex].equity += 1 / winners.length;
      });
    }
  }

  return {
    result: {
      players: stats.map((item) => ({
        win: (item.win / runs) * 100,
        tie: (item.tie / runs) * 100,
        equity: (item.equity / runs) * 100,
      })),
      board,
      simulations: runs,
    } satisfies CalcResult,
  };
}


function getCardTextColor(card: string) {
  const suit = card[1];
  return suit === "h" || suit === "d" ? "#c62828" : "#111827";
}

const CompactCardButton: React.FC<{
  value: string;
  onClick: () => void;
  compact?: boolean;
}> = ({
  value,
  onClick,
  compact = false,
}) => {
  const textColor = value ? getCardTextColor(value) : "#94a3b8";
  return (
    <button
      onClick={onClick}
      style={{
        width: compact ? 46 : 52,
        height: compact ? 66 : 74,
        borderRadius: 12,
        border: value ? "1px solid var(--calc-card-face-border)" : "1px dashed rgba(148,163,184,0.45)",
        background: value ? "var(--calc-card-face-bg)" : "var(--calc-soft-bg)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        boxShadow: value ? "var(--calc-card-shadow)" : "inset 0 1px 2px rgba(15,23,42,0.08)",
        padding: 0,
        flex: "0 0 auto",
      }}
      title={value ? `Изменить карту ${formatCardLabel(value)}` : "Выбрать карту"}
    >
      {value ? (
        <>
          <div style={{ fontSize: compact ? 24 : 26, fontWeight: 800, lineHeight: 1, color: textColor }}>
            {value[0]}
          </div>
          <div style={{ fontSize: compact ? 18 : 20, lineHeight: 1, color: textColor }}>{getSuitLabel(value[1])}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: compact ? 20 : 22, fontWeight: 800, lineHeight: 1, color: "var(--calc-muted)" }}>?</div>
          <div style={{ fontSize: 9, color: "var(--calc-muted)", lineHeight: 1 }}>ЛКМ</div>
        </>
      )}
    </button>
  );
};



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

function getLabelsForRow(row: number) {
  return Array.from({ length: 13 }, (_, col) => getLabel(row, col));
}

function getLabelsForColumn(col: number) {
  return Array.from({ length: 13 }, (_, row) => getLabel(row, col));
}


function getTemplateLabels(template: "pairs" | "broadways" | "axs" | "sc" | "tt_aq_plus") {
  const labels: string[] = [];

  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const label = getLabel(row, col);
      const first = label[0];
      const second = label[1];
      const isPair = label.length === 2;
      const isSuited = label.endsWith("s");

      if (template === "pairs" && isPair) {
        labels.push(label);
        continue;
      }

      if (template === "broadways") {
        const broadwayRanks = ["A", "K", "Q", "J", "T"];
        if (broadwayRanks.includes(first) && broadwayRanks.includes(second)) {
          labels.push(label);
        }
        continue;
      }

      if (template === "axs" && isSuited && first === "A") {
        labels.push(label);
        continue;
      }

      if (template === "sc" && isSuited) {
        const values = "AKQJT98765432";
        const i1 = values.indexOf(first);
        const i2 = values.indexOf(second);
        if (i1 >= 0 && i2 >= 0 && Math.abs(i1 - i2) === 1) {
          labels.push(label);
        }
        continue;
      }

      if (template === "tt_aq_plus") {
        if (isPair) {
          const pairValue = "AKQJT98765432".indexOf(first);
          const ttValue = "AKQJT98765432".indexOf("T");
          if (pairValue >= 0 && pairValue <= ttValue) {
            labels.push(label);
            continue;
          }
        }

        const premiumLabels = new Set(["AQs", "AKs", "AQo", "AKo"]);
        if (premiumLabels.has(label)) {
          labels.push(label);
        }
      }
    }
  }

  return labels;
}




function getQuickPaintLabels(kind: "pairs" | "suited" | "offsuit") {
  const labels: string[] = [];

  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      if (kind === "pairs" && row === col) labels.push(getLabel(row, col));
      if (kind === "suited" && row < col) labels.push(getLabel(row, col));
      if (kind === "offsuit" && row > col) labels.push(getLabel(row, col));
    }
  }

  return labels;
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

// --- Миграция данных со старых версий (v0.3.3 и раньше) ---
// Форма данных не менялась — переименовались только сами ключи localStorage,
// поэтому достаточно один раз перенести значение на новый ключ как есть.
// Дерево и действия переносим вместе: в hands лежат ID действий, и без
// переноса действий раскраска рук отвалилась бы (ID не нашлись бы).
// Старые ключи намеренно НЕ удаляем — остаются как бэкап на случай отката.
const LEGACY_KEY_MAP: Array<[string, string]> = [
  ["poker_ranges_v4_tree", STORAGE_KEY],
  ["poker_ranges_actions_v1", ACTIONS_KEY],
  ["poker_ranges_expanded_folders_v1", EXPANDED_FOLDERS_KEY],
];

function migrateLegacyStorage() {
  try {
    for (const [oldKey, newKey] of LEGACY_KEY_MAP) {
      // на новом ключе уже есть данные — мигрировать нечего
      if (localStorage.getItem(newKey) !== null) continue;
      const legacy = localStorage.getItem(oldKey);
      if (legacy === null) continue;
      localStorage.setItem(newKey, legacy);
    }
  } catch {
    // localStorage может быть недоступен — миграция некритична
  }
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

function loadFavoriteRangeIds(): string[] {
  return loadStringArray(FAVORITE_RANGES_KEY);
}

function saveFavoriteRangeIds(ids: string[]) {
  saveStringArray(FAVORITE_RANGES_KEY, ids.slice(0, 40));
}


function loadCalcPresets(): CalcPreset[] {
  try {
    const raw = localStorage.getItem(CALC_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === "string" && (item.mode === "holdem" || item.mode === "omaha"))
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : uid(),
        name: item.name,
        mode: item.mode,
        players: Array.isArray(item.players) ? item.players : [],
        board: Array.isArray(item.board) ? item.board : [],
        deadCards: Array.isArray(item.deadCards) ? item.deadCards : ["", "", "", "", "", ""],
      }));
  } catch {
    return [];
  }
}

function saveCalcPresets(presets: CalcPreset[]) {
  localStorage.setItem(CALC_PRESETS_KEY, JSON.stringify(presets));
}

function countCombosFromHandsMap(hands: HandActionMap) {
  return Object.keys(hands).reduce((sum, hand) => sum + getCombosForHand(hand), 0);
}

function handMapsEqual(left: HandActionMap, right: HandActionMap) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function createSpectrumHistoryEntry(
  label: string,
  hands: HandActionMap,
  timestamp = Date.now()
): SpectrumHistoryEntry {
  const snapshot = { ...hands };
  return {
    id: uid(),
    label,
    timestamp,
    hands: snapshot,
    handCount: Object.keys(snapshot).length,
    combos: countCombosFromHandsMap(snapshot),
  };
}

function loadSpectrumDraft(): SpectrumDraft | null {
  try {
    const raw = localStorage.getItem(SPECTRUM_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      hands: parsed.hands && typeof parsed.hands === "object" ? parsed.hands : {},
      selectedFolderId: typeof parsed.selectedFolderId === "string" ? parsed.selectedFolderId : ROOT_FOLDER_ID,
      selectedRangeId: typeof parsed.selectedRangeId === "string" ? parsed.selectedRangeId : null,
      rangeName: typeof parsed.rangeName === "string" ? parsed.rangeName : "",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function saveSpectrumDraft(draft: SpectrumDraft) {
  localStorage.setItem(SPECTRUM_DRAFT_KEY, JSON.stringify(draft));
}

function clearSpectrumDraftStorage() {
  localStorage.removeItem(SPECTRUM_DRAFT_KEY);
}

function loadSpectrumHistory(): SpectrumHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SPECTRUM_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.label === "string" && item.hands && typeof item.hands === "object")
      .map((item) => {
        const hands = item.hands as HandActionMap;
        return {
          id: typeof item.id === "string" ? item.id : uid(),
          label: item.label,
          timestamp: typeof item.timestamp === "number" ? item.timestamp : Date.now(),
          hands,
          handCount: typeof item.handCount === "number" ? item.handCount : Object.keys(hands).length,
          combos: typeof item.combos === "number" ? item.combos : countCombosFromHandsMap(hands),
        } satisfies SpectrumHistoryEntry;
      })
      .slice(0, 120);
  } catch {
    return [];
  }
}

function saveSpectrumHistory(entries: SpectrumHistoryEntry[]) {
  localStorage.setItem(SPECTRUM_HISTORY_KEY, JSON.stringify(entries.slice(0, 120)));
}

function clearSpectrumHistoryStorage() {
  localStorage.removeItem(SPECTRUM_HISTORY_KEY);
}

function formatHistoryDateTime(value: number) {
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function loadSavedProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(SAVED_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === "string" && item.snapshot && typeof item.snapshot === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : uid(),
        name: item.name,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        snapshot: item.snapshot as SavedProjectSnapshot,
      }))
      .slice(0, 40);
  } catch {
    return [];
  }
}

function saveSavedProjects(projects: SavedProject[]) {
  localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(projects.slice(0, 40)));
}

function buildRangeCompareSummary(left: HandActionMap, right: HandActionMap): RangeCompareSummary {
  const leftLabels = Object.keys(left).sort();
  const rightLabelSet = new Set(Object.keys(right));
  const leftLabelSet = new Set(leftLabels);
  const sharedLabels = leftLabels.filter((label) => rightLabelSet.has(label));
  const leftOnlyLabels = leftLabels.filter((label) => !rightLabelSet.has(label));
  const rightOnlyLabels = Object.keys(right).filter((label) => !leftLabelSet.has(label)).sort();

  return {
    leftHands: leftLabels.length,
    rightHands: Object.keys(right).length,
    leftCombos: countCombosFromHandsMap(left),
    rightCombos: countCombosFromHandsMap(right),
    sharedHands: sharedLabels.length,
    sharedCombos: sumCombosForHands(sharedLabels),
    leftOnlyHands: leftOnlyLabels.length,
    leftOnlyCombos: sumCombosForHands(leftOnlyLabels),
    rightOnlyHands: rightOnlyLabels.length,
    rightOnlyCombos: sumCombosForHands(rightOnlyLabels),
    sameActionHands: sharedLabels.filter((label) => left[label] === right[label]).length,
    similarityPercent: leftLabels.length || Object.keys(right).length
      ? (sharedLabels.length / new Set([...leftLabels, ...Object.keys(right)]).size) * 100
      : 100,
    sharedLabels,
    leftOnlyLabels,
    rightOnlyLabels,
  };
}


function loadThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function saveThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
}

function loadThemeSaturation(): ThemeSaturation {
  try {
    const raw = localStorage.getItem(THEME_SATURATION_KEY);
    return raw === "soft" || raw === "rich" ? raw : "normal";
  } catch {
    return "normal";
  }
}

function saveThemeSaturation(saturation: ThemeSaturation) {
  localStorage.setItem(THEME_SATURATION_KEY, saturation);
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

function flattenRangesWithPath(folder: Folder, path: string[] = []): Array<{ id: string; name: string; hands: HandActionMap; path: string }> {
  const nextPath = folder.id === ROOT_FOLDER_ID ? path : [...path, folder.name];
  const current = folder.items.map((item) => ({
    id: item.id,
    name: item.name,
    hands: item.hands,
    path: nextPath.join(" / "),
  }));
  return [...current, ...folder.folders.flatMap((child) => flattenRangesWithPath(child, nextPath))];
}

function updateRangeTree(folder: Folder, rangeId: string, updater: (item: RangeItem) => RangeItem): Folder {
  return {
    ...folder,
    items: folder.items.map((item) => (item.id === rangeId ? updater(item) : item)),
    folders: folder.folders.map((child) => updateRangeTree(child, rangeId, updater)),
  };
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

const panelStyle: React.CSSProperties = {
  border: "1px solid var(--panel-border)",
  borderRadius: 14,
  padding: 10,
  background: "var(--panel-bg)",
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 8,
  fontWeight: 700,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--button-border)",
  outline: "none",
};

const toolbarButtonStylePrimary: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  cursor: "pointer",
  flex: 1,
  minWidth: 120,
  fontWeight: 600,
};

const toolbarIconButtonStyle: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 10,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  cursor: "pointer",
  color: "var(--button-text)",
};

const toolbarSmallButtonStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 9,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  cursor: "pointer",
  fontSize: 12,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  cursor: "pointer",
  color: "var(--button-text)",
};

const recentRangeButtonStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--panel-border)",
  background: "var(--panel-bg)",
  padding: "6px 8px",
  borderRadius: 8,
  cursor: "pointer",
  color: "var(--button-text)",
};

const chipStyle: React.CSSProperties = {
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
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
  background: "var(--panel-bg)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
};


const calcSelectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  outline: "none",
  fontSize: 13,
};

const calcMiniButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid var(--button-border)",
  background: "var(--panel-bg)",
  cursor: "pointer",
  flex: "0 0 auto",
};

const calcSectionStyle: React.CSSProperties = {
  border: "1px solid var(--panel-border)",
  borderRadius: 12,
  padding: 8,
  background: "var(--calc-soft-bg)",
};

const calcSectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--calc-muted)",
  fontWeight: 700,
  marginBottom: 8,
};

const calcStatsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 6,
  paddingTop: 6,
  borderTop: "1px solid #e9edf2",
};

const calcMetricLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--calc-muted)",
  marginBottom: 2,
};


function getActionHotkeyLabel(index: number) {
  if (index < 9) return String(index + 1);
  return "";
}

function createThemeVars(mode: ThemeMode, saturation: ThemeSaturation): ThemePalette {
  const lightBase: ThemePalette = {
    appBg: "#f6f8fc",
    sidebarBg: "#fbfcfe",
    sidebarBorder: "#e5ebf3",
    mainBg: "#f6f8fc",
    panelBg: "#ffffff",
    panelBorder: "#e5ebf3",
    textPrimary: "#1f2937",
    textSecondary: "#667085",
    buttonBg: "#ffffff",
    buttonBorder: "#d6e0eb",
    buttonText: "#1f2937",
    buttonHoverBg: "#f3f7fc",
    buttonActiveBg: "#e8f1ff",
    buttonActiveBorder: "#8ebfe8",
    buttonDisabledBg: "#f3f5f8",
    buttonDisabledBorder: "#e1e7ef",
    buttonDisabledText: "#94a3b8",
    inputBg: "#ffffff",
    inputBorder: "#d6e0eb",
    inputText: "#1f2937",
    calcBg: "linear-gradient(180deg, #ffffff 0%, #f6f8fc 100%)",
    calcBorder: "#d6e0eb",
    calcCardBg: "#ffffff",
    calcSoftBg: "#f7f9fc",
    calcInputBg: "#ffffff",
    calcButtonBg: "#f8fafc",
    calcButtonBorder: "#d6e0eb",
    calcButtonText: "#1f2937",
    calcActiveButtonBg: "#e8f1ff",
    calcActiveButtonBorder: "#8ebfe8",
    calcText: "#1f2937",
    calcMuted: "#64748b",
    calcCardFaceBg: "linear-gradient(180deg, #ffffff 0%, #f3f6fa 100%)",
    calcCardFaceBorder: "rgba(15,23,42,0.08)",
    calcCardShadow: "0 6px 14px rgba(15,23,42,0.10)",
  };

  const darkBase: ThemePalette = {
    appBg: "#0f2038",
    sidebarBg: "#122742",
    sidebarBorder: "#28486d",
    mainBg: "#0f2038",
    panelBg: "#132845",
    panelBorder: "#28486d",
    textPrimary: "#f4f8ff",
    textSecondary: "#a7bdd7",
    buttonBg: "#132845",
    buttonBorder: "#385a84",
    buttonText: "#eff6ff",
    buttonHoverBg: "#1a355a",
    buttonActiveBg: "#214166",
    buttonActiveBorder: "#78b8ff",
    buttonDisabledBg: "#24364f",
    buttonDisabledBorder: "#314b69",
    buttonDisabledText: "#8ca3bf",
    inputBg: "#10233f",
    inputBorder: "#385a84",
    inputText: "#f8fbff",
    calcBg: "linear-gradient(180deg, #17304f 0%, #122742 100%)",
    calcBorder: "#2d4f78",
    calcCardBg: "rgba(255,255,255,0.05)",
    calcSoftBg: "rgba(255,255,255,0.045)",
    calcInputBg: "rgba(12,24,43,0.56)",
    calcButtonBg: "rgba(255,255,255,0.08)",
    calcButtonBorder: "rgba(167,189,215,0.26)",
    calcButtonText: "#edf4ff",
    calcActiveButtonBg: "#214166",
    calcActiveButtonBorder: "#78b8ff",
    calcText: "#f4f8ff",
    calcMuted: "#a7bdd7",
    calcCardFaceBg: "linear-gradient(180deg, #e8edf4 0%, #d9e2ec 100%)",
    calcCardFaceBorder: "rgba(255,255,255,0.14)",
    calcCardShadow: "0 6px 14px rgba(2,6,23,0.24)",
  };

  const overrides: Record<ThemeMode, Record<ThemeSaturation, Partial<ThemePalette>>> = {
    light: {
      soft: {
        appBg: "#f8fafc",
        sidebarBg: "#fdfefe",
        sidebarBorder: "#edf2f7",
        mainBg: "#f8fafc",
        panelBorder: "#e9eef5",
        buttonHoverBg: "#f7f9fc",
        buttonActiveBg: "#eef4fb",
        buttonActiveBorder: "#bfd7ee",
        calcBg: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        calcSoftBg: "#f9fbfd",
        calcActiveButtonBg: "#eef4fb",
        calcActiveButtonBorder: "#bfd7ee",
      },
      normal: {},
      rich: {
        appBg: "#eef5ff",
        sidebarBg: "#f7fbff",
        sidebarBorder: "#d7e6f7",
        mainBg: "#eef5ff",
        panelBorder: "#d7e6f7",
        buttonHoverBg: "#edf5ff",
        buttonActiveBg: "#dcecff",
        buttonActiveBorder: "#5ea0e5",
        calcBg: "linear-gradient(180deg, #ffffff 0%, #eef5ff 100%)",
        calcBorder: "#cddff4",
        calcSoftBg: "#eef5ff",
        calcButtonBg: "#f3f8ff",
        calcButtonBorder: "#cfe0f5",
        calcActiveButtonBg: "#dcecff",
        calcActiveButtonBorder: "#5ea0e5",
      },
    },
    dark: {
      soft: {
        appBg: "#111f33",
        sidebarBg: "#14253c",
        sidebarBorder: "#2b4564",
        mainBg: "#111f33",
        panelBg: "#15273d",
        panelBorder: "#2b4564",
        buttonHoverBg: "#1b304c",
        buttonActiveBg: "#223852",
        buttonActiveBorder: "#6ca3d6",
        calcBg: "linear-gradient(180deg, #18304b 0%, #14253c 100%)",
        calcBorder: "#305070",
        calcSoftBg: "rgba(255,255,255,0.038)",
        calcActiveButtonBg: "#223852",
        calcActiveButtonBorder: "#6ca3d6",
      },
      normal: {},
      rich: {
        appBg: "#0b1f3f",
        sidebarBg: "#0f274d",
        sidebarBorder: "#2f5c8f",
        mainBg: "#0b1f3f",
        panelBg: "#102a51",
        panelBorder: "#2f5c8f",
        buttonHoverBg: "#173863",
        buttonActiveBg: "#1d4678",
        buttonActiveBorder: "#8cc7ff",
        calcBg: "linear-gradient(180deg, #173965 0%, #102a51 100%)",
        calcBorder: "#3a6ea8",
        calcSoftBg: "rgba(140,199,255,0.08)",
        calcButtonBg: "rgba(255,255,255,0.11)",
        calcButtonBorder: "rgba(167,189,215,0.34)",
        calcActiveButtonBg: "#1d4678",
        calcActiveButtonBorder: "#8cc7ff",
        calcCardFaceBorder: "rgba(255,255,255,0.18)",
      },
    },
  };

  const base = mode === "dark" ? darkBase : lightBase;
  return { ...base, ...overrides[mode][saturation] };
}

/* ===== Module-level tree components (stable references, no remount on App re-render) ===== */

type RangeTreeNodeProps = {
  item: RangeItem;
  depth: number;
  selectedRangeId: string | null;
  inlineRangeRename: { rangeId: string; value: string } | null;
  favoriteRangeIds: string[];
  onSelect: (rangeId: string) => void;
  onStartRename: (rangeId: string) => void;
  onCommitRename: (rangeId: string) => void;
  onCancelRename: () => void;
  onSetRenameValue: (rangeId: string, value: string) => void;
  onToggleFavorite: (rangeId: string) => void;
};

const RangeTreeNodeComponent: React.FC<RangeTreeNodeProps> = React.memo(({
  item, depth, selectedRangeId, inlineRangeRename, favoriteRangeIds,
  onSelect, onStartRename, onCommitRename, onCancelRename, onSetRenameValue, onToggleFavorite,
}) => {
  const active = item.id === selectedRangeId;
  const renaming = inlineRangeRename?.rangeId === item.id;
  const isFavorite = favoriteRangeIds.includes(item.id);

  return (
    <div
      className="range-item"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartRename(item.id);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginLeft: depth * 18,
        padding: "3px 6px",
        borderRadius: 6,
        border: active ? "1px solid #7daee8" : "1px solid transparent",
        background: active ? "#dcebff" : "transparent",
        cursor: "pointer",
        minWidth: 0,
        userSelect: "none",
        transition: "background 0.12s ease",
      }}
      title={item.name}
    >
      <span style={{ width: 14, textAlign: "center", color: "#64748b", fontSize: 12, flex: "0 0 auto" }}>
        {active ? "▸" : "•"}
      </span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(item.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          width: 12,
          flex: "0 0 auto",
          textAlign: "center",
          color: isFavorite ? "#d97706" : "#9ca3af",
          fontSize: 12,
          lineHeight: 1,
        }}
        title={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
      >
        {isFavorite ? "★" : "☆"}
      </button>

      <span style={{ width: 14, textAlign: "center", color: "#64748b", fontSize: 13, flex: "0 0 auto" }}>🗎</span>

      <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
        {renaming ? (
          <input
            autoFocus
            className="inline-rename-input"
            value={inlineRangeRename!.value}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetRenameValue(item.id, e.target.value)}
            onBlur={() => onCommitRename(item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename(item.id);
              if (e.key === "Escape") onCancelRename();
            }}
          />
        ) : (
          <div
            style={{
              fontWeight: active ? 700 : 500,
              color: "var(--text-primary)",
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 12,
            }}
            title={item.name}
          >
            {item.name}
          </div>
        )}

        <div
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            marginTop: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          рук: {Object.keys(item.hands).length}
        </div>
      </div>
    </div>
  );
});

type FolderNodeProps = {
  folder: Folder;
  depth: number;
  selectedFolderId: string;
  selectedRangeId: string | null;
  expandedFolderIds: string[];
  favoriteFolderIds: string[];
  favoriteRangeIds: string[];
  folderSearch: string;
  inlineFolderRename: { folderId: string; value: string } | null;
  inlineRangeRename: { rangeId: string; value: string } | null;
  onSelectFolder: (folderId: string) => void;
  onToggleExpand: (folderId: string) => void;
  onToggleFavoriteFolder: (folderId: string) => void;
  onToggleFavoriteRange: (rangeId: string) => void;
  onContextMenu: (folderId: string, x: number, y: number) => void;
  onSetFolderRenameValue: (folderId: string, value: string) => void;
  onCommitFolderRename: (folderId: string) => void;
  onCancelFolderRename: () => void;
  onSelectRange: (rangeId: string) => void;
  onStartRangeRename: (rangeId: string) => void;
  onCommitRangeRename: (rangeId: string) => void;
  onCancelRangeRename: () => void;
  onSetRangeRenameValue: (rangeId: string, value: string) => void;
};

const FolderNodeComponent: React.FC<FolderNodeProps> = React.memo(({
  folder, depth, selectedFolderId, selectedRangeId, expandedFolderIds,
  favoriteFolderIds, favoriteRangeIds, folderSearch,
  inlineFolderRename, inlineRangeRename,
  onSelectFolder, onToggleExpand, onToggleFavoriteFolder, onToggleFavoriteRange,
  onContextMenu,
  onSetFolderRenameValue, onCommitFolderRename, onCancelFolderRename,
  onSelectRange, onStartRangeRename, onCommitRangeRename, onCancelRangeRename, onSetRangeRenameValue,
}) => {
  if (folderSearch.trim() && !matchesFolderSearch(folder, folderSearch)) {
    return null;
  }

  const isExpanded = folderSearch.trim() ? true : expandedFolderIds.includes(folder.id);
  const isSelected = folder.id === selectedFolderId;
  const hasChildren = folder.folders.length > 0 || folder.items.length > 0;
  const totalItems = countAllItems(folder);
  const ownItems = folder.items.length;
  const isFavorite = favoriteFolderIds.includes(folder.id);

  return (
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <div
        className="folder-row"
        onClick={(e) => {
          /* Single click = select folder */
          if (e.target instanceof HTMLElement && e.target.closest('[data-folder-row-action="true"]')) return;
          onSelectFolder(folder.id);
        }}
        onDoubleClick={(e) => {
          /* Double click = expand/collapse */
          if (e.target instanceof HTMLElement && e.target.closest('[data-folder-row-action="true"]')) return;
          e.preventDefault();
          e.stopPropagation();
          onToggleExpand(folder.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelectFolder(folder.id);
          onContextMenu(folder.id, e.clientX, e.clientY);
        }}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          padding: "3px 6px",
          marginLeft: depth * 18,
          borderRadius: 6,
          background: isSelected ? "#dcebff" : "transparent",
          border: isSelected ? "1px solid #7daee8" : "1px solid transparent",
          cursor: "pointer",
          minHeight: 22,
          minWidth: 0,
          boxSizing: "border-box",
          userSelect: "none",
          transition: "background 0.12s ease",
        }}
        title="Один клик: выбрать папку. Двойной клик: развернуть или свернуть."
      >
        <button
          data-folder-row-action="true"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(folder.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            border: "1px solid #c7cfda",
            background: hasChildren ? "#f4f6f8" : "transparent",
            cursor: hasChildren ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#4b5563",
            flex: "0 0 auto",
            opacity: hasChildren ? 1 : 0.35,
            fontSize: 10,
            padding: 0,
            marginTop: 2,
          }}
          title={hasChildren ? (isExpanded ? "Свернуть папку" : "Развернуть папку") : "Папка пустая"}
        >
          {hasChildren ? (isExpanded ? "−" : "+") : "·"}
        </button>

        <button
          data-folder-row-action="true"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavoriteFolder(folder.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 0,
            fontSize: 12,
            width: 12,
            flex: "0 0 auto",
            marginTop: 2,
            color: isFavorite ? "#d97706" : "#9ca3af",
          }}
          title={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
        >
          {isFavorite ? "★" : "☆"}
        </button>

        <div style={{ fontSize: 14, width: 14, textAlign: "center", flex: "0 0 auto", marginTop: 1 }}>
          {isExpanded ? "📂" : "📁"}
        </div>

        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: folder.color,
            border: "1px solid rgba(0,0,0,0.14)",
            flex: "0 0 auto",
            marginTop: 4,
          }}
        />

        <div style={{ minWidth: 0, flex: 1, overflow: "hidden", paddingTop: 1 }}>
          {inlineFolderRename?.folderId === folder.id ? (
            <input
              autoFocus
              data-folder-row-action="true"
              className="inline-rename-input"
              value={inlineFolderRename.value}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onChange={(e) => onSetFolderRenameValue(folder.id, e.target.value)}
              onBlur={() => onCommitFolderRename(folder.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitFolderRename(folder.id);
                if (e.key === "Escape") onCancelFolderRename();
              }}
            />
          ) : (
            <div
              style={{
                fontWeight: isSelected ? 700 : 600,
                color: "var(--text-primary)",
                lineHeight: 1.15,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: 12,
              }}
              title={folder.name}
            >
              {folder.name}
            </div>
          )}

          <div
            style={{
              fontSize: 10,
              color: "var(--text-secondary)",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {ownItems} / {totalItems}
            {folder.folders.length > 0 ? ` • ${folder.folders.length} пап.` : ""}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div style={{ width: "100%", minWidth: 0 }}>
          {folder.folders.map((child) => (
            <FolderNodeComponent
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              selectedRangeId={selectedRangeId}
              expandedFolderIds={expandedFolderIds}
              favoriteFolderIds={favoriteFolderIds}
              favoriteRangeIds={favoriteRangeIds}
              folderSearch={folderSearch}
              inlineFolderRename={inlineFolderRename}
              inlineRangeRename={inlineRangeRename}
              onSelectFolder={onSelectFolder}
              onToggleExpand={onToggleExpand}
              onToggleFavoriteFolder={onToggleFavoriteFolder}
              onToggleFavoriteRange={onToggleFavoriteRange}
              onContextMenu={onContextMenu}
              onSetFolderRenameValue={onSetFolderRenameValue}
              onCommitFolderRename={onCommitFolderRename}
              onCancelFolderRename={onCancelFolderRename}
              onSelectRange={onSelectRange}
              onStartRangeRename={onStartRangeRename}
              onCommitRangeRename={onCommitRangeRename}
              onCancelRangeRename={onCancelRangeRename}
              onSetRangeRenameValue={onSetRangeRenameValue}
            />
          ))}
          {folder.items.map((item) => (
            <RangeTreeNodeComponent
              key={item.id}
              item={item}
              depth={depth + 1}
              selectedRangeId={selectedRangeId}
              inlineRangeRename={inlineRangeRename}
              favoriteRangeIds={favoriteRangeIds}
              onSelect={onSelectRange}
              onStartRename={onStartRangeRename}
              onCommitRename={onCommitRangeRename}
              onCancelRename={onCancelRangeRename}
              onSetRenameValue={onSetRangeRenameValue}
              onToggleFavorite={onToggleFavoriteRange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/* ===== End module-level tree components ===== */

function App() {
  const updateInProgressRef = useRef(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const projectImportRef = useRef<HTMLInputElement | null>(null);
  const selectionUndoRef = useRef<HandActionMap[]>([]);
  const selectionRedoRef = useRef<HandActionMap[]>([]);

  const [actions, setActions] = useState<ActionItem[]>(() => loadActions());
  const [currentActionId, setCurrentActionId] = useState<string>(() => getFallbackActionId(loadActions()));
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [actionPaletteState, setActionPaletteState] = useState<ActionPaletteState>({ open: false });

  const [selected, setSelected] = useState<HandActionMap>(() => loadSpectrumDraft()?.hands ?? {});
  const [copied, setCopied] = useState(false);
  const [folderModal, setFolderModal] = useState<FolderModalState>({ open: false });
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState>({ open: false });

  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [rectanglePreview, setRectanglePreview] = useState<string[]>([]);

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"add" | "remove">("add");
  const visitedRef = useRef<Set<string>>(new Set());
  const dragStartCellRef = useRef<{ row: number; col: number } | null>(null);
  const draggingFolderIdRef = useRef<string | null>(null);
  const splitPaintRef = useRef(false);

  const [state, setState] = useState<AppState>(() => {
    const loadedActions = loadActions();
    const nextState = loadState(getFallbackActionId(loadedActions));
    const draft = loadSpectrumDraft();
    if (!draft) return nextState;
    return {
      ...nextState,
      selectedFolderId: draft.selectedFolderId || nextState.selectedFolderId,
      selectedRangeId: draft.selectedRangeId ?? nextState.selectedRangeId,
    };
  });
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => loadExpandedFolderIds());
  const [favoriteFolderIds, setFavoriteFolderIds] = useState<string[]>(() => loadFavoriteFolderIds());
  const [favoriteRangeIds, setFavoriteRangeIds] = useState<string[]>(() => loadFavoriteRangeIds());
  const [recentRangeIds, setRecentRangeIds] = useState<string[]>(() => loadRecentRangeIds());
  /* selectedFolderIds removed — use state.selectedFolderId directly */
  const [spectrumSearch, setSpectrumSearch] = useState("");
  const [folderSearch, setFolderSearch] = useState("");
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);

  const [calcMode, setCalcMode] = useState<CalcMode>("holdem");
  const [calcPlayers, setCalcPlayers] = useState<CalcPlayer[]>(() => createDefaultCalcPlayers("holdem"));
  const [calcBoard, setCalcBoard] = useState<string[]>(["", "", "", "", ""]);
  const [calcDeadCards, setCalcDeadCards] = useState<string[]>(["", "", "", "", "", ""]);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcError, setCalcError] = useState("");
  const [cardModal, setCardModal] = useState<CardModalState>({ open: false });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [themeSaturation, setThemeSaturation] = useState<ThemeSaturation>(() => loadThemeSaturation());
  const [uiMode, setUiMode] = useState<UIMode>("spectrum");
  const [inlineFolderRename, setInlineFolderRename] = useState<{ folderId: string; value: string } | null>(null);
  const [inlineRangeRename, setInlineRangeRename] = useState<{ rangeId: string; value: string } | null>(null);
  const [calcPresets, setCalcPresets] = useState<CalcPreset[]>(() => loadCalcPresets());
  const [draftInfo, setDraftInfo] = useState<SpectrumDraft | null>(() => loadSpectrumDraft());
  const [draftSavedAt, setDraftSavedAt] = useState<number>(() => loadSpectrumDraft()?.updatedAt ?? 0);
  const [spectrumHistory, setSpectrumHistory] = useState<SpectrumHistoryEntry[]>(() => {
    const loadedHistory = loadSpectrumHistory();
    if (loadedHistory.length) return loadedHistory;
    const draft = loadSpectrumDraft();
    if (draft && Object.keys(draft.hands).length) {
      return [createSpectrumHistoryEntry("Автовосстановленный черновик", draft.hands, draft.updatedAt)];
    }
    return [];
  });
  const [selectedCalcPresetId, setSelectedCalcPresetId] = useState("");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(() => loadSavedProjects());
  const [selectedSavedProjectId, setSelectedSavedProjectId] = useState("");
  const [leftCompareRangeId, setLeftCompareRangeId] = useState("");
  const [rightCompareRangeId, setRightCompareRangeId] = useState("");
  const [trainingSourceType, setTrainingSourceType] = useState<"current" | "saved">("current");
  const [trainingSourceRangeId, setTrainingSourceRangeId] = useState("");
  const [trainingQuestion, setTrainingQuestion] = useState<TrainingQuestion | null>(null);
  const [trainingStats, setTrainingStats] = useState({ total: 0, correct: 0, streak: 0, bestStreak: 0 });
  const [trainingHistory, setTrainingHistory] = useState<TrainingHistoryEntry[]>([]);
  const [equilabImportText, setEquilabImportText] = useState("");
  const [equilabImportStatus, setEquilabImportStatus] = useState("");
  const [copiedExportKind, setCopiedExportKind] = useState<"" | "plain" | "grouped">("");
  const [spectrumAccordionOpen, setSpectrumAccordionOpen] = useState<Record<string, boolean>>({
    breakdown: false,
    boardHit: false,
    streets: false,
    structure: false,
    boardAnalyzer: false,
    calcBoardHit: false,
    calcStreets: false,
    calcBoardAnalyzer: false,
    draft: false,
    history: false,
    importEquilab: false,
    exportTextBlock: false,
    projects: false,
    training: false,
    compare: false,
  });
  const [swapPlayerAId, setSwapPlayerAId] = useState("");
  const [swapPlayerBId, setSwapPlayerBId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function silentCheckUpdate() {
      if (!isTauriRuntime()) return;
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
  useEffect(() => saveFavoriteRangeIds(favoriteRangeIds), [favoriteRangeIds]);
  useEffect(() => saveRecentRangeIds(recentRangeIds), [recentRangeIds]);
  useEffect(() => saveThemeMode(themeMode), [themeMode]);
  useEffect(() => saveThemeSaturation(themeSaturation), [themeSaturation]);
  useEffect(() => saveCalcPresets(calcPresets), [calcPresets]);
  useEffect(() => saveSpectrumHistory(spectrumHistory), [spectrumHistory]);
  useEffect(() => saveSavedProjects(savedProjects), [savedProjects]);

  const currentFolder = useMemo(() => findFolder(state.root, state.selectedFolderId), [state.root, state.selectedFolderId]);

  const currentRange = useMemo(() => {
    if (!state.selectedRangeId) return null;
    return findRangeById(state.root, state.selectedRangeId)?.range ?? null;
  }, [state.root, state.selectedRangeId]);
  useEffect(() => {
    const draft: SpectrumDraft = {
      hands: selected,
      selectedFolderId: state.selectedFolderId,
      selectedRangeId: state.selectedRangeId,
      rangeName: currentRange?.name ?? "",
      updatedAt: Date.now(),
    };
    saveSpectrumDraft(draft);
    setDraftInfo(draft);
    setDraftSavedAt(draft.updatedAt);
  }, [selected, state.selectedFolderId, state.selectedRangeId, currentRange?.name]);

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

    for (const [hand, actionValue] of Object.entries(selected)) {
      const actionIds = getHandActionIds(actionValue);
      if (!actionIds.length) continue;

      const handShare = 1 / actionIds.length;
      const comboShare = getCombosForHand(hand) / actionIds.length;

      for (const actionId of actionIds) {
        const target = byId.get(String(actionId));
        if (!target) continue;
        target.hands += handShare;
        target.combos += comboShare;
      }
    }

    for (const item of stats) {
      item.percent = (item.combos / 1326) * 100;
    }

    return stats.filter((item) => item.hands > 0 || item.id === currentActionId);
  }, [actions, selected, currentActionId]);



  const rangeBreakdown = useMemo(() => getRangeBreakdown(selected), [selected]);

  const rangeBoardAnalytics = useMemo(
    () => analyzeRangeBoard(selected, calcBoard.filter(Boolean)),
    [selected, calcBoard]
  );

  const rangeStructureSummary = useMemo(
    () => getRangeStructureSummary(selected, actionsMap, calcBoard.filter(Boolean)),
    [selected, actionsMap, calcBoard]
  );

  const boardAnalyzer = useMemo(
    () => analyzeBoardTexture(calcBoard.filter(Boolean)),
    [calcBoard]
  );

  const exportText = useMemo(() => {
    return selectedList
      .map((hand) => {
        const label = getHandActionDisplayLabel(selected[hand], actionsMap);
        return label !== "Без действия" ? `${hand}:${label}` : hand;
      })
      .join(", ");
  }, [selectedList, selected, actionsMap]);

  const exportPlainText = useMemo(() => selectedList.join(", "), [selectedList]);

  const exportGroupedText = useMemo(
    () => groupHandsByActionText(selected, actionsMap),
    [selected, actionsMap]
  );

  const currentFolderPath = useMemo(() => findFolderPath(state.root, state.selectedFolderId) ?? [], [state.root, state.selectedFolderId]);

  useEffect(() => {
    const validFolderIds = new Set(collectFolderIds(state.root, true));
    setExpandedFolderIds((prev) => {
      const filtered = prev.filter((id) => validFolderIds.has(id));
      if (filtered.length) return filtered;

      const next = new Set<string>();
      const selectedRangePath = state.selectedRangeId ? findRangeFolderPath(state.root, state.selectedRangeId) ?? [] : [];
      const selectedFolderPath = findFolderPath(state.root, state.selectedFolderId) ?? [];
      const seedPath = selectedRangePath.length ? selectedRangePath : selectedFolderPath;

      seedPath.forEach((folder) => {
        if (folder.id !== ROOT_FOLDER_ID) next.add(folder.id);
      });

      const defaultFolder = state.root.folders.find((folder) => folder.name === "Мои спектры") ?? state.root.folders[0];
      if (defaultFolder) next.add(defaultFolder.id);

      return Array.from(next);
    });
  }, [state.root, state.selectedFolderId, state.selectedRangeId]);

  useEffect(() => {
    if (inlineFolderRename && !findFolder(state.root, inlineFolderRename.folderId)) {
      setInlineFolderRename(null);
    }
    if (inlineRangeRename && !findRangeById(state.root, inlineRangeRename.rangeId)) {
      setInlineRangeRename(null);
    }
  }, [state.root, inlineFolderRename, inlineRangeRename]);

  /* selectedFolderIds sync effect removed — single source of truth is state.selectedFolderId */

  const allRangesForSidebar = useMemo(() => {
    const result: Array<RangeItem & { folderId: string; path: string }> = [];

    const walk = (folder: Folder, path: string[]) => {
      const nextPath = folder.id === ROOT_FOLDER_ID ? path : [...path, folder.name];

      for (const item of folder.items) {
        result.push({
          ...item,
          folderId: folder.id,
          path: nextPath.join(" / "),
        });
      }

      for (const child of folder.folders) {
        walk(child, nextPath);
      }
    };

    walk(state.root, []);
    return result;
  }, [state.root]);

  const sortedFilteredItems = useMemo(() => {
    const query = spectrumSearch.trim().toLowerCase();
    const items = query
      ? allRangesForSidebar.filter((item) => item.name.toLowerCase().includes(query))
      : allRangesForSidebar.filter((item) => item.folderId === state.selectedFolderId);

    return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allRangesForSidebar, spectrumSearch, state.selectedFolderId]);

  /* Folder search effect removed — FolderNodeComponent forces isExpanded=true when folderSearch is active,
     so we don't need to pollute persisted expandedFolderIds */


  const calcRangeOptions = useMemo(() => flattenCalcRanges(state.root), [state.root]);
  const omahaCardsPerPlayer = useMemo(() => inferOmahaCardsPerPlayer(calcPlayers), [calcPlayers]);
  const calcRangesById = useMemo(
    () => Object.fromEntries(calcRangeOptions.map((item) => [item.id, item.hands])),
    [calcRangeOptions]
  );
  const rangeCompareOptions = useMemo(() => flattenRangesWithPath(state.root), [state.root]);
  const rangeCompareSummary = useMemo(() => {
    const left = rangeCompareOptions.find((item) => item.id === leftCompareRangeId);
    const right = rangeCompareOptions.find((item) => item.id === rightCompareRangeId);
    if (!left || !right) return null;
    return {
      left,
      right,
      summary: buildRangeCompareSummary(left.hands, right.hands),
    };
  }, [rangeCompareOptions, leftCompareRangeId, rightCompareRangeId]);

  const allTrainingHandLabels = useMemo(() => getAllHandLabels(), []);

  const trainingSelectedRange = useMemo(
    () => rangeCompareOptions.find((item) => item.id === trainingSourceRangeId) ?? null,
    [rangeCompareOptions, trainingSourceRangeId]
  );

  const trainingSourceHands = useMemo(() => {
    if (trainingSourceType === "saved") {
      return trainingSelectedRange?.hands ?? {};
    }
    return selected;
  }, [trainingSourceType, trainingSelectedRange, selected]);

  const trainingSourceLabel = useMemo(() => {
    if (trainingSourceType === "saved") {
      if (!trainingSelectedRange) return "Сохранённый спектр";
      return trainingSelectedRange.path
        ? `${trainingSelectedRange.path} / ${trainingSelectedRange.name}`
        : trainingSelectedRange.name;
    }
    return currentRange?.name ? `Текущий рабочий спектр: ${currentRange.name}` : "Текущий рабочий спектр";
  }, [trainingSourceType, trainingSelectedRange, currentRange]);

  const startTrainingRound = () => {
    const inRangeLabels = Object.keys(trainingSourceHands);
    if (!allTrainingHandLabels.length) return;

    const outsideLabels = allTrainingHandLabels.filter((label) => !trainingSourceHands[label]);
    let pool = allTrainingHandLabels;

    if (inRangeLabels.length && outsideLabels.length) {
      pool = Math.random() < 0.5 ? inRangeLabels : outsideLabels;
    } else if (inRangeLabels.length) {
      pool = inRangeLabels;
    } else if (outsideLabels.length) {
      pool = outsideLabels;
    }

    const hand = pool[Math.floor(Math.random() * pool.length)] ?? allTrainingHandLabels[0];
    setTrainingQuestion({
      hand,
      correctActionId: trainingSourceHands[hand] ?? null,
      answeredActionId: null,
      isCorrect: null,
      sourceLabel: trainingSourceLabel,
    });
  };

  const resetTrainingSession = () => {
    setTrainingStats({ total: 0, correct: 0, streak: 0, bestStreak: 0 });
    setTrainingHistory([]);
    startTrainingRound();
  };

  const submitTrainingAnswer = (answerActionId: string | null) => {
    setTrainingQuestion((prev) => {
      if (!prev || prev.isCorrect !== null) return prev;
      const isCorrect = prev.correctActionId === answerActionId;
      const expectedLabel = prev.correctActionId ? (actionsMap[prev.correctActionId]?.label ?? "Неизвестное действие") : "Не входит в спектр";
      const actualLabel = answerActionId ? (actionsMap[answerActionId]?.label ?? "Неизвестное действие") : "Не входит в спектр";

      setTrainingStats((stats) => {
        const nextStreak = isCorrect ? stats.streak + 1 : 0;
        return {
          total: stats.total + 1,
          correct: stats.correct + (isCorrect ? 1 : 0),
          streak: nextStreak,
          bestStreak: Math.max(stats.bestStreak, nextStreak),
        };
      });

      setTrainingHistory((history) => [
        {
          id: uid(),
          hand: prev.hand,
          expectedLabel,
          actualLabel,
          isCorrect,
          sourceLabel: prev.sourceLabel,
          timestamp: Date.now(),
        },
        ...history,
      ].slice(0, 12));

      return {
        ...prev,
        answeredActionId: answerActionId,
        isCorrect,
      };
    });
  };

  useEffect(() => {
    const board = calcBoard.filter(Boolean);
    const result = calculatePokerEquityAdvanced(calcMode, calcPlayers, board, calcDeadCards, calcRangesById);
    if ("error" in result) {
      setCalcError(result.error);
      setCalcResult(null);
      return;
    }
    setCalcError("");
    setCalcResult(result.result);
  }, [calcMode, calcPlayers, calcBoard, calcDeadCards, calcRangesById]);

  useEffect(() => {
    setSwapPlayerAId((prev) => {
      if (prev && calcPlayers.some((player) => player.id === prev)) return prev;
      return calcPlayers[0]?.id ?? "";
    });
    setSwapPlayerBId((prev) => {
      if (prev && calcPlayers.some((player) => player.id === prev) && prev !== (calcPlayers[0]?.id ?? "")) return prev;
      return calcPlayers[1]?.id ?? calcPlayers[0]?.id ?? "";
    });
  }, [calcPlayers]);

  useEffect(() => {
    setSelectedSavedProjectId((prev) => (prev && savedProjects.some((project) => project.id === prev) ? prev : ""));
  }, [savedProjects]);

  useEffect(() => {
    if (trainingSourceType !== "saved") return;
    if (!rangeCompareOptions.length) {
      setTrainingSourceRangeId("");
      return;
    }
    setTrainingSourceRangeId((prev) => {
      if (prev && rangeCompareOptions.some((item) => item.id === prev)) return prev;
      if (state.selectedRangeId && rangeCompareOptions.some((item) => item.id === state.selectedRangeId)) return state.selectedRangeId;
      return rangeCompareOptions[0]?.id ?? "";
    });
  }, [trainingSourceType, rangeCompareOptions, state.selectedRangeId]);

  useEffect(() => {
    setTrainingQuestion(null);
  }, [trainingSourceType, trainingSourceRangeId, selected]);

  useEffect(() => {
    if (!rangeCompareOptions.length) {
      setLeftCompareRangeId("");
      setRightCompareRangeId("");
      return;
    }
    setLeftCompareRangeId((prev) => {
      if (prev && rangeCompareOptions.some((item) => item.id === prev)) return prev;
      return state.selectedRangeId && rangeCompareOptions.some((item) => item.id === state.selectedRangeId)
        ? state.selectedRangeId
        : rangeCompareOptions[0]?.id ?? "";
    });
    setRightCompareRangeId((prev) => {
      if (prev && rangeCompareOptions.some((item) => item.id === prev)) return prev;
      const fallback = rangeCompareOptions.find((item) => item.id !== (state.selectedRangeId ?? ""))?.id ?? rangeCompareOptions[0]?.id ?? "";
      return fallback;
    });
  }, [rangeCompareOptions, state.selectedRangeId]);

  const visibleFolderIds = useMemo(
    () => flattenVisibleFolderIds(state.root, expandedFolderIds, folderSearch),
    [state.root, expandedFolderIds, folderSearch]
  );

  const favoriteFolders = useMemo(
    () => favoriteFolderIds.map((id) => findFolder(state.root, id)).filter(Boolean) as Folder[],
    [favoriteFolderIds, state.root]
  );

  const favoriteRanges = useMemo(
    () =>
      favoriteRangeIds
        .map((id) => rangeCompareOptions.find((item) => item.id === id))
        .filter(Boolean) as Array<{ id: string; name: string; hands: HandActionMap; path: string }>,
    [favoriteRangeIds, rangeCompareOptions]
  );

  const recentRanges = useMemo(
    () =>
      recentRangeIds
        .map((id) => findRangeById(state.root, id))
        .filter(Boolean) as Array<{ range: RangeItem; folderId: string }>,
    [recentRangeIds, state.root]
  );



  const themeVars = useMemo(
    () => createThemeVars(themeMode, themeSaturation),
    [themeMode, themeSaturation]
  );

  const getToolbarButtonStyle = (options?: { active?: boolean; disabled?: boolean; success?: boolean }) => {
    const active = !!options?.active;
    const disabled = !!options?.disabled;
    const success = !!options?.success;

    return {
      ...secondaryButtonStyle,
      background: success
        ? "#10b981"
        : disabled
          ? "var(--button-disabled-bg)"
          : active
            ? "var(--button-active-bg)"
            : "var(--button-bg)",
      borderColor: active
        ? "var(--button-active-border)"
        : disabled
          ? "var(--button-disabled-border)"
          : "var(--button-border)",
      color: success ? "#052e22" : disabled ? "var(--button-disabled-text)" : "var(--button-text)",
      opacity: disabled ? 0.82 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
      boxShadow: active ? "0 0 0 1px var(--button-active-border)" : "none",
    } as React.CSSProperties;
  };
  const currentModalCardValue = useMemo(() => {
    if (!cardModal.open) return "";
    if (cardModal.kind === "board") {
      return calcBoard[cardModal.cardIndex] ?? "";
    }
    if (cardModal.kind === "dead") {
      return calcDeadCards[cardModal.cardIndex] ?? "";
    }
    const player = calcPlayers.find((item) => item.id === cardModal.playerId);
    return player?.cards[cardModal.cardIndex] ?? "";
  }, [cardModal, calcBoard, calcDeadCards, calcPlayers]);

  const unavailableCalcCards = useMemo(() => {
    const used = new Set<string>();
    calcBoard.forEach((card) => {
      if (card) used.add(card);
    });
    calcDeadCards.forEach((card) => {
      if (card) used.add(card);
    });
    calcPlayers.forEach((player) => {
      player.cards.forEach((card) => {
        if (card) used.add(card);
      });
    });
    if (currentModalCardValue) used.delete(currentModalCardValue);
    return used;
  }, [calcBoard, calcDeadCards, calcPlayers, currentModalCardValue]);

  const openBoardCardModal = (cardIndex: number) => {
    setCardModal({ open: true, kind: "board", cardIndex });
  };

  const openDeadCardModal = (cardIndex: number) => {
    setCardModal({ open: true, kind: "dead", cardIndex });
  };

  const openPlayerCardModal = (playerId: string, cardIndex: number) => {
    setCardModal({ open: true, kind: "player", playerId, cardIndex });
  };

  const applyCardSelectionFromModal = (nextCard: string) => {
    if (!cardModal.open) return;
    if (cardModal.kind === "board") {
      setCalcBoard((prev) => prev.map((item, itemIndex) => (itemIndex === cardModal.cardIndex ? nextCard : item)));
    } else if (cardModal.kind === "dead") {
      setCalcDeadCards((prev) => prev.map((item, itemIndex) => (itemIndex === cardModal.cardIndex ? nextCard : item)));
    } else if (cardModal.playerId) {
      updateCalcPlayerCard(cardModal.playerId, cardModal.cardIndex, nextCard);
    }
    setCardModal({ open: false });
  };

  const clearCardSelectionFromModal = () => {
    applyCardSelectionFromModal("");
  };


  const updateCalcPlayerCard = (playerId: string, cardIndex: number, nextCard: string) => {
    setCalcPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId
          ? {
              ...player,
              cards: player.cards.map((card, index) => (index === cardIndex ? nextCard : card)),
            }
          : player
      )
    );
  };

  const updateCalcPlayerName = (playerId: string, nextName: string) => {
    setCalcPlayers((prev) =>
      prev.map((player) => (player.id === playerId ? { ...player, name: nextName } : player))
    );
  }

  const updateCalcPlayerSourceType = (playerId: string, sourceType: "hand" | "range") => {
    setCalcPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId
          ? {
              ...player,
              sourceType,
              rangeId: sourceType === "range" ? (player.rangeId || calcRangeOptions[0]?.id || "") : "",
              cards: sourceType === "hand"
                ? Array.from({ length: getCardsPerPlayer(calcMode, omahaCardsPerPlayer) }, (_, cardIndex) => player.cards[cardIndex] ?? "")
                : player.cards.map(() => ""),
            }
          : player
      )
    );
  };

  const updateCalcPlayerRangeId = (playerId: string, rangeId: string) => {
    setCalcPlayers((prev) =>
      prev.map((player) => (player.id === playerId ? { ...player, rangeId, sourceType: "range" } : player))
    );
  };

  const clearCalcPlayerCards = (playerId: string) => {
    setCalcPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId
          ? {
              ...player,
              cards: player.cards.map(() => ""),
              rangeId: (player.sourceType ?? "hand") === "range" ? "" : player.rangeId,
            }
          : player
      )
    );
  };

  const clearDeadCards = () => {
    setCalcDeadCards(["", "", "", "", "", ""]);
  };

  const swapFirstTwoPlayers = () => {
    setCalcPlayers((prev) => {
      if (prev.length < 2) return prev;
      const next = [...prev];
      const first = next[0];
      next[0] = { ...next[1], name: next[0].name };
      next[1] = { ...first, name: next[1].name };
      return next;
    });
  };

  const applyQuickHoldemPreset = (playerId: string, preset: string) => {
    if (calcMode !== "holdem") return;
    const blocked = new Set<string>();
    calcBoard.forEach((card) => { if (card) blocked.add(card); });
    calcPlayers.forEach((player) => {
      if (player.id === playerId) return;
      player.cards.forEach((card) => { if (card) blocked.add(card); });
    });

    const variants = getHoldemPresetCombos(preset);
    const picked = variants.find((combo) => combo.every((card) => !blocked.has(card)));
    if (!picked) {
      alert(`Не удалось подобрать свободную комбинацию для ${preset}.`);
      return;
    }

    setCalcPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId ? { ...player, cards: picked } : player
      )
    );
  };
;

  const setOmahaPlayerCardCount = (nextCount: OmahaCardsCount) => {
    if (calcMode !== "omaha") return;
    setCalcPlayers((prev) =>
      prev.map((player, index) => {
        const nextCards = Array.from({ length: nextCount }, (_, cardIndex) => player.cards[cardIndex] ?? "");
        return {
          ...player,
          name: player.name || `Игрок ${index + 1}`,
          cards: nextCards,
        };
      })
    );
    setCardModal((prev) => {
      if (!prev.open || prev.kind !== "player") return prev;
      return prev.cardIndex >= nextCount ? { open: false } : prev;
    });
  };

  const addCalcPlayer = () => {
    setCalcPlayers((prev) => {
      if (prev.length >= 10) return prev;
      return [...prev, createCalcPlayer(prev.length, calcMode, undefined, omahaCardsPerPlayer)];
    });
  };

  const removeCalcPlayer = (playerId: string) => {
    setCalcPlayers((prev) => {
      if (prev.length <= 2) return prev;
      return prev
        .filter((player) => player.id !== playerId)
        .map((player, index) => ({ ...player, name: `Игрок ${index + 1}` }));
    });
  };

  const resetCalculator = () => {
    setCalcPlayers(createDefaultCalcPlayers(calcMode, omahaCardsPerPlayer));
    setCalcBoard(["", "", "", "", ""]);
    setCalcDeadCards(["", "", "", "", "", ""]);
    setCardModal({ open: false });
  };

  const switchCalcMode = (nextMode: CalcMode) => {
    setCalcMode(nextMode);
    setCalcPlayers(createDefaultCalcPlayers(nextMode, nextMode === "omaha" ? 4 : omahaCardsPerPlayer));
    setCalcBoard(["", "", "", "", ""]);
    setCalcDeadCards(["", "", "", "", "", ""]);
    setCardModal({ open: false });
  };


  const pushSelectionHistory = (snapshot: HandActionMap) => {
    selectionUndoRef.current.push({ ...snapshot });
    if (selectionUndoRef.current.length > 80) selectionUndoRef.current.shift();
  };

  const pushSpectrumHistoryEntry = (label: string, hands: HandActionMap, timestamp = Date.now()) => {
    setSpectrumHistory((prev) => [createSpectrumHistoryEntry(label, hands, timestamp), ...prev].slice(0, 120));
  };

  const applySelectionUpdate = (
    updater: (next: HandActionMap, prev: HandActionMap) => void,
    historyLabel = "Изменение спектра"
  ) => {
    setSelected((prev) => {
      const next = { ...prev };
      updater(next, prev);
      if (handMapsEqual(prev, next)) return prev;
      pushSelectionHistory(prev);
      selectionRedoRef.current = [];
      setSpectrumHistory((history) => [createSpectrumHistoryEntry(historyLabel, next), ...history].slice(0, 120));
      return next;
    });
  };

  const undoSelection = () => {
    const previous = selectionUndoRef.current.pop();
    if (!previous) return;
    setSelected((current) => {
      selectionRedoRef.current.push({ ...current });
      setSpectrumHistory((history) => [createSpectrumHistoryEntry("Undo", previous), ...history].slice(0, 120));
      return { ...previous };
    });
  };

  const redoSelection = () => {
    const nextSnapshot = selectionRedoRef.current.pop();
    if (!nextSnapshot) return;
    setSelected((current) => {
      selectionUndoRef.current.push({ ...current });
      setSpectrumHistory((history) => [createSpectrumHistoryEntry("Redo", nextSnapshot), ...history].slice(0, 120));
      return { ...nextSnapshot };
    });
  };

  const restoreAutosavedDraft = () => {
    const draft = loadSpectrumDraft();
    if (!draft) {
      alert("Черновик не найден.");
      return;
    }
    selectionUndoRef.current = [];
    selectionRedoRef.current = [];
    setSelected({ ...draft.hands });
    setState((prev) => ({
      ...prev,
      selectedFolderId: draft.selectedFolderId || prev.selectedFolderId,
      selectedRangeId: draft.selectedRangeId ?? prev.selectedRangeId,
    }));
    pushSpectrumHistoryEntry("Восстановление черновика", draft.hands);
  };

  const clearAutosavedDraft = () => {
    clearSpectrumDraftStorage();
    setDraftInfo(null);
    setDraftSavedAt(0);
  };

  const restoreSpectrumHistoryEntry = (entryId: string) => {
    const entry = spectrumHistory.find((item) => item.id === entryId);
    if (!entry) return;
    pushSelectionHistory(selected);
    selectionRedoRef.current = [];
    setSelected({ ...entry.hands });
    pushSpectrumHistoryEntry(`Восстановление: ${entry.label}`, entry.hands);
  };

  const clearSpectrumHistory = () => {
    const ok = confirm("Очистить расширенную историю действий по спектру?");
    if (!ok) return;
    setSpectrumHistory([]);
    clearSpectrumHistoryStorage();
  };

  const exportProjectJson = () => {
    const payload = {
      state,
      actions,
      expandedFolderIds,
      favoriteFolderIds,
      favoriteRangeIds,
      recentRangeIds,
      themeMode,
      themeSaturation,
      calcMode,
      calcPlayers,
      calcBoard,
      calcPresets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "poker-ranges-project.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProjectJson = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (parsed?.state?.root && Array.isArray(parsed?.actions)) {
        setState(parsed.state);
        setActions(parsed.actions);
        setExpandedFolderIds(Array.isArray(parsed.expandedFolderIds) ? parsed.expandedFolderIds : []);
        setFavoriteFolderIds(Array.isArray(parsed.favoriteFolderIds) ? parsed.favoriteFolderIds : []);
        setFavoriteRangeIds(Array.isArray(parsed.favoriteRangeIds) ? parsed.favoriteRangeIds : []);
        setRecentRangeIds(Array.isArray(parsed.recentRangeIds) ? parsed.recentRangeIds : []);
        setThemeMode(parsed.themeMode === "dark" ? "dark" : "light");
        setThemeSaturation(
          parsed.themeSaturation === "soft" || parsed.themeSaturation === "rich" ? parsed.themeSaturation : "normal"
        );
        if (parsed.calcMode === "holdem" || parsed.calcMode === "omaha") setCalcMode(parsed.calcMode);
        if (Array.isArray(parsed.calcPlayers)) setCalcPlayers(parsed.calcPlayers);
        if (Array.isArray(parsed.calcBoard)) setCalcBoard(parsed.calcBoard);
        if (Array.isArray(parsed.calcPresets)) setCalcPresets(parsed.calcPresets);
      } else {
        alert("Не удалось импортировать JSON проекта.");
      }
    } catch {
      alert("Не удалось импортировать JSON проекта.");
    }
  };

  const buildCurrentProjectSnapshot = (): SavedProjectSnapshot => ({
    state,
    actions,
    currentActionId,
    selectedActionIds,
    selected,
    expandedFolderIds,
    favoriteFolderIds,
    favoriteRangeIds,
    recentRangeIds,
    themeMode,
    themeSaturation,
    calcMode,
    calcPlayers: calcPlayers.map((player) => ({ ...player, cards: [...player.cards] })),
    calcBoard: [...calcBoard],
    calcDeadCards: [...calcDeadCards],
    calcPresets: calcPresets.map((preset) => ({
      ...preset,
      players: preset.players.map((player) => ({ ...player, cards: [...player.cards] })),
      board: [...preset.board],
      deadCards: [...preset.deadCards],
    })),
    spectrumHistory,
    draftInfo,
    selectedCalcPresetId,
  });

  const applySavedProjectSnapshot = (snapshot: SavedProjectSnapshot) => {
    selectionUndoRef.current = [];
    selectionRedoRef.current = [];
    setState(snapshot.state);
    setActions(snapshot.actions);
    setCurrentActionId(snapshot.currentActionId);
    setSelectedActionIds(snapshot.selectedActionIds ?? []);
    setSelected(snapshot.selected ?? {});
    setExpandedFolderIds(snapshot.expandedFolderIds ?? []);
    setFavoriteFolderIds(snapshot.favoriteFolderIds ?? []);
    setFavoriteRangeIds(snapshot.favoriteRangeIds ?? []);
    setRecentRangeIds(snapshot.recentRangeIds ?? []);
    setThemeMode(snapshot.themeMode === "dark" ? "dark" : "light");
    setThemeSaturation(snapshot.themeSaturation === "soft" || snapshot.themeSaturation === "rich" ? snapshot.themeSaturation : "normal");
    setCalcMode(snapshot.calcMode === "omaha" ? "omaha" : "holdem");
    setCalcPlayers(Array.isArray(snapshot.calcPlayers) ? snapshot.calcPlayers : []);
    setCalcBoard(Array.isArray(snapshot.calcBoard) ? snapshot.calcBoard : ["", "", "", "", ""]);
    setCalcDeadCards(Array.isArray(snapshot.calcDeadCards) ? snapshot.calcDeadCards : ["", "", "", "", "", ""]);
    setCalcPresets(Array.isArray(snapshot.calcPresets) ? snapshot.calcPresets : []);
    setSpectrumHistory(Array.isArray(snapshot.spectrumHistory) ? snapshot.spectrumHistory : []);
    setDraftInfo(snapshot.draftInfo ?? null);
    setSelectedCalcPresetId(snapshot.selectedCalcPresetId ?? "");
    if (snapshot.draftInfo) {
      saveSpectrumDraft(snapshot.draftInfo);
      setDraftSavedAt(snapshot.draftInfo.updatedAt);
    }
  };

  const saveNewNamedProject = () => {
    const name = prompt("Название проекта / сценария:", `Проект ${savedProjects.length + 1}`);
    if (!name?.trim()) return;
    const now = Date.now();
    const project: SavedProject = {
      id: uid(),
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
      snapshot: buildCurrentProjectSnapshot(),
    };
    setSavedProjects((prev) => [project, ...prev.filter((item) => item.id !== project.id)].slice(0, 40));
    setSelectedSavedProjectId(project.id);
  };

  const updateNamedProject = () => {
    if (!selectedSavedProjectId) return;
    setSavedProjects((prev) =>
      prev.map((item) =>
        item.id === selectedSavedProjectId
          ? { ...item, updatedAt: Date.now(), snapshot: buildCurrentProjectSnapshot() }
          : item
      )
    );
  };

  const loadNamedProject = () => {
    if (!selectedSavedProjectId) return;
    const project = savedProjects.find((item) => item.id === selectedSavedProjectId);
    if (!project) return;
    applySavedProjectSnapshot(project.snapshot);
  };

  const renameNamedProject = () => {
    if (!selectedSavedProjectId) return;
    const project = savedProjects.find((item) => item.id === selectedSavedProjectId);
    const name = prompt("Новое имя проекта:", project?.name ?? "");
    if (!name?.trim()) return;
    setSavedProjects((prev) =>
      prev.map((item) =>
        item.id === selectedSavedProjectId ? { ...item, name: name.trim(), updatedAt: Date.now() } : item
      )
    );
  };

  const deleteNamedProject = () => {
    if (!selectedSavedProjectId) return;
    const project = savedProjects.find((item) => item.id === selectedSavedProjectId);
    const ok = confirm(`Удалить проект "${project?.name ?? ""}"?`);
    if (!ok) return;
    setSavedProjects((prev) => prev.filter((item) => item.id !== selectedSavedProjectId));
    setSelectedSavedProjectId("");
  };

  const buildCurrentCalcSpot = (id: string, name: string): CalcPreset => ({
    id,
    name: name.trim(),
    mode: calcMode,
    players: calcPlayers.map((player) => ({ ...player, cards: [...player.cards] })),
    board: [...calcBoard],
    deadCards: [...calcDeadCards],
  });

  const saveCurrentCalcPreset = () => {
    const name = prompt("Название спота калькулятора:", `Спот ${calcPresets.length + 1}`);
    if (!name?.trim()) return;
    const preset = buildCurrentCalcSpot(uid(), name);
    setCalcPresets((prev) => [preset, ...prev.filter((item) => item.id !== preset.id)].slice(0, 30));
    setSelectedCalcPresetId(preset.id);
  };

  const updateSelectedCalcPreset = () => {
    if (!selectedCalcPresetId) return;
    setCalcPresets((prev) =>
      prev.map((item) =>
        item.id === selectedCalcPresetId ? buildCurrentCalcSpot(item.id, item.name) : item
      )
    );
  };

  const renameSelectedCalcPreset = () => {
    if (!selectedCalcPresetId) return;
    const current = calcPresets.find((item) => item.id === selectedCalcPresetId);
    const name = prompt("Новое название спота:", current?.name ?? "");
    if (!name?.trim()) return;
    setCalcPresets((prev) =>
      prev.map((item) => (item.id === selectedCalcPresetId ? { ...item, name: name.trim() } : item))
    );
  };

  const applyBoardPreset = (cards: string[]) => {
    const fixedUsed = new Set<string>();
    calcDeadCards.forEach((card) => { if (card) fixedUsed.add(card); });
    calcPlayers.forEach((player) => {
      player.cards.forEach((card) => { if (card) fixedUsed.add(card); });
    });

    const presetCards = cards.filter(Boolean);
    const conflictCard = presetCards.find((card) => fixedUsed.has(card));
    if (conflictCard) {
      alert(`Карта ${formatCardLabel(conflictCard)} уже занята у игрока или в blockers.`);
      return;
    }

    setCalcBoard(cards);
  };

  const swapSelectedPlayers = () => {
    if (!swapPlayerAId || !swapPlayerBId || swapPlayerAId === swapPlayerBId) return;
    setCalcPlayers((prev) => {
      const aIndex = prev.findIndex((player) => player.id === swapPlayerAId);
      const bIndex = prev.findIndex((player) => player.id === swapPlayerBId);
      if (aIndex < 0 || bIndex < 0) return prev;
      const next = [...prev];
      [next[aIndex], next[bIndex]] = [next[bIndex], next[aIndex]];
      return next;
    });
  };

  const applyCalcPreset = (presetId: string) => {
    setSelectedCalcPresetId(presetId);
    const preset = calcPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setCalcMode(preset.mode);
    setCalcPlayers(preset.players.map((player) => ({ ...player, cards: [...player.cards] })));
    setCalcBoard([...preset.board]);
    setCalcDeadCards(Array.isArray(preset.deadCards) ? [...preset.deadCards] : ["", "", "", "", "", ""]);
  };

  const deleteSelectedCalcPreset = () => {
    if (!selectedCalcPresetId) return;
    setCalcPresets((prev) => prev.filter((item) => item.id !== selectedCalcPresetId));
    setSelectedCalcPresetId("");
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

  const copyExportBlock = async (kind: "plain" | "grouped", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedExportKind(kind);
      window.setTimeout(() => setCopiedExportKind(""), 1200);
    } catch {
      alert("Не удалось скопировать автоматически. Выдели текст и скопируй вручную.");
    }
  };

  const importEquilabRange = (mode: "replace" | "add") => {
    const parsed = parseEquilabLikeRange(equilabImportText);
    if (!parsed.hands.length) {
      setEquilabImportStatus(
        parsed.invalidTokens.length
          ? `Ничего не импортировано. Не распознано: ${parsed.invalidTokens.join(", ")}`
          : "Ничего не импортировано."
      );
      return;
    }

    const actionId = currentActionId || actions[0]?.id || "";
    applySelectionUpdate((next) => {
      if (mode === "replace") {
        Object.keys(next).forEach((key) => delete next[key]);
      }
      for (const hand of parsed.hands) {
        next[hand] = actionId;
      }
    }, mode === "replace" ? "Импорт Equilab: замена спектра" : "Импорт Equilab: добавление к спектру");

    setEquilabImportStatus(
      parsed.invalidTokens.length
        ? `Импортировано рук: ${parsed.hands.length}. Не распознано: ${parsed.invalidTokens.join(", ")}`
        : `Импортировано рук: ${parsed.hands.length}.`
    );
  };


  const toggleSpectrumAccordion = (key: string) => {
    setSpectrumAccordionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSpectrumAccordionSection = (key: string, title: string, content: React.ReactNode) => {
    const isOpen = !!spectrumAccordionOpen[key];
    return (
      <div
        key={key}
        className="spectrum-right-accordion-item"
        style={{
          border: "1px solid var(--panel-border)",
          borderRadius: 14,
          background: "var(--panel-bg)",
          overflow: "hidden",
          position: "relative",
          isolation: "isolate",
          boxSizing: "border-box",
          flex: "0 0 auto",
        }}
      >
        <button
          onClick={() => toggleSpectrumAccordion(key)}
          style={{
            width: "100%",
            padding: "12px 14px",
            border: "none",
            borderBottom: isOpen ? "1px solid var(--panel-border)" : "none",
            background: isOpen ? "var(--button-active-bg)" : "var(--panel-bg)",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            textAlign: "left",
            fontWeight: 800,
            fontSize: 14,
            boxSizing: "border-box",
            position: "relative",
            zIndex: 1,
          }}
        >
          <span>{title}</span>
          <span style={{ fontSize: 16, color: "var(--text-secondary)" }}>{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && (
          <div
            className="spectrum-right-accordion-body"
            style={{
              padding: 10,
              display: "block",
              position: "relative",
              zIndex: 0,
              boxSizing: "border-box",
            }}
          >
            {content}
          </div>
        )}
      </div>
    );
  };

  const templateLabelMap: Record<"pairs" | "broadways" | "axs" | "sc" | "tt_aq_plus", string> = {
    pairs: "Шаблон: все пары",
    broadways: "Шаблон: broadways",
    axs: "Шаблон: Axs",
    sc: "Шаблон: suited connectors",
    tt_aq_plus: "Шаблон: TT+ / AQ+",
  };

  const quickPaintLabelMap: Record<"pairs" | "suited" | "offsuit", string> = {
    pairs: "Быстрая закраска: пары",
    suited: "Быстрая закраска: suited",
    offsuit: "Быстрая закраска: offsuit",
  };

  const apply = (label: string) => {
    if (visitedRef.current.has(label)) return;
    visitedRef.current.add(label);
    applySelectionUpdate((next) => {
      const currentValue = next[label];
      const decoded = decodeHandAction(currentValue);

      if (dragModeRef.current === "add") {
        if (!currentActionId) return;

        if (splitPaintRef.current) {
          if (!decoded.primaryId) {
            next[label] = encodeHandAction(currentActionId);
            return;
          }
          if (decoded.primaryId === currentActionId || decoded.secondaryId === currentActionId) return;
          next[label] = encodeHandAction(decoded.primaryId, currentActionId);
          return;
        }

        next[label] = encodeHandAction(currentActionId);
        return;
      }

      if (splitPaintRef.current && decoded.secondaryId) {
        next[label] = encodeHandAction(decoded.primaryId);
        return;
      }

      delete next[label];
    }, `Рука ${label}: ${dragModeRef.current === "add" ? (splitPaintRef.current ? "добавление второй половины" : "добавление") : (splitPaintRef.current ? "очистка второй половины" : "удаление")}`);
  };


  const applyLabelsBulk = (
    labels: string[],
    mode: "add" | "remove",
    historyLabel = `${mode === "add" ? "Добавление" : "Удаление"} ${labels.length} рук`
  ) => {
    applySelectionUpdate((next) => {
      for (const label of labels) {
        if (mode === "add") {
          if (!currentActionId) continue;
          next[label] = currentActionId;
        } else {
          delete next[label];
        }
      }
    }, historyLabel);
  };

  const resolveBulkPaintMode = (labels: string[]) => {
    if (!currentActionId) return "remove" as const;
    const allAssignedToCurrent = labels.every((label) => selected[label] === currentActionId);
    return allAssignedToCurrent ? "remove" as const : "add" as const;
  };

  const paintMatrixRow = (row: number) => {
    const labels = getLabelsForRow(row);
    applyLabelsBulk(labels, resolveBulkPaintMode(labels), `Строка ${ranks[row]}`);
  };

  const paintMatrixColumn = (col: number) => {
    const labels = getLabelsForColumn(col);
    applyLabelsBulk(labels, resolveBulkPaintMode(labels), `Колонка ${ranks[col]}`);
  };

  const applyTemplate = (template: "pairs" | "broadways" | "axs" | "sc" | "tt_aq_plus") => {
    const labels = getTemplateLabels(template);
    applyLabelsBulk(labels, resolveBulkPaintMode(labels), templateLabelMap[template]);
  };

  const applyQuickPaint = (kind: "pairs" | "suited" | "offsuit") => {
    const labels = getQuickPaintLabels(kind);
    applyLabelsBulk(labels, resolveBulkPaintMode(labels), quickPaintLabelMap[kind]);
  };



  const endDrag = () => {
    if (paintTool === "rectangle" && dragStartCellRef.current && rectanglePreview.length) {
      applyLabelsBulk(rectanglePreview, dragModeRef.current);
    }
    isDraggingRef.current = false;
    visitedRef.current = new Set();
    dragStartCellRef.current = null;
    setRectanglePreview([]);
    draggingFolderIdRef.current = null;
  };

  const clearAll = () => applySelectionUpdate((next) => { Object.keys(next).forEach((key) => delete next[key]); }, "Очистка спектра");

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

  const startInlineFolderRename = (folderId = state.selectedFolderId) => {
    const folder = findFolder(state.root, folderId);
    if (!folder) return;
    if (folder.id === ROOT_FOLDER_ID) return alert("Корневую папку переименовывать не надо.");
    setInlineRangeRename(null);
    setInlineFolderRename({ folderId, value: folder.name });

    setState((prev) => ({ ...prev, selectedFolderId: folderId, selectedRangeId: null }));
  };

  const commitInlineFolderRename = (folderId: string) => {
    if (!inlineFolderRename || inlineFolderRename.folderId !== folderId) return;
    const trimmedName = inlineFolderRename.value.trim();
    if (!trimmedName) {
      setInlineFolderRename(null);
      return;
    }
    setState((prev) => ({
      ...prev,
      root: updateFolderTree(prev.root, folderId, (item) => ({ ...item, name: trimmedName })),
    }));
    setInlineFolderRename(null);
  };

  const cancelInlineFolderRename = () => {
    setInlineFolderRename(null);
  };

  const renameFolder = (folderId = state.selectedFolderId) => {
    startInlineFolderRename(folderId);
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

  };

  const deleteFolder = (folderId = state.selectedFolderId) => {
    deleteFoldersByIds([folderId]);
  };

  const toggleFavoriteFolder = (folderId: string) => {
    setFavoriteFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [folderId, ...prev.filter((id) => id !== folderId)]
    );
  };

  const toggleFavoriteRange = (rangeId: string) => {
    setFavoriteRangeIds((prev) =>
      prev.includes(rangeId) ? prev.filter((id) => id !== rangeId) : [rangeId, ...prev.filter((id) => id !== rangeId)].slice(0, 40)
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
    selectionUndoRef.current = [];
    selectionRedoRef.current = [];
    setSelected({});
    pushSpectrumHistoryEntry("Новый пустой спектр", {});
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

  const startInlineRangeRename = (rangeId = state.selectedRangeId) => {
    if (!rangeId) return alert("Сначала выбери спектр слева.");
    const lookup = findRangeById(state.root, rangeId);
    if (!lookup) return;
    setInlineFolderRename(null);
    setInlineRangeRename({ rangeId, value: lookup.range.name });
    setState((prev) => ({ ...prev, selectedFolderId: lookup.folderId, selectedRangeId: rangeId }));
  };

  const commitInlineRangeRename = (rangeId: string) => {
    if (!inlineRangeRename || inlineRangeRename.rangeId !== rangeId) return;
    const trimmedName = inlineRangeRename.value.trim();
    if (!trimmedName) {
      setInlineRangeRename(null);
      return;
    }
    const now = Date.now();
    setState((prev) => ({
      ...prev,
      root: updateRangeTree(prev.root, rangeId, (item) => ({ ...item, name: trimmedName, updatedAt: now })),
    }));
    setInlineRangeRename(null);
  };

  const cancelInlineRangeRename = () => {
    setInlineRangeRename(null);
  };

  const renameRange = () => {
    startInlineRangeRename();
  };

  const loadRange = (rangeId: string) => {
    const lookup = findRangeById(state.root, rangeId);
    if (!lookup) return;
    const folder = findFolder(state.root, lookup.folderId);
    if (!folder) return;
    selectionUndoRef.current = [];
    selectionRedoRef.current = [];
    const nextHands = normalizeHands(lookup.range.hands, getFallbackActionId(actions));
    setSelected(nextHands);
    pushSpectrumHistoryEntry(`Загрузка спектра: ${lookup.range.name}`, nextHands);
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

  const handleFolderSelection = (folderId: string) => {
    setState((prev) => ({ ...prev, selectedFolderId: folderId, selectedRangeId: null }));
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

  /* Tree components are now at module level: FolderNodeComponent, RangeTreeNodeComponent */

  /* Stable callbacks for tree components */
  const handleTreeFolderContextMenu = React.useCallback((folderId: string, x: number, y: number) => {
    setFolderContextMenu({ open: true, folderId, x, y });
  }, []);

  const handleSetFolderRenameValue = React.useCallback((folderId: string, value: string) => {
    setInlineFolderRename({ folderId, value });
  }, []);

  const handleSetRangeRenameValue = React.useCallback((rangeId: string, value: string) => {
    setInlineRangeRename({ rangeId, value });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoSelection();
        else undoSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoSelection();
        return;
      }
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
        if (state.selectedFolderId) renameFolder(state.selectedFolderId);
        else renameRange();
      }
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && !e.altKey && tagName !== "input" && tagName !== "textarea") {
        const numeric = Number(e.key);
        if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9 && actions[numeric - 1]) {
          e.preventDefault();
          setCurrentActionId(actions[numeric - 1].id);
        }
      }
      if (e.key === "Delete") {
        if (tagName === "input" || tagName === "textarea") return;
        e.preventDefault();
        if (state.selectedFolderId) deleteFolder(state.selectedFolderId);
        else if (state.selectedRangeId) deleteRange();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      className="app-shell"
      style={{
        fontFamily: "system-ui",
        height: "100vh",
        display: "flex",
        background: "var(--app-bg)",
        color: "var(--text-primary)",
        ["--app-bg" as any]: themeVars.appBg,
        ["--sidebar-bg" as any]: themeVars.sidebarBg,
        ["--sidebar-border" as any]: themeVars.sidebarBorder,
        ["--main-bg" as any]: themeVars.mainBg,
        ["--panel-bg" as any]: themeVars.panelBg,
        ["--panel-border" as any]: themeVars.panelBorder,
        ["--text-primary" as any]: themeVars.textPrimary,
        ["--text-secondary" as any]: themeVars.textSecondary,
        ["--button-bg" as any]: themeVars.buttonBg,
        ["--button-border" as any]: themeVars.buttonBorder,
        ["--button-text" as any]: themeVars.buttonText,
        ["--button-hover-bg" as any]: themeVars.buttonHoverBg,
        ["--button-active-bg" as any]: themeVars.buttonActiveBg,
        ["--button-active-border" as any]: themeVars.buttonActiveBorder,
        ["--button-disabled-bg" as any]: themeVars.buttonDisabledBg,
        ["--button-disabled-border" as any]: themeVars.buttonDisabledBorder,
        ["--button-disabled-text" as any]: themeVars.buttonDisabledText,
        ["--input-bg" as any]: themeVars.inputBg,
        ["--input-border" as any]: themeVars.inputBorder,
        ["--input-text" as any]: themeVars.inputText,
        ["--calc-bg" as any]: themeVars.calcBg,
        ["--calc-border" as any]: themeVars.calcBorder,
        ["--calc-card-bg" as any]: themeVars.calcCardBg,
        ["--calc-soft-bg" as any]: themeVars.calcSoftBg,
        ["--calc-input-bg" as any]: themeVars.calcInputBg,
        ["--calc-button-bg" as any]: themeVars.calcButtonBg,
        ["--calc-button-border" as any]: themeVars.calcButtonBorder,
        ["--calc-button-text" as any]: themeVars.calcButtonText,
        ["--calc-active-button-bg" as any]: themeVars.calcActiveButtonBg,
        ["--calc-active-button-border" as any]: themeVars.calcActiveButtonBorder,
        ["--calc-text" as any]: themeVars.calcText,
        ["--calc-muted" as any]: themeVars.calcMuted,
        ["--calc-card-face-bg" as any]: themeVars.calcCardFaceBg,
        ["--calc-card-face-border" as any]: themeVars.calcCardFaceBorder,
        ["--calc-card-shadow" as any]: themeVars.calcCardShadow,
      } as React.CSSProperties}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <style>{`
        .app-shell button {
          transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, transform 0.12s ease, opacity 0.16s ease, color 0.16s ease;
        }
        .app-shell button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
        }
        .app-shell button:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        .app-shell button:disabled {
          background: var(--button-disabled-bg) !important;
          border-color: var(--button-disabled-border) !important;
          color: var(--button-disabled-text) !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
          transform: none !important;
          opacity: 0.9;
        }
        .app-shell .folder-row,
        .app-shell .range-item,
        .app-shell .matrix-cell {
          transition: border-color 0.14s ease, background-color 0.14s ease, box-shadow 0.14s ease, transform 0.12s ease, outline 0.12s ease, filter 0.12s ease;
        }
        .app-shell .folder-row:hover {
          border-color: var(--button-active-border) !important;
          background: var(--button-hover-bg) !important;
        }
        .app-shell .range-item:hover {
          border-color: var(--button-active-border) !important;
          background: var(--button-hover-bg) !important;
          box-shadow: 0 0 0 2px rgba(142, 202, 230, 0.14);
        }
        .app-shell .matrix-cell:hover {
          filter: brightness(1.06);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
        }

        .app-shell .spectrum-right-accordion-body > div > div:nth-child(1),
        .app-shell .spectrum-right-accordion-body > div > div:nth-child(2) {
          display: none !important;
        }
        .app-shell .spectrum-right-accordion-item {
          display: block;
          width: 100%;
          margin: 0;
        }
        .app-shell .spectrum-right-accordion-body {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }
        .app-shell .spectrum-right-accordion-body > div {
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
          min-width: 0 !important;
        }
        .app-shell .inline-rename-input {
          width: 100%;
          border-radius: 8px;
          border: 1px solid var(--button-active-border);
          background: var(--input-bg);
          color: var(--input-text);
          padding: 4px 8px;
          font-size: 13px;
          outline: none;
          box-shadow: 0 0 0 3px rgba(142, 202, 230, 0.16);
        }
      `}</style>

{uiMode === "spectrum" && (
      <div
        style={{
          width: 420,
          borderRight: "1px solid var(--sidebar-border)",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "var(--sidebar-bg)",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => openCreateFolderModal()}
            style={toolbarButtonStylePrimary}
          >
            + Новая папка
          </button>
          <button onClick={() => renameFolder()} style={toolbarIconButtonStyle} title="Переименовать папку">
            ✏️
          </button>
          <button onClick={() => openRecolorFolderModal()} style={toolbarIconButtonStyle} title="Цвет папки">
            🎨
          </button>
          <button onClick={() => deleteFoldersByIds([state.selectedFolderId])} style={toolbarIconButtonStyle} title="Удалить выбранную папку">
            🗑
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={newRange} style={toolbarButtonStylePrimary}>+ Новый спектр</button>
          <button onClick={renameRange} style={toolbarIconButtonStyle} title="Переименовать спектр">✏️</button>
          <button onClick={deleteRange} style={toolbarIconButtonStyle} title="Удалить спектр">🗑</button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={expandAllFolders} style={toolbarSmallButtonStyle}>Развернуть всё</button>
          <button onClick={collapseAllFolders} style={toolbarSmallButtonStyle}>Свернуть всё</button>
          <button onClick={exportProjectJson} style={toolbarSmallButtonStyle}>Экспорт JSON</button>
          <button onClick={() => projectImportRef.current?.click()} style={toolbarSmallButtonStyle}>Импорт JSON</button>
          <input
            ref={projectImportRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importProjectJson(file);
              e.currentTarget.value = "";
            }}
          />
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

        {!!favoriteRanges.length && (
          <div style={panelStyle}>
            <div style={panelTitleStyle}>Избранные спектры</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflow: "auto" }}>
              {favoriteRanges.slice(0, 8).map((range) => (
                <button key={range.id} onClick={() => loadRange(range.id)} style={recentRangeButtonStyle}>
                  <span style={{ fontWeight: 600 }}>★ {range.name}</span>
                  <span style={{ color: "#7b8794", fontSize: 11 }}>{range.path || "Без папки"}</span>
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
        </div>

        <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>Папки</div>

        <div ref={folderListRef} style={{ ...panelStyle, minHeight: 420, maxHeight: 520, padding: 8, overflow: "auto", background: "var(--panel-bg)" }}>
          {state.root.folders.map((folder) => (
            <FolderNodeComponent
              key={folder.id}
              folder={folder}
              depth={0}
              selectedFolderId={state.selectedFolderId}
              selectedRangeId={state.selectedRangeId}
              expandedFolderIds={expandedFolderIds}
              favoriteFolderIds={favoriteFolderIds}
              favoriteRangeIds={favoriteRangeIds}
              folderSearch={folderSearch}
              inlineFolderRename={inlineFolderRename}
              inlineRangeRename={inlineRangeRename}
              onSelectFolder={handleFolderSelection}
              onToggleExpand={toggleFolderExpanded}
              onToggleFavoriteFolder={toggleFavoriteFolder}
              onToggleFavoriteRange={toggleFavoriteRange}
              onContextMenu={handleTreeFolderContextMenu}
              onSetFolderRenameValue={handleSetFolderRenameValue}
              onCommitFolderRename={commitInlineFolderRename}
              onCancelFolderRename={cancelInlineFolderRename}
              onSelectRange={loadRange}
              onStartRangeRename={startInlineRangeRename}
              onCommitRangeRename={commitInlineRangeRename}
              onCancelRangeRename={cancelInlineRangeRename}
              onSetRangeRenameValue={handleSetRangeRenameValue}
            />
          ))}
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>{spectrumSearch.trim() ? "Поиск по всем спектрам" : `Текущая папка: “${currentFolder?.name ?? "?"}”`}</div>
          <input
            id="range-search-input"
            value={spectrumSearch}
            onChange={(e) => setSpectrumSearch(e.target.value)}
            placeholder="Поиск по спектрам..."
            style={searchInputStyle}
          />
        </div>

        <div style={{ ...panelStyle, padding: 8 }}>
          {!sortedFilteredItems.length ? (
            <div style={{ color: "#777", fontSize: 13, lineHeight: 1.4 }}>
              {spectrumSearch.trim() ? "Ничего не найдено по поиску." : "Тут пока пусто. Собери спектр справа и нажми “Сохранить”."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {sortedFilteredItems.map((it) => {
                const active = it.id === state.selectedRangeId;
                return (
                  <div
                    key={it.id}
                    className="range-item"
                    onClick={() => loadRange(it.id)}
                    onDoubleClick={() => startInlineRangeRename(it.id)}
                    style={{
                      padding: "8px 9px",
                      borderRadius: 10,
                      border: active ? "1px solid #8ecae6" : "1px solid #e9edf2",
                      background: active ? "#eaf4ff" : "white",
                      boxShadow: active ? "0 0 0 2px rgba(142, 202, 230, 0.18)" : "none",
                      cursor: "pointer",
                    }}
                    title={spectrumSearch.trim() ? `Спектр: ${it.path || "Без папки"}` : "Открыть спектр"}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {inlineRangeRename?.rangeId === it.id ? (
                          <input
                            autoFocus
                            className="inline-rename-input"
                            value={inlineRangeRename.value}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setInlineRangeRename({ rangeId: it.id, value: e.target.value })}
                            onBlur={() => commitInlineRangeRename(it.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitInlineRangeRename(it.id);
                              if (e.key === "Escape") cancelInlineRangeRename();
                            }}
                          />
                        ) : (
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                        )}
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                          рук: {Object.keys(it.hands).length}
                        </div>
                        {spectrumSearch.trim() ? (
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {it.path || "Без папки"}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavoriteRange(it.id);
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 15,
                          lineHeight: 1,
                          color: favoriteRangeIds.includes(it.id) ? "#d97706" : "#94a3b8",
                        }}
                        title={favoriteRangeIds.includes(it.id) ? "Убрать из избранного" : "Добавить в избранное"}
                      >
                        {favoriteRangeIds.includes(it.id) ? "★" : "☆"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      )}

      <div style={{ flex: 1, padding: 20, overflow: "auto", background: "var(--main-bg)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setUiMode("spectrum")} style={getToolbarButtonStyle({ active: uiMode === "spectrum" })}>
              Спектр
            </button>
            <button onClick={() => setUiMode("calculator")} style={getToolbarButtonStyle({ active: uiMode === "calculator" })}>
              Калькулятор
            </button>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Текущий режим: <strong style={{ color: "var(--text-primary)" }}>{uiMode === "spectrum" ? "Спектр" : "Калькулятор"}</strong>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => setThemeMode((prev) => (prev === "light" ? "dark" : "light"))}
              style={getToolbarButtonStyle()}
              title="Переключить тему"
            >
              {themeMode === "light" ? "🌙 Тёмная" : "☀ Светлая"}
            </button>
            {([
              { id: "soft", label: "Мягкая" },
              { id: "normal", label: "Обычная" },
              { id: "rich", label: "Насыщенная" },
            ] as Array<{ id: ThemeSaturation; label: string }>).map((item) => (
              <button
                key={item.id}
                onClick={() => setThemeSaturation(item.id)}
                style={getToolbarButtonStyle({ active: themeSaturation === item.id })}
                title={`Насыщенность темы: ${item.label}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {uiMode === "spectrum" ? <FolderBreadcrumbs /> : null}

        {uiMode === "spectrum" && (
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <button onClick={saveCurrentRange} style={getToolbarButtonStyle()}>Сохранить</button>
          <button onClick={saveAsNew} style={getToolbarButtonStyle()}>Сохранить как…</button>
          <button onClick={copyToClipboard} disabled={!exportText} style={getToolbarButtonStyle({ disabled: !exportText, success: copied })}>
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
          <button onClick={clearAll} style={getToolbarButtonStyle({ disabled: !selectedList.length })} disabled={!selectedList.length}>Очистить</button>
          <button onClick={exportPNG} style={getToolbarButtonStyle()}>Экспорт PNG</button>
          <button onClick={undoSelection} style={getToolbarButtonStyle({ disabled: selectionUndoRef.current.length === 0 })} disabled={selectionUndoRef.current.length === 0}>↶ Undo</button>
          <button onClick={redoSelection} style={getToolbarButtonStyle({ disabled: selectionRedoRef.current.length === 0 })} disabled={selectionRedoRef.current.length === 0}>↷ Redo</button>
          <button
            onClick={() => setPaintTool("brush")}
            style={getToolbarButtonStyle({ active: paintTool === "brush" })}
          >
            Кисть
          </button>
          <button
            onClick={() => setPaintTool("rectangle")}
            style={getToolbarButtonStyle({ active: paintTool === "rectangle" })}
          >
            Прямоугольник
          </button>
          <button onClick={() => applyTemplate("pairs")} style={getToolbarButtonStyle()}>
            Все пары
          </button>
          <button onClick={() => applyTemplate("broadways")} style={getToolbarButtonStyle()}>
            Бродвеи
          </button>
          <button onClick={() => applyTemplate("axs")} style={getToolbarButtonStyle()}>
            Axs
          </button>
          <button onClick={() => applyTemplate("sc")} style={getToolbarButtonStyle()}>
            SC
          </button>
          <button onClick={() => applyTemplate("tt_aq_plus")} style={getToolbarButtonStyle()}>
            TT+ / AQ+
          </button>
          <button onClick={() => applyQuickPaint("pairs")} style={getToolbarButtonStyle()}>
            Пары
          </button>
          <button onClick={() => applyQuickPaint("suited")} style={getToolbarButtonStyle()}>
            Одномастные
          </button>
          <button onClick={() => applyQuickPaint("offsuit")} style={getToolbarButtonStyle()}>
            Разномастные
          </button>
          <div style={{ marginLeft: "auto" }}>
            <strong>Комбо:</strong> {combos} / 1326 ({percent.toFixed(2)}%)
          </div>
        </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: uiMode === "calculator" ? "stretch" : "flex-start",
            gap: 20,
            alignItems: "flex-start",
            width: uiMode === "calculator" ? "100%" : "fit-content",
            maxWidth: "100%",
          }}
        >
        {uiMode === "spectrum" && (
        <div
          ref={exportRef}
          style={{
            background: "var(--panel-bg)",
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

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "32px repeat(13, 40px)",
                gap: 2,
                marginTop: 16,
                alignItems: "center",
              }}
            >
              <div />
              {ranks.map((rank, col) => (
                <button
                  key={`col-${rank}`}
                  onClick={() => paintMatrixColumn(col)}
                  title={`Закрасить столбец ${rank}`}
                  style={{
                    width: 40,
                    height: 24,
                    borderRadius: 8,
                    border: "1px solid var(--panel-border)",
                    background: "var(--panel-bg)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {rank}
                </button>
              ))}

              {Array.from({ length: 13 }).map((_, row) => (
                <React.Fragment key={`row-${row}`}>
                  <button
                    onClick={() => paintMatrixRow(row)}
                    title={`Закрасить строку ${ranks[row]}`}
                    style={{
                      width: 32,
                      height: 40,
                      borderRadius: 8,
                      border: "1px solid var(--panel-border)",
                      background: "var(--panel-bg)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {ranks[row]}
                  </button>

                  {Array.from({ length: 13 }).map((_, col) => {
                    const label = getLabel(row, col);
                    const actionValue = selected[label];
                    const isSelected = !!actionValue;
                    const decodedAction = decodeHandAction(actionValue);
                    const isSplitSelected = !!decodedAction.secondaryId;
                    const baseColor = row === col ? "#f2c85b" : "#8ecae6";
                    const backgroundValue = getHandActionBackground(actionValue, actionsMap, baseColor);
                    const actionLabel = getHandActionDisplayLabel(actionValue, actionsMap);
                    return (
                      <div
                        className="matrix-cell"
                        key={`${row}-${col}`}
                        onMouseDown={(e) => {
                          isDraggingRef.current = true;
                          visitedRef.current = new Set();
                          splitPaintRef.current = e.altKey;

                          if (paintTool === "rectangle") {
                            dragModeRef.current = e.shiftKey ? "add" : selected[label] ? "remove" : "add";
                            dragStartCellRef.current = { row, col };
                            setRectanglePreview([label]);
                          } else if (splitPaintRef.current) {
                            dragModeRef.current = e.shiftKey ? "add" : decodedAction.secondaryId ? "remove" : "add";
                            apply(label);
                          } else {
                            dragModeRef.current = e.shiftKey ? "add" : selected[label] ? "remove" : "add";
                            apply(label);
                          }
                        }}
                        onMouseEnter={() => {
                          setHoveredHand(label);
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
                          setHoveredHand((prev) => (prev === label ? null : prev));
                        }}
                        title={`${label} • ${label.length === 2 ? 6 : label.endsWith("s") ? 4 : 12} комбо${isSelected ? ` • ${actionLabel}` : ""}${isSplitSelected ? " • split" : ""}`}
                        style={{
                          width: 40,
                          height: 40,
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: backgroundValue,
                          color: "white",
                          cursor: paintTool === "rectangle" ? "crosshair" : "pointer",
                          userSelect: "none",
                          borderRadius: 2,
                          outline: rectanglePreview.includes(label)
                            ? "2px solid #1f2933"
                            : hoveredHand === label
                              ? "2px solid rgba(31,41,51,0.55)"
                              : "none",
                          outlineOffset: -2,
                          transform: hoveredHand === label ? "scale(1.04)" : "scale(1)",
                          transition: "transform 0.08s ease, outline 0.08s ease",
                        }}
                      >
                        {label}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div style={{ width: 330, flex: "0 0 330px", border: "1px solid var(--panel-border)", borderRadius: 14, padding: 14, height: "fit-content", background: "var(--panel-bg)", color: "var(--text-primary)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)" }}>Действия непокериста</div>
              <button onClick={removeSelectedActions} style={toolbarSmallButtonStyle} disabled={!selectedActionIds.length}>
                🗑 Выбранные
              </button>
            </div>

            <button onClick={addAction} style={{ ...toolbarButtonStylePrimary, width: "100%", marginBottom: 8 }}>
              + Добавить действие
            </button>

            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.45 }}>
              Горячие клавиши действий: <strong>1–9</strong>. Shift + drag — всегда закрашивает выбранным действием.
              Alt + drag — добавляет второй цвет в клетку по диагонали. Режим “Прямоугольник” закрашивает целую область.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actions.map((action, index) => {
                const active = currentActionId === action.id;
                const checked = selectedActionIds.includes(action.id);
                const hotkey = getActionHotkeyLabel(index);
                return (
                  <div
                    key={action.id}
                    style={{
                      border: active ? "2px solid #2d8fd5" : "1px solid var(--panel-border)",
                      borderRadius: 12,
                      padding: 10,
                      background: active ? "var(--calc-soft-bg)" : "var(--panel-bg)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleActionSelection(action.id)} />
                      {hotkey ? (
                        <div
                          title={`Горячая клавиша ${hotkey}`}
                          style={{
                            minWidth: 22,
                            height: 22,
                            borderRadius: 6,
                            border: "1px solid var(--panel-border)",
                            background: active ? "var(--button-active-bg)" : "var(--calc-soft-bg)",
                            color: "var(--text-primary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                            flex: "0 0 auto",
                          }}
                        >
                          {hotkey}
                        </div>
                      ) : null}
                      <button
                        onClick={() => setCurrentActionId(action.id)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: "1px solid var(--panel-border)",
                          background: action.color,
                          cursor: "pointer",
                          flex: "0 0 auto",
                        }}
                        title="Сделать действие активным"
                      />
                      <input
                        value={action.label}
                        onChange={(e) => updateActionLabel(action.id, e.target.value)}
                        style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--input-border)", outline: "none", fontSize: 13, background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                      <button onClick={() => setActionPaletteState({ open: true, actionId: action.id })} style={toolbarIconButtonStyle} title="Палитра цвета">
                        🎨
                      </button>
                      <button onClick={() => removeAction(action.id)} style={toolbarIconButtonStyle} title="Удалить действие">
                        🗑
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, borderTop: "1px solid #eef2f6", paddingTop: 12 }}>
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
                    <span style={{ color: "var(--text-primary)" }}>
                      {item.label}: {item.combos} комбо / {item.hands} рук
                    </span>
                    <strong style={{ color: "var(--text-primary)" }}>{item.percent.toFixed(2)}%</strong>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
        )}

        {uiMode === "spectrum" && (
          <div
            style={{
              width: 420,
              minWidth: 420,
              maxWidth: 420,
              alignSelf: "flex-start",
              position: "relative",
              overflow: "visible",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingRight: 4,
              minHeight: 0,
            }}
          >
            {renderSpectrumAccordionSection(
              "breakdown",
              "11. Breakdown диапазона по типам рук",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              11. Breakdown диапазона по типам рук
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                              Базовая структура диапазона и полезные подтипы. Старые функции не менялись.
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <div style={{ ...chipStyle, cursor: "default" }}>Рук: {rangeBreakdown.totalHands}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Комбо: {rangeBreakdown.totalCombos}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Диапазон: {percent.toFixed(2)}%</div>
                            </div>
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Базовая структура</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {rangeBreakdown.base.map((item) => (
                                <div
                                  key={item.label}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto auto",
                                    gap: 8,
                                    alignItems: "center",
                                    fontSize: 12,
                                    padding: "7px 8px",
                                    borderRadius: 10,
                                    background: "var(--calc-soft-bg)",
                                  }}
                                >
                                  <strong style={{ color: "var(--text-primary)" }}>{item.label}</strong>
                                  <span style={{ color: "var(--text-secondary)" }}>
                                    {item.hands} рук / {item.combos} комбо
                                  </span>
                                  <strong style={{ color: "var(--text-primary)" }}>{item.percent.toFixed(2)}%</strong>
                                </div>
                              ))}
                            </div>
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 12, marginBottom: 6 }}>Подтипы</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {rangeBreakdown.traits.map((item) => (
                                <div
                                  key={item.label}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto auto",
                                    gap: 8,
                                    alignItems: "center",
                                    fontSize: 12,
                                    padding: "7px 8px",
                                    borderRadius: 10,
                                    background: "var(--calc-soft-bg)",
                                  }}
                                >
                                  <strong style={{ color: "var(--text-primary)" }}>{item.label}</strong>
                                  <span style={{ color: "var(--text-secondary)" }}>
                                    {item.hands} рук / {item.combos} комбо
                                  </span>
                                  <strong style={{ color: "var(--text-primary)" }}>{item.percent.toFixed(2)}%</strong>
                                </div>
                              ))}
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "structure",
              "14. Структура диапазона в процентах и комбо",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              14. Структура диапазона в процентах и комбо
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                              Отдельная сводка по диапазону: размер, структура и распределение по действиям. Пункты 11–13 не менялись.
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <div style={{ ...chipStyle, cursor: "default" }}>Рук: {rangeStructureSummary.totalHands}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Комбо: {rangeStructureSummary.totalCombos}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>От всех комбо: {rangeStructureSummary.percentOfAll.toFixed(2)}%</div>
                            </div>
                
                            {rangeStructureSummary.availableOnBoard ? (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                <div style={{ ...chipStyle, cursor: "default" }}>
                                  Доступно на борде: {rangeStructureSummary.availableOnBoard.availableCombos}
                                </div>
                                <div style={{ ...chipStyle, cursor: "default" }}>
                                  Заблокировано: {rangeStructureSummary.availableOnBoard.blockedCombos}
                                </div>
                                <div style={{ ...chipStyle, cursor: "default" }}>
                                  Осталось: {rangeStructureSummary.availableOnBoard.availablePercentOfRange.toFixed(2)}%
                                </div>
                              </div>
                            ) : null}
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Структура диапазона</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {rangeStructureSummary.rows.map((row) => (
                                <div
                                  key={row.key}
                                  style={{
                                    border: "1px solid var(--panel-border)",
                                    borderRadius: 10,
                                    padding: 8,
                                    background: "var(--calc-soft-bg)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "1fr auto auto",
                                      gap: 8,
                                      alignItems: "center",
                                      fontSize: 12,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <strong style={{ color: "var(--text-primary)" }}>{row.label}</strong>
                                    <span style={{ color: "var(--text-secondary)" }}>
                                      {row.hands} рук / {row.combos} комбо
                                    </span>
                                    <strong style={{ color: "var(--text-primary)" }}>{row.percentOfRange.toFixed(2)}%</strong>
                                  </div>
                                  <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
                                    <div
                                      style={{
                                        width: `${Math.min(row.percentOfRange, 100)}%`,
                                        height: "100%",
                                        background: "linear-gradient(90deg, #8ecae6 0%, #2d8fd5 100%)",
                                      }}
                                    />
                                  </div>
                                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-secondary)" }}>
                                    От всех 1326 комбо: {row.percentOfAll.toFixed(2)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 12, marginBottom: 6 }}>По действиям</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {rangeStructureSummary.actionRows.length ? (
                                rangeStructureSummary.actionRows.map((row) => (
                                  <div
                                    key={row.key}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "1fr auto auto",
                                      gap: 8,
                                      alignItems: "center",
                                      fontSize: 12,
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      background: "var(--calc-soft-bg)",
                                    }}
                                  >
                                    <strong style={{ color: "var(--text-primary)" }}>{row.label}</strong>
                                    <span style={{ color: "var(--text-secondary)" }}>
                                      {row.hands} рук / {row.combos} комбо
                                    </span>
                                    <strong style={{ color: "var(--text-primary)" }}>{row.percentOfRange.toFixed(2)}%</strong>
                                  </div>
                                ))
                              ) : (
                                <div
                                  style={{
                                    padding: 12,
                                    borderRadius: 12,
                                    background: "var(--calc-soft-bg)",
                                    fontSize: 12,
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  Диапазон пока пустой.
                                </div>
                              )}
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "draft",
              "19. Автосохранение черновика спектра",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              19. Автосохранение черновика спектра
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Каждое изменение спектра автоматически сохраняется в локальный черновик. Можно восстановить последнее состояние после перезапуска приложения.
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <div style={{ ...chipStyle, cursor: "default" }}>Автосохранение: включено</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>
                                Последнее сохранение: {draftSavedAt ? formatHistoryDateTime(draftSavedAt) : "—"}
                              </div>
                            </div>
                
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                              <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Папка</div>
                                <strong style={{ color: "var(--text-primary)" }}>
                                  {draftInfo ? findFolder(state.root, draftInfo.selectedFolderId)?.name ?? "—" : "—"}
                                </strong>
                              </div>
                              <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Спектр</div>
                                <strong style={{ color: "var(--text-primary)" }}>
                                  {draftInfo?.rangeName || (draftInfo?.selectedRangeId ? "Выбран сохранённый спектр" : "Новый черновик")}
                                </strong>
                              </div>
                              <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Рук</div>
                                <strong style={{ color: "var(--text-primary)" }}>{draftInfo ? Object.keys(draftInfo.hands).length : 0}</strong>
                              </div>
                              <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Комбо</div>
                                <strong style={{ color: "var(--text-primary)" }}>{draftInfo ? countCombosFromHandsMap(draftInfo.hands) : 0}</strong>
                              </div>
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={restoreAutosavedDraft}
                                style={getToolbarButtonStyle({ disabled: !draftInfo })}
                                disabled={!draftInfo}
                              >
                                Восстановить черновик
                              </button>
                              <button
                                onClick={clearAutosavedDraft}
                                style={getToolbarButtonStyle({ disabled: !draftInfo })}
                                disabled={!draftInfo}
                              >
                                Очистить черновик
                              </button>
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "history",
              "20. Расширенная история действий по спектру",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                              <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)" }}>
                                20. Расширенная история действий по спектру
                              </div>
                              <button
                                onClick={clearSpectrumHistory}
                                style={getToolbarButtonStyle({ disabled: !spectrumHistory.length })}
                                disabled={!spectrumHistory.length}
                              >
                                Очистить историю
                              </button>
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              История сохраняет снапшоты спектра: массовые закраски, загрузку спектра, undo/redo, восстановление черновика и ручные изменения.
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <div style={{ ...chipStyle, cursor: "default" }}>Записей: {spectrumHistory.length}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Undo: {selectionUndoRef.current.length}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Redo: {selectionRedoRef.current.length}</div>
                            </div>
                
                            {spectrumHistory.length ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflow: "auto", paddingRight: 2 }}>
                                {spectrumHistory.slice(0, 14).map((entry) => (
                                  <div
                                    key={entry.id}
                                    style={{
                                      border: "1px solid var(--panel-border)",
                                      borderRadius: 10,
                                      padding: 10,
                                      background: "var(--calc-soft-bg)",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 6 }}>
                                      <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{entry.label}</strong>
                                      <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{formatHistoryDateTime(entry.timestamp)}</span>
                                    </div>
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                                      <span>Рук: {entry.handCount}</span>
                                      <span>Комбо: {entry.combos}</span>
                                    </div>
                                    <button onClick={() => restoreSpectrumHistoryEntry(entry.id)} style={getToolbarButtonStyle()}>
                                      Восстановить этот снапшот
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                История пока пустая. Сделай изменение в матрице, загрузи спектр или используй undo/redo — запись появится автоматически.
                              </div>
                            )}
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "importEquilab",
              "21. Импорт строкой в стиле Equilab",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              21. Импорт строкой в стиле Equilab
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Поддерживаются форматы: AA, AKs, AQo, TT+, AJo+, KTs+, 99-66, A5s-A2s, JTs-87s.
                            </div>
                
                            <textarea
                              value={equilabImportText}
                              onChange={(e) => setEquilabImportText(e.target.value)}
                              rows={4}
                              placeholder="Например: 77+, AJs+, KQs, AQo+, 99-66, A5s-A2s"
                              style={{
                                width: "100%",
                                minHeight: 110,
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid var(--panel-border)",
                                background: "var(--panel-bg)",
                                color: "var(--text-primary)",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12,
                                resize: "vertical",
                                marginBottom: 10,
                              }}
                            />
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <button
                                onClick={() => importEquilabRange("replace")}
                                style={getToolbarButtonStyle({ disabled: !equilabImportText.trim() })}
                                disabled={!equilabImportText.trim()}
                              >
                                Заменить текущий спектр
                              </button>
                              <button
                                onClick={() => importEquilabRange("add")}
                                style={getToolbarButtonStyle({ disabled: !equilabImportText.trim() })}
                                disabled={!equilabImportText.trim()}
                              >
                                Добавить к текущему
                              </button>
                            </div>
                
                            <div
                              style={{
                                padding: 10,
                                borderRadius: 10,
                                background: "var(--calc-soft-bg)",
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                lineHeight: 1.5,
                              }}
                            >
                              {equilabImportStatus || "После импорта руки будут записаны в текущее активное действие."}
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "exportTextBlock",
              "22. Экспорт спектра в текстовый формат",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              22. Экспорт спектра в текстовый формат
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Экспорт без сжатия в совместимую plain-строку и отдельный экспорт по действиям.
                            </div>
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "var(--text-primary)" }}>
                              Plain / совместимый импорт
                            </div>
                            <textarea
                              value={exportPlainText}
                              readOnly
                              rows={3}
                              placeholder="Тут появится plain-экспорт..."
                              style={{
                                width: "100%",
                                minHeight: 88,
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid var(--panel-border)",
                                background: "var(--panel-bg)",
                                color: "var(--text-primary)",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12,
                                resize: "vertical",
                                marginBottom: 8,
                              }}
                            />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <button
                                onClick={() => copyExportBlock("plain", exportPlainText)}
                                style={getToolbarButtonStyle({ disabled: !exportPlainText, success: copiedExportKind === "plain" })}
                                disabled={!exportPlainText}
                              >
                                {copiedExportKind === "plain" ? "Скопировано ✓" : "Копировать plain"}
                              </button>
                              <button
                                onClick={() => downloadTextFile("range_plain.txt", exportPlainText)}
                                style={getToolbarButtonStyle({ disabled: !exportPlainText })}
                                disabled={!exportPlainText}
                              >
                                Скачать .txt
                              </button>
                            </div>
                
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "var(--text-primary)" }}>
                              По действиям
                            </div>
                            <textarea
                              value={exportGroupedText}
                              readOnly
                              rows={5}
                              placeholder="Тут появится экспорт по действиям..."
                              style={{
                                width: "100%",
                                minHeight: 124,
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid var(--panel-border)",
                                background: "var(--panel-bg)",
                                color: "var(--text-primary)",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12,
                                resize: "vertical",
                                marginBottom: 8,
                              }}
                            />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => copyExportBlock("grouped", exportGroupedText)}
                                style={getToolbarButtonStyle({ disabled: !exportGroupedText, success: copiedExportKind === "grouped" })}
                                disabled={!exportGroupedText}
                              >
                                {copiedExportKind === "grouped" ? "Скопировано ✓" : "Копировать по действиям"}
                              </button>
                              <button
                                onClick={() => downloadTextFile("range_by_actions.txt", exportGroupedText)}
                                style={getToolbarButtonStyle({ disabled: !exportGroupedText })}
                                disabled={!exportGroupedText}
                              >
                                Скачать .txt
                              </button>
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "projects",
              "23. Сохранение проектов / сценариев анализа",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              23. Сохранение проектов / сценариев анализа
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Именованные сохранения текущего состояния страницы: дерево папок, спектры, текущий рабочий спектр, калькулятор, тема, история и выбранные настройки.
                            </div>
                
                            <select
                              value={selectedSavedProjectId}
                              onChange={(e) => setSelectedSavedProjectId(e.target.value)}
                              style={{
                                ...calcSelectStyle,
                                width: "100%",
                                marginBottom: 10,
                                background: "var(--panel-bg)",
                                borderColor: "var(--panel-border)",
                                color: "var(--text-primary)",
                              }}
                            >
                              <option value="">Выбери сохранённый проект…</option>
                              {savedProjects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name} • {formatHistoryDateTime(project.updatedAt)}
                                </option>
                              ))}
                            </select>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <button onClick={saveNewNamedProject} style={getToolbarButtonStyle()}>
                                Сохранить новый
                              </button>
                              <button
                                onClick={updateNamedProject}
                                style={getToolbarButtonStyle({ disabled: !selectedSavedProjectId })}
                                disabled={!selectedSavedProjectId}
                              >
                                Обновить
                              </button>
                              <button
                                onClick={loadNamedProject}
                                style={getToolbarButtonStyle({ disabled: !selectedSavedProjectId })}
                                disabled={!selectedSavedProjectId}
                              >
                                Загрузить
                              </button>
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <button
                                onClick={renameNamedProject}
                                style={getToolbarButtonStyle({ disabled: !selectedSavedProjectId })}
                                disabled={!selectedSavedProjectId}
                              >
                                Переименовать
                              </button>
                              <button
                                onClick={deleteNamedProject}
                                style={getToolbarButtonStyle({ disabled: !selectedSavedProjectId })}
                                disabled={!selectedSavedProjectId}
                              >
                                Удалить
                              </button>
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <button onClick={exportProjectJson} style={getToolbarButtonStyle()}>
                                Экспорт JSON
                              </button>
                              <button onClick={() => projectImportRef.current?.click()} style={getToolbarButtonStyle()}>
                                Импорт JSON
                              </button>
                            </div>
                
                            <div
                              style={{
                                padding: 10,
                                borderRadius: 10,
                                background: "var(--calc-soft-bg)",
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                lineHeight: 1.5,
                              }}
                            >
                              Сохранённых проектов: <strong>{savedProjects.length}</strong>
                              {selectedSavedProjectId
                                ? (
                                  <>
                                    {" "}• выбран: <strong>{savedProjects.find((item) => item.id === selectedSavedProjectId)?.name ?? "—"}</strong>
                                  </>
                                )
                                : null}
                            </div>
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "training",
              "24. Тренировочный режим",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              24. Тренировочный режим
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Быстрая тренировка по спектру: приложение показывает случайную руку, а ты выбираешь нужное действие или вариант “не входит в спектр”.
                            </div>
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <button
                                onClick={() => setTrainingSourceType("current")}
                                style={getToolbarButtonStyle({ active: trainingSourceType === "current" })}
                              >
                                Текущий спектр
                              </button>
                              <button
                                onClick={() => setTrainingSourceType("saved")}
                                style={getToolbarButtonStyle({ active: trainingSourceType === "saved" })}
                              >
                                Сохранённый спектр
                              </button>
                            </div>
                
                            {trainingSourceType === "saved" && (
                              <select
                                value={trainingSourceRangeId}
                                onChange={(e) => setTrainingSourceRangeId(e.target.value)}
                                style={{
                                  ...calcSelectStyle,
                                  width: "100%",
                                  marginBottom: 10,
                                  background: "var(--panel-bg)",
                                  borderColor: "var(--panel-border)",
                                  color: "var(--text-primary)",
                                }}
                              >
                                <option value="">Выбери спектр для тренировки…</option>
                                {rangeCompareOptions.map((item) => (
                                  <option key={`training-${item.id}`} value={item.id}>
                                    {item.path ? `${item.path} / ` : ""}{item.name}
                                  </option>
                                ))}
                              </select>
                            )}
                
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <div style={{ ...chipStyle, cursor: "default" }}>Источник: {trainingSourceLabel}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Рук в источнике: {Object.keys(trainingSourceHands).length}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>
                                Точность: {trainingStats.total ? ((trainingStats.correct / trainingStats.total) * 100).toFixed(1) : "0.0"}%
                              </div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Серия: {trainingStats.streak}</div>
                              <div style={{ ...chipStyle, cursor: "default" }}>Лучшая серия: {trainingStats.bestStreak}</div>
                            </div>
                
                            {!Object.keys(trainingSourceHands).length ? (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                  marginBottom: 10,
                                }}
                              >
                                Для тренировки нужен непустой спектр. Выбери рабочий диапазон или сохранённый спектр из библиотеки.
                              </div>
                            ) : (
                              <>
                                <div
                                  style={{
                                    padding: 14,
                                    borderRadius: 12,
                                    background: "var(--calc-soft-bg)",
                                    marginBottom: 10,
                                  }}
                                >
                                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>Случайная рука</div>
                                  <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)", letterSpacing: 0.5, marginBottom: 8 }}>
                                    {trainingQuestion?.hand ?? "—"}
                                  </div>
                                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                                    {trainingQuestion
                                      ? "Выбери корректное действие для этой руки."
                                      : "Нажми старт, чтобы начать серию вопросов."}
                                  </div>
                                </div>
                
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                  {!trainingQuestion && (
                                    <button onClick={startTrainingRound} style={getToolbarButtonStyle()}>
                                      Старт
                                    </button>
                                  )}
                                  {trainingQuestion && trainingQuestion.isCorrect !== null && (
                                    <button onClick={startTrainingRound} style={getToolbarButtonStyle()}>
                                      Следующая рука
                                    </button>
                                  )}
                                  <button onClick={resetTrainingSession} style={getToolbarButtonStyle({ disabled: !Object.keys(trainingSourceHands).length })} disabled={!Object.keys(trainingSourceHands).length}>
                                    Сброс серии
                                  </button>
                                </div>
                
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                  {actions.map((action) => (
                                    <button
                                      key={`training-action-${action.id}`}
                                      onClick={() => submitTrainingAnswer(action.id)}
                                      disabled={!trainingQuestion || trainingQuestion.isCorrect !== null}
                                      style={{
                                        ...getToolbarButtonStyle({ disabled: !trainingQuestion || trainingQuestion.isCorrect !== null }),
                                        borderColor: action.color,
                                        boxShadow: `inset 0 0 0 1px ${action.color}`,
                                      }}
                                    >
                                      {action.label}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => submitTrainingAnswer(null)}
                                    disabled={!trainingQuestion || trainingQuestion.isCorrect !== null}
                                    style={getToolbarButtonStyle({ disabled: !trainingQuestion || trainingQuestion.isCorrect !== null })}
                                  >
                                    Не входит в спектр
                                  </button>
                                </div>
                
                                {trainingQuestion && trainingQuestion.isCorrect !== null && (
                                  <div
                                    style={{
                                      padding: 12,
                                      borderRadius: 12,
                                      background: trainingQuestion.isCorrect ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.12)",
                                      border: `1px solid ${trainingQuestion.isCorrect ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.30)"}`,
                                      marginBottom: 10,
                                    }}
                                  >
                                    <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>
                                      {trainingQuestion.isCorrect ? "Верно ✓" : "Неверно"}
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                                      Правильный ответ: <strong style={{ color: "var(--text-primary)" }}>
                                        {trainingQuestion.correctActionId ? (actionsMap[trainingQuestion.correctActionId]?.label ?? "Неизвестное действие") : "Не входит в спектр"}
                                      </strong>
                                    </div>
                                  </div>
                                )}
                
                                {!!trainingHistory.length && (
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Последние ответы</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      {trainingHistory.slice(0, 6).map((entry) => (
                                        <div
                                          key={entry.id}
                                          style={{
                                            padding: 10,
                                            borderRadius: 10,
                                            background: "var(--calc-soft-bg)",
                                            border: `1px solid ${entry.isCorrect ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.22)"}`,
                                          }}
                                        >
                                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                                            <strong style={{ color: "var(--text-primary)" }}>{entry.hand}</strong>
                                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{formatHistoryDateTime(entry.timestamp)}</span>
                                          </div>
                                          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                                            Твой ответ: <strong style={{ color: "var(--text-primary)" }}>{entry.actualLabel}</strong><br />
                                            Верный ответ: <strong style={{ color: "var(--text-primary)" }}>{entry.expectedLabel}</strong>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
              )
            )}
            {renderSpectrumAccordionSection(
              "compare",
              "25. Сравнение двух сохранённых спектров",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              25. Сравнение двух сохранённых спектров
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                              Сравнение двух спектров из библиотеки: пересечение, уникальные руки, комбо и совпадение действий.
                            </div>
                
                            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 10 }}>
                              <select
                                value={leftCompareRangeId}
                                onChange={(e) => setLeftCompareRangeId(e.target.value)}
                                style={{
                                  ...calcSelectStyle,
                                  width: "100%",
                                  background: "var(--panel-bg)",
                                  borderColor: "var(--panel-border)",
                                  color: "var(--text-primary)",
                                }}
                              >
                                <option value="">Левый спектр…</option>
                                {rangeCompareOptions.map((item) => (
                                  <option key={`left-${item.id}`} value={item.id}>
                                    {item.path ? `${item.path} / ` : ""}{item.name}
                                  </option>
                                ))}
                              </select>
                
                              <select
                                value={rightCompareRangeId}
                                onChange={(e) => setRightCompareRangeId(e.target.value)}
                                style={{
                                  ...calcSelectStyle,
                                  width: "100%",
                                  background: "var(--panel-bg)",
                                  borderColor: "var(--panel-border)",
                                  color: "var(--text-primary)",
                                }}
                              >
                                <option value="">Правый спектр…</option>
                                {rangeCompareOptions.map((item) => (
                                  <option key={`right-${item.id}`} value={item.id}>
                                    {item.path ? `${item.path} / ` : ""}{item.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                
                            {rangeCompareSummary ? (
                              <>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Совпадение: {rangeCompareSummary.summary.similarityPercent.toFixed(2)}%
                                  </div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Общих рук: {rangeCompareSummary.summary.sharedHands}
                                  </div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Совпали по действию: {rangeCompareSummary.summary.sameActionHands}
                                  </div>
                                </div>
                
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
                                  <div style={{ padding: 10, borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Левый спектр</div>
                                    <strong>{rangeCompareSummary.summary.leftHands} рук / {rangeCompareSummary.summary.leftCombos} комбо</strong>
                                  </div>
                                  <div style={{ padding: 10, borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Пересечение</div>
                                    <strong>{rangeCompareSummary.summary.sharedHands} рук / {rangeCompareSummary.summary.sharedCombos} комбо</strong>
                                  </div>
                                  <div style={{ padding: 10, borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Правый спектр</div>
                                    <strong>{rangeCompareSummary.summary.rightHands} рук / {rangeCompareSummary.summary.rightCombos} комбо</strong>
                                  </div>
                                </div>
                
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                                  <div
                                    style={{
                                      padding: 10,
                                      borderRadius: 10,
                                      background: "var(--calc-soft-bg)",
                                      minHeight: 140,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Только слева</div>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                                      {rangeCompareSummary.summary.leftOnlyHands} рук / {rangeCompareSummary.summary.leftOnlyCombos} комбо
                                    </div>
                                    <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text-primary)" }}>
                                      {rangeCompareSummary.summary.leftOnlyLabels.length
                                        ? rangeCompareSummary.summary.leftOnlyLabels.slice(0, 28).join(", ")
                                        : "—"}
                                    </div>
                                  </div>
                
                                  <div
                                    style={{
                                      padding: 10,
                                      borderRadius: 10,
                                      background: "var(--calc-soft-bg)",
                                      minHeight: 140,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Общие руки</div>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                                      {rangeCompareSummary.summary.sharedHands} рук / {rangeCompareSummary.summary.sharedCombos} комбо
                                    </div>
                                    <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text-primary)" }}>
                                      {rangeCompareSummary.summary.sharedLabels.length
                                        ? rangeCompareSummary.summary.sharedLabels.slice(0, 28).join(", ")
                                        : "—"}
                                    </div>
                                  </div>
                
                                  <div
                                    style={{
                                      padding: 10,
                                      borderRadius: 10,
                                      background: "var(--calc-soft-bg)",
                                      minHeight: 140,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Только справа</div>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                                      {rangeCompareSummary.summary.rightOnlyHands} рук / {rangeCompareSummary.summary.rightOnlyCombos} комбо
                                    </div>
                                    <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text-primary)" }}>
                                      {rangeCompareSummary.summary.rightOnlyLabels.length
                                        ? rangeCompareSummary.summary.rightOnlyLabels.slice(0, 28).join(", ")
                                        : "—"}
                                    </div>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                Выбери два сохранённых спектра из библиотеки для сравнения.
                              </div>
                            )}
                          </div>
              )
            )}
          </div>
        )}
{uiMode === "calculator" && (
<div
  style={{
    width: "100%",
    border: "1px solid var(--calc-border)",
    borderRadius: 18,
    padding: 16,
    background: "var(--calc-bg)",
    color: "var(--calc-text)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
  }}
>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
    <div>
      <div style={{ fontWeight: 800, fontSize: 18, color: "var(--calc-text)" }}>Покерный калькулятор</div>
      <div style={{ fontSize: 12, color: "var(--calc-muted)", marginTop: 2 }}>
        Игроков: {calcPlayers.length}/10 • Режим: {calcMode === "holdem" ? "Холдем" : `Омаха ${omahaCardsPerPlayer}-card`}
      </div>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={resetCalculator} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>
        Сбросить
      </button>
      <button onClick={addCalcPlayer} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }} disabled={calcPlayers.length >= 10}>
        + Игрок
      </button>
    </div>
  </div>

  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
    <div style={{ ...calcSectionStyle, padding: 12, background: "var(--calc-card-bg)" }}>
      <div style={{ ...calcSectionTitleStyle, marginBottom: 10 }}>Режим и настройки</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          onClick={() => switchCalcMode("holdem")}
          style={{
            ...toolbarSmallButtonStyle,
            background: calcMode === "holdem" ? "var(--calc-active-button-bg)" : "var(--calc-button-bg)",
            borderColor: calcMode === "holdem" ? "var(--calc-active-button-border)" : "var(--calc-button-border)",
            color: "var(--calc-button-text)",
            fontWeight: calcMode === "holdem" ? 700 : 500,
          }}
        >
          Холдем
        </button>
        <button
          onClick={() => switchCalcMode("omaha")}
          style={{
            ...toolbarSmallButtonStyle,
            background: calcMode === "omaha" ? "var(--calc-active-button-bg)" : "var(--calc-button-bg)",
            borderColor: calcMode === "omaha" ? "var(--calc-active-button-border)" : "var(--calc-button-border)",
            color: "var(--calc-button-text)",
            fontWeight: calcMode === "omaha" ? 700 : 500,
          }}
        >
          Омаха
        </button>
      </div>

      {calcMode === "omaha" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--calc-muted)", marginBottom: 8 }}>Количество карт у игрока в Омахе</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([4, 5, 6, 7] as OmahaCardsCount[]).map((count) => (
              <button
                key={`omaha-cards-${count}`}
                onClick={() => setOmahaPlayerCardCount(count)}
                style={{
                  ...toolbarSmallButtonStyle,
                  minWidth: 56,
                  background: omahaCardsPerPlayer === count ? "var(--calc-active-button-bg)" : "var(--calc-button-bg)",
                  borderColor: omahaCardsPerPlayer === count ? "var(--calc-active-button-border)" : "var(--calc-button-border)",
                  color: "var(--calc-button-text)",
                  fontWeight: omahaCardsPerPlayer === count ? 700 : 500,
                }}
                title={`Омаха ${count}-card`}
              >
                {count} карты
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <select
          value={swapPlayerAId}
          onChange={(e) => setSwapPlayerAId(e.target.value)}
          style={{ ...calcSelectStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}
        >
          {calcPlayers.map((player) => (
            <option key={`swap-a-${player.id}`} value={player.id}>{player.name}</option>
          ))}
        </select>
        <select
          value={swapPlayerBId}
          onChange={(e) => setSwapPlayerBId(e.target.value)}
          style={{ ...calcSelectStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}
        >
          {calcPlayers.map((player) => (
            <option key={`swap-b-${player.id}`} value={player.id}>{player.name}</option>
          ))}
        </select>
        <button
          onClick={swapSelectedPlayers}
          style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}
          disabled={calcPlayers.length < 2 || !swapPlayerAId || !swapPlayerBId || swapPlayerAId === swapPlayerBId}
          title="Поменять местами выбранных игроков"
        >
          ↔ Поменять
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <select
          value={selectedCalcPresetId}
          onChange={(e) => applyCalcPreset(e.target.value)}
          style={{ ...calcSelectStyle, flex: 1, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}
        >
          <option value="">Сохранённые споты</option>
          {calcPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
        <button onClick={saveCurrentCalcPreset} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }} title="Сохранить новый спот">💾</button>
        <button onClick={updateSelectedCalcPreset} disabled={!selectedCalcPresetId} style={{ ...toolbarSmallButtonStyle, background: selectedCalcPresetId ? "var(--calc-button-bg)" : "var(--button-disabled-bg)", borderColor: selectedCalcPresetId ? "var(--calc-button-border)" : "var(--button-disabled-border)", color: selectedCalcPresetId ? "var(--calc-button-text)" : "var(--button-disabled-text)" }} title="Обновить выбранный спот">↻</button>
        <button onClick={renameSelectedCalcPreset} disabled={!selectedCalcPresetId} style={{ ...toolbarSmallButtonStyle, background: selectedCalcPresetId ? "var(--calc-button-bg)" : "var(--button-disabled-bg)", borderColor: selectedCalcPresetId ? "var(--calc-button-border)" : "var(--button-disabled-border)", color: selectedCalcPresetId ? "var(--calc-button-text)" : "var(--button-disabled-text)" }} title="Переименовать выбранный спот">✎</button>
        <button onClick={deleteSelectedCalcPreset} disabled={!selectedCalcPresetId} style={{ ...toolbarSmallButtonStyle, background: selectedCalcPresetId ? "var(--calc-button-bg)" : "var(--button-disabled-bg)", borderColor: selectedCalcPresetId ? "var(--calc-button-border)" : "var(--button-disabled-border)", color: selectedCalcPresetId ? "var(--calc-button-text)" : "var(--button-disabled-text)" }} title="Удалить выбранный спот">✕</button>
      </div>

      <div style={{ fontSize: 11, color: "var(--calc-muted)", lineHeight: 1.5 }}>
        Range vs Range работает в режиме <strong>Холдем</strong>. В Омахе доступен выбор количества карманных карт: <strong>4 / 5 / 6 / 7</strong>.
      </div>
    </div>

    <div style={{ ...calcSectionStyle, padding: 12, background: "var(--calc-card-bg)" }}>
      <div style={{ ...calcSectionTitleStyle, marginBottom: 10 }}>Стол и быстрые борды</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
        {calcBoard.map((card, index) => (
          <CompactCardButton key={`board-${index}`} value={card} compact onClick={() => openBoardCardModal(index)} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => applyBoardPreset(["As", "7d", "2c", "", ""])} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>A72r</button>
        <button onClick={() => applyBoardPreset(["Kh", "Qd", "Tc", "", ""])} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>KQT</button>
        <button onClick={() => applyBoardPreset(["9h", "8h", "7c", "", ""])} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>987hh</button>
        <button onClick={() => applyBoardPreset(["Ad", "Kd", "Qd", "", ""])} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>AKQ♦</button>
        <button onClick={() => applyBoardPreset(["", "", "", "", ""])} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>Очистить стол</button>
      </div>

      <div style={{ ...calcSectionTitleStyle, marginTop: 14, marginBottom: 10 }}>Блокеры / мёртвые карты</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "var(--calc-muted)" }}>Учитываются при расчёте как blockers.</div>
        <button onClick={clearDeadCards} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }}>Очистить</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {calcDeadCards.map((card, index) => (
          <CompactCardButton key={`dead-${index}`} value={card} compact onClick={() => openDeadCardModal(index)} />
        ))}
      </div>
    </div>

    <div style={{ ...calcSectionStyle, padding: 12, background: "var(--calc-card-bg)" }}>
      <div style={{ ...calcSectionTitleStyle, marginBottom: 10 }}>Сводка расчёта</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
        <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--calc-soft-bg)", border: "1px solid rgba(148,163,184,0.18)" }}>
          <div style={{ fontSize: 11, color: "var(--calc-muted)", marginBottom: 4 }}>Режим</div>
          <strong style={{ fontSize: 14 }}>{calcMode === "holdem" ? "Холдем" : `Омаха ${omahaCardsPerPlayer}-card`}</strong>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--calc-soft-bg)", border: "1px solid rgba(148,163,184,0.18)" }}>
          <div style={{ fontSize: 11, color: "var(--calc-muted)", marginBottom: 4 }}>Симуляций / blockers</div>
          <strong style={{ fontSize: 14 }}>{calcResult ? calcResult.simulations : 0} • {calcDeadCards.filter(Boolean).length}</strong>
        </div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--calc-soft-bg)", border: "1px solid rgba(148,163,184,0.18)", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "var(--calc-muted)", marginBottom: 4 }}>Текущий борд</div>
        <strong style={{ fontSize: 14 }}>{calcBoard.filter(Boolean).length ? calcBoard.filter(Boolean).map((card) => formatCardLabel(card)).join(" ") : "—"}</strong>
      </div>
      <div style={{ fontSize: 12, color: calcError ? "#fca5a5" : "var(--calc-muted)", lineHeight: 1.5 }}>
        {calcError || (calcResult ? "ЛКМ по карте — изменить. Эквити игроков ниже в карточках." : "ЛКМ по карте — изменить")}
      </div>
    </div>
  </div>


  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
{renderSpectrumAccordionSection(
              "calcBoardHit",
              "12. Анализ попадания в борд",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              12. Анализ попадания в борд
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                              Анализ берёт текущий борд из калькулятора справа и считает реальные доступные комбо с учётом блокеров борда.
                            </div>
                
                            {rangeBoardAnalytics ? (
                              <>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Улица: {rangeBoardAnalytics.currentStreet.street}
                                  </div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Борд: {formatBoardCardsInline(rangeBoardAnalytics.currentStreet.board)}
                                  </div>
                                </div>
                
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Доступно комбо: {rangeBoardAnalytics.availableCombos}
                                  </div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Заблокировано бордом: {rangeBoardAnalytics.blockedCombos}
                                  </div>
                                </div>
                
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {rangeBoardAnalytics.currentStreet.buckets.map((bucket) => (
                                    <div
                                      key={bucket.key}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr auto auto",
                                        gap: 8,
                                        alignItems: "center",
                                        fontSize: 12,
                                        padding: "7px 8px",
                                        borderRadius: 10,
                                        background: "var(--calc-soft-bg)",
                                      }}
                                    >
                                      <strong style={{ color: "var(--text-primary)" }}>{bucket.label}</strong>
                                      <span style={{ color: "var(--text-secondary)" }}>{bucket.combos} комбо</span>
                                      <strong style={{ color: "var(--text-primary)" }}>{bucket.percent.toFixed(2)}%</strong>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                Для анализа нужен хотя бы флоп. Выбери минимум 3 карты на столе в калькуляторе справа.
                              </div>
                            )}
                          </div>
              )
            )}
            
{renderSpectrumAccordionSection(
              "calcStreets",
              "13. Разбивка по улицам",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              13. Разбивка по улицам
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                              Отдельный срез по флопу / тёрну / риверу на основе текущего борда из калькулятора.
                            </div>
                
                            {rangeBoardAnalytics ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {rangeBoardAnalytics.streets.map((street) => {
                                  const pairPlus = street.buckets.find((bucket) => bucket.key === "pairPlus");
                                  const twoPairPlus = street.buckets.find((bucket) => bucket.key === "twoPairPlus");
                                  const tripsPlus = street.buckets.find((bucket) => bucket.key === "tripsPlus");
                                  const flushDraw = street.buckets.find((bucket) => bucket.key === "flushDraw");
                                  const oesd = street.buckets.find((bucket) => bucket.key === "oesd");
                                  const gutshot = street.buckets.find((bucket) => bucket.key === "gutshot");
                
                                  return (
                                    <div
                                      key={street.street}
                                      style={{
                                        border: "1px solid var(--panel-border)",
                                        borderRadius: 12,
                                        padding: 10,
                                        background: "var(--calc-soft-bg)",
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                                        <strong style={{ color: "var(--text-primary)" }}>{street.street}</strong>
                                        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                          {formatBoardCardsInline(street.board)}
                                        </span>
                                      </div>
                
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>Пара+</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {pairPlus?.percent.toFixed(2)}% ({pairPlus?.combos ?? 0})
                                          </strong>
                                        </div>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>Две пары+</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {twoPairPlus?.percent.toFixed(2)}% ({twoPairPlus?.combos ?? 0})
                                          </strong>
                                        </div>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>Сет / трипс+</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {tripsPlus?.percent.toFixed(2)}% ({tripsPlus?.combos ?? 0})
                                          </strong>
                                        </div>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>Флеш-дро</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {flushDraw?.percent.toFixed(2)}% ({flushDraw?.combos ?? 0})
                                          </strong>
                                        </div>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>OESD</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {oesd?.percent.toFixed(2)}% ({oesd?.combos ?? 0})
                                          </strong>
                                        </div>
                                        <div style={{ fontSize: 12 }}>
                                          <div style={{ color: "var(--text-secondary)", marginBottom: 2 }}>Гатшот</div>
                                          <strong style={{ color: "var(--text-primary)" }}>
                                            {gutshot?.percent.toFixed(2)}% ({gutshot?.combos ?? 0})
                                          </strong>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                Пока нет разбивки по улицам: сначала выбери хотя бы флоп в калькуляторе.
                              </div>
                            )}
                          </div>
              )
            )}
            
{renderSpectrumAccordionSection(
              "calcBoardAnalyzer",
              "15. Board analyzer",
              (
                          <div
                            style={{
                              border: "1px solid var(--panel-border)",
                              borderRadius: 14,
                              background: "var(--panel-bg)",
                              padding: 14,
                            }}
                          >
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "var(--text-primary)" }}>
                              15. Board analyzer
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                              Независимый анализ текстуры текущего борда: масти, связность, спаренность и общее давление доски.
                            </div>
                
                            {boardAnalyzer ? (
                              <>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  <div style={{ ...chipStyle, cursor: "default" }}>Улица: {boardAnalyzer.street}</div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>Борд: {formatBoardCardsInline(boardAnalyzer.board)}</div>
                                </div>
                
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Старшая карта</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.highCard}</strong>
                                  </div>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Спаренность</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.pairedness}</strong>
                                  </div>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Мастевая текстура</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.suitTexture}</strong>
                                  </div>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Связность</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.connectivity}</strong>
                                  </div>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Стрит-давление</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.straightPressure}</strong>
                                  </div>
                                  <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--calc-soft-bg)" }}>
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Флеш-давление</div>
                                    <strong style={{ color: "var(--text-primary)" }}>{boardAnalyzer.flushPressure}</strong>
                                  </div>
                                </div>
                
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  <div style={{ ...chipStyle, cursor: "default" }}>Бродвей-карт: {boardAnalyzer.broadwayCount}</div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>Разброс рангов: {boardAnalyzer.rankSpan}</div>
                                  <div style={{ ...chipStyle, cursor: "default" }}>
                                    Wheel: {boardAnalyzer.wheelPotential ? "есть" : "нет"}
                                  </div>
                                </div>
                
                                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Быстрые выводы</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {boardAnalyzer.notes.length ? (
                                    boardAnalyzer.notes.map((note, index) => (
                                      <div key={`${note}-${index}`} style={{ ...chipStyle, cursor: "default" }}>
                                        {note}
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ ...chipStyle, cursor: "default" }}>Сухая доска без сильных особенностей</div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  background: "var(--calc-soft-bg)",
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                Для board analyzer нужен хотя бы флоп. Выбери минимум 3 карты на столе в калькуляторе.
                              </div>
                            )}
                          </div>
              )
            )}
            
  </div>

  <div style={{ ...calcSectionStyle, padding: 12, background: "var(--calc-card-bg)", marginTop: 14 }}>
    <div style={{ ...calcSectionTitleStyle, marginBottom: 10 }}>Игроки и результаты</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
      {calcPlayers.map((player, playerIndex) => (
        <div key={player.id} style={{ border: "1px solid rgba(148,163,184,0.18)", borderRadius: 14, padding: 10, background: "var(--calc-card-bg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
            <input
              value={player.name}
              onChange={(e) => updateCalcPlayerName(player.id, e.target.value)}
              style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.22)", outline: "none", fontWeight: 700, fontSize: 14, background: "var(--calc-input-bg)", color: "var(--calc-text)" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => clearCalcPlayerCards(player.id)} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }} title={(player.sourceType ?? "hand") === "range" ? "Сбросить спектр игрока" : "Очистить карты игрока"}>⌫</button>
              <button onClick={() => removeCalcPlayer(player.id)} disabled={calcPlayers.length <= 2} style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)" }} title="Удалить игрока">🗑</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => updateCalcPlayerSourceType(player.id, "hand")}
              style={{ ...toolbarSmallButtonStyle, flex: 1, background: (player.sourceType ?? "hand") === "hand" ? "var(--calc-active-button-bg)" : "var(--calc-button-bg)", borderColor: (player.sourceType ?? "hand") === "hand" ? "var(--calc-active-button-border)" : "var(--calc-button-border)", color: "var(--calc-button-text)" }}
            >
              Рука
            </button>
            <button
              onClick={() => updateCalcPlayerSourceType(player.id, "range")}
              disabled={calcMode !== "holdem"}
              style={{ ...toolbarSmallButtonStyle, flex: 1, background: (player.sourceType ?? "hand") === "range" ? "var(--calc-active-button-bg)" : "var(--calc-button-bg)", borderColor: (player.sourceType ?? "hand") === "range" ? "var(--calc-active-button-border)" : "var(--calc-button-border)", color: "var(--calc-button-text)", opacity: calcMode !== "holdem" ? 0.55 : 1, cursor: calcMode !== "holdem" ? "not-allowed" : "pointer" }}
              title={calcMode === "holdem" ? "Использовать сохранённый спектр" : "Range vs Range пока только для холдема"}
            >
              Спектр
            </button>
          </div>

          {(player.sourceType ?? "hand") === "range" ? (
            <div style={{ marginBottom: 8 }}>
              <select value={player.rangeId ?? ""} onChange={(e) => updateCalcPlayerRangeId(player.id, e.target.value)} style={{ ...calcSelectStyle, width: "100%", background: "var(--calc-input-bg)", borderColor: "rgba(148,163,184,0.22)", color: "var(--calc-text)" }}>
                <option value="">Выбери спектр…</option>
                {calcRangeOptions.map((rangeOption) => (
                  <option key={rangeOption.id} value={rangeOption.id}>{rangeOption.name}</option>
                ))}
              </select>
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--calc-muted)" }}>
                {player.rangeId ? `${Object.keys(calcRangesById[player.rangeId] ?? {}).length} рук в спектре` : "Для range vs range выбери сохранённый спектр"}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {player.cards.map((card, cardIndex) => (
                  <CompactCardButton key={`${player.id}-${cardIndex}`} value={card} compact onClick={() => openPlayerCardModal(player.id, cardIndex)} />
                ))}
              </div>
              {calcMode === "holdem" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {["AA", "KK", "QQ", "JJ", "AKs", "AQs", "AKo", "QJo"].map((preset) => (
                    <button
                      key={`${player.id}-${preset}`}
                      onClick={() => applyQuickHoldemPreset(player.id, preset)}
                      style={{ ...toolbarSmallButtonStyle, background: "var(--calc-button-bg)", borderColor: "var(--calc-button-border)", color: "var(--calc-button-text)", padding: "5px 8px" }}
                      title={`Быстро выбрать ${preset}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,0.18)" }}>
            <div style={{ textAlign: "center" }}>
              <span style={{ display: "block", fontSize: 10, color: "var(--calc-muted)", marginBottom: 2 }}>Победа</span>
              <strong style={{ color: "var(--calc-text)", fontSize: 13 }}>{calcResult ? `${calcResult.players[playerIndex]?.win.toFixed(2)}%` : "—"}</strong>
            </div>
            <div style={{ textAlign: "center" }}>
              <span style={{ display: "block", fontSize: 10, color: "var(--calc-muted)", marginBottom: 2 }}>Ничья</span>
              <strong style={{ color: "var(--calc-text)", fontSize: 13 }}>{calcResult ? `${calcResult.players[playerIndex]?.tie.toFixed(2)}%` : "—"}</strong>
            </div>
            <div style={{ textAlign: "center" }}>
              <span style={{ display: "block", fontSize: 10, color: "var(--calc-muted)", marginBottom: 2 }}>Эквити</span>
              <strong style={{ color: "var(--calc-text)", fontSize: 13 }}>{calcResult ? `${calcResult.players[playerIndex]?.equity.toFixed(2)}%` : "—"}</strong>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
</div>
        )}
        </div>

        {uiMode === "spectrum" && (
        <>
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>Экспорт</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{exportText ? `${selectedList.length} рук` : "Пока пусто"}</div>
          </div>
          <textarea
            value={exportText}
            readOnly
            rows={2}
            placeholder="Тут появится экспорт спектра..."
            style={{
              width: "100%",
              maxWidth: 1000,
              minHeight: 76,
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--panel-border)",
              background: "var(--panel-bg)",
              color: "var(--text-primary)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
        </div>
        </>
        )}
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


{cardModal.open && (
  <div style={modalOverlayStyle} onClick={() => setCardModal({ open: false })}>
    <div style={{ ...modalCardStyle, width: 520, maxHeight: "82vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Выбор карты</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
        Нажми на карту, чтобы заменить её. Уже занятые карты заблокированы.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {CALC_SUITS.map((suit) => (
          <div key={suit.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fafcff" }}>
            <div style={{ fontWeight: 800, marginBottom: 8, color: suit.id === "h" || suit.id === "d" ? "#c62828" : "#111827" }}>
              {suit.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {ranks.map((rank) => {
                const card = `${rank}${suit.id}`;
                const disabled = unavailableCalcCards.has(card);
                const active = currentModalCardValue === card;
                return (
                  <button
                    key={card}
                    onClick={() => applyCardSelectionFromModal(card)}
                    disabled={disabled}
                    style={{
                      padding: "8px 0",
                      borderRadius: 8,
                      border: active ? "2px solid #2d8fd5" : "1px solid #d8e1ea",
                      background: disabled ? "#eef2f7" : "white",
                      color: suit.id === "h" || suit.id === "d" ? "#c62828" : "#111827",
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      opacity: disabled ? 0.55 : 1,
                    }}
                  >
                    {rank}{suit.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <button onClick={clearCardSelectionFromModal} style={secondaryButtonStyle}>
          Очистить
        </button>
        <button onClick={() => setCardModal({ open: false })} style={secondaryButtonStyle}>
          Закрыть
        </button>
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
            background: "var(--panel-bg)",
            border: "1px solid var(--panel-border)",
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

const ContextMenuButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: 8,
        border: "none",
        background: "var(--panel-bg)",
        color: "var(--text-primary)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--calc-soft-bg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--panel-bg)";
      }}
    >
      {children}
    </button>
  );
};

// переносим данные со старых ключей ДО первого чтения состояния приложением
migrateLegacyStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
