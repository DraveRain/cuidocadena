/* Configuración de CuidoCadena.
   API_URL vacío  -> modo demostración: los datos se guardan en este navegador (localStorage)
                     y el verificador y los correos se simulan.
   API_URL con la dirección de la aplicación web de Google Apps Script -> modo real:
                     los datos viven en Google Sheets y las alertas salen por correo. */
window.CC = window.CC || {};
window.CC.config = {
  API_URL: '',
  VERIFICACION_DEMO_SEG: 10   // cada cuántos segundos se simula el disparador de verificación
};
