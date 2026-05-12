import path from "path";
import { fileURLToPath } from "url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `server/`). */
export const projectRoot = path.join(serverDir, "..");

export const PORT = Number(process.env.PORT) || 3000;
export const isProd = process.env.NODE_ENV === "production";
