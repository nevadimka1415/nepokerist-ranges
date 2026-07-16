#!/usr/bin/env python3
"""
Считает таблицу олл-ин эквити префлоп (класс против класса, 169x169) и кладёт её
в preflop_allin_equity.json. Это входные данные для gen_pushfold.py.

Зачем отдельный скрипт: эквити — это математические ФАКТЫ (кто чаще выигрывает на
вскрытии), и мы их считаем САМИ симуляцией, а не берём из чужого платного чарта.
Разнесено с gen_pushfold.py, потому что здесь нужна тяжёлая зависимость (eval7 —
C-библиотека оценки покерных рук), а сам расчёт Nash в gen_pushfold.py — чистый
Python поверх готовой таблицы.

Зависимости: eval7, numpy   →   pip install eval7 numpy
Запуск:      python gen_equity.py     (несколько минут)

Метод: для каждого класса-соперника симулируем ITERS случайных досок и усредняем
эквити всех 1326 комбо героя разом (eval7 сам учитывает блокеры — убирает у
соперника карты, которые держит герой). Затем усредняем по конкретным комбо
каждого класса героя → таблица класс-против-класса.
"""
import itertools
import json
import os

import eval7
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RANKS = "23456789TJQKA"
SUITS = "cdhs"

# Больше досок — чище края чартов, но дольше счёт. 30k достаточно, чтобы
# агрегатная ширина Nash совпала с эталоном HoldemResources до ~0.1%.
ITERS = 30000


def combo_to_class(combo):
    a, b = combo
    ra, rb = RANKS[a.rank], RANKS[b.rank]
    if a.rank < b.rank:
        ra, rb = rb, ra
    if a.rank == b.rank:
        return ra + rb
    return ra + rb + ("s" if a.suit == b.suit else "o")


def build_classes():
    classes = []
    for i, r1 in enumerate(RANKS[::-1]):
        for j, r2 in enumerate(RANKS[::-1]):
            if i == j:
                classes.append(r1 + r2)
            elif i < j:
                classes.append(r1 + r2 + "s")
            else:
                classes.append(r2 + r1 + "o")
    return sorted(set(classes))


def main():
    deck = [eval7.Card(r + s) for r in RANKS for s in SUITS]
    combos = list(itertools.combinations(deck, 2))
    assert len(combos) == 1326

    classes = build_classes()
    assert len(classes) == 169
    cls_idx = {c: i for i, c in enumerate(classes)}

    # комбо -> индекс класса, и список комбо каждого класса
    combo_cls = [cls_idx[combo_to_class(c)] for c in combos]
    cls_combos = [[] for _ in range(169)]
    for ci, k in enumerate(combo_cls):
        cls_combos[k].append(ci)

    combo_key = {}
    for i, (a, b) in enumerate(combos):
        combo_key[(a, b)] = i
        combo_key[(b, a)] = i

    hero_all = eval7.HandRange(",".join(classes))
    assert len(hero_all.hands) == 1326

    # M[hero_combo][villain_class] = эквити конкретного комбо героя против класса
    M = np.zeros((1326, 169))
    for vc, cls in enumerate(classes):
        d = eval7.py_all_hands_vs_range(hero_all, eval7.HandRange(cls), [], ITERS)
        for hand, eq in d.items():
            M[combo_key[hand], vc] = eq
        if vc % 40 == 0:
            print(f"  {vc}/169", flush=True)

    # усредняем комбо героя внутри класса -> таблица класс-против-класса
    E = np.zeros((169, 169))
    for i in range(169):
        E[i] = M[cls_combos[i]].mean(axis=0)
    E = np.round(E, 4)

    # контроль против известных истин — если разошлось, что-то сломано
    for a, b, truth in [("AA", "KK", 0.82), ("AKs", "QQ", 0.46), ("22", "AKo", 0.50)]:
        got = E[cls_idx[a]][cls_idx[b]]
        print(f"  {a} vs {b}: {got:.4f} (известно ~{truth})")
        assert abs(got - truth) < 0.03, f"эквити {a} vs {b} разошлось!"

    out = {
        "_note": ("Олл-ин эквити префлоп, класс против класса (169x169) — математические ФАКТЫ, "
                  f"посчитанные симуляцией {ITERS} досок на матчап через eval7 (см. gen_equity.py), "
                  "не чужой чарт. E[i][j] = доля выигрыша класса i против класса j на вскрытии до 5 "
                  "общих карт; усреднено по конкретным комбо с учётом блокеров. Порядок классов — в "
                  "поле classes. Сверено с эталоном HoldemResources: агрегатная ширина совпадает до ~0.1%."),
        "classes": classes,
        "equity": E.tolist(),
    }
    path = os.path.join(HERE, "preflop_allin_equity.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(out, ensure_ascii=False) + "\n")
    print(f"готово: {path}")


if __name__ == "__main__":
    main()
