import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { getEnv } from "@/lib/config/env";
import { resolveImportTempPath } from "./temp-storage";

export type RawSheet = {
  headers: string[];
  rows: string[][];
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Formules : lire le résultat affiché / texte, jamais exécuter
  if (typeof value === "object") {
    const obj = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof obj.text === "string") return obj.text;
    if (obj.result != null) return String(obj.result);
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((t) => t.text).join("");
    }
  }
  return String(value);
}

export async function parseCsvBuffer(buffer: Buffer): Promise<RawSheet> {
  const maxRows = getEnv().IMPORT_MAX_ROWS;
  let records: string[][];
  try {
    records = parse(buffer, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      cast: false,
      to: maxRows + 1,
    }) as string[][];
  } catch (error) {
    throw new Error(
      `Fichier CSV malformé${error instanceof Error ? `: ${error.message}` : ""}`,
    );
  }

  if (records.length === 0) {
    throw new Error("Fichier CSV vide");
  }

  const headers = records[0]!.map((h, i) =>
    String(h ?? "").trim() || `colonne_${i + 1}`,
  );
  const rows = records.slice(1).map((r) =>
    headers.map((_, i) => String(r[i] ?? "").trim()),
  );

  if (rows.length > maxRows) {
    throw new Error(`Trop de lignes (max ${maxRows})`);
  }

  return { headers, rows };
}

export async function parseXlsxBuffer(buffer: Buffer): Promise<RawSheet> {
  const maxRows = getEnv().IMPORT_MAX_ROWS;
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs lit les valeurs / résultats stockés — n'exécute pas de macros VBA
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error("Fichier XLSX malformé");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("Classeur XLSX sans feuille");
  }

  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > maxRows + 1) {
      throw new Error(`Trop de lignes (max ${maxRows})`);
    }
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellToString(cell.value);
    });
    matrix.push(values.map((v) => (v ?? "").trim()));
  });

  if (matrix.length === 0) {
    throw new Error("Feuille XLSX vide");
  }

  const headerLen = Math.max(...matrix.map((r) => r.length), 1);
  const headers = Array.from({ length: headerLen }, (_, i) => {
    const h = matrix[0]![i];
    return (h && h.trim()) || `colonne_${i + 1}`;
  });
  const rows = matrix.slice(1).map((r) =>
    headers.map((_, i) => String(r[i] ?? "").trim()),
  );

  return { headers, rows };
}

export async function parseImportFile(params: {
  tempRelativeKey: string;
  extension: ".csv" | ".xlsx";
}): Promise<RawSheet> {
  const abs = resolveImportTempPath(params.tempRelativeKey);
  const buffer = await readFile(abs);
  if (params.extension === ".csv") {
    return parseCsvBuffer(buffer);
  }
  return parseXlsxBuffer(buffer);
}
