// Быстрые проверки движка эквити: секунды вместо минут (браузер не поднимается).
//
// Что здесь проверяется — не «код выполнился», а покерные факты, которые обязаны
// быть правдой всегда. Сквозной тест интерфейса такую ошибку не поймает: если
// в матрице съедет индекс, таблица нарисуется по-прежнему, просто с враньём.
//
// Запуск: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EQUITY_VS_RANDOM,
  ICM_CLASSES,
  handEquityVsRange,
  handBreakdownVsRange,
} from "../../src/engine/equity.ts";

const близко = (было: number, ждём: number, допуск: number, что: string) =>
  assert.ok(
    Math.abs(было - ждём) <= допуск,
    `${что}: получили ${(было * 100).toFixed(1)}%, ждали ${(ждём * 100).toFixed(1)}% ±${(допуск * 100).toFixed(1)}`,
  );

test("таблица классов на месте: 169 рук", () => {
  assert.equal(ICM_CLASSES.length, 169);
  assert.ok(ICM_CLASSES.includes("AA") && ICM_CLASSES.includes("72o"));
});

test("эквити против случайной руки: известные величины", () => {
  // Классика, которую знает любой покерист: AA выигрывает у случайной руки ~85%.
  близко(EQUITY_VS_RANDOM["AA"], 0.852, 0.02, "AA vs случайная");
  близко(EQUITY_VS_RANDOM["KK"], 0.824, 0.02, "KK vs случайная");
  близко(EQUITY_VS_RANDOM["72o"], 0.347, 0.03, "72o vs случайная — худшая рука");
});

test("порядок силы рук не нарушен", () => {
  // Против СЛУЧАЙНОЙ руки пары идут выше «двух больших»: JJ ~77%, а AKs ~67%.
  // Против конкретного диапазона порядок может быть другим — это разные вопросы.
  const порядок = ["AA", "KK", "QQ", "JJ", "TT", "AKs", "A9s", "K9o", "72o"];
  for (let i = 1; i < порядок.length; i += 1) {
    assert.ok(
      EQUITY_VS_RANDOM[порядок[i - 1]] > EQUITY_VS_RANDOM[порядок[i]],
      `${порядок[i - 1]} должна быть сильнее ${порядок[i]}`,
    );
  }
});

test("рука против конкретного диапазона", () => {
  // Против самой себя — ровно половина: одинаковые руки делят банк.
  близко(handEquityVsRange("AA", { AA: "x" }), 0.5, 0.01, "AA vs AA");
  // Классическая дуэль: тузы против королей — примерно 82 на 18.
  близко(handEquityVsRange("AA", { KK: "x" }), 0.82, 0.02, "AA vs KK");
  близко(handEquityVsRange("KK", { AA: "x" }), 0.18, 0.02, "KK vs AA");
  // Монетка: две карты выше против пары ниже — почти поровну.
  близко(handEquityVsRange("AKs", { QQ: "x" }), 0.46, 0.03, "AKs vs QQ");
});

test("неизвестная рука не роняет расчёт, а честно даёт половину", () => {
  assert.equal(handEquityVsRange("ZZ", { AA: "x" }), 0.5);
  assert.equal(handEquityVsRange("AA", {}), 0.5);
});

test("разбор выигрыш/ничья/проигрыш сходится сам с собой", () => {
  for (const [рука, против] of [["AA", { KK: "x" }], ["72o", { AA: "x" }], ["AKs", { QQ: "x" }]] as const) {
    const r = handBreakdownVsRange(рука, против as Record<string, string>);
    близко(r.win + r.tie + r.lose, 1, 0.001, `${рука}: доли должны давать единицу`);
    близко(r.win + r.tie / 2, r.equity, 0.001, `${рука}: эквити = выигрыш + половина ничьих`);
  }
});

test("пустой диапазон = против случайной руки", () => {
  const r = handBreakdownVsRange("AA", {});
  близко(r.equity, EQUITY_VS_RANDOM["AA"], 0.001, "AA против пустого диапазона");
});
