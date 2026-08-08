// Справочник игровых ситуаций: глубины стеков, размеры столов, позиции и действия.
//
// Вынесено из main.tsx 08.08.2026. Это правила игры, а не настройки интерфейса,
// поэтому им место рядом с моделью, а не в файле с разметкой.
// Стек — КОРЗИНА, а не точное число. Отдельного спектра для 97ББ не бывает:
// на глубоких стеках решения перестают зависеть от глубины, поэтому 100, 200
// и 1000ББ схлопываются в одну корзину «100+BB». Так же устроены реальные чарты.
// Короткие стеки (5–20BB) добавлены под пуш/фолд-чарты: на такой глубине
// разумны только олл-ин или фолд, и там живёт пак «Пуш/фолд Nash».
export const STACKS = ["5BB", "8BB", "10BB", "12BB", "15BB", "20BB", "30BB", "50BB", "75BB", "100BB", "100+BB"] as const;

export const TABLE_SIZES = ["HU", "3-max", "4-max", "5-max", "6-max", "7-max", "8-max", "9-max", "10-max"] as const;

// Позиции зависят от размера стола: за 9-max их девять, за HU — две.
// Порядок — от самой ранней к самой поздней, как за столом.
export const POSITIONS_BY_TABLE: Record<string, readonly string[]> = {
  HU: ["BTN", "BB"],
  "3-max": ["BTN", "SB", "BB"],
  "4-max": ["CO", "BTN", "SB", "BB"],
  "5-max": ["HJ", "CO", "BTN", "SB", "BB"],
  "6-max": ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  "7-max": ["UTG", "UTG+1", "HJ", "CO", "BTN", "SB", "BB"],
  "8-max": ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  "9-max": ["UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"],
  "10-max": ["UTG", "UTG+1", "UTG+2", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"],
};
// все позиции скопом — когда стол ещё не выбран
export const ALL_POSITIONS = ["UTG", "UTG+1", "UTG+2", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"] as const;

export function positionsFor(tableSize?: string): readonly string[] {
  return (tableSize && POSITIONS_BY_TABLE[tableSize]) || ALL_POSITIONS;
}

export const ACTIONS_SITUATION = ["RFI", "vs опен", "vs 3-bet", "vs 4-bet", "сквиз", "защита BB", "пуш/фолд"] as const;
