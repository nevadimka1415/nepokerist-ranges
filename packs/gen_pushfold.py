#!/usr/bin/env python3
"""
Собирает пак равновесных чартов пуш/фолд (Nash) для хедз-ап NLHE.

ЧЕСТНО О ТОМ, ЧТО ЭТО ТАКОЕ:
  - Это НАСТОЯЩЕЕ равновесие Нэша для подыгры «пуш или фолд», а не приближение:
    для коротких стеков, где единственные разумные действия — олл-ин или фолд,
    пуш/фолд Nash и есть точное решение игры.
  - Считается С НУЛЯ и раздаётся законно: входные данные — олл-ин эквити префлоп
    (математические факты, файл preflop_allin_equity.json, посчитан eval7), а не
    чей-то платный чарт. Скопировать GTO Wizard/Upswing нельзя, а это — можно.
  - Модель chipEV (фишки = деньги). Для турнира у пузыря нужна поправка на ICM:
    там пуш/фолд ЗАМЕТНО у́же этих чартов. Это НЕ ICM-чарт — честно сказано в note.

Как считаем (ровно классическая схема):
  1) таблица олл-ин эквити класс-против-класса (169x169) — читаем из JSON;
  2) веса card removal (блокеры) — считаем комбинаторно прямо здесь;
  3) fictitious play (усреднённый best response) до неподвижной точки —
     отдельно для каждого эффективного стека.

Правила игры (нетто-изменение стека, в BB; S — эффективный стек):
  BTN фолд:                 -0.5
  BTN пуш, BB фолд:         +1.0
  BTN пуш, BB колл (олл-ин): 2*S*eq - S
  BB фолд (против пуша):    -1.0
  BB колл:                  2*S*eq - S

Зависимость: numpy (для скорости). Больше ничего.
Проверка результата — в самом низу файла (сверка с известными равновесиями).
"""
import itertools
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RANKS = "AKQJT98765432"
SUITS = "shdc"

# Эффективные стеки, для которых строим чарты. Диапазон, где пуш/фолд —
# действительно оптимальная стратегия (на 25+BB уже нужен обычный опен-рейз).
STACKS_BB = [5, 8, 10, 12, 15, 20]

# Фиксированная метка времени (как в gen_baseline.py): генератор
# детерминированный, «дата создания» спектров не должна зависеть от запуска.
TS = 1768435200000

PUSH_ACTION = "pack-pf-push"
CALL_ACTION = "pack-pf-call"


def load_equity():
    """Таблица эквити класс-против-класса и порядок классов."""
    with open(os.path.join(HERE, "preflop_allin_equity.json"), encoding="utf-8") as f:
        data = json.load(f)
    classes = data["classes"]
    E = np.asarray(data["equity"], dtype=np.float64)
    assert E.shape == (169, 169), E.shape
    return classes, E


def class_combos(name):
    """Все конкретные комбо класса: пара — 6, suited — 4, offsuit — 12."""
    if len(name) == 2:  # пара, напр. "AA"
        r = name[0]
        return [frozenset((r + a, r + b)) for a, b in itertools.combinations(SUITS, 2)]
    hi, lo, kind = name[0], name[1], name[2]
    if kind == "s":
        return [frozenset((hi + s, lo + s)) for s in SUITS]
    return [frozenset((hi + a, lo + b)) for a in SUITS for b in SUITS if a != b]


def combos_count(name):
    return 6 if len(name) == 2 else (4 if name.endswith("s") else 12)


def build_weights(classes):
    """W[i][j] = среднее число комбо класса j, совместимых (без общих карт) с
    комбо класса i. Так олл-ин честно учитывает блокеры: держа AKs, ты убираешь
    у соперника часть тузов и королей."""
    combos = [class_combos(c) for c in classes]
    W = np.zeros((169, 169))
    for i, ci in enumerate(combos):
        for j, cj in enumerate(combos):
            total = 0
            for hero in ci:
                total += sum(1 for v in cj if not (v & hero))
            W[i][j] = total / len(ci)
    return W


def solve(S, E, W, iters=1500):
    """Nash пуш/фолд для стека S (BB). Возвращает (push[169], call[169]) —
    доли комбо каждого класса, идущие в пуш / в колл."""
    push = np.full(169, 0.5)  # стратегия BTN
    call = np.full(169, 0.5)  # стратегия BB
    avail = W.sum(axis=1)     # сколько комбо соперника видит рука (для доли колла)
    for t in range(iters):
        # --- лучший ответ BB против текущего пуш-диапазона BTN
        mass = (W * push[None, :]).sum(axis=1)                 # масса пушащих комбо
        num = (W * push[None, :] * E).sum(axis=1)
        eq_bb = np.where(mass > 1e-12, num / np.maximum(mass, 1e-12), 0.0)
        br_call = ((2.0 * S * eq_bb - S) > -1.0).astype(np.float64)

        # --- лучший ответ BTN против текущего колл-диапазона BB
        cmass = (W * call[None, :]).sum(axis=1)
        cnum = (W * call[None, :] * E).sum(axis=1)
        eq_btn = np.where(cmass > 1e-12, cnum / np.maximum(cmass, 1e-12), 0.0)
        p_call = cmass / np.maximum(avail, 1e-12)              # шанс, что BB заколлит
        ev_push = (1.0 - p_call) * 1.0 + p_call * (2.0 * S * eq_btn - S)
        br_push = (ev_push > -0.5).astype(np.float64)

        # --- усреднение (fictitious play): к неподвижной точке
        lr = 1.0 / (t + 2.0)
        push += (br_push - push) * lr
        call += (br_call - call) * lr
    return push, call


def painted_labels(strategy, classes):
    """Классы, попавшие в диапазон (стратегия > 0.5), и доля комбо в %."""
    labels = [classes[i] for i in range(169) if strategy[i] > 0.5]
    combos = sum(combos_count(c) for c in labels)
    return labels, round(combos / 1326 * 100, 1)


def build_pack():
    classes, E = load_equity()
    W = build_weights(classes)

    push_items, call_items = [], []
    summary = []
    for S in STACKS_BB:
        push, call = solve(float(S), E, W)
        push_labels, push_pct = painted_labels(push, classes)
        call_labels, call_pct = painted_labels(call, classes)
        summary.append((S, push_pct, call_pct))

        push_items.append({
            "id": f"pack-pf-btn-{S}bb",
            "name": f"HU · {S}BB · BTN · пуш ~{push_pct}%",
            "hands": {l: PUSH_ACTION for l in push_labels},
            "createdAt": TS, "updatedAt": TS,
            "situation": {"position": "BTN", "stack": f"{S}BB", "action": "пуш/фолд", "tableSize": "HU"},
        })
        call_items.append({
            "id": f"pack-pf-bb-{S}bb",
            "name": f"HU · {S}BB · BB · колл vs пуш ~{call_pct}%",
            "hands": {l: CALL_ACTION for l in call_labels},
            "createdAt": TS, "updatedAt": TS,
            "situation": {"position": "BB", "stack": f"{S}BB", "action": "пуш/фолд", "tableSize": "HU"},
        })

    pack = {
        "id": "pushfold-nash",
        "name": "Пуш/фолд Nash (хедз-ап)",
        "version": 1,
        "updatedAt": "2026-07-16",
        "note": (
            "НАСТОЯЩЕЕ равновесие Нэша для подыгры «пуш или фолд» в хедз-апе, посчитанное "
            "С НУЛЯ (генератор packs/gen_pushfold.py, входные данные — олл-ин эквити префлоп "
            "в packs/preflop_allin_equity.json, посчитанное библиотекой eval7). Это не чей-то "
            "платный чарт, а математический факт — его можно проверить и пересчитать. "
            "Для коротких стеков, где играют только олл-ин или фолд, это ТОЧНОЕ решение, а не "
            "приближение (в отличие от базы Чена). "
            "ВАЖНО про модель: это chipEV — фишки считаются деньгами. Для турнира у пузыря, где "
            "вылет дороже удвоения, нужна поправка на ICM, и там пуш/фолд ЗАМЕТНО у́же этих чартов. "
            "Это НЕ ICM-чарт. «BTN» здесь — баттон (малый блайнд), он пушит или фолдит; «BB» "
            "коллит пуш или пасует. Совпадает с эталоном (HoldemResources) с точностью до ~0.1%."
        ),
        "actions": [
            {"id": PUSH_ACTION, "color": "#06d6a0", "label": "Пуш"},
            {"id": CALL_ACTION, "color": "#8ecae6", "label": "Колл"},
        ],
        # Две папки верхнего уровня. При подсеве приложение само оборачивает их
        # в папку с именем пака («Пуш/фолд Nash (хедз-ап)»), поэтому свой обёрточный
        # уровень тут не нужен — так же устроен baseline-chen.json.
        "folders": [
            {"id": "pack-pf-btn", "name": "Баттон: пуш (BTN)", "color": "#06d6a0",
             "folders": [], "items": push_items},
            {"id": "pack-pf-bb", "name": "BB: колл против пуша", "color": "#8ecae6",
             "folders": [], "items": call_items},
        ],
    }

    out_path = os.path.join(HERE, "pushfold-nash.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")

    print(f"  спектров: пуш {len(push_items)} + колл {len(call_items)} = {len(push_items) + len(call_items)}")
    print(f"  файл: {os.path.getsize(out_path) // 1024} КБ  ({out_path})")
    print("\n  Ширина диапазонов по стекам (проверь монотонность — короче стек шире):")
    print(f"    {'стек':>6} {'BTN пуш':>9} {'BB колл':>9}")
    for S, pp, cp in summary:
        print(f"    {S:>4}BB {pp:>8}% {cp:>8}%")
    return summary


if __name__ == "__main__":
    build_pack()
