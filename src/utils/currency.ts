/**
 * Utility for formatting and parsing Currency (R$) and Weights (Grams).
 */

// --- CURRENCY LOGIC (R$ - 2 decimals, comma) ---
export const formatCurrency = (value: number | string): string => {
  const amount = typeof value === "number" ? value : parseFloat(value.toString().replace(",", "."));
  if (isNaN(amount)) return "0,00";
  
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const parseCurrencyToNumber = (formattedValue: string): number => {
  if (!formattedValue) return 0;
  const clean = formattedValue.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const handleCurrencyInput = (inputValue: string): string => {
  let value = inputValue.replace(/\D/g, "");
  if (!value) return "0,00";
  const amount = parseInt(value) / 100;
  return formatCurrency(amount);
};

// --- WEIGHT/QUANTITY LOGIC (3 decimals, dot) ---
export const formatWeight = (value: number | string): string => {
  const amount = typeof value === "number" ? value : parseFloat(value.toString());
  if (isNaN(amount)) return "0.000";
  
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    useGrouping: false
  }).format(amount);
};

export const parseWeightToNumber = (formattedValue: string): number => {
  if (!formattedValue) return 0;
  const clean = formattedValue.replace(/,/g, ".");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const handleWeightInput = (inputValue: string): string => {
  // Convert comma to dot first
  let value = inputValue.replace(/,/g, ".");
  
  // If starts with dot, prepend 0
  if (value.startsWith(".")) {
    value = "0" + value;
  }
  
  // Allow only numbers and a single dot
  value = value.replace(/[^\d.]/g, "");
  
  const parts = value.split(".");
  if (parts.length > 2) {
    value = parts[0] + "." + parts.slice(1).join("");
  } else if (parts.length === 2) {
    value = parts[0] + "." + parts[1].slice(0, 3);
  }
  
  return value;
};

export const finalizeWeightInput = (value: string): string => {
  if (!value) return "0.000";
  const num = parseWeightToNumber(value);
  return formatWeight(num);
};
