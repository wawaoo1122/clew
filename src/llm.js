// Calls an OpenAI-compatible chat completions endpoint (MiMo, Kimi and DeepSeek all speak this format).

function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function chat(provider, key, messages, opts = {}) {
  if (!key) throw new Error('No API key saved for this provider');
  const url = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = { model: provider.model, messages, max_tokens: opts.maxTokens || 4000, stream: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 120000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'api-key': key // MiMo also accepts this header; others ignore it
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The model took too long to answer (timed out)' : 'Could not reach ' + url + ' — ' + e.message);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw.slice(0, 300);
    try { const j = JSON.parse(raw); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch (e) {}
    throw new Error('HTTP ' + res.status + ': ' + msg);
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('The API returned something that is not JSON'); }
  const choice = j.choices && j.choices[0];
  const content = choice && choice.message && choice.message.content;
  const text = Array.isArray(content) ? content.map((c) => c.text || '').join('') : content;
  return { text: stripThinking(text), finish: choice && choice.finish_reason };
}

async function testProvider(provider, key) {
  const r = await chat(provider, key, [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 300, timeoutMs: 45000 });
  return r;
}

// Pull the first JSON object out of a model reply, tolerating ```json fences and chatter around it.
function parseJSON(text) {
  const t = stripThinking(text).replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) throw new Error('The model reply had no JSON in it');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error('The model reply had broken JSON in it');
}

module.exports = { chat, testProvider, parseJSON, stripThinking };
