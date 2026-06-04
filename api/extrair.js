export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'Boundary não encontrado' });

    const boundary = '--' + boundaryMatch[1];
    const parts = buffer.toString('binary').split(boundary);
    let fileBase64 = '';

    for (const part of parts) {
      if (part.includes('filename=')) {
        const dataStart = part.indexOf('\r\n\r\n') + 4;
        const dataEnd = part.lastIndexOf('\r\n');
        fileBase64 = Buffer.from(part.substring(dataStart, dataEnd), 'binary').toString('base64');
        break;
      }
    }

    if (!fileBase64) return res.status(400).json({ error: 'Ficheiro não encontrado' });

    const GEMINI_KEY = process.env.MUSEU_GEMINI;
    if (!GEMINI_KEY) return res.status(500).json({ error: 'MUSEU_GEMINI em falta' });

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

    const prompt = `Analisa este documento e extrai informação. Responde APENAS com este JSON sem texto extra:
{"nome":"","modelo":"","fabricante":"","ano":"","local_uso":"","gentileza":"","codigo":"","descricao":""}`;

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ parts: [
        { text: prompt },
        { inlineData: { mimeType: 'application/pdf', data: fileBase64 } }
      ]}]
    });

    const text = result.text || '';
    const match = text.replace(/```json/g,'').replace(/```/g,'').trim().match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'JSON inválido', raw: text });

    return res.status(200).json(JSON.parse(match[0]));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}