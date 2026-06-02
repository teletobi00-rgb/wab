// Smoke-tests the summarize-chat handler: wrong password rejected, correct
// password passes the gate (then fails on "no messages" since WhatsApp isn't
// connected in this local run — which proves the password + gemini-config gates).
const { io } = require("socket.io-client");
const URL = process.argv[2] || "http://localhost:3003";
const TOKEN = process.argv[3] || "tok";
const s = io(URL, { auth: { token: TOKEN }, transports: ["polling", "websocket"], reconnection: false, timeout: 8000 });

s.on("connect", () => {
  s.emit("summarize-chat", { jid: "x@s.whatsapp.net", password: "0000" }, (wrong) => {
    console.log("WRONG-PW  ->", JSON.stringify(wrong));
    s.emit("summarize-chat", { jid: "x@s.whatsapp.net", password: "1812" }, (right) => {
      console.log("RIGHT-PW  ->", JSON.stringify(right));
      const pass =
        wrong.ok === false &&
        /비밀번호/.test(wrong.error || "") &&
        right.ok === false &&
        !/비밀번호/.test(right.error || ""); // passed pw gate, failed later (no msgs / config)
      console.log(`\nRESULT: ${pass ? "PASS ✅ password gate + handler wired" : "FAIL ❌"}`);
      s.close();
      process.exit(pass ? 0 : 1);
    });
  });
});
s.on("connect_error", (e) => {
  console.log("connect_error:", e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log("timeout");
  process.exit(1);
}, 15000);
