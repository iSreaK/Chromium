const tabs = Array.from(document.querySelectorAll(".tab"));
const forms = {
  search: document.querySelector("#search-form"),
  scrape: document.querySelector("#scrape-form"),
  compare: document.querySelector("#compare-form"),
  nearby: document.querySelector("#nearby-form")
};
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const statusCard = document.querySelector("#status-card");
const resultsTitle = document.querySelector("#results-title");
const resultsSummary = document.querySelector("#results-summary");
const resultsSections = document.querySelector("#results-sections");
const fileLinks = document.querySelector("#file-links");

let activeMode = "scrape";

for (const tab of tabs) {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
}

forms.search.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(forms.search);
  await runSearch(String(formData.get("topic") || ""));
});

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

forms.nearby.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(forms.nearby);
  await runAction({
    mode: "nearby",
    endpoint: "/api/nearby-versions",
    payload: {
      url: formData.get("url")
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
  forms.nearby.classList.toggle("is-active", mode === "nearby");
}

async function runSearch(topic) {
  const submitButton = forms.search.querySelector("button");
  submitButton.disabled = true;
  searchStatus.textContent = "Recherche des chemins Chromium en cours...";

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ topic })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "La recherche a échoué.");
    }

    renderSearchResults(data.topic, data.results);
    searchStatus.textContent = `${data.results.length} proposition(s) trouvée(s) pour "${data.topic}".`;
  } catch (error) {
    searchStatus.textContent = error.message || "Une erreur est survenue pendant la recherche.";
  } finally {
    submitButton.disabled = false;
  }
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
    } else if (mode === "compare") {
      renderCompareResult(data.comparison, data.files);
      setStatus("success", "Comparaison terminée. Le diff résumé est prêt.");
    } else {
      renderNearbyResult(data.nearby, data.files);
      setStatus("success", "Analyse des versions proches terminée.");
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
      : mode === "compare"
        ? "Comparaison des deux versions en cours..."
        : "Comparaison des versions majeures proches en cours..."
  );
}

function setButtonBusy(isBusy) {
  const button = forms[activeMode].querySelector("button");
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
    createRecommendationsCard(report.recommendations),
    createListCard("Namespaces", report.symbols.namespaces),
    createListCard("Gardes plateforme", report.symbols.platformGuards),
    createListCard(
      "Constantes et valeurs clés",
      (report.symbols.constantPairs || []).map((item) => `${item.name} -> ${item.value}`)
    ),
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
    createRecommendationsCard(comparison.recommendations),
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

function renderNearbyResult(nearby, files) {
  resultsTitle.textContent = nearby.source.filePath;
  renderFileLinks(files);
  renderSummary([
    ["Comparaisons", nearby.summary.compared],
    ["Versions stables", nearby.summary.unchanged],
    ["Versions modifiées", nearby.summary.changed],
    ["Candidats", nearby.summary.candidates]
  ]);

  const sections = [
    createDocumentationCard(nearby.documentation),
    createRecommendationsCard(nearby.recommendations),
    createTimelineCard("Versions analysées", nearby.comparisons)
  ].filter(Boolean);

  replaceSections(sections);
}

function renderSearchResults(topic, results) {
  if (!results || results.length === 0) {
    searchResults.className = "search-results empty-search";
    searchResults.textContent = `Aucun résultat pertinent pour "${topic}".`;
    return;
  }

  searchResults.className = "search-results";
  searchResults.innerHTML = "";

  for (const result of results) {
    const card = document.createElement("article");
    card.className = "search-result-card";
    card.innerHTML = `
      <h3>${escapeHtml(result.path)}</h3>
      <p>${escapeHtml(result.reason)}</p>
      <p>Révision proposée : <code>${escapeHtml(result.revision)}</code></p>
    `;

    const actions = document.createElement("div");
    actions.className = "search-actions";

    const scrapeButton = document.createElement("button");
    scrapeButton.className = "mini-button";
    scrapeButton.type = "button";
    scrapeButton.textContent = "Scraper";
    scrapeButton.addEventListener("click", async () => {
      switchMode("scrape");
      forms.scrape.querySelector("[name='url']").value = result.url;
      await runAction({
        mode: "scrape",
        endpoint: "/api/scrape",
        payload: { url: result.url }
      });
    });

    const compareButton = document.createElement("button");
    compareButton.className = "mini-button";
    compareButton.type = "button";
    compareButton.textContent = "Comparer";
    compareButton.addEventListener("click", () => {
      switchMode("compare");
      forms.compare.querySelector("[name='baseUrl']").value = result.compareUrl;
      forms.compare.querySelector("[name='compareUrl']").value = result.url;
      setStatus("idle", "Le mode comparaison a été prérempli avec une release de référence et la branche main.");
    });

    const nearbyButton = document.createElement("button");
    nearbyButton.className = "mini-button";
    nearbyButton.type = "button";
    nearbyButton.textContent = "Versions proches";
    nearbyButton.addEventListener("click", async () => {
      switchMode("nearby");
      forms.nearby.querySelector("[name='url']").value = result.compareUrl;
      await runAction({
        mode: "nearby",
        endpoint: "/api/nearby-versions",
        payload: { url: result.compareUrl }
      });
    });

    const openLink = document.createElement("a");
    openLink.className = "result-link";
    openLink.href = result.url;
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.textContent = "Ouvrir";

    actions.append(scrapeButton, compareButton, nearbyButton, openLink);
    card.append(actions);
    searchResults.append(card);
  }
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

function createRecommendationsCard(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "result-card recommendations-card";
  card.innerHTML = "<h3>Suggestions intelligentes</h3>";

  const list = document.createElement("div");
  list.className = "recommendations-list";

  for (const recommendation of recommendations) {
    const item = document.createElement("section");
    item.className = "recommendation-item";

    const title = document.createElement("h4");
    title.textContent = recommendation.title;
    item.append(title);

    const reason = document.createElement("p");
    reason.textContent = recommendation.reason;
    item.append(reason);

    const actions = document.createElement("div");
    actions.className = "search-actions";

    const goButton = document.createElement("button");
    goButton.className = "mini-button";
    goButton.type = "button";
    goButton.textContent = recommendation.action.kind === "compare"
      ? "Lancer la comparaison"
      : recommendation.action.kind === "nearby"
        ? "Voir les versions proches"
        : "Ouvrir cette analyse";
    goButton.addEventListener("click", async () => {
      await runRecommendation(recommendation.action);
    });
    actions.append(goButton);

    if (recommendation.action.url) {
      const link = document.createElement("a");
      link.className = "result-link";
      link.href = recommendation.action.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Voir l'URL";
      actions.append(link);
    }

    item.append(actions);
    list.append(item);
  }

  card.append(list);
  return card;
}

async function runRecommendation(action) {
  if (action.kind === "scrape") {
    switchMode("scrape");
    forms.scrape.querySelector("[name='url']").value = action.url;
    await runAction({
      mode: "scrape",
      endpoint: "/api/scrape",
      payload: { url: action.url }
    });
    return;
  }

  if (action.kind === "compare") {
    switchMode("compare");
    forms.compare.querySelector("[name='baseUrl']").value = action.baseUrl;
    forms.compare.querySelector("[name='compareUrl']").value = action.compareUrl;
    await runAction({
      mode: "compare",
      endpoint: "/api/compare",
      payload: {
        baseUrl: action.baseUrl,
        compareUrl: action.compareUrl
      }
    });
    return;
  }

  if (action.kind === "nearby") {
    switchMode("nearby");
    forms.nearby.querySelector("[name='url']").value = action.url;
    await runAction({
      mode: "nearby",
      endpoint: "/api/nearby-versions",
      payload: { url: action.url }
    });
  }
}

function createTimelineCard(title, items) {
  if (!items || items.length === 0) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "result-card";
  card.innerHTML = `<h3>${escapeHtml(title)}</h3>`;

  const list = document.createElement("div");
  list.className = "timeline-list";

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "timeline-item";
    row.innerHTML = `
      <h4>${escapeHtml(item.label)} - ${escapeHtml(item.revision)}</h4>
      <p>${escapeHtml(item.summary)}</p>
    `;
    list.append(row);
  }

  card.append(list);
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
