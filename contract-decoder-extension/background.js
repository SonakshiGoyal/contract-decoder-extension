// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("Contract Decoder Extension Installed!");
  chrome.contextMenus.create({
    id: "decode-selection",
    title: "Simplify with Contract Decoder",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "decode-selection") {
    // store selection so popup fallback can use it
    chrome.storage.local.set({ lastSelection: info.selectionText }, () => {
      try {
        // If we have a tab, try sending a message to the content script to open the sidebar
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'analyzeSelection', text: info.selectionText }, (resp) => {
            // If there was an error (no content script), fallback to opening the popup page
            if (chrome.runtime.lastError) {
              chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
            }
          });
        } else {
          // fallback: open popup page
          chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
        }
      } catch (e) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      }
    });
  }
});
