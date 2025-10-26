// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('textInput');
  const result = document.getElementById('result');
  const processBtn = document.getElementById('processBtn');

  // Prefill from last selection stored by background
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['lastSelection'], (data) => {
      if (data && data.lastSelection) input.value = data.lastSelection;
    });
  }

  // Listen for extractedContent messages from content script
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (msg && msg.action === 'extractedContent' && msg.data) {
        const txt = msg.data.extracted && (msg.data.extracted.text || '');
        if (txt) {
          input.value = txt;
        }
      }
    });
  }

  processBtn.addEventListener('click', () => {
    const text = input.value;
    if (!text) {
      alert('Please enter some text.');
      return;
    }
    // For now, just echo text back
    result.innerText = 'You entered:\n\n' + text;
  });
});
