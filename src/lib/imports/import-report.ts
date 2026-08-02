/**
 * Classification pure des lignes d'import — même logique que le worker
 * (accepté / rejeté / doublon fichier) sans DB ni SMTP.
 */
import {
  applyMapping,
  mapRawToImportRow,
  type ColumnMapping,
} from "@/lib/imports/mapping";
import { normalizeEmailAddress } from "@/lib/data/integrity";

export interface ImportRowClassification {
  row: number;
  status: "accepted" | "rejected" | "duplicate";
  email?: string;
  message?: string;
  code?: string;
}

export interface ImportReportSummary {
  total: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  rows: ImportRowClassification[];
}

export function classifyImportSheet(params: {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
}): ImportReportSummary {
  const seen = new Set<string>();
  const rows: ImportRowClassification[] = [];
  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;

  for (let i = 0; i < params.rows.length; i += 1) {
    const rowNum = i + 2;
    const raw = applyMapping(params.headers, params.rows[i]!, params.mapping);
    const mapped = mapRawToImportRow(raw);

    if (!mapped.ok) {
      rejected += 1;
      rows.push({
        row: rowNum,
        status: "rejected",
        message: mapped.message,
        code: "VALIDATION",
      });
      continue;
    }

    const email = mapped.row.email;
    const normalized = normalizeEmailAddress(email);
    if (seen.has(normalized)) {
      duplicates += 1;
      rejected += 1;
      rows.push({
        row: rowNum,
        status: "duplicate",
        email,
        message: "Doublon dans le fichier",
        code: "DUPLICATE_FILE",
      });
      continue;
    }

    seen.add(normalized);
    accepted += 1;
    rows.push({ row: rowNum, status: "accepted", email });
  }

  return {
    total: params.rows.length,
    accepted,
    rejected,
    duplicates,
    rows,
  };
}
