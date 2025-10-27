import inquirer from 'inquirer';
import { resolve, isAbsolute } from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { processInvoices } from './invoiceProcessor.js';
import { generateExcelReport } from './reportGenerator.js';

async function ensureDirectoryExists(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

function normalizeDirectory(input) {
  if (!input) {
    return '';
  }
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

async function promptUser() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'directory',
      message: 'Ingrese la ruta de la carpeta que contiene los XML de facturas:',
      validate: async (input) => {
        const dir = normalizeDirectory(input.trim());
        if (!dir) {
          return 'Debe ingresar una ruta válida';
        }
        const exists = await ensureDirectoryExists(dir);
        return exists || 'La ruta indicada no es una carpeta válida';
      },
      filter: (input) => normalizeDirectory(input.trim()),
    },
    {
      type: 'confirm',
      name: 'useDateFilter',
      message: '¿Desea filtrar las facturas por un rango de fechas?',
      default: false,
    },
    {
      type: 'input',
      name: 'startDate',
      message: 'Fecha inicial (YYYY-MM-DD):',
      when: (answers) => answers.useDateFilter,
      validate: (input) => {
        const parsed = Date.parse(input);
        if (Number.isNaN(parsed)) {
          return 'Ingrese una fecha válida con el formato YYYY-MM-DD';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'endDate',
      message: 'Fecha final (YYYY-MM-DD):',
      when: (answers) => answers.useDateFilter,
      validate: (input, answers) => {
        const parsed = Date.parse(input);
        if (Number.isNaN(parsed)) {
          return 'Ingrese una fecha válida con el formato YYYY-MM-DD';
        }
        const start = Date.parse(answers.startDate);
        if (!Number.isNaN(start) && parsed < start) {
          return 'La fecha final debe ser igual o posterior a la fecha inicial';
        }
        return true;
      },
    },
  ]);

  return {
    directory: answers.directory,
    startDate: answers.useDateFilter ? new Date(answers.startDate) : null,
    endDate: answers.useDateFilter ? new Date(answers.endDate) : null,
  };
}

async function main() {
  try {
    const { directory, startDate, endDate } = await promptUser();
    const { invoices, aggregates } = await processInvoices(directory, {
      startDate,
      endDate,
    });

    if (invoices.length === 0) {
      console.log('No se encontraron facturas que cumplan con los criterios indicados.');
      return;
    }

    const outputFile = await generateExcelReport(directory, invoices, aggregates);
    console.log(`Reporte generado correctamente: ${outputFile}`);
  } catch (error) {
    console.error('Ocurrió un error al generar el reporte.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
