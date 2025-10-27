import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: true,
  trimValues: true,
  ignoreDeclaration: true,
  ignoreNameSpace: true,
});

const IVA_RATES_OF_INTEREST = [1, 2, 13];

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findFirstKeyDeep(object, keyToFind) {
  if (!object || typeof object !== 'object') {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(object, keyToFind)) {
    return object[keyToFind];
  }

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const result = findFirstKeyDeep(value, keyToFind);
      if (result !== undefined) {
        return result;
      }
    }
  }

  return undefined;
}

function pickFirstAvailable(object, keys) {
  if (!object) {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      return object[key];
    }
  }
  return undefined;
}

function normalizeToArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function extractInvoiceDate(invoiceData) {
  const possibleDateKeys = [
    'FechaEmision',
    'FechaCreacion',
    'FechaFactura',
    'IssueDate',
  ];

  for (const key of possibleDateKeys) {
    const value = findFirstKeyDeep(invoiceData, key);
    if (value) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }
    }
  }

  return null;
}

function extractIdentifiers(invoiceData) {
  const clave = findFirstKeyDeep(invoiceData, 'Clave');
  const numeroConsecutivo = findFirstKeyDeep(invoiceData, 'NumeroConsecutivo');
  return {
    clave: typeof clave === 'string' ? clave : '',
    consecutivo: typeof numeroConsecutivo === 'string' ? numeroConsecutivo : '',
  };
}

function aggregateByRate(lineItems) {
  const breakdown = new Map();

  for (const line of lineItems) {
    const impuestos = normalizeToArray(line.Impuesto || line.Impuestos);
    for (const impuesto of impuestos) {
      const rate = toNumber(impuesto?.Tarifa ?? impuesto?.tarifa ?? impuesto?.Porcentaje);
      const amount = toNumber(impuesto?.Monto ?? impuesto?.MontoImpuesto);
      if (!rate || !amount) {
        continue;
      }
      const current = breakdown.get(rate) ?? 0;
      breakdown.set(rate, current + amount);
    }
  }

  const totals = {};
  for (const rate of IVA_RATES_OF_INTEREST) {
    totals[rate] = breakdown.get(rate) ?? 0;
  }

  return {
    breakdown,
    totals,
  };
}

function extractLineItems(invoiceData) {
  const detalle = findFirstKeyDeep(invoiceData, 'DetalleServicio') ?? findFirstKeyDeep(invoiceData, 'DetalleFactura');
  if (!detalle) {
    return [];
  }
  const lineItems = detalle.LineaDetalle ?? detalle.Lineas ?? detalle.lineas;
  return normalizeToArray(lineItems).map((line) => ({
    ...line,
  }));
}

function extractSummary(invoiceData) {
  const resumen = findFirstKeyDeep(invoiceData, 'ResumenFactura');
  if (!resumen) {
    return {
      totalGravado: 0,
      subtotal: 0,
      totalIVA: 0,
      totalComprobante: 0,
    };
  }

  const totalGravado = toNumber(
    pickFirstAvailable(resumen, [
      'TotalGravado',
      'TotalVentaGravada',
      'TotalServGravados',
      'TotalMercanciasGravadas',
    ]),
  );

  const subtotal = toNumber(
    pickFirstAvailable(resumen, [
      'TotalVenta',
      'TotalVentaNeta',
      'TotalServGravados',
    ]),
  );

  const totalIVA = toNumber(
    pickFirstAvailable(resumen, [
      'TotalImpuesto',
      'TotalImpuestos',
    ]),
  );

  const totalComprobante = toNumber(
    pickFirstAvailable(resumen, [
      'TotalComprobante',
      'TotalFactura',
      'TotalDocumento',
    ]),
  );

  return {
    totalGravado,
    subtotal,
    totalIVA,
    totalComprobante,
  };
}

async function readXmlFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parser.parse(content);
}

function filterByDate(invoices, startDate, endDate) {
  if (!startDate && !endDate) {
    return invoices;
  }

  return invoices.filter((invoice) => {
    if (!invoice.issueDate) {
      return false;
    }
    if (startDate && invoice.issueDate < startDate) {
      return false;
    }
    if (endDate && invoice.issueDate > endDate) {
      return false;
    }
    return true;
  });
}

export async function processInvoices(directory, { startDate = null, endDate = null } = {}) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const xmlFiles = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.xml')
    .map((entry) => join(directory, entry.name));

  const invoices = [];

  for (const filePath of xmlFiles) {
    try {
      const parsed = await readXmlFile(filePath);
      const root = Object.values(parsed)[0] ?? parsed;
      const issueDate = extractInvoiceDate(root);
      const summary = extractSummary(root);
      const lineItems = extractLineItems(root);
      const { breakdown, totals: ivaTotals } = aggregateByRate(lineItems);

      const totalIVA = summary.totalIVA || Array.from(breakdown.values()).reduce((acc, value) => acc + value, 0);

      const { clave, consecutivo } = extractIdentifiers(root);

      invoices.push({
        filePath,
        fileName: filePath.split(/[/\\]/).pop(),
        issueDate,
        clave,
        consecutivo,
        totalGravado: summary.totalGravado,
        subtotal: summary.subtotal,
        totalIVA,
        ivaRateTotals: ivaTotals,
        totalComprobante: summary.totalComprobante,
      });
    } catch (error) {
      console.warn(`No se pudo procesar el archivo ${filePath}: ${error.message}`);
    }
  }

  const filteredInvoices = filterByDate(invoices, startDate, endDate);

  const aggregates = filteredInvoices.reduce(
    (acc, invoice) => {
      acc.totalGravado += invoice.totalGravado;
      acc.subtotal += invoice.subtotal;
      acc.totalIVA += invoice.totalIVA;
      acc.totalComprobante += invoice.totalComprobante;
      for (const rate of IVA_RATES_OF_INTEREST) {
        acc.ivaRateTotals[rate] += invoice.ivaRateTotals[rate] ?? 0;
      }
      return acc;
    },
    {
      totalGravado: 0,
      subtotal: 0,
      totalIVA: 0,
      totalComprobante: 0,
      ivaRateTotals: IVA_RATES_OF_INTEREST.reduce((acc, rate) => {
        acc[rate] = 0;
        return acc;
      }, {}),
    },
  );

  return { invoices: filteredInvoices, aggregates };
}
