/**
 * Normalizes text to UPPERCASE and removes accents (diacritics).
 * Ex: "Coxinha de Frango" -> "COXINHA DE FRANGO"
 * Ex: "Pão de Queijo" -> "PAO DE QUEIJO"
 */
export const normalizeText = (text: string): string => {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};
