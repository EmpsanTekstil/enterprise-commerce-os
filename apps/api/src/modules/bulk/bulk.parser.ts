import * as XLSX from 'xlsx';
import { ColumnDef } from './bulk.columns';

export interface ParsedRow { row: number; data: Record<string, string | number | null>; errors: string[] }

/** Türkçe başlıkları anahtara çevirir: "Satış Fiyatı" → satis_fiyati; anahtarın kendisi de kabul edilir. */
function normalizeHeader(h: string) {
  return String(h ?? '').trim().toLowerCase().replace(/\s*\*\s*$/, '')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Excel (.xlsx) veya CSV dosyasını satırlara çevirir ve sütun tanımlarına göre doğrular. */
export function parseSheet(buffer: Buffer, columns: readonly ColumnDef[]): { rows: ParsedRow[]; unknownColumns: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], unknownColumns: [] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false });
  const keyByHeader = new Map<string, string>();
  for (const c of columns) { keyByHeader.set(normalizeHeader(c.title), c.key); keyByHeader.set(c.key, c.key); }
  const unknown = new Set<string>();
  const rows: ParsedRow[] = raw.map((r, i) => {
    const data: Record<string, string | number | null> = {};
    const errors: string[] = [];
    for (const [h, v] of Object.entries(r)) {
      const key = keyByHeader.get(normalizeHeader(h));
      if (!key) { if (v != null && String(v).trim() !== '') unknown.add(h); continue; }
      data[key] = v == null ? null : String(v).trim();
    }
    for (const c of columns) {
      const v = data[c.key];
      if (c.required && (v == null || v === '')) errors.push(`${c.title.replace(' *', '')} zorunlu`);
      if (v != null && v !== '' && c.type) {
        const n = Number(String(v).replace(/\./g, (m, off, s) => (String(s).includes(',') ? '' : m)).replace(',', '.'));
        if (Number.isNaN(n)) errors.push(`${c.title} sayı olmalı (girilen: ${v})`);
        else if (c.type === 'int' && !Number.isInteger(n)) errors.push(`${c.title} tam sayı olmalı`);
        else if (n < 0) errors.push(`${c.title} negatif olamaz`);
        else data[c.key] = n;
      }
    }
    return { row: i + 2, data, errors }; // +2: başlık satırı ve 1-tabanlı Excel satırı
  }).filter((r) => Object.values(r.data).some((v) => v != null && v !== ''));
  return { rows, unknownColumns: [...unknown] };
}

/** Şablon dosyası üretir (başlıklar + örnek satır + ikinci sayfada açıklamalar). */
export function buildTemplate(columns: readonly ColumnDef[], example: Record<string, string | number>): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.title), columns.map((c) => example[c.key] ?? '')]);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(14, c.title.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Veri');
  const help = XLSX.utils.aoa_to_sheet([['Sütun', 'Zorunlu', 'Açıklama'], ...columns.map((c) => [c.title, c.required ? 'Evet' : 'Hayır', c.hint ?? ''])]);
  help['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, help, 'Açıklamalar');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
