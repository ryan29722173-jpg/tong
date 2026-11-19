const API_URL = "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json";
const FAVORITES_KEY = "youbike-taipei-favorites-v1";
const PAGE_SIZE = 40;

const listElement = document.querySelector("#station-list");
const searchInput = document.querySelector("#search-input");
const districtSelect = document.querySelector("#district-select");
const favoritesFilter = document.querySelector("#favorites-filter");
const refreshButton = document.querySelector("#refresh-button");
const statusBanner = document.querySelector("#status-banner");
const resultCount = document.querySelector("#result-count");
const updatedAt = document.querySelector("#updated-at");

let stations = [];
let favorites = loadFavorites();
let favoritesOnly = false;
let loading = false;
let loadError = "";
let visibleLimit = PAGE_SIZE;

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(stored) ? new Set(stored.filter((value) => typeof value === "string")) : new Set();
  } catch (error) {
    console.warn("無法讀取收藏資料：", error);
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    return true;
  } catch (error) {
    console.error("無法儲存收藏資料：", error);
    showBanner("收藏無法儲存，請檢查瀏覽器的網站儲存空間設定。");
    return false;
  }
}

function showBanner(message) {
  statusBanner.textContent = message;
  statusBanner.hidden = !message;
}

function getStationId(station) {
  return String(station.sno ?? station.station_no ?? "");
}

function getCount(station, keys) {
  for (const key of keys) {
    const value = Number(station[key]);
    if (station[key] !== undefined && station[key] !== null && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeStation(station) {
  return {
    id: getStationId(station),
    name: String(station.sna ?? station.station_name ?? "未命名站點"),
    area: String(station.sarea ?? station.district ?? "未提供行政區"),
    address: String(station.ar ?? station.address ?? ""),
    bikes: getCount(station, ["available_rent_bikes", "sbi"]),
    spaces: getCount(station, ["available_return_bikes", "bemp"]),
  };
}

function addOption(label, value) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  districtSelect.append(option);
}

function updateDistrictOptions() {
  const selected = districtSelect.value;
  const areas = [...new Set(stations.map((station) => station.area).filter((area) => area && area !== "未提供行政區"))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  districtSelect.replaceChildren();
  addOption("全部行政區", "");
  for (const area of areas) addOption(area, area);
  districtSelect.value = areas.includes(selected) ? selected : "";
}

function createMetric(label, icon, value, type) {
  const metric = document.createElement("div");
  metric.className = `metric ${type}`;

  const metricLabel = document.createElement("span");
  metricLabel.className = "metric-label";
  const iconElement = document.createElement("span");
  iconElement.className = "metric-icon";
  iconElement.setAttribute("aria-hidden", "true");
  iconElement.textContent = icon;
  metricLabel.append(iconElement, document.createTextNode(label));

  const number = document.createElement("strong");
  number.className = "metric-value";
  number.textContent = value === null ? "--" : String(value);
  if (value === 0) number.classList.add("zero");
  else if (value !== null && value <= 2) number.classList.add("low");
  metric.append(metricLabel, number);
  return metric;
}

function createStationCard(station, index) {
  const card = document.createElement("article");
  card.className = "station-card";
  card.style.animationDelay = `${Math.min(index, 8) * 25}ms`;

  const top = document.createElement("div");
  top.className = "station-top";
  const name = document.createElement("h3");
  name.className = "station-name";
  name.textContent = station.name;
  name.title = station.name;
  const area = document.createElement("span");
  area.className = "station-area";
  area.textContent = station.area;

  const titleGroup = document.createElement("div");
  titleGroup.className = "station-top";
  titleGroup.style.justifyContent = "flex-start";
  titleGroup.style.minWidth = "0";
  titleGroup.append(name, area);

  const favoriteButton = document.createElement("button");
  const isFavorite = favorites.has(station.id);
  favoriteButton.className = "favorite-button";
  favoriteButton.type = "button";
  favoriteButton.setAttribute("aria-label", isFavorite ? `取消收藏${station.name}` : `收藏${station.name}`);
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  favoriteButton.textContent = isFavorite ? "★" : "☆";
  favoriteButton.addEventListener("click", () => {
    if (favorites.has(station.id)) favorites.delete(station.id);
    else favorites.add(station.id);
    saveFavorites();
    render();
  });
  top.append(titleGroup, favoriteButton);

  const address = document.createElement("p");
  address.className = "station-address";
  address.textContent = station.address || "地址未提供";

  const metrics = document.createElement("div");
  metrics.className = "station-metrics";
  metrics.append(
    createMetric("可借車輛", "↗", station.bikes, "bike"),
    createMetric("可還車位", "↙", station.spaces, "return"),
  );
  card.append(top, address, metrics);
  return card;
}

function createStatePanel(icon, title, description, retry) {
  const panel = document.createElement("div");
  panel.className = "state-panel";
  const symbol = document.createElement("span");
  symbol.className = "state-icon";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = icon;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  panel.append(symbol, heading, copy);
  if (retry) {
    const button = document.createElement("button");
    button.className = "retry-button";
    button.type = "button";
    button.textContent = "重新載入";
    button.addEventListener("click", fetchStations);
    panel.append(button);
  }
  return panel;
}

function getVisibleStations() {
  const query = searchInput.value.trim().toLocaleLowerCase("zh-Hant");
  const selectedArea = districtSelect.value;
  return stations.filter((station) => {
    const matchesQuery = !query || `${station.name} ${station.area} ${station.address}`.toLocaleLowerCase("zh-Hant").includes(query);
    const matchesArea = !selectedArea || station.area === selectedArea;
    const matchesFavorite = !favoritesOnly || favorites.has(station.id);
    return matchesQuery && matchesArea && matchesFavorite;
  });
}

function render() {
  listElement.replaceChildren();
  listElement.setAttribute("aria-busy", String(loading));
  refreshButton.classList.toggle("is-loading", loading);
  refreshButton.disabled = loading;
  refreshButton.setAttribute("aria-busy", String(loading));
  favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
  resultCount.textContent = stations.length ? `(${getVisibleStations().length})` : "";

  if (loading && stations.length === 0) {
    for (let index = 0; index < 3; index += 1) {
      const skeleton = document.createElement("div");
      skeleton.className = "skeleton-card";
      listElement.append(skeleton);
    }
    return;
  }

  if (loadError && stations.length === 0) {
    listElement.append(createStatePanel("!", "目前無法載入站點", loadError, true));
    return;
  }

  if (stations.length === 0) {
    listElement.append(createStatePanel("⌁", "目前沒有站點資料", "資料來源目前沒有可顯示的站點，請稍後重新整理。", false));
    return;
  }

  const filtered = getVisibleStations();
  const visible = filtered.slice(0, visibleLimit);
  if (visible.length === 0) {
    const isFiltered = searchInput.value || districtSelect.value || favoritesOnly;
    listElement.append(createStatePanel("⌕", isFiltered ? "找不到符合條件的站點" : "沒有站點資料", isFiltered ? "試試其他關鍵字、行政區，或先收藏幾個站點。" : "目前沒有可顯示的站點。", false));
    return;
  }
  visible.forEach((station, index) => listElement.append(createStationCard(station, index)));
  if (visible.length < filtered.length) {
    const moreButton = document.createElement("button");
    moreButton.className = "more-button";
    moreButton.type = "button";
    moreButton.textContent = `顯示更多站點（還有 ${filtered.length - visible.length} 個）`;
    moreButton.addEventListener("click", () => {
      visibleLimit += PAGE_SIZE;
      render();
    });
    listElement.append(moreButton);
  }
}

async function fetchStations() {
  if (loading) return;
  loading = true;
  loadError = "";
  showBanner(stations.length ? "正在更新站點資料…" : "");
  render();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_URL, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`資料服務回應 HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("資料格式不符，預期收到站點清單。");
    stations = payload.map(normalizeStation).filter((station) => station.id);
    updateDistrictOptions();
    loadError = "";
    updatedAt.textContent = `更新於 ${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    showBanner("");
  } catch (error) {
    loadError = error.name === "AbortError"
      ? "連線逾時，請確認網路後重試。"
      : `網路或資料服務發生問題：${error.message}`;
    showBanner(loadError);
  } finally {
    window.clearTimeout(timeout);
    loading = false;
    render();
  }
}

searchInput.addEventListener("input", () => {
  visibleLimit = PAGE_SIZE;
  render();
});
districtSelect.addEventListener("change", () => {
  visibleLimit = PAGE_SIZE;
  render();
});
favoritesFilter.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  visibleLimit = PAGE_SIZE;
  render();
});
refreshButton.addEventListener("click", fetchStations);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
});

fetchStations();
