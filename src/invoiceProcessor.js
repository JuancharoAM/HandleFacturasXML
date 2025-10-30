import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  trimValues: true,
  // Ignore XML declaration and namespaces so tags parse cleanly
  ignoreDeclaration: true,
  ignoreNameSpace: true,
});

const IVA_CODE_TO_RATE = {
  '01': 0,
  '02': 1,
  '03': 2,
  '08': 13,
};

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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function collectAllByKeyDeep(object, keyToFind) {
  const results = [];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === keyToFind) {
        if (Array.isArray(v)) results.push(...v);
        else results.push(v);
      }
      if (v && typeof v === 'object') walk(v);
    }
  }
  walk(object);
  return results;
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
    clave: clave !== undefined && clave !== null ? String(clave) : '',
    consecutivo: numeroConsecutivo !== undefined && numeroConsecutivo !== null ? String(numeroConsecutivo) : '',
  };
}

function resolveIvaRate(impuesto) {
  // Prefer CodigoTarifaIVA per v1.0.2
  const codeRaw = impuesto?.CodigoTarifaIVA ?? impuesto?.codigoTarifaIVA;
  if (codeRaw !== undefined) {
    const code = String(codeRaw).padStart(2, '0');
    if (IVA_CODE_TO_RATE[code] !== undefined) {
      return IVA_CODE_TO_RATE[code];
    }
  }
  // Fallback to Tarifa numeric only if no code match
  const explicitRate = toNumber(impuesto?.Tarifa ?? impuesto?.tarifa ?? impuesto?.Porcentaje);
  if (explicitRate || explicitRate === 0) {
    return explicitRate;
  }
  return null;
}

function aggregateByRate(lineItems, resumen) {
  // Prefer desglose del Resumen; si no viene, usar líneas.
  const ivaByRate = new Map();
  const baseByRate = new Map();
  const addIva = (rate, amount) => {
    const r = rate;
    const a = toNumber(amount);
    if (r === null || r === undefined || !Number.isFinite(a)) return;
    ivaByRate.set(r, (ivaByRate.get(r) ?? 0) + a);
  };
  const addBase = (rate, amount) => {
    const r = rate;
    const a = toNumber(amount);
    if (r === null || r === undefined || !Number.isFinite(a)) return;
    if (r === 0) return; // no base gravada para 0%
    baseByRate.set(r, (baseByRate.get(r) ?? 0) + a);
  };

  // Gather all possible desglose entries robustly
  const candidates = [
    ...(normalizeToArray(resumen?.TotalDesgloseFactura)),
    ...(normalizeToArray(resumen?.TotalDesgloseImpuesto)),
    ...collectAllByKeyDeep(resumen, 'TotalDesgloseFactura'),
    ...collectAllByKeyDeep(resumen, 'TotalDesgloseImpuesto'),
  ];
  const entries = candidates
    .flatMap((x) => normalizeToArray(x))
    .filter((e) => e && typeof e === 'object');

  let source = 'resumen';
  const seen = new Set();
  for (const entry of entries) {
    const codigo = String(entry?.Codigo ?? entry?.codigo ?? '').padStart(2, '0');
    if (codigo && codigo !== '01') continue; // only IVA
    const rate = resolveIvaRate(entry); // via CodigoTarifaIVA
    const amount = entry?.TotalMontoImpuesto ?? entry?.MontoImpuesto;
    const codeTarifa = String(entry?.CodigoTarifaIVA ?? entry?.codigoTarifaIVA ?? '').padStart(2, '0');
    const key = `${codigo}|${codeTarifa}|${amount}`;
    if (amount !== undefined && !seen.has(key)) {
      seen.add(key);
      addIva(rate, amount);
      if (rate && rate > 0) {
        addBase(rate, amount / (rate / 100));
      }
    }
  }

  // If no valid desglose found in resumen, compute from line items
  if (ivaByRate.size === 0) {
    source = 'lineas';
    for (const line of lineItems || []) {
      const impuestos = normalizeToArray(line?.Impuesto || line?.Impuestos);
      for (const imp of impuestos) {
        const codigo = String(imp?.Codigo ?? imp?.codigo ?? '').padStart(2, '0');
        if (codigo && codigo !== '01') continue; // only IVA
        const rate = resolveIvaRate(imp);
        const amount = imp?.Monto ?? imp?.MontoImpuesto;
        if (rate !== null && rate !== undefined && amount !== undefined) {
          addIva(rate, amount);
          const base = line?.BaseImponible ?? line?.SubTotal ?? line?.MontoTotal ?? line?.MontoTotalLinea ?? 0;
          if (base) addBase(rate, base);
        }
      }
    }
  }

  const ivaTotals = Object.fromEntries(Array.from(ivaByRate.entries()));
  const baseTotals = Object.fromEntries(Array.from(baseByRate.entries()));
  return { breakdown: ivaByRate, totals: ivaTotals, baseTotals, source };
}

function reconcileIvaBreakdown(totalsObj, expectedTotal) {
  const expected = toNumber(expectedTotal);
  const entries = Object.entries(totalsObj || {}).filter(([rate]) => Number(rate) !== 0);
  const sum = entries.reduce((acc, [, val]) => acc + toNumber(val), 0);
  const sumR = round2(sum);
  const expR = round2(expected);

  const info = { adjusted: false, diffApplied: 0, adjustedRate: null, noDesglose: entries.length === 0 };

  if (expR === 0 && sumR === 0) {
    return { totals: totalsObj, info };
  }

  if (sumR === expR || entries.length === 0) {
    // either already matches (within 2 decimals) or no desglose to adjust
    return { totals: totalsObj, info };
  }

  if (sum <= 0) {
    // Nothing to scale; leave as-is but mark discrepancy
    info.adjusted = false;
    info.diffApplied = round2(expR - sumR);
    return { totals: totalsObj, info };
  }

  const scale = expected / sum;
  // Scale and round to 2 decimals, then fix residual on the largest amount
  const sorted = entries
    .map(([rate, val]) => [Number(rate), toNumber(val)])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const adjusted = new Map();
  let running = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const [rate, val] = sorted[i];
    let newVal = val * scale;
    if (i < sorted.length - 1) {
      newVal = round2(newVal);
      running += newVal;
    } else {
      // last takes the residual to ensure exact match in 2 decimals
      newVal = round2(expR - running);
    }
    adjusted.set(rate, newVal);
  }

  const totals = Object.fromEntries(adjusted.entries());
  const adjSum = Object.values(totals).reduce((a, b) => a + b, 0);
  info.adjusted = true;
  info.diffApplied = round2(expR - sumR);
  info.adjustedRate = sorted[0]?.[0] ?? null;
  return { totals, info };
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

function sumIfPresent(values) {
  return values.reduce((acc, value) => acc + toNumber(value), 0);
}

function extractSummary(invoiceData) {
  const resumen = findFirstKeyDeep(invoiceData, 'ResumenFactura');
  if (!resumen) {
    return {
      totalGravado: 0,
      subtotal: 0,
      totalIVA: 0,
      totalComprobante: 0,
      totalExento: 0,
      totalDescuentos: 0,
      resumenRaw: null,
    };
  }

  let totalGravado = toNumber(
    pickFirstAvailable(resumen, [
      'TotalGravado',
      'TotalVentaGravada',
    ]),
  );
  if (!totalGravado) {
    totalGravado = sumIfPresent([
      resumen.TotalServGravados,
      resumen.TotalMercanciasGravadas,
    ]);
  }

  const subtotal = toNumber(
    pickFirstAvailable(resumen, [
      'TotalVenta',
      'TotalVentaNeta',
    ]),
  );

  let totalIVA = toNumber(
    pickFirstAvailable(resumen, [
      'TotalImpuesto',
      'TotalImpuestos',
    ]),
  );
  if (!totalIVA && resumen.TotalDesgloseImpuesto) {
    const desgloseEntries = normalizeToArray(resumen.TotalDesgloseImpuesto);
    totalIVA = desgloseEntries.reduce(
      (acc, entry) => acc + toNumber(entry?.TotalMontoImpuesto ?? entry?.MontoImpuesto ?? entry?.Monto),
      0,
    );
  }

  let totalComprobante = toNumber(
    pickFirstAvailable(resumen, [
      'TotalComprobante',
      'TotalFactura',
      'TotalDocumento',
      'TotalMedioPago',
    ]),
  );
  if (!totalComprobante && resumen.MedioPago) {
    const medios = normalizeToArray(resumen.MedioPago);
    totalComprobante = medios.reduce(
      (acc, medio) => acc + toNumber(medio?.TotalMedioPago ?? medio?.Monto ?? medio?.Total),
      0,
    );
  }
  // Total exento por resumen
  let totalExento = toNumber(
    pickFirstAvailable(resumen, [
      'TotalExento',
    ]),
  );
  if (!totalExento) {
    totalExento = sumIfPresent([
      resumen.TotalServExentos,
      resumen.TotalMercanciasExentas,
    ]);
  }
// Total descuentos por resumen
  let totalDescuentos = toNumber(
    pickFirstAvailable(resumen, [
      'TotalDescuentos',
      'TotalDescuento',
    ]),
  );

  return {
    totalGravado,
    subtotal,
    totalIVA,
    totalComprobante,
    totalExento,
    totalDescuentos,
    resumenRaw: resumen,
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
      const { breakdown, totals: ivaTotalsRaw, baseTotals, source: ivaSource } = aggregateByRate(lineItems, summary.resumenRaw);
      const expectedIvaTotal = toNumber(summary.totalIVA || 0);
      const { totals: ivaTotals, info: ivaInfo } = reconcileIvaBreakdown(ivaTotalsRaw, expectedIvaTotal);

      const totalIVA = expectedIvaTotal || Object.values(ivaTotals).reduce((acc, v) => acc + toNumber(v), 0);

      const { clave, consecutivo } = extractIdentifiers(root);

      const observations = [];
      if (ivaSource === 'lineas') {
        observations.push('Sin desglose de IVA en resumen; desglose basado en líneas.');
      }
      if (ivaInfo.adjusted && Math.abs(ivaInfo.diffApplied) >= 0.01) {
        const rateStr = ivaInfo.adjustedRate != null ? `${ivaInfo.adjustedRate}%` : '';
        observations.push(`Ajuste IVA por tasa (${rateStr}) por diferencia de ${round2(ivaInfo.diffApplied)} para cuadrar TotalImpuesto.`);
      }

      invoices.push({
        filePath,
        fileName: filePath.split(/[\/\\]/).pop(),
        issueDate,
        clave,
        consecutivo,
        totalGravado: summary.totalGravado,
        totalDescuentos: summary.totalDescuentos,
        subtotal: summary.subtotal,
        totalIVA,
        ivaRateTotals: ivaTotals,
        ivaBaseTotals: baseTotals,
        totalComprobante: summary.totalComprobante,
        isExenta: totalIVA === 0 && summary.totalExento > 0,
        exento: summary.totalExento,
        observations: observations.join(' '),
      });
    } catch (error) {
      console.warn(`No se pudo procesar el archivo ${filePath}: ${error.message}`);
    }
  }

  const filteredInvoices = filterByDate(invoices, startDate, endDate);

  const aggregates = filteredInvoices.reduce(
    (acc, invoice) => {
      acc.totalGravado += invoice.totalGravado;
      acc.totalDescuentos += invoice.totalDescuentos;
      acc.totalIVA += invoice.totalIVA;
      acc.totalComprobante += invoice.totalComprobante;
      acc.totalExento += invoice.exento ?? 0;
      for (const [rateStr, amount] of Object.entries(invoice.ivaRateTotals || {})) {
        const rate = Number(rateStr);
        acc.ivaRateTotals[rate] = (acc.ivaRateTotals[rate] ?? 0) + (amount ?? 0);
      }
      for (const [rateStr, base] of Object.entries(invoice.ivaBaseTotals || {})) {
        const rate = Number(rateStr);
        acc.gravadoRateTotals[rate] = (acc.gravadoRateTotals[rate] ?? 0) + (base ?? 0);
      }
      if (invoice.isExenta) {
        acc.exentasCount += 1;
      }
      return acc;
    },
    {
      totalGravado: 0,
      totalDescuentos: 0,
      totalIVA: 0,
      totalComprobante: 0,
      totalExento: 0,
      ivaRateTotals: {},
      gravadoRateTotals: {},
      exentasCount: 0,
    },
  );

  return { invoices: filteredInvoices, aggregates };
}
