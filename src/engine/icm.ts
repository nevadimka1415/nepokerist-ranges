// Турнирная математика: ICM (сколько твои фишки стоят в деньгах) и пуш/фолд-солвер.
//
// Вынесено из main.tsx 08.08.2026 вместе с движком эквити. Здесь тоже нет ни React,
// ни браузера — только числа, поэтому проверяется быстрыми тестами.
//
// Почему это стоило вынести первым делом после эквити: ошибка тут самая коварная.
// Чарт пуш/фолда нарисуется красиво при любой арифметике, и «неправильно» будет
// выглядеть ровно так же убедительно, как «правильно».
import { ICM_CLASSES, ICM_COMBO, ICM_EQUITY } from "./equity.ts";

// ICM (Independent Chip Model) по Malmuth-Harville: стеки + доли выплат → доля
// призового пула у каждого игрока. Короткие стеки над-реализуют, большие
// недо-реализуют (нельзя выиграть больше первого места). Сумма = 1 (весь пул).
// Проверено: HU 80/20 при выплатах 65/35 → 59/41 (классика).
export function icmEquities(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const eq = new Array(n).fill(0);
  if (!payouts.length) return eq;
  // Вылетевшие (0 фишек) финишируют на НИЖНИХ местах (ниже всех живых) и делят
  // выплаты этих мест поровну. Важно и математически (иначе деление на нулевой
  // остаток стека даёт NaN), и по сути: в HU вылет = 2-е место, а оно оплачивается.
  const live: number[] = [];
  const busted: number[] = [];
  for (let i = 0; i < n; i += 1) (stacks[i] > 0 ? live : busted).push(i);
  if (busted.length) {
    let sum = 0;
    for (let place = live.length; place < n; place += 1) sum += payouts[place] || 0;
    const share = sum / busted.length;
    busted.forEach((i) => { eq[i] = share; });
  }
  const total = live.reduce((a, i) => a + stacks[i], 0);
  if (total <= 0 || !live.length) return eq;
  // живые заполняют верхние места по Malmuth-Harville между собой
  const recurse = (remaining: number[], remTotal: number, place: number, prob: number) => {
    if (place >= payouts.length || remaining.length === 0) return;
    for (const idx of remaining) {
      const pWin = stacks[idx] / remTotal;
      eq[idx] += prob * pWin * (payouts[place] || 0);
      recurse(remaining.filter((x) => x !== idx), remTotal - stacks[idx], place + 1, prob * pWin);
    }
  };
  recurse(live, total, 0, 1);
  return eq;
}

// ICM-скорректированный пуш/фолд для спота «SB (герой) пушит — BB коллит»,
// внутри турнирного контекста остальных стеков. Терминальные выплаты считаются
// в ICM-деньгах от итоговых стеков стола (вот где ICM «кусает»: у пузыря вылет
// = потеря доли пула, поэтому колл резко у́же). Nash через fictitious play.
// Стеки в BB, блайнды 0.5/1 (без анте). Проверено: HU = chipEV (ICM линеен в HU),
// пузырь со стеком-шортом → пуш ~ATC, колл только премиумы (как в ICMIZER).
export function solveIcmPushFold(stacks: number[], heroIdx: number, bbIdx: number, payouts: number[], iters = 400) {
  const sb = 0.5;
  const bb = 1;
  const S = Math.min(stacks[heroIdx], stacks[bbIdx]);
  const vec = (dH: number, dB: number) => {
    const v = [...stacks];
    v[heroIdx] += dH;
    v[bbIdx] += dB;
    return v;
  };
  const ICMh = (v: number[]) => icmEquities(v, payouts)[heroIdx];
  const ICMb = (v: number[]) => icmEquities(v, payouts)[bbIdx];
  const foldH = ICMh(vec(-sb, +sb));
  const bbfoldH = ICMh(vec(+bb, -bb));
  const bbfoldB = ICMb(vec(+bb, -bb));
  const winH = ICMh(vec(+S, -S));
  const loseH = ICMh(vec(-S, +S));
  const winB = ICMb(vec(-S, +S)); // BB выигрывает = герой теряет
  const loseB = ICMb(vec(+S, -S));
  const N = ICM_CLASSES.length;
  const push = new Array(N).fill(0.5);
  const call = new Array(N).fill(0.5);
  for (let t = 0; t < iters; t += 1) {
    const brc = new Array(N);
    const brp = new Array(N);
    // лучший ответ BB против пуш-диапазона
    for (let j = 0; j < N; j += 1) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < N; i += 1) {
        const w = push[i] * ICM_COMBO[i];
        den += w;
        num += w * (1 - ICM_EQUITY[i][j]);
      }
      const be = den > 0 ? num / den : 0.5;
      brc[j] = be * winB + (1 - be) * loseB > bbfoldB ? 1 : 0;
    }
    // лучший ответ героя против колл-диапазона
    for (let i = 0; i < N; i += 1) {
      let num = 0;
      let den = 0;
      for (let j = 0; j < N; j += 1) {
        const w = call[j] * ICM_COMBO[j];
        den += w;
        num += w * ICM_EQUITY[i][j];
      }
      const ei = den > 0 ? num / den : 0.5;
      const pCall = den / 1326;
      brp[i] = (1 - pCall) * bbfoldH + pCall * (ei * winH + (1 - ei) * loseH) > foldH ? 1 : 0;
    }
    const lr = 1 / (t + 2);
    for (let i = 0; i < N; i += 1) {
      push[i] += (brp[i] - push[i]) * lr;
      call[i] += (brc[i] - call[i]) * lr;
    }
  }
  const pushLabels = new Set<string>();
  const callLabels = new Set<string>();
  let pushCombos = 0;
  let callCombos = 0;
  for (let i = 0; i < N; i += 1) {
    if (push[i] > 0.5) {
      pushLabels.add(ICM_CLASSES[i]);
      pushCombos += ICM_COMBO[i];
    }
    if (call[i] > 0.5) {
      callLabels.add(ICM_CLASSES[i]);
      callCombos += ICM_COMBO[i];
    }
  }
  return {
    pushLabels,
    callLabels,
    pushPct: (pushCombos / 1326) * 100,
    callPct: (callCombos / 1326) * 100,
    effStack: S,
  };
}
