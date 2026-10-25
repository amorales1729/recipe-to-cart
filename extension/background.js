// Toolbar button: open (or focus) the Recipe to Cart page.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("cart.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
