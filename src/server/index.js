import express from "express";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { users } from "./schema.js";

/* CONFIG */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const ENV = process.env;
const PORT = ENV.PORT || 5001;

app.set("trust proxy", 1);
app.use(express.json());

/* HEALTHZ */
app.get("/api/v1/healthz", (req, res) => {
  res.json({ status: 200, success: true });
});

/* App */
app.get("/api/v1/get-all-users", async (req, res) => {
  const results = await db.select().from(users);
  if (results) res.json({ status: 200, items: results });
  res.json({ status: 500, message: "Lấy dữ liệu user thất bại" });
});

/* SERVE REACT BUILD */
const distPath = path.join(__dirname, "..", "");
app.use(express.static(distPath));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/* MESSAGE RUNNING */
app.listen(PORT, () => {
  console.log("Server is running on PORT:", PORT);
});
