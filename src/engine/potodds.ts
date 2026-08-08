// Пот-оддсы и защита от блефа: чистые формулы, без интерфейса.
//
// Вынесено из компонента 08.08.2026. Тут нечего ломать глазами — либо формула
// верна, либо нет, — поэтому место таким расчётам в отдельном модуле с тестами,
// а не внутри React-хука, где их можно проверить только кликами.
//
// Банк P — то, что лежит в банке ДО ставки соперника. Ставка B — его ставка.
// Соперник рискует B, чтобы забрать P; отсюда классические формулы:
//   нужная эквити на колл = B / (P + 2B)   (закрываем ставку в банк P+B, вкладываем B)
//   MDF (мин. частота защиты) = P / (P + B) — сколько защищаем, чтобы блеф соперника не был бесплатным
//   блеф-частота соперника (α)  = B / (P + B)
export type PotOdds = {
  p: number;
  b: number;
  reqEquity: number;
  mdf: number;
  alpha: number;
  betToPot: number;
};

// null = ввод бессмысленный (нет ставки, отрицательный банк, мусор в поле).
// Это не ошибка, а «считать нечего»: пользователь ещё не дозаполнил форму.
export function computePotOdds(potSize: unknown, betSize: unknown): PotOdds | null {
  const p = Math.max(0, Number(potSize));
  const b = Math.max(0, Number(betSize));
  if (!isFinite(p) || !isFinite(b) || b <= 0 || p < 0) return null;
  const toCall = b;
  const potAfter = p + b + b; // банк после нашего колла: P + ставка соперника + наш колл
  const reqEquity = (toCall / potAfter) * 100;
  const mdf = (p / (p + b)) * 100;
  const alpha = (b / (p + b)) * 100;
  // отношение «ставка к банку» для интуиции (напр. 0.5 = полбанка)
  const betToPot = p > 0 ? b / p : Infinity;
  return { p, b, reqEquity, mdf, alpha, betToPot };
}
