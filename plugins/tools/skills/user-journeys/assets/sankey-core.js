// sankey-core.js — pure graph logic shared by the HTML template and the build script's self-test.
// paths: [[sessionCount, [viewIndex, ...]], ...] with consecutive repeats already collapsed.
// Each session becomes a trace: the ordered node ids it passes through. Links and node values are
// derived from traces, so hover highlights can count exactly the sessions behind any node or link.
var SankeyCore = (() => {
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  const topEntries = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);

  function nodeMaker(info) {
    return (id, label, step, kind) => {
      if (!info.has(id)) info.set(id, { id, label, step, kind, value: 0, members: new Map() });
      return info.get(id);
    };
  }

  function finish(info, traces) {
    const links = new Map();
    let total = 0;
    for (const { n, ids } of traces) {
      total += n;
      ids.forEach((id, i) => {
        info.get(id).value += n;
        if (i) add(links, ids[i - 1] + ">" + id, n);
      });
    }
    return {
      nodes: [...info.values()],
      links: [...links].map(([k, value]) => { const [source, target] = k.split(">"); return { source, target, value }; }),
      traces,
      total,
    };
  }

  // Common journeys: column i = i-th distinct page of the session. Pages outside the top `topN`
  // for that column collapse into "Other". Sessions end in Exit, or Continues if longer than `depth`.
  function buildCommon(paths, views, depth, topN) {
    const vol = Array.from({ length: depth }, () => new Map());
    for (const [n, p] of paths) p.slice(0, depth).forEach((v, i) => add(vol[i], v, n));
    // An "Other" holding a single page hides nothing useful, so keep topN + 1 pages outright.
    const keep = vol.map((m) => new Set(m.size <= topN + 1 ? m.keys() : topEntries(m, topN).map((e) => e[0])));
    const info = new Map(), node = nodeMaker(info), traces = [];
    for (const [n, p] of paths) {
      const steps = p.slice(0, depth);
      const ids = steps.map((v, i) => {
        if (keep[i].has(v)) return node(`${i}:${v}`, views[v], i, "view").id;
        const o = node(`${i}:other`, "Other", i, "other");
        add(o.members, views[v], n);
        return o.id;
      });
      const L = steps.length;
      ids.push(p.length > depth ? node(`${L}:cont`, "Continues", L, "cont").id : node(`${L}:exit`, "Exit", L, "exit").id);
      traces.push({ n, ids });
    }
    return finish(info, traces);
  }

  // Funnel: a session enters at steps[0]. ordered = later steps must follow in order, other pages
  // allowed between; strict = each step must be the very next page. Sessions that stop early end in
  // "Exited" (session ended right there) or "Went elsewhere" (kept browsing, never reached the next step).
  function buildFunnel(paths, views, steps, strict) {
    const idx = steps.map((s) => views.indexOf(s));
    const info = new Map(), node = nodeMaker(info), traces = [];
    const reached = steps.map(() => 0);
    for (const [n, p] of paths) {
      let k = 0, pos = -1;
      if (strict) {
        for (let s = 0; s < p.length; s++) {
          if (p[s] !== idx[0]) continue;
          let j = 1;
          while (j < steps.length && p[s + j] === idx[j]) j++;
          if (j > k) { k = j; pos = s + j - 1; }
        }
      } else {
        for (let j = 0; j < p.length && k < steps.length; j++) if (p[j] === idx[k]) { k++; pos = j; }
      }
      if (!k) continue;
      const ids = [];
      for (let i = 0; i < k; i++) { reached[i] += n; ids.push(node(`${i}:step`, steps[i], i, "view").id); }
      if (k < steps.length) {
        const next = p[pos + 1];
        if (next === undefined) ids.push(node(`${k}:exit`, "Exited", k, "exit").id);
        else { const d = node(`${k}:drop`, "Went elsewhere", k, "drop"); add(d.members, views[next], n); ids.push(d.id); }
      }
      traces.push({ n, ids });
    }
    return Object.assign(finish(info, traces), { reached });
  }

  // Sessions whose trace satisfies `hit`, with the node and link counts of just those sessions.
  function trace(traces, hit) {
    const nodes = new Map(), links = new Map();
    let n = 0;
    for (const t of traces) {
      if (!hit(t.ids)) continue;
      n += t.n;
      t.ids.forEach((id, i) => { add(nodes, id, t.n); if (i) add(links, t.ids[i - 1] + ">" + id, t.n); });
    }
    return { n, nodes, links };
  }

  return { buildCommon, buildFunnel, trace, topEntries };
})();
