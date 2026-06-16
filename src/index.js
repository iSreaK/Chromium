import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "output";
const SUPPORTED_HOST = "source.chromium.org";
const DEFAULT_HEADERS = {
  "user-agent": "chromium-feature-scraper/1.0 (+educational-project)"
};

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help || (!options.url && !options.source)) {
    process.stdout.write(renderHelp());
    return;
  }

  await ensureDir(path.resolve(options.output));

  if (options.url && options.compareUrl) {
    const comparison = await compareUrls(options.url, options.compareUrl);
    await writeComparisonOutput(comparison, options.output);
    process.stdout.write(
      [
        `Mode: compare-urls`,
        `Base URL: ${options.url}`,
        `Compare URL: ${options.compareUrl}`,
        `Markdown: ${path.resolve(options.output, "chromium-url-comparison.md")}`,
        `JSON: ${path.resolve(options.output, "chromium-url-comparison.json")}`
      ].join("\n")
    );
    return;
  }

  if (options.url) {
    const report = await scrapeUrl(options.url);
    await writeUrlOutput(report, options.output);
    process.stdout.write(
      [
        `Mode: scrape-url`,
        `URL: ${options.url}`,
        `Markdown: ${path.resolve(options.output, "chromium-url-documentation.md")}`,
        `JSON: ${path.resolve(options.output, "chromium-url-report.json")}`
      ].join("\n")
    );
    return;
  }

  const report = await scrapeLocalSource(options.source);
  await writeLocalOutput(report, options.output);
  process.stdout.write(
    [
      `Mode: scrape-local`,
      `Source: ${path.resolve(options.source)}`,
      `Markdown: ${path.resolve(options.output, "permissions-policy-documentation.md")}`,
      `JSON: ${path.resolve(options.output, "permissions-policy-report.json")}`
    ].join("\n")
  );
}

export function parseArgs(argv) {
  const options = {
    help: false,
    output: DEFAULT_OUTPUT,
    source: "",
    url: "",
    compareUrl: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output" && argv[index + 1]) {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === "--source" && argv[index + 1]) {
      options.source = argv[index + 1];
      index += 1;
    } else if (arg === "--url" && argv[index + 1]) {
      options.url = argv[index + 1];
      index += 1;
    } else if (arg === "--compare-url" && argv[index + 1]) {
      options.compareUrl = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

export function renderHelp() {
  return [
    "Chromium Feature Scraper",
    "",
    "Usage:",
    '  node src/index.js --url "https://source.chromium.org/.../file.cc" --output output/url',
    '  node src/index.js --url "https://source.chromium.org/.../old.cc" --compare-url "https://source.chromium.org/.../new.cc" --output output/compare',
    '  node src/index.js --source "fixtures/chromium-sample" --output output/local',
    "",
    "Modes:",
    "  --url           Scrape a source.chromium.org file page and generate documentation",
    "  --compare-url   Compare two source.chromium.org file pages and generate a diff summary",
    "  --source        Scrape a local source tree for Permissions Policy files",
    ""
  ].join("\n");
}

export async function scrapeUrl(inputUrl) {
  const parsedUrl = parseChromiumSourceUrl(inputUrl);
  const derivedUrls = deriveGitilesUrls(parsedUrl);
  const [rawFileResponse, directoryHtml] = await Promise.all([
    fetchText(derivedUrls.rawFileUrl),
    fetchText(derivedUrls.directoryUrl)
  ]);
  const code = decodeBase64Content(rawFileResponse);
  const pageData = parseDirectoryHtml(directoryHtml);
  const symbols = extractCodeSymbols(code);
  const reportBase = {
    generatedAt: new Date().toISOString(),
    mode: "scrape-url",
    url: inputUrl,
    metadata: parsedUrl,
    fetchedFrom: derivedUrls,
    page: {
      repositoryLabel: `${parsedUrl.projectGroup}/${parsedUrl.repoName}`,
      revisionLabel: parsedUrl.revision,
      filePathLabel: parsedUrl.filePath,
      neighborFiles: pageData.neighborFiles
    },
    summary: {
      codeLines: code.split(/\r?\n/).filter(Boolean).length,
      neighborFiles: pageData.neighborFiles.length,
      includes: symbols.includes.length,
      constants: symbols.constants.length,
      functions: symbols.functions.length,
      classes: symbols.classes.length
    },
    code,
    symbols
  };
  const documentation = buildUrlDocumentation(reportBase);
  const report = {
    ...reportBase,
    documentation,
    recommendations: buildSmartRecommendations(reportBase)
  };

  return {
    ...report,
    markdown: renderUrlMarkdown(report)
  };
}

export async function compareUrls(baseUrl, compareUrl) {
  const [baseReport, compareReport] = await Promise.all([
    scrapeUrl(baseUrl),
    scrapeUrl(compareUrl)
  ]);

  const diff = computeLineDiff(baseReport.code, compareReport.code);
  const comparison = {
    generatedAt: new Date().toISOString(),
    mode: "compare-urls",
    base: baseReport,
    compare: compareReport,
    diff,
    documentation: buildComparisonDocumentation({
      base: baseReport,
      compare: compareReport,
      diff
    }),
    recommendations: buildComparisonRecommendations({
      base: baseReport,
      compare: compareReport,
      diff
    })
  };

  return {
    ...comparison,
    markdown: renderComparisonMarkdown(comparison)
  };
}

export async function scrapeLocalSource(sourceRoot) {
  const DEFAULT_FEATURE = "Permissions Policy";
  const DEFAULT_KEYWORDS = [
    "permissions policy",
    "permissionspolicy",
    "permission policy",
    "permissions_policy",
    "permissions-policy",
    "policy-controlled",
    "policy controlled",
    "feature policy"
  ];
  const DEFAULT_EXTENSIONS = new Set([
    ".cc",
    ".h",
    ".hh",
    ".hpp",
    ".idl",
    ".json5",
    ".gn",
    ".gni",
    ".md",
    ".txt"
  ]);

  const absoluteRoot = path.resolve(sourceRoot);
  const files = await collectFiles(absoluteRoot, DEFAULT_EXTENSIONS);
  const analyzedFiles = [];

  for (const filePath of files) {
    const text = await fs.readFile(filePath, "utf8");
    const normalized = text.toLowerCase();
    const keywordHits = DEFAULT_KEYWORDS.filter((keyword) => normalized.includes(keyword));
    const pathScore = scoreLocalFilePath(filePath);
    const contentScore = keywordHits.length;

    if (pathScore === 0 && contentScore === 0) {
      continue;
    }

    analyzedFiles.push({
      relativePath: normalizeSlashes(path.relative(absoluteRoot, filePath)),
      absolutePath: filePath,
      extension: path.extname(filePath).toLowerCase(),
      score: pathScore + contentScore,
      keywordHits,
      ...extractCodeSymbols(text),
      comments: extractCommentSnippets(text)
    });
  }

  const sortedFiles = analyzedFiles.sort((left, right) => right.score - left.score);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "scrape-local",
    feature: DEFAULT_FEATURE,
    sourceRoot: absoluteRoot,
    summary: {
      matchedFiles: sortedFiles.length
    },
    files: sortedFiles
  };

  return {
    ...report,
    markdown: renderLocalMarkdown(report)
  };
}

export async function writeUrlOutput(report, outputRoot) {
  const absoluteOutput = path.resolve(outputRoot);
  await ensureDir(absoluteOutput);
  await fs.writeFile(
    path.join(absoluteOutput, "chromium-url-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(absoluteOutput, "chromium-url-documentation.md"),
    report.markdown ?? renderUrlMarkdown(report),
    "utf8"
  );
}

export async function writeComparisonOutput(comparison, outputRoot) {
  const absoluteOutput = path.resolve(outputRoot);
  await ensureDir(absoluteOutput);
  await fs.writeFile(
    path.join(absoluteOutput, "chromium-url-comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(absoluteOutput, "chromium-url-comparison.md"),
    comparison.markdown ?? renderComparisonMarkdown(comparison),
    "utf8"
  );
}

export async function writeLocalOutput(report, outputRoot) {
  const absoluteOutput = path.resolve(outputRoot);
  await ensureDir(absoluteOutput);
  await fs.writeFile(
    path.join(absoluteOutput, "permissions-policy-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(absoluteOutput, "permissions-policy-documentation.md"),
    report.markdown ?? renderLocalMarkdown(report),
    "utf8"
  );
}

export function parseChromiumSourceUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (url.hostname !== SUPPORTED_HOST) {
    throw new Error(`Unsupported host: ${url.hostname}. Expected ${SUPPORTED_HOST}.`);
  }

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/\+\/([^:]+):(.+)$/);
  if (!match) {
    throw new Error("Unsupported source.chromium.org URL format.");
  }

  const [, hostGroup, projectGroup, repoName, revision, filePath] = match;

  return {
    hostGroup,
    projectGroup,
    repoName,
    revision,
    filePath
  };
}

export function deriveGitilesUrls(parsedUrl) {
  const repoBase = `https://${parsedUrl.projectGroup}.googlesource.com/${parsedUrl.projectGroup}/${parsedUrl.repoName}`;
  const directoryPath = parsedUrl.filePath.includes("/")
    ? parsedUrl.filePath.slice(0, parsedUrl.filePath.lastIndexOf("/") + 1)
    : "";

  return {
    repoBase,
    rawFileUrl: `${repoBase}/+/${parsedUrl.revision}/${parsedUrl.filePath}?format=TEXT`,
    directoryUrl: `${repoBase}/+/${parsedUrl.revision}/${directoryPath}`
  };
}

export function buildSourceUrl({ projectGroup = "chromium", repoName = "src", revision = "main", filePath }) {
  return `https://source.chromium.org/${projectGroup}/${projectGroup}/${repoName}/+/${revision}:${filePath}`;
}

async function fetchText(inputUrl) {
  const response = await fetch(inputUrl, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${inputUrl}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function decodeBase64Content(text) {
  return Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function parseDirectoryHtml(html) {
  const neighborFiles = [];
  const regex = /<a class="FileList-itemLink" [^>]*href="[^"]+">([^<]+)<\/a>/g;

  for (const match of html.matchAll(regex)) {
    neighborFiles.push(decodeHtmlEntities(match[1]).trim());
  }

  return {
    neighborFiles: uniqueStrings(neighborFiles)
  };
}

function extractCodeSymbols(code) {
  return {
    includes: extractMatches(code, /^\s*#include\s+"([^"]+)"/gm, 1),
    classes: extractMatches(code, /^\s*(?:class|struct)\s+([A-Za-z_]\w*)/gm, 1),
    functions: extractFunctions(code),
    constants: extractMatches(
      code,
      /^\s*const\s+(?:char|int|bool|double|float|auto)[^=;]*\s+([A-Za-z_]\w*)\s*(?:\[.*?\])?\s*=/gm,
      1
    ),
    constantPairs: extractConstantPairs(code),
    enums: extractMatches(code, /^\s*enum(?:\s+class)?\s+([A-Za-z_]\w*)/gm, 1),
    comments: extractCommentSnippets(code),
    platformGuards: extractPlatformGuards(code),
    namespaces: extractMatches(code, /^\s*namespace\s+([A-Za-z_:]\w*(?:::[A-Za-z_]\w*)*)\s*\{/gm, 1)
  };
}

function extractConstantPairs(code) {
  const pairs = [];
  const regex = /^\s*const\s+char\s+([A-Za-z_]\w*)\s*\[\]\s*=\s*"([^"]+)";/gm;
  for (const match of code.matchAll(regex)) {
    pairs.push({ name: match[1], value: match[2] });
  }
  return pairs;
}

function extractPlatformGuards(code) {
  const guards = [];
  const regex = /^\s*#if\s+(.+)$/gm;
  for (const match of code.matchAll(regex)) {
    const condition = match[1].trim();
    if (condition.includes("BUILDFLAG(") || condition.includes("defined(")) {
      guards.push(condition);
    }
  }
  return uniqueStrings(guards);
}

function extractFunctions(text) {
  const rawMatches = extractMatches(
    text,
    /^\s*(?:[\w:<>~*&]+\s+)+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\([^;{}]*\)\s*(?:const)?\s*(?:override)?\s*\{/gm,
    1
  );

  return rawMatches.filter((name) => !["if", "for", "while", "switch", "catch"].includes(name));
}

function extractCommentSnippets(text) {
  const snippets = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      snippets.push(trimmed.replace(/^\/\/\s?/, ""));
    }
  }
  return uniqueStrings(snippets).slice(0, 12);
}

function extractMatches(text, regex, groupIndex) {
  const results = [];
  for (const match of text.matchAll(regex)) {
    results.push(match[groupIndex]);
  }
  return uniqueStrings(results);
}

function computeLineDiff(baseCode, compareCode) {
  const baseLines = baseCode.split(/\r?\n/);
  const compareLines = compareCode.split(/\r?\n/);
  const matrix = buildLcsMatrix(baseLines, compareLines);
  const operations = backtrackDiff(matrix, baseLines, compareLines);

  const added = operations.filter((operation) => operation.type === "add");
  const removed = operations.filter((operation) => operation.type === "remove");

  return {
    baseLineCount: baseLines.filter(Boolean).length,
    compareLineCount: compareLines.filter(Boolean).length,
    addedCount: added.length,
    removedCount: removed.length,
    sampleChanges: operations
      .filter((operation) => operation.type !== "same")
      .slice(0, 30)
  };
}

function buildLcsMatrix(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  return matrix;
}

function backtrackDiff(matrix, left, right) {
  const operations = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      operations.push({ type: "same", line: left[i], baseLine: i + 1, compareLine: j + 1 });
      i += 1;
      j += 1;
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      operations.push({ type: "remove", line: left[i], baseLine: i + 1, compareLine: null });
      i += 1;
    } else {
      operations.push({ type: "add", line: right[j], baseLine: null, compareLine: j + 1 });
      j += 1;
    }
  }

  while (i < left.length) {
    operations.push({ type: "remove", line: left[i], baseLine: i + 1, compareLine: null });
    i += 1;
  }

  while (j < right.length) {
    operations.push({ type: "add", line: right[j], baseLine: null, compareLine: j + 1 });
    j += 1;
  }

  return operations;
}

async function collectFiles(rootDir, extensions) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      files.push(...(await collectFiles(fullPath, extensions)));
      continue;
    }
    if (extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldSkipDirectory(name) {
  return new Set([".git", "node_modules", "out", "build", "dist", "output"]).has(name);
}

function scoreLocalFilePath(filePath) {
  const normalizedPath = normalizeSlashes(filePath.toLowerCase());
  let score = 0;
  if (normalizedPath.includes("permissions_policy")) {
    score += 4;
  }
  if (normalizedPath.includes("feature_policy")) {
    score += 2;
  }
  if (normalizedPath.includes("permission")) {
    score += 1;
  }
  return score;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildSmartRecommendations(report) {
  const recommendations = [];
  const filePath = report.page.filePathLabel;
  const revision = report.page.revisionLabel;
  const neighbors = report.page.neighborFiles || [];
  const fileName = filePath.split("/").pop() || filePath;
  const stem = fileName.replace(/\.[^.]+$/, "");
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const directory = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
  const repoArgs = { revision };

  const counterpart = findCounterpart(fileName, neighbors);
  if (counterpart) {
    recommendations.push({
      title: `Ouvrir le fichier lié ${counterpart}`,
      reason: "Le header/source associé est souvent le meilleur prolongement immédiat pour comprendre l'API ou l'implémentation.",
      action: {
        kind: "scrape",
        url: buildSourceUrl({ ...repoArgs, filePath: `${directory}${counterpart}` })
      }
    });
  }

  const testFile = findTestCompanion(stem, neighbors);
  if (testFile) {
    recommendations.push({
      title: `Lire le test ${testFile}`,
      reason: "Le test associé montre souvent les cas importants, les garanties attendues et les scénarios de régression.",
      action: {
        kind: "scrape",
        url: buildSourceUrl({ ...repoArgs, filePath: `${directory}${testFile}` })
      }
    });
  }

  const readmeFile = neighbors.find((entry) => entry === "README.md");
  if (readmeFile) {
    recommendations.push({
      title: "Consulter le README du module",
      reason: "Un README local donne souvent le contexte architectural du dossier et les objectifs du sous-système.",
      action: {
        kind: "scrape",
        url: buildSourceUrl({ ...repoArgs, filePath: `${directory}${readmeFile}` })
      }
    });
  }

  const buildFile = neighbors.find((entry) => entry === "BUILD.gn");
  if (buildFile) {
    recommendations.push({
      title: "Examiner BUILD.gn",
      reason: "Le fichier de build aide à repérer les dépendances, les cibles de test et le périmètre exact du module.",
      action: {
        kind: "scrape",
        url: buildSourceUrl({ ...repoArgs, filePath: `${directory}${buildFile}` })
      }
    });
  }

  const nextInteresting = findInterestingNeighbor(fileName, neighbors);
  if (nextInteresting) {
    recommendations.push({
      title: `Explorer aussi ${nextInteresting}`,
      reason: "Ce voisin semble proche fonctionnellement et peut compléter la lecture du fichier courant.",
      action: {
        kind: "scrape",
        url: buildSourceUrl({ ...repoArgs, filePath: `${directory}${nextInteresting}` })
      }
    });
  }

  if (revision !== "main") {
    recommendations.push({
      title: "Comparer avec main",
      reason: "Comparer la release observée avec la branche principale est un bon moyen de détecter si le fichier est encore actif ou déjà stabilisé.",
      action: {
        kind: "compare",
        baseUrl: buildSourceUrl({ revision, filePath }),
        compareUrl: buildSourceUrl({ revision: "main", filePath })
      }
    });
  }

  if (/^refs\/tags\//.test(revision)) {
    recommendations.push({
      title: "Explorer les versions proches",
      reason: "La vue multi-versions permet d'estimer si ce fichier évolue souvent ou reste stable entre releases majeures.",
      action: {
        kind: "nearby",
        url: buildSourceUrl({ revision, filePath })
      }
    });
  }

  return dedupeRecommendations(recommendations).slice(0, 6);
}

function buildComparisonRecommendations({ base, compare, diff }) {
  const recommendations = [];

  if (diff.addedCount === 0 && diff.removedCount === 0) {
    recommendations.push({
      title: "Explorer les versions proches",
      reason: "Le fichier semble stable sur cette comparaison; une vue sur plusieurs versions majeures dira si cette stabilité se confirme dans le temps.",
      action: {
        kind: "nearby",
        url: base.url
      }
    });
  } else {
    recommendations.push({
      title: "Relire le fichier source de base",
      reason: "Après un diff non trivial, revenir au fichier de base aide à replacer les changements dans leur contexte complet.",
      action: {
        kind: "scrape",
        url: base.url
      }
    });
  }

  recommendations.push(...buildSmartRecommendations(base).filter((entry) => entry.action.kind !== "compare"));

  recommendations.push({
    title: `Analyser directement ${compare.page.revisionLabel}`,
    reason: "Ouvrir la version comparée seule aide à lire sa documentation locale sans être limité au diff.",
    action: {
      kind: "scrape",
      url: compare.url
    }
  });

  return dedupeRecommendations(recommendations).slice(0, 6);
}

function findCounterpart(fileName, neighbors) {
  if (fileName.endsWith(".cc")) {
    const candidate = fileName.replace(/\.cc$/, ".h");
    if (neighbors.includes(candidate)) {
      return candidate;
    }
  }
  if (fileName.endsWith(".h")) {
    const candidate = fileName.replace(/\.h$/, ".cc");
    if (neighbors.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findTestCompanion(stem, neighbors) {
  const candidates = [
    `${stem}_unittest.cc`,
    `${stem}_browsertest.cc`,
    `${stem}_test.cc`
  ];
  return candidates.find((candidate) => neighbors.includes(candidate)) || null;
}

function findInterestingNeighbor(fileName, neighbors) {
  const filtered = neighbors.filter((entry) => entry !== fileName && !entry.endsWith("/"));
  const priorities = [
    /feature/i,
    /manager/i,
    /parser/i,
    /delegate/i,
    /context/i,
    /\.cc$/i,
    /\.h$/i
  ];

  for (const pattern of priorities) {
    const match = filtered.find((entry) => pattern.test(entry));
    if (match) {
      return match;
    }
  }

  return filtered[0] || null;
}

function dedupeRecommendations(recommendations) {
  const seen = new Set();
  const output = [];

  for (const item of recommendations) {
    const key = JSON.stringify(item.action) + item.title;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }

  return output;
}

function buildUrlDocumentation(report) {
  const fileName = report.page.filePathLabel.split("/").pop() || report.page.filePathLabel;
  const folderName = report.page.filePathLabel.includes("/")
    ? report.page.filePathLabel.slice(0, report.page.filePathLabel.lastIndexOf("/"))
    : "(racine)";
  const dominantKind = inferDominantKind(report);
  const includeSummary = summarizeIncludes(report.symbols.includes);
  const constantSummary = summarizeConstants(report.symbols.constants);
  const commentSummary = summarizeComments(report.symbols.comments);
  const semanticInsights = analyzeCodeSemantics(report);

  return {
    title: `${fileName} - documentation automatique`,
    sections: [
      {
        title: "Vue d'ensemble",
        body: [
          `Le fichier \`${report.page.filePathLabel}\` appartient au module \`${folderName}\` du dépôt \`${report.page.repositoryLabel}\`.`,
          `La révision analysée est \`${report.page.revisionLabel}\`. Le scraper l'a classé comme un fichier principalement orienté ${dominantKind}.`
        ]
      },
      {
        title: "Rôle probable du fichier",
        body: [
          inferRoleNarrative(report),
          includeSummary,
          constantSummary
        ]
      },
      {
        title: "Ce que le scraping met en évidence",
        body: [
          `Le fichier contient ${report.summary.codeLines} lignes de code non vides, ${report.summary.includes} include(s), ${report.summary.constants} constante(s), ${report.summary.functions} fonction(s) et ${report.summary.classes} classe(s).`,
          commentSummary,
          inferArchitectureNarrative(report)
        ]
      },
      {
        title: "Ce que le code montre réellement",
        body: semanticInsights.paragraphs,
        bullets: semanticInsights.bullets
      },
      {
        title: "Fichiers voisins à lire ensuite",
        body: [
          buildNeighborReadingAdvice(report.page.neighborFiles)
        ],
        bullets: report.page.neighborFiles.slice(0, 8)
      },
      {
        title: "Conclusion exploitable",
        body: [
          buildAnalysisConclusion(report)
        ]
      }
    ]
  };
}

function analyzeCodeSemantics(report) {
  const paragraphs = [];
  const bullets = [];
  const pairs = report.symbols.constantPairs || [];
  const guards = report.symbols.platformGuards || [];
  const namespace = report.symbols.namespaces?.[0];

  if (namespace) {
    paragraphs.push(`Le fichier déclare sa logique dans l'espace de noms \`${namespace}\`, ce qui confirme son rattachement explicite à ce sous-système.`);
  }

  const categorized = categorizeConstantPairs(pairs);
  if (categorized.total > 0) {
    paragraphs.push(
      `L'analyse des valeurs réellement assignées montre un fichier qui expose surtout des chaînes de configuration utilisables par d'autres couches, plutôt qu'une logique métier complexe exécutée sur place.`
    );

    if (categorized.disable.length > 0) {
      bullets.push(`Contrôles de désactivation repérés : ${categorized.disable.slice(0, 4).map(formatConstantPair).join(", ")}`);
    }
    if (categorized.enable.length > 0) {
      bullets.push(`Contrôles d'activation repérés : ${categorized.enable.slice(0, 4).map(formatConstantPair).join(", ")}`);
    }
    if (categorized.debug.length > 0) {
      bullets.push(`Options de debug ou diagnostic : ${categorized.debug.slice(0, 3).map(formatConstantPair).join(", ")}`);
    }
    if (categorized.process.length > 0) {
      bullets.push(`Types de processus ou rôles exposés : ${categorized.process.slice(0, 5).map(formatConstantPair).join(", ")}`);
    }
  }

  if (guards.length > 0) {
    paragraphs.push(
      `Le code contient des gardes de compilation plateforme, ce qui indique que toutes les options ne s'appliquent pas partout et que le comportement dépend explicitement de l'OS ciblé.`
    );
    bullets.push(`Gardes détectées : ${guards.slice(0, 4).map((value) => `\`${value}\``).join(", ")}`);
  }

  const behaviorSummary = summarizeBehaviorFromComments(report.symbols.comments || []);
  if (behaviorSummary) {
    paragraphs.push(behaviorSummary);
  }

  if (paragraphs.length === 0) {
    paragraphs.push("Le code ne contient pas assez de signaux simples pour déduire un comportement fort, mais sa structure reste exploitable pour orienter une lecture manuelle plus approfondie.");
  }

  return { paragraphs, bullets };
}

function categorizeConstantPairs(pairs) {
  const result = {
    total: pairs.length,
    disable: [],
    enable: [],
    debug: [],
    process: []
  };

  for (const pair of pairs) {
    const text = `${pair.name} ${pair.value}`.toLowerCase();
    if (/(disable|no-)/.test(text)) {
      result.disable.push(pair);
    }
    if (/(enable|allow|add-)/.test(text)) {
      result.enable.push(pair);
    }
    if (/(debug|log|fatal)/.test(text)) {
      result.debug.push(pair);
    }
    if (/(process|renderer|gpu|utility|zygote|service)/.test(text)) {
      result.process.push(pair);
    }
  }

  return result;
}

function formatConstantPair(pair) {
  return `\`${pair.name}\` -> \`${pair.value}\``;
}

function summarizeBehaviorFromComments(comments) {
  const normalized = comments.map((comment) => comment.toLowerCase());
  const found = [];

  if (normalized.some((value) => value.includes("disable"))) {
    found.push("désactivation de comportements");
  }
  if (normalized.some((value) => value.includes("allow"))) {
    found.push("exceptions ou autorisations spécifiques");
  }
  if (normalized.some((value) => value.includes("debug"))) {
    found.push("scénarios de debug");
  }
  if (normalized.some((value) => value.includes("testing"))) {
    found.push("cas d'usage de test");
  }
  if (normalized.some((value) => value.includes("linux") || value.includes("win") || value.includes("mac") || value.includes("android"))) {
    found.push("variantes selon la plateforme");
  }

  if (found.length === 0) {
    return "";
  }

  return `Les commentaires suggèrent que le fichier sert à exprimer surtout ${found.join(", ")}, ce qui donne une lecture plus concrète de son rôle que la seule arborescence.`;
}

function inferDominantKind(report) {
  const pathValue = report.page.filePathLabel.toLowerCase();
  if (pathValue.endsWith("browsertest.cc") || pathValue.endsWith("unittest.cc") || pathValue.includes("test")) {
    return "tests";
  }
  if (report.symbols.constants.length >= report.symbols.functions.length + report.symbols.classes.length) {
    return "déclarations de constantes et configuration";
  }
  if (report.symbols.functions.length > 0 && report.symbols.classes.length === 0) {
    return "implémentation procédurale";
  }
  if (report.symbols.classes.length > 0) {
    return "implémentation orientée objet";
  }
  return "support technique";
}

function inferRoleNarrative(report) {
  const pathValue = report.page.filePathLabel.toLowerCase();
  if (pathValue.includes("switches")) {
    return "Le nom du fichier indique qu'il centralise des switches de ligne de commande ou des drapeaux utilisés par Chromium pour activer, désactiver ou configurer un comportement.";
  }
  if (pathValue.includes("feature")) {
    return "Le fichier semble jouer un rôle de catalogue de features ou de points d'entrée liés à l'activation de comportements.";
  }
  if (pathValue.includes("policy")) {
    return "Le chemin suggère un rôle de définition ou d'application de règles internes au sous-système ciblé.";
  }
  return "Le chemin du fichier suggère un rôle de support au module parent, avec une logique spécialisée concentrée sur un aspect précis du sous-système.";
}

function summarizeIncludes(includes) {
  if (includes.length === 0) {
    return "Aucun include n'a été détecté, ce qui suggère soit un fichier très autonome, soit un exemple très réduit.";
  }

  if (includes.length === 1) {
    return `Le fichier dépend principalement de \`${includes[0]}\`, ce qui donne une bonne piste sur son point d'ancrage dans le module.`;
  }

  return `Les includes montrent que le fichier s'appuie notamment sur ${includes.slice(0, 3).map((value) => `\`${value}\``).join(", ")}${includes.length > 3 ? ", entre autres" : ""}.`;
}

function summarizeConstants(constants) {
  if (constants.length === 0) {
    return "Le scraping n'a pas trouvé de constantes majeures dans ce fichier.";
  }

  if (constants.length <= 4) {
    return `Les constantes extraites (${constants.map((value) => `\`${value}\``).join(", ")}) donnent une vision immédiate des points de configuration exposés.`;
  }

  return `Le nombre élevé de constantes (${constants.length}) indique que ce fichier sert probablement de registre de noms, d'options ou de paramètres publics du module.`;
}

function summarizeComments(comments) {
  if (comments.length === 0) {
    return "Les commentaires ne donnent pas beaucoup de contexte supplémentaire dans cette version.";
  }

  const meaningful = comments.filter((comment) => !comment.toLowerCase().includes("copyright"));
  if (meaningful.length === 0) {
    return "Les commentaires visibles sont surtout structurels et juridiques, avec peu d'explication métier.";
  }

  return `Les commentaires confirment le rôle du fichier, par exemple autour de : ${meaningful.slice(0, 3).map((value) => `"${value}"`).join(", ")}.`;
}

function inferArchitectureNarrative(report) {
  const pathValue = report.page.filePathLabel.toLowerCase();
  if (pathValue.includes("/sandbox/")) {
    return "Architecturalement, ce fichier s'inscrit dans la couche de sandboxing de Chromium, donc dans un sous-système lié à l'isolation et à la sécurité des processus.";
  }
  if (pathValue.includes("/renderer/")) {
    return "Architecturalement, le chemin place ce fichier côté renderer, donc proche de l'exécution web et de Blink.";
  }
  if (pathValue.includes("/browser/")) {
    return "Architecturalement, le chemin le place côté browser process, donc près des décisions globales de navigation, sécurité ou orchestration.";
  }
  return "Architecturalement, le chemin du fichier permet déjà de le rattacher à un sous-système précis de Chromium.";
}

function buildNeighborReadingAdvice(neighborFiles) {
  if (neighborFiles.length === 0) {
    return "Le scraper n'a pas trouvé de fichiers voisins, donc la lecture complémentaire devra partir des includes ou du dossier parent.";
  }

  const preferred = neighborFiles
    .filter((name) => /\.(cc|h|md|gn)$/i.test(name))
    .slice(0, 5);

  if (preferred.length === 0) {
    return "Les voisins repérés peuvent servir à reconstruire le contexte local du module, en particulier les sous-dossiers de plateforme.";
  }

  return `Pour prolonger l'analyse, il est logique d'ouvrir ensuite ${preferred.map((value) => `\`${value}\``).join(", ")}, car ces fichiers partagent le même dossier et donc le même contexte fonctionnel.`;
}

function buildAnalysisConclusion(report) {
  const fileName = report.page.filePathLabel.split("/").pop() || report.page.filePathLabel;
  return `Ce fichier peut être présenté comme une entrée représentative du module étudié. Le scraping montre à la fois son rôle local (${fileName}), ses dépendances immédiates, les symboles qu'il expose et le contexte de dossier dans lequel il s'insère. Cela donne une base crédible pour rédiger une documentation technique sans devoir analyser manuellement tout Chromium.`;
}

function buildComparisonDocumentation(comparison) {
  const filePath = comparison.base.page.filePathLabel;
  const baseRevision = comparison.base.page.revisionLabel;
  const compareRevision = comparison.compare.page.revisionLabel;
  const addedSymbols = comparison.compare.symbols.constants.filter(
    (value) => !comparison.base.symbols.constants.includes(value)
  );
  const removedSymbols = comparison.base.symbols.constants.filter(
    (value) => !comparison.compare.symbols.constants.includes(value)
  );
  const sameFile = comparison.diff.addedCount === 0 && comparison.diff.removedCount === 0;
  const semanticInsights = buildComparisonSemanticInsights(comparison);

  return {
    title: `${filePath} - documentation comparative`,
    sections: [
      {
        title: "Vue d'ensemble de la comparaison",
        body: [
          `La comparaison porte sur le fichier \`${filePath}\` entre les révisions \`${baseRevision}\` et \`${compareRevision}\`.`,
          sameFile
            ? "Le diff calculé n'a pas révélé de changement visible sur le contenu du fichier. Cela suggère une forte stabilité du fichier entre les deux versions analysées."
            : `Le diff révèle ${comparison.diff.addedCount} ajout(s) et ${comparison.diff.removedCount} suppression(s), ce qui montre une évolution concrète du fichier entre les deux versions.`
        ]
      },
      {
        title: "Interprétation technique",
        body: [
          buildComparisonInterpretation(comparison),
          buildSymbolEvolutionNarrative(addedSymbols, removedSymbols),
          buildRevisionReadingAdvice(comparison)
        ]
      },
      {
        title: "Ce que les changements montrent réellement",
        body: semanticInsights.paragraphs,
        bullets: semanticInsights.bullets
      },
      {
        title: "Changements à commenter",
        body: [
          sameFile
            ? "Même sans modification visible, cette comparaison reste utile pour montrer qu'un fichier central peut rester stable entre une release taggée et la branche principale."
            : "Les changements détectés peuvent être utilisés pour commenter l'évolution fonctionnelle, le durcissement technique ou l'ajout de nouveaux cas pris en charge."
        ],
        bullets: comparison.diff.sampleChanges
          .slice(0, 8)
          .map((change) => `${change.type === "add" ? "+" : "-"} ligne ${change.type === "add" ? change.compareLine : change.baseLine}: ${change.line}`)
      },
      {
        title: "Conclusion exploitable",
        body: [
          buildComparisonConclusion(comparison, addedSymbols, removedSymbols)
        ]
      }
    ]
  };
}

function buildComparisonInterpretation(comparison) {
  if (comparison.diff.addedCount === 0 && comparison.diff.removedCount === 0) {
    return "Le fichier semble jouer un rôle suffisamment stable pour ne pas avoir changé entre la version de release étudiée et la branche principale consultée.";
  }

  if (comparison.diff.addedCount > comparison.diff.removedCount) {
    return "La comparaison suggère une phase d'enrichissement du fichier, avec davantage d'ajouts que de suppressions.";
  }

  if (comparison.diff.removedCount > comparison.diff.addedCount) {
    return "La comparaison suggère une simplification ou une rationalisation du fichier, avec davantage de suppressions que d'ajouts.";
  }

  return "La comparaison suggère une réorganisation équilibrée du contenu, avec un volume proche d'ajouts et de suppressions.";
}

function buildComparisonSemanticInsights(comparison) {
  const paragraphs = [];
  const bullets = [];
  const basePairs = comparison.base.symbols.constantPairs || [];
  const comparePairs = comparison.compare.symbols.constantPairs || [];
  const addedPairs = comparePairs.filter(
    (pair) => !basePairs.some((candidate) => candidate.name === pair.name && candidate.value === pair.value)
  );
  const removedPairs = basePairs.filter(
    (pair) => !comparePairs.some((candidate) => candidate.name === pair.name && candidate.value === pair.value)
  );
  const baseGuards = comparison.base.symbols.platformGuards || [];
  const compareGuards = comparison.compare.symbols.platformGuards || [];
  const addedGuards = compareGuards.filter((guard) => !baseGuards.includes(guard));
  const removedGuards = baseGuards.filter((guard) => !compareGuards.includes(guard));
  const baseComments = comparison.base.symbols.comments || [];
  const compareComments = comparison.compare.symbols.comments || [];
  const addedComments = compareComments.filter((comment) => !baseComments.includes(comment));

  if (addedPairs.length === 0 && removedPairs.length === 0 && addedGuards.length === 0 && removedGuards.length === 0 && addedComments.length === 0) {
    paragraphs.push("Au-delà du diff texte, les signaux sémantiques extraits restent eux aussi stables : mêmes constantes repérées, mêmes gardes de compilation et pas de nouveau commentaire métier visible.");
  } else {
    paragraphs.push("Le diff ne montre pas seulement des lignes modifiées : on peut aussi lire ce qui change dans les options exposées, la couverture plateforme et les indices laissés par les commentaires.");
  }

  if (addedPairs.length > 0) {
    paragraphs.push("De nouvelles constantes ou valeurs publiques apparaissent, ce qui suggère que le fichier expose de nouvelles options, variantes ou points de configuration.");
    bullets.push(`Constantes ajoutées : ${addedPairs.slice(0, 6).map(formatConstantPair).join(", ")}`);
  }
  if (removedPairs.length > 0) {
    paragraphs.push("Certaines constantes disparaissent, ce qui peut indiquer un nettoyage d'API, une simplification ou l'abandon d'anciens comportements.");
    bullets.push(`Constantes retirées : ${removedPairs.slice(0, 6).map(formatConstantPair).join(", ")}`);
  }
  if (addedGuards.length > 0 || removedGuards.length > 0) {
    paragraphs.push("Les gardes de compilation ont évolué, ce qui signale un changement de portée entre plateformes ou de stratégie d'activation conditionnelle.");
    if (addedGuards.length > 0) {
      bullets.push(`Gardes ajoutées : ${addedGuards.slice(0, 4).map((value) => `\`${value}\``).join(", ")}`);
    }
    if (removedGuards.length > 0) {
      bullets.push(`Gardes retirées : ${removedGuards.slice(0, 4).map((value) => `\`${value}\``).join(", ")}`);
    }
  }
  if (addedComments.length > 0) {
    paragraphs.push("De nouveaux commentaires utiles sont apparus, ce qui peut refléter l'ajout de contexte, de contraintes ou de cas particuliers à connaître.");
    bullets.push(`Commentaires ajoutés : ${addedComments.slice(0, 3).map((value) => `"${value}"`).join(", ")}`);
  }

  return { paragraphs, bullets };
}

function buildSymbolEvolutionNarrative(addedSymbols, removedSymbols) {
  if (addedSymbols.length === 0 && removedSymbols.length === 0) {
    return "Le jeu de constantes extrait reste inchangé entre les deux versions, ce qui renforce l'idée d'une interface stable pour ce fichier.";
  }

  const parts = [];
  if (addedSymbols.length > 0) {
    parts.push(`Constantes ajoutées : ${addedSymbols.map((value) => `\`${value}\``).join(", ")}`);
  }
  if (removedSymbols.length > 0) {
    parts.push(`Constantes supprimées : ${removedSymbols.map((value) => `\`${value}\``).join(", ")}`);
  }
  return parts.join(". ");
}

function buildRevisionReadingAdvice(comparison) {
  return `Pour une lecture complète, il est pertinent de confronter cette comparaison avec les fichiers voisins du module \`${comparison.base.page.filePathLabel.split("/").slice(0, -1).join("/")}\`, afin de voir si l'évolution est locale ou si elle reflète un changement plus large du sous-système.`;
}

function buildComparisonConclusion(comparison, addedSymbols, removedSymbols) {
  const fileName = comparison.base.page.filePathLabel.split("/").pop() || comparison.base.page.filePathLabel;
  if (comparison.diff.addedCount === 0 && comparison.diff.removedCount === 0) {
    return `Cette comparaison montre que \`${fileName}\` est resté stable entre \`${comparison.base.page.revisionLabel}\` et \`${comparison.compare.page.revisionLabel}\`. C'est un bon argument pour dire que le fichier joue un rôle structurel ou mature dans le module.`;
  }

  return `Cette comparaison montre que \`${fileName}\` évolue entre \`${comparison.base.page.revisionLabel}\` et \`${comparison.compare.page.revisionLabel}\`. Les écarts observés, ainsi que ${addedSymbols.length + removedSymbols.length > 0 ? "l'évolution des symboles extraits" : "les lignes modifiées"}, peuvent servir d'appui concret pour commenter la maintenance du module dans le temps.`;
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function renderUrlMarkdown(report) {
  return [
    "# Chromium URL Scrape Report",
    "",
    "## Source",
    `- URL: \`${report.url}\``,
    `- Repository: \`${report.page.repositoryLabel || `${report.metadata.projectGroup}/${report.metadata.repoName}`}\``,
    `- Revision: \`${report.page.revisionLabel || report.metadata.revision}\``,
    `- File path: \`${report.page.filePathLabel || report.metadata.filePath}\``,
    "",
    "## Summary",
    `- Code lines extracted: ${report.summary.codeLines}`,
    `- Neighbor files found: ${report.summary.neighborFiles}`,
    `- Includes found: ${report.summary.includes}`,
    `- Constants found: ${report.summary.constants}`,
    `- Functions found: ${report.summary.functions}`,
    `- Classes found: ${report.summary.classes}`,
    "",
    "## Documentation",
    ...report.documentation.sections.flatMap((section) => [
      `### ${section.title}`,
      ...section.body.map((paragraph) => paragraph),
      ...(section.bullets ? section.bullets.map((item) => `- ${item}`) : []),
      ""
    ]),
    "## Smart Recommendations",
    ...(report.recommendations.length > 0
      ? report.recommendations.flatMap((item) => [`- ${item.title}: ${item.reason}`])
      : ["- None available"]),
    "",
    "## Neighbor Files",
    ...(report.page.neighborFiles.length > 0
      ? report.page.neighborFiles.map((file) => `- ${file}`)
      : ["- None found"]),
    "",
    "## Extracted Symbols",
    `- Includes: ${report.symbols.includes.join(", ") || "None found"}`,
    `- Constants: ${report.symbols.constants.join(", ") || "None found"}`,
    `- Functions: ${report.symbols.functions.join(", ") || "None found"}`,
    `- Classes: ${report.symbols.classes.join(", ") || "None found"}`,
    `- Enums: ${report.symbols.enums.join(", ") || "None found"}`,
    "",
    "## Comments",
    ...(report.symbols.comments.length > 0
      ? report.symbols.comments.map((comment) => `- ${comment}`)
      : ["- None found"]),
    "",
    "## Code Preview",
    "```cc",
    report.code.split(/\r?\n/).slice(0, 80).join("\n"),
    "```",
    ""
  ].join("\n");
}

export function renderComparisonMarkdown(comparison) {
  return [
    "# Chromium URL Comparison Report",
    "",
    "## Compared Files",
    `- Base revision: \`${comparison.base.page.revisionLabel || comparison.base.metadata.revision}\``,
    `- Compare revision: \`${comparison.compare.page.revisionLabel || comparison.compare.metadata.revision}\``,
    `- File path: \`${comparison.base.page.filePathLabel || comparison.base.metadata.filePath}\``,
    "",
    "## Summary",
    `- Base code lines: ${comparison.diff.baseLineCount}`,
    `- Compare code lines: ${comparison.diff.compareLineCount}`,
    `- Added lines: ${comparison.diff.addedCount}`,
    `- Removed lines: ${comparison.diff.removedCount}`,
    "",
    "## Documentation",
    ...comparison.documentation.sections.flatMap((section) => [
      `### ${section.title}`,
      ...section.body.map((paragraph) => paragraph),
      ...(section.bullets ? section.bullets.map((item) => `- ${item}`) : []),
      ""
    ]),
    "## Smart Recommendations",
    ...(comparison.recommendations.length > 0
      ? comparison.recommendations.map((item) => `- ${item.title}: ${item.reason}`)
      : ["- None available"]),
    "",
    "## Sample Changes",
    ...(comparison.diff.sampleChanges.length > 0
      ? comparison.diff.sampleChanges.map((change) => {
          const prefix = change.type === "add" ? "+" : "-";
          const lineNumber = change.type === "add" ? change.compareLine : change.baseLine;
          return `- ${prefix} line ${lineNumber}: ${change.line}`;
        })
      : ["- No visible changes detected"]),
    ""
  ].join("\n");
}

export function renderLocalMarkdown(report) {
  const lines = [
    "# Permissions Policy Local Scrape Report",
    "",
    `- Source root: \`${report.sourceRoot}\``,
    `- Matched files: ${report.summary.matchedFiles}`,
    "",
    "## Top Files"
  ];

  for (const file of report.files.slice(0, 8)) {
    lines.push(`### \`${file.relativePath}\``);
    lines.push(`- Score: ${file.score}`);
    lines.push(`- Classes: ${file.classes.join(", ") || "None found"}`);
    lines.push(`- Functions: ${file.functions.join(", ") || "None found"}`);
    lines.push(`- Includes: ${file.includes.join(", ") || "None found"}`);
    lines.push(`- Comments: ${file.comments.join("; ") || "None found"}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
