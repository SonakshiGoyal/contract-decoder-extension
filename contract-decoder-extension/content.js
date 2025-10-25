// console.log("In Content.js")

// window.addEventListener("load", () => {
//     // Access and log the page title
//     const title = document.title;
//     console.log("Page Title:", title);

//     const content = document.getElementsByClassName("bNg8Rb")
//     console.log(content[0].textContent);

//   });

// content-script.js
// Simple, robust content script to detect paths like /terms-and-conditions,
// wait for the page to render, extract text paragraphs, and send to background.

// -------- CONFIG --------
const PATH_PATTERNS = [/^\/terms(?:-and-conditions)?(?:\/|$)/i]; // add more regexes as needed
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

/** Try a list of selectors, waiting for each briefly; fallback to largest block or body */
async function findAndExtract() {
  for (const sel of SELECTOR_CANDIDATES) {
    const node = await waitForSelector(sel).catch(() => null);
    if (node) {
      return { sourceSelector: sel, text: extractParagraphsFromNode(node), html: node.innerHTML };
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
