export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');
  
  const { mensaje } = req.body;
  
  try {
    const respuesta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: mensaje }]
      })
    });
    
    const data = await respuesta.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error con OpenAI' });
  }
}
