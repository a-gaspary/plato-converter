export const config = { maxDuration: 60 };

const SYSTEM_PROMPT = `You parse Edmentum/PLATO correlation PDFs and return structured JSON only — no prose, no markdown fences, no explanation.

The PDF maps state standards to PLATO course locations (Semester → Unit → Lesson). Extract every standard entry.

Return a JSON object with this exact shape:
{
  "strands": [
    {
      "name": "Reading: Literature",
      "standards": [
        {
          "code": "RL.7.1",
          "text": "Full standard text here.",
          "locations": [
            {
              "semester": "Semester A v4.0",
              "unit": "Unit 1: What Can We Learn from Change?",
              "lessons": ["Lesson title 1", "Lesson title 2"]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
- Group standards under their strand (Reading: Literature, Reading: Informational Text, Writing, Speaking & Listening, Language).
- For each standard, group ALL lessons under the same semester AND unit into one location object. Never repeat the same semester+unit combination for a single standard.
- If a standard says "The selected PLATO curriculum does not address this learning expectation", set locations to an empty array [].
- Preserve the full standard text exactly as written in the PDF.
- Return ONLY the JSON object, nothing else.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pdf, grade, state } = req.body ?? {};

  if (!pdf || typeof pdf !== 'string') {
    return res.status(400).json({ error: 'Missing pdf field (base64 string)' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: API key not set' });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
          { type: 'text', text: `Parse this Edmentum correlation PDF and return the structured JSON. Grade/course: ${grade || 'unknown'}. State: ${state || 'unknown'}.` }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `Anthropic error ${response.status}`;
    return res.status(response.status >= 500 ? 502 : response.status).json({ error: msg });
  }

  const data = await response.json();
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = raw.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch {
    return res.status(502).json({ error: 'Could not parse Claude response. The PDF may be in an unexpected format.' });
  }
}
