const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
]);
const MAX_TOKENS_CEILING = 8000;
const PROXY_TIMEOUT_MS   = 45000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fail fast if key is missing — avoids sending a request that will 401
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI service not configured', retryable: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  // Strip internal flags before forwarding to Anthropic
  const { useSearch, ...cleanBody } = body || {};

  // Validate model — reject unknown models to prevent API key abuse
  if (cleanBody.model && !ALLOWED_MODELS.has(cleanBody.model)) {
    return res.status(400).json({ error: `Model not allowed: ${cleanBody.model}`, retryable: false });
  }

  // Cap max_tokens to prevent runaway costs
  if (cleanBody.max_tokens && cleanBody.max_tokens > MAX_TOKENS_CEILING) {
    cleanBody.max_tokens = MAX_TOKENS_CEILING;
  }

  // Only add web_search tool when the caller explicitly requests it
  // (search queries only — not valuation, QC, DCF, or follow-up calls)
  const payload = useSearch
    ? { ...cleanBody, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }
    : cleanBody;

  // Timeout guard — prevents zombie Vercel function if Anthropic API hangs
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);

  try {
    const anthropicHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    // web_search_20250305 requires the web-search beta header
    if (useSearch) anthropicHeaders['anthropic-beta'] = 'web-search-2025-03-05';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    // Forward Anthropic's status code so the client can distinguish 429/529 from 200
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch(e) {
    clearTimeout(timer);
    const timedOut = e.name === 'AbortError';
    return res.status(timedOut ? 504 : 500).json({
      error: timedOut ? 'AI provider timed out' : e.message,
      retryable: true,
    });
  }
}
