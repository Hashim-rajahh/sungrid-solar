// Views are pure functions: (data, route) -> { title, html }. No DOM access here,
// which keeps them testable in Node and keeps app.js tiny.

import { company, jobs as JOBS, inventory as INVENTORY, STATUSES, cities, pricing } from './data.js';
import { SYSTEM_TYPES } from './quote.js';
import { esc, formatPkr, formatDate, formatNumber, slug } from './util.js';

// ---------- small helpers ----------

export function systemKw(job) {
  return (job.panels * job.panelWatt) / 1000;
}

export function estimateMonthlyKwh(job) {
  const sunHours = cities[job.city]?.sunHours ?? 5.0;
  return systemKw(job) * sunHours * pricing.performanceRatio * 30;
}

export function stockStatus(item) {
  if (item.stock <= 0) return { key: 'out', label: 'Out of stock', rank: 0 };
  if (item.stock <= item.reorderLevel) return { key: 'low', label: 'Reorder now', rank: 1 };
  return { key: 'ok', label: 'In stock', rank: 2 };
}

function badge(status) {
  return `<span class="badge badge-${esc(slug(status))}">${esc(status)}</span>`;
}

function emptyState(title, message, linkHref, linkText) {
  const link = linkHref ? `<p><a class="btn" href="${esc(linkHref)}">${esc(linkText)}</a></p>` : '';
  return `<div class="empty" role="status"><h2>${esc(title)}</h2><p>${esc(message)}</p>${link}</div>`;
}

// ---------- views ----------

export function dashboardView(data) {
  const { jobs, inventory } = data;
  if (!jobs.length && !inventory.length) {
    return {
      title: 'Dashboard',
      html: `<h1>Dashboard</h1>${emptyState('Nothing here yet', 'Jobs and stock will appear here once your first site survey is booked.', '#/quote', 'Prepare a quote')}`,
    };
  }

  const active = jobs.filter((j) => ['Approved', 'Installing', 'Net-metering'].includes(j.status));
  const pipeline = jobs.filter((j) => ['Site survey', 'Quoted'].includes(j.status));
  const done = jobs.filter((j) => j.status === 'Commissioned');
  const lowStock = inventory.filter((i) => stockStatus(i).key !== 'ok');
  const nextUp = jobs
    .filter((j) => j.status !== 'Commissioned')
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 4);

  const stat = (label, value, hint) =>
    `<div class="stat"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div><div class="stat-hint">${esc(hint)}</div></div>`;

  const nextUpHtml = nextUp.length
    ? `<ul class="list">${nextUp
        .map(
          (j) =>
            `<li><a href="#/jobs/${encodeURIComponent(j.id)}"><strong>${esc(j.customer)}</strong></a> ${badge(j.status)}<br><span class="muted">${esc(j.nextStep)} · ${esc(formatDate(j.nextDate))}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">No upcoming steps. Every job is commissioned.</p>';

  const lowHtml = lowStock.length
    ? `<ul class="list">${lowStock
        .map((i) => {
          const s = stockStatus(i);
          return `<li><strong>${esc(i.name)}</strong> <span class="badge badge-${s.key}">${esc(s.label)}</span><br><span class="muted">${esc(i.stock)} left · reorder at ${esc(i.reorderLevel)}</span></li>`;
        })
        .join('')}</ul>`
    : '<p class="muted">All items are above their reorder level.</p>';

  return {
    title: 'Dashboard',
    html: `
      <h1>Dashboard</h1>
      <p class="lead">${esc(company.tagline)}. Here is where every job stands today.</p>
      <div class="stats">
        ${stat('Jobs in progress', active.length, 'approved, installing or awaiting net-metering')}
        ${stat('Pipeline value', formatPkr(pipeline.reduce((s, j) => s + j.valuePkr, 0)), `${pipeline.length} jobs at survey or quoted`)}
        ${stat('Installed capacity', `${formatNumber(done.reduce((s, j) => s + systemKw(j), 0), 2)} kWp`, `${done.length} commissioned systems`)}
        ${stat('Stock to reorder', lowStock.length, 'items at or below reorder level')}
      </div>
      <div class="grid-2">
        <section class="card" aria-labelledby="next-h"><h2 id="next-h">Next up</h2>${nextUpHtml}<p><a href="#/jobs">See all jobs →</a></p></section>
        <section class="card" aria-labelledby="stock-h"><h2 id="stock-h">Needs attention: stock</h2>${lowHtml}<p><a href="#/inventory">Open inventory →</a></p></section>
      </div>`,
  };
}

export function jobsView(data, query = {}) {
  const { jobs } = data;
  const wanted = query.status;

  const chips = [
    `<a class="chip${wanted ? '' : ' chip-active'}" href="#/jobs"${wanted ? '' : ' aria-current="true"'}>All (${jobs.length})</a>`,
    ...STATUSES.map((s) => {
      const count = jobs.filter((j) => j.status === s).length;
      const active = wanted === s;
      return `<a class="chip${active ? ' chip-active' : ''}" href="#/jobs?status=${encodeURIComponent(s)}"${active ? ' aria-current="true"' : ''}>${esc(s)} (${count})</a>`;
    }),
  ].join('');

  let body;
  if (!jobs.length) {
    body = emptyState('No jobs yet', 'Jobs appear here as soon as a site survey is booked.', '#/quote', 'Prepare a quote');
  } else if (wanted && !STATUSES.includes(wanted)) {
    body = emptyState(
      'Unknown status',
      `"${wanted}" is not a job status. Pick one of the filters above, or view all jobs.`,
      '#/jobs',
      'Show all jobs',
    );
  } else {
    const shown = wanted ? jobs.filter((j) => j.status === wanted) : jobs;
    body = shown.length
      ? `<div class="table-wrap"><table>
          <caption class="sr-only">Solar installation jobs${wanted ? ` at status ${esc(wanted)}` : ''}</caption>
          <thead><tr><th scope="col">Job</th><th scope="col">Customer</th><th scope="col">City</th><th scope="col">System</th><th scope="col">Status</th><th scope="col" class="num">Value</th></tr></thead>
          <tbody>${shown
            .map(
              (j) =>
                `<tr><td><a href="#/jobs/${encodeURIComponent(j.id)}">${esc(j.id)}</a></td><td>${esc(j.customer)}</td><td>${esc(j.city)}</td><td>${esc(formatNumber(systemKw(j), 2))} kWp ${esc(j.type)}</td><td>${badge(j.status)}</td><td class="num">${esc(formatPkr(j.valuePkr))}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
      : emptyState('No jobs at this status', `No jobs are at "${wanted}" right now.`, '#/jobs', 'Show all jobs');
  }

  return { title: 'Jobs', html: `<h1>Jobs</h1><nav class="chips" aria-label="Filter jobs by status">${chips}</nav>${body}` };
}

export function jobDetailView(data, id) {
  const job = data.jobs.find((j) => j.id === id);
  if (!job) {
    return {
      title: 'Job not found',
      html: `<h1>Job not found</h1>${emptyState('No job with that ID', `There is no job "${id}". Check the ID, or pick a job from the list.`, '#/jobs', 'Back to all jobs')}`,
    };
  }

  const currentIndex = STATUSES.indexOf(job.status);
  const steps = STATUSES.map((s, i) => {
    const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
    return `<li class="step step-${state}"${state === 'current' ? ' aria-current="step"' : ''}>${esc(s)}</li>`;
  }).join('');

  const row = (label, value) => `<div class="kv"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const kw = systemKw(job);

  return {
    title: job.id,
    html: `
      <p><a href="#/jobs">← All jobs</a></p>
      <h1>${esc(job.id)} · ${esc(job.customer)}</h1>
      <p>${badge(job.status)}</p>
      <ol class="steps" aria-label="Job progress">${steps}</ol>
      <div class="grid-2">
        <section class="card" aria-labelledby="site-h"><h2 id="site-h">Site</h2><dl>
          ${row('Address', esc(job.site))}
          ${row('City', esc(job.city))}
          ${row('Utility (net-metering)', esc(cities[job.city]?.disco ?? '—'))}
        </dl></section>
        <section class="card" aria-labelledby="sys-h"><h2 id="sys-h">System</h2><dl>
          ${row('Type', esc(job.type))}
          ${row('Array', `${esc(job.panels)} × ${esc(job.panelWatt)} W = ${esc(formatNumber(kw, 2))} kWp`)}
          ${row('Inverter', esc(job.inverter))}
          ${row('Batteries', job.batteries ? `${esc(job.batteries)} × 4.8 kWh` : 'None')}
          ${row('Est. generation', `${esc(formatNumber(estimateMonthlyKwh(job)))} kWh / month`)}
        </dl></section>
      </div>
      <section class="card" aria-labelledby="next-h"><h2 id="next-h">Commercials & next step</h2><dl>
        ${row('Contract value', esc(formatPkr(job.valuePkr)))}
        ${row('Next step', esc(job.nextStep))}
        ${row('Due', esc(formatDate(job.nextDate)))}
      </dl></section>`,
  };
}

export function inventoryView(data) {
  const { inventory } = data;
  if (!inventory.length) {
    return { title: 'Inventory', html: `<h1>Inventory</h1>${emptyState('No stock recorded', 'Add items to your stock list to see reorder alerts here.')}` };
  }
  const sorted = [...inventory].sort((a, b) => stockStatus(a).rank - stockStatus(b).rank || a.name.localeCompare(b.name));
  const value = inventory.reduce((s, i) => s + i.stock * i.unitPricePkr, 0);
  const attention = inventory.filter((i) => stockStatus(i).key !== 'ok').length;

  return {
    title: 'Inventory',
    html: `
      <h1>Inventory</h1>
      <p class="lead">${esc(inventory.length)} items · ${esc(attention)} need attention · stock value ${esc(formatPkr(value))}</p>
      <div class="table-wrap"><table>
        <caption class="sr-only">Stock levels, items needing reorder first</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">SKU</th><th scope="col" class="num">In stock</th><th scope="col" class="num">Reorder at</th><th scope="col" class="num">Unit price</th><th scope="col">Status</th></tr></thead>
        <tbody>${sorted
          .map((i) => {
            const s = stockStatus(i);
            return `<tr><td>${esc(i.name)}<br><span class="muted">${esc(i.category)}</span></td><td>${esc(i.sku)}</td><td class="num">${esc(i.stock)}</td><td class="num">${esc(i.reorderLevel)}</td><td class="num">${esc(formatPkr(i.unitPricePkr))}</td><td><span class="badge badge-${s.key}">${esc(s.label)}</span></td></tr>`;
          })
          .join('')}</tbody></table></div>`,
  };
}

export function quoteView() {
  const cityOptions = Object.keys(cities)
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('');
  const typeOptions = SYSTEM_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

  return {
    title: 'Quote',
    html: `
      <h1>Quick quote</h1>
      <p class="lead">Tell us your average monthly electricity use and we will size a system. This is an estimate; a site survey confirms the final design.</p>
      <div class="grid-2">
        <form id="quote-form" class="card" novalidate aria-labelledby="form-h">
          <h2 id="form-h">Your details</h2>
          <div class="field">
            <label for="units">Average monthly units (kWh)</label>
            <input id="units" name="units" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 600" aria-describedby="units-hint units-err">
            <div id="units-hint" class="hint">Find "units consumed" on your LESCO / FESCO bill.</div>
            <div id="units-err" class="error" role="alert"></div>
          </div>
          <div class="field">
            <label for="city">City</label>
            <select id="city" name="city" aria-describedby="city-err"><option value="">Select a city</option>${cityOptions}</select>
            <div id="city-err" class="error" role="alert"></div>
          </div>
          <div class="field">
            <label for="type">System type</label>
            <select id="type" name="type" aria-describedby="type-hint type-err"><option value="">Select a type</option>${typeOptions}</select>
            <div id="type-hint" class="hint">On-grid is cheapest and uses net-metering. Hybrid adds batteries for load-shedding.</div>
            <div id="type-err" class="error" role="alert"></div>
          </div>
          <button class="btn btn-primary" type="submit">Calculate estimate</button>
        </form>
        <div id="quote-result" aria-live="polite">
          <section class="card"><h2>How we estimate</h2>
            <ul class="list">
              <li>${esc(pricing.panelWatt)} W panels, ${esc(Math.round(pricing.performanceRatio * 100))}% real-world performance</li>
              <li>City-specific sun hours (Lahore ${esc(cities.Lahore.sunHours)} h/day)</li>
              <li>Blended tariff of ${esc(formatPkr(pricing.tariffPkrPerKwh))} per unit</li>
              <li>Hybrid quotes include 1 battery per ${esc(pricing.kwPerBattery)} kWp</li>
            </ul></section>
        </div>
      </div>`,
  };
}

/** HTML for the result area after the form is submitted (success or errors). */
export function quoteResultHtml(result) {
  if (!result.ok) {
    const items = Object.values(result.errors).map((m) => `<li>${esc(m)}</li>`).join('');
    return `<section class="card card-error"><h2>Please fix the following</h2><ul class="list">${items}</ul></section>`;
  }
  const r = result;
  const row = (label, value) => `<div class="kv"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  return `<section class="card card-ok" aria-labelledby="res-h">
    <h2 id="res-h">Estimate for ${esc(r.input.city)}</h2>
    <p class="big">${esc(formatNumber(r.systemKw, 2))} kWp ${esc(r.input.type)} system</p>
    <dl>
      ${row('Panels', `${esc(r.panels)} × ${esc(r.panelWatt)} W`)}
      ${r.batteries ? row('Batteries', `${esc(r.batteries)} × 4.8 kWh (${esc(formatNumber(r.batteryKwh, 1))} kWh)`) : ''}
      ${row('Monthly generation', `${esc(formatNumber(r.monthlyGenerationKwh))} kWh`)}
      ${row('Covers', `${esc(formatNumber(r.offsetPercent))}% of your usage`)}
      ${row('Monthly saving', esc(formatPkr(r.monthlySavingsPkr)))}
      ${row('Estimated cost', esc(formatPkr(r.costPkr)))}
      ${row('Payback', `about ${esc(formatNumber(r.paybackYears, 1))} years`)}
      ${row('Net-metering utility', esc(r.disco))}
    </dl>
    <p class="muted">Indicative only. Final price depends on roof, shading and equipment chosen at survey.</p>
  </section>`;
}

export function notFoundView(path) {
  return {
    title: 'Page not found',
    html: `<h1>Page not found</h1>${emptyState('We could not find that page', `Nothing lives at "${path}". Use the menu above to get back on track.`, '#/', 'Go to dashboard')}`,
  };
}

export function errorView() {
  return {
    title: 'Something went wrong',
    html: `<h1>Something went wrong</h1>${emptyState('This page could not be shown', 'Please go back to the dashboard and try again. If it keeps happening, call us.', '#/', 'Go to dashboard')}`,
  };
}

/** Route -> view. Any exception inside a view is caught and turned into the friendly error view. */
export function renderRoute(route, ctx = {}) {
  const data = { jobs: JOBS, inventory: INVENTORY, ...ctx };
  try {
    switch (route.name) {
      case 'dashboard':
        return dashboardView(data);
      case 'jobs':
        return jobsView(data, route.query ?? {});
      case 'job':
        return jobDetailView(data, route.params.id);
      case 'quote':
        return quoteView();
      case 'inventory':
        return inventoryView(data);
      default:
        return notFoundView(route.path ?? '');
    }
  } catch (err) {
    console.error('View failed', err);
    return errorView();
  }
}
