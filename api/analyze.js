// ═══════════════════════════════════════════════
// ATS Resume Analyzer — Vercel Serverless Function
// POST /api/analyze
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
  // ── CORS preflight ───────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── Only allow POST ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── Validate input ───────────────────────────
  const { resume_text, job_description } = req.body || {};
  if (!resume_text || !job_description) {
    return res.status(400).json({ error: 'Both resume_text and job_description are required.' });
  }

  // ── Validate API key ─────────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: GROQ_API_KEY is not set.' });
  }

  // ── System prompt ────────────────────────────
  const systemPrompt = `You are an expert ATS (Applicant Tracking System) resume analyst.
Given a candidate's resume text and a job description, perform a thorough analysis and return ONLY a valid JSON object with exactly these keys:

{
  "ats_score": <number 0-100 representing how well the resume matches the job description>,
  "missing_keywords": [<array of important keywords/phrases from the job description that are missing from the resume>],
  "optimizations": [<array of specific, actionable suggestions to improve the resume's ATS compatibility>]
}

Rules:
- ats_score must be an integer from 0 to 100.
- missing_keywords should contain 5-15 items when applicable.
- optimizations should contain 3-8 specific, actionable bullet-point suggestions.
- Return ONLY the JSON object with no markdown, no code fences, no explanation.`;

  const userPrompt = `=== RESUME TEXT ===
${resume_text.substring(0, 12000)}

=== JOB DESCRIPTION ===
${job_description.substring(0, 6000)}`;

  // ── Call Groq API ────────────────────────────
  try {
    const models = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
    let groqData = null;
    let lastError = null;

    for (const model of models) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 1024
        })
      });

      if (groqRes.ok) {
        groqData = await groqRes.json();
        break;
      }

      const errBody = await groqRes.text();
      lastError = { status: groqRes.status, model, body: errBody };
      console.error(`Groq API error (${model}):`, groqRes.status, errBody);
      if (groqRes.status !== 400) break;
    }

    if (!groqData) {
      const detail = (() => {
        try {
          return JSON.parse(lastError?.body || '{}')?.error?.message || lastError?.body;
        } catch {
          return lastError?.body;
        }
      })();

      return res.status(502).json({
        error: `Groq API returned ${lastError?.status || 500}${detail ? `: ${detail}` : ''}`
      });
    }

    const content  = groqData.choices?.[0]?.message?.content ?? '';

    // ── Parse JSON from response ───────────────
    // Strip any accidental markdown fences
    const cleaned = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse Groq response as JSON:', content);
      return res.status(502).json({ error: 'AI returned an invalid response. Please try again.' });
    }

    // Sanitize & enforce types
    const result = {
      ats_score:        Math.max(0, Math.min(100, Math.round(Number(parsed.ats_score) || 0))),
      missing_keywords: Array.isArray(parsed.missing_keywords) ? parsed.missing_keywords.map(String) : [],
      optimizations:    Array.isArray(parsed.optimizations)    ? parsed.optimizations.map(String)    : []
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again later.' });
  }
}
