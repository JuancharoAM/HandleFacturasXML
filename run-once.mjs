import { processInvoices } from './src/invoiceProcessor.js';
import { generateExcelReport } from './src/reportGenerator.js';

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Falta la ruta del directorio con XML como argumento.');
    process.exit(1);
  }
  try {
    const { invoices, aggregates } = await processInvoices(dir);
    if (invoices.length === 0) {
      console.log('No se encontraron facturas en el directorio especificado.');
      return;
    }
    const output = await generateExcelReport(dir, invoices, aggregates);
    console.log('Reporte generado:', output);
    console.log('Facturas procesadas:', invoices.length);
    console.log('Totales:', aggregates);
  } catch (err) {
    console.error('Error al procesar/generar reporte:', err?.message || err);
    process.exitCode = 1;
  }
}

main();

