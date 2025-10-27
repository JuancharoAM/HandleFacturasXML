import { join } from 'path';
import ExcelJS from 'exceljs';

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function buildOutputFilePath(directory) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(directory, `reporte-facturas-${timestamp}.xlsx`);
}

function addHeaderRow(worksheet, ivaRates) {
  const baseColumns = [
    { header: 'Archivo', key: 'fileName', width: 30 },
    { header: 'Clave', key: 'clave', width: 45 },
    { header: 'Consecutivo', key: 'consecutivo', width: 20 },
    { header: 'Fecha', key: 'fecha', width: 15 },
    { header: 'Total Gravado', key: 'totalGravado', width: 18 },
    { header: 'Subtotal', key: 'subtotal', width: 15 },
    { header: 'Exento', key: 'exento', width: 15 },
    { header: 'IVA Total', key: 'totalIVA', width: 15 },
  ];
  const ivaColumns = ivaRates.map((rate) => ({
    header: `IVA ${rate}%`,
    key: `iva_${rate}`,
    width: 15,
  }));
  const tailColumns = [{ header: 'Total Comprobante', key: 'totalComprobante', width: 20 },{ header: 'Observaciones', key: 'observaciones', width: 50 }];

  worksheet.columns = [...baseColumns, ...ivaColumns, ...tailColumns];

  // Apply thousands format with exactly 2 decimals to numeric columns
  const nonNumeric = new Set(['fileName', 'clave', 'consecutivo', 'fecha', 'observaciones']);
  worksheet.columns.forEach((col) => {
    if (!nonNumeric.has(col.key)) {
      col.numFmt = '#,##0.00';
    }
  });

  worksheet.getRow(1).font = { bold: true };
}

function addInvoiceRows(worksheet, invoices, ivaRates) {
  invoices.forEach((invoice) => {
    const rowData = {
      fileName: invoice.fileName,
      clave: invoice.clave,
      consecutivo: invoice.consecutivo,
      fecha: formatDate(invoice.issueDate),
      totalGravado: invoice.totalGravado,
      subtotal: invoice.subtotal,
      exento: invoice.exento ?? 0,
      totalIVA: invoice.totalIVA,
      totalComprobante: invoice.totalComprobante,
      observaciones: invoice.observations || '',
    };
    ivaRates.forEach((rate) => {
      rowData[`iva_${rate}`] = invoice.ivaRateTotals?.[rate] ?? 0;
    });
    worksheet.addRow(rowData);
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { horizontal: 'right' };
    row.getCell('fileName').alignment = { horizontal: 'left' };
    row.getCell('clave').alignment = { horizontal: 'left' };
    row.getCell('consecutivo').alignment = { horizontal: 'left' };
    row.getCell('fecha').alignment = { horizontal: 'center' };
    row.getCell('observaciones').alignment = { horizontal: 'left' };
  });
}

function addTotalsRow(worksheet, aggregates, ivaRates) {
  const rowData = {
    fileName: 'Totales',
    totalGravado: aggregates.totalGravado,
    subtotal: aggregates.subtotal,
    exento: aggregates.totalExento ?? 0,
    totalIVA: aggregates.totalIVA,
    totalComprobante: aggregates.totalComprobante,
  };
  ivaRates.forEach((rate) => {
    rowData[`iva_${rate}`] = aggregates.ivaRateTotals?.[rate] ?? 0;
  });

  const totalsRow = worksheet.addRow(rowData);
  totalsRow.font = { bold: true };
  totalsRow.alignment = { horizontal: 'right' };
  totalsRow.getCell('fileName').alignment = { horizontal: 'left' };
}

function addSummarySheet(workbook, aggregates, invoiceCount) {
  const sheet = workbook.addWorksheet('Totales');
  sheet.columns = [
    { header: 'Concepto', key: 'concept', width: 30 },
    { header: 'Valor', key: 'value', width: 20 },
  ];

  sheet.addRow({ concept: 'Facturas procesadas', value: invoiceCount });
  sheet.addRow({ concept: 'Total Gravado', value: aggregates.totalGravado });
  sheet.addRow({ concept: 'Subtotal', value: aggregates.subtotal });
  sheet.addRow({ concept: 'IVA Total', value: aggregates.totalIVA });
  sheet.addRow({ concept: 'Total Comprobante', value: aggregates.totalComprobante });
  sheet.addRow({ concept: 'Total facturas exentas', value: aggregates.exentasCount ?? 0 });
  sheet.addRow({ concept: 'Monto exento total', value: aggregates.totalExento ?? 0 });

  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('value').numFmt = '#,##0.00';
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    row.getCell('concept').alignment = { horizontal: 'left' };
    row.getCell('value').alignment = { horizontal: 'right' };
  });
}

export async function generateExcelReport(directory, invoices, aggregates) {
  const workbook = new ExcelJS.Workbook();
  const detailSheet = workbook.addWorksheet('Facturas');
  const ivaRates = Array.from(
    new Set(
      invoices.flatMap((inv) => Object.keys(inv.ivaRateTotals || {}).map((k) => Number(k))),
    ),
  ).filter((r) => r !== 0).sort((a, b) => a - b);

  addHeaderRow(detailSheet, ivaRates);
  addInvoiceRows(detailSheet, invoices, ivaRates);
  addTotalsRow(detailSheet, aggregates, ivaRates);
  addSummarySheet(workbook, aggregates, invoices.length);

  const outputPath = buildOutputFilePath(directory);
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}
