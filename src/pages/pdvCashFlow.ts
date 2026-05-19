export function getCashPaymentSummary(total: number, paid: number) {
  const roundMoney = (value: number) => Math.round(value * 100) / 100;
  const troco = roundMoney(Math.max(0, paid - total));

  return {
    isEnough: paid >= total,
    troco,
    falta: roundMoney(Math.max(0, total - paid)),
  };
}
