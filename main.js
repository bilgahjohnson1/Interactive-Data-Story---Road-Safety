"use strict";
// STATE
const DATA = {
  accidents: [],
  persons:   [],
  vehicles:  []
};

const state = {
  yearMin:      2012,
  yearMax:      2025,
  day:          "All",
  timeOfDay:    "All",
  speed:        "All",
  selectedYear: null,
  selectedAge:  null,
  selectedScatterSpeed: null
};

const SEV_COLOR = {
  "Fatal":         "#e63946",
  "Serious Injury":"#f4a261",
  "Other Injury":  "#457b9d"
};

const SEV_ORDER = ["Fatal","Serious Injury","Other Injury"];

// LOAD
async function loadData() {
  try {
    const [acc, per, veh] = await Promise.all([
      d3.csv("data/processed_accidents.csv"),
      d3.csv("data/processed_persons.csv"),
      d3.csv("data/processed_vehicles.csv")
    ]);

    DATA.accidents = acc.map(d => ({
      ...d,
      YEAR:              +d.YEAR || null,
      MONTH:             +d.MONTH || null,
      HOUR:              d.HOUR !== "" ? +d.HOUR : null,
      SPEED_ZONE:        d.SPEED_ZONE !== "" ? +d.SPEED_ZONE : null,
      NO_PERSONS_KILLED: +d.NO_PERSONS_KILLED || 0,
      NO_PERSONS_INJ_2:  +d.NO_PERSONS_INJ_2  || 0,
      SEVERITY:          +d.SEVERITY || 4
    }));

    DATA.persons   = per;
    DATA.vehicles  = veh;

    console.log(`Loaded ${DATA.accidents.length} accidents, ${DATA.persons.length} persons, ${DATA.vehicles.length} vehicles`);

    initFilters();
    updateAll();

  } catch (err) {
    console.error("Failed to load data:", err);
    document.body.innerHTML = `<div style="color:#e63946;padding:40px;font-family:monospace">
      <h2>⚠ Data Load Error</h2>
      <p>${err.message}</p>
      <p>Make sure you are running via a local server (not file://) and that processed CSVs exist in data/</p>
    </div>`;
  }
}

function applyFilters({ ignoreYear = false, ignoreAge = false } = {}) {
  return DATA.accidents.filter(d => {
    if (!d.YEAR) return false;

    if (d.YEAR < state.yearMin || d.YEAR > state.yearMax) return false;

    if (state.day !== "All" && d.DAY_WEEK_DESC !== state.day) return false;

    if (state.timeOfDay !== "All" && d.HOUR !== null) {
      const h = d.HOUR;
      if (state.timeOfDay === "Morning"   && !(h >= 6  && h < 12)) return false;
      if (state.timeOfDay === "Afternoon" && !(h >= 12 && h < 18)) return false;
      if (state.timeOfDay === "Night"     && !((h >= 18) || h < 6)) return false;
    }

    if (state.speed !== "All" && d.SPEED_ZONE !== +state.speed) return false;

    if (!ignoreYear && state.selectedYear && d.YEAR !== state.selectedYear) return false;

    return true;
  });
}

// BIN
function toAgeBin(ageGroupRaw) {
  if (!ageGroupRaw) return null;
  const text = String(ageGroupRaw).trim();
  if (!text || text.toLowerCase() === "unknown") return null;

  const match = text.match(/\d+/);
  if (!match) return null;
  const ageStart = +match[0];
  if (!Number.isFinite(ageStart) || ageStart < 0) return null;

  if (ageStart >= 80) return "80+";
  const lo = Math.floor(ageStart / 10) * 10;
  const hi = lo + 9;
  return `${lo}-${hi}`;
}

function applyPersonFilter(filteredAccidents, selectedAge = null) {
  const accSet = new Set(filteredAccidents.map(d => d.ACCIDENT_NO));
  return DATA.persons.filter(p => {
    if (!accSet.has(p.ACCIDENT_NO)) return false;
    if (selectedAge && toAgeBin(p.AGE_GROUP) !== selectedAge) return false;
    return true;
  });
}

function applyVehicleFilter(filteredAccidents) {
  const accSet = new Set(filteredAccidents.map(d => d.ACCIDENT_NO));
  return DATA.vehicles.filter(v => accSet.has(v.ACCIDENT_NO));
}

// UI
function initFilters() {
  const yearMin    = document.getElementById("yearMin");
  const yearMax    = document.getElementById("yearMax");
  const yearDisp   = document.getElementById("yearDisplay");
  const filterDay  = document.getElementById("filterDay");
  const filterSpd  = document.getElementById("filterSpeed");
  const resetBtn   = document.getElementById("resetBtn");
  const timeBtns   = document.querySelectorAll(".time-btn");

  function updateYearDisplay() {
    const lo = +yearMin.value, hi = +yearMax.value;
    state.yearMin = Math.min(lo, hi);
    state.yearMax = Math.max(lo, hi);
    yearDisp.textContent = `${state.yearMin} – ${state.yearMax}`;
  }
  yearMin.addEventListener("input", () => { updateYearDisplay(); updateAll(); });
  yearMax.addEventListener("input", () => { updateYearDisplay(); updateAll(); });

  filterDay.addEventListener("change", e => { state.day = e.target.value; updateAll(); });

  filterSpd.addEventListener("change", e => { state.speed = e.target.value; updateAll(); });

  timeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      timeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.timeOfDay = btn.dataset.val;
      updateAll();
    });
  });

  resetBtn.addEventListener("click", () => {
    state.yearMin = 2012; state.yearMax = 2025;
    state.day = "All"; state.timeOfDay = "All";
    state.speed = "All";
    state.selectedYear = null; state.selectedAge = null;
    state.selectedScatterSpeed = null;
    yearMin.value = 2012; yearMax.value = 2025;
    updateYearDisplay();
    filterDay.value = "All"; filterSpd.value = "All";
    timeBtns.forEach(b => b.classList.toggle("active", b.dataset.val === "All"));
    updateAll();
  });
}

// UPDATE
function updateAll() {
  const filtered   = applyFilters();
  const filteredNY = applyFilters({ ignoreYear: true });
  const persons    = applyPersonFilter(filtered, state.selectedAge);
  const vehicles   = applyVehicleFilter(filtered);

  drawMetricCards(filtered, persons);
  drawStackedBar(filteredNY);
  drawHeatmap(filtered);
  drawScatter(filtered);
  drawDonut(filtered);
  drawFunnel(applyPersonFilter(filtered, state.selectedAge));
  drawLine(vehicles, filtered);
}

// CARDS
function drawMetricCards(accidents, persons) {
  const totalCrashes  = accidents.length;
  const totalFatal    = d3.sum(accidents, d => d.NO_PERSONS_KILLED);
  const totalSerious  = d3.sum(accidents, d => d.NO_PERSONS_INJ_2);
  const totalPersons  = persons.length;
  const fatalRate     = totalCrashes > 0 ? ((totalFatal / totalCrashes) * 100).toFixed(2) : "0.00";
  const peakHour      = (() => {
    const hours = accidents.filter(d => d.HOUR !== null).map(d => d.HOUR);
    if (!hours.length) return "--";
    const counts = d3.rollup(hours, v => v.length, h => h);
    const peak = [...counts.entries()].sort((a,b) => b[1]-a[1])[0];
    return peak ? `${String(peak[0]).padStart(2,"0")}:00` : "--";
  })();

  const cards = [
    { label: "Total Crashes",    value: d3.format(",")(totalCrashes),   color: "var(--accent)" },
    { label: "Persons Involved",  value: d3.format(",")(totalPersons),   color: "#457b9d" },
    { label: "Fatalities",        value: d3.format(",")(totalFatal),     color: "#e63946" },
    { label: "Serious Injuries",  value: d3.format(",")(totalSerious),   color: "var(--accent2)" },
    { label: "Fatality Rate",     value: fatalRate + "%",                color: "#c77dff" },
    { label: "Peak Crash Hour",   value: peakHour,                       color: "var(--accent3)" }
  ];

  const container = d3.select("#metric-cards");
  const existing  = container.selectAll(".metric-card").data(cards);

  const enter = existing.enter().append("div").attr("class", "metric-card");
  enter.append("div").attr("class", "metric-value");
  enter.append("div").attr("class", "metric-label");

  const all = enter.merge(existing);
  all.style("--card-color", d => d.color);
  all.select(".metric-value").text(d => d.value);
  all.select(".metric-label").text(d => d.label);

  existing.exit().remove();
}

// BAR
function drawStackedBar(accidents) {
  const container = document.getElementById("chart-stacked-bar");
  const W = container.clientWidth - 48;
  const H = 280;
  const margin = { top: 10, right: 20, bottom: 40, left: 54 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  const svg = d3.select("#svg-stacked-bar")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const years = d3.range(state.yearMin, state.yearMax + 1);
  const nested = d3.rollup(
    accidents,
    v => d3.rollup(v, vv => vv.length, d => d.SEVERITY_LABEL),
    d => d.YEAR
  );

  const data = years.map(yr => {
    const row = { year: yr };
    SEV_ORDER.forEach(sev => { row[sev] = (nested.get(yr) || new Map()).get(sev) || 0; });
    return row;
  });

  const stack = d3.stack().keys(SEV_ORDER).order(d3.stackOrderNone);
  const series = stack(data);

  const x = d3.scaleBand().domain(years).range([0, innerW]).padding(0.2);
  const y = d3.scaleLinear()
    .domain([0, d3.max(series, s => d3.max(s, d => d[1]))])
    .nice().range([innerH, 0]);

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));

  g.append("g").attr("class","axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("d")).tickSizeOuter(0));

  g.append("g").attr("class","axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s")));

  const tooltip = document.getElementById("tooltip-bar");

  const layer = g.selectAll(".layer")
    .data(series)
    .join("g")
      .attr("class","layer")
      .attr("fill", s => SEV_COLOR[s.key]);

  layer.selectAll("rect")
    .data(s => s.map(d => ({ ...d, key: s.key })))
    .join(
      enter => enter.append("rect")
        .attr("x",      d => x(d.data.year))
        .attr("width",  x.bandwidth())
        .attr("y",      innerH)
        .attr("height", 0)
        .call(enter => enter.transition().duration(600).delay((d,i) => i * 30)
          .attr("y",      d => y(d[1]))
          .attr("height", d => y(d[0]) - y(d[1]))),
      update => update
        .call(update => update.transition().duration(400)
          .attr("x",      d => x(d.data.year))
          .attr("width",  x.bandwidth())
          .attr("y",      d => y(d[1]))
          .attr("height", d => y(d[0]) - y(d[1])))
    )
    .attr("rx", 2)
    .attr("opacity", d => state.selectedYear && d.data.year !== state.selectedYear ? 0.25 : 1)
    .style("cursor", "pointer")
    .on("mousemove", function(event, d) {
      tooltip.innerHTML = `<strong>${d.data.year}</strong>${d.key}: ${d3.format(",")(d[1] - d[0])}`;
      tooltip.classList.add("visible");
      tooltip.style.left = (event.clientX + 12) + "px";
      tooltip.style.top  = (event.clientY - 10) + "px";
    })
    .on("mouseleave", () => tooltip.classList.remove("visible"))
    .on("click", function(event, d) {
      state.selectedYear = (state.selectedYear === d.data.year) ? null : d.data.year;
      updateAll();
    });

  const legendEl = d3.select("#chart-stacked-bar").selectAll(".legend").data([0]);
  const leg = legendEl.enter().append("div").attr("class","legend").merge(legendEl);
  leg.selectAll(".legend-item").data(SEV_ORDER).join(
    enter => {
      const item = enter.append("div").attr("class","legend-item");
      item.append("span").attr("class","legend-swatch").style("background", d => SEV_COLOR[d]);
      item.append("span").text(d => d);
      return item;
    }
  );
}

// HEATMAP
function drawHeatmap(accidents) {
  const days  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const hours = d3.range(0, 24);

  const container = document.getElementById("chart-heatmap");
  const W = container.clientWidth - 48;
  const H = 240;
  const margin = { top: 10, right: 10, bottom: 36, left: 78 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  const svg = d3.select("#svg-heatmap")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const matrix = d3.rollup(
    accidents.filter(d => d.HOUR !== null && d.DAY_WEEK_DESC),
    v => v.length,
    d => d.DAY_WEEK_DESC,
    d => d.HOUR
  );

  const flat = [];
  days.forEach(day => hours.forEach(hr => {
    flat.push({ day, hr, count: (matrix.get(day) || new Map()).get(hr) || 0 });
  }));

  const maxCount = d3.max(flat, d => d.count) || 1;

  const xScale = d3.scaleBand().domain(hours).range([0, innerW]).padding(0.05);
  const yScale = d3.scaleBand().domain(days).range([0, innerH]).padding(0.05);
  const colour = d3.scaleSequential()
    .domain([0, maxCount])
    .interpolator(d3.interpolate("#1e1e28", "#e63946"));

  g.append("g").attr("class","axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale)
      .tickValues([0,3,6,9,12,15,18,21])
      .tickFormat(h => `${String(h).padStart(2,"0")}h`)
      .tickSizeOuter(0));

  g.append("g").attr("class","axis")
    .call(d3.axisLeft(yScale).tickSizeOuter(0));

  const tooltip = document.getElementById("tooltip-heat");

  g.selectAll(".cell")
    .data(flat)
    .join(
      enter => enter.append("rect").attr("class","cell")
        .attr("x",      d => xScale(d.hr))
        .attr("y",      d => yScale(d.day))
        .attr("width",  xScale.bandwidth())
        .attr("height", yScale.bandwidth())
        .attr("rx", 2)
        .attr("fill", "#1e1e28")
        .call(en => en.transition().duration(600).delay((d,i) => i * 1)
          .attr("fill", d => colour(d.count))),
      update => update
        .call(up => up.transition().duration(400)
          .attr("fill", d => colour(d.count)))
    )
    .on("mousemove", function(event, d) {
      tooltip.innerHTML = `<strong>${d.day} ${String(d.hr).padStart(2,"0")}:00</strong>Crashes: ${d3.format(",")(d.count)}`;
      tooltip.classList.add("visible");
      tooltip.style.left = (event.clientX + 12) + "px";
      tooltip.style.top  = (event.clientY - 10) + "px";
    })
    .on("mouseleave", () => tooltip.classList.remove("visible"));
}

// SCATTER
function drawScatter(accidents) {
  const container = document.getElementById("chart-scatter");
  const W = container.clientWidth - 48;
  const H = 300;
  const margin = { top: 20, right: 30, bottom: 50, left: 64 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;
  let selectedSpeed = null;

  const svg = d3.select("#svg-scatter")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const bySpeed = d3.rollup(
    accidents.filter(d => d.SPEED_ZONE),
    v => ({
      total:    v.length,
      fatal:    d3.sum(v, d => d.NO_PERSONS_KILLED),
      serious:  d3.sum(v, d => d.NO_PERSONS_INJ_2),
      fatRate:  v.length > 0 ? (d3.sum(v, d => d.NO_PERSONS_KILLED) / v.length) * 100 : 0
    }),
    d => d.SPEED_ZONE
  );

  const data = [...bySpeed.entries()]
    .map(([spd, vals]) => ({ speed: +spd, ...vals }))
    .filter(d => d.speed >= 20 && d.speed <= 130 && d.total >= 10)
    .sort((a,b) => a.speed - b.speed);

  if (!data.length) return;

  const x = d3.scaleLinear().domain([20, 120]).range([0, innerW]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.fatRate) * 1.2])
    .nice().range([innerH, 0]);
  const r = d3.scaleSqrt()
    .domain([0, d3.max(data, d => d.total)])
    .range([4, 40]);

  g.append("g").attr("class","grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));
  g.append("g").attr("class","grid")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickSize(-innerH).tickFormat(""));

  g.append("g").attr("class","axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d => d + " km/h").tickSizeOuter(0));

  g.append("g").attr("class","axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d.toFixed(1) + "%"));

  g.append("text")
    .attr("x", innerW / 2).attr("y", innerH + 44)
    .attr("text-anchor","middle")
    .attr("fill","var(--text2)").attr("font-size",11)
    .text("Speed Zone (km/h)");
  g.append("text")
    .attr("transform","rotate(-90)")
    .attr("x", -innerH/2).attr("y", -50)
    .attr("text-anchor","middle")
    .attr("fill","var(--text2)").attr("font-size",11)
    .text("Fatality Rate (%)");

  const tooltip = document.getElementById("tooltip-scatter");
  const svgNode = document.getElementById("svg-scatter");
  let pinnedTooltip = document.getElementById("tooltip-scatter-pinned");
  if (!pinnedTooltip) {
    pinnedTooltip = document.createElement("div");
    pinnedTooltip.id = "tooltip-scatter-pinned";
    pinnedTooltip.className = "tooltip tooltip-pinned";
    document.body.appendChild(pinnedTooltip);
  }

  function showScatterTooltip(targetEl, d, xPos, yPos) {
    targetEl.innerHTML = `<strong>${d.speed} km/h Zone</strong>
      Crashes: ${d3.format(",")(d.total)}<br>
      Fatalities: ${d.fatal}<br>
      Fatality Rate: ${d.fatRate.toFixed(2)}%`;
    targetEl.classList.add("visible");
    targetEl.style.left = `${xPos + 14}px`;
    targetEl.style.top  = `${yPos - 10}px`;
  }

  function pinSelectedScatterTooltip() {
    if (state.selectedScatterSpeed === null) {
      pinnedTooltip.classList.remove("visible");
      return;
    }
    const selectedDatum = data.find(d => d.speed === state.selectedScatterSpeed);
    if (!selectedDatum) {
      state.selectedScatterSpeed = null;
      pinnedTooltip.classList.remove("visible");
      return;
    }
    const rect = svgNode.getBoundingClientRect();
    const bubbleX = rect.left + margin.left + x(selectedDatum.speed);
    const bubbleY = rect.top + margin.top + y(selectedDatum.fatRate);
    showScatterTooltip(pinnedTooltip, selectedDatum, bubbleX, bubbleY);
  }

  if (drawScatter._syncPinnedTooltip) {
    window.removeEventListener("scroll", drawScatter._syncPinnedTooltip);
    window.removeEventListener("resize", drawScatter._syncPinnedTooltip);
  }
  drawScatter._syncPinnedTooltip = () => pinSelectedScatterTooltip();
  window.addEventListener("scroll", drawScatter._syncPinnedTooltip, { passive: true });
  window.addEventListener("resize", drawScatter._syncPinnedTooltip);
  
  const bubbles = g.selectAll(".bubble")
    .data(data)
    .join(
      enter => enter.append("circle").attr("class","bubble")
        .attr("cx", d => x(d.speed))
        .attr("cy", innerH)
        .attr("r",  0)
        .attr("fill", d => {
          if (d.fatRate > 4)  return "#e63946";
          if (d.fatRate > 2)  return "#f4a261";
          return "#457b9d";
        })
        .attr("opacity", 0.75)
        .attr("stroke", "var(--bg)")
        .attr("stroke-width", 2)
        .call(en => en.transition().duration(700).delay((d,i) => i * 60)
          .attr("cy", d => y(d.fatRate))
          .attr("r",  d => r(d.total))),
      update => update
        .call(up => up.transition().duration(400)
          .attr("cx", d => x(d.speed))
          .attr("cy", d => y(d.fatRate))
          .attr("r",  d => r(d.total))
          .attr("fill", d => {
            if (d.fatRate > 4) return "#e63946";
            if (d.fatRate > 2) return "#f4a261";
            return "#457b9d";
          }))
    )
    .style("cursor","pointer")
    .on("mousemove", function(event, d) {
      showScatterTooltip(tooltip, d, event.clientX, event.clientY);
    })
    .on("mouseleave", () => {
      tooltip.classList.remove("visible");
    })
    .on("click", (_, d) => {
      state.selectedScatterSpeed =
        state.selectedScatterSpeed === d.speed ? null : d.speed;
      applyScatterHighlight();
      pinSelectedScatterTooltip();
    });

  function applyScatterHighlight() {
    const hasSelection = state.selectedScatterSpeed !== null;
    bubbles
      .attr("opacity", b => {
        if (!hasSelection) return 0.75;
        return b.speed === state.selectedScatterSpeed ? 0.95 : 0.2;
      })
      .attr("stroke-width", b => {
        if (!hasSelection) return 2;
        return b.speed === state.selectedScatterSpeed ? 4 : 1;
      });
  }

  applyScatterHighlight();
  pinSelectedScatterTooltip();
    

  g.selectAll(".spd-label")
    .data(data)
    .join("text")
      .attr("class","spd-label")
      .attr("x", d => x(d.speed))
      .attr("y", d => y(d.fatRate) - r(d.total) - 4)
      .attr("text-anchor","middle")
      .attr("fill","var(--text2)")
      .attr("font-size", 10)
      .text(d => d.speed);

}

// DONUT
function drawDonut(accidents) {
  const persons = applyPersonFilter(accidents);
  const totalPersonsAll = persons.length;

  const container = document.getElementById("chart-donut");
  const W = container.clientWidth - 48;
  const H = 280;
  const R = Math.min(W, H) / 2 - 20;

  const svg = d3.select("#svg-donut")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${W/2},${H/2})`);

  const ageGroups = d3.rollup(
    persons.filter(p => toAgeBin(p.AGE_GROUP)),
    v => v.length,
    d => toAgeBin(d.AGE_GROUP)
  );
  const data = [...ageGroups.entries()]
    .filter(([k]) => !!k)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => {
      const aStart = a.key === "80+" ? 80 : +a.key.split("-")[0];
      const bStart = b.key === "80+" ? 80 : +b.key.split("-")[0];
      return aStart - bStart;
    });

  if (!data.length) {
    g.append("text").attr("fill","var(--text3)").attr("text-anchor","middle").text("No data");
    return;
  }

  const colour = d3.scaleOrdinal()
    .domain(data.map(d => d.key))
    .range(d3.schemeTableau10);

  const pie  = d3.pie().value(d => d.value).sort(null);
  const arc  = d3.arc().innerRadius(R * 0.55).outerRadius(R);
  const arcOuter = d3.arc().innerRadius(R * 1.02).outerRadius(R * 1.02);

  g.selectAll(".arc")
    .data(pie(data))
    .join(
      enter => {
        const path = enter.append("path").attr("class","arc")
          .attr("fill", d => colour(d.data.key))
          .attr("d", arc)
          .attr("opacity", 0)
          .call(en => en.transition().duration(600).delay((d,i) => i * 50)
            .attr("opacity", d => !state.selectedAge || state.selectedAge === d.data.key ? 1 : 0.25));
        return path;
      },
      update => update
        .call(up => up.transition().duration(400)
          .attr("opacity", d => !state.selectedAge || state.selectedAge === d.data.key ? 1 : 0.25)
          .attrTween("d", function(d) {
            const prev = this._current || d;
            const interp = d3.interpolate(prev, d);
            this._current = d;
            return t => arc(interp(t));
          }))
    )
    .each(function(d) { this._current = d; })
    .style("cursor","pointer")
    .on("click", function(event, d) {
      state.selectedAge = (state.selectedAge === d.data.key) ? null : d.data.key;
      updateAll();
    });

  const labelGroups = g.selectAll(".age-pointer")
    .data(pie(data))
    .join("g")
    .attr("class", "age-pointer");

  labelGroups.append("polyline")
    .attr("fill", "none")
    .attr("stroke", "var(--text3)")
    .attr("stroke-width", 1)
    .attr("points", d => {
      const c = arc.centroid(d);
      const m = arcOuter.centroid(d);
      const side = m[0] >= 0 ? 1 : -1;
      const e = [m[0] + side * 20, m[1]];
      return [c, m, e].map(p => p.join(",")).join(" ");
    });

  labelGroups.append("text")
    .attr("x", d => {
      const m = arcOuter.centroid(d);
      const side = m[0] >= 0 ? 1 : -1;
      return m[0] + side * 24;
    })
    .attr("y", d => arcOuter.centroid(d)[1] + 3)
    .attr("text-anchor", d => (arcOuter.centroid(d)[0] >= 0 ? "start" : "end"))
    .attr("fill", "var(--text2)")
    .attr("font-size", 10)
    .text(d => d.data.key);

  const selectedSlice = state.selectedAge ? data.find(d => d.key === state.selectedAge) : null;
  const baseTotal = totalPersonsAll || 1;
  const centerValue = selectedSlice ? d3.format(",")(selectedSlice.value) : d3.format("~s")(totalPersonsAll);
  const centerSub = selectedSlice
    ? `${((selectedSlice.value / baseTotal) * 100).toFixed(1)}% of persons`
    : "PERSONS";

  g.append("text").attr("text-anchor","middle").attr("dy","-0.2em")
    .attr("fill","var(--text)").attr("font-family","var(--font-display)")
    .attr("font-size", 28).text(centerValue);
  g.append("text").attr("text-anchor","middle").attr("dy","1.4em")
    .attr("fill","var(--text3)").attr("font-size", 11).text(centerSub);

  if (selectedSlice) {
    g.append("text").attr("text-anchor","middle").attr("dy","2.8em")
      .attr("fill","var(--accent)").attr("font-size", 10)
      .text(selectedSlice.key);
  }
}

// FUNNEL
function drawFunnel(persons) {
  const container = document.getElementById("chart-funnel");
  const W = container.clientWidth - 48;
  const H = 280;

  const svg = d3.select("#svg-funnel")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  svg.selectAll("*").remove();

  const INJ_ORDER = [
    { key: "1", label: "Fatal",          color: "#e63946" },
    { key: "2", label: "Serious Injury", color: "#f4a261" },
    { key: "3", label: "Other Injury",   color: "#457b9d" }
  ];

  const counts = d3.rollup(persons, v => v.length, d => d.INJ_LEVEL);
  const total  = persons.length || 1;

  const rows = INJ_ORDER.map(d => ({
    ...d,
    count: counts.get(d.key) || 0,
    pct:   ((counts.get(d.key) || 0) / total * 100)
  }));

  const maxCount = d3.max(rows, d => d.count) || 1;

  const padX  = 80;
  const rowH  = (H - 20) / rows.length;
  const maxW  = W - padX * 2;
  const chartTop = 10;
  const chartBottom = H - 10;

  const tooltip = document.getElementById("tooltip-funnel");

  const intervalSteps = 4;
  for (let i = 0; i <= intervalSteps; i++) {
    const t = i / intervalSteps;
    const y = chartBottom - t * (chartBottom - chartTop);
    const pct = Math.round(t * 100);

    svg.append("line")
      .attr("x1", padX - 30)
      .attr("x2", W - (padX - 30))
      .attr("y1", y)
      .attr("y2", y)
      .attr("stroke", "var(--border)")
      .attr("stroke-dasharray", "4 4")
      .attr("opacity", 0.55);

    svg.append("text")
      .attr("x", padX - 36)
      .attr("y", y + 3)
      .attr("text-anchor", "end")
      .attr("fill", "var(--text3)")
      .attr("font-size", 10)
      .text(`${pct}%`);
  }

  rows.forEach((row, i) => {
    const widthTop = maxW * (row.count / maxCount);
    const widthBot = maxW * (Math.max(row.count * 0.85, 0) / maxCount);
    const centerX  = W / 2;
    const y0       = i * rowH + 10;
    const y1       = y0 + rowH - 2;

    const path = [
      `M ${centerX - widthTop/2} ${y0}`,
      `L ${centerX + widthTop/2} ${y0}`,
      `L ${centerX + widthBot/2} ${y1}`,
      `L ${centerX - widthBot/2} ${y1}`,
      "Z"
    ].join(" ");

    const segG = svg.append("g").attr("class","funnel-seg");

    segG.append("path")
      .attr("d", path)
      .attr("fill", row.color)
      .attr("opacity", 0)
      .on("mousemove", function(event) {
        tooltip.innerHTML = `<strong>${row.label}</strong>Count: ${d3.format(",")(row.count)}<br>Share: ${row.pct.toFixed(1)}%`;
        tooltip.classList.add("visible");
        tooltip.style.left = (event.clientX + 12) + "px";
        tooltip.style.top  = (event.clientY - 10) + "px";
      })
      .on("mouseleave", () => tooltip.classList.remove("visible"))
      .transition().duration(500).delay(i * 100)
        .attr("opacity", 0.85);

    segG.append("text").attr("class","funnel-label")
      .attr("x", centerX - widthTop/2 - 8)
      .attr("y", y0 + rowH/2 + 4)
      .attr("text-anchor","end")
      .text(row.label);

    segG.append("text").attr("class","funnel-pct")
      .attr("x", centerX + widthTop/2 + 8)
      .attr("y", y0 + rowH/2 + 4)
      .attr("text-anchor","start")
      .text(row.pct.toFixed(1) + "%");
  });
}

// LINE
function drawLine(vehicles, accidents) {
  const container = document.getElementById("chart-line");
  const W = container.clientWidth - 48;
  const H = 300;
  const margin = { top: 20, right: 30, bottom: 44, left: 64 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  const accMeta = new Map(accidents.map(d => [
    d.ACCIDENT_NO,
    {
      year: +d.YEAR || null,
      month: +d.MONTH || 1,
      injuries: +d.NO_PERSONS_INJ_2 || 0,
      fatalities: +d.NO_PERSONS_KILLED || 0
    }
  ]));

  const vTypeCounts = d3.rollup(vehicles, v => v.length, d => d.VEHICLE_TYPE_DESC);
  const topTypes = [...vTypeCounts.entries()]
    .filter(([k]) => k && k !== "")
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  if (!drawLine._detail) drawLine._detail = "year";
  if (!drawLine._activeTypes) drawLine._activeTypes = new Set(topTypes);
  if (!drawLine._view) drawLine._view = null;
  if (!drawLine._bounds) drawLine._bounds = null;
  drawLine._activeTypes = new Set([...drawLine._activeTypes].filter(t => topTypes.includes(t)));
  if (!drawLine._activeTypes.size) drawLine._activeTypes = new Set(topTypes);

  function buildPeriods(detail) {
    const periods = [];
    for (let y = state.yearMin; y <= state.yearMax; y++) {
      if (detail === "year") {
        periods.push({ key: `${y}`, x: y, label: `${y}` });
      } else if (detail === "quarter") {
        for (let q = 1; q <= 4; q++) {
          const x = y + (q - 1) / 4;
          const ord = q === 1 ? "1st" : q === 2 ? "2nd" : q === 3 ? "3rd" : "4th";
          periods.push({ key: `${y}-Q${q}`, x, label: `${ord} quarter ${y}` });
        }
      } else {
        for (let m = 1; m <= 12; m++) {
          const x = y + (m - 1) / 12;
          const dt = new Date(y, m - 1, 1);
          periods.push({
            key: `${y}-${String(m).padStart(2, "0")}`,
            x,
            label: dt.toLocaleString("en-US", { month: "short", year: "numeric" })
          });
        }
      }
    }
    return periods;
  }

  function periodKey(detail, meta) {
    if (!meta || !meta.year) return null;
    if (detail === "year") return `${meta.year}`;
    if (detail === "quarter") {
      const q = Math.floor(((meta.month || 1) - 1) / 3) + 1;
      return `${meta.year}-Q${q}`;
    }
    return `${meta.year}-${String(meta.month || 1).padStart(2, "0")}`;
  }

  const periods = buildPeriods(drawLine._detail);
  const labelMap = new Map(periods.map(p => [p.x, p.label]));
  const xVals = periods.map(p => p.x);
  const series = topTypes.map(name => {
    const subset = vehicles.filter(v => v.VEHICLE_TYPE_DESC === name);
    const grouped = new Map();
    subset.forEach(v => {
      const acc = accMeta.get(v.ACCIDENT_NO);
      const key = periodKey(drawLine._detail, acc);
      if (!key) return;
      if (!grouped.has(key)) {
        grouped.set(key, { crashes: 0, injuries: 0, fatalities: 0, seenAccidents: new Set() });
      }
      const bucket = grouped.get(key);
      bucket.crashes += 1;
      if (!bucket.seenAccidents.has(v.ACCIDENT_NO)) {
        bucket.injuries += acc?.injuries || 0;
        bucket.fatalities += acc?.fatalities || 0;
        bucket.seenAccidents.add(v.ACCIDENT_NO);
      }
    });
    return {
      name,
      values: periods.map(p => {
        const bucket = grouped.get(p.key);
        return {
          x: p.x,
          label: p.label,
          count: bucket ? bucket.crashes : 0,
          injuries: bucket ? bucket.injuries : 0,
          fatalities: bucket ? bucket.fatalities : 0
        };
      })
    };
  });

  const visibleSeries = series.filter(s => drawLine._activeTypes.has(s.name));
  const yMax = d3.max(visibleSeries.flatMap(s => s.values), d => d.count) || 1;
  const fullBounds = {
    xMin: d3.min(xVals),
    xMax: d3.max(xVals),
    yMin: 0,
    yMax
  };
  const minXSpan = drawLine._detail === "year" ? 1 : (drawLine._detail === "quarter" ? 0.5 : 0.12);
  const minYSpan = Math.max(5, yMax * 0.04);

  function clampView(view) {
    let { xMin, xMax, yMin, yMax: yTop } = view;
    if (xMax - xMin < minXSpan) {
      const cx = (xMin + xMax) / 2;
      xMin = cx - minXSpan / 2;
      xMax = cx + minXSpan / 2;
    }
    if (yTop - yMin < minYSpan) {
      const cy = (yMin + yTop) / 2;
      yMin = cy - minYSpan / 2;
      yTop = cy + minYSpan / 2;
    }
    if (xMin < fullBounds.xMin) { xMax += fullBounds.xMin - xMin; xMin = fullBounds.xMin; }
    if (xMax > fullBounds.xMax) { xMin -= xMax - fullBounds.xMax; xMax = fullBounds.xMax; }
    if (yMin < 0) { yTop += -yMin; yMin = 0; }
    if (yTop > fullBounds.yMax) { yMin -= yTop - fullBounds.yMax; yTop = fullBounds.yMax; }
    return {
      xMin: Math.max(fullBounds.xMin, xMin),
      xMax: Math.min(fullBounds.xMax, xMax),
      yMin: Math.max(0, yMin),
      yMax: Math.min(fullBounds.yMax, yTop)
    };
  }

  const boundsChanged = !drawLine._bounds
    || drawLine._bounds.xMin !== fullBounds.xMin
    || drawLine._bounds.xMax !== fullBounds.xMax
    || drawLine._bounds.yMax !== fullBounds.yMax;
  drawLine._bounds = fullBounds;
  if (!drawLine._view || boundsChanged) drawLine._view = { ...fullBounds };
  drawLine._view = clampView(drawLine._view);

  const colour = d3.scaleOrdinal()
    .domain(topTypes)
    .range(["#e63946","#f4a261","#2a9d8f","#457b9d","#c77dff","#f1c453"]);

  const controlsWrap = d3.select("#chart-line")
    .selectAll(".chart-controls")
    .data([0])
    .join("div")
    .attr("class", "chart-controls");

  controlsWrap.selectAll(".chart-control-btn.zoom")
    .data([
      { id: "zoom-in", label: "+" },
      { id: "zoom-out", label: "-" },
      { id: "zoom-reset", label: "Reset" }
    ], d => d.id)
    .join("button")
    .attr("type", "button")
    .attr("class", d => `chart-control-btn zoom ${d.id}`)
    .text(d => d.label)
    .on("click", (_, d) => {
      if (d.id === "zoom-reset") {
        drawLine._view = { ...fullBounds };
        drawLine(vehicles, accidents);
        return;
      }
      const factor = d.id === "zoom-in" ? 0.75 : 1.3;
      const cx = (drawLine._view.xMin + drawLine._view.xMax) / 2;
      const cy = (drawLine._view.yMin + drawLine._view.yMax) / 2;
      drawLine._view = clampView({
        xMin: cx - ((drawLine._view.xMax - drawLine._view.xMin) * factor) / 2,
        xMax: cx + ((drawLine._view.xMax - drawLine._view.xMin) * factor) / 2,
        yMin: cy - ((drawLine._view.yMax - drawLine._view.yMin) * factor) / 2,
        yMax: cy + ((drawLine._view.yMax - drawLine._view.yMin) * factor) / 2
      });
      drawLine(vehicles, accidents);
    });

  controlsWrap.selectAll(".chart-control-btn.detail")
    .data([
      { id: "year", label: "Year" },
      { id: "quarter", label: "Quarter" },
      { id: "month", label: "Month" }
    ], d => d.id)
    .join("button")
    .attr("type", "button")
    .attr("class", d => `chart-control-btn detail ${drawLine._detail === d.id ? "active" : ""}`)
    .text(d => d.label)
    .on("click", (_, d) => {
      drawLine._detail = d.id;
      drawLine._view = null;
      drawLine(vehicles, accidents);
    });

  const chartLineEl = document.getElementById("chart-line");

  const svg = d3.select("#svg-line")
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  const svgNode = svg.node();

  let viewportRow = chartLineEl.querySelector(".line-viewport-row");
  if (!viewportRow) {
    viewportRow = document.createElement("div");
    viewportRow.className = "line-viewport-row";
    chartLineEl.insertBefore(viewportRow, svgNode);
  }
  if (svgNode.parentElement !== viewportRow) {
    viewportRow.appendChild(svgNode);
  }

  let yPanWrap = chartLineEl.querySelector(".line-pan-y-wrap");
  if (!yPanWrap) {
    yPanWrap = document.createElement("div");
    yPanWrap.className = "line-pan-y-wrap";
    viewportRow.appendChild(yPanWrap);
  } else if (yPanWrap.parentElement !== viewportRow) {
    viewportRow.appendChild(yPanWrap);
  }

  let xPanRow = chartLineEl.querySelector(".line-pan-x-row");
  if (!xPanRow) {
    xPanRow = document.createElement("div");
    xPanRow.className = "line-pan-x-row";
    chartLineEl.insertBefore(xPanRow, controlsWrap.node());
  }
  if (controlsWrap.node().previousElementSibling !== xPanRow) {
    chartLineEl.insertBefore(xPanRow, controlsWrap.node());
  }

  const xPanInput = d3.select(xPanRow)
    .selectAll(".line-pan-x")
    .data([0])
    .join("input")
    .attr("class", "line-pan-x")
    .attr("type", "range")
    .attr("min", 0)
    .attr("max", 1000)
    .attr("step", 1);

  const yPanInput = d3.select(yPanWrap)
    .selectAll(".line-pan-y")
    .data([0])
    .join("input")
    .attr("class", "line-pan-y")
    .attr("type", "range")
    .attr("min", 0)
    .attr("max", 1000)
    .attr("step", 1);

  const defs = svg.append("defs");
  const clipId = "line-clip";
  defs.append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerW)
    .attr("height", innerH);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const plotLayer = g.append("g").attr("clip-path", `url(#${clipId})`);
  const axisLayer = g.append("g");
  const overlayLayer = g.append("g");

  const x = d3.scaleLinear().domain([drawLine._view.xMin, drawLine._view.xMax]).range([0, innerW]);
  const y = d3.scaleLinear().domain([drawLine._view.yMin, drawLine._view.yMax]).nice().range([innerH, 0]);
  const yGridG = axisLayer.append("g").attr("class","grid");
  const xAxisG = axisLayer.append("g").attr("class","axis").attr("transform",`translate(0,${innerH})`);
  const yAxisG = axisLayer.append("g").attr("class","axis");

  function visibleTicks(maxTicks = 9) {
    const vis = periods.filter(p => p.x >= drawLine._view.xMin && p.x <= drawLine._view.xMax);
    if (!vis.length) return [];
    const step = Math.max(1, Math.ceil(vis.length / maxTicks));
    return vis.filter((_, i) => i % step === 0).map(p => p.x);
  }

  function renderAxes() {
    yGridG.call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(""));
    xAxisG.call(
      d3.axisBottom(x)
        .tickValues(visibleTicks(drawLine._detail === "month" ? 8 : 10))
        .tickFormat(v => labelMap.get(v) || "")
        .tickSizeOuter(0)
    );
    yAxisG.call(d3.axisLeft(y).ticks(6).tickFormat(d3.format("~s")));
  }
  renderAxes();

  axisLayer.append("text")
    .attr("x", innerW / 2)
    .attr("y", innerH + 40)
    .attr("text-anchor","middle")
    .attr("fill","var(--text2)")
    .attr("font-size",11)
    .text(drawLine._detail === "year" ? "Year" : drawLine._detail === "quarter" ? "Quarter" : "Month");
  axisLayer.append("text")
    .attr("transform","rotate(-90)")
    .attr("x",-innerH/2)
    .attr("y",-50)
    .attr("text-anchor","middle")
    .attr("fill","var(--text2)")
    .attr("font-size",11)
    .text("Crash Count");

  const line = d3.line()
    .x(d => x(d.x))
    .y(d => y(d.count))
    .curve(d3.curveMonotoneX);

  const tooltip = document.getElementById("tooltip-line");
  const lineNodes = [];

  series.forEach(s => {
    const active = drawLine._activeTypes.has(s.name);
    const path = plotLayer.append("path")
      .datum(s.values)
      .attr("fill","none")
      .attr("stroke", colour(s.name))
      .attr("stroke-width", 2.2)
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("opacity", active ? 0.9 : 0.08)
      .attr("d", line);

    plotLayer.selectAll(`.dot-${s.name.replace(/\W/g,"_")}`)
      .data(s.values)
      .join("circle")
      .attr("class", `dot-${s.name.replace(/\W/g,"_")}`)
      .attr("cx", d => x(d.x))
      .attr("cy", d => y(d.count))
      .attr("r", 3.8)
      .attr("fill", colour(s.name))
      .attr("opacity", active ? 0.85 : 0.08)
      .style("cursor","pointer")
      .on("mousemove", function(event, d) {
        if (!drawLine._activeTypes.has(s.name)) return;
        tooltip.innerHTML = `<strong>${s.name}</strong>${d.label}<br>
          Crashes: ${d3.format(",")(d.count)}<br>
          Injuries: ${d3.format(",")(d.injuries)}<br>
          Fatalities: ${d3.format(",")(d.fatalities)}`;
        tooltip.classList.add("visible");
        tooltip.style.left = `${event.clientX + 12}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
      })
      .on("mouseleave", () => tooltip.classList.remove("visible"));

    lineNodes.push({ name: s.name, path });
  });

  function applyViewport() {
    x.domain([drawLine._view.xMin, drawLine._view.xMax]);
    y.domain([drawLine._view.yMin, drawLine._view.yMax]).nice();
    renderAxes();
    lineNodes.forEach(({ name, path }) => {
      const active = drawLine._activeTypes.has(name);
      path.attr("opacity", active ? 0.9 : 0.08).attr("d", line);
      plotLayer.selectAll(`.dot-${name.replace(/\W/g,"_")}`)
        .attr("cx", d => x(d.x))
        .attr("cy", d => y(d.count))
        .attr("opacity", active ? 0.85 : 0.08);
    });
    syncPanInputs();
  }

  function syncPanInputs() {
    const xSpan = drawLine._view.xMax - drawLine._view.xMin;
    const ySpan = drawLine._view.yMax - drawLine._view.yMin;
    const xAvail = Math.max(0, fullBounds.xMax - fullBounds.xMin - xSpan);
    const yAvail = Math.max(0, fullBounds.yMax - fullBounds.yMin - ySpan);

    const xPos = xAvail === 0 ? 0 : (drawLine._view.xMin - fullBounds.xMin) / xAvail;
    const yPos = yAvail === 0 ? 0 : (drawLine._view.yMin - fullBounds.yMin) / yAvail;
    xPanInput.property("value", Math.round(xPos * 1000));
    yPanInput.property("value", Math.round(yPos * 1000));

    xPanInput.property("disabled", xAvail === 0);
    yPanInput.property("disabled", yAvail === 0);
  }

  xPanInput.on("input", (event) => {
    const xSpan = drawLine._view.xMax - drawLine._view.xMin;
    const xAvail = Math.max(0, fullBounds.xMax - fullBounds.xMin - xSpan);
    const t = (+event.target.value || 0) / 1000;
    const nextXMin = fullBounds.xMin + xAvail * t;
    drawLine._view = clampView({
      ...drawLine._view,
      xMin: nextXMin,
      xMax: nextXMin + xSpan
    });
    applyViewport();
  });

  yPanInput.on("input", (event) => {
    const ySpan = drawLine._view.yMax - drawLine._view.yMin;
    const yAvail = Math.max(0, fullBounds.yMax - fullBounds.yMin - ySpan);
    const t = (+event.target.value || 0) / 1000;
    const nextYMin = fullBounds.yMin + yAvail * t;
    drawLine._view = clampView({
      ...drawLine._view,
      yMin: nextYMin,
      yMax: nextYMin + ySpan
    });
    applyViewport();
  });

  const leg = d3.select("#chart-line").selectAll(".legend").data([0]).join("div").attr("class","legend");
  const items = leg.selectAll(".legend-item").data(series, d => d.name);
  const enterItems = items.enter().append("div").attr("class","legend-item");
  enterItems.append("span").attr("class","legend-swatch");
  enterItems.append("span");

  const mergedItems = enterItems.merge(items);
  mergedItems.select(".legend-swatch").style("background", d => colour(d.name));
  mergedItems.select("span:last-child").text(d => d.name.length > 25 ? `${d.name.slice(0,25)}…` : d.name);
  mergedItems
    .on("mousemove", (event, s) => {
      const totalCrashes = d3.sum(s.values, d => d.count);
      const totalInjuries = d3.sum(s.values, d => d.injuries);
      const totalFatalities = d3.sum(s.values, d => d.fatalities);
      tooltip.innerHTML = `<strong>${s.name}</strong>
        Crashes: ${d3.format(",")(totalCrashes)}<br>
        Injuries: ${d3.format(",")(totalInjuries)}<br>
        Fatalities: ${d3.format(",")(totalFatalities)}`;
      tooltip.classList.add("visible");
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY - 10}px`;
    })
    .on("mouseleave", () => tooltip.classList.remove("visible"));
  mergedItems.on("click", (_, s) => {
    const onlyThis = drawLine._activeTypes.size === 1 && drawLine._activeTypes.has(s.name);
    drawLine._activeTypes = onlyThis ? new Set(topTypes) : new Set([s.name]);
    applyViewport();
    d3.select("#chart-line").selectAll(".legend-item")
      .classed("muted", d => !drawLine._activeTypes.has(d.name));
  });
  mergedItems.classed("muted", d => !drawLine._activeTypes.has(d.name));
  items.exit().remove();
  syncPanInputs();
}

// START
loadData();