const { app, dialog, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();

  // Crear una ventana oculta para evitar problemas en macOS y algunos entornos
  const win = new BrowserWindow({ show: false });

  const result = await dialog.showOpenDialog(win, {
    title: 'Selecciona una carpeta',
    properties: ['openDirectory'] // solo directorios
  });

  if (!result.canceled && result.filePaths && result.filePaths[0]) {
    // Devolver la ruta por stdout para que la lea la app CLI
    process.stdout.write(result.filePaths[0]);
    app.exit(0);
  } else {
    // Usuario canceló
    app.exit(1);
  }
}

run();