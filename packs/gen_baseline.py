#!/usr/bin/env python3
"""
Собирает базовый пак спектров по формуле Чена (Bill Chen, "The Mathematics of Poker").

ЧЕСТНО О ТОМ, ЧТО ЭТО ТАКОЕ:
  - ОРИЕНТИР для старта, а не решение солвера и не чей-то личный спектр;
  - формула Чена — упрощённая модель, грубее современного GTO;
  - частоты открытия по позициям — типовые ориентиры, а не догма.
Все оговорки дублируются в note пака, чтобы никто не принял ориентир за истину.

Что генерим:
  1) RFI для всех столов (HU..10-max) и всех позиций, кроме BB — 45 спектров;
  2) справочные «Топ X%» — чисто определительные наборы, полезны как заготовки.
"""
import json
import math

RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]
BASE = {"A": 10, "K": 8, "Q": 7, "J": 6, "T": 5, "9": 4.5, "8": 4,
        "7": 3.5, "6": 3, "5": 2.5, "4": 2, "3": 1.5, "2": 1}
ORDER = {r: i for i, r in enumerate(RANKS)}


def chen_score(hi, lo, suited):
    score = BASE[hi]
    if hi == lo:
        return max(score * 2, 5)
    if suited:
        score += 2
    gap = abs(ORDER[hi] - ORDER[lo]) - 1
    score -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    if gap <= 1 and ORDER[hi] > ORDER["Q"] and ORDER[lo] > ORDER["Q"]:
        score += 1
    return math.ceil(score)


def all_hands():
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


RANKED = sorted(all_hands(), key=lambda h: (-h[2], -h[1]))


def top_by_percent(pct):
    target = 1326 * pct / 100
    picked, combos = [], 0
    for label, c, _ in RANKED:
        if combos + c > target and picked:
            break
        picked.append(label)
        combos += c
    return picked, combos


POSITIONS_BY_TABLE = {
    "HU": ["BTN", "BB"],
    "3-max": ["BTN", "SB", "BB"],
    "4-max": ["CO", "BTN", "SB", "BB"],
    "5-max": ["HJ", "CO", "BTN", "SB", "BB"],
    "6-max": ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
    "7-max": ["UTG", "UTG+1", "HJ", "CO", "BTN", "SB", "BB"],
    "8-max": ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
    "9-max": ["UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"],
    "10-max": ["UTG", "UTG+1", "UTG+2", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"],
}

# Ширина опена от числа игроков ПОЗАДИ. Чем больше рук ещё скажут своё слово,
# тем уже открываем. Ориентиры, а не догма.
BY_BEHIND = {1: 40, 2: 45, 3: 26, 4: 19, 5: 15, 6: 13, 7: 12, 8: 11, 9: 10}


def open_percent(table, pos):
    order = POSITIONS_BY_TABLE[table]
    idx = order.index(pos)
    behind = len(order) - 1 - idx
    if table == "HU":
        return 85          # хедз-ап баттон открывает почти всё
    if pos == "SB":
        return 40          # позади один, но постфлоп без позиции
    return BY_BEHIND.get(behind, 10)


RAISE = "pack-baseline-raise"
TS = 1768435200000

rfi_items = []
for table, order in POSITIONS_BY_TABLE.items():
    for pos in order:
        if pos == "BB":
            continue        # BB не открывает — там защита, а это другая история
        pct = open_percent(table, pos)
        labels, combos = top_by_percent(pct)
        real = round(combos / 1326 * 100, 1)
        rfi_items.append({
            "id": f"pack-baseline-rfi-{table}-{pos}".lower().replace("+", "plus"),
            "name": f"{table} · {pos} · RFI ~{real}%",
            "hands": {l: RAISE for l in labels},
            "createdAt": TS, "updatedAt": TS,
            "situation": {"position": pos, "stack": "100+BB", "action": "RFI", "tableSize": table},
        })

top_items = []
for pct in [5, 10, 15, 20, 25, 30, 40, 50, 60]:
    labels, combos = top_by_percent(pct)
    real = round(combos / 1326 * 100, 1)
    top_items.append({
        "id": f"pack-baseline-top-{pct}",
        "name": f"Топ {real}% рук",
        "hands": {l: RAISE for l in labels},
        "createdAt": TS, "updatedAt": TS,
    })

pack = {
    "id": "baseline-chen",
    "name": "База (формула Чена)",
    "version": 2,
    "updatedAt": "2026-07-15",
    "note": ("ОРИЕНТИР ДЛЯ СТАРТА, не GTO и не чей-то личный спектр. Собрано по формуле Чена "
             "(Bill Chen, The Mathematics of Poker) — опубликованной эвристике оценки стартовых рук; "
             "генератор лежит в packs/gen_baseline.py, всё можно пересчитать и проверить. "
             "Ограничения, о которых честно: (1) формула проще современного GTO — например, "
             "недооценивает младшие одномастные тузы (A5s), которые открывают ради блокеров; "
             "(2) спектры строго вложены (BTN включает CO и т.д.), потому что все они — верхушка "
             "одного рейтинга, а в реальной игре позиции так не соотносятся; (3) частоты опена — "
             "типовые ориентиры; (4) стек указан 100+BB: на глубоких стеках префлоп-решения почти "
             "не зависят от глубины, поэтому 100, 200 и 1000ББ — одна корзина. Правь под себя."),
    "actions": [{"id": RAISE, "color": "#ef476f", "label": "Рейз"}],
    "folders": [
        {"id": "pack-baseline-rfi", "name": "RFI по столам и позициям (100+BB)",
         "color": "#06d6a0", "folders": [], "items": rfi_items},
        {"id": "pack-baseline-top", "name": "Справочник: топ X% рук",
         "color": "#8ecae6", "folders": [], "items": top_items},
    ],
}

open("repo/packs/baseline-chen.json", "w", encoding="utf-8").write(
    json.dumps(pack, ensure_ascii=False, indent=2) + "\n")

print(f"  RFI-спектров      : {len(rfi_items)}")
print(f"  справочных Топ X% : {len(top_items)}")
print(f"  всего             : {len(rfi_items) + len(top_items)}")
print("\n  Примеры ширины опена:")
for t in ["HU", "6-max", "9-max"]:
    row = [f"{i['situation']['position']}={i['name'].split('~')[1]}" for i in rfi_items
           if i["situation"]["tableSize"] == t]
    print(f"   {t:<7} {' '.join(row)}")
