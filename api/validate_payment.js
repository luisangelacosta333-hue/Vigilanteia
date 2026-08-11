export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'Método no permitido' });

    try {
        const { local, pin, fotoBase64 } = req.body;
        if (!local || !pin || !fotoBase64) return res.status(400).json({ success: false, msg: 'Faltan datos.' });

        const openAiKey = process.env.OPENAI_API_KEY;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!openAiKey || !supabaseKey) {
            let faltantes = [];
            if (!openAiKey) faltantes.push("OPENAI_API_KEY");
            if (!supabaseKey) faltantes.push("SUPABASE_SERVICE_ROLE_KEY");
            return res.status(500).json({ success: false, msg: 'Falta en Vercel: ' + faltantes.join(' y ') });
        }

        const fechaActual = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

        // 1. LA ORDEN ESTRICTA PARA OPENAI (AHORA PIDE EL NÚMERO DE OPERACIÓN)
        const systemPrompt = `Sos un auditor financiero extremadamente estricto. Hoy es la fecha: ${fechaActual}. Analizá este comprobante de transferencia.
        Debe cumplir TODAS estas condiciones:
        1. El monto transferido debe ser EXACTAMENTE $9.000 (nueve mil pesos argentinos).
        2. El destinatario debe ser obligatoriamente: "Luis Ángel Acosta", O el Alias: "noir.elite.ceo", O el CBU: "0110257630025717844115".
        3. El estado debe ser "Aprobada", "Exitosa" o similar. No programadas ni pendientes.
        4. La fecha del comprobante debe ser de los últimos 3 días como máximo (${fechaActual}). No aceptes comprobantes viejos.
        
        Buscá en el comprobante el "Número de Operación", "Código de Transacción" o "ID de transferencia".
        
        Devolveme UNICAMENTE un objeto JSON estricto con este formato: 
        {"aprobado": true, "motivo": "Explicación corta", "numero_operacion": "123456789"}
        Si falta un solo dato o es viejo, respondé: 
        {"aprobado": false, "motivo": "Por qué se rechazó", "numero_operacion": ""}`;

        const openAiPayload = {
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: systemPrompt },
                        { type: "image_url", image_url: { url: fotoBase64 } }
                    ]
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 200
        };

        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openAiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(openAiPayload)
        });

        const openAiData = await openAiRes.json();
        if (!openAiData.choices || !openAiData.choices[0].message) {
            throw new Error("OpenAI no respondió correctamente.");
        }

        const iaDecision = JSON.parse(openAiData.choices[0].message.content);

        // 2. SI LA IA LO RECHAZA DE ENTRADA, CORTAMOS
        if (!iaDecision.aprobado) {
            return res.status(200).json({ success: false, msg: "Ticket Rechazado: " + iaDecision.motivo });
        }

        const supabaseUrl = 'https://drpjcmznauposqlhaveo.supabase.co';

        // 3. CONSULTAMOS LA BASE DE DATOS PARA VER SI EL TICKET YA SE USÓ
        const getUserRes = await fetch(`${supabaseUrl}/rest/v1/vigilante_suscripciones?nombre_local=eq.${encodeURIComponent(local)}&pin_acceso=eq.${encodeURIComponent(pin)}&select=app_data`, {
            method: 'GET',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        const userData = await getUserRes.json();
        if (!userData || userData.length === 0) {
            return res.status(400).json({ success: false, msg: 'Local no encontrado en Supabase.' });
        }

        let appData = userData[0].app_data || {};
        let ticketsUsados = appData.tickets_usados || [];
        let numOperacion = iaDecision.numero_operacion || "DESCONOCIDO";

        // EL CONTROL DE FUEGO: ¿Ya existe el ticket?
        if (numOperacion !== "DESCONOCIDO" && ticketsUsados.includes(numOperacion)) {
            return res.status(200).json({ success: false, msg: "TICKET RECHAZADO: Este comprobante ya fue utilizado anteriormente." });
        }

        // Si es un ticket nuevo, lo guardamos en la lista de quemados
        if (numOperacion !== "DESCONOCIDO") {
            ticketsUsados.push(numOperacion);
            appData.tickets_usados = ticketsUsados;
        }

        // 4. APROBADO: DAMOS LOS 30 DÍAS Y QUEMAMOS EL TICKET EN LA BD
        const nuevaFecha = new Date();
        nuevaFecha.setDate(nuevaFecha.getDate() + 30);

        const updateRes = await fetch(`${supabaseUrl}/rest/v1/vigilante_suscripciones?nombre_local=eq.${encodeURIComponent(local)}&pin_acceso=eq.${encodeURIComponent(pin)}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ 
                fecha_vencimiento: nuevaFecha.toISOString(),
                estado: 'activo',
                app_data: appData // Guardamos el ticket quemado acá
            })
        });

        if (!updateRes.ok) throw new Error("Error al actualizar la base de datos.");

        return res.status(200).json({ success: true, msg: "¡Pago Aprobado y 30 días renovados!" });

    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
}

