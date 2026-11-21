# CuidoCadena – MVP

Sitio estático (HTML, CSS, JavaScript) + servicio en Google Apps Script con Google Sheets como base de datos.

## 1. Probarlo ya, sin instalar nada (modo demostración)
1. Abre `index.html` con doble clic, o mejor desde un servidor local: `python3 -m http.server 8000` y entra a http://localhost:8000
2. Abajo aparece la barra oscura de demostración:
   - **Cargar ejemplo**: crea a Rosa Elena (74 años), su cuidadora Laura y tres medicamentos.
   - **Adelantar reloj**: simula que pasan los minutos. El verificador automático corre solo.
   - **Correos enviados**: muestra los correos de alerta simulados.
3. Todo se guarda en el navegador (localStorage). "Reiniciar" borra todo.

## 2. Conectarlo a Google (modo real, correos de verdad)
1. Crea una hoja de cálculo en Google Sheets (nombre: CuidoCadena).
2. Menú **Extensiones > Apps Script**. Borra lo que haya y crea dos archivos con el contenido de `apps-script/Codigo.gs` y `apps-script/Logica.gs`.
3. En Configuración del proyecto activa "Mostrar el archivo de manifiesto" y pega `apps-script/appsscript.json` (zona horaria America/Bogota).
4. Ejecuta `configurarHojas` (crea las 6 hojas) y luego `crearDisparador` (verificación cada 5 minutos). Acepta los permisos (hoja, correo, disparadores).
5. **Implementar > Nueva implementación > Aplicación web**: ejecutar como "Yo", acceso "Cualquier usuario". Copia la URL que termina en `/exec`.
6. Pega esa URL en `js/config.js` en `API_URL`. Con eso la barra de demostración desaparece y el sitio habla con Google.
7. Abre la URL `/exec` en el navegador: debe responder `{"ok":true,"servicio":"CuidoCadena"}`.
8. Si cambias el código, crea una **nueva versión** de la implementación (la URL se mantiene).

Los correos salen de la cuenta de Google que hizo la implementación (cuota de MailApp: 100 al día en cuentas personales).

## 3. Publicarlo
Sube la carpeta (sin `pruebas/`, `capturas/` ni `apps-script/` si no quieres) a Cloudflare Pages, Netlify o GitHub Pages. Es 100 % estático.

## 4. Pruebas
- `node pruebas/logica.test.js` → 24 pruebas unitarias de las reglas.
- `node pruebas/appsscript.test.js` → 22 pruebas de Codigo.gs con un simulador de Google (no reemplaza probar en Google real).
- `python3 pruebas/e2e.py` → 17 pruebas de interfaz con Playwright (genera `capturas/`).

## 5. Estructura
```
index.html registro.html panel.html confirmar.html privacidad.html
css/estilos.css
js/ logica.js config.js demo.js api.js ui.js
img/ logo.svg logo-horizontal.svg
apps-script/ Codigo.gs Logica.gs appsscript.json
pruebas/ capturas/
```
