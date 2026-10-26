// Hidden page that waits for "a recipe just arrived" pings on your private ntfy.sh channel
// and wakes the background worker to pick it up. The ping carries no recipe details.
// EventSource reconnects by itself after a network drop or sleep.
const topic = new URLSearchParams(location.search).get("topic");
if (topic) {
  const source = new EventSource(`https://ntfy.sh/${encodeURIComponent(topic)}/sse`);
  source.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.event === "message") chrome.runtime.sendMessage({ type: "phone-ping" }).catch(() => {});
  };
}
