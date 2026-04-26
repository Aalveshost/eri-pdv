/**
 * Utility for formatting and parsing currency in the BRL style (mask).
 * 1 -> 0,01
 * 10 -> 0,10
 * 105 -> 1,05
 */

export const formatCurrency = (value: number | string): string => {
  const amount = typeof value === "number" ? value : parseFloat(value.replace(/\D/g, "")) / 100;
  if (isNaN(amount)) return "0,00";
  
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const parseCurrencyToNumber = (formattedValue: string): number => {
  const digits = formattedValue.replace(/\D/g, "");
  return parseFloat(digits) / 100;
};

export const handleCurrencyInput = (inputValue: string): string => {
  const digits = inputValue.replace(/\D/g, "");
  if (!digits) return "0,00";
  
  const amount = parseInt(digits) / 100;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};
