import express from "express";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import handler from "../game.js";
import cronjob from "./cron.js";

/* CONFIG */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const ENV = process.env;
const PORT = ENV.PORT || 5001;

cronjob.start();

app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));
app.all("/api/game", handler);

/* SERVE REACT BUILD */
const distPath = path.join(__dirname, "..", "..", "dist");
app.use(express.static(distPath));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/* MESSAGE RUNNING */
app.listen(PORT, () => {
  console.log("Server is running on PORT:", PORT);
});
