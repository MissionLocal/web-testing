<script>
  import { onMount, onDestroy, tick } from "svelte";
  import * as d3 from "d3";

  import graph from "../data/graph.json";
  import { scrollyCommand } from "../../lib/scrollyController";

  // ---- DATA ----
  const allNodes = graph.nodes;
  const allLinks = graph.links;

  const nodes = allNodes;
  const links = allLinks;

  // ---- SEARCH UI ----
  let searchTerm = "";
  let searchStatus = "";

  function norm(s) {
    return (s ?? "").toString().trim().toLowerCase();
  }

  function searchMatches(q) {
    const qq = norm(q);
    if (!qq) return null;
    const ids = new Set();
    for (const n of allNodes) {
      if (norm(n.label).includes(qq)) ids.add(n.id);
    }
    return ids;
  }

  function linkSourceId(l) {
    return l.source?.id ?? l.source;
  }
  function linkTargetId(l) {
    return l.target?.id ?? l.target;
  }

  function clearSearchDimming() {
    if (!gNodes || !gLinks) return;
    gNodes.selectAll("circle").classed("is-search-hi", false).classed("is-search-dim", false);
    gLinks.selectAll("line").classed("is-search-hi", false).classed("is-search-dim", false);
    searchStatus = "";
  }

  function applySearchDimming(matchIds) {
    if (!gNodes || !gLinks) return;

    if (!matchIds) {
      clearSearchDimming();
      return;
    }

    const matchCount = matchIds.size;
    if (matchCount === 0) {
      clearSearchDimming();
      searchStatus = "No matches";
      return;
    }

    searchStatus = matchCount === 1 ? "1 match" : `${matchCount} matches`;

    gNodes
      .selectAll("circle")
      .classed("is-search-hi", (n) => matchIds.has(n.id))
      .classed("is-search-dim", (n) => !matchIds.has(n.id));

    gLinks
      .selectAll("line")
      .classed("is-search-hi", (l) => matchIds.has(linkSourceId(l)) && matchIds.has(linkTargetId(l)))
      .classed(
        "is-search-dim",
        (l) => !(matchIds.has(linkSourceId(l)) && matchIds.has(linkTargetId(l))),
      );
  }

  function onSearchInput() {
    mobileFilterOpen = false;

    const matches = searchMatches(searchTerm);
    applySearchDimming(matches);
    applyCategoryDimming();

    if (pinned?.type === "node") applyFocus(pinned.id);
    if (pinned?.type === "link" && pinned.key) {
      // link focus/labels already pinned
    }
  }

  function clearSearch() {
    searchTerm = "";
    searchStatus = "";
    applySearchDimming(null);
    applyCategoryDimming();
    if (pinned?.type === "node") applyFocus(pinned.id);
  }

  // ---- FILTER UI ----
  let selectedGroups = new Set(); // empty Set == "All"
  const isAllSelected = () => selectedGroups.size === 0;

  let mobileFilterOpen = false;
  let filterRenderKey = 0;

  const groupOptions = Array.from(
    new Set(allNodes.flatMap((n) => (n.groups?.length ? n.groups : ["other"]))),
  ).sort();

  function toggleGroup(g) {
    let next;

    if (g === "all") {
      next = new Set();
    } else {
      next = new Set(selectedGroups);
      if (next.has(g)) next.delete(g);
      else next.add(g);

      if (groupOptions.every((opt) => next.has(opt))) next = new Set();
    }

    selectedGroups = next;

    // Clear pin + focus when changing filter
    pinned = null;
    hideInfo(true);
    clearFocus();
    hideAllLabels();

    applySearchDimming(searchMatches(searchTerm));
    applyCategoryDimming();

    filterRenderKey += 1;
  }

  // ---- AVATARS ----
  const imageFiles = import.meta.glob("../../assets/avatars/*.{png,jpg,jpeg,svg}", {
    eager: true,
    as: "url",
  });

  function findImageUrl(id) {
    for (const ext of ["png", "jpg", "jpeg", "svg"]) {
      const key = `../../assets/avatars/${id}.${ext}`;
      if (imageFiles[key]) return imageFiles[key];
    }
    return null;
  }

  const idToImg = new Map(allNodes.map((n) => [n.id, findImageUrl(n.id)]));

  // ---- D3 STATE ----
  let wrapper;
  let container;
  let infoPanelEl;

  let svg, defs, gRoot, gLinks, gNodes, gLabels, gLinkHits;
  let width = 800,
    height = 500;
  let simulation;

  let linkSel, nodeSel, labelSel;

  // ---- INFO PANEL / PIN ----
  let pinned = null; // null | { type: "node", id } | { type: "link", key }
  let infoVisible = false;
  let infoHTML = "";

  function isPinned() {
    return pinned !== null;
  }

  function escapeHTML(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function primaryGroup(d) {
    return d.groups?.length ? d.groups[0] : "other";
  }

  const nodeHTML = (d) => {
    const label = escapeHTML(d.label);
    const desc = d.label_description ? escapeHTML(d.label_description) : "";
    const g = escapeHTML(primaryGroup(d));
    return `
      <div class="info-head">
        <div class="info-label"><strong>${label}</strong></div>
        <span class="button info-pill" aria-hidden="true">${g}</span>
      </div>
      ${desc ? `<div class="info-description">${desc}</div>` : ""}
    `;
  };

  function linkHTML(d) {
    return d.notes ? `<div class="info-description">${escapeHTML(d.notes)}</div>` : "";
  }

  function showInfo(html) {
    infoHTML = html;
    infoVisible = true;
    requestAnimationFrame(postHeight);
  }

  function hideInfo(force = false) {
    if (!force && isPinned()) return;
    infoVisible = false;
    requestAnimationFrame(postHeight);
  }

  function safeId(raw) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(raw);
    return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // ---- COLORS / SIZES ----
  const allGroups = Array.from(
    new Set(allNodes.flatMap((n) => (n.groups?.length ? [n.groups[0]] : ["other"]))),
  );
  const color = d3.scaleOrdinal().domain(allGroups).range(d3.schemeSet2);

  const r = (d) => 6 + d.size * 4;

  const PADDING = 4;
  function clampNode(d) {
    const rad = r(d) + PADDING;
    d.x = Math.max(rad, Math.min(width - rad, d.x));
    d.y = Math.max(rad, Math.min(height - rad, d.y));
  }

  // ---- LABELS (clamped inside SVG) ----
  const LABEL_PAD = 6;
  const LABEL_GAP = 8;

  function clampLabelToBounds(d, el) {
    const w = el.getComputedTextLength ? el.getComputedTextLength() : 60;

    const minX = LABEL_PAD + w / 2;
    const maxX = width - LABEL_PAD - w / 2;
    const x = Math.max(minX, Math.min(maxX, d.x));

    const yAbove = d.y - (r(d) + LABEL_GAP);
    const minY = 14;
    const y = Math.max(minY, yAbove);

    return { x, y };
  }

  function showOnlyLabel(nodeId) {
    if (!gLabels) return;
    gLabels.selectAll("text").style("opacity", (n) => (n.id === nodeId ? 1 : 0));
  }

  function showLinkEndpointLabels(l) {
    if (!gLabels) return;
    const s = linkSourceId(l);
    const t = linkTargetId(l);
    gLabels.selectAll("text").style("opacity", (n) => (n.id === s || n.id === t ? 1 : 0));
  }

  function hideAllLabels() {
    if (!gLabels) return;
    gLabels.selectAll("text").style("opacity", 0);
  }

  // ---- FOCUS ----
  function neighborsOf(nodeId) {
    const neigh = new Set([nodeId]);
    for (const l of links) {
      const s = linkSourceId(l);
      const t = linkTargetId(l);
      if (s === nodeId) neigh.add(t);
      else if (t === nodeId) neigh.add(s);
    }
    return neigh;
  }

  function applyFocus(nodeId) {
    if (!gNodes || !gLinks) return;

    const neigh = neighborsOf(nodeId);

    gNodes
      .selectAll("circle")
      .classed("is-hi", (n) => neigh.has(n.id))
      .classed("is-dim", (n) => !neigh.has(n.id));

    gLinks
      .selectAll("line")
      .classed("is-hi", (l) => linkSourceId(l) === nodeId || linkTargetId(l) === nodeId)
      .classed("is-dim", (l) => !(linkSourceId(l) === nodeId || linkTargetId(l) === nodeId));
  }

  function applyLinkFocus(l) {
    if (!gNodes || !gLinks) return;

    const s = linkSourceId(l);
    const t = linkTargetId(l);
    const endpoints = new Set([s, t]);

    gNodes
      .selectAll("circle")
      .classed("is-hi", (n) => endpoints.has(n.id))
      .classed("is-dim", (n) => !endpoints.has(n.id));

    gLinks.selectAll("line").classed("is-hi", (lnk) => lnk === l).classed("is-dim", (lnk) => lnk !== l);
  }

  function clearFocus() {
    if (!gNodes || !gLinks) return;
    gNodes.selectAll("circle").classed("is-dim", false).classed("is-hi", false);
    gLinks.selectAll("line").classed("is-dim", false).classed("is-hi", false);
  }

  function linkKey(l) {
    const s = linkSourceId(l);
    const t = linkTargetId(l);
    return `${s}→${t}`;
  }

  function unpin() {
    pinned = null;
    hideInfo(true);
    clearFocus();
    hideAllLabels();
  }

  // ---- CATEGORY DIMMING ----
  function nodeGroups(n) {
    return n.groups?.length ? n.groups : ["other"];
  }

  function computeCategoryHighlightSet() {
    if (isAllSelected()) return null;
    const hi = new Set();
    for (const n of allNodes) {
      const gs = nodeGroups(n);
      if (gs.some((g) => selectedGroups.has(g))) hi.add(n.id);
    }
    return hi;
  }

  function applyCategoryDimming() {
    if (!gNodes || !gLinks) return;

    const hi = computeCategoryHighlightSet();

    if (!hi) {
      gNodes.selectAll("circle").classed("is-cat-hi", false).classed("is-cat-dim", false);
      gLinks.selectAll("line").classed("is-cat-hi", false).classed("is-cat-dim", false);
      return;
    }

    gNodes
      .selectAll("circle")
      .classed("is-cat-hi", (n) => hi.has(n.id))
      .classed("is-cat-dim", (n) => !hi.has(n.id));

    gLinks
      .selectAll("line")
      .classed("is-cat-hi", (l) => hi.has(linkSourceId(l)) && hi.has(linkTargetId(l)))
      .classed("is-cat-dim", (l) => !(hi.has(linkSourceId(l)) && hi.has(linkTargetId(l))));
  }

  // ---- PYM ----
  let pymChild = null;

  function postHeight() {
    try {
      if (pymChild) pymChild.sendHeight();
    } catch {}
  }

  // Observe wrapper size changes (includes byline + info panel)
  let ro;
  let heightRaf = 0;

  function startHeightObserver() {
    if (!pymChild || typeof ResizeObserver === "undefined" || !wrapper) return;

    ro = new ResizeObserver(() => {
      cancelAnimationFrame(heightRaf);
      heightRaf = requestAnimationFrame(() => postHeight());
    });

    ro.observe(wrapper);
  }

  const PANEL_RESERVE_PX = 10;
  function reservePanelSpace() {
    if (!container) return;
    container.style.setProperty("--panel-overlap", PANEL_RESERVE_PX + "px");
  }

  // ---- D3 INIT ----
  function init() {
    svg = d3
      .select(container)
      .insert("svg", ":first-child")
      .attr("class", "net-svg")
      .attr("width", width)
      .attr("height", height);

    defs = svg.append("defs");
    gRoot = svg.append("g");

    // Order: visible links, then wide hit targets, then nodes, then labels
    gLinks = gRoot.append("g").attr("class", "links");
    gLinkHits = gRoot.append("g").attr("class", "link-hits");
    gNodes = gRoot.append("g").attr("class", "nodes");
    gLabels = gRoot.append("g").attr("class", "labels");

    // Visible links (appearance unchanged)
    linkSel = gLinks
      .selectAll("line")
      .data(links, (d) => (d.source.id ?? d.source) + "->" + (d.target.id ?? d.target))
      .join("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => 1 + 3 * (d.strength ?? 0.5));

    // Invisible wide hit targets for links (mobile-friendly)
    const isMobileNow = window.matchMedia("(max-width: 640px)").matches;
    const HIT_PX = isMobileNow ? 22 : 14;

    gLinkHits
      .selectAll("line")
      .data(links, (d) => (d.source.id ?? d.source) + "->" + (d.target.id ?? d.target))
      .join("line")
      .attr("stroke", "transparent")
      .attr("stroke-width", HIT_PX)
      .style("cursor", "pointer")
      .style("pointer-events", "stroke")
      .on("pointerenter", (event, d) => {
        // ✅ hover: focus + endpoint labels only (NO info box)
        linkSel.filter((x) => x === d).raise();
        if (!isPinned()) {
          applyLinkFocus(d);
          showLinkEndpointLabels(d);
        }
      })
      .on("pointerleave", () => {
        if (!isPinned()) {
          clearFocus();
          hideAllLabels();
        }
      })
      .on("pointerdown", (event, d) => {
        // ✅ click: pin + show info + endpoint labels
        const k = linkKey(d);

        if (pinned?.type === "link" && pinned.key === k) {
          unpin();
          applySearchDimming(searchMatches(searchTerm));
          applyCategoryDimming();
        } else {
          pinned = { type: "link", key: k };
          applyLinkFocus(d);
          showLinkEndpointLabels(d);
          showInfo(linkHTML(d)); // info only on click
        }

        event.stopPropagation();
      });

    // Nodes
    nodeSel = gNodes
      .selectAll("circle")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const circles = enter.append("circle").attr("r", r).attr("stroke", "#333").attr("stroke-width", 1);

        circles.each(function (d) {
          const url = idToImg.get(d.id);
          if (url) {
            const patId = `pat-${safeId(d.id)}`;
            const pat = defs
              .append("pattern")
              .attr("id", patId)
              .attr("patternUnits", "objectBoundingBox")
              .attr("patternContentUnits", "objectBoundingBox")
              .attr("width", 1)
              .attr("height", 1);

            pat
              .append("image")
              .attr("href", url)
              .attr("xlink:href", url)
              .attr("x", 0)
              .attr("y", 0)
              .attr("width", 1)
              .attr("height", 1)
              .attr("preserveAspectRatio", "xMidYMid slice");

            d3.select(this).attr("fill", `url(#${patId})`);
          } else {
            d3.select(this).attr("fill", color(primaryGroup(d)));
          }
        });

        return circles;
      })
      .on("pointerenter", (event, d) => {
        // ✅ hover: focus + label only (NO info box)
        if (!isPinned()) {
          applyFocus(d.id);
          showOnlyLabel(d.id);
        }
      })
      .on("pointerleave", () => {
        if (!isPinned()) {
          clearFocus();
          hideAllLabels();
        }
      })
      .on("pointerdown", (event, d) => {
        // ✅ click: pin + show info + label
        if (pinned?.type === "node" && pinned.id === d.id) {
          unpin();
          applySearchDimming(searchMatches(searchTerm));
          applyCategoryDimming();
        } else {
          pinned = { type: "node", id: d.id };
          applySearchDimming(searchMatches(searchTerm));
          applyCategoryDimming();
          applyFocus(d.id);
          showOnlyLabel(d.id);
          showInfo(nodeHTML(d)); // info only on click
        }
        event.stopPropagation();
      })
      .call(drag());

    // Labels (hidden default)
    labelSel = gLabels
      .selectAll("text")
      .data(nodes, (d) => d.id)
      .join("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .text((d) => d.label)
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Background click = clear pin
    d3.select(container).on("pointerdown", () => {
      unpin();
      mobileFilterOpen = false;
      applySearchDimming(searchMatches(searchTerm));
      applyCategoryDimming();
    });

    // Forces
    const idSet = new Set(nodes.map((d) => d.id));
    const cleanLinks = links.filter((l) => {
      const s = l.source?.id ?? l.source;
      const t = l.target?.id ?? l.target;
      return idSet.has(s) && idSet.has(t);
    });

    simulation = d3
      .forceSimulation(nodes)
      .force("link", d3.forceLink(cleanLinks).id((d) => d.id).strength((d) => d.strength ?? 1).distance(50))
      .force("charge", d3.forceManyBody().strength(-50))
      .force("collide", d3.forceCollide().radius((d) => r(d) + 6))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.08))
      .force("y", d3.forceY(height / 2).strength(0.08))
      .on("tick", () => {
        nodes.forEach(clampNode);

        // visible links
        linkSel
          .attr("x1", (d) => d.source.x)
          .attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y);

        // hit targets
        gLinkHits
          .selectAll("line")
          .attr("x1", (d) => d.source.x)
          .attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y);

        // nodes
        gNodes.selectAll("circle").attr("cx", (d) => d.x).attr("cy", (d) => d.y);

        // clamped labels
        gLabels.selectAll("text").each(function (d) {
          const { x, y } = clampLabelToBounds(d, this);
          d3.select(this).attr("x", x).attr("y", y);
        });
      });

    resize();
    reservePanelSpace();

    applyCategoryDimming();
    applySearchDimming(searchMatches(searchTerm));
  }

  function resize() {
    if (!container) return;

    const w = Math.round(container.clientWidth || 800);
    const isMobile = window.matchMedia("(max-width: 640px)").matches;

    width = w;
    height = isMobile ? 600 : Math.max(420, Math.min(860, Math.round(w * 0.68)));

    svg.attr("width", width).attr("height", height);

    simulation?.force("center", d3.forceCenter(width / 2, height / 2)).alpha(0.4).restart();

    reservePanelSpace();
  }

  function drag() {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      const rad = r(d) + PADDING;
      d.fx = Math.max(rad, Math.min(width - rad, event.x));
      d.fy = Math.max(rad, Math.min(height - rad, event.y));
    }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
  }

  // ---- SCROLLY + LIFECYCLE ----
  let unsubscribeScrolly;
  let _onWinResize, _onLoad;

  onMount(async () => {
    init();

    unsubscribeScrolly = scrollyCommand.subscribe((cmd) => {
      if (!cmd) return;
      if (!container) return;

      if (cmd.type === "highlightFilters") {
        const el = container.querySelector("[data-ui='filters']");
        if (el) el.classList.toggle("coach-highlight", !!cmd.on);
      }
    });

    try {
      if (window.pym) pymChild = new window.pym.Child();
    } catch {}

    await tick();
    requestAnimationFrame(postHeight);

    startHeightObserver();

    setTimeout(postHeight, 250);
    setTimeout(postHeight, 1000);

    _onLoad = () => postHeight();
    window.addEventListener("load", _onLoad);

    _onWinResize = () => {
      resize();
      postHeight();
    };
    window.addEventListener("resize", _onWinResize);
  });

  onDestroy(() => {
    unsubscribeScrolly?.();
    ro?.disconnect();
    cancelAnimationFrame(heightRaf);

    window.removeEventListener("resize", _onWinResize);
    window.removeEventListener("load", _onLoad);

    simulation?.stop();
  });
</script>

<div class="network-chart" bind:this={wrapper}>
  <div class="chart" bind:this={container}>
    <div class="controls" on:pointerdown|stopPropagation>
      <!-- Desktop pills -->
      <div class="controls-buttons" data-ui="filters">
        <button
          class="button"
          class:primary={selectedGroups.size === 0}
          on:click={() => toggleGroup("all")}
          type="button"
        >
          All
        </button>

        {#each groupOptions as g}
          <button
            class="button"
            class:primary={selectedGroups.has(g)}
            on:click={() => toggleGroup(g)}
            type="button"
          >
            {g}
          </button>
        {/each}
      </div>

      <!-- Mobile dropdown -->
      <div class="controls-select" on:pointerdown|stopPropagation>
        <button
          class="button"
          class:primary={selectedGroups.size > 0}
          type="button"
          aria-expanded={mobileFilterOpen}
          on:click={() => (mobileFilterOpen = !mobileFilterOpen)}
        >
          {selectedGroups.size === 0 ? "Select issue" : `Filter (${selectedGroups.size})`}
        </button>

        {#if mobileFilterOpen}
          {#key filterRenderKey}
            <div class="filter-pop" role="dialog" aria-label="Filter topics">
              <label class="filter-item">
                <input
                  type="checkbox"
                  checked={selectedGroups.size === 0}
                  on:change={() => toggleGroup("all")}
                />
                <span>All</span>
              </label>

              {#each groupOptions as g}
                <label class="filter-item">
                  <input
                    type="checkbox"
                    checked={selectedGroups.has(g)}
                    on:change={() => toggleGroup(g)}
                  />
                  <span>{g}</span>
                </label>
              {/each}
            </div>
          {/key}
        {/if}
      </div>

      <!-- Search -->
      <div class="controls-search">
        <input
          class="search-input"
          type="search"
          placeholder="Search…"
          bind:value={searchTerm}
          on:input={onSearchInput}
          on:keydown={(e) => {
            if (e.key === "Escape") clearSearch();
          }}
        />

        {#if searchTerm}
          <button class="button ghost search-clear" type="button" on:click={clearSearch}>
            Clear
          </button>
        {/if}

        {#if searchStatus}
          <div class="search-status" aria-live="polite">{searchStatus}</div>
        {/if}
      </div>
    </div>

    <div
      class="info-panel"
      aria-live="polite"
      bind:this={infoPanelEl}
      style:display={infoVisible ? "block" : "none"}
    >
      <div class="info-content">{@html infoHTML}</div>
    </div>
  </div>

  <div class="byline">Eleni Balakrishnan &amp; Kelly Waldron • Mission Local</div>
</div>
