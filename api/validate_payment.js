export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'Método no permitido' });

    try {
        const { local, fotoBase64 } = req.body;
        if (!local || !fotoBase64) return res.status(400).json({ success: false, msg: 'Faltan datos.' });

        const openAiKey = process.env.OPENAI_API_KEY;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!openAiKey || !supabaseKey) return res.status(500).json({ success: false, msg: 'Faltan llaves en Vercel.' });

        const fechaHoy = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

        // ORDEN ESTRICTA PARA VIGILANTE ($9.000)
        const systemPrompt = `Sos un auditor financiero extremadamente estricto. Analizá este comprobante de transferencia bancaria. 
        Tene en cuenta que la fecha de hoy es: ${fechaHoy}.
        
        Debe cumplir TODAS estas condiciones sin excepción:
        1. El monto transferido debe ser EXACTAMENTE $9.000 (nueve mil pesos argentinos).
        2. El destinatario debe ser obligatoriamente: "Luis Angel Acosta" (o variaciones), O el Alias: "noir.elite.ceo", O el CBU: "0110257630025717844115".
        3. ESTADO: Debe ser una transferencia real (Ej: dice "Comprobante de transferencia", "Aprobada", "Exitosa", o tiene un "Id Op."). Rechazá si dice "Programada" o "Pendiente".
        4. ANTIFRAUDE: La fecha del comprobante debe ser de hoy o máximo 48 hs atrás. Si es vieja, rechazá diciendo: "El ticket es viejo o ya fue utilizado."
        
        Devolveme UNICAMENTE un objeto JSON estricto con este formato: {"aprobado": true, "motivo": "Explicación corta"}.
        Si falta un solo dato o algo es sospechoso, respondé {"aprobado": false, "motivo": "Por qué se rechazó"}.`;

        const openAiPayload = {
            model: "gpt-4o",
            messages: [{ role: "user", content: [{ type: "text", text: systemPrompt }, { type: "image_url", image_url: { url: fotoBase64 } }] }],
            response_format: { type: "json_object" },
            max_tokens: 200
        };

        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(openAiPayload)
        });

        const openAiData = await openAiRes.json();
        const iaDecision = JSON.parse(openAiData.choices[0].message.content);

        if (!iaDecision.aprobado) return res.status(200).json({ success: false, msg: "Ticket Rechazado: " + iaDecision.motivo });

        // RENOVACIÓN EN TABLA VIGILANTE_SUSCRIPCIONES
        const supabaseUrl = 'https://drpjcmznauposqlhaveo.supabase.co';
        const nuevaFecha = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
        
        const updateRes = await fetch(`${supabaseUrl}/rest/v1/vigilante_suscripciones?nombre_local=eq.${encodeURIComponent(local)}`, {
            method: 'PATCH',
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ fecha_vencimiento: nuevaFecha, estado: 'premium' })
        });

        if (!updateRes.ok) throw new Error("Error en BD.");
        return res.status(200).json({ success: true, msg: "¡Pago Aprobado y 30 días renovados!" });

    } catch (error) { return res.status(500).json({ success: false, msg: error.message }); }
}
