import { processInvoices } from './src/invoiceProcessor.js';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, 'tmp_test');

const { invoices, aggregates } = await processInvoices(dir);
console.log('Invoices:', invoices);
console.log('Aggregates:', aggregates);
