import inquirer from 'inquirer';
import { resolve, isAbsolute, path } from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { processInvoices } from './invoiceProcessor.js';
import { generateExcelReport } from './reportGenerator.js';
import { spawn } from 'child_process';
import electronBinary from 'electron';

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

async function pickFolder() {
  return new Promise((resolve, reject) => {
    const electronMain = path.join(__dirname, 'electron', 'selectFolder.cjs');

    const child = spawn(electronBinary, [electronMain], {
      stdio: ['ignore', 'pipe', 'inherit'], // stdout = ruta de la carpeta
    });

    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));

    child.on('close', (code) => {
      const folder = output.trim();
      if (code === 0 && folder) {
        resolve(folder);
      } else {
        reject(new Error('Selección cancelada por el usuario'));
      }
    });
  });
}

export async function promptUser() {
  let selectedDir = null;

  try {
    console.log('🗂  Abriendo selector de carpeta...');
    selectedDir = await pickFolder();
    console.log('📁 Carpeta seleccionada:', selectedDir);

    if (!selectedDir) {
      console.error('❌ No se seleccionó ninguna carpeta');
      return null;
    }

    const exists = await ensureDirectoryExists(selectedDir);
    if (!exists) {
      console.error('❌ La ruta seleccionada no es una carpeta válida');
      return null;
    }
  } catch (err) {
    console.error('❌ Error al seleccionar la carpeta:', err.message);
    return null;
  }

  // Normaliza la ruta
  selectedDir = normalizeDirectory(selectedDir.trim());

  // Resto de preguntas con inquirer
  const answers = await inquirer.prompt([
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
    directory: selectedDir,
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
