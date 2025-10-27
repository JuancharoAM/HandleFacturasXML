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

function addHeaderRow(worksheet) {
  worksheet.columns = [
    { header: 'Archivo', key: 'fileName', width: 30 },
    { header: 'Clave', key: 'clave', width: 45 },
    { header: 'Consecutivo', key: 'consecutivo', width: 20 },
    { header: 'Fecha', key: 'fecha', width: 15 },
    { header: 'Total Gravado', key: 'totalGravado', width: 18 },
    { header: 'Subtotal', key: 'subtotal', width: 15 },
    { header: 'IVA Total', key: 'totalIVA', width: 15 },
    { header: 'IVA 1%', key: 'iva1', width: 15 },
    { header: 'IVA 2%', key: 'iva2', width: 15 },
    { header: 'IVA 13%', key: 'iva13', width: 15 },
    { header: 'Total Comprobante', key: 'totalComprobante', width: 20 },
  ];

  worksheet.getRow(1).font = { bold: true };
}

function addInvoiceRows(worksheet, invoices) {
  invoices.forEach((invoice) => {
    worksheet.addRow({
      fileName: invoice.fileName,
      clave: invoice.clave,
      consecutivo: invoice.consecutivo,
      fecha: formatDate(invoice.issueDate),
      totalGravado: invoice.totalGravado,
      subtotal: invoice.subtotal,
      totalIVA: invoice.totalIVA,
      iva1: invoice.ivaRateTotals[1] ?? 0,
      iva2: invoice.ivaRateTotals[2] ?? 0,
      iva13: invoice.ivaRateTotals[13] ?? 0,
      totalComprobante: invoice.totalComprobante,
    });
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    row.alignment = { horizontal: 'right' };
    row.getCell('fileName').alignment = { horizontal: 'left' };
    row.getCell('clave').alignment = { horizontal: 'left' };
    row.getCell('consecutivo').alignment = { horizontal: 'left' };
    row.getCell('fecha').alignment = { horizontal: 'center' };
  });
}

function addTotalsRow(worksheet, aggregates) {
  const totalsRow = worksheet.addRow({
    fileName: 'Totales',
    totalGravado: aggregates.totalGravado,
    subtotal: aggregates.subtotal,
    totalIVA: aggregates.totalIVA,
    iva1: aggregates.ivaRateTotals[1] ?? 0,
    iva2: aggregates.ivaRateTotals[2] ?? 0,
    iva13: aggregates.ivaRateTotals[13] ?? 0,
    totalComprobante: aggregates.totalComprobante,
  });

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
  sheet.addRow({ concept: 'IVA 1%', value: aggregates.ivaRateTotals[1] ?? 0 });
  sheet.addRow({ concept: 'IVA 2%', value: aggregates.ivaRateTotals[2] ?? 0 });
  sheet.addRow({ concept: 'IVA 13%', value: aggregates.ivaRateTotals[13] ?? 0 });
  sheet.addRow({ concept: 'Total Comprobante', value: aggregates.totalComprobante });

  sheet.getRow(1).font = { bold: true };
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
  addHeaderRow(detailSheet);
  addInvoiceRows(detailSheet, invoices);
  addTotalsRow(detailSheet, aggregates);
  addSummarySheet(workbook, aggregates, invoices.length);

  const outputPath = buildOutputFilePath(directory);
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}
