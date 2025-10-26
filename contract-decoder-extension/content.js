// content-script.js
// Simple, robust content script to detect paths like /terms-and-conditions,
// wait for the page to render, extract text paragraphs, and send to background.

// -------- CONFIG --------
const PATH_PATTERNS = [/^\/legal(?:-and-conditions)?(?:\/|$)/i]; // add more regexes as needed
const SELECTOR_CANDIDATES = [
  'main',
  '[data-testid="terms"]',
  '.terms, .terms-and-conditions, #terms',
  'article',
  '.content',
  'body'
];
const WAIT_TIMEOUT_MS = 5000;    // how long to wait for elements before fallback
const SPA_RENDER_DELAY = 250;    // small delay after navigation events
// ------------------------

/** Return true if location.pathname matches any configured regex */
function pathMatches(href = location.href) {
  try {
    const u = new URL(href);
    return PATH_PATTERNS.some(rx => rx.test(u.pathname));
  } catch (e) {
    return false;
  }
}

/** Wait for selector to appear in DOM (with timeout). Resolves to element or null. */
function waitForSelector(selector, timeout = WAIT_TIMEOUT_MS) {
  return new Promise(resolve => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);

    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true });

    if (timeout > 0) {
      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeout);
    }
  });
}

/** Find the DOM node with the largest visible text among a set of candidates */
function findLargestTextNode() {
  const candidates = Array.from(document.querySelectorAll('div, article, main, section, p'));
  let best = null;
  let bestLen = 0;
  for (const c of candidates) {
    // skip hidden nodes
    if (!(c.offsetWidth || c.offsetHeight || c.getClientRects().length)) continue;
    const text = (c.innerText || '').trim();
    if (text.length > bestLen) {
      best = c;
      bestLen = text.length;
    }
  }
  return best;
}

/** Extract visible paragraph text from a node; returns combined paragraphs string */
function extractParagraphsFromNode(node) {
  if (!node) return '';
  const pList = Array.from(node.querySelectorAll('p'))
    .map(p => p.innerText && p.innerText.trim())
    .filter(Boolean);
  if (pList.length) return pList.join('\n\n');
  // fallback to the node's innerText (visible)
  return (node.innerText || '').trim();
}

/** Process text using Google AI APIs */
async function processText(text) {
  try {
    // Get a summary of the text
    const summary = await (window.__contractDecoder_googleAI ? window.__contractDecoder_googleAI.summarizeText(text) : Promise.reject(new Error('googleAI not loaded')));

    // Generate an explanation using the Prompt API
    const explanationPrompt = `Please explain the following text in simple terms:\n\n${text}`;
    const explanation = await (window.__contractDecoder_googleAI ? window.__contractDecoder_googleAI.generateText(explanationPrompt) : Promise.reject(new Error('googleAI not loaded')));

    return {
      summary,
      explanation,
      originalText: text
    };
  } catch (error) {
    console.error('Error processing text:', error);
    throw error;
  }
}

/** Try a list of selectors, waiting for each briefly; fallback to largest block or body */
async function findAndExtract() {
  for (const sel of SELECTOR_CANDIDATES) {
    const node = await waitForSelector(sel).catch(() => null);
    if (node) {
      const text = extractParagraphsFromNode(node);
      const processed = await processText(text);
      return { 
        sourceSelector: sel, 
        ...processed,
        html: node.innerHTML 
      };
    }
  }

  // fallback heuristics
  const largest = findLargestTextNode();
  if (largest) {
    return { sourceSelector: 'largest-block', text: extractParagraphsFromNode(largest), html: largest.innerHTML };
  }

  // final fallback: whole body
  return { sourceSelector: 'body-fallback', text: (document.body && document.body.innerText) ? document.body.innerText.trim() : '', html: (document.body && document.body.innerHTML) ? document.body.innerHTML : '' };
}

/** Send extracted data to extension background/popup */
function sendExtracted(payload) {
  try {
    chrome.runtime.sendMessage({ action: 'extractedContent', data: payload });
  } catch (e) {
    // runtime or context may not allow sendMessage in rare cases; swallow silently
    console.warn('sendMessage failed', e);
  }
}

/** Main: run extraction if path matches and haven't processed same URL */
let lastProcessed = null;
async function handleIfTarget(url = location.href) {
  if (!pathMatches(url)) return;
  if (lastProcessed === url) return; // cheap dedupe

  lastProcessed = url;
  // small delay for SPA rendering
  await new Promise(r => setTimeout(r, SPA_RENDER_DELAY));

  const extracted = await findAndExtract();
  const payload = {
    url,
    path: (new URL(url)).pathname,
    extracted
  };
  sendExtracted(payload);
  // also expose extracted on window for quick debugging (optional)
  try { window.__lastExtractedTerms = payload; } catch (e) {}
}

// Hook initial page load
handleIfTarget(location.href).catch(console.error);

// Patch history API + popstate to detect SPA navigation
(function patchHistoryEvents(){
  const _push = history.pushState;
  history.pushState = function(...args) {
    const result = _push.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
    return result;
  };
  const _replace = history.replaceState;
  history.replaceState = function(...args) {
    const result = _replace.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
    return result;
  };
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', () => {
    setTimeout(() => handleIfTarget(location.href).catch(console.error), SPA_RENDER_DELAY);
  });
})();

/* ------------------------
   Sidebar UI + Local "AI" (offline, privacy-first)
   - Injects a sidebar when asked (via context menu or extraction)
   - Performs local summarization, rewriter, risk classification, and basic translation
   - No network calls; lightweight heuristics suitable for demo/offline
   ------------------------ */

// Ensure we only inject UI once
let sidebarInjected = false;

function injectStyles() {
  if (document.getElementById('contract-decoder-styles')) return;
  const css = `
    #contract-decoder-sidebar { position: fixed; right: 12px; top: 60px; width: 380px; height: 70vh; background: #fff; border: 1px solid #ccc; box-shadow: 0 6px 24px rgba(0,0,0,0.15); z-index: 2147483647; font-family: Arial, sans-serif; color: #111; }
    #contract-decoder-sidebar header { padding: 10px; background:#0b5fff; color:#fff; display:flex; gap:8px; align-items:center }
    #contract-decoder-sidebar header h3 { margin:0; font-size:14px }
    #contract-decoder-sidebar .body { padding:10px; overflow:auto; height:calc(100% - 110px);} 
    #contract-decoder-sidebar textarea, #contract-decoder-sidebar pre { width:100%; box-sizing:border-box; font-size:13px }
    #contract-decoder-sidebar footer { padding:8px; display:flex; gap:8px; align-items:center; border-top:1px solid #eee }
    .cd-badge { display:inline-block; padding:4px 6px; border-radius:4px; font-size:12px; }
    .cd-safe { background:#e6f7e6; color:#1a7f1a }
    .cd-warning { background:#fff7e6; color:#a66e00 }
    .cd-danger { background:#ffeaea; color:#a10000 }
  `;
  const s = document.createElement('style');
  s.id = 'contract-decoder-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

function createSidebar() {
  if (sidebarInjected) return document.getElementById('contract-decoder-sidebar');
  try { console.debug('Contract Decoder: injecting sidebar'); } catch(e) {}
  injectStyles();
  const sb = document.createElement('aside');
  sb.id = 'contract-decoder-sidebar';
  sb.innerHTML = `
    <header>
      <h3>Contract Decoder</h3>
      <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
        <select id="cd-language" title="Translate output">
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
        <button id="cd-close" title="Close">✕</button>
      </div>
    </header>
    <div class="body">
      <div>
        <label><strong>Input</strong></label>
        <textarea id="cd-input" rows="6" placeholder="Selected or extracted text will appear here..."></textarea>
      </div>
      <div style="margin-top:8px">
        <button id="cd-analyze">Analyze</button>
        <button id="cd-copy">Copy Summary</button>
        <button id="cd-sideby">Side-by-Side</button>
      </div>
      <hr />
      <div>
        <h4>Summary</h4>
        <pre id="cd-summary"></pre>
      </div>
      <div>
        <h4>Plain English</h4>
        <pre id="cd-plain"></pre>
      </div>
      <div>
        <h4>Risk Highlights</h4>
        <div id="cd-risks"></div>
      </div>
    </div>
    <footer>
      <small style="flex:1">Offline • Private • Local</small>
      <small id="cd-confidence"></small>
    </footer>
  `;

  document.body.appendChild(sb);
  sidebarInjected = true;

  // Wire up controls
  sb.querySelector('#cd-close').addEventListener('click', () => { sb.remove(); sidebarInjected = false; });
  sb.querySelector('#cd-analyze').addEventListener('click', () => {
    const txt = sb.querySelector('#cd-input').value || '';
    runPipeline(txt, sb.querySelector('#cd-language').value);
  });
  sb.querySelector('#cd-copy').addEventListener('click', () => {
    const s = sb.querySelector('#cd-summary').innerText;
    navigator.clipboard?.writeText(s).catch(()=>{});
  });
  sb.querySelector('#cd-sideby').addEventListener('click', () => {
    const original = sb.querySelector('#cd-input').value || '';
    const plain = sb.querySelector('#cd-plain').innerText || '';
    alert('Original:\n\n' + original.slice(0,2000) + '\n\nSimplified:\n\n' + plain.slice(0,2000));
  });
  sb.querySelector('#cd-language').addEventListener('change', (e) => {
    const lang = e.target.value;
    const txt = sb.querySelector('#cd-input').value || '';
    runPipeline(txt, lang);
  });

  return sb;
}

/* ----------------
   Lightweight local models (heuristics)
   - localSummarize: extract 3 most representative sentences
   - localRewrite: map legal phrases to plain English
   - localClassify: keyword-based clause risk detector
   - localTranslate: tiny dictionary fallback (only demo)
   ---------------- */

function splitSentences(text) {
  // very small sentence splitter
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function localSummarize(text, maxSentences = 3) {
  if (!text) return '';
  const s = splitSentences(text);
  if (s.length <= maxSentences) return s.join(' ');
  // simple heuristic: pick longest sentences (often containing the core clause)
  const ranked = s.map(sent => ({ sent, len: sent.length })).sort((a,b)=>b.len-a.len);
  const top = ranked.slice(0, maxSentences).map(r=>r.sent);
  return top.join('\n\n');
}

const LEGAL_MAP = [
  [ /\byou (?:agree|acknowledge|consent) to\b/ig, 'you agree to'],
  [ /\bhereby\b/ig, 'this means'],
  [ /\bto the extent permitted by law\b/ig, 'if the law allows it'],
  [ /\bin the event of\b/ig, 'if'],
  [ /\bmay (?:be )?liable for\b/ig, 'could be responsible for'],
  [ /\bthird[- ]?party( data| services| providers)?\b/ig, 'other companies'],
  [ /\bauto-?renew(a|al)?\b/ig, 'auto-renewal (automatic renewal of service or payment)'],
  [ /\bterminate(ion|ing)?\b/ig, 'end/stop'],
];

function localRewrite(text) {
  if (!text) return '';
  let out = text;
  for (const [rx, repl] of LEGAL_MAP) out = out.replace(rx, repl);
  // collapse repeated whitespace
  return out.replace(/\s{2,}/g,' ').trim();
}

function localClassify(text) {
  if (!text) return { overall: 'safe', items: [] };
  const clauses = [];
  const lowered = text.toLowerCase();
  const checks = [
    { key: 'auto-renew', rx: /auto-?renew|renewal/i, level: 'danger', explain: 'Automatic renewal or subscription renewal clause' },
    { key: 'fees', rx: /fee|charge|cost|billing/i, level: 'warning', explain: 'Mentions fees, charges or billing terms' },
    { key: 'data-sharing', rx: /share your data|third[- ]?party|personal data|process personal data/i, level: 'warning', explain: 'Mentions sharing or processing of personal data' },
    { key: 'waiver', rx: /waive|waiver|limit liability|limitation of liability/i, level: 'danger', explain: 'Limits your ability to sue or reduces liability' },
    { key: 'dispute', rx: /arbitration|dispute resolution|class action waiver/i, level: 'warning', explain: 'Requires arbitration or limits dispute options' },
  ];
  for (const c of checks) {
    if (c.rx.test(text)) {
      clauses.push({ id: c.key, level: c.level, explain: c.explain });
    }
  }
  // Fallback overall
  let overall = 'safe';
  if (clauses.some(c=>c.level==='danger')) overall = 'danger';
  else if (clauses.length) overall = 'warning';
  return { overall, items: clauses };
}

// Very small demo translator for English <-> Spanish for a handful of phrases
const TRANSLATIONS = {
  es: {
    'Automatic renewal or subscription renewal clause': 'Cláusula de renovación automática o suscripción',
    'Mentions fees, charges or billing terms': 'Menciona tarifas, cargos o términos de facturación',
    'Mentions sharing or processing of personal data': 'Menciona el intercambio o procesamiento de datos personales',
    'Limits your ability to sue or reduces liability': 'Limita su capacidad para demandar o reduce la responsabilidad',
    'Requires arbitration or limits dispute options': 'Requiere arbitraje o limita las opciones de disputa'
  }
};

function localTranslate(text, lang='en') {
  if (!text) return '';
  if (lang === 'en') return text;
  // very naive: translate known risk explanations and otherwise return original with note
  let out = text;
  for (const [k, v] of Object.entries(TRANSLATIONS[lang] || {})) {
    out = out.replace(new RegExp(k, 'g'), v);
  }
  return out + (out === text ? `\n\n[Translated to ${lang} (approx)]` : '');
}

async function runPipeline(text, lang='en') {
  const sb = createSidebar();
  if (!text) {
    // try to grab selection if none provided
    text = (window.getSelection && window.getSelection().toString()) || '';
  }
  sb.querySelector('#cd-input').value = text;

  // Prefer remote Google AI if API key is present and googleAI is loaded
  const hasAPI = !!(window.__contractDecoder_config && window.__contractDecoder_config.API_KEY && window.__contractDecoder_googleAI);
  let summary = '';
  let plain = '';

  if (hasAPI) {
    try {
      summary = (await window.googleAI.summarizeText(text)) || '';
      plain = (await window.googleAI.generateText(`Please explain the following text in simple terms:\n\n${text}`)) || '';
    } catch (e) {
      console.error('Remote AI failed, falling back to local heuristics:', e);
      summary = localSummarize(text);
      plain = localRewrite(text);
    }
  } else {
    summary = localSummarize(text);
    plain = localRewrite(text);
  }

  // Translation: prefer remote translation when requested and available
  let translatedSummary = '';
  let translatedPlain = '';
  if (lang !== 'en') {
    if (hasAPI) {
      try {
        translatedSummary = await window.googleAI.translateText(summary, lang);
        translatedPlain = await window.googleAI.translateText(plain, lang);
      } catch (e) {
        console.error('Remote translate failed, falling back to local translate:', e);
        translatedSummary = localTranslate(summary, lang);
        translatedPlain = localTranslate(plain, lang);
      }
    } else {
      translatedSummary = localTranslate(summary, lang);
      translatedPlain = localTranslate(plain, lang);
    }
  } else {
    translatedSummary = summary;
    translatedPlain = plain;
  }

  sb.querySelector('#cd-summary').innerText = translatedSummary || '—';
  sb.querySelector('#cd-plain').innerText = translatedPlain || '—';
  const classification = localClassify(text);
  const risksEl = sb.querySelector('#cd-risks');
  risksEl.innerHTML = '';
  for (const it of classification.items) {
    const div = document.createElement('div');
    const cls = it.level === 'danger' ? 'cd-danger' : (it.level === 'warning' ? 'cd-warning' : 'cd-safe');
    div.innerHTML = `<span class="cd-badge ${cls}">${it.level.toUpperCase()}</span> <strong style="margin-left:6px">${localTranslate(it.explain, lang)}</strong>`;
    risksEl.appendChild(div);
  }
  const conf = classification.overall === 'danger' ? 'High risk detected' : (classification.overall === 'warning' ? 'Some issues' : 'Looks safe');
  sb.querySelector('#cd-confidence').innerText = conf;
}

// Listen for messages from background or popup
chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try { console.debug('Contract Decoder: received message', msg); } catch(e) {}
  if (!msg) return;
  if (msg.action === 'analyzeSelection' && msg.text) {
    // show sidebar and run pipeline
    createSidebar();
    runPipeline(msg.text, 'en');
    sendResponse({ ok: true });
  }
  if (msg.action === 'extractedContent' && msg.data) {
    // if background/content extraction sends payload, show sidebar with extracted text
    const txt = msg.data.extracted && (msg.data.extracted.text || '') || '';
    createSidebar();
    runPipeline(txt, 'en');
    sendResponse({ ok: true });
  }
});

