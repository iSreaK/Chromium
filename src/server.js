import fs from "node:fs/promises";
import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildSourceUrl,
  compareUrls,
  parseChromiumSourceUrl,
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
const execFileAsync = promisify(execFile);
const searchState = {
  ready: false,
  building: null,
  entries: []
};
const tagState = {
  majorCache: new Map()
};
const searchConfig = {
  defaultCompareRevision: "refs/tags/148.0.7778.261",
  defaultRevision: "main"
};
const staticSearchPaths = [
  "sandbox/",
  "sandbox/policy/",
  "sandbox/policy/BUILD.gn",
  "sandbox/policy/features.cc",
  "sandbox/policy/features.h",
  "sandbox/policy/sandbox.cc",
  "sandbox/policy/sandbox.h",
  "sandbox/policy/sandbox_type.cc",
  "sandbox/policy/sandbox_type.h",
  "sandbox/policy/sandbox_type_unittest.cc",
  "sandbox/policy/switches.cc",
  "sandbox/policy/switches.h",
  "content/",
  "content/browser/",
  "content/browser/service_worker/",
  "content/browser/service_worker/service_worker_context_core.cc",
  "content/browser/service_worker/service_worker_context_core.h",
  "content/browser/webrtc/",
  "content/browser/webrtc/webrtc_internals.cc",
  "content/browser/webrtc/webrtc_internals.h",
  "content/public/browser/",
  "content/public/browser/service_worker_context.h",
  "chrome/",
  "chrome/browser/",
  "chrome/browser/autofill/",
  "chrome/browser/autofill/autofill_assistant/",
  "chrome/browser/autofill/autofill_ai/",
  "chrome/browser/password_manager/",
  "chrome/browser/permissions/",
  "chrome/browser/permissions/permission_request_manager.cc",
  "chrome/browser/permissions/permission_request_manager.h",
  "chrome/browser/ui/webui/",
  "components/",
  "components/autofill/",
  "components/autofill/core/",
  "components/autofill/core/browser/",
  "components/autofill/core/browser/autofill_manager.cc",
  "components/autofill/core/browser/autofill_manager.h",
  "components/autofill/core/browser/form_parsing/",
  "components/permissions/",
  "components/permissions/permission_request_data.cc",
  "components/permissions/permission_request_data.h",
  "components/webrtc/",
  "components/webrtc_logging/",
  "components/safe_browsing/",
  "components/password_manager/",
  "components/signin/",
  "components/translate/",
  "components/optimization_guide/",
  "components/optimization_guide/core/",
  "components/segmentation_platform/",
  "services/",
  "services/network/",
  "services/network/public/",
  "services/network/public/cpp/",
  "services/network/public/cpp/permissions_policy/",
  "services/network/public/cpp/permissions_policy/permissions_policy.cc",
  "services/network/public/cpp/permissions_policy/permissions_policy.h",
  "services/network/public/cpp/permissions_policy/permissions_policy_declaration.cc",
  "services/network/public/cpp/permissions_policy/permissions_policy_declaration.h",
  "services/network/public/cpp/permissions_policy/permissions_policy_features.json5",
  "services/network/public/mojom/",
  "services/network/public/mojom/web_sandbox_flags.mojom",
  "third_party/blink/",
  "third_party/blink/common/",
  "third_party/blink/common/features.cc",
  "third_party/blink/common/features.h",
  "third_party/blink/public/",
  "third_party/blink/public/common/",
  "third_party/blink/public/common/permissions_policy/",
  "third_party/blink/public/common/permissions_policy/permissions_policy.cc",
  "third_party/blink/public/common/permissions_policy/permissions_policy.h",
  "third_party/blink/public/common/permissions_policy/permissions_policy_declaration.cc",
  "third_party/blink/public/common/permissions_policy/permissions_policy_declaration.h",
  "third_party/blink/public/common/features_generated.h",
  "third_party/blink/renderer/",
  "third_party/blink/renderer/core/",
  "third_party/blink/renderer/core/frame/",
  "third_party/blink/renderer/core/frame/csp/",
  "third_party/blink/renderer/core/permissions_policy/",
  "third_party/blink/renderer/core/permissions_policy/permissions_policy.cc",
  "third_party/blink/renderer/core/permissions_policy/permissions_policy.h",
  "third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.cc",
  "third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.h",
  "third_party/blink/renderer/modules/",
  "third_party/blink/renderer/modules/webrtc/",
  "third_party/blink/renderer/modules/webrtc/rtc_peer_connection.cc",
  "third_party/blink/renderer/modules/webrtc/rtc_peer_connection.h",
  "docs/",
  "docs/security/",
  "docs/security/sandbox.md",
  "docs/privacy/",
  "docs/privacy/sandbox/",
  "docs/accessibility/",
  "docs/testing/"
];

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

    if (request.method === "POST" && requestUrl.pathname === "/api/search") {
      const body = await readJsonBody(request);
      const topic = validateSearchTopic(body.topic);
      const revision = typeof body.revision === "string" && body.revision.trim()
        ? body.revision.trim()
        : searchConfig.defaultRevision;
      const results = await searchChromiumTopic(topic, revision);

      return sendJson(response, 200, {
        ok: true,
        mode: "search",
        topic,
        revision,
        results
      });
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/nearby-versions") {
      const body = await readJsonBody(request);
      const url = validateUrl(body.url);
      const nearbyReport = await buildNearbyVersionsReport(url);
      await writeNearbyVersionsOutput(nearbyReport, path.join(outputRoot, "nearby"));

      return sendJson(response, 200, {
        ok: true,
        mode: "nearby-versions",
        nearby: nearbyReport,
        files: {
          markdown: path.join(outputRoot, "nearby", "chromium-nearby-versions.md"),
          json: path.join(outputRoot, "nearby", "chromium-nearby-versions.json")
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

function validateSearchTopic(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Missing search topic.");
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

async function searchChromiumTopic(topic, revision) {
  const index = await ensureSearchIndex(revision);
  const tokens = normalizeSearchTokens(topic);
  const ranked = [];

  for (const entry of index) {
    const score = scoreSearchEntry(entry, tokens);
    if (score <= 0) {
      continue;
    }

    ranked.push({
      score,
      path: entry.path,
      type: entry.type,
      revision,
      url: buildSourceUrl({ revision, filePath: entry.path }),
      compareUrl: buildSourceUrl({ revision: searchConfig.defaultCompareRevision, filePath: entry.path }),
      reason: explainSearchMatch(entry, tokens)
    });
  }

  return ranked
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, 18);
}

async function buildNearbyVersionsReport(inputUrl) {
  const parsed = parseChromiumSourceUrl(inputUrl);
  const currentVersion = extractTaggedVersion(parsed.revision);
  if (!currentVersion) {
    throw new Error("The nearby versions feature currently expects a URL that points to a tagged Chromium version.");
  }

  const currentMajor = Number(currentVersion.split(".")[0]);
  const majorWindow = [currentMajor - 2, currentMajor - 1, currentMajor, currentMajor + 1].filter((value) => value > 0);
  const majorTags = await Promise.all(majorWindow.map((major) => getLatestTagForMajor(major)));
  const candidates = [];

  candidates.push({
    label: "Version actuelle",
    revision: parsed.revision,
    url: inputUrl,
    major: currentMajor
  });

  for (const entry of majorTags) {
    if (!entry) {
      continue;
    }

    const revision = `refs/tags/${entry.tag}`;
    if (revision === parsed.revision) {
      continue;
    }

    candidates.push({
      label: entry.major === currentMajor ? `Dernier tag majeur ${entry.major}` : `Majeure voisine ${entry.major}`,
      revision,
      url: buildSourceUrl({ revision, filePath: parsed.filePath }),
      major: entry.major
    });
  }

  candidates.push({
    label: "Branche main",
    revision: "main",
    url: buildSourceUrl({ revision: "main", filePath: parsed.filePath }),
    major: null
  });

  const dedupedCandidates = dedupeCandidates(candidates);
  const comparisons = [];

  for (const candidate of dedupedCandidates) {
    if (candidate.revision === parsed.revision) {
      comparisons.push({
        label: candidate.label,
        revision: candidate.revision,
        url: candidate.url,
        status: "current",
        summary: "Version de référence utilisée pour l'analyse."
      });
      continue;
    }

    try {
      const comparison = await compareUrls(inputUrl, candidate.url);
      comparisons.push({
        label: candidate.label,
        revision: candidate.revision,
        url: candidate.url,
        status: "ok",
        summary: summarizeComparisonForTimeline(comparison),
        diff: comparison.diff,
        documentation: comparison.documentation
      });
    } catch (error) {
      comparisons.push({
        label: candidate.label,
        revision: candidate.revision,
        url: candidate.url,
        status: "unavailable",
        summary: error instanceof Error ? error.message : "Comparison unavailable"
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "nearby-versions",
    source: {
      url: inputUrl,
      revision: parsed.revision,
      filePath: parsed.filePath,
      version: currentVersion
    },
    summary: {
      candidates: comparisons.length,
      compared: comparisons.filter((entry) => entry.status === "ok").length,
      unchanged: comparisons.filter((entry) => entry.status === "ok" && entry.diff.addedCount === 0 && entry.diff.removedCount === 0).length,
      changed: comparisons.filter((entry) => entry.status === "ok" && (entry.diff.addedCount > 0 || entry.diff.removedCount > 0)).length
    },
    comparisons
  };

  report.documentation = buildNearbyDocumentation(report);
  report.markdown = renderNearbyMarkdown(report);
  return report;
}

function extractTaggedVersion(revision) {
  const match = revision.match(/^refs\/tags\/(\d+\.\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

async function getLatestTagForMajor(major) {
  if (tagState.majorCache.has(major)) {
    return tagState.majorCache.get(major);
  }

  const promise = (async () => {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", "--tags", "--refs", "https://chromium.googlesource.com/chromium/src", `refs/tags/${major}*`],
      { maxBuffer: 8 * 1024 * 1024 }
    );

    const tags = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\t")[1]?.replace("refs/tags/", ""))
      .filter((tag) => /^\d+\.\d+\.\d+\.\d+$/.test(tag))
      .sort(compareVersionStrings);

    if (tags.length === 0) {
      return null;
    }

    return {
      major,
      tag: tags[tags.length - 1]
    };
  })();

  tagState.majorCache.set(major, promise);
  return promise;
}

function compareVersionStrings(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const output = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.revision)) {
      continue;
    }
    seen.add(candidate.revision);
    output.push(candidate);
  }

  return output;
}

function summarizeComparisonForTimeline(comparison) {
  if (comparison.diff.addedCount === 0 && comparison.diff.removedCount === 0) {
    return "Aucun changement visible par rapport à l'URL de référence.";
  }

  return `${comparison.diff.addedCount} ajout(s), ${comparison.diff.removedCount} suppression(s), ${comparison.diff.sampleChanges.length} changement(s) mis en avant.`;
}

function buildNearbyDocumentation(report) {
  const stableLabels = report.comparisons
    .filter((entry) => entry.status === "ok" && entry.diff.addedCount === 0 && entry.diff.removedCount === 0)
    .map((entry) => entry.revision);
  const changedLabels = report.comparisons
    .filter((entry) => entry.status === "ok" && (entry.diff.addedCount > 0 || entry.diff.removedCount > 0))
    .map((entry) => entry.revision);

  return {
    title: `${report.source.filePath} - évolution sur versions proches`,
    sections: [
      {
        title: "Vue d'ensemble",
        body: [
          `L'analyse prend comme point de départ le fichier \`${report.source.filePath}\` à la version \`${report.source.revision}\`.`,
          `Le moteur a comparé cette version à des révisions majeures voisines ainsi qu'à \`main\`, afin d'évaluer la stabilité du fichier dans le temps.`
        ]
      },
      {
        title: "Lecture des résultats",
        body: [
          stableLabels.length > 0
            ? `Versions stables repérées : ${stableLabels.map((value) => `\`${value}\``).join(", ")}.`
            : "Aucune version voisine totalement stable n'a été repérée dans cet échantillon.",
          changedLabels.length > 0
            ? `Versions avec changements visibles : ${changedLabels.map((value) => `\`${value}\``).join(", ")}.`
            : "Aucune variation visible n'a été détectée entre les versions effectivement comparées."
        ]
      },
      {
        title: "Intérêt pour le TP",
        body: [
          "Cette vue permet de présenter non seulement le contenu d'un fichier Chromium, mais aussi sa stabilité ou son évolution sur plusieurs releases majeures proches.",
          "C'est un bon angle pour montrer qu'on ne se limite pas à un scraping statique, mais qu'on ajoute une dimension d'historique technique."
        ]
      }
    ]
  };
}

function renderNearbyMarkdown(report) {
  return [
    "# Chromium Nearby Versions Report",
    "",
    "## Source",
    `- URL: \`${report.source.url}\``,
    `- Revision: \`${report.source.revision}\``,
    `- File path: \`${report.source.filePath}\``,
    `- Version: \`${report.source.version}\``,
    "",
    "## Summary",
    `- Candidate revisions: ${report.summary.candidates}`,
    `- Successful comparisons: ${report.summary.compared}`,
    `- Stable comparisons: ${report.summary.unchanged}`,
    `- Changed comparisons: ${report.summary.changed}`,
    "",
    "## Documentation",
    ...report.documentation.sections.flatMap((section) => [
      `### ${section.title}`,
      ...section.body,
      ""
    ]),
    "## Nearby Revisions",
    ...report.comparisons.map((entry) => `- ${entry.label} | ${entry.revision} | ${entry.summary}`),
    ""
  ].join("\n");
}

async function writeNearbyVersionsOutput(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "chromium-nearby-versions.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "chromium-nearby-versions.md"),
    report.markdown,
    "utf8"
  );
}

async function ensureSearchIndex(revision) {
  if (searchState.ready) {
    return searchState.entries;
  }

  if (!searchState.building) {
    searchState.building = Promise.resolve(
      staticSearchPaths.map((entryPath) => ({
        path: entryPath,
        type: entryPath.endsWith("/") ? "directory" : "file",
        normalized: normalizePathForSearch(entryPath)
      }))
    ).then((entries) => {
      searchState.entries = entries;
      searchState.ready = true;
      return entries;
    }).finally(() => {
      searchState.building = null;
    });
  }

  return searchState.building;
}

function normalizeSearchTokens(topic) {
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizePathForSearch(value) {
  return value
    .toLowerCase()
    .replace(/[._/-]+/g, " ")
    .trim();
}

function scoreSearchEntry(entry, tokens) {
  let score = 0;

  for (const token of tokens) {
    if (entry.normalized.includes(token)) {
      score += 4;
    }
    if (entry.path.toLowerCase().includes(`/${token}`) || entry.path.toLowerCase().includes(`${token}.`)) {
      score += 3;
    }
    if (entry.path.toLowerCase().endsWith(`/${token}/`) || entry.path.toLowerCase().endsWith(`/${token}.cc`)) {
      score += 2;
    }
  }

  if (entry.type === "file") {
    score += 1;
  }

  return score;
}

function explainSearchMatch(entry, tokens) {
  const matched = tokens.filter((token) => entry.normalized.includes(token));
  if (matched.length === 0) {
    return "Correspondance approximative sur le chemin du fichier";
  }
  return `Mots-clés repérés dans le chemin : ${matched.join(", ")}`;
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
