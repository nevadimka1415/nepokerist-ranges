// Порядок рук по силе. Он лежит в основе ползунка «топ N% рук», поэтому если
// порядок поедет, человек нальёт в спектр совсем не то, что собирался, — и
// заметит это только за столом.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chenScore, comboCountForLabel, RANKED_HANDS_BY_STRENGTH } from "../../src/model/hand-strength.ts";

test("в рейтинге ровно 169 рук и без повторов", () => {
  assert.equal(RANKED_HANDS_BY_STRENGTH.length, 169);
  assert.equal(new Set(RANKED_HANDS_BY_STRENGTH).size, 169, "каждая рука должна встречаться один раз");
});

test("сверху тузы, снизу мусор", () => {
  assert.equal(RANKED_HANDS_BY_STRENGTH[0], "AA", "первой обязана идти AA");
  const дно = RANKED_HANDS_BY_STRENGTH.slice(-5);
  assert.ok(дно.includes("72o"), `в самом низу ожидали 72o, а там: ${дно.join(" ")}`);
});

test("одномастная версия руки сильнее разномастной", () => {
  const место = (рука: string) => RANKED_HANDS_BY_STRENGTH.indexOf(рука);
  for (const [s, o] of [["AKs", "AKo"], ["KTs", "KTo"], ["76s", "76o"]]) {
    assert.ok(место(s) < место(o), `${s} должна стоять выше ${o}`);
  }
});

test("оценка по Чену: известные значения", () => {
  // Формула Билла Чена: AA = 20, KK = 16, а «сброс» вроде 72o уходит в минус.
  assert.equal(chenScore("AA"), 20);
  assert.equal(chenScore("KK"), 16);
  assert.ok(chenScore("AKs") > chenScore("AKo"), "масть добавляет два очка");
  assert.ok(chenScore("72o") < chenScore("AA") / 4, "72o — худшая рука в игре");
});

test("количество комбинаций на класс руки", () => {
  assert.equal(comboCountForLabel("AA"), 6, "пар — шесть комбинаций");
  assert.equal(comboCountForLabel("AKs"), 4, "одномастных — четыре");
  assert.equal(comboCountForLabel("AKo"), 12, "разномастных — двенадцать");
});

test("вся колода сходится: 1326 комбинаций", () => {
  const всего = RANKED_HANDS_BY_STRENGTH.reduce((s, h) => s + comboCountForLabel(h), 0);
  assert.equal(всего, 1326, "169 классов рук должны дать ровно 1326 комбинаций");
});
