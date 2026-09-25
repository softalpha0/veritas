/* Veritas front end. */
(() => {
  const $ = (id) => document.getElementById(id);

  const COLORS = {
    smart_money: "#c98500",
    exchange: "#6b7480",
    contract: "#9085e9",
    public_figure: "#d55181",
    whale: "#3987e5",
    fresh: "#199e70",
    holder: "#9aa3ae",
    hub: "#ff9b9b",
    clustered: "#e66767",
  };
  const NAMES = {
    smart_money: "Smart Money",
    exchange: "Exchange",
    contract: "Contract / pool",
    public_figure: "Public figure",
    whale: "Whale",
    fresh: "Fresh wallet",
    holder: "Holder",
    hub: "Shared funder / link",
    clustered: "Clustered wallet",
  };
  const DIM = "#262b33";
  const TIME_KEYS = ["d30", "d7", "d1", "now"];
  const EXPLORERS = {
    ethereum: "https://etherscan.io/address/",
    base: "https://basescan.org/address/",
    arbitrum: "https://arbiscan.io/address/",
    bnb: "https://bscscan.com/address/",
    polygon: "https://polygonscan.com/address/",
    optimism: "https://optimistic.etherscan.io/address/",
    avalanche: "https://snowtrace.io/address/",
    linea: "https://lineascan.build/address/",
    scroll: "https://scrollscan.com/address/",
    mantle: "https://explorer.mantle.xyz/address/",
    sonic: "https://sonicscan.org/address/",
    solana: "https://solscan.io/account/",
  };

  const state = {
    graph: null,
    nodes: new Map(),
    links: new Map(),
    clusters: [],
    report: null,
    chain: "ethereum",
    token: "",
    meta: {},
    time: 3,
    highlight: 0,
    orbit: null,
    source: null,
    live: false,
    tab: "map",
  };

  // ---------- Formatting ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (x) => `${(x * 100).toFixed(Math.abs(x) > 0 && Math.abs(x) < 0.01 ? 2 : 1)}%`;
  const spct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pct(Math.abs(x))}`;
  const short = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");
  const usd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v || 0)}`);
  const amt = (v) => {
    const a = Math.abs(v);
    const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
    return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
  };
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const gradeClass = (s) => (s >= 80 ? "badge-good" : s >= 60 ? "" : s >= 40 ? "badge-warn" : "badge-bad");
  const scoreColor = (s) => (s >= 80 ? "var(--good)" : s >= 60 ? "var(--text)" : s >= 40 ? "var(--warn)" : "var(--bad)");
  const pill = (s) => `<span class="score-pill ${gradeClass(s)} badge">${s}</span>`;
  const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  const nodeType = (n) => (n.kind === "holder" && n.cluster && n.category === "holder" ? "clustered" : n.category);

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 1800);
  }

  // ---------- Views ----------
  function showView(name) {
    for (const v of ["Home", "Token", "Game", "Markets", "Leaderboard", "Methodology"]) $(`view${v}`).hidden = v.toLowerCase() !== name;
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === (name === "token" ? "home" : name)));
  }

  // ---------- Graph ----------
  function shareAt(n) {
    if (n.kind === "hub") return 0;
    const a = n.history ? n.history[TIME_KEYS[state.time]] : n.amount;
    return n.amount > 0 ? (n.share * a) / n.amount : n.share;
  }

  function nodeColor(n) {
    if (state.highlight) {
      const inCluster = n.kind === "hub" ? hubInCluster(n, state.highlight) : n.cluster === state.highlight;
      if (!inCluster) return DIM;
    }
    return COLORS[nodeType(n)] || COLORS.holder;
  }

  function hubInCluster(hub, id) {
    const c = state.clusters.find((c) => c.id === id);
    return c ? c.via.includes(hub.id) : false;
  }

  function clusterOfLink(l) {
    const s = typeof l.source === "object" ? l.source : state.nodes.get(l.source);
    const t = typeof l.target === "object" ? l.target : state.nodes.get(l.target);
    return (s && s.cluster) || (t && t.cluster) || 0;
  }

  function initGraph() {
    if (state.graph) return state.graph;
    const el = $("galaxy");
    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .backgroundColor("#111418")
      .showNavInfo(false)
      .enableNodeDrag(false)
      .nodeId("id")
      .nodeRelSize(2.6)
      .nodeVal((n) => (n.kind === "hub" ? 3 : 0.25 + shareAt(n) * 500))
      .nodeColor(nodeColor)
      .nodeOpacity(0.95)
      .nodeResolution(10)
      .nodeLabel((n) =>
        n.kind === "hub"
          ? `<b>${esc(n.label || short(n.id))}</b><br><span style="color:#8a93a0">${esc(n.relation)} of several top holders</span>`
          : `<b>${esc(n.label || short(n.id))}</b><br><span style="color:#8a93a0">${NAMES[nodeType(n)]} · ${pct(shareAt(n))} of supply${n.cluster ? ` · cluster ${n.cluster}` : ""}</span>`,
      )
      .linkColor(() => "#e5534b")
      .linkOpacity(0.35)
      .linkWidth(0.4)
      .linkVisibility((l) => !state.highlight || clusterOfLink(l) === state.highlight)
      .linkDirectionalParticles(1)
      .linkDirectionalParticleWidth(1.1)
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleColor(() => "#f0a09a")
      .onNodeClick((n) => { stopOrbit(); showWallet(n); focusNode(n); })
      .onBackgroundClick(() => { setHighlight(0); hideWallet(); });
    g.d3Force("link").distance(18);
    g.d3Force("charge").strength(-26);
    let simNodes = [];
    const gravity = (alpha) => {
      for (const n of simNodes) { n.vx -= n.x * 0.04 * alpha; n.vy -= n.y * 0.04 * alpha; n.vz -= n.z * 0.04 * alpha; }
    };
    gravity.initialize = (nodes) => { simNodes = nodes; };
    g.d3Force("gravity", gravity);
    new ResizeObserver(() => { if (el.clientWidth) g.width(el.clientWidth).height(el.clientHeight); }).observe(el);
    el.addEventListener("pointerdown", stopOrbit);
    el.addEventListener("wheel", stopOrbit, { passive: true });
    state.graph = g;
    return g;
  }

  function mergeGraph(nodes = [], links = null) {
    for (const n of nodes) {
      const cur = state.nodes.get(n.id);
      if (cur) Object.assign(cur, n);
      else state.nodes.set(n.id, { ...n });
    }
    if (links) {
      const next = new Map();
      for (const l of links) {
        const key = `${l.source}|${l.target}`;
        next.set(key, state.links.get(key) || { source: l.source, target: l.target, relation: l.relation });
      }
      state.links = next;
    }
    state.graph.graphData({ nodes: [...state.nodes.values()], links: [...state.links.values()] });
  }

  function refreshStyles() {
    const g = state.graph;
    if (g) g.nodeColor(g.nodeColor()).nodeVal(g.nodeVal()).linkVisibility(g.linkVisibility());
  }

  function startOrbit() {
    stopOrbit();
    let angle = 0;
    state.orbit = setInterval(() => {
      const dist = 360 + Math.min(260, state.nodes.size);
      angle += 0.0025;
      state.graph.cameraPosition({ x: dist * Math.sin(angle), y: 60, z: dist * Math.cos(angle) }, { x: 0, y: 0, z: 0 });
    }, 30);
  }
  function stopOrbit() {
    if (state.orbit) clearInterval(state.orbit);
    state.orbit = null;
  }

  function focusNode(n) {
    if (n.x === undefined) return;
    const r = Math.hypot(n.x, n.y, n.z) || 1;
    const k = 1 + 80 / r;
    state.graph.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, n, 900);
  }

  function focusCluster(id) {
    const members = [...state.nodes.values()].filter((n) => n.cluster === id && n.x !== undefined);
    if (!members.length) return;
    const c = members.reduce((a, n) => ({ x: a.x + n.x / members.length, y: a.y + n.y / members.length, z: a.z + n.z / members.length }), { x: 0, y: 0, z: 0 });
    const spread = Math.max(...members.map((n) => Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z)));
    const r = Math.hypot(c.x, c.y, c.z) || 1;
    const k = 1 + (110 + spread * 3) / r;
    stopOrbit();
    state.graph.cameraPosition({ x: c.x * k, y: c.y * k + 15, z: c.z * k }, c, 1100);
  }

  function setHighlight(id) {
    state.highlight = id;
    refreshStyles();
    if (id) {
      setTab("map");
      focusCluster(id);
    }
  }

  // ---------- Tabs ----------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tabs [role=tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    $("mapTools").style.visibility = tab === "map" ? "visible" : "hidden";
  }
  document.querySelectorAll(".tabs [role=tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ---------- Scan ----------
  function resetToken() {
    state.nodes.clear();
    state.links.clear();
    state.clusters = [];
    state.report = null;
    state.highlight = 0;
    state.time = 3;
    document.querySelectorAll("#timeline button").forEach((b) => b.classList.toggle("active", b.dataset.t === "3"));
    hideWallet();
    $("scoreNum").textContent = "–";
    $("scoreFill").style.width = "0";
    $("gradeChip").textContent = "Scanning";
    $("gradeChip").className = "badge";
    $("factors").innerHTML = "";
    $("metrics").innerHTML = "";
    $("findings").innerHTML = "";
    $("holderRows").innerHTML = "";
    $("clusterRows").innerHTML = "";
    $("holderCount").textContent = "";
    $("clusterCount").textContent = "";
  }

  function startScan(chain, token, meta = {}, refresh = false) {
    if (state.source) state.source.close();
    showView("token");
    setTab("map");
    initGraph();
    resetToken();
    state.chain = chain;
    state.token = token;
    state.meta = { ...meta, chain, address: token };
    setTokenHead(state.meta);
    setProgress("Connecting to Nansen…", 0.03);
    startOrbit();
    const url = `/app?chain=${encodeURIComponent(chain)}&token=${encodeURIComponent(token)}`;
    if (location.pathname + location.search !== url) history.pushState(null, "", url);

    const params = new URLSearchParams({ chain, token, name: meta.name || "", symbol: meta.symbol || "" });
    if (refresh) params.set("refresh", "1");
    const es = new EventSource(`/api/scan?${params}`);
    state.source = es;
    let finished = false;

    es.addEventListener("meta", (e) => {
      state.meta = { ...state.meta, ...JSON.parse(e.data) };
      setTokenHead(state.meta);
    });
    es.addEventListener("status", (e) => {
      const d = JSON.parse(e.data);
      setProgress(d.message, d.stage === "holders" ? 0.08 : 0.2);
    });
    es.addEventListener("holders", (e) => {
      const d = JSON.parse(e.data);
      mergeGraph(d.nodes, []);
      renderHolders();
      setProgress(`Loaded ${d.nodes.length} holders · checking wallet links`, 0.18);
    });
    es.addEventListener("graph", (e) => {
      const d = JSON.parse(e.data);
      state.clusters = d.clusters;
      mergeGraph(d.nodes, d.links);
      const found = d.clusters.length ? ` · ${d.clusters.length} cluster${d.clusters.length === 1 ? "" : "s"}` : "";
      setProgress(`Checked ${d.done} of ${d.total} wallets${found}`, 0.2 + 0.78 * (d.done / d.total));
    });
    es.addEventListener("warning", (e) => console.warn(JSON.parse(e.data).message));
    es.addEventListener("result", (e) => {
      finished = true;
      es.close();
      const r = JSON.parse(e.data);
      state.report = r;
      state.clusters = r.clusters;
      state.meta = { ...state.meta, ...(r.meta || {}) };
      mergeGraph(r.nodes, r.links);
      setTokenHead(state.meta, r);
      renderResult(r);
      hideProgress();
      setTimeout(() => { stopOrbit(); state.graph.zoomToFit(900, 30); }, r.fromCache ? 1500 : 2200);
      refreshStats();
    });
    es.addEventListener("failure", (e) => {
      finished = true;
      es.close();
      stopOrbit();
      failScan(JSON.parse(e.data).message);
    });
    es.onerror = () => {
      if (finished) return;
      es.close();
      stopOrbit();
      failScan("Scan failed. Check the chain and address, and that the server is running with a valid Nansen key.");
    };
  }

  function failScan(msg) {
    hideProgress();
    $("gradeChip").textContent = "Failed";
    $("gradeChip").className = "badge badge-bad";
    $("findings").innerHTML = `<li class="bad"><span class="sev"></span><b>Scan failed</b><span></span><p>${esc(msg)}</p></li>`;
  }

  function setProgress(text, frac) {
    $("progress").hidden = false;
    $("progressText").textContent = text;
    $("progressBar").style.width = `${Math.round(frac * 100)}%`;
  }
  function hideProgress() {
    $("progress").hidden = true;
  }

  // ---------- Render ----------
  function setTokenHead(meta, r) {
    $("tokenName").textContent = meta.symbol ? `${meta.symbol}${meta.name ? ` · ${meta.name}` : ""}` : meta.name || short(meta.address) || "Token";
    $("chainBadge").textContent = meta.chain || state.chain;
    $("tokenAddr").textContent = short(meta.address || state.token);
    $("tokenAddr").dataset.full = meta.address || state.token;
    $("scanMeta").textContent = r ? `Scanned ${ago(r.scannedAt)} · ${r.calls} Nansen calls` : "";
    $("reportLink").href = `/report?chain=${encodeURIComponent(meta.chain || state.chain)}&token=${encodeURIComponent(state.token)}`;
    document.title = `${meta.symbol || "Token"} · Veritas`;
  }

  function renderResult(r) {
    const m = r.metrics;
    $("scoreNum").textContent = r.score;
    $("scoreNum").style.color = scoreColor(r.score);
    $("scoreFill").style.background = scoreColor(r.score);
    requestAnimationFrame(() => ($("scoreFill").style.width = `${r.score}%`));
    $("gradeChip").textContent = r.grade;
    $("gradeChip").className = `badge ${gradeClass(r.score)}`;

    $("factors").innerHTML = (r.factors || [])
      .map((f) => {
        const w = Math.min(100, (Math.abs(f.impact) / f.max) * 100);
        const color = f.impact > 0 ? "var(--good)" : f.impact < 0 ? (Math.abs(f.impact) / f.max > 0.5 ? "var(--bad)" : "var(--warn)") : "var(--border-strong)";
        const val = f.impact > 0 ? `+${f.impact}` : f.impact < 0 ? `−${-f.impact}` : "0";
        return `<li><span>${esc(f.label)}</span><span class="val" style="color:${f.impact ? color : "var(--muted)"}">${val}</span>
          <div class="bar"><div style="width:${w}%;background:${color}"></div></div></li>`;
      })
      .join("");

    const kv = [
      ["Wallets analysed", `${m.owners}`],
      ["Distinct owners", `${m.realOwners}`],
      ["Top 10 owners hold", pct(m.top10Entities)],
      ["Effective owners (HHI)", `${m.effectiveOwners}`],
      ["Clustered supply", `${pct(m.clusteredShare)} · ${m.clusters}`],
      ["Smart Money holders", `${m.smartMoney} · ${pct(m.smartShare)}`],
      ["Held on exchanges", pct(m.exchangeShare)],
      ["Held in contracts / pools", pct(m.contractShare)],
    ];
    $("metrics").innerHTML = kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    $("findings").innerHTML = r.findings
      .map(
        (f) => `<li class="${f.severity}${f.cluster ? " clickable" : ""}" ${f.cluster ? `data-cluster="${f.cluster}"` : ""}>
          <span class="sev"></span><b>${esc(f.title)}</b><span class="impact">${f.impact > 0 ? "+" : f.impact < 0 ? "−" : ""}${f.impact ? Math.abs(f.impact) : ""}</span>
          <p>${esc(f.detail)}</p></li>`,
      )
      .join("");
    $("findings").querySelectorAll("li[data-cluster]").forEach((li) => li.addEventListener("click", () => setHighlight(Number(li.dataset.cluster))));

    renderHolders();
    renderClusters(r);
    renderSupply();
  }

  // Stack order is fixed and validated (adjacent pairs pass CVD + normal-vision checks).
  const SUPPLY_PARTS = [
    { key: "clusters", label: "Hidden clusters", color: COLORS.clustered },
    { key: "contracts", label: "Contracts / pools", color: COLORS.contract },
    { key: "smart", label: "Smart Money", color: COLORS.smart_money },
    { key: "other", label: "Other top holders", color: COLORS.whale },
    { key: "exchanges", label: "Exchanges", color: COLORS.exchange },
  ];

  function renderSupply() {
    const parts = { clusters: 0, contracts: 0, smart: 0, other: 0, exchanges: 0 };
    for (const n of state.nodes.values()) {
      if (n.kind !== "holder") continue;
      if (n.category === "exchange") parts.exchanges += n.share;
      else if (n.category === "contract") parts.contracts += n.share;
      else if (n.cluster) parts.clusters += n.share;
      else if (n.category === "smart_money") parts.smart += n.share;
      else parts.other += n.share;
    }
    const top = Object.values(parts).reduce((a, b) => a + b, 0);
    const rest = Math.max(0, 1 - top);
    $("stackBar").innerHTML =
      SUPPLY_PARTS.filter((p) => parts[p.key] > 0.0005)
        .map((p) => `<span style="flex:${parts[p.key]};background:${p.color}" title="${esc(p.label)}: ${pct(parts[p.key])}"></span>`)
        .join("") + (rest > 0.0005 ? `<span class="rest" style="flex:${rest}" title="Outside top holders: ${pct(rest)}"></span>` : "");
    $("stackLegend").innerHTML =
      SUPPLY_PARTS.map((p) => `<li><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b class="mono">${pct(parts[p.key])}</b></li>`).join("") +
      `<li><i class="rest"></i><span>Outside top holders</span><b class="mono">${pct(rest)}</b></li>`;
  }

  function renderHolders() {
    const holders = [...state.nodes.values()].filter((n) => n.kind === "holder").sort((a, b) => b.share - a.share);
    $("holderCount").textContent = holders.length || "";
    $("holderRows").innerHTML = holders
      .map((n, i) => {
        const d30 = n.amount - (n.history?.d30 ?? n.amount);
        const t = nodeType(n);
        return `<tr class="clickable" data-id="${esc(n.id)}"><td class="num muted">${i + 1}</td>
          <td><div class="addr-cell"><span class="mono">${esc(short(n.id))}</span>${n.label ? `<span class="label">${esc(n.label)}</span>` : ""}</div></td>
          <td><span class="type"><i style="background:${COLORS[t]}"></i>${esc(NAMES[t])}</span></td>
          <td class="num">${pct(n.share)}</td><td class="num">${usd(n.valueUsd)}</td>
          <td class="num ${d30 > 0 ? "pos" : d30 < 0 ? "neg" : "muted"}">${d30 ? amt(d30) : "–"}</td>
          <td class="num">${n.cluster ? `<a href="#" data-cluster="${n.cluster}">#${n.cluster}</a>` : '<span class="muted">–</span>'}</td></tr>`;
      })
      .join("");
    $("holderRows").querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        const c = e.target.closest("a[data-cluster]");
        if (c) { e.preventDefault(); setHighlight(Number(c.dataset.cluster)); return; }
        const n = state.nodes.get(tr.dataset.id);
        setTab("map");
        stopOrbit();
        showWallet(n);
        focusNode(n);
      }),
    );
  }

  function renderClusters(r) {
    $("clusterCount").textContent = r.clusters.length || "";
    $("clustersEmpty").hidden = r.clusters.length > 0;
    $("clusterRows").innerHTML = r.clusters
      .map((c) => {
        const hub = c.via.length ? state.nodes.get(c.via[0]) : null;
        const how = hub ? `${hub.relation}${hub.label ? ` · ${hub.label}` : ` · ${short(hub.id)}`}` : "Direct transfers";
        return `<tr class="clickable" data-id="${c.id}"><td><b>Cluster ${c.id}</b></td><td class="num">${c.size}</td><td class="num">${pct(c.share)}</td>
          <td class="num ${c.change7dShare > 0 ? "pos" : c.change7dShare < 0 ? "neg" : "muted"}">${c.change7dShare ? spct(c.change7dShare) : "–"}</td>
          <td class="muted">${esc(how)}</td><td class="right"><a href="#">Show on map</a></td></tr>`;
      })
      .join("");
    $("clusterRows").querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", (e) => { e.preventDefault(); setHighlight(Number(tr.dataset.id)); }),
    );
  }

  // ---------- Wallet ----------
  function showWallet(n) {
    if (!n) return;
    const explorer = EXPLORERS[state.chain] || EXPLORERS.ethereum;
    let body;
    if (n.kind === "hub") {
      const members = [...state.links.values()].filter((l) => (l.target.id || l.target) === n.id).length;
      body = `<span class="type"><i style="background:${COLORS.hub}"></i>${NAMES.hub}</span>
        <h3>${esc(n.label || "Unlabelled wallet")}</h3><div class="mono addrline">${esc(n.id)}</div>
        <p class="muted" style="margin:10px 0 12px">${esc(n.relation)} of ${members} top holders. Wallets that share it are likely controlled by the same owner.</p>`;
    } else {
      const d30 = n.amount - (n.history?.d30 ?? n.amount);
      const t = nodeType(n);
      body = `<span class="type"><i style="background:${COLORS[t]}"></i>${esc(NAMES[t])}</span>
        <h3>${esc(n.label || "Unlabelled wallet")}</h3><div class="mono addrline">${esc(n.id)}</div>
        <dl class="kv" style="padding:0">
          <dt>Share of supply</dt><dd>${pct(n.share)}</dd>
          <dt>Value</dt><dd>${usd(n.valueUsd)}</dd>
          <dt>30d change</dt><dd class="${d30 > 0 ? "pos" : d30 < 0 ? "neg" : ""}">${d30 ? amt(d30) : "–"}</dd>
          ${n.cluster ? `<dt>Cluster</dt><dd><a href="#" id="walletCluster">${n.cluster}</a></dd>` : ""}
        </dl>`;
    }
    body += `<a class="btn" href="${explorer}${esc(n.id)}" target="_blank" rel="noopener">Open in explorer ↗</a>`;
    $("walletBody").innerHTML = body;
    $("wallet").hidden = false;
    const link = $("walletCluster");
    if (link) link.onclick = (e) => { e.preventDefault(); setHighlight(n.cluster); };
  }
  function hideWallet() {
    $("wallet").hidden = true;
  }

  // ---------- Search ----------
  let searchTimer;
  let suggestions = [];
  let active = -1;

  function renderSuggestions() {
    const ul = $("suggestions");
    if (!suggestions.length) { ul.hidden = true; return; }
    ul.innerHTML = suggestions
      .map((t, i) => `<li data-i="${i}" class="${i === active ? "active" : ""}"><span class="sym">${esc(t.symbol)}</span><span class="name">${esc(t.name)}</span><span class="badge">${esc(t.chain)}</span></li>`)
      .join("");
    ul.hidden = false;
    ul.querySelectorAll("li").forEach((li) => li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(suggestions[Number(li.dataset.i)]); }));
  }

  function pick(t) {
    suggestions = [];
    renderSuggestions();
    $("query").value = "";
    $("query").blur();
    if (t.chain) $("chain").value = t.chain;
    startScan(t.chain, t.address, t);
  }

  $("query").addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = $("query").value.trim();
    active = -1;
    if (q.length < 2 || isAddress(q)) { suggestions = []; renderSuggestions(); return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
        suggestions = (r.tokens || []).slice(0, 8);
        renderSuggestions();
      } catch { /* ignore */ }
    }, 250);
  });
  $("query").addEventListener("keydown", (e) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % suggestions.length; renderSuggestions(); e.preventDefault(); }
    if (e.key === "ArrowUp") { active = (active - 1 + suggestions.length) % suggestions.length; renderSuggestions(); e.preventDefault(); }
    if (e.key === "Escape") { suggestions = []; renderSuggestions(); }
  });
  $("query").addEventListener("blur", () => setTimeout(() => { suggestions = []; renderSuggestions(); }, 150));
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("query").value.trim();
    if (!q) return;
    if (isAddress(q)) { $("query").value = ""; return startScan($("chain").value, q); }
    if (suggestions.length) return pick(suggestions[Math.max(0, active)]);
    toast("Pick a token from the list, or paste a contract address.");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("query")) { e.preventDefault(); $("query").focus(); }
  });

  // ---------- Controls ----------
  document.querySelectorAll("#timeline button").forEach((b) =>
    b.addEventListener("click", () => {
      state.time = Number(b.dataset.t);
      document.querySelectorAll("#timeline button").forEach((x) => x.classList.toggle("active", x === b));
      refreshStyles();
    }),
  );
  $("fitBtn").addEventListener("click", () => { stopOrbit(); setHighlight(0); state.graph && state.graph.zoomToFit(700, 30); });
  $("walletClose").addEventListener("click", hideWallet);
  $("rescanBtn").addEventListener("click", () => startScan(state.chain, state.token, state.meta, true));
  $("tokenAddr").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("tokenAddr").dataset.full); toast("Address copied"); } catch { /* ignore */ }
  });
  $("shareBtn").addEventListener("click", () => {
    const r = state.report;
    if (!r) return;
    const m = r.metrics;
    const sym = state.meta.symbol ? `$${state.meta.symbol}` : "This token";
    const text = `${sym} scores ${r.score}/100 (${r.grade}) on Veritas.\n\n${m.owners} top wallets resolve to ${m.realOwners} owners. ${m.clusters} hidden clusters hold ${pct(m.clusteredShare)} of supply.\n\nBuilt on @nansen_ai`;
    const url = `${location.origin}/app?chain=${encodeURIComponent(r.chain)}&token=${encodeURIComponent(r.token)}`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
  });

  $("legend").innerHTML = ["smart_money", "whale", "fresh", "holder", "clustered", "hub", "exchange", "contract"]
    .map((k) => `<li><i style="background:${COLORS[k]}"></i>${esc(NAMES[k])}</li>`)
    .join("");

  // ---------- Data ----------
  async function refreshStats() {
    try {
      const s = await fetch("/api/stats").then((r) => r.json());
      $("callCount").textContent = s.successful.toLocaleString("en-US");
      $("tCalls").textContent = s.successful.toLocaleString("en-US");
    } catch { /* ignore */ }
  }

  const tokenCell = (r) => `<div class="tok"><b>${esc(r.symbol || short(r.token))}</b><span class="muted">${esc(r.name || "")}</span></div>`;
  const open = (r) => startScan(r.chain, r.token, r);

  const scoreCell = (sc) => `<div class="scorebar"><span class="mono" style="color:${scoreColor(sc)}">${sc}</span><div><div style="width:${sc}%;background:${scoreColor(sc)}"></div></div></div>`;
  const GRADES = [
    { name: "Strong", test: (s) => s >= 80, color: "var(--good)" },
    { name: "Fair", test: (s) => s >= 60 && s < 80, color: "var(--muted)" },
    { name: "Caution", test: (s) => s >= 40 && s < 60, color: "var(--warn)" },
    { name: "High risk", test: (s) => s < 40, color: "var(--bad)" },
  ];

  async function loadReports() {
    let list = [];
    try { list = await fetch("/api/reports").then((r) => r.json()); } catch { /* ignore */ }
    state.reports = list;
    const wallets = list.reduce((a, r) => a + (r.owners || 0), 0);
    const clusters = list.reduce((a, r) => a + (r.clusters || 0), 0);
    const scores = list.map((r) => r.score).sort((a, b) => a - b);
    const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : Math.round((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2)) : null;
    $("tTokens").textContent = list.length.toLocaleString("en-US");
    $("tWallets").textContent = wallets.toLocaleString("en-US");
    $("tClusters").textContent = clusters.toLocaleString("en-US");
    $("tMedian").textContent = median ?? "–";
    if (median != null) $("tMedian").style.color = scoreColor(median);

    const recent = [...list].sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt)).slice(0, 8);
    $("recentEmpty").hidden = recent.length > 0;
    $("recentRows").innerHTML = recent
      .map((r, i) => `<tr class="clickable" data-i="${i}"><td>${tokenCell(r)}</td><td class="muted">${esc(r.chain)}</td>
        <td class="num hide-sm muted">${r.owners ?? "–"} → ${r.realOwners ?? "–"}</td><td class="num">${r.clusters ?? "–"}</td><td>${scoreCell(r.score)}</td></tr>`)
      .join("");
    $("recentRows").querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => open(recent[Number(tr.dataset.i)])));

    $("gradeTotal").textContent = list.length ? `${list.length} tokens` : "";
    const maxCount = Math.max(1, ...GRADES.map((g) => scores.filter(g.test).length));
    $("grades").innerHTML = GRADES.map((g) => {
      const c = scores.filter(g.test).length;
      return `<li><span class="grade-name"><i style="background:${g.color}"></i>${g.name}</span><div class="grade-bar"><div style="width:${(c / maxCount) * 100}%;background:${g.color}"></div></div><b class="mono">${c}</b></li>`;
    }).join("");

    const risky = [...list].sort((a, b) => a.score - b.score).slice(0, 5);
    $("riskEmpty").hidden = risky.length > 0;
    $("riskRows").innerHTML = risky
      .map((r, i) => `<tr class="clickable" data-i="${i}"><td>${tokenCell(r)}</td><td class="num muted">${r.clusters ?? 0} clusters</td><td class="num">${pill(r.score)}</td></tr>`)
      .join("");
    $("riskRows").querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => open(risky[Number(tr.dataset.i)])));

    $("boardEmpty").hidden = list.length > 0;
    $("boardRows").innerHTML = list
      .map(
        (r, i) => `<tr class="clickable" data-i="${i}"><td class="num muted">${i + 1}</td><td>${tokenCell(r)}</td><td class="muted">${esc(r.chain)}</td>
          <td class="num hide-sm muted">${r.owners ?? "–"} → ${r.realOwners ?? "–"}</td><td class="num">${r.clusters ?? "–"}</td><td>${scoreCell(r.score)}</td><td class="num muted hide-sm">${ago(r.scannedAt)}</td></tr>`,
      )
      .join("");
    $("boardRows").querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => open(list[Number(tr.dataset.i)])));
    const best = readBest();
    $("bestScore").textContent = best ? `Your best: ${best}` : "";
  }

  async function loadTrending() {
    try {
      const { tokens } = await fetch("/api/trending").then((r) => r.json());
      if (!tokens?.length) return;
      $("trendingCard").hidden = false;
      $("trendRows").innerHTML = tokens
        .slice(0, 8)
        .map((t, i) => `<tr class="clickable" data-i="${i}"><td><div class="tok"><b>${esc(t.symbol || short(t.address))}</b><span class="muted mono">${esc(short(t.address))}</span></div></td>
          <td class="num ${t.netflow7d >= 0 ? "pos" : "neg"}">${t.netflow7d >= 0 ? "+" : "−"}${usd(Math.abs(t.netflow7d || 0))}</td><td class="right"><a href="#">Scan</a></td></tr>`)
        .join("");
      $("trendRows").querySelectorAll("tr").forEach((tr) =>
        tr.addEventListener("click", (e) => {
          e.preventDefault();
          const t = tokens[Number(tr.dataset.i)];
          startScan(t.chain, t.address, { symbol: t.symbol });
        }),
      );
    } catch { /* optional */ }
  }

  // ---------- Markets ----------
  const MARKET_CHAINS = ["ethereum", "base", "solana", "bnb", "arbitrum", "polygon", "optimism", "avalanche", "linea", "scroll", "mantle", "sonic"];
  const market = { chain: "ethereum", timeframe: "24h", sm: "0", sort: "volume", page: 1, tokens: [] };
  const price = (v) => (v == null ? "–" : v >= 1 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : v >= 0.0001 ? `$${v.toPrecision(4)}` : `$${v.toExponential(2)}`);
  const signedUsd = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`);

  function openMarkets() {
    showView("markets");
    const p = new URLSearchParams(location.search);
    if (MARKET_CHAINS.includes(p.get("chain"))) market.chain = p.get("chain");
    $("chainTabs").innerHTML = MARKET_CHAINS.map((c) => `<button role="tab" data-c="${c}" class="${c === market.chain ? "active" : ""}">${c === "bnb" ? "BNB" : c}</button>`).join("");
    $("chainTabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { market.chain = b.dataset.c; market.page = 1; loadMarkets(); }));
    loadMarkets();
  }

  async function loadMarkets() {
    document.querySelectorAll("#chainTabs button").forEach((b) => b.classList.toggle("active", b.dataset.c === market.chain));
    document.querySelectorAll("#mktTime button").forEach((b) => b.classList.toggle("active", b.dataset.v === market.timeframe));
    document.querySelectorAll("#mktTraders button").forEach((b) => b.classList.toggle("active", b.dataset.v === market.sm));
    document.querySelectorAll(".market-table th.sortable").forEach((th) => th.classList.toggle("active", th.dataset.sort === market.sort));
    $("mktPage").textContent = `Page ${market.page}`;
    $("mktPrev").disabled = market.page <= 1;
    $("marketEmpty").hidden = true;
    $("marketRows").innerHTML = `<tr><td colspan="10" class="muted">Loading ${esc(market.chain)} tokens from Nansen…</td></tr>`;
    history.replaceState(null, "", `/app?view=markets&chain=${market.chain}`);
    let r;
    try {
      const qs = new URLSearchParams({ chain: market.chain, timeframe: market.timeframe, sort: market.sort, sm: market.sm, page: market.page });
      r = await fetch(`/api/markets?${qs}`).then((x) => x.json());
    } catch { r = { error: "Network error" }; }
    if (r.error || !r.tokens?.length) {
      $("marketRows").innerHTML = "";
      $("marketEmpty").hidden = false;
      $("marketEmpty").textContent = r.error ? `Nansen returned an error for this list: ${r.error}` : state.live ? "No tokens for this chain and filter." : "Add a Nansen API key to .env to load live markets.";
      $("mktNext").disabled = true;
      return;
    }
    market.tokens = r.tokens;
    $("mktNext").disabled = !!r.lastPage;
    const offset = (market.page - 1) * 50;
    $("marketRows").innerHTML = r.tokens
      .map((t, i) => {
        const trust = t.score != null
          ? `<a href="#" class="open" data-i="${i}">${scoreCell(t.score)}</a>`
          : `<button class="btn btn-sm scan" data-i="${i}">Scan</button>`;
        return `<tr class="clickable" data-i="${i}"><td class="num muted">${offset + i + 1}</td>
          <td><div class="tok"><b>${esc(t.symbol || short(t.address))}</b><span class="muted mono">${esc(short(t.address))}</span></div></td>
          <td class="num">${price(t.price)}</td>
          <td class="num ${t.change > 0 ? "pos" : t.change < 0 ? "neg" : "muted"}">${t.change == null ? "–" : spct(t.change)}</td>
          <td class="num">${t.marketCap ? usd(t.marketCap) : "–"}</td>
          <td class="num">${t.volume ? usd(t.volume) : "–"}</td>
          <td class="num hide-sm ${t.netflow > 0 ? "pos" : t.netflow < 0 ? "neg" : "muted"}">${signedUsd(t.netflow)}</td>
          <td class="num hide-sm">${t.liquidity ? usd(t.liquidity) : "–"}</td>
          <td class="num hide-sm muted">${t.ageDays == null ? "–" : t.ageDays >= 365 ? `${(t.ageDays / 365).toFixed(1)}y` : `${Math.round(t.ageDays)}d`}</td>
          <td class="right">${trust}</td></tr>`;
      })
      .join("");
    $("marketRows").querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        e.preventDefault();
        const t = market.tokens[Number(tr.dataset.i)];
        startScan(t.chain, t.address, { symbol: t.symbol });
      }),
    );
  }

  document.querySelectorAll("#mktTime button").forEach((b) => b.addEventListener("click", () => { market.timeframe = b.dataset.v; market.page = 1; loadMarkets(); }));
  document.querySelectorAll("#mktTraders button").forEach((b) => b.addEventListener("click", () => { market.sm = b.dataset.v; market.page = 1; loadMarkets(); }));
  document.querySelectorAll(".market-table th.sortable").forEach((th) => th.addEventListener("click", () => { market.sort = th.dataset.sort; market.page = 1; loadMarkets(); }));
  $("mktPrev").addEventListener("click", () => { market.page--; loadMarkets(); });
  $("mktNext").addEventListener("click", () => { market.page++; loadMarkets(); });

  // ---------- Game: Spot the Insider ----------
  // Every round is a real scanned token. Clusters stay hidden until reveal.
  const ROUNDS = 3;
  const game = { graph: null, rounds: [], round: 0, score: 0, report: null, picks: new Set(), revealed: false, maxPicks: 5 };

  function readBest() {
    try { return Number(localStorage.getItem("veritas.best") || 0); } catch { return 0; }
  }
  function saveBest(v) {
    try { if (v > readBest()) localStorage.setItem("veritas.best", String(v)); } catch { /* storage unavailable */ }
  }

  function gameNodeColor(n) {
    if (n.kind === "hub") return COLORS.hub;
    const venue = n.category === "exchange" || n.category === "contract";
    if (!game.revealed) return game.picks.has(n.id) ? "#5b8def" : venue ? "#2e3540" : "#9aa3ae";
    const picked = game.picks.has(n.id);
    if (picked && n.cluster) return "#3fb67a";
    if (picked) return "#6b7480";
    if (n.cluster) return COLORS.clustered;
    return venue ? "#2e3540" : "#4a515c";
  }

  function initGameGraph() {
    if (game.graph) return game.graph;
    const el = $("gameGalaxy");
    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .backgroundColor("#111418")
      .showNavInfo(false)
      .enableNodeDrag(false)
      .nodeRelSize(2.6)
      .nodeVal((n) => (n.kind === "hub" ? 3 : 0.25 + n.share * 500) * (game.picks.has(n.id) ? 1.8 : 1))
      .nodeColor(gameNodeColor)
      .nodeOpacity(0.95)
      .nodeResolution(10)
      .nodeLabel((n) => {
        if (n.kind === "hub") return `<b>${esc(n.label || short(n.id))}</b><br><span style="color:#8a93a0">${esc(n.relation)}</span>`;
        const d30 = n.amount - (n.history?.d30 ?? n.amount);
        const venue = n.category === "exchange" || n.category === "contract";
        return `<b>${esc(n.label || short(n.id))}</b><br><span style="color:#8a93a0">${pct(n.share)} of supply · 30d ${d30 ? amt(d30) : "no change"}${venue ? " · venue, not pickable" : ""}</span>`;
      })
      .linkColor(() => "#e66767")
      .linkOpacity(0.5)
      .linkWidth(0.5)
      .onNodeClick(togglePick);
    g.d3Force("link").distance(18);
    g.d3Force("charge").strength(-26);
    let simNodes = [];
    const gravity = (alpha) => { for (const n of simNodes) { n.vx -= n.x * 0.04 * alpha; n.vy -= n.y * 0.04 * alpha; n.vz -= n.z * 0.04 * alpha; } };
    gravity.initialize = (nodes) => { simNodes = nodes; };
    g.d3Force("gravity", gravity);
    new ResizeObserver(() => { if (el.clientWidth) g.width(el.clientWidth).height(el.clientHeight); }).observe(el);
    game.graph = g;
    return g;
  }

  async function startGame() {
    showView("game");
    game.score = 0;
    game.round = 0;
    $("gameScore").textContent = "0";
    $("gameBest").textContent = readBest();
    let list = state.reports;
    if (!list) { try { list = await fetch("/api/reports").then((r) => r.json()); } catch { list = []; } }
    const playable = list.filter((r) => (r.clusters || 0) > 0);
    for (let i = playable.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [playable[i], playable[j]] = [playable[j], playable[i]]; }
    game.rounds = playable.slice(0, ROUNDS);
    if (!game.rounds.length) {
      $("gameToken").textContent = "No playable tokens yet";
      $("gameRound").textContent = "–";
      $("gameBrief").innerHTML = `<p>The game only uses real scans. Scan a few tokens first; any token where Veritas finds hidden clusters becomes a round.</p><a class="btn btn-primary" href="/app">Go to dashboard</a>`;
      $("revealBtn").disabled = true;
      return;
    }
    initGameGraph();
    loadRound();
  }

  async function loadRound() {
    const meta = game.rounds[game.round];
    game.picks = new Set();
    game.revealed = false;
    $("gameResult").hidden = true;
    $("nextBtn").hidden = true;
    $("revealBtn").hidden = false;
    $("gameRound").textContent = `Round ${game.round + 1} / ${game.rounds.length}`;
    $("gameToken").textContent = `${meta.symbol || short(meta.token)}${meta.name ? ` · ${meta.name}` : ""} · ${meta.chain}`;
    let r;
    try { r = await fetch(`/api/report?chain=${encodeURIComponent(meta.chain)}&token=${encodeURIComponent(meta.token)}`).then((x) => x.json()); } catch { return; }
    game.report = r;
    const holders = r.nodes.filter((n) => n.kind === "holder").map((n) => ({ ...n }));
    const clustered = holders.filter((n) => n.cluster).length;
    game.maxPicks = Math.min(5, clustered);
    game.graph.graphData({ nodes: holders, links: [] });
    setTimeout(() => game.graph.zoomToFit(800, 30), 1600);
    $("gameBrief").innerHTML = `<p>Veritas found <b>${r.clusters.length} hidden cluster${r.clusters.length === 1 ? "" : "s"}</b> among the top ${holders.length} holders of this token: ${clustered} wallets secretly linked to each other.</p>
      <p class="muted">Pick up to <b>${game.maxPicks}</b> wallets you think are insiders. Hover for hints: size, 30-day moves and Nansen labels. Grey-dark wallets are exchanges and contracts.</p>`;
    renderPicks();
  }

  function togglePick(n) {
    if (game.revealed || n.kind === "hub") return;
    if (n.category === "exchange" || n.category === "contract") return toast("Exchanges and contracts can't be insiders here");
    if (game.picks.has(n.id)) game.picks.delete(n.id);
    else if (game.picks.size >= game.maxPicks) return toast(`You can pick up to ${game.maxPicks} wallets`);
    else game.picks.add(n.id);
    game.graph.nodeColor(game.graph.nodeColor()).nodeVal(game.graph.nodeVal());
    renderPicks();
  }

  function renderPicks() {
    const nodes = game.graph ? game.graph.graphData().nodes : [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    $("pickCount").textContent = `${game.picks.size} / ${game.maxPicks}`;
    $("revealBtn").disabled = game.picks.size === 0 || game.revealed;
    $("picks").innerHTML = game.picks.size
      ? [...game.picks].map((id) => {
          const n = byId.get(id);
          const mark = !game.revealed ? "" : n.cluster ? `<span class="pos">Cluster ${n.cluster}</span>` : `<span class="muted">No links</span>`;
          return `<li><span class="mono">${esc(short(id))}</span><span class="muted small">${esc(n.label || "")} ${pct(n.share)}</span>${mark}</li>`;
        }).join("")
      : `<li class="muted">No wallets picked yet.</li>`;
  }

  function reveal() {
    const r = game.report;
    game.revealed = true;
    const nodes = game.graph.graphData().nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let pts = 0, hits = 0;
    for (const id of game.picks) {
      const n = byId.get(id);
      if (n.cluster) { hits++; pts += 100 + (n.cluster === 1 ? 50 : 0); } else pts -= 25;
    }
    game.score += pts;
    $("gameScore").textContent = game.score;
    // Bring in the real links and shared funders.
    const hubs = r.nodes.filter((n) => n.kind === "hub").map((n) => ({ ...n }));
    game.graph.graphData({ nodes: [...nodes, ...hubs], links: r.links.map((l) => ({ source: l.source, target: l.target })) });
    game.graph.nodeColor(game.graph.nodeColor());
    renderPicks();
    const c1 = r.clusters[0];
    const hub = c1 && c1.via.length ? r.nodes.find((n) => n.id === c1.via[0]) : null;
    $("resultChip").textContent = `${hits} / ${game.picks.size} correct`;
    $("resultChip").className = `badge ${hits === game.picks.size ? "badge-good" : hits ? "badge-warn" : "badge-bad"}`;
    $("resultBody").innerHTML = `<p><b class="mono">${pts >= 0 ? "+" : "−"}${Math.abs(pts)}</b> points this round.</p>
      <p class="muted">The largest cluster is <b>${c1.size} wallets</b> holding <b>${pct(c1.share)}</b> of supply${hub ? `, linked by <b>${esc(hub.relation)}</b>` : ""}. Green = your correct picks, red = insiders you missed.</p>
      <a href="/app?chain=${encodeURIComponent(r.chain)}&token=${encodeURIComponent(r.token)}">Open the full report</a>`;
    $("gameResult").hidden = false;
    $("revealBtn").hidden = true;
    const last = game.round + 1 >= game.rounds.length;
    $("nextBtn").hidden = false;
    $("nextBtn").textContent = last ? "Finish" : "Next token";
  }

  function next() {
    if (game.round + 1 < game.rounds.length) {
      game.round++;
      return loadRound();
    }
    saveBest(game.score);
    $("gameBest").textContent = readBest();
    $("resultChip").textContent = "Game over";
    $("resultChip").className = "badge";
    $("resultBody").innerHTML = `<p>Final score <b class="mono">${game.score}</b> across ${game.rounds.length} real token${game.rounds.length === 1 ? "" : "s"}.</p><p class="muted">Your best: ${readBest()}</p>`;
    $("nextBtn").textContent = "Play again";
    $("nextBtn").onclick = () => { $("nextBtn").onclick = next; startGame(); };
  }

  $("revealBtn").addEventListener("click", reveal);
  $("nextBtn").onclick = next;

  function route() {
    const p = new URLSearchParams(location.search);
    const token = p.get("token");
    if (token) {
      if (token !== state.token || !state.report) startScan(p.get("chain") || "ethereum", token);
      else showView("token");
      return;
    }
    if (state.source) state.source.close();
    stopOrbit();
    const view = p.get("view");
    if (view === "game") return startGame();
    if (view === "markets") return openMarkets();
    showView(view === "leaderboard" || view === "methodology" ? view : "home");
  }
  window.addEventListener("popstate", route);

  async function init() {
    try {
      const cfg = await fetch("/api/config").then((r) => r.json());
      state.live = cfg.live;
      $("chain").innerHTML = cfg.chains.map((c) => `<option value="${c}">${c}</option>`).join("");
      $("apiStatus").classList.toggle("live", cfg.live);
      $("apiLabel").textContent = cfg.live ? "Nansen API" : "No API key";
      $("modeNote").textContent = !cfg.live
        ? "No Nansen API key configured: add NANSEN_API_KEY to .env to start scanning."
        : cfg.readOnly
          ? "Read-only instance: browse verified tokens below."
          : "";
    } catch { /* ignore */ }
    refreshStats();
    setInterval(refreshStats, 15000);
    loadReports();
    if (state.live) loadTrending();
    route();
  }
  init();
})();
