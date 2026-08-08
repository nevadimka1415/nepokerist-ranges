// Модель рук и спектров: кодировка клетки, разбор и сборка строки диапазона,
// отпечаток содержимого.
//
// Вынесено из main.tsx 08.08.2026. Самая ответственная часть проекта: тут ошибка
// не падает, а МОЛЧА портит сохранённые спектры — человек увидит это когда-нибудь
// потом, открыв свою же работу и не найдя половину рук. Поэтому здесь тесты
// проверяют главное свойство: закодировали → раскодировали → получили то же самое.
//
// Кодировка клетки совместима со старой: части разделены "||", вес пишется
// суффиксом "w:NN" и только когда отличается от значения по умолчанию.

type HandActionMap = Record<string, string>;

// Ранги от старшего к младшему. Дублируется в main.tsx как `ranks` — модель не должна
// зависеть от файла интерфейса, а список это константа правил игры, а не настройка.
const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

const HAND_SPLIT_SEPARATOR = "||";

export type DecodedHandAction = {
  primaryId: string | null;
  secondaryId: string | null;
  // Доля основного действия (0..1). Смешанные частоты: «рейз 70% / фолд 30%»
  // или «рейз 70% / колл 30%». Дефолт: одиночное действие = 1, сплит = 0.5.
  weight: number;
};

// Кодировка руки, совместимая со старой: части разделены "||".
//   "a"            → действие a на 100%
//   "a||b"         → сплит a/b поровну (50/50)
//   "a||w:70"      → a на 70%, остальное фолд
//   "a||b||w:70"   → a на 70%, b на 30%
// Вес храним только когда он отличается от дефолта — старые записи не меняются.
export function decodeHandAction(value: unknown): DecodedHandAction {
  if (!value) return { primaryId: null, secondaryId: null, weight: 1 };
  const parts = String(value).split(HAND_SPLIT_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  const ids: string[] = [];
  let weight: number | null = null;
  for (const part of parts) {
    if (part.startsWith("w:")) {
      const n = Number(part.slice(2));
      if (isFinite(n)) weight = Math.max(0, Math.min(100, n)) / 100;
    } else {
      ids.push(part);
    }
  }
  const primaryId = ids[0] || null;
  const secondaryId = ids[1] || null;
  if (!primaryId) return { primaryId: null, secondaryId: null, weight: 1 };
  const resolvedWeight = weight != null ? weight : secondaryId ? 0.5 : 1;
  return { primaryId, secondaryId, weight: resolvedWeight };
}

export function encodeHandAction(primaryId: string | null | undefined, secondaryId?: string | null, weight?: number | null) {
  const primary = primaryId?.trim();
  if (!primary) return "";
  const secondary = secondaryId?.trim();
  const hasSecondary = !!secondary && secondary !== primary;
  const parts = [primary];
  if (hasSecondary) parts.push(secondary!);
  if (weight != null) {
    const w = Math.max(0, Math.min(1, weight));
    const defaultW = hasSecondary ? 0.5 : 1;
    if (Math.abs(w - defaultW) > 0.005) parts.push(`w:${Math.round(w * 100)}`);
  }
  return parts.join(HAND_SPLIT_SEPARATOR);
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

export function parseEquilabLikeRange(input: string) {
  // ⚠️ Регистр: ранги пишем заглавными (A, K, T), а суффиксы масти — строчными
  // (s = suited, o = offsuit), потому что именно так их ждут проверки ниже.
  // Раньше здесь стоял просто toUpperCase() — и «A2s+» превращалось в «A2S+»,
  // которое не подходило ни под один шаблон. Молча отбрасывалось ВСЁ, кроме пар:
  // вставленный из Equilab диапазон «77+, A9s+, KTo+» доезжал как одни только пары.
  // Букв S и O среди рангов нет, поэтому обратная замена безопасна.
  const tokens = input
    .toUpperCase()
    .replace(/S/g, "s")
    .replace(/O/g, "o")
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

// Компактная строка диапазона в стиле Equilab из набора рук: пары → «TT+»/«99-22»,
// одномастные/разномастные с одним старшим → «A2s+»/«KTo+». Не идеально минимальна,
// но читаема и однозначно парсится обратно parseEquilabLikeRange.
export function labelsToRangeString(labels: string[]): string {
  const set = new Set(labels);
  const order = "AKQJT98765432";
  const idx = (r: string) => order.indexOf(r);
  const parts: string[] = [];

  // Пары — группируем по силе в непрерывные диапазоны.
  const pairs = order.split("").filter((r) => set.has(r + r));
  let k = 0;
  while (k < pairs.length) {
    let m = k;
    while (m + 1 < pairs.length && idx(pairs[m + 1]) === idx(pairs[m]) + 1) m += 1;
    const hi = pairs[k];
    const lo = pairs[m];
    if (k === m) parts.push(hi + hi);
    else if (idx(hi) === 0) parts.push(lo + lo + "+"); // непрерывно до тузов → «TT+»
    else parts.push(hi + hi + "-" + lo + lo);
    k = m + 1;
  }

  // Непары — для каждого старшего ранга и типа (s/o) группируем по кикеру.
  for (const suit of ["s", "o"] as const) {
    for (const hi of order) {
      const kickers = order.split("").filter((lo) => idx(lo) > idx(hi) && set.has(hi + lo + suit));
      let a = 0;
      while (a < kickers.length) {
        let b = a;
        while (b + 1 < kickers.length && idx(kickers[b + 1]) === idx(kickers[b]) + 1) b += 1;
        const kHi = kickers[a];
        const kLo = kickers[b];
        if (a === b) parts.push(hi + kHi + suit);
        else if (idx(kHi) === idx(hi) + 1) parts.push(hi + kLo + suit + "+"); // до старшего кикера → «A2s+»
        else parts.push(hi + kHi + suit + "-" + hi + kLo + suit);
        a = b + 1;
      }
    }
  }
  return parts.join(", ");
}

// Отпечаток содержимого спектра. Нужен, чтобы отличить «человек не трогал»
// от «человек поправил под себя»: первое можно обновлять из пака, второе — нет.
export function handsFingerprint(hands: HandActionMap): string {
  // ключи сортируем: порядок в объекте не гарантирован, иначе отпечаток поплывёт
  const source = Object.keys(hands || {})
    .sort()
    .map((key) => `${key}:${hands[key]}`)
    .join("|");
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return String(hash);
}
