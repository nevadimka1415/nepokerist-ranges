#!/usr/bin/env python3
"""
Собирает базовые RFI-спектры по формуле Чена (Bill Chen, "The Mathematics of Poker") —
опубликованной эвристике оценки стартовых рук.

ЧЕСТНО О ТОМ, ЧТО ЭТО ТАКОЕ:
  - это ОРИЕНТИР для старта, а не решение солвера и не чей-то личный спектр;
  - формула Чена — упрощённая модель, она заметно грубее современного GTO;
  - частоты открытия по позициям взяты как типовые для 6-max.
Всё это должно быть написано в названиях и примечаниях пака, чтобы никто
не принял ориентир за истину.
"""
import json

RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]
# ценность старшей карты по Чену
BASE = {"A": 10, "K": 8, "Q": 7, "J": 6, "T": 5, "9": 4.5, "8": 4,
        "7": 3.5, "6": 3, "5": 2.5, "4": 2, "3": 1.5, "2": 1}
ORDER = {r: i for i, r in enumerate(RANKS)}  # 0 = туз


def chen_score(hi: str, lo: str, suited: bool) -> float:
    """Формула Чена. hi/lo — ранги, hi не младше lo."""
    score = BASE[hi]
    if hi == lo:                      # пара: удваиваем, минимум 5
        return max(score * 2, 5)
    if suited:
        score += 2
    gap = abs(ORDER[hi] - ORDER[lo]) - 1
    score -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    # бонус за связанность: обе карты младше дамы и разрыв не больше одной
    if gap <= 1 and ORDER[hi] > ORDER["Q"] and ORDER[lo] > ORDER["Q"]:
        score += 1
    import math
    return math.ceil(score)


def all_hands():
    """169 стартовых рук: подпись, число комбинаций, оценка Чена."""
    out = []
    for i, r1 in enumerate(RANKS):
        for j, r2 in enumerate(RANKS):
            if i > j:
                continue
            if i == j:
                out.append((r1 + r2, 6, chen_score(r1, r2, False)))
            else:
                out.append((r1 + r2 + "s", 4, chen_score(r1, r2, True)))
                out.append((r1 + r2 + "o", 12, chen_score(r1, r2, False)))
    return out


def top_by_percent(pct: float):
    """Берём лучшие руки по Чену, пока не наберём нужный процент от 1326 комбинаций."""
    hands = sorted(all_hands(), key=lambda h: (-h[2], -h[1]))
    target = 1326 * pct / 100
    picked, combos = [], 0
    for label, c, score in hands:
        if combos + c > target and picked:
            break
        picked.append(label)
        combos += c
    return picked, combos


# Типовые частоты открытия для 6-max. Это ориентиры, а не догма.
POSITIONS = [
    ("UTG", 15, "Самая ранняя позиция: играем узко, позади много игроков"),
    ("HJ", 19, "На одного игрока позади меньше — можно чуть шире"),
    ("CO", 26, "Позади только баттон и блайнды"),
    ("BTN", 45, "Лучшая позиция: постфлоп всегда последний ход"),
    ("SB", 40, "Против одного игрока, но без позиции постфлоп"),
]

RAISE = "pack-baseline-raise"
TS = 1768435200000

items = []
for pos, pct, why in POSITIONS:
    labels, combos = top_by_percent(pct)
    real = round(combos / 1326 * 100, 1)
    items.append({
        "id": f"pack-baseline-rfi-{pos.lower()}",
        "name": f"RFI {pos} ~{real}%",
        "hands": {l: RAISE for l in labels},
        "createdAt": TS, "updatedAt": TS,
        "situation": {"position": pos, "stack": "100BB", "action": "RFI", "tableSize": "6-max"},
    })
    print(f"  {pos:<4} цель {pct}% -> вышло {real:>4}%  ({combos:>4} комбо, {len(labels):>3} рук)")

pack = {
    "id": "baseline-chen",
    "name": "База RFI (формула Чена)",
    "version": 1,
    "updatedAt": "2026-07-15",
    "note": ("ОРИЕНТИР ДЛЯ СТАРТА, не GTO и не чей-то личный спектр. Собрано по формуле Чена "
             "(Bill Chen, The Mathematics of Poker) — опубликованной эвристике оценки стартовых рук. "
             "Ограничения, о которых честно: (1) формула проще современного GTO и в мелочах с ним "
             "расходится — например, недооценивает младшие одномастные тузы (A5s), которые в реальных "
             "спектрах открывают ради блокеров; (2) спектры вышли строго вложенными "
             "(BTN включает CO, CO включает HJ и т.д.), потому что все они — верхушка одного и того же "
             "рейтинга, а в реальной игре позиции так не соотносятся; (3) SB здесь как обычный опен, "
             "без лимпа. Это отправная точка, чтобы не строить с нуля. Правь под себя."),
    "actions": [{"id": RAISE, "color": "#ef476f", "label": "Рейз"}],
    "folders": [{
        "id": "pack-baseline-rfi",
        "name": "RFI 6-max 100ББ (база)",
        "color": "#06d6a0",
        "folders": [],
        "items": items,
    }],
}

path = "repo/packs/baseline-chen.json"
open(path, "w", encoding="utf-8").write(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
print(f"\n  ✓ записано: {path}")

# показываем, что вышло, чтобы можно было глазами оценить осмысленность
for it in items:
    hs = list(it["hands"].keys())
    print(f"\n  {it['name']}:")
    print("   ", " ".join(hs[:26]) + (" ..." if len(hs) > 26 else ""))
