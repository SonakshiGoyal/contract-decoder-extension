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
    chrome.storage.local.set({ lastSelection: info.selectionText }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    });
  }
});
