import * as XLSX from 'xlsx';
import { PRODUCT_COLUMNS, STOCK_COLUMNS } from './bulk.columns';
import { buildTemplate, parseSheet } from './bulk.parser';

const csv = (s: string) => Buffer.from('﻿' + s, 'utf8');

describe('Toplu yükleme ayrıştırıcı', () => {
  it('Türkçe başlıkları tanır ve sayıları çevirir', () => {
    const { rows } = parseSheet(csv('Ürün Adı *;SKU *;Satış Fiyatı;Stok\nTişört;TS-1;299,90;12\n'), PRODUCT_COLUMNS);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data.satis_fiyati).toBe(299.9);
    expect(rows[0].data.stok).toBe(12);
    expect(rows[0].row).toBe(2);
  });

  it('zorunlu alan ve tip hatalarını satır numarasıyla raporlar', () => {
    const { rows } = parseSheet(csv('urun_adi;sku;stok\n;TS-2;abc\nİkinci;;3,5\n'), PRODUCT_COLUMNS);
    expect(rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Ürün Adı zorunlu'), expect.stringContaining('sayı olmalı')]));
    expect(rows[1].errors).toEqual(expect.arrayContaining([expect.stringContaining('SKU zorunlu'), expect.stringContaining('tam sayı')]));
  });

  it('bilinmeyen sütunları bildirir ve boş satırları atlar', () => {
    const { rows, unknownColumns } = parseSheet(csv('Ürün Adı;SKU;Rastgele\nA;S1;x\n;;\n'), PRODUCT_COLUMNS);
    expect(rows).toHaveLength(1);
    expect(unknownColumns).toEqual(['Rastgele']);
  });

  it('ürettiği xlsx şablonunu geri okuyabilir', () => {
    const buf = buildTemplate(STOCK_COLUMNS, { sku: 'X', stok: 5, depo_kodu: 'MAIN' });
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Veri', 'Açıklamalar']);
    const { rows } = parseSheet(buf, STOCK_COLUMNS);
    expect(rows[0].data).toMatchObject({ sku: 'X', stok: 5, depo_kodu: 'MAIN' });
  });
});
