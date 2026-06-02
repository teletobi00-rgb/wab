// Verifies the cloud-mode Socket.IO token gate: a handshake without the token
// must be rejected, and one with the correct token must connect.
// Usage: node scripts/token-gate-test.cjs <url> <token>
const { io } = require("socket.io-client");

const URL = process.argv[2] || "http://localhost:3001";
const TOKEN = process.argv[3] || "test123";

let done = 0;
const results = {};
function finish() {
  if (++done >= 2) {
    const ok = results.noToken === "rejected" && results.withToken === "connected";
    console.log(`\nRESULT: ${ok ? "PASS ✅ token gate works" : "FAIL ❌"}`);
    process.exit(ok ? 0 : 1);
  }
}

const noTok = io(URL, { auth: {}, transports: ["polling", "websocket"], reconnection: false, timeout: 6000 });
noTok.on("connect", () => { results.noToken = "connected"; console.log("NO-TOKEN  -> connected (BAD: gate open)"); noTok.close(); finish(); });
noTok.on("connect_error", (e) => { results.noToken = "rejected"; console.log("NO-TOKEN  -> rejected:", e.message); noTok.close(); finish(); });

const okTok = io(URL, { auth: { token: TOKEN }, transports: ["polling", "websocket"], reconnection: false, timeout: 6000 });
okTok.on("connect", () => { results.withToken = "connected"; console.log("WITH-TOKEN-> connected (GOOD)"); okTok.close(); finish(); });
okTok.on("connect_error", (e) => { results.withToken = "rejected"; console.log("WITH-TOKEN-> rejected:", e.message, "(BAD)"); okTok.close(); finish(); });

setTimeout(() => { console.log("\nRESULT: FAIL ❌ timeout"); process.exit(1); }, 15000);
