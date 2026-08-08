// Модель рук и спектров. Здесь ошибка не падает, а молча портит сохранённое —
// поэтому главная проверка не «работает ли функция», а «переживают ли данные
// круг: закодировали → раскодировали → то же самое».
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeHandAction,
  encodeHandAction,
  handsFingerprint,
  labelsToRangeString,
  parseEquilabLikeRange,
} from "../../src/model/hands.ts";

test("одно действие в клетке: туда и обратно", () => {
  const код = encodeHandAction("raise");
  const d = decodeHandAction(код);
  assert.equal(d.primaryId, "raise");
  assert.equal(d.secondaryId, null);
  assert.equal(d.weight, 1, "одиночное действие занимает клетку целиком");
});

test("сплит двух действий: туда и обратно", () => {
  const d = decodeHandAction(encodeHandAction("raise", "call"));
  assert.equal(d.primaryId, "raise");
  assert.equal(d.secondaryId, "call");
  assert.equal(d.weight, 0.5, "сплит без указания веса — пополам");
});

test("смешанная частота сохраняется", () => {
  for (const вес of [0.25, 0.5, 0.7, 0.9]) {
    const d = decodeHandAction(encodeHandAction("raise", "call", вес));
    assert.equal(d.primaryId, "raise");
    assert.ok(Math.abs(d.weight - вес) < 0.011, `вес ${вес} должен пережить круг, а стал ${d.weight}`);
  }
});

test("совместимость со старым форматом: клетка без веса читается как раньше", () => {
  // Так спектры лежат в браузере у людей с прошлых версий — формат менять нельзя.
  const старое = "raise||call";
  const d = decodeHandAction(старое);
  assert.equal(d.primaryId, "raise");
  assert.equal(d.secondaryId, "call");
  assert.equal(d.weight, 0.5);
});

test("пустое значение — пустая клетка", () => {
  for (const пусто of ["", null, undefined, 0]) {
    const d = decodeHandAction(пусто);
    assert.equal(d.primaryId, null, `${JSON.stringify(пусто)} должно давать пустую клетку`);
    assert.equal(d.weight, 1);
  }
});

test("испорченное значение не роняет разбор", () => {
  // В хранилище может оказаться что угодно (правили руками, сбой браузера).
  // Требование скромное, но важное: не падать. Такая клетка станет ссылкой на
  // несуществующее действие и отрисуется пустой, но соседние спектры уцелеют.
  for (const мусор of [42, {}, [], true]) {
    const d = decodeHandAction(мусор);
    assert.equal(typeof d.weight, "number", `на ${JSON.stringify(мусор)} вес обязан остаться числом`);
    assert.ok("primaryId" in d && "secondaryId" in d, "форма ответа не должна меняться");
  }
});

test("отпечаток спектра не зависит от порядка ключей", () => {
  const а = { AA: "raise", KK: "call", QQ: "raise" };
  const б = { QQ: "raise", AA: "raise", KK: "call" };
  assert.equal(handsFingerprint(а), handsFingerprint(б), "порядок в объекте не гарантирован — отпечаток обязан быть тот же");
});

test("отпечаток меняется, если спектр правили", () => {
  const было = handsFingerprint({ AA: "raise", KK: "call" });
  assert.notEqual(было, handsFingerprint({ AA: "raise", KK: "raise" }), "сменилось действие");
  assert.notEqual(было, handsFingerprint({ AA: "raise" }), "убрали руку");
});

test("строка диапазона: пары", () => {
  assert.deepEqual(parseEquilabLikeRange("TT+").hands.sort(), ["AA", "JJ", "KK", "QQ", "TT"]);
  assert.deepEqual(parseEquilabLikeRange("99-77").hands.sort(), ["77", "88", "99"]);
  assert.deepEqual(parseEquilabLikeRange("AA").hands, ["AA"]);
});

test("строка диапазона: одномастные и разномастные", () => {
  // Раньше здесь молча терялось всё, кроме пар: ввод приводился к верхнему
  // регистру, а суффиксы масти проверялись строчными. Тест на регрессию.
  assert.equal(parseEquilabLikeRange("A2s+").hands.length, 12, "A2s+ — от A2s до AKs");
  assert.deepEqual(parseEquilabLikeRange("AKo").hands, ["AKo"]);
  assert.equal(parseEquilabLikeRange("AKs-A9s").hands.length, 5, "AKs, AQs, AJs, ATs, A9s");
  assert.deepEqual(parseEquilabLikeRange("A2s+").invalidTokens, [], "ничего не должно уйти в мусор");
});

test("строка диапазона: типичная вставка из Equilab целиком", () => {
  const r = parseEquilabLikeRange("77+, A9s+, KTs+, AJo+");
  // 8 пар (77…AA) + 5 одномастных с тузом + 3 с королём + 3 разномастных = 19
  assert.equal(r.hands.length, 19, `ожидали 19 рук, получили ${r.hands.length}: ${r.hands.join(" ")}`);
  assert.deepEqual(r.invalidTokens, []);
  assert.ok(r.hands.includes("AA") && r.hands.includes("AKs") && r.hands.includes("AJo"));
});

test("регистр ввода не важен: люди пишут как привыкли", () => {
  const как_попало = parseEquilabLikeRange("aKs, tt+, ajO").hands.sort();
  const канонично = parseEquilabLikeRange("AKs, TT+, AJo").hands.sort();
  assert.deepEqual(как_попало, канонично);
});

test("строка диапазона: сборка обратно сжимает в тот же вид", () => {
  const руки = parseEquilabLikeRange("TT+").hands;
  assert.equal(labelsToRangeString(руки), "TT+");
});

test("непонятные куски строки попадают в мусор, а не молча теряются", () => {
  const r = parseEquilabLikeRange("AA, ZZ, 77");
  assert.deepEqual(r.hands.sort(), ["77", "AA"]);
  assert.deepEqual(r.invalidTokens, ["ZZ"], "человек должен видеть, что именно не понято");
});
