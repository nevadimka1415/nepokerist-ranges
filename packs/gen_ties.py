#!/usr/bin/env python3
"""Догоняет к таблице эквити долю НИЧЬИХ (tie) — для колонок Wins/Splits/Losses.

Само эквити (win + tie/2) уже посчитано и сверено в preflop_allin_equity.json
(gen_equity.py, 30k досок) — его НЕ трогаем. Здесь считаем только долю ничьих на
матчап класс-против-класса методом Монте-Карло. Ничьих на вскрытии обычно мало,
и точности хватает меньшей, поэтому это быстро. Разложение потом:
    win  = eq − tie/2 ,   loss = 1 − eq − tie/2 .

Запуск:  python gen_ties.py            (несколько минут; удобно в фоне)
Env:     GEN_TIES_K      — сэмплов на пару (деф. 1500)
         GEN_TIES_PAIRS  — лимит пар (для бенчмарка времени; 0 = все 14365)
Итог пишется в preflop_allin_equity.json.new (перезапись основного — вручную после сверки).
"""
import itertools
import json
import os
import random
import time

import eval7
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RANKS = "23456789TJQKA"
SUITS = "cdhs"
K = int(os.environ.get("GEN_TIES_K", "1500"))
PAIRS_LIMIT = int(os.environ.get("GEN_TIES_PAIRS", "0"))  # 0 = все


def combo_to_class(combo):
    a, b = combo
    ra, rb = RANKS[a.rank], RANKS[b.rank]
    if a.rank < b.rank:
        ra, rb = rb, ra
    if a.rank == b.rank:
        return ra + rb
    return ra + rb + ("s" if a.suit == b.suit else "o")


def main():
    src = os.path.join(HERE, "preflop_allin_equity.json")
    data = json.load(open(src, encoding="utf-8"))
    classes = data["classes"]
    E = np.array(data["equity"], dtype=float)
    assert len(classes) == 169, "ожидалось 169 классов"
    cls_idx = {c: i for i, c in enumerate(classes)}

    deck = [eval7.Card(r + s) for r in RANKS for s in SUITS]
    combos = list(itertools.combinations(deck, 2))
    assert len(combos) == 1326
    cls_combos = [[] for _ in range(169)]
    for c in combos:
        cls_combos[cls_idx[combo_to_class(c)]].append(c)

    ev = eval7.evaluate
    rnd = random.Random(12345)
    T = np.zeros((169, 169))

    pairs = [(i, j) for i in range(169) for j in range(i, 169)]
    if PAIRS_LIMIT:
        pairs = pairs[:PAIRS_LIMIT]
    total = len(pairs)
    t0 = time.time()

    for n, (i, j) in enumerate(pairs):
        hi = cls_combos[i]
        vj = cls_combos[j]
        ties = 0
        done = 0
        for _ in range(K):
            h = rnd.choice(hi)
            v = None
            for _try in range(10):
                cand = rnd.choice(vj)
                if cand[0] not in h and cand[1] not in h:
                    v = cand
                    break
            if v is None:
                continue
            used = (h[0], h[1], v[0], v[1])
            board = rnd.sample([c for c in deck if c not in used], 5)
            if ev([h[0], h[1]] + board) == ev([v[0], v[1]] + board):
                ties += 1
            done += 1
        t = ties / done if done else 0.0
        T[i][j] = t
        T[j][i] = t
        if n % 500 == 0:
            el = time.time() - t0
            proj = el / max(n, 1) * total
            print(f"  {n}/{total} пар, {el:.0f}s, прогноз ~{proj:.0f}s", flush=True)

    T = np.round(T, 4)
    data["equity"] = E.round(4).tolist()  # без изменений, для чистоты формата
    data["tie"] = T.tolist()
    data["_note_tie"] = (
        f"tie[i][j] — доля ничьих класса i против j на олл-ин вскрытии (Монте-Карло "
        f"{K} сэмплов/пара, gen_ties.py). Разложение: win = eq − tie/2, loss = 1 − eq − tie/2."
    )
    out = src + ".new"
    with open(out, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

    # контроль: ничьих много там, где чоп ожидаем; мало там, где нет
    for a, b in [("AA", "KK"), ("AA", "AA"), ("AKo", "AKo"), ("72o", "72o"), ("JTs", "JTs")]:
        print(f"  tie {a} vs {b}: {T[cls_idx[a]][cls_idx[b]]:.4f}", flush=True)
    print(f"готово -> {out}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
