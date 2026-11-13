
/* ========================================
   CONFIGURACIÓN GENERAL
======================================== */

const MAX_CARACTERES = 500;
const TIEMPO_ENTRE_ENVIOS = 1500;
const TIEMPO_LIMITE = 30000;

const CLAVE_SESION = "iaNutricion_sessionId";

const AVISO_WEBHOOK =
    "Falta pegar la URL de tu webhook en config.js";

let ultimoEnvio = 0;


/* ========================================
   ELEMENTOS DEL DOM
======================================== */

const formulario = document.getElementById("formulario-chat");
const entrada = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");

const listaMensajes = document.getElementById("lista-mensajes");

const estadoApp = document.getElementById("estado-app");
const textoEstado = document.getElementById("texto-estado");


/* ========================================
   IDENTIFICADOR DE SESIÓN
======================================== */

// Genera un identificador único.
function generarSessionId() {

    if (
        window.crypto &&
        typeof window.crypto.randomUUID === "function"
    ) {
        return window.crypto.randomUUID();
    }

    return Date.now() + "-" +
        Math.random().toString(36).substring(2) + "-" +
        Math.random().toString(36).substring(2);
}


// Recupera la sesión o genera una nueva.
// Si localStorage falla, conserva el identificador en memoria.
function obtenerSessionId() {

    let id = null;

    try {

        id = localStorage.getItem(CLAVE_SESION);

        if (!id) {

            id = generarSessionId();

            localStorage.setItem(CLAVE_SESION, id);
        }

    } catch (error) {

        if (!id) {
            id = generarSessionId();
        }

    }

    return id;
}


// Se genera o recupera una sola vez al iniciar la aplicación.
const sessionId = obtenerSessionId();


/* ========================================
   ESTADOS VISUALES
======================================== */

function actualizarEstado(estado, texto) {

    estadoApp.dataset.estado = estado;
    textoEstado.textContent = texto;
}


// Bloquea los controles mientras se procesa el mensaje.
function bloquearControles(bloquear) {

    entrada.disabled = bloquear;
    botonEnviar.disabled = bloquear;
}


/* ========================================
   MENSAJES DEL CHAT
======================================== */

// Crea mensajes utilizando exclusivamente textContent.
function mostrarMensaje(tipo, texto) {

    const mensaje = document.createElement("article");

    mensaje.classList.add("mensaje");

    if (tipo === "usuario") {

        mensaje.classList.add("mensaje-usuario");

    } else if (tipo === "agente") {

        mensaje.classList.add("mensaje-agente");

    } else {

        mensaje.classList.add("mensaje-sistema");

    }


    // Nombre del emisor.
    const autor = document.createElement("span");

    autor.classList.add("mensaje-autor");

    if (tipo === "usuario") {
        autor.textContent = "Vos";
    } else if (tipo === "agente") {
        autor.textContent = "IA nutricion";
    } else {
        autor.textContent = "Aviso";
    }


    // Contenido del mensaje.
    const contenido = document.createElement("p");

    contenido.classList.add("mensaje-texto");
    contenido.textContent = texto;


    mensaje.appendChild(autor);
    mensaje.appendChild(contenido);

    listaMensajes.appendChild(mensaje);

    // Desplaza el chat hacia el último mensaje.
    listaMensajes.scrollTop = listaMensajes.scrollHeight;

    return mensaje;
}


/* ========================================
   VALIDACIÓN DEL WEBHOOK
======================================== */

function webhookConfigurado() {

    return (
        typeof WEBHOOK_URL === "string" &&
        WEBHOOK_URL.trim() !== "" &&
        !WEBHOOK_URL.includes("ACA VA")
    );

}


/* ========================================
   PAUSA ENTRE ENVÍOS
======================================== */

function esperar(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}


async function respetarPausaEntreEnvios() {

    const ahora = Date.now();

    const tiempoTranscurrido = ahora - ultimoEnvio;

    const espera = Math.max(
        0,
        TIEMPO_ENTRE_ENVIOS - tiempoTranscurrido
    );

    if (espera > 0) {
        await esperar(espera);
    }

    ultimoEnvio = Date.now();

}


/* ========================================
   PROCESAMIENTO DE RESPUESTAS DE MAKE
======================================== */

function procesarRespuesta(texto) {

    // Respuesta vacía.
    if (!texto || texto.trim() === "") {
        return "(respuesta vacía)";
    }

    try {

        const datos = JSON.parse(texto);

        // Si es un objeto JSON, buscamos las propiedades
        // en el orden de prioridad establecido.
        if (
            typeof datos === "object" &&
            datos !== null &&
            !Array.isArray(datos)
        ) {

            const propiedades = [
                "response",
                "respuesta",
                "message",
                "mensaje"
            ];

            for (const propiedad of propiedades) {

                const valor = datos[propiedad];

                if (
                    typeof valor === "string" &&
                    valor.trim() !== ""
                ) {
                    return valor;
                }

            }

            return "Make respondió, pero sin el campo response";
        }

        // JSON válido que no es un objeto.
        return texto;

    } catch (error) {

        // Si no es JSON válido, mostramos el texto original.
        return texto;

    }

}


/* ========================================
   ENVÍO AL WEBHOOK
======================================== */

async function enviarMensaje(evento) {

    evento.preventDefault();

    // Validación de longitud.
    if (entrada.value.length > MAX_CARACTERES) {

        entrada.value = entrada.value.slice(0, MAX_CARACTERES);

        mostrarMensaje(
            "sistema",
            "El mensaje no puede superar los 500 caracteres."
        );

        return;
    }


    const mensaje = entrada.value.trim();

    // No enviamos mensajes vacíos.
    if (!mensaje) {
        return;
    }


    // Comprobamos la URL antes de realizar cualquier petición.
    if (!webhookConfigurado()) {

        mostrarMensaje("sistema", AVISO_WEBHOOK);

        actualizarEstado("error", "Webhook sin configurar");

        return;
    }


    // Mostramos el mensaje del usuario.
    mostrarMensaje("usuario", mensaje);

    entrada.value = "";


    // Bloqueamos los controles.
    bloquearControles(true);

    actualizarEstado("cargando", "Preparando respuesta...");


    let controlador = null;
    let temporizador = null;


    try {

        // Aplicamos la pausa mínima entre envíos.
        await respetarPausaEntreEnvios();


        // Creamos el controlador de cancelación.
        controlador = new AbortController();


        // Límite máximo de espera: 30 segundos.
        temporizador = setTimeout(() => {

            controlador.abort();

        }, TIEMPO_LIMITE);


        actualizarEstado("cargando", "Esperando respuesta...");


        // Fecha actual en formato ISO.
        const fecha = new Date().toISOString();


        // Petición POST a Make.
        // El cuerpo contiene exclusivamente los tres campos requeridos.
        const respuesta = await fetch(WEBHOOK_URL, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                sessionId,
                mensaje,
                fecha
            }),

            signal: controlador.signal

        });


        // Leemos siempre la respuesta como texto.
        const textoRespuesta = await respuesta.text();


        // Gestionamos los errores HTTP.
        if (!respuesta.ok) {

            mostrarMensaje(
                "sistema",
                `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`
            );

            actualizarEstado("error", "Error de comunicación");

            return;
        }


        // Procesamos la respuesta exitosa.
        const resultado = procesarRespuesta(textoRespuesta);


        // Mostramos la respuesta del agente.
        mostrarMensaje("agente", resultado);

        actualizarEstado("exito", "Respuesta recibida");


    } catch (error) {

        // Diferenciamos el tiempo agotado de los errores de red.
        if (error.name === "AbortError") {

            mostrarMensaje(
                "sistema",
                "La solicitud superó el límite de 30 segundos. Intentá nuevamente."
            );

            actualizarEstado("error", "Tiempo agotado");

        } else {

            mostrarMensaje(
                "sistema",
                "No se pudo conectar con Make. Revisá tu conexión a internet y la URL del webhook."
            );

            actualizarEstado("error", "Error de conexión");

        }

    } finally {

        // Limpiamos el temporizador.
        if (temporizador !== null) {
            clearTimeout(temporizador);
        }

        // Restauramos los controles.
        bloquearControles(false);

        // Evitamos que la aplicación quede cargando.
        if (estadoApp.dataset.estado === "cargando") {

            actualizarEstado("listo", "Listo para conversar");

        }

        entrada.focus();

    }

}


/* ========================================
   EVENTOS DE LA INTERFAZ
======================================== */

// Envío mediante el botón.
formulario.addEventListener("submit", enviarMensaje);


// Enter envía el mensaje.
// Shift + Enter permite escribir en una nueva línea.
entrada.addEventListener("keydown", function(evento) {

    if (
        evento.key === "Enter" &&
        !evento.shiftKey &&
        !evento.isComposing
    ) {

        evento.preventDefault();

        if (!botonEnviar.disabled) {
            formulario.requestSubmit();
        }

    }

});


/* ========================================
   INICIALIZACIÓN
======================================== */

actualizarEstado("listo", "Listo para conversar");
