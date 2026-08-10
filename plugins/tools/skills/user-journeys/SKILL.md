---
name: user-journeys
description: Generate a self-contained interactive HTML Sankey diagram from Dynatrace RUM session path data. Use when the user asks to visualize user journeys, session paths, or navigation flows from Dynatrace. Requires dtctl with user.events read access.
---

# Sankey HTML — Session Path Analysis

Generate a self-contained interactive HTML Sankey diagram from Dynatrace RUM session data.

## --install flag

If the user invokes this skill with `--install`, run the following checks and fixes **before** proceeding to Step 0. Skip this section entirely on normal runs.

### 1. Check dtctl binary

```bash
dtctl version
```

If the command fails (not found or exits non-zero), install using the first applicable method:

**Homebrew (Mac/Linux — check first):**
```bash
brew install dynatrace-oss/tap/dtctl
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.ps1 | iex
```

After install, verify with `dtctl version`. If it still fails, tell the user and stop.

### 2. Install Claude skills

```bash
dtctl skills install --for claude
```

This registers dtctl's built-in Claude skills. Run unconditionally on `--install`.

### 3. Add environment context

Check if any contexts already exist:

```bash
dtctl config get-contexts
```

If contexts exist, skip this step — setup is complete.

If no contexts exist, ask the user for:
- A **context name** for this environment (e.g. `production`, `my-env`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.live.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
```

This opens the browser-based OAuth login flow. Tell the user to complete it and confirm when done.

### 4. Run doctor

```bash
dtctl doctor
```

Show the output. If any check fails, surface the error and tell the user to resolve it before proceeding. Do not continue to Step 0 until `dtctl doctor` passes cleanly.

### 5. Report

Tell the user: `dtctl` version installed, context name, and environment URL. Then continue to Step 0.

---

## OAuth failure handling

If **any** `dtctl` command in this skill returns an error containing `"token"` and `"not found"` or any other authentication error, notify the user their token has expired, run `dtctl auth login`, wait for the browser OAuth flow to complete, then retry the failed command before continuing.

## When to use

User asks to "generate a session path/sankey/journey HTML" or "visualize user journeys" from Dynatrace data.

## Inputs

Collect before starting:

1. **App name** — picked interactively in Step 1
2. **Time range** — picked interactively in Step 0b (default: last 2h)
3. **Mode** — picked interactively in Step 1b (Common User Journeys or Pick a Journey)
4. **Output path** — default: `~/Downloads/session-sankey-<appname>-<date>.html`
5. **Max depth** — Common User Journeys only, default: 6 steps. Accept 3–10.

## Steps

### Step 0 — Confirm dtctl context

```bash
dtctl config current-context
```

If the command fails or returns empty, tell the user no context is configured and stop — they need to run `dtctl auth login` first.

If the command fails or returns empty, tell the user no context is configured — they need to run `dtctl auth login` first.

Otherwise, get the environment URL:
```bash
dtctl config describe-context $(dtctl config current-context) --plain
```

Use `AskUserQuestion` with three options, where the first option names the current context and environment:

- **Continue with \<context-name\>** (`\<environment-url\>`) — proceed as-is
- **Switch context** — list available contexts and pick one
- **Add new context** — authenticate a new environment

**If switching:**

```bash
dtctl config get-contexts --plain
```

Use `AskUserQuestion` to let the user pick from the returned context names, then:

```bash
dtctl config use-context "CHOSEN_CONTEXT"
```

**If adding new context:**

Ask for:
- A **context name** (e.g. `production`, `staging`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.apps.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
```

Tell the user to complete the browser OAuth flow and confirm when done.

After switch or add, confirm the active context with `dtctl config current-context` before continuing.

### Step 0b — Pick a timeframe

Use `AskUserQuestion`:

> "What time range should we fetch session data for?"

Options:
- `Last 2 hours` (default)
- `Last 24 hours`
- `Last 7 days`

Map to DQL timeframe expressions:
- Last 2 hours → `now()-2h`
- Last 24 hours → `now()-24h`
- Last 7 days → `now()-7d`

Set `TF` to the chosen expression. Use `| timeframe from:TF` in all subsequent queries.

### Step 1 — Pick a frontend

Fetch all apps with session counts, sorted descending:

```bash
dtctl query "fetch user.events, from: TF | summarize sessions=count(), by: {frontend.name} | filterOut isNull(frontend.name) | sort sessions desc" -o json --plain
```

Show the first 10 results as a numbered list with session counts. Use `AskUserQuestion` with those 10 as options plus a **"Show more"** option.

If the user picks **Show more**, show the next 10 (offset 10), again with a Show more option at the bottom. Repeat until the list is exhausted or the user picks an app.

Once an app is selected, set `APP_NAME`.

### Step 1b — Pick a mode

Use `AskUserQuestion`:

> "Which visualization mode?"

Options:
- **Common User Journeys** — shows all session paths as a Sankey, top routes surfaced automatically
- **Pick a Journey** — define up to 6 specific steps; shows funnel dropout at each transition

If **Common User Journeys** → skip to Step 2.
If **Pick a Journey** → continue to Step 1c.

### Step 1c — Collect journey steps (Pick a Journey only)

**Ask the user to provide their funnel steps** — between 2 and 8 `view.name` values in order, one per message or all at once. Collect them into `FUNNEL_STEPS = ["step0", "step1", ...]`.

**Silently fetch the top 100 view names** for validation (do not display this list):

```bash
dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | summarize count=count(), by: {view.name} | filterOut isNull(view.name) | sort count desc | limit 100" -o json --plain
```

**Validate each step against the top 100:**
- If it appears in the top 100 list → confirmed silently, continue.
- If it does not appear → run a targeted spot-check:
  ```bash
  dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter view.name == \"<STEP>\" | limit 1 | fields view.name" -o json --plain
  ```
  If this returns a record → confirmed (niche view, low volume), continue silently.
  If this returns empty → warn the user that this view name wasn't found in the data, and ask whether to correct it or proceed anyway.

Once all steps are validated, set `FUNNEL_STEPS` and continue to Step 2b.

### Step 2 — Fetch session events

Same query regardless of mode. Escape any double quotes in the app name with `\"`.

```bash
dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | fields dt.rum.session.id, start_time, view.name | sort dt.rum.session.id, start_time asc" -o json --plain --max-result-records 50000
```

**If result.kind == "records":** use `result.records` directly as the records array.

**If result.kind == "result-file":** read the spilled file:
```bash
dtctl inspect <result.path> --head 50000 --fields "dt.rum.session.id,start_time,view.name"
```
Use the rows from inspect as the records array. If the file has more rows than `--head` allows, increase `--head` or note the truncation in the HTML subtitle.

Then go to Step 3 (Common User Journeys) or Step 3b (Pick a Journey).

### Step 3 — Generate the HTML file (Common User Journeys)

_Skip this step if mode is Pick a Journey — go to Step 3b._

Write the output file at the path from Inputs. Use this exact template, substituting the placeholders:

- `__RECORDS_JSON__` → the full records array as a JSON literal (compact, single line)
- `__APP_NAME__` → the app name string
- `__GENERATED_AT__` → current date/time as a human-readable string
- `__MAX_DEPTH__` → the max depth integer (default 6)

**Before writing the HTML file**, download and inline all four d3 libraries (in this order) so the file has no external dependencies:

```bash
curl -sL "https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js" -o /tmp/d3-array.min.js
curl -sL "https://cdn.jsdelivr.net/npm/d3-path@3.1.0/dist/d3-path.min.js" -o /tmp/d3-path.min.js
curl -sL "https://cdn.jsdelivr.net/npm/d3-shape@3.2.0/dist/d3-shape.min.js" -o /tmp/d3-shape.min.js
curl -sL "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js" -o /tmp/d3-sankey.min.js
```

Replace `__D3_LIBS__` in the template with the concatenated content of those four files (d3-array first, then d3-path, d3-shape, d3-sankey). All four register onto `globalThis.d3` in UMD mode.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Path Analysis — __APP_NAME__</title>
  <script>__D3_LIBS__</script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1f2e; color: #c8d0d8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #8a9ab0; margin-bottom: 24px; }
    .chart-container { overflow-x: auto; }
    svg { display: block; margin: 0 auto; overflow: visible; }
    .breakdown { margin-top: 32px; }
    .breakdown h2 { font-size: 13px; color: #8a9ab0; margin-bottom: 12px; font-weight: 500; }
    .steps { display: flex; gap: 1px; align-items: flex-start; overflow-x: auto; }
    .step { flex: 1 1 0; min-width: 140px; }
    .step-bar { height: 6px; }
    .step-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02); gap: 8px; }
    .step-label { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .step-pct { font-size: 11px; font-weight: 600; flex-shrink: 0; }
    .meta { margin-top: 24px; font-size: 12px; color: #666; }
    #hover-info { display:none; position:fixed; top:24px; right:32px; background:rgba(20,24,38,0.92); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:10px 16px; font-size:13px; color:#c8d0d8; pointer-events:none; z-index:10; }
    #hover-info .hi-count { font-size:22px; font-weight:700; color:#fff; display:block; }
    #hover-info .hi-label { font-size:11px; color:#8a9ab0; }
    svg path, svg rect, svg text { transition: opacity 0.12s; }
    .step-row { cursor:pointer; }
    .step-row:hover { background: rgba(255,255,255,0.06) !important; }
  </style>
</head>
<body>
  <h1>Session Path Analysis</h1>
  <div class="subtitle" id="subtitle"></div>
  <div class="chart-container">
    <svg id="sankey" viewBox="0 0 1620 580" style="width:80vw;min-width:600px;height:auto;"></svg>
  </div>
  <div class="breakdown">
    <h2>Step Breakdown</h2>
    <div class="steps" id="breakdown"></div>
  </div>
  <div class="meta" id="meta"></div>
  <div id="hover-info"><span class="hi-count" id="hi-count"></span><span class="hi-label" id="hi-label"></span></div>
  <script>
  (function() {
  var d3Sankey = d3;
  const RECORDS = __RECORDS_JSON__;
  const APP_NAME = "__APP_NAME__";
  const GENERATED_AT = "__GENERATED_AT__";
  const STEP_COLORS = ["#5C5BA8","#1A7A9E","#1A9070","#A07A10","#A86020","#A83050","#1A7848","#2458A0"];
  function buildSankeyData(records, maxDepth = 6) {
    const MAX_NODES_PER_STEP = 8, EXIT_LABEL = "Exit";
    const sessionPaths = new Map();
    for (const r of records) {
      const sid = r["dt.rum.session.id"], view = r["view.name"];
      if (!sid || !view) continue;
      if (!sessionPaths.has(sid)) sessionPaths.set(sid, []);
      const path = sessionPaths.get(sid);
      if (path[path.length-1] !== view) path.push(view);
    }
    const totalSessions = sessionPaths.size;
    const linkCounts = new Map();
    for (const path of sessionPaths.values()) {
      const steps = path.slice(0, maxDepth), truncated = path.length > maxDepth;
      for (let i = 0; i < steps.length; i++) {
        const from = `${i}:${steps[i]}`, isLast = i === steps.length-1;
        const to = isLast ? (truncated ? `${i+1}:Continues Session` : `${i+1}:${EXIT_LABEL}`) : `${i+1}:${steps[i+1]}`;
        const key = `${from}|||${to}`;
        linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
      }
    }
    const nodeVolume = new Map();
    for (const [key, count] of linkCounts) { const [from] = key.split("|||"); nodeVolume.set(from, (nodeVolume.get(from) ?? 0) + count); }
    const topNodesPerStep = new Map();
    for (const [nodeId] of nodeVolume) {
      const step = parseInt(nodeId.split(":")[0]);
      if (!topNodesPerStep.has(step)) topNodesPerStep.set(step, new Set());
      const set = topNodesPerStep.get(step); set.add(nodeId);
      if (set.size > MAX_NODES_PER_STEP) {
        let minId="", minVol=Infinity;
        for (const id of set) { const v = nodeVolume.get(id)??0; if (v<minVol){minVol=v;minId=id;} }
        set.delete(minId);
      }
    }
    const collapsedLinks = new Map();
    for (const [key, count] of linkCounts) {
      const [from, to] = key.split("|||");
      const fromStep = parseInt(from.split(":")[0]), toStep = parseInt(to.split(":")[0]);
      const toLabel = to.slice(to.indexOf(":")+1);
      const canonFrom = topNodesPerStep.get(fromStep)?.has(from) ? from : `${fromStep}:Other`;
      const isExit = toLabel===EXIT_LABEL, isContinues = toLabel==="Continues Session";
      const canonTo = (isExit||isContinues||topNodesPerStep.get(toStep)?.has(to)) ? to : `${toStep}:Other`;
      const ck=`${canonFrom}|||${canonTo}`; collapsedLinks.set(ck,(collapsedLinks.get(ck)??0)+count);
    }
    const nodeSet = new Set();
    for (const [key] of collapsedLinks) { const [f,t]=key.split("|||"); nodeSet.add(f); nodeSet.add(t); }
    const nodeArray = Array.from(nodeSet).sort((a,b)=>parseInt(a.split(":")[0])-parseInt(b.split(":")[0]));
    const nodeIndex = new Map(nodeArray.map((id,i)=>[id,i]));
    const nodes = nodeArray.map(id => { const c=id.indexOf(":"); return {id,label:id.slice(c+1),step:parseInt(id.slice(0,c))}; });
    const links = Array.from(collapsedLinks.entries()).map(([key,value])=>{ const [f,t]=key.split("|||"); return {source:nodeIndex.get(f),target:nodeIndex.get(t),value}; });
    return { nodes, links, totalSessions };
  }
  const data = buildSankeyData(RECORDS, __MAX_DEPTH__);
  if (!data.totalSessions) {
    document.getElementById('subtitle').textContent = APP_NAME + ' — No session data returned';
    document.getElementById('meta').textContent = 'Generated ' + GENERATED_AT;
    return;
  }
  document.getElementById("subtitle").textContent = APP_NAME;
  document.getElementById("meta").textContent = `${data.totalSessions.toLocaleString()} sessions · Generated ${GENERATED_AT}`;
  const WIDTH=1400,HEIGHT=580,NODE_WIDTH=16,NODE_PADDING=40;
  const layout = d3Sankey.sankey().nodeAlign(d3Sankey.sankeyLeft).nodeWidth(NODE_WIDTH).nodePadding(NODE_PADDING).extent([[0,0],[WIDTH,HEIGHT]]);
  const {nodes:ln,links:ll} = layout({nodes:data.nodes.map(n=>({...n})),links:data.links.map(l=>({...l}))});
  const linkPath = d3Sankey.sankeyLinkHorizontal();
  const svg = document.getElementById("sankey");
  const overlay = document.getElementById("hover-info");
  const hiCount = document.getElementById("hi-count");
  const hiLabel = document.getElementById("hi-label");
  const allLinkEls = [];
  const allNodeEls = new Map();
  const upstreamOf = new Map();
  function getUpstreamIds(nodeId) {
    const visited = new Set([nodeId]); const queue = [nodeId];
    while (queue.length) { const id = queue.shift(); for (const {sourceId} of (upstreamOf.get(id)||[])) { if (!visited.has(sourceId)) { visited.add(sourceId); queue.push(sourceId); } } }
    return visited;
  }
  function showHighlight(nodeId) {
    const upIds = getUpstreamIds(nodeId);
    const upLinkEls = new Set(allLinkEls.filter(({sourceId,targetId}) => upIds.has(sourceId) && upIds.has(targetId)).map(({el})=>el));
    for (const {el} of allLinkEls) { el.style.opacity = upLinkEls.has(el) ? '1' : '0.22'; el.setAttribute("stroke-opacity", upLinkEls.has(el) ? '0.65' : '0.22'); }
    for (const [id, {rect, text}] of allNodeEls) { const active = upIds.has(id); if (rect) rect.style.opacity = active ? '1' : '0.25'; if (text) text.style.opacity = active ? '1' : '0.25'; }
    const node = ln.find(n => n.id === nodeId);
    if (node) { const pctReached = ((node.value/data.totalSessions)*100).toFixed(1); hiCount.textContent = `${node.value?.toLocaleString()} (${pctReached}%)`; hiLabel.textContent = `sessions reached "${node.label}"`; overlay.style.display = 'block'; }
  }
  function clearHighlight() {
    for (const {el} of allLinkEls) { el.style.opacity = ''; el.setAttribute("stroke-opacity","0.35"); }
    for (const [,{rect,text}] of allNodeEls) { if (rect) rect.style.opacity=''; if (text) text.style.opacity=''; }
    overlay.style.display = 'none';
  }
  for (const link of ll) {
    const src=link.source,tgt=link.target,pct=((link.value/data.totalSessions)*100).toFixed(1);
    const color=STEP_COLORS[src.step%STEP_COLORS.length];
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",linkPath(link)); path.setAttribute("fill","none");
    path.setAttribute("stroke",color); path.setAttribute("stroke-opacity","0.35");
    path.setAttribute("stroke-width",Math.max(1,link.width??1));
    const title=document.createElementNS("http://www.w3.org/2000/svg","title");
    title.textContent=`${src.label} → ${tgt.label}: ${link.value.toLocaleString()} sessions (${pct}%)`;
    path.appendChild(title); svg.appendChild(path);
    allLinkEls.push({el:path,sourceId:src.id,targetId:tgt.id});
    if (!upstreamOf.has(tgt.id)) upstreamOf.set(tgt.id,[]);
    upstreamOf.get(tgt.id).push({sourceId:src.id});
  }
  for (const node of ln) {
    const {x0=0,x1=0,y0=0,y1=0}=node,nodeH=Math.max(1,y1-y0);
    const isExit=node.label==="Exit",isContinues=node.label==="Continues Session";
    const color=STEP_COLORS[node.step%STEP_COLORS.length];
    const fill=isExit?"#666":isContinues?"#ffffff":color;
    const pct=((node.value/data.totalSessions)*100).toFixed(1);
    const truncated=node.label.length>28?node.label.slice(0,26)+"…":node.label;
    const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x",x0);rect.setAttribute("y",y0);rect.setAttribute("width",x1-x0);rect.setAttribute("height",nodeH);rect.setAttribute("fill",fill);
    rect.style.cursor="pointer";
    const rt=document.createElementNS("http://www.w3.org/2000/svg","title");
    rt.textContent=`${node.label}: ${node.value?.toLocaleString()} sessions (${pct}%)`;
    rect.appendChild(rt);svg.appendChild(rect);
    let textEl=null;
    if (nodeH>=8) {
      const g=document.createElementNS("http://www.w3.org/2000/svg","text");
      g.setAttribute("x",x1+8);g.setAttribute("y",y0+nodeH/2);g.setAttribute("dy","0.35em");g.setAttribute("text-anchor","start");g.setAttribute("font-size","13.5");
      g.setAttribute("fill",isContinues?"#ffffff":isExit?"#aaaaaa":color);
      g.style.cursor="pointer";
      const ps=document.createElementNS("http://www.w3.org/2000/svg","tspan");ps.setAttribute("font-weight","700");ps.textContent=`${pct}%`;
      const ls=document.createElementNS("http://www.w3.org/2000/svg","tspan");ls.setAttribute("fill","#ffffff");ls.textContent=` ${truncated}`;
      g.appendChild(ps);g.appendChild(ls);svg.appendChild(g);
      textEl=g;
    }
    allNodeEls.set(node.id,{rect,text:textEl});
    const onEnter=()=>showHighlight(node.id);
    rect.addEventListener("mouseenter",onEnter); rect.addEventListener("mouseleave",clearHighlight);
    if (textEl) { textEl.addEventListener("mouseenter",onEnter); textEl.addEventListener("mouseleave",clearHighlight); }
  }
  const incomingSum=new Map(),outgoingSum=new Map();
  for (const l of data.links) { incomingSum.set(l.target,(incomingSum.get(l.target)??0)+l.value); outgoingSum.set(l.source,(outgoingSum.get(l.source)??0)+l.value); }
  const byStep=new Map();
  data.nodes.forEach((node,i)=>{ if(node.label==="Continues Session")return; if(!byStep.has(node.step))byStep.set(node.step,[]); const val=incomingSum.get(i)??outgoingSum.get(i)??0; byStep.get(node.step).push({node,value:val}); });
  const container=document.getElementById("breakdown");
  Array.from(byStep.entries()).sort(([a],[b])=>a-b).forEach(([step,entries])=>{
    const color=STEP_COLORS[step%STEP_COLORS.length];
    const col=document.createElement("div");col.className="step";
    const bar=document.createElement("div");bar.className="step-bar";bar.style.background=color;col.appendChild(bar);
    entries.sort((a,b)=>{ if(a.node.label==="Exit")return 1; if(b.node.label==="Exit")return -1; return b.value-a.value; })
      .forEach(({node,value})=>{
        const pct=((value/data.totalSessions)*100).toFixed(1);
        const row=document.createElement("div");row.className="step-row";
        const lbl=document.createElement("span");lbl.className="step-label";
        const isOther=node.label==="Other",isExit=node.label==="Exit";
        lbl.style.color=isOther?"#666":isExit?"#888":"#c8d0d8";lbl.textContent=node.label;
        const pctEl=document.createElement("span");pctEl.className="step-pct";
        pctEl.style.color=(isOther||isExit)?"#888":color;pctEl.textContent=`${pct}%`;
        row.appendChild(lbl);row.appendChild(pctEl);col.appendChild(row);
        row.addEventListener("mouseenter",()=>showHighlight(node.id));
        row.addEventListener("mouseleave",clearHighlight);
      });
    container.appendChild(col);
  });
  })();
  </script>
</body>
</html>
```

### Step 3b — Generate the HTML file (Pick a Journey)

_Only used when mode is Pick a Journey._

Placeholders:
- `__RECORDS_JSON__` → full records array, compact JSON
- `__APP_NAME__` → app name string
- `__GENERATED_AT__` → current date/time
- `__FUNNEL_STEPS_JSON__` → the validated funnel steps as a JSON array, e.g. `["/","/login","/home","/instruments"]`

Download and inline d3 libs the same way as Step 3. Output path default: `~/Downloads/session-journey-<appname>-<date>.html`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Journey Analysis — __APP_NAME__</title>
  <script>__D3_LIBS__</script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1f2e; color: #c8d0d8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #8a9ab0; margin-bottom: 24px; }
    .chart-container { overflow-x: auto; }
    svg { display: block; margin: 0 auto; overflow: visible; }
    .breakdown { margin-top: 32px; }
    .breakdown h2 { font-size: 13px; color: #8a9ab0; margin-bottom: 12px; font-weight: 500; }
    .steps { display: flex; gap: 1px; align-items: flex-start; overflow-x: auto; }
    .step { flex: 1 1 0; min-width: 140px; }
    .step-bar { height: 6px; }
    .step-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.02); gap: 8px; cursor: pointer; }
    .step-row:hover { background: rgba(255,255,255,0.06) !important; }
    .step-label { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .step-pct { font-size: 11px; font-weight: 600; flex-shrink: 0; }
    .meta { margin-top: 24px; font-size: 12px; color: #666; }
    #hover-info { display:none; position:fixed; top:24px; right:32px; background:rgba(20,24,38,0.92); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:10px 16px; font-size:13px; color:#c8d0d8; pointer-events:none; z-index:10; }
    #hover-info .hi-count { font-size:22px; font-weight:700; color:#fff; display:block; }
    #hover-info .hi-label { font-size:11px; color:#8a9ab0; }
    svg path, svg rect, svg text { transition: opacity 0.12s; }
  </style>
</head>
<body>
  <h1>Journey Analysis</h1>
  <div class="subtitle" id="subtitle"></div>
  <div class="chart-container">
    <svg id="sankey" viewBox="0 0 1620 580" style="width:80vw;min-width:600px;height:auto;"></svg>
  </div>
  <div class="breakdown">
    <h2>Step Breakdown</h2>
    <div class="steps" id="breakdown"></div>
  </div>
  <div class="meta" id="meta"></div>
  <div id="hover-info"><span class="hi-count" id="hi-count"></span><span class="hi-label" id="hi-label"></span></div>
  <script>
  (function() {
  var d3Sankey = d3;
  const RECORDS = __RECORDS_JSON__;
  const FUNNEL_STEPS = __FUNNEL_STEPS_JSON__;
  const APP_NAME = "__APP_NAME__";
  const GENERATED_AT = "__GENERATED_AT__";
  const STEP_COLORS = ["#5C5BA8","#1A7A9E","#1A9070","#A07A10","#A86020","#A83050","#1A7848","#2458A0"];
  const LEFT_FUNNEL_COLOR = "#4a4a4a";

  function buildFunnelData(records, funnelSteps) {
    const sessionPaths = new Map();
    for (const r of records) {
      const sid = r["dt.rum.session.id"], view = r["view.name"];
      if (!sid || !view) continue;
      if (!sessionPaths.has(sid)) sessionPaths.set(sid, []);
      const path = sessionPaths.get(sid);
      if (path[path.length-1] !== view) path.push(view);
    }
    // Only include sessions that visited the first funnel step
    let reaching = [];
    for (const [sid, path] of sessionPaths) {
      const idx = path.indexOf(funnelSteps[0]);
      if (idx !== -1) reaching.push({sid, lastIdx: idx});
    }
    const entryCount = reaching.length;
    if (!entryCount) return {nodes:[], links:[], totalSessions:0, entryCount:0};

    const nodes = [{id:`0:${funnelSteps[0]}`, label:funnelSteps[0], step:0, isDropoff:false}];
    const rawLinks = [];

    for (let i = 1; i < funnelSteps.length; i++) {
      const nextStep = funnelSteps[i];
      const continued = [], dropped = [];
      for (const {sid, lastIdx} of reaching) {
        const path = sessionPaths.get(sid);
        const nextIdx = lastIdx + 1;
        if (path[nextIdx] === nextStep) continued.push({sid, lastIdx: nextIdx});
        else dropped.push(sid);
      }
      const stepId = `${i}:${nextStep}`;
      const dropId = `${i}:Left Funnel`;
      const srcId = `${i-1}:${funnelSteps[i-1]}`;
      nodes.push({id:stepId, label:nextStep, step:i, isDropoff:false});
      if (continued.length) rawLinks.push({sourceId:srcId, targetId:stepId, value:continued.length});
      if (dropped.length) {
        nodes.push({id:dropId, label:"Left Funnel", step:i, isDropoff:true});
        rawLinks.push({sourceId:srcId, targetId:dropId, value:dropped.length});
      }
      reaching = continued;
    }
    // Last step is conversion — no Exit node.
    const nodeIndex = new Map(nodes.map((n,i)=>[n.id,i]));
    const links = rawLinks.map(({sourceId,targetId,value})=>({source:nodeIndex.get(sourceId),target:nodeIndex.get(targetId),value}));
    return {nodes, links, totalSessions:entryCount};
  }

  const data = buildFunnelData(RECORDS, FUNNEL_STEPS);
  if (!data.totalSessions) {
    document.getElementById('subtitle').textContent = APP_NAME + ' — No sessions matched the first funnel step';
    document.getElementById('meta').textContent = 'Generated ' + GENERATED_AT;
    return;
  }
  document.getElementById("subtitle").textContent = `${APP_NAME} — ${FUNNEL_STEPS.join(" → ")}`;
  document.getElementById("meta").textContent = `${data.totalSessions.toLocaleString()} sessions entered funnel · Generated ${GENERATED_AT}`;

  const WIDTH=1400,HEIGHT=580,NODE_WIDTH=16,NODE_PADDING=40;
  const layout = d3Sankey.sankey().nodeAlign(d3Sankey.sankeyLeft).nodeWidth(NODE_WIDTH).nodePadding(NODE_PADDING).extent([[0,0],[WIDTH,HEIGHT]]);
  const {nodes:ln,links:ll} = layout({nodes:data.nodes.map(n=>({...n})),links:data.links.map(l=>({...l}))});
  const linkPath = d3Sankey.sankeyLinkHorizontal();
  const svg = document.getElementById("sankey");
  const overlay = document.getElementById("hover-info");
  const hiCount = document.getElementById("hi-count");
  const hiLabel = document.getElementById("hi-label");
  const allLinkEls = [];
  const allNodeEls = new Map();
  const upstreamOf = new Map();

  function getUpstreamIds(nodeId) {
    const visited = new Set([nodeId]); const queue = [nodeId];
    while (queue.length) { const id = queue.shift(); for (const {sourceId} of (upstreamOf.get(id)||[])) { if (!visited.has(sourceId)) { visited.add(sourceId); queue.push(sourceId); } } }
    return visited;
  }
  function showHighlight(nodeId) {
    const upIds = getUpstreamIds(nodeId);
    const upLinkEls = new Set(allLinkEls.filter(({sourceId,targetId}) => upIds.has(sourceId) && upIds.has(targetId)).map(({el})=>el));
    for (const {el} of allLinkEls) { el.style.opacity = upLinkEls.has(el) ? '1' : '0.22'; el.setAttribute("stroke-opacity", upLinkEls.has(el) ? '0.65' : '0.22'); }
    for (const [id,{rect,text}] of allNodeEls) { const active=upIds.has(id); if (rect) rect.style.opacity=active?'1':'0.25'; if (text) text.style.opacity=active?'1':'0.25'; }
    const node = ln.find(n=>n.id===nodeId);
    if (node) { const pct=((node.value/data.totalSessions)*100).toFixed(1); hiCount.textContent=`${node.value?.toLocaleString()} (${pct}%)`; hiLabel.textContent=`sessions reached "${node.label}"`; overlay.style.display='block'; }
  }
  function clearHighlight() {
    for (const {el} of allLinkEls) { el.style.opacity=''; el.setAttribute("stroke-opacity","0.35"); }
    for (const [,{rect,text}] of allNodeEls) { if (rect) rect.style.opacity=''; if (text) text.style.opacity=''; }
    overlay.style.display='none';
  }

  for (const link of ll) {
    const src=link.source,tgt=link.target,pct=((link.value/data.totalSessions)*100).toFixed(1);
    const isDropLink = tgt.label==="Left Funnel";
    const color = isDropLink ? LEFT_FUNNEL_COLOR : STEP_COLORS[src.step%STEP_COLORS.length];
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",linkPath(link)); path.setAttribute("fill","none");
    path.setAttribute("stroke",color); path.setAttribute("stroke-opacity","0.35");
    path.setAttribute("stroke-width",Math.max(1,link.width??1));
    const title=document.createElementNS("http://www.w3.org/2000/svg","title");
    title.textContent=`${src.label} → ${tgt.label}: ${link.value.toLocaleString()} sessions (${pct}%)`;
    path.appendChild(title); svg.appendChild(path);
    allLinkEls.push({el:path,sourceId:src.id,targetId:tgt.id});
    if (!upstreamOf.has(tgt.id)) upstreamOf.set(tgt.id,[]);
    upstreamOf.get(tgt.id).push({sourceId:src.id});
  }
  for (const node of ln) {
    const {x0=0,x1=0,y0=0,y1=0}=node,nodeH=Math.max(1,y1-y0);
    const isExit=node.label==="Exit", isLeft=node.label==="Left Funnel";
    const color = isLeft ? LEFT_FUNNEL_COLOR : isExit ? "#666" : STEP_COLORS[node.step%STEP_COLORS.length];
    const pct=((node.value/data.totalSessions)*100).toFixed(1);
    const truncated=node.label.length>28?node.label.slice(0,26)+"…":node.label;
    const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x",x0);rect.setAttribute("y",y0);rect.setAttribute("width",x1-x0);rect.setAttribute("height",nodeH);rect.setAttribute("fill",color);
    rect.style.cursor="pointer";
    const rt=document.createElementNS("http://www.w3.org/2000/svg","title");
    rt.textContent=`${node.label}: ${node.value?.toLocaleString()} sessions (${pct}%)`;
    rect.appendChild(rt);svg.appendChild(rect);
    let textEl=null;
    if (nodeH>=8) {
      const g=document.createElementNS("http://www.w3.org/2000/svg","text");
      g.setAttribute("x",x1+8);g.setAttribute("y",y0+nodeH/2);g.setAttribute("dy","0.35em");g.setAttribute("text-anchor","start");g.setAttribute("font-size","13.5");
      g.setAttribute("fill",isLeft?"#888888":isExit?"#aaaaaa":color);
      g.style.cursor="pointer";
      const ps=document.createElementNS("http://www.w3.org/2000/svg","tspan");ps.setAttribute("font-weight","700");ps.textContent=`${pct}%`;
      const ls=document.createElementNS("http://www.w3.org/2000/svg","tspan");ls.setAttribute("fill","#ffffff");ls.textContent=` ${truncated}`;
      g.appendChild(ps);g.appendChild(ls);svg.appendChild(g);
      textEl=g;
    }
    allNodeEls.set(node.id,{rect,text:textEl});
    const onEnter=()=>showHighlight(node.id);
    rect.addEventListener("mouseenter",onEnter); rect.addEventListener("mouseleave",clearHighlight);
    if (textEl) { textEl.addEventListener("mouseenter",onEnter); textEl.addEventListener("mouseleave",clearHighlight); }
  }

  // Step breakdown
  const incomingSum=new Map(),outgoingSum=new Map();
  for (const l of data.links) { incomingSum.set(l.target,(incomingSum.get(l.target)??0)+l.value); outgoingSum.set(l.source,(outgoingSum.get(l.source)??0)+l.value); }
  const byStep=new Map();
  data.nodes.forEach((node,i)=>{ if(!byStep.has(node.step))byStep.set(node.step,[]); const val=incomingSum.get(i)??outgoingSum.get(i)??0; byStep.get(node.step).push({node,value:val}); });
  const container=document.getElementById("breakdown");
  Array.from(byStep.entries()).sort(([a],[b])=>a-b).forEach(([step,entries])=>{
    const stepColor = STEP_COLORS[step%STEP_COLORS.length];
    const col=document.createElement("div");col.className="step";
    const bar=document.createElement("div");bar.className="step-bar";bar.style.background=stepColor;col.appendChild(bar);
    entries.sort((a,b)=>{ if(a.node.isDropoff)return 1; if(b.node.isDropoff)return -1; return b.value-a.value; })
      .forEach(({node,value})=>{
        const pct=((value/data.totalSessions)*100).toFixed(1);
        const row=document.createElement("div");row.className="step-row";
        const lbl=document.createElement("span");lbl.className="step-label";
        lbl.style.color=node.isDropoff?"#c47a7a":node.label==="Exit"?"#888":"#c8d0d8";
        lbl.textContent=node.label;
        const pctEl=document.createElement("span");pctEl.className="step-pct";
        pctEl.style.color=node.isDropoff?LEFT_FUNNEL_COLOR:node.label==="Exit"?"#888":stepColor;
        pctEl.textContent=`${pct}%`;
        row.appendChild(lbl);row.appendChild(pctEl);col.appendChild(row);
        row.addEventListener("mouseenter",()=>showHighlight(node.id));
        row.addEventListener("mouseleave",clearHighlight);
      });
    container.appendChild(col);
  });
  })();
  </script>
</body>
</html>
```

### Step 4 — Report

Tell the user:
- Path to the generated HTML file
- Mode used (Common User Journeys or Pick a Journey)
- Total sessions included (Pick a Journey: sessions that entered the funnel)
- Time range used
- Whether data was truncated (spill hit row limit)
