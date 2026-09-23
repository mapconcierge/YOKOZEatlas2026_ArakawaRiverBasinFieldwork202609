import * as maplibregl from "https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs";

const DATA_URL = "./data/YOKOZEatlas2026_morigawa_water_quality_v0.1.0.geojson";
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAPTERHORN_SOURCE_ID = "mapterhorn-dem";
const MAPTERHORN_HILLSHADE_LAYER_ID = "mapterhorn-hillshade";
const MAPTERHORN_ATTRIBUTION =
  '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noreferrer">© Mapterhorn</a>';
const TERRAIN_EXAGGERATION = 1.18;
const TOUR_INTERVAL_MS = 14000;
const TOUR_OVERVIEW_ZOOM = 13;
const TOUR_DETAIL_ZOOM = 18;
const TOUR_OVERVIEW_DURATION_MS = 3600;
const TOUR_DETAIL_START_MS = 4400;
const TOUR_DETAIL_DURATION_MS = 4800;
const TOUR_POPUP_DELAY_MS = 9300;
const HOME_CAMERA = {
  center: [139.0895, 35.997],
  zoom: 12.2,
  pitch: 0,
  bearing: 0,
};
const GSI_STYLE = {
  version: 8,
  name: "地理院地図 標準地図",
  sources: {
    gsi: {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
    },
  },
  layers: [
    {
      id: "gsi-background",
      type: "background",
      paint: { "background-color": "#e8eeea" },
    },
    {
      id: "gsi-standard",
      type: "raster",
      source: "gsi",
      paint: { "raster-opacity": 1 },
    },
  ],
};

const mapterhornProtocol = new window.pmtiles.Protocol({
  metadata: true,
  errorOnMissingTile: true,
});

maplibregl.addProtocol("mapterhorn", async (params, abortController) => {
  const [z, x, y] = params.url.replace("mapterhorn://", "").split("/").map(Number);
  const archiveName = z <= 12 ? "planet" : `6-${x >> (z - 6)}-${y >> (z - 6)}`;
  const url = `pmtiles://https://download.mapterhorn.com/${archiveName}.pmtiles/${z}/${x}/${y}.webp`;
  const response = await mapterhornProtocol.tile({ ...params, url }, abortController);

  if (response.data === null) {
    throw new Error(`Mapterhorn DEM tile not found: z=${z}, x=${x}, y=${y}`);
  }
  return response;
});

const CLASS_COLORS = {
  water_quality_sample: "#147b8d",
  water_feature: "#56b7c3",
  other_observation: "#d3903f",
};

const CLASS_LABELS = {
  water_quality_sample: "水質測定地点",
  water_feature: "水環境の観察地点",
  other_observation: "その他の観察地点",
};

const TYPE_LABELS = {
  rainwater: "雨水",
  spring_water: "湧水・伏流水",
  geology: "地質",
  vegetation: "植生",
  tap_water: "水道水・引水",
  well: "井戸",
  spring_pond: "湧水池",
  spring_channel: "湧水・水路",
  cultural_feature: "文化的地物",
};

const QC_LABELS = {
  outside_yokoze_town: "横瀬町外",
  no_water_measurement: "水質測定なし",
  duplicate_coordinates_distinct_samples: "同一座標の別サンプル",
  cfg_match_distance_gt_50m: "CfGとの座標距離50m超",
  elevation_difference_gt_20m: "測定機器間の標高差20m超",
  cfg_nearest_point_override_reviewed: "名称・時刻で統合先を確認済み",
  cfg_name_alias_reviewed: "異名の同一採水地点として確認済み",
};

const NUMERIC_FIELDS = [
  { key: "elevation_field_m", label: "現地標高", unit: "m" },
  { key: "water_temp_field_c", label: "現地水温", unit: "℃" },
  { key: "conductivity_field_ms_m", label: "現地電気伝導率", unit: "mS/m" },
  { key: "ph_field", label: "現地pH", unit: "" },
  { key: "rph_field", label: "現地RpH", unit: "" },
  { key: "ph_difference", label: "RpH - pH", unit: "" },
  { key: "cfg_match_distance_m", label: "CfGマッチ距離", unit: "m" },
  { key: "cfg_elevation_m", label: "CfG標高", unit: "m" },
  { key: "elevation_difference_m", label: "標高差", unit: "m" },
  { key: "nitrate_mg_l", label: "硝酸濃度", unit: "mg/L" },
  { key: "nitrate_mv", label: "硝酸センサー電圧", unit: "mV" },
  { key: "water_temp_cfg_c", label: "CfG水温", unit: "℃" },
  { key: "conductivity_cfg_ms_m", label: "CfG電気伝導率", unit: "mS/m" },
  { key: "ph_cfg", label: "CfG pH", unit: "" },
  { key: "ph_cfg_retest", label: "CfG pH再測定", unit: "" },
  { key: "orp_mv", label: "ORP", unit: "mV" },
];

const NUMERIC_FIELD_MAP = new Map(NUMERIC_FIELDS.map((field) => [field.key, field]));

const state = {
  data: null,
  filteredData: null,
  projection: "globe",
  basemap: "openfreemap",
  interactionsBound: false,
  tourPlaying: false,
  tourOrder: "time",
  tourIndex: -1,
  tourPhase: null,
  tourTimer: null,
  tourZoomTimer: null,
  tourPopupTimer: null,
  chartMode: "histogram",
  activeFeatureId: null,
};

const elements = {
  loading: document.querySelector("#loading-panel"),
  error: document.querySelector("#error-panel"),
  search: document.querySelector("#search-input"),
  municipality: document.querySelector("#municipality-filter"),
  measuredOnly: document.querySelector("#measured-only"),
  cfgOnly: document.querySelector("#cfg-only"),
  classInputs: [...document.querySelectorAll('input[name="feature-class"]')],
  reset: document.querySelector("#reset-filters"),
  resultList: document.querySelector("#result-list"),
  resultCount: document.querySelector("#result-count"),
  tourOrder: document.querySelector("#tour-order"),
  tourPlay: document.querySelector("#tour-play"),
  tourPause: document.querySelector("#tour-pause"),
  tourStatus: document.querySelector("#tour-status"),
  statVisible: document.querySelector("#stat-visible"),
  statMeasured: document.querySelector("#stat-measured"),
  statYokoze: document.querySelector("#stat-yokoze"),
  statCfg: document.querySelector("#stat-cfg"),
  chartModeButtons: [...document.querySelectorAll("[data-chart-mode]")],
  histogramControls: document.querySelector("#histogram-controls"),
  histogramField: document.querySelector("#histogram-field"),
  scatterControls: document.querySelector("#scatter-controls"),
  scatterXField: document.querySelector("#scatter-x-field"),
  scatterYField: document.querySelector("#scatter-y-field"),
  statisticsChart: document.querySelector("#statistics-chart"),
  statisticsSummary: document.querySelector("#statistics-summary"),
  panelToggles: [...document.querySelectorAll("[data-panel-toggle]")],
  basemap: document.querySelector("#basemap-select"),
  projection: document.querySelector("#projection-toggle"),
  fit: document.querySelector("#fit-data"),
  homeLogo: document.querySelector("#home-logo"),
  homeTitle: document.querySelector("#home-title"),
  shareButton: document.querySelector("#share-button"),
  shareDialog: document.querySelector("#share-dialog"),
  shareClose: document.querySelector("#share-close"),
  shareHomeUrl: document.querySelector("#share-home-url"),
  sharePlaceOption: document.querySelector("#share-place-option"),
  sharePlaceLabel: document.querySelector("#share-place-label"),
  sharePlaceUrl: document.querySelector("#share-place-url"),
  shareCopyHome: document.querySelector("#share-copy-home"),
  shareCopyPlace: document.querySelector("#share-copy-place"),
  shareStatus: document.querySelector("#share-status"),
  sidebar: document.querySelector("#sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
};

const map = new maplibregl.Map({
  container: "map",
  style: OPENFREEMAP_STYLE,
  center: [139.0895, 35.997],
  zoom: 12.2,
  pitch: 0,
  bearing: 0,
  attributionControl: false,
  cooperativeGestures: true,
  maxPitch: 70,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution:
      '<a href="./LICENSE" target="_blank" rel="noreferrer">ウェブマップ: CC0</a> | データライセンス確認中',
  }),
  "bottom-right",
);

const popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "370px",
  offset: 13,
});

let styleLayerRestoreTimer = null;

function scheduleStyleLayerRestore() {
  window.clearTimeout(styleLayerRestoreTimer);
  styleLayerRestoreTimer = window.setTimeout(() => {
    styleLayerRestoreTimer = null;
    restoreStyleLayers();
  }, 120);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getHomePermalink() {
  const url = new URL(window.location.href);
  url.hash = "";
  return url.href;
}

function getActiveFeature() {
  if (!state.activeFeatureId || !state.data) return null;
  return state.data.features.find(
    (feature) => feature.properties.feature_id === state.activeFeatureId,
  ) || null;
}

function getFeaturePermalink(feature) {
  return `${getHomePermalink()}#${encodeURIComponent(feature.properties.feature_id)}`;
}

function closeShareDialog() {
  elements.shareDialog.hidden = true;
  elements.shareButton.setAttribute("aria-expanded", "false");
}

function renderShareDialog() {
  elements.shareHomeUrl.textContent = getHomePermalink();
  const feature = getActiveFeature();
  elements.sharePlaceOption.hidden = !feature;
  if (feature) {
    elements.sharePlaceLabel.textContent = feature.properties.name || "地点のPermalink";
    elements.sharePlaceUrl.textContent = getFeaturePermalink(feature);
  }
}

function toggleShareDialog() {
  const willOpen = elements.shareDialog.hidden;
  elements.shareDialog.hidden = !willOpen;
  elements.shareButton.setAttribute("aria-expanded", String(willOpen));
  elements.shareStatus.textContent = "";
  if (willOpen) renderShareDialog();
}

async function copyShareUrl(kind) {
  const feature = getActiveFeature();
  const url = kind === "place" && feature ? getFeaturePermalink(feature) : getHomePermalink();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    else {
      const input = document.createElement("textarea");
      input.value = url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    elements.shareStatus.textContent = kind === "place" && feature
      ? "地点のPermalinkをコピーしました。"
      : "トップページURLをコピーしました。";
  } catch {
    elements.shareStatus.textContent = "コピーできませんでした。URLを選択してコピーしてください。";
  }
}

function returnToHome(event) {
  event.preventDefault();
  pauseTour({ reset: true, closePopup: true });
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  map.easeTo({ ...HOME_CAMERA, duration: 700, essential: true });
  closeSidebar();
  closeShareDialog();
}

function formatNumber(value, digits = 1) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(Number(value));
}

function parseTimestampAsJst(value) {
  if (!hasValue(value)) return null;
  const rawValue = String(value).trim().replace(" ", "T");
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawValue);
  const date = new Date(hasTimeZone ? rawValue : `${rawValue}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseTimestampAsJst(value);
  if (!date) return hasValue(value) ? String(value) : "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} JST`;
}

function compareFeatureIds(firstFeature, secondFeature) {
  return String(firstFeature.properties.feature_id || "").localeCompare(
    String(secondFeature.properties.feature_id || ""),
    "en",
    { numeric: true, sensitivity: "base" },
  );
}

function getTourFeatures(features = state.filteredData?.features || []) {
  return [...features].sort((firstFeature, secondFeature) => {
    if (state.tourOrder === "id") {
      return compareFeatureIds(firstFeature, secondFeature);
    }
    const firstTime = parseTimestampAsJst(firstFeature.properties.observed_at)?.getTime() ?? Infinity;
    const secondTime = parseTimestampAsJst(secondFeature.properties.observed_at)?.getTime() ?? Infinity;
    return firstTime - secondTime || compareFeatureIds(firstFeature, secondFeature);
  });
}

function popupRows(rows) {
  const visibleRows = rows.filter(([, value]) => hasValue(value));
  if (!visibleRows.length) return "";
  return `<dl class="popup-grid">${visibleRows
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
    )
    .join("")}</dl>`;
}

function popupSection(title, rows) {
  const content = popupRows(rows);
  if (!content) return "";
  return `<section class="popup-section"><h4>${escapeHtml(title)}</h4>${content}</section>`;
}

function buildPopupHtml(properties) {
  const classLabel = CLASS_LABELS[properties.feature_class] || properties.feature_class;
  const typeLabel = TYPE_LABELS[properties.feature_type] || properties.feature_type;
  const fieldRows = [
    ["水温", hasValue(properties.water_temp_field_c) ? `${formatNumber(properties.water_temp_field_c)} ℃` : null],
    ["電気伝導率", hasValue(properties.conductivity_field_ms_m) ? `${formatNumber(properties.conductivity_field_ms_m, 3)} mS/m` : null],
    ["pH", hasValue(properties.ph_field) ? formatNumber(properties.ph_field, 2) : null],
    ["RpH", hasValue(properties.rph_field) ? formatNumber(properties.rph_field, 2) : null],
    ["RpH - pH", hasValue(properties.ph_difference) ? formatNumber(properties.ph_difference, 2) : null],
    ["標高", hasValue(properties.elevation_field_m) ? `${formatNumber(properties.elevation_field_m)} m` : null],
  ];
  const cfgRows = [
    ["測定日時", hasValue(properties.cfg_observed_at) ? formatDateTime(properties.cfg_observed_at) : null],
    ["NO3濃度", hasValue(properties.nitrate_mg_l) ? `${formatNumber(properties.nitrate_mg_l, 3)} mg/L` : null],
    ["水温", hasValue(properties.water_temp_cfg_c) ? `${formatNumber(properties.water_temp_cfg_c)} ℃` : null],
    ["電気伝導率", hasValue(properties.conductivity_cfg_ms_m) ? `${formatNumber(properties.conductivity_cfg_ms_m, 3)} mS/m` : null],
    ["pH", hasValue(properties.ph_cfg) ? formatNumber(properties.ph_cfg, 2) : null],
    ["pH再測定", hasValue(properties.ph_cfg_retest) ? formatNumber(properties.ph_cfg_retest, 2) : null],
    ["ORP", hasValue(properties.orp_mv) ? `${formatNumber(properties.orp_mv)} mV` : null],
    ["標高", hasValue(properties.cfg_elevation_m) ? `${formatNumber(properties.cfg_elevation_m)} m` : null],
  ];
  const flags = String(properties.qc_flags || "")
    .split(";")
    .map((flag) => flag.trim())
    .filter(Boolean);
  const flagHtml = flags
    .map((flag) => `<span class="popup-flag">${escapeHtml(QC_LABELS[flag] || flag)}</span>`)
    .join("");
  const remarks = hasValue(properties.remarks)
    ? `<p class="popup-note">${escapeHtml(properties.remarks).replaceAll("\n", "<br>")}</p>`
    : "";

  return `
    <article>
      <header class="popup-header">
        <p class="popup-kicker">${escapeHtml(classLabel)} / ${escapeHtml(typeLabel)}</p>
        <h3>${escapeHtml(properties.name)}</h3>
      </header>
      <div class="popup-body">
        <p class="popup-meta">
          ${escapeHtml(properties.address || properties.municipality || "")}
          <br>${escapeHtml(formatDateTime(properties.observed_at))}
        </p>
        ${popupSection("現地調査", fieldRows)}
        ${properties.cfg_matched ? popupSection("Code for Ground測定", cfgRows) : ""}
        ${remarks}
        ${flagHtml}
      </div>
    </article>
  `;
}

function showFeaturePopup(feature) {
  const coordinates = feature.geometry.coordinates;
  popup.setLngLat(coordinates).setHTML(buildPopupHtml(feature.properties)).addTo(map);
}

function openFeature(feature, options = {}) {
  const coordinates = feature.geometry.coordinates;
  state.activeFeatureId = feature.properties.feature_id;
  renderStatisticsPanel();
  if (options.showPopup !== false) showFeaturePopup(feature);
  if (options.fly !== false) {
    const cameraOptions = {
      center: coordinates,
      zoom: options.zoom ?? Math.max(map.getZoom(), 15),
      essential: options.essential ?? true,
    };
    ["pitch", "bearing", "duration", "curve"].forEach((key) => {
      if (Number.isFinite(options[key])) cameraOptions[key] = options[key];
    });
    if (typeof options.easing === "function") cameraOptions.easing = options.easing;
    if (options.motion === "ease") map.easeTo(cameraOptions);
    else map.flyTo(cameraOptions);
  }
  if (options.updateHash !== false) {
    history.replaceState(null, "", `#${encodeURIComponent(feature.properties.feature_id)}`);
  }
  renderShareDialog();
}

function addDataLayers() {
  if (!state.filteredData || map.getSource("fieldwork")) return;

  map.addSource("fieldwork", {
    type: "geojson",
    data: state.filteredData,
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius: 42,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "fieldwork",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#69b7be",
        5,
        "#268795",
        10,
        "#0b4f5c",
      ],
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 10, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.94,
    },
  });

  if (!state.interactionsBound) {
    bindMapInteractions();
    state.interactionsBound = true;
  }

  if (state.basemap === "openfreemap") {
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "fieldwork",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });
  }

  map.addLayer({
    id: "unclustered-point-halo",
    type: "circle",
    source: "fieldwork",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 15, 11],
      "circle-color": "#ffffff",
      "circle-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "fieldwork",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 15, 8],
      "circle-color": [
        "match",
        ["get", "feature_class"],
        "water_quality_sample",
        CLASS_COLORS.water_quality_sample,
        "water_feature",
        CLASS_COLORS.water_feature,
        "other_observation",
        CLASS_COLORS.other_observation,
        "#77858a",
      ],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.96,
    },
  });
}

function addTerrainLayers() {
  if (!map.isStyleLoaded()) return;

  if (!map.getSource(MAPTERHORN_SOURCE_ID)) {
    map.addSource(MAPTERHORN_SOURCE_ID, {
      type: "raster-dem",
      tiles: ["mapterhorn://{z}/{x}/{y}"],
      encoding: "terrarium",
      tileSize: 512,
      minzoom: 0,
      // The regional archive around the fieldwork area has sparse z17 gaps.
      // Overzoom z16 above that level to keep the terrain surface continuous.
      maxzoom: 16,
      attribution: MAPTERHORN_ATTRIBUTION,
    });
  }

  map.setTerrain({
    source: MAPTERHORN_SOURCE_ID,
    exaggeration: TERRAIN_EXAGGERATION,
  });

  if (!map.getLayer(MAPTERHORN_HILLSHADE_LAYER_ID)) {
    const firstSymbolLayer = map
      .getStyle()
      .layers?.find((layer) => layer.type === "symbol")?.id;
    map.addLayer(
      {
        id: MAPTERHORN_HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: MAPTERHORN_SOURCE_ID,
        paint: {
          "hillshade-method": "igor",
          "hillshade-exaggeration": 0.48,
          "hillshade-shadow-color": "#183d3b",
          "hillshade-highlight-color": "#f7f1df",
          "hillshade-accent-color": "#58766d",
          "hillshade-illumination-anchor": "map",
        },
      },
      firstSymbolLayer,
    );
  }
}

function restoreStyleLayers() {
  if (!map.isStyleLoaded()) {
    scheduleStyleLayerRestore();
    return;
  }
  if (map.getProjection()?.type !== state.projection) {
    setProjection();
    return;
  }
  addTerrainLayers();
  addDataLayers();
}

function updateMapSource() {
  const source = map.getSource("fieldwork");
  if (source) source.setData(state.filteredData);
  else if (map.isStyleLoaded()) addDataLayers();
}

function fitToFeatures(features = state.filteredData?.features) {
  if (!features?.length) return;
  const bounds = new maplibregl.LngLatBounds();
  features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
  map.fitBounds(bounds, {
    padding: window.innerWidth < 760 ? 54 : 70,
    maxZoom: 14.5,
    duration: 800,
  });
}

function selectedClasses() {
  return new Set(elements.classInputs.filter((input) => input.checked).map((input) => input.value));
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replaceAll(/\s+/g, "");
}

function featureSearchText(properties) {
  return normalizeSearch(
    [
      properties.name,
      properties.address,
      properties.remarks,
      properties.cfg_location_label,
      TYPE_LABELS[properties.feature_type],
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function filterData() {
  if (!state.data) return;
  const query = normalizeSearch(elements.search.value);
  const municipality = elements.municipality.value;
  const classes = selectedClasses();

  const features = state.data.features.filter((feature) => {
    const properties = feature.properties;
    if (!classes.has(properties.feature_class)) return false;
    if (municipality !== "all" && properties.municipality !== municipality) return false;
    if (elements.measuredOnly.checked && !properties.has_water_measurement) return false;
    if (elements.cfgOnly.checked && !properties.cfg_matched) return false;
    if (query && !featureSearchText(properties).includes(query)) return false;
    return true;
  });

  state.filteredData = { ...state.data, features };
  pauseTour({ reset: true, closePopup: true });
  updateMapSource();
  updateSummary(features);
  renderResults(getTourFeatures(features));
  renderStatisticsPanel();
}

function updateSummary(features) {
  const properties = features.map((feature) => feature.properties);
  elements.statVisible.textContent = String(features.length);
  elements.statMeasured.textContent = String(
    properties.filter((item) => item.has_water_measurement).length,
  );
  elements.statYokoze.textContent = String(
    properties.filter((item) => item.in_yokoze_town).length,
  );
  elements.statCfg.textContent = String(properties.filter((item) => item.cfg_matched).length);
  elements.resultCount.textContent = `${features.length}件`;
}

function fieldDisplayName(field) {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

function numericValue(feature, key) {
  const value = Number(feature.properties[key]);
  return feature.properties[key] !== null &&
    feature.properties[key] !== "" &&
    Number.isFinite(value)
    ? value
    : null;
}

function formatChartNumber(value) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 1 : absolute >= 10 ? 2 : 3;
  return formatNumber(value, digits);
}

function calculateStatistics(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return {
    mean,
    median,
    standardDeviation: Math.sqrt(variance),
    maximum: sorted.at(-1),
    minimum: sorted[0],
  };
}

function chartDomain(values) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.08, 1);
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.06;
  return [minimum - padding, maximum + padding];
}

function renderEmptyChart(message) {
  elements.statisticsChart.innerHTML = `
    <text class="chart-empty-label" x="165" y="95" text-anchor="middle">
      ${escapeHtml(message)}
    </text>
  `;
  elements.statisticsChart.setAttribute("aria-label", message);
}

function renderHistogram(features, field) {
  const data = features
    .map((feature) => ({ feature, value: numericValue(feature, field.key) }))
    .filter((item) => item.value !== null);
  if (!data.length) {
    renderEmptyChart(`${fieldDisplayName(field)}の数値データがありません`);
    return;
  }

  const width = 330;
  const height = 190;
  const margin = { top: 14, right: 12, bottom: 34, left: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = data.map((item) => item.value);
  const [domainMin, domainMax] = chartDomain(values);
  const binCount = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(data.length))));
  const binSize = (domainMax - domainMin) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: domainMin + index * binSize,
    end: domainMin + (index + 1) * binSize,
    items: [],
  }));
  data.forEach((item) => {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((item.value - domainMin) / binSize)));
    bins[index].items.push(item);
  });
  const maxCount = Math.max(...bins.map((bin) => bin.items.length), 1);
  const barSlot = plotWidth / binCount;
  const bars = bins
    .map((bin, index) => {
      const count = bin.items.length;
      const barHeight = (count / maxCount) * plotHeight;
      const active = bin.items.some(
        (item) => item.feature.properties.feature_id === state.activeFeatureId,
      );
      return `
        <rect
          class="chart-bar${active ? " is-current" : ""}"
          x="${margin.left + index * barSlot + 1}"
          y="${margin.top + plotHeight - barHeight}"
          width="${Math.max(barSlot - 2, 1)}"
          height="${barHeight}"
          rx="2"
        ><title>${escapeHtml(`${formatChartNumber(bin.start)}〜${formatChartNumber(bin.end)}: ${count}地点`)}</title></rect>
      `;
    })
    .join("");

  const xTicks = [domainMin, (domainMin + domainMax) / 2, domainMax]
    .map((value, index) => {
      const x = margin.left + (index / 2) * plotWidth;
      return `<text class="chart-tick" x="${x}" y="${height - 17}" text-anchor="${index === 0 ? "start" : index === 2 ? "end" : "middle"}">${escapeHtml(formatChartNumber(value))}</text>`;
    })
    .join("");
  const yTicks = [0, Math.ceil(maxCount / 2), maxCount]
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((value) => {
      const y = margin.top + plotHeight - (value / maxCount) * plotHeight;
      return `
        <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" />
        <text class="chart-tick" x="${margin.left - 6}" y="${y + 3}" text-anchor="end">${value}</text>
      `;
    })
    .join("");
  const activeItem = data.find(
    (item) => item.feature.properties.feature_id === state.activeFeatureId,
  );
  const activeMarker = activeItem
    ? (() => {
        const x =
          margin.left + ((activeItem.value - domainMin) / (domainMax - domainMin)) * plotWidth;
        return `
          <line class="chart-current-line" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}" />
          <circle class="chart-current-dot" cx="${x}" cy="${margin.top + 7}" r="5">
            <title>${escapeHtml(`${activeItem.feature.properties.name}: ${formatChartNumber(activeItem.value)}`)}</title>
          </circle>
        `;
      })()
    : "";

  elements.statisticsChart.innerHTML = `
    ${yTicks}
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" />
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" />
    ${bars}
    ${activeMarker}
    ${xTicks}
    <text class="chart-axis-label" x="${width / 2}" y="${height - 3}" text-anchor="middle">${escapeHtml(fieldDisplayName(field))}</text>
  `;
  elements.statisticsChart.setAttribute(
    "aria-label",
    `${fieldDisplayName(field)}のヒストグラム、${data.length}地点`,
  );
}

function renderScatterPlot(features, xField, yField) {
  const data = features
    .map((feature) => ({
      feature,
      x: numericValue(feature, xField.key),
      y: numericValue(feature, yField.key),
    }))
    .filter((item) => item.x !== null && item.y !== null);
  if (!data.length) {
    renderEmptyChart("両軸に数値がある地点はありません");
    return;
  }

  const width = 330;
  const height = 190;
  const margin = { top: 13, right: 13, bottom: 37, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const [xMin, xMax] = chartDomain(data.map((item) => item.x));
  const [yMin, yMax] = chartDomain(data.map((item) => item.y));
  const xPosition = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const yPosition = (value) => margin.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const grid = [0, 1, 2]
    .map((index) => {
      const x = margin.left + (index / 2) * plotWidth;
      const y = margin.top + (index / 2) * plotHeight;
      return `
        <line class="chart-grid-line" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}" />
        <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" />
      `;
    })
    .join("");
  const xTickLabels = xTicks
    .map((value, index) => {
      const x = margin.left + (index / 2) * plotWidth;
      return `<text class="chart-tick" x="${x}" y="${height - 20}" text-anchor="${index === 0 ? "start" : index === 2 ? "end" : "middle"}">${escapeHtml(formatChartNumber(value))}</text>`;
    })
    .join("");
  const yTickLabels = yTicks
    .map((value, index) => {
      const y = margin.top + plotHeight - (index / 2) * plotHeight;
      return `<text class="chart-tick" x="${margin.left - 6}" y="${y + 3}" text-anchor="end">${escapeHtml(formatChartNumber(value))}</text>`;
    })
    .join("");
  const points = data
    .map((item) => {
      const active = item.feature.properties.feature_id === state.activeFeatureId;
      return `
        <circle
          class="chart-point${active ? " is-current" : ""}"
          cx="${xPosition(item.x)}"
          cy="${yPosition(item.y)}"
          r="${active ? 6 : 3.7}"
        ><title>${escapeHtml(`${item.feature.properties.name}: X=${formatChartNumber(item.x)}, Y=${formatChartNumber(item.y)}`)}</title></circle>
      `;
    })
    .join("");

  elements.statisticsChart.innerHTML = `
    ${grid}
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" />
    <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" />
    ${points}
    ${xTickLabels}
    ${yTickLabels}
    <text class="chart-axis-label" x="${margin.left + plotWidth / 2}" y="${height - 3}" text-anchor="middle">X: ${escapeHtml(xField.label)}</text>
    <text class="chart-axis-label" x="11" y="${margin.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 11 ${margin.top + plotHeight / 2})">Y: ${escapeHtml(yField.label)}</text>
  `;
  elements.statisticsChart.setAttribute(
    "aria-label",
    `${fieldDisplayName(xField)}と${fieldDisplayName(yField)}の散布図、${data.length}地点`,
  );
}

function statisticsBlock(field, features) {
  const values = features
    .map((feature) => numericValue(feature, field.key))
    .filter((value) => value !== null);
  const statistics = calculateStatistics(values);
  const metrics = statistics
    ? [
        ["平均値", statistics.mean],
        ["中央値", statistics.median],
        ["標準偏差", statistics.standardDeviation],
        ["最大値", statistics.maximum],
        ["最小値", statistics.minimum],
      ]
    : [
        ["平均値", null],
        ["中央値", null],
        ["標準偏差", null],
        ["最大値", null],
        ["最小値", null],
      ];
  return `
    <section class="statistics-block">
      <p class="statistics-block-title">${escapeHtml(fieldDisplayName(field))} / n=${values.length}</p>
      <dl class="statistics-values">
        ${metrics
          .map(
            ([label, value]) => `
              <div><dt>${label}</dt><dd title="${escapeHtml(formatChartNumber(value))}">${escapeHtml(formatChartNumber(value))}</dd></div>
            `,
          )
          .join("")}
      </dl>
    </section>
  `;
}

function renderStatisticsPanel() {
  if (!state.filteredData) return;
  const features = state.filteredData.features;
  const histogramField =
    NUMERIC_FIELD_MAP.get(elements.histogramField.value) || NUMERIC_FIELDS[0];
  const xField = NUMERIC_FIELD_MAP.get(elements.scatterXField.value) || NUMERIC_FIELDS[2];
  const yField = NUMERIC_FIELD_MAP.get(elements.scatterYField.value) || NUMERIC_FIELDS[3];
  const isHistogram = state.chartMode === "histogram";

  elements.histogramControls.hidden = !isHistogram;
  elements.scatterControls.hidden = isHistogram;
  elements.chartModeButtons.forEach((button) => {
    const active = button.dataset.chartMode === state.chartMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (isHistogram) {
    renderHistogram(features, histogramField);
    elements.statisticsSummary.innerHTML = statisticsBlock(histogramField, features);
  } else {
    renderScatterPlot(features, xField, yField);
    elements.statisticsSummary.innerHTML =
      statisticsBlock(xField, features) + statisticsBlock(yField, features);
  }
}

function populateChartControls() {
  const options = NUMERIC_FIELDS.map(
    (field) => `<option value="${field.key}">${escapeHtml(fieldDisplayName(field))}</option>`,
  ).join("");
  elements.histogramField.innerHTML = options;
  elements.scatterXField.innerHTML = options;
  elements.scatterYField.innerHTML = options;
  elements.histogramField.value = "elevation_field_m";
  elements.scatterXField.value = "conductivity_field_ms_m";
  elements.scatterYField.value = "ph_field";
}

function dotClass(featureClass) {
  if (featureClass === "water_quality_sample") return "sample";
  if (featureClass === "water_feature") return "water";
  return "other";
}

function clearTourTimer() {
  if (state.tourTimer !== null) {
    window.clearTimeout(state.tourTimer);
    state.tourTimer = null;
  }
}

function clearTourPopupTimer() {
  if (state.tourPopupTimer !== null) {
    window.clearTimeout(state.tourPopupTimer);
    state.tourPopupTimer = null;
  }
}

function clearTourZoomTimer() {
  if (state.tourZoomTimer !== null) {
    window.clearTimeout(state.tourZoomTimer);
    state.tourZoomTimer = null;
  }
}

function clearTourTimers() {
  clearTourTimer();
  clearTourZoomTimer();
  clearTourPopupTimer();
}

function updateTourControls() {
  const count = getTourFeatures().length;
  const orderLabel = state.tourOrder === "time" ? "時間順・JST" : "ID順";
  elements.tourPlay.disabled = !count || state.tourPlaying;
  elements.tourPause.disabled = !state.tourPlaying;

  if (!count) {
    elements.tourStatus.textContent = "対象地点なし";
  } else if (state.tourIndex >= 0 && state.tourIndex < count) {
    const phaseLabels = {
      overview: "全体表示",
      detail: "ズーム中",
      arrived: "表示中",
    };
    const status = state.tourPlaying
      ? phaseLabels[state.tourPhase] || "再生中"
      : "一時停止中";
    elements.tourStatus.textContent = `${orderLabel}・${status} ${state.tourIndex + 1} / ${count}`;
  } else {
    elements.tourStatus.textContent = `${orderLabel}・${count}地点`;
  }
}

function setActiveResult(featureId, options = {}) {
  let activeButton = null;
  elements.resultList.querySelectorAll(".result-item").forEach((button) => {
    const isActive = button.dataset.featureId === featureId;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "location");
      activeButton = button;
    } else {
      button.removeAttribute("aria-current");
    }
  });
  if (activeButton && options.scroll !== false) {
    activeButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function pauseTour(options = {}) {
  clearTourTimers();
  state.tourPlaying = false;
  map.stop();
  if (options.reset) {
    state.tourIndex = -1;
    state.tourPhase = null;
    state.activeFeatureId = null;
    setActiveResult(null, { scroll: false });
    renderStatisticsPanel();
  }
  if (options.closePopup) {
    popup.remove();
    if (location.hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  } else if (options.revealPopup) {
    const feature = getTourFeatures()[state.tourIndex];
    if (feature) showFeaturePopup(feature);
  }
  updateTourControls();
  renderShareDialog();
}

function scheduleNextTourFeature() {
  clearTourTimer();
  if (!state.tourPlaying) return;
  state.tourTimer = window.setTimeout(() => {
    const count = getTourFeatures().length;
    if (!count) {
      pauseTour({ reset: true });
      return;
    }
    showTourFeature((state.tourIndex + 1) % count);
  }, TOUR_INTERVAL_MS);
}

function smoothCameraEasing(progress) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function wrapBearing(bearing) {
  return ((bearing + 180) % 360 + 360) % 360 - 180;
}

function createTourCameraOptions() {
  const direction = Math.random() < 0.5 ? -1 : 1;
  const turn = 65 + Math.random() * 110;
  const overviewBearing = wrapBearing(map.getBearing() + direction * turn);
  const detailBearing = wrapBearing(overviewBearing + (Math.random() - 0.5) * 24);
  return {
    overview: {
      zoom: TOUR_OVERVIEW_ZOOM,
      pitch: 42 + Math.random() * 7,
      bearing: overviewBearing,
      duration: TOUR_OVERVIEW_DURATION_MS,
      curve: 1.55 + Math.random() * 0.25,
      easing: smoothCameraEasing,
      essential: false,
      showPopup: false,
    },
    detail: {
      zoom: TOUR_DETAIL_ZOOM,
      pitch: 58 + Math.random() * 7,
      bearing: detailBearing,
      duration: TOUR_DETAIL_DURATION_MS,
      easing: smoothCameraEasing,
      essential: false,
      showPopup: false,
      updateHash: false,
      motion: "ease",
    },
  };
}

function showTourFeature(index) {
  const features = getTourFeatures();
  if (!features.length) {
    pauseTour({ reset: true });
    return;
  }

  state.tourIndex = ((index % features.length) + features.length) % features.length;
  state.tourPhase = "overview";
  const feature = features[state.tourIndex];
  const camera = createTourCameraOptions();
  clearTourZoomTimer();
  clearTourPopupTimer();
  popup.remove();
  openFeature(feature, { ...camera.overview, updateHash: false });
  setActiveResult(feature.properties.feature_id, { scroll: false });
  updateTourControls();
  state.tourZoomTimer = window.setTimeout(() => {
    const currentFeature = getTourFeatures()[state.tourIndex];
    if (
      state.tourPlaying &&
      currentFeature?.properties.feature_id === feature.properties.feature_id
    ) {
      state.tourPhase = "detail";
      openFeature(feature, camera.detail);
      updateTourControls();
    }
    state.tourZoomTimer = null;
  }, TOUR_DETAIL_START_MS);
  state.tourPopupTimer = window.setTimeout(() => {
    const currentFeature = getTourFeatures()[state.tourIndex];
    if (
      state.tourPlaying &&
      currentFeature?.properties.feature_id === feature.properties.feature_id
    ) {
      state.tourPhase = "arrived";
      showFeaturePopup(feature);
      updateTourControls();
    }
    state.tourPopupTimer = null;
  }, TOUR_POPUP_DELAY_MS);
  scheduleNextTourFeature();
}

function startTour() {
  const count = getTourFeatures().length;
  if (!count || state.tourPlaying) return;
  state.tourPlaying = true;
  const nextIndex = state.tourIndex >= 0 ? (state.tourIndex + 1) % count : 0;
  showTourFeature(nextIndex);
  closeSidebar();
}

function renderResults(features) {
  elements.resultList.replaceChildren();
  if (!features.length) {
    const empty = document.createElement("p");
    empty.className = "empty-results";
    empty.textContent = "条件に合う地点はありません。";
    elements.resultList.append(empty);
    updateTourControls();
    return;
  }

  const fragment = document.createDocumentFragment();
  features.forEach((feature, index) => {
    const properties = feature.properties;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-item";
    button.dataset.featureId = properties.feature_id;
    button.innerHTML = `
      <span class="result-item-title">
        <i class="legend-dot ${dotClass(properties.feature_class)}" aria-hidden="true"></i>
        <span>${escapeHtml(properties.name)}</span>
      </span>
      <span class="result-item-meta">
        ${escapeHtml(properties.municipality)} ・ ${escapeHtml(TYPE_LABELS[properties.feature_type] || properties.feature_type)}
      </span>
      <span class="result-item-time">${escapeHtml(formatDateTime(properties.observed_at))}</span>
    `;
    button.addEventListener("click", () => {
      pauseTour();
      state.tourIndex = index;
      openFeature(feature);
      setActiveResult(properties.feature_id);
      updateTourControls();
      closeSidebar();
    });
    fragment.append(button);
  });
  elements.resultList.append(fragment);
  updateTourControls();
}

function resetFilters() {
  elements.search.value = "";
  elements.municipality.value = "all";
  elements.measuredOnly.checked = false;
  elements.cfgOnly.checked = false;
  elements.classInputs.forEach((input) => {
    input.checked = true;
  });
  filterData();
  fitToFeatures(state.data?.features);
}

function openSidebar() {
  elements.sidebar.classList.add("is-open");
  elements.sidebarToggle.setAttribute("aria-expanded", "true");
  elements.sidebarScrim.hidden = false;
}

function closeSidebar() {
  elements.sidebar.classList.remove("is-open");
  elements.sidebarToggle.setAttribute("aria-expanded", "false");
  elements.sidebarScrim.hidden = true;
}

function togglePanel(toggle) {
  const content = document.querySelector(`#${toggle.getAttribute("aria-controls")}`);
  if (!content) return;
  const collapsed = !content.hidden;
  content.hidden = collapsed;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${toggle.closest("section").querySelector("h2").textContent}を${collapsed ? "開く" : "折りたたむ"}`);
  toggle.querySelector("span").textContent = collapsed ? "開く" : "折りたたむ";
  toggle.closest(".collapsible-panel").classList.toggle("is-collapsed", collapsed);
}

function setProjection() {
  if (!map.isStyleLoaded()) return;
  if (map.getProjection()?.type !== state.projection) {
    map.setProjection({ type: state.projection });
    scheduleStyleLayerRestore();
  }
  elements.projection.textContent = state.projection === "globe" ? "Globe" : "2D";
  elements.projection.setAttribute("aria-pressed", String(state.projection === "globe"));
}

function switchBasemap(value) {
  pauseTour();
  state.basemap = value;
  popup.remove();
  map.setStyle(value === "gsi" ? GSI_STYLE : OPENFREEMAP_STYLE);
}

function bindMapInteractions() {
  map.on("click", "clusters", async (event) => {
    pauseTour();
    const feature = map.queryRenderedFeatures(event.point, { layers: ["clusters"] })[0];
    if (!feature) return;
    const source = map.getSource("fieldwork");
    const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({ center: feature.geometry.coordinates, zoom });
  });

  map.on("click", "unclustered-point", (event) => {
    pauseTour();
    const renderedFeature = event.features?.[0];
    if (!renderedFeature) return;
    const featureId = renderedFeature.properties.feature_id;
    const sourceFeature = state.data.features.find(
      (feature) => feature.properties.feature_id === featureId,
    );
    if (sourceFeature) {
      state.tourIndex = getTourFeatures().findIndex(
        (feature) => feature.properties.feature_id === featureId,
      );
      openFeature(sourceFeature, { fly: false });
      setActiveResult(featureId);
      updateTourControls();
    }
  });

  ["clusters", "unclustered-point"].forEach((layerId) => {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  });
}

function bindControls() {
  const filterInputs = [
    elements.search,
    elements.municipality,
    elements.measuredOnly,
    elements.cfgOnly,
    ...elements.classInputs,
  ];
  filterInputs.forEach((input) => {
    input.addEventListener(input === elements.search ? "input" : "change", filterData);
  });
  elements.reset.addEventListener("click", resetFilters);
  elements.chartModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.chartMode = button.dataset.chartMode;
      renderStatisticsPanel();
    });
  });
  [elements.histogramField, elements.scatterXField, elements.scatterYField].forEach((select) => {
    select.addEventListener("change", renderStatisticsPanel);
  });
  elements.panelToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => togglePanel(toggle));
  });
  elements.tourOrder.addEventListener("change", () => {
    state.tourOrder = elements.tourOrder.value;
    pauseTour({ reset: true, closePopup: true });
    renderResults(getTourFeatures());
  });
  elements.tourPlay.addEventListener("click", startTour);
  elements.tourPause.addEventListener("click", () => pauseTour({ revealPopup: true }));
  elements.fit.addEventListener("click", () => fitToFeatures());
  elements.homeTitle.addEventListener("click", returnToHome);
  elements.shareButton.addEventListener("click", toggleShareDialog);
  elements.shareClose.addEventListener("click", closeShareDialog);
  elements.shareCopyHome.addEventListener("click", () => copyShareUrl("home"));
  elements.shareCopyPlace.addEventListener("click", () => copyShareUrl("place"));
  elements.basemap.addEventListener("change", (event) => switchBasemap(event.target.value));
  elements.projection.addEventListener("click", () => {
    state.projection = state.projection === "globe" ? "mercator" : "globe";
    setProjection();
  });
  elements.sidebarToggle.addEventListener("click", () => {
    if (elements.sidebar.classList.contains("is-open")) closeSidebar();
    else openSidebar();
  });
  elements.sidebarScrim.addEventListener("click", closeSidebar);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
      closeShareDialog();
    }
  });
  document.addEventListener("click", (event) => {
    if (
      !elements.shareDialog.hidden &&
      !elements.shareDialog.contains(event.target) &&
      !elements.shareButton.contains(event.target)
    ) closeShareDialog();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.tourPlaying) pauseTour();
  });
}

async function loadData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("GeoJSON FeatureCollection is required.");
  }
  return data;
}

function openHashFeature() {
  const featureId = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!featureId || !state.data) return false;
  const feature = state.data.features.find(
    (item) => item.properties.feature_id === featureId,
  );
  if (!feature) return false;
  window.setTimeout(() => openFeature(feature), 300);
  return true;
}

async function initialize() {
  populateChartControls();
  bindControls();

  // `style.load` can fire before this module finishes initializing when a
  // remote style is already cached. `load` covers the initial style, while
  // `style.load` restores terrain and data after later basemap switches.
  map.once("load", restoreStyleLayers);
  map.on("style.load", restoreStyleLayers);
  map.on("styledata", restoreStyleLayers);
  if (map.isStyleLoaded()) restoreStyleLayers();

  try {
    const [data] = await Promise.all([
      loadData(),
      new Promise((resolve) => {
        if (map.loaded()) resolve();
        else map.once("load", resolve);
      }),
    ]);
    state.data = data;
    state.filteredData = data;
    addDataLayers();
    updateSummary(data.features);
    renderResults(getTourFeatures(data.features));
    renderStatisticsPanel();
    fitToFeatures(data.features);
    elements.loading.hidden = true;
    if (!openHashFeature()) startTour();
  } catch (error) {
    console.error(error);
    elements.loading.hidden = true;
    elements.error.hidden = false;
  }
}

initialize();
