import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY;

        if (!url || !key) {
            return res.status(500).json({ 
                success: false, 
                mensaje: "❌ Vercel no está leyendo las llaves. Dale a 'Redeploy' en Vercel." 
            });
        }

        const supabase = createClient(url, key);
        const { n, p, ap, pr, waLimpio, venc } = req.body;

        if (waLimpio !== 'No especificado' && !waLimpio.includes('*')) {
            const { data: existeWa } = await supabase
                .from('vigilante_suscripciones')
                .select('id')
                .eq('whatsapp', waLimpio)
                .maybeSingle();
            
            if (existeWa) {
                return res.status(400).json({ success: false, mensaje: "❌ ANTIPÍCARO: Este WhatsApp ya tiene una cuenta." });
            }
        }

        const { data: existeCuenta } = await supabase
            .from('vigilante_suscripciones')
            .select('id')
            .eq('nombre_local', n)
            .maybeSingle();

        if (existeCuenta) {
            return res.status(400).json({ success: false, mensaje: "❌ Ese Nombre de Local ya existe. Elegí otro." });
        }

        const { error } = await supabase
            .from('vigilante_suscripciones')
            .insert([{ 
                nombre_local: n, 
                pin_acceso: p, 
                admin_pin: ap, 
                fecha_vencimiento: venc, 
                estado: 'prueba', 
                provincia: pr, 
                whatsapp: waLimpio 
            }]);

        if (error) throw error;

        return res.status(200).json({ success: true });

    } catch (error) {
        return res.status(500).json({ success: false, mensaje: "Error de Servidor: " + error.message });
    }
}

