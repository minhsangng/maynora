import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

const ENV = process.env;
const sql = neon(ENV.DATABASE_URL);
export const db = drizzle(sql, { schema });