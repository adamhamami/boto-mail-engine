/**
 * Neutralise les formules CSV (injection Excel/LibreOffice).
 * Préfixe `'` si la valeur commence par = + - @ ou tab/CR.
 */
export function neutralizeCsvFormula(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function escapeCsvCell(value: unknown): string {
  const str = neutralizeCsvFormula(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvCell).join(",");
}

export function toCsvDocument(headers: string[], rows: unknown[][]): string {
  return [toCsvRow(headers), ...rows.map(toCsvRow)].join("\n");
}
