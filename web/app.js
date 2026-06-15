const tabs = Array.from(document.querySelectorAll(".tab"));
const forms = {
  scrape: document.querySelector("#scrape-form"),
  compare: document.querySelector("#compare-form")
};
const statusCard = document.querySelector("#status-card");
const resultsTitle = document.querySelector("#results-title");
const resultsSummary = document.querySelector("#results-summary");
const resultsSections = document.querySelector("#results-sections");
const fileLinks = document.querySelector("#file-links");

let activeMode = "scrape";

for (const tab of tabs) {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
}

forms.scrape.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(forms.scrape);
  await runAction({
    mode: "scrape",
    endpoint: "/api/scrape",
    payload: {
      url: formData.get("url")
    }
  });
});

forms.compare.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(forms.compare);
  await runAction({
    mode: "compare",
    endpoint: "/api/compare",
    payload: {
      baseUrl: formData.get("baseUrl"),
      compareUrl: formData.get("compareUrl")
    }
  });
});

function switchMode(mode) {
  activeMode = mode;
  for (const tab of tabs) {
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
  }
  forms.scrape.classList.toggle("is-active", mode === "scrape");
  forms.compare.classList.toggle("is-active", mode === "compare");
}

async function runAction({ mode, endpoint, payload }) {
  setLoadingState(mode);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "The request failed.");
    }

    if (mode === "scrape") {
      renderScrapeResult(data.report, data.files);
      setStatus("success", "Analyse terminée. Le rapport et la documentation ont été générés.");
    } else {
      renderCompareResult(data.comparison, data.files);
      setStatus("success", "Comparaison terminée. Le diff résumé est prêt.");
    }
  } catch (error) {
    setStatus("error", error.message || "Une erreur est survenue.");
  } finally {
    setButtonBusy(false);
  }
}

function setLoadingState(mode) {
  setButtonBusy(true);
  setStatus(
    "loading",
    mode === "scrape"
      ? "Récupération du fichier Chromium et génération de la documentation..."
      : "Comparaison des deux versions en cours..."
  );
}

function setButtonBusy(isBusy) {
  const button = activeMode === "scrape"
    ? forms.scrape.querySelector("button")
    : forms.compare.querySelector("button");
  button.disabled = isBusy;
}

function setStatus(kind, message) {
  statusCard.className = `status-card ${kind}`;
  statusCard.textContent = message;
}

function renderScrapeResult(report, files) {
  resultsTitle.textContent = report.page.filePathLabel;
  renderFileLinks(files);
  renderSummary([
    ["Lignes de code", report.summary.codeLines],
    ["Fichiers voisins", report.summary.neighborFiles],
    ["Includes", report.summary.includes],
    ["Constantes", report.summary.constants],
    ["Fonctions", report.summary.functions],
    ["Classes", report.summary.classes]
  ]);

  const sections = [
    createDocumentationCard(report.documentation),
    createListCard("Fichiers voisins", report.page.neighborFiles),
    createListCard("Includes", report.symbols.includes),
    createListCard("Constantes", report.symbols.constants),
    createListCard("Commentaires", report.symbols.comments),
    createCodeCard("Aperçu du code", report.code)
  ].filter(Boolean);

  replaceSections(sections);
}

function renderCompareResult(comparison, files) {
  resultsTitle.textContent = comparison.base.page.filePathLabel;
  renderFileLinks(files);
  renderSummary([
    ["Lignes base", comparison.diff.baseLineCount],
    ["Lignes compare", comparison.diff.compareLineCount],
    ["Ajouts", comparison.diff.addedCount],
    ["Suppressions", comparison.diff.removedCount]
  ]);

  const changes = comparison.diff.sampleChanges.map((change) => {
    const prefix = change.type === "add" ? "+" : "-";
    const lineNumber = change.type === "add" ? change.compareLine : change.baseLine;
    return `${prefix} ligne ${lineNumber}: ${change.line}`;
  });

  const sections = [
    createDocumentationCard(comparison.documentation),
    createMetaCard("Versions comparées", [
      `Base : ${comparison.base.page.revisionLabel}`,
      `Comparaison : ${comparison.compare.page.revisionLabel}`
    ]),
    createListCard("Échantillon de changements", changes),
    createCodeCard("Aperçu du fichier de base", comparison.base.code),
    createCodeCard("Aperçu du fichier comparé", comparison.compare.code)
  ].filter(Boolean);

  replaceSections(sections);
}

function renderSummary(items) {
  resultsSummary.innerHTML = items
    .map(
      ([label, value]) => `
        <article class="summary-card">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(String(value))}</div>
        </article>
      `
    )
    .join("");
}

function renderFileLinks(files) {
  fileLinks.innerHTML = `
    <a href="file:///${normalizePath(files.markdown)}" target="_blank" rel="noreferrer">Ouvrir le Markdown</a>
    <a href="file:///${normalizePath(files.json)}" target="_blank" rel="noreferrer">Ouvrir le JSON</a>
  `;
}

function replaceSections(sections) {
  resultsSections.classList.remove("empty-state");
  resultsSections.innerHTML = "";
  for (const section of sections) {
    resultsSections.append(section);
  }
}

function createMetaCard(title, items) {
  return createListCard(title, items);
}

function createDocumentationCard(documentation) {
  if (!documentation || !documentation.sections || documentation.sections.length === 0) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "result-card documentation-card";
  card.innerHTML = `<h3>${escapeHtml(documentation.title || "Documentation")}</h3>`;

  for (const section of documentation.sections) {
    const block = document.createElement("section");
    block.className = "doc-section";

    const heading = document.createElement("h4");
    heading.textContent = section.title;
    block.append(heading);

    for (const paragraph of section.body || []) {
      const text = document.createElement("p");
      text.textContent = paragraph;
      block.append(text);
    }

    if (section.bullets && section.bullets.length > 0) {
      const list = document.createElement("ul");
      list.className = "doc-bullets";
      for (const item of section.bullets) {
        const listItem = document.createElement("li");
        listItem.textContent = item;
        list.append(listItem);
      }
      block.append(list);
    }

    card.append(block);
  }

  return card;
}

function createListCard(title, items) {
  if (!items || items.length === 0) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "result-card";
  card.innerHTML = `<h3>${escapeHtml(title)}</h3>`;

  const compact = items.length <= 12 && items.every((item) => item.length < 80);
  if (compact) {
    const wrapper = document.createElement("div");
    wrapper.className = "chips";
    for (const item of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = item;
      wrapper.append(chip);
    }
    card.append(wrapper);
  } else {
    const list = document.createElement("ul");
    list.className = title.includes("changements") ? "changes-list" : "symbol-list";
    for (const item of items) {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      list.append(listItem);
    }
    card.append(list);
  }

  return card;
}

function createCodeCard(title, code) {
  if (!code) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "result-card";
  const preview = code.split("\n").slice(0, 120).join("\n");
  card.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <pre class="code-block">${escapeHtml(preview)}</pre>
  `;
  return card;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
