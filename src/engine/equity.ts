// Движок префлоп-эквити: таблицы фактов (169×169) и расчёты поверх них.
//
// Вынесено из main.tsx 08.08.2026. Здесь нет ни React, ни браузера — только числа,
// поэтому модуль проверяется быстрыми тестами (tests/unit/equity.test.ts), а не
// прогоном приложения в Chrome. Это и есть смысл выноса: ошибку в математике
// сквозной тест интерфейса не поймает — снаружи она выглядит правдоподобно.
//
// Диапазон здесь — просто набор меток рук (ключи объекта); значения игнорируются,
// поэтому тип максимально широкий и модуль ничего не знает про модель приложения.
import preflopEquity from "../../packs/preflop_allin_equity.json" with { type: "json" };

// Таблица олл-ин эквити для ICM-солвера: классы и матрица 169×169.
export const ICM_EQUITY: number[][] = (preflopEquity as { equity: number[][] }).equity;
export const ICM_CLASSES: string[] = (preflopEquity as { classes: string[] }).classes;
export const ICM_COMBO: number[] = ICM_CLASSES.map((c) => (c.length === 2 ? 6 : c.endsWith("s") ? 4 : 12));
export const ICM_CLASS_IDX: Record<string, number> = {};
ICM_CLASSES.forEach((c, i) => { ICM_CLASS_IDX[c] = i; });

// Эквити каждой руки против СЛУЧАЙНОЙ (для heatmap-раскраски по силе): комбо-
// взвешенное среднее эквити класса против всех классов. Считаем один раз.
export const EQUITY_VS_RANDOM: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  const totalCombo = ICM_COMBO.reduce((a, b) => a + b, 0);
  ICM_CLASSES.forEach((c, i) => {
    let s = 0;
    for (let j = 0; j < ICM_CLASSES.length; j += 1) s += ICM_EQUITY[i][j] * ICM_COMBO[j];
    out[c] = s / totalCombo;
  });
  return out;
})();

// Эквити руки против заданного диапазона (комбо-взвешенно). Для heatmap «против спектра».
export function handEquityVsRange(label: string, rangeHands: HandActionMap): number {
  const i = ICM_CLASS_IDX[label];
  if (i == null) return 0.5;
  let num = 0;
  let den = 0;
  for (const oppLabel of Object.keys(rangeHands)) {
    const j = ICM_CLASS_IDX[oppLabel];
    if (j == null) continue;
    const w = ICM_COMBO[j];
    den += w;
    num += ICM_EQUITY[i][j] * w;
  }
  return den > 0 ? num / den : 0.5;
}

// Матрица долей НИЧЬИХ (сплитов) класс-против-класса — для колонок Wins/Splits/Losses
// в конструкторе. Пакет старого формата её может не содержать: тогда считаем ничьи
// нулевыми (win = eq, lose = 1 − eq) — на эквити и раскраске это не сказывается.
export const ICM_TIE: number[][] | null = (preflopEquity as { tie?: number[][] }).tie ?? null;

export type HandBreakdown = { equity: number; win: number; tie: number; lose: number };

// Разбор руки против диапазона: эквити + доли выигрыш/ничья/проигрыш, комбо-взвешенно
// (та же весовка, что в handEquityVsRange — без карт-ремувала на уровне классов, чтобы
// heatmap конструктора совпадал с редакторским). Пустой диапазон = против случайной руки.
export function handBreakdownVsRange(label: string, rangeHands: HandActionMap): HandBreakdown {
  const i = ICM_CLASS_IDX[label];
  if (i == null) return { equity: 0.5, win: 0.5, tie: 0, lose: 0.5 };
  const oppLabels = Object.keys(rangeHands);
  const js = oppLabels.length
    ? oppLabels.map((l) => ICM_CLASS_IDX[l]).filter((j): j is number => j != null)
    : ICM_CLASSES.map((_c, j) => j);
  let den = 0;
  let eqNum = 0;
  let tieNum = 0;
  for (const j of js) {
    const w = ICM_COMBO[j];
    den += w;
    eqNum += ICM_EQUITY[i][j] * w;
    tieNum += (ICM_TIE ? ICM_TIE[i][j] : 0) * w;
  }
  if (den <= 0) return { equity: 0.5, win: 0.5, tie: 0, lose: 0.5 };
  const equity = eqNum / den;
  const tie = Math.min(1, Math.max(0, tieNum / den));
  const win = Math.max(0, equity - tie / 2);
  const lose = Math.max(0, 1 - equity - tie / 2);
  return { equity, win, tie, lose };
}
