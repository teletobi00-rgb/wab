import { startServer } from "./lib/server";

const port = Number(process.env.PORT) || 3000;

startServer({ port }).catch((err) => {
  console.error("server failed to start", err);
  process.exit(1);
});
