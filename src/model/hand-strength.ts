// Сила стартовой руки по формуле Чена и порядок всех 169 рук.
//
// Вынесено из main.tsx 08.08.2026. Это приближение, а не эквити-рейтинг: формула
// общепринятая, проверяемая и совпадает с генератором baseline-пака — важно, чтобы
// ползунок «топ N% рук» и содержимое паков говорили об одном и том же порядке.
// Оценка стартовой руки по формуле Чена — для ползунка «топ N% рук» (шкала как
// в Equilab). Та же формула, что и в генераторе baseline-пака, чтобы порядок
// рук совпадал. Приближение (не эквити-рейтинг), но общепринятое и проверяемое.
const CHEN_BASE: Record<string, number> = { A: 10, K: 8, Q: 7, J: 6, T: 5, "9": 4.5, "8": 4, "7": 3.5, "6": 3, "5": 2.5, "4": 2, "3": 1.5, "2": 1 };
export function chenScore(label: string): number {
  const hi = label[0];
  const lo = label[1];
  const base = CHEN_BASE[hi] ?? 1;
  if (label.length === 2) return Math.max(base * 2, 5); // пара
  let score = base;
  if (label.endsWith("s")) score += 2;
  const order = "AKQJT98765432";
  const gap = Math.abs(order.indexOf(hi) - order.indexOf(lo)) - 1;
  score -= ({ 0: 0, 1: 1, 2: 2, 3: 4 } as Record<number, number>)[gap] ?? 5;
  if (gap <= 1 && order.indexOf(hi) > order.indexOf("Q") && order.indexOf(lo) > order.indexOf("Q")) score += 1;
  return Math.ceil(score);
}
export function comboCountForLabel(label: string): number {
  return label.length === 2 ? 6 : label.endsWith("s") ? 4 : 12;
}
// 169 рук, отсортированы по силе (Чен) по убыванию — считаем один раз.
export const RANKED_HANDS_BY_STRENGTH: string[] = (() => {
  const order = "AKQJT98765432".split("");
  const all: Array<{ label: string; score: number; combos: number }> = [];
  for (let i = 0; i < 13; i += 1) {
    for (let j = 0; j < 13; j += 1) {
      const a = order[i];
      const b = order[j];
      const label = i === j ? a + b : i < j ? a + b + "s" : b + a + "o";
      all.push({ label, score: chenScore(label), combos: comboCountForLabel(label) });
    }
  }
  all.sort((x, y) => y.score - x.score || y.combos - x.combos);
  return all.map((h) => h.label);
})();
