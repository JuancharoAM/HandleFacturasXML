# HandleFacturasXML

Aplicación de línea de comandos desarrollada en Node.js para leer facturas electrónicas XML de Costa Rica y generar reportes en formato Excel.

## Requisitos

- Node.js 18 o superior
- Acceso a una carpeta con archivos XML de facturas electrónicas (compras)

## Instalación

```bash
npm install
```

## Uso

Ejecute la aplicación con:

```bash
npm start
```

El asistente le solicitará:

1. **Carpeta de facturas**: Ruta absoluta o relativa donde se encuentran los archivos XML.
2. **Filtro por fechas** *(opcional)*: Si se habilita, deberá indicar fecha inicial y final en formato `YYYY-MM-DD`.

Al finalizar el procesamiento se generará un archivo `reporte-facturas-<timestamp>.xlsx` dentro de la carpeta seleccionada, que contiene:

- Hoja **Facturas** con el detalle por archivo (totales gravados, subtotal, IVA total, IVA por tarifa 1%, 2% y 13%, total del comprobante).
- Hoja **Totales** con el resumen consolidado para el periodo seleccionado.

## Notas

- Los XML que no se puedan analizar se omitirán y se mostrará un aviso en consola.
- Los totales de IVA por tarifa se calculan a partir de los impuestos indicados en cada línea de detalle (`LineaDetalle`).
- Si no se encuentra información de fecha en la factura, el archivo se excluye de los filtros por periodo.
