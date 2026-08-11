import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// Inicializamos OpenAI con tu llave secreta de Vercel
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Inicializamos Supabase con la llave de "Rol de Servicio" (bypassa seguridad para poder actualizar fechas)
const supabaseUrl = "https://drpjcmznauposqlhaveo.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  // Solo aceptamos peticiones POST
  if (req.method !== "POST") return res.status(405).json({ success: false, msg: "Método no permitido" });

  const { local, pin, fotoBase64 } = req.body;

  if (!local || !pin || !fotoBase64) {
    return res.status(400).json({ success: false, msg: "Faltan datos de validación." });
  }

  try {
    // Le damos las instrucciones estrictas a la IA
    const prompt = `Sos un auditor financiero implacable. Analizá esta imagen de un comprobante de transferencia bancaria o billetera virtual de Argentina.
    Reglas de aprobación (DEBEN CUMPLIRSE TODAS):
    1. El monto transferido debe ser EXACTAMENTE $9.000 (nueve mil pesos).
    2. El destinatario debe ser el Alias "noir.elite.ceo" o el nombre "Luis Angel Acosta".
    3. El estado debe indicar claramente que la transferencia fue "exitosa", "aprobada" o "completada".

    Respondé ÚNICAMENTE con un objeto JSON válido con este formato:
    {
      "aprobado": true o false,
      "motivo": "Breve explicación de por qué se aprueba o rechaza"
    }`;

    // Mandamos la foto y el prompt a GPT-4o
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: fotoBase64 } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const iaResult = JSON.parse(response.choices[0].message.content);

    // Si la IA aprueba, actualizamos Supabase
    if (iaResult.aprobado) {
      // Calculamos la fecha actual + 30 días
      const nuevaFecha = new Date();
      nuevaFecha.setDate(nuevaFecha.getDate() + 30);

      const { error } = await supabase
        .from("vigilante_suscripciones")
        .update({
          fecha_vencimiento: nuevaFecha.toISOString(),
          estado: "activo"
        })
        .eq("nombre_local", local)
        .eq("pin_acceso", pin);

      if (error) throw error;

      return res.status(200).json({ success: true, msg: "Transferencia validada. ¡Renovación exitosa por 30 días!" });
    } else {
      // Si la IA rechaza, mandamos el motivo al frontend
      return res.status(200).json({ success: false, msg: iaResult.motivo });
    }
  } catch (error) {
    console.error("Error en validate_payment:", error);
    return res.status(500).json({ success: false, msg: "Error interno al procesar el comprobante." });
  }
}

