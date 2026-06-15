import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareUrls,
  scrapeUrl,
  writeComparisonOutput,
  writeUrlOutput
} from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "web");
const outputRoot = path.join(projectRoot, "output", "web");
const defaultPort = Number(process.env.PORT || 3211);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/scrape") {
      const body = await readJsonBody(request);
      const url = validateUrl(body.url);
      const report = await scrapeUrl(url);
      await writeUrlOutput(report, path.join(outputRoot, "latest"));

      return sendJson(response, 200, {
        ok: true,
        mode: "scrape-url",
        report,
        files: {
          markdown: path.join(outputRoot, "latest", "chromium-url-documentation.md"),
          json: path.join(outputRoot, "latest", "chromium-url-report.json")
        }
      });
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/compare") {
      const body = await readJsonBody(request);
      const baseUrl = validateUrl(body.baseUrl);
      const compareUrl = validateUrl(body.compareUrl);
      const comparison = await compareUrls(baseUrl, compareUrl);
      await writeComparisonOutput(comparison, path.join(outputRoot, "compare"));

      return sendJson(response, 200, {
        ok: true,
        mode: "compare-urls",
        comparison,
        files: {
          markdown: path.join(outputRoot, "compare", "chromium-url-comparison.md"),
          json: path.join(outputRoot, "compare", "chromium-url-comparison.json")
        }
      });
    }

    if (request.method === "GET") {
      const filePath = resolvePublicFile(requestUrl.pathname);
      if (!filePath) {
        return sendJson(response, 404, { ok: false, error: "Not found" });
      }

      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "content-type": mimeTypes[path.extname(filePath)] || "text/plain; charset=utf-8"
      });
      response.end(content);
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

function resolvePublicFile(requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    return null;
  }

  return filePath;
}

function validateUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Missing Chromium source URL.");
  }
  return value.trim();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return {};
  }
  return JSON.parse(rawBody);
}

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    process.stderr.write(
      `Port ${defaultPort} is already in use. Stop the existing server or run with another port, for example: set PORT=3211 && node src/server.js\n`
    );
    process.exit(1);
  }

  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

server.listen(defaultPort, () => {
  process.stdout.write(`Chromium scraper web app running on http://localhost:${defaultPort}\n`);
});
