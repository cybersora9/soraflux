// Live e2e: real mouse clicks on every toggle in the "Pełny" panel, checking that the
// document never scrolls (regression: flipping "W poziomie" collapsed the layout to the
// top ~600 px because the hidden checkbox escaped the scroll container).
//
// Usage (Windows, app must not be running - it is single-instance):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
//   Start-Process src-tauri\target\release\soraconverter.exe
//   node scripts\e2e-przelaczniki.mjs [port]
// Exit code 1 if any click scrolled the document.
const port = process.argv[2] || "9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;

// Pełny mode + expanded "Zaawansowane" (that is where the toggles live).
await ev(`[...document.querySelectorAll('button,.segment')].find(e=>e.textContent.trim()==='Pełny')?.click()`);
await sleep(400);
await ev(`[...document.querySelectorAll('summary,button')].find(e=>/Zaawansowane/.test(e.textContent))?.click()`);
await sleep(500);
await ev("window.scrollTo(0,0)");

const count = await ev("document.querySelectorAll('.przelacznik').length");
if (!count) { console.error("no toggles found"); process.exit(2); }
const state = () => ev("JSON.stringify({sy:scrollY,docH:document.documentElement.scrollHeight,ih:innerHeight})").then(JSON.parse);
let bad = 0;
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < count; i++) {
    // scroll the INNER pane like a user would, then click the real coordinates
    await ev(`(()=>{const t=document.querySelectorAll('.przelacznik')[${i}],m=document.querySelector('main.tresc');const r=t.getBoundingClientRect(),mr=m.getBoundingClientRect();if(r.bottom>mr.bottom-70||r.top<mr.top)m.scrollTop+=r.top-mr.top-200})()`);
    await sleep(500);
    const c = JSON.parse(await ev(`(()=>{const t=document.querySelectorAll('.przelacznik')[${i}],q=t.getBoundingClientRect();return JSON.stringify({x:q.x+q.width/2,y:q.y+q.height/2,l:t.textContent.trim().slice(0,28)})})()`));
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 });
    await sleep(500);
    const s = await state();
    const ok = s.sy === 0 && s.docH <= s.ih;
    if (!ok) bad++;
    console.log(`round ${round} #${i} ${c.l.padEnd(30)} scrollY=${s.sy} docH=${s.docH} innerH=${s.ih} ${ok ? "OK" : "BROKEN"}`);
    if (!ok) await ev("window.scrollTo(0,0)");
  }
}
console.log(`${count * 2} clicks, ${bad} broken`);
ws.close();
process.exit(bad ? 1 : 0);
