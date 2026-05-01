const AUTH_FLAG_KEY = "loggedIn";
const AUTH_TOKEN_KEY = "trafficai_admin_token";
const AUTH_EMAIL_KEY = "trafficai_admin_email";
const AUTH_ROLE_KEY = "trafficai_user_role";
const PRIVATE_CONFIG = window.TRAFFICAI_PRIVATE_CONFIG || {};
const LOGIN_PAGE_PATH = PRIVATE_CONFIG.loginPagePath || "loged.html";
const USER_PORTAL_PATH = PRIVATE_CONFIG.userPortalPath || "user-dashboard.html";
const ADMIN_PORTAL_PATH = PRIVATE_CONFIG.adminPortalPath || "admin-portal.html";
const USER_PORTAL_ROUTE = PRIVATE_CONFIG.userPortalRoute || "/user-dashboard";
const ADMIN_PORTAL_ROUTE = PRIVATE_CONFIG.adminPortalRoute || "/admin-portal";

function decodeJwtPayload(token) {
    if (!token) return null;
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    try {
        const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        return JSON.parse(atob(padded));
    } catch (_error) {
        return null;
    }
}

function getStoredAuthToken() {
    try {
        return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
    } catch (_error) {
        return "";
    }
}

function clearAuthSession() {
    [localStorage, sessionStorage].forEach((store) => {
        try {
            store.removeItem(AUTH_FLAG_KEY);
            store.removeItem(AUTH_TOKEN_KEY);
            store.removeItem(AUTH_EMAIL_KEY);
            store.removeItem(AUTH_ROLE_KEY);
        } catch (_error) {
            // Ignore storage clear failures to avoid blocking redirect.
        }
    });
}

function hasValidAuthSession() {
    let authFlag = false;
    try {
        authFlag = localStorage.getItem(AUTH_FLAG_KEY) === "true" || sessionStorage.getItem(AUTH_FLAG_KEY) === "true";
    } catch (_error) {
        authFlag = false;
    }
    if (!authFlag) return false;

    const token = getStoredAuthToken();
    if (!token) return false;
    const payload = decodeJwtPayload(token);
    if (!payload) return false;

    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
        return false;
    }
    return true;
}

function getStoredAuthRole() {
    try {
        return (
            localStorage.getItem(AUTH_ROLE_KEY) ||
            sessionStorage.getItem(AUTH_ROLE_KEY) ||
            ""
        )
            .trim()
            .toLowerCase();
    } catch (_error) {
        return "";
    }
}

function shouldUseRoutePaths() {
    if (!/^https?:$/i.test(window.location.protocol)) return false;
    const host = String(window.location.hostname || "").toLowerCase();
    const localDevPorts = new Set(["3000", "3001", "5500", "5501", "5502", "5173"]);
    if ((host === "localhost" || host === "127.0.0.1") && localDevPorts.has(String(window.location.port || ""))) {
        return false;
    }
    return true;
}

function resolvePortalPathByRole(role = "user") {
    const normalizedRole = String(role || "").toLowerCase() === "admin" ? "admin" : "user";
    if (shouldUseRoutePaths()) {
        return normalizedRole === "admin" ? ADMIN_PORTAL_ROUTE : USER_PORTAL_ROUTE;
    }
    return normalizedRole === "admin" ? ADMIN_PORTAL_PATH : USER_PORTAL_PATH;
}

if (!hasValidAuthSession()) {
    clearAuthSession();
    window.location.href = LOGIN_PAGE_PATH;
}

const requiredRole = String(document.body?.dataset?.requiredRole || "user").toLowerCase();
const currentAuthRole = getStoredAuthRole() || String(decodeJwtPayload(getStoredAuthToken())?.role || "user").toLowerCase();
if (requiredRole === "user" && currentAuthRole === "admin") {
    window.location.href = resolvePortalPathByRole("admin");
}
if (requiredRole === "admin" && currentAuthRole !== "admin") {
    window.location.href = resolvePortalPathByRole("user");
}

let map;
let routeLayer;
let userMarker;
let watchId;
let pathLine;
let searchHistory = [];
let sourceMarker;
let destMarker;
let viaMarkers = [];
let draftWaypointMarkers = [];
let waypointAddMode = false;
let smartAlertTimer = null;
let lastRouteSnapshot = null;
let cachedVoices = [];
let fatigueMonitorActive = false;
let fatigueDetectionMode = "off";
let fatigueStream = null;
let fatigueFrameHandle = null;
let fatigueFaceMesh = null;
let fatigueFallbackTimer = null;
let fatigueScore = 0;
let fatigueAlertCooldownUntil = 0;
let fatigueTripContextNote = "";
let closedEyeFrameCount = 0;
let yawnFrameCount = 0;
let eyesClosedEventCount = 0;
let yawnEventCount = 0;
let routeLayers = [];
let routeLayerMeta = [];
let selectedRouteKey = "recommended";
let selectedRouteCoordinates = [];
let selectedRouteGeometry = null;
let routeDisplayMode = "all";
let trafficHotspotLayer = null;
let trafficHotspots = [];
let trafficRefreshTimer = null;
let evRefreshTimer = null;
let realtimeDataTimer = null;
let evStations = [];
let fuelStations = [];
let policeStations = [];
let tollPlazas = [];
let ambulanceModeActive = false;
let ambulanceMarker = null;
let ambulancePriorityLayer = null;
let ambulanceSimulationTimer = null;
let ambulanceDistanceCheckTimer = null;
let ambulanceRouteCursor = 0;
let ambulanceAlertLevel = "none";
let ambulanceLastPriorityAlertAt = 0;
let ambulanceLastVoiceAlertAt = 0;
let ambulanceTrackedPath = [];
let activeBaseLayer = null;
let offlineRouteCache = null;
let tollLayer = null;
let workspaceState = "splash";
let sourceSelection = null;
let destinationSelection = null;
let destinationPickMode = false;

const poiLayers = { gas: null, charging: null, police: null };
const OFFLINE_ROUTE_CACHE_KEY = "trafficai_offline_route_cache_v2";
const OFFLINE_REALTIME_CACHE_KEY = "trafficai_realtime_cache_v2";
const REALTIME_POLL_MS = 45000;
const EV_REFRESH_MS = 60000;
const MAX_HISTORY_ITEMS = 8;
const CLOUD_SYNC_TIMEOUT_MS = 6000;
const DEVICE_USER_ID_KEY = "trafficai_device_uid_v1";
const GEOCODE_FETCH_TIMEOUT_MS = 10000;
const WEATHER_FETCH_TIMEOUT_MS = 6000;
const EMERGENCY_ALERT_POLL_MS = Math.max(3000, Number(PRIVATE_CONFIG?.emergencyAlertPollMs || 8000));
const AMBULANCE_DISTANCE_THRESHOLD_KM = 5;
const AMBULANCE_ROUTE_MATCH_THRESHOLD_METERS = Number(PRIVATE_CONFIG?.ambulanceRouteMatchThresholdMeters || 450);
const AMBULANCE_ROUTE_OVERLAP_RATIO = 0.55;
const AMBULANCE_ALERT_COOLDOWN_MS = 12000;
const EMERGENCY_VOICE_REPEAT_MS = Math.max(6000, Number(PRIVATE_CONFIG?.emergencyVoiceRepeatMs || 10000));
const EMERGENCY_ROUTE_ALERT_MESSAGE = "Emergency Vehicle Approaching on your route. Please clear the lane.";
const NOMINATIM_SEARCH_ENDPOINT = PRIVATE_CONFIG?.services?.nominatimSearch || "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_ENDPOINT = PRIVATE_CONFIG?.services?.nominatimReverse || "https://nominatim.openstreetmap.org/reverse";
const OSRM_ROUTE_BASE = PRIVATE_CONFIG?.services?.osrmRouteBase || "https://router.project-osrm.org/route/v1/driving";
const OVERPASS_API_ENDPOINT = PRIVATE_CONFIG?.services?.overpassApi || "https://overpass-api.de/api/interpreter";
const WEATHER_API_ENDPOINT = PRIVATE_CONFIG?.services?.weatherApi || "https://api.open-meteo.com/v1/forecast";
const POI_SEARCH_RADIUS_METERS = Number(PRIVATE_CONFIG?.poiSearchRadiusMeters || 2000);
const POI_ROUTE_MAX_RESULTS = Math.max(5, Number(PRIVATE_CONFIG?.poiMaxResults || 14));
const POI_QUERY_TIMEOUT_MS = Math.max(9000, Number(PRIVATE_CONFIG?.poiQueryTimeoutMs || 22000));
const POI_QUERY_RADIUS_METERS = Math.max(
    600,
    Math.min(5000, Number(PRIVATE_CONFIG?.poiQueryRadiusMeters || (POI_SEARCH_RADIUS_METERS + 400)))
);
const OVERPASS_API_FALLBACK_ENDPOINTS = (() => {
    const configured = Array.isArray(PRIVATE_CONFIG?.services?.overpassCandidates)
        ? PRIVATE_CONFIG.services.overpassCandidates
        : [];
    const defaults = [
        OVERPASS_API_ENDPOINT,
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter"
    ];
    return [...new Set([...configured, ...defaults].map((value) => String(value || "").trim()).filter(Boolean))];
})();
const ROUTE_DEFAULT_CENTER = [14.4644, 75.9218];
const API_BASE_URL = (() => {
    const preferLocalhostApi =
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
        window.location.port !== "8080";
    const candidates = [
        window.TRAFFICAI_API_BASE,
        ...(Array.isArray(PRIVATE_CONFIG.apiBaseCandidates) ? PRIVATE_CONFIG.apiBaseCandidates : []),
        "http://localhost:8080/api",
        "http://127.0.0.1:8080/api",
        "/api"
    ];

    if (preferLocalhostApi) return "http://localhost:8080/api";

    for (const candidate of candidates) {
        const raw = String(candidate || "").trim();
        if (!raw) continue;
        if (raw.startsWith("/")) return raw.replace(/\/+$/, "");
        if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
    }
    return "http://localhost:8080/api";
})();

const FATIGUE_CONFIG = {
    earThreshold: 0.215,
    marThreshold: 0.62,
    closedEyeFramesForAlert: 14,
    yawnFramesForAlert: 18,
    alertCooldownMs: 22000
};

const LEFT_EYE_POINTS = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_POINTS = [362, 385, 387, 263, 373, 380];

const PURPOSE_LABELS = {
    hospital: "Hospital",
    school: "School/College",
    office: "Office",
    temple: "Temple/Religious",
    airport: "Airport/Station",
    personal: "Personal",
    delivery: "Delivery",
    tourism: "Tourism",
    other: "Other"
};

const PRIORITY_LABELS = {
    normal: "Normal",
    important: "Important",
    urgent: "Urgent",
    emergency: "Emergency"
};

const FUEL_PROFILES = {
    car: { kmPerL: 15, fuelPricePerL: 106, co2PerL: 2392 },
    bike: { kmPerL: 40, fuelPricePerL: 104, co2PerL: 2300 },
    bus: { kmPerL: 4, fuelPricePerL: 94, co2PerL: 2680 },
    truck: { kmPerL: 3, fuelPricePerL: 94, co2PerL: 3200 }
};

const EV_TARIFF_PROFILE = {
    car: { baseRatePerKwh: 19, avgKwhPerTopUp: 18 },
    bike: { baseRatePerKwh: 15, avgKwhPerTopUp: 4 },
    bus: { baseRatePerKwh: 24, avgKwhPerTopUp: 90 },
    truck: { baseRatePerKwh: 26, avgKwhPerTopUp: 120 }
};

const TOLL_RATE_PROFILE = {
    car: { basePerPlaza: 85 },
    bike: { basePerPlaza: 45 },
    bus: { basePerPlaza: 210 },
    truck: { basePerPlaza: 320 }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(a, b) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const [lat1, lon1] = a;
    const [lat2, lon2] = b;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function getMapCenterCoords() {
    if (map?.getCenter) {
        const center = map.getCenter();
        return [center.lat, center.lng];
    }
    return ROUTE_DEFAULT_CENTER;
}

function parseCoordinateInput(input = "") {
    const match = String(input).trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
}

function hasCountryHint(text = "") {
    return /\b(india|usa|united states|uk|united kingdom|canada|australia|uae|china|japan|france|germany|italy)\b/i.test(text);
}

function normalizeTokens(text = "") {
    return String(text)
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1);
}

function hashString(text = "") {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash || 1;
}

function seededNoise(seed, index = 0) {
    const x = Math.sin((seed + 1) * (index + 1) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while fetching ${url}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function buildGeocodeSearchQueries(place) {
    const clean = String(place || "").trim();
    if (!clean) return [];

    const queries = [clean];
    if (!hasCountryHint(clean) && !/,/.test(clean)) {
        queries.push(`${clean}, India`);
    }
    return [...new Set(queries)];
}

function scoreGeocodeCandidate(candidate, inputPlace, referenceCoords) {
    const lat = Number(candidate.lat);
    const lon = Number(candidate.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Number.NEGATIVE_INFINITY;

    const displayName = String(candidate.display_name || "").toLowerCase();
    const input = String(inputPlace || "").toLowerCase().trim();
    const tokens = normalizeTokens(input);
    const importance = Number(candidate.importance || 0);
    const classType = `${candidate.class || ""}:${candidate.type || ""}`.toLowerCase();
    const countryCode = String(candidate.address?.country_code || "").toLowerCase();
    const explicitCountry = hasCountryHint(input);

    let score = importance * 180;
    if (input && displayName.includes(input)) score += 240;
    tokens.forEach((token) => {
        if (displayName.includes(token)) score += 18;
    });

    if (/city|town|village|suburb|road|highway|residential/.test(classType)) score += 14;
    if (!explicitCountry && countryCode === "in") score += 36;

    if (referenceCoords) {
        const distanceKm = haversineDistanceKm(referenceCoords, [lat, lon]);
        if (distanceKm <= 40) score += 100;
        else if (distanceKm <= 150) score += 70;
        else if (distanceKm <= 500) score += 35;
        else if (distanceKm > 2500) score -= 90;
    }

    if (candidate.address?.state && /karnataka/i.test(candidate.address.state) && !explicitCountry) {
        score += 12;
    }

    return score;
}

function pickBestGeocodeResult(results, inputPlace, referenceCoords) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    (results || []).forEach((candidate) => {
        const score = scoreGeocodeCandidate(candidate, inputPlace, referenceCoords);
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    });

    if (!best) return null;
    return {
        ...best,
        _score: bestScore
    };
}

function buildRouteSeed(routeCoordinates = []) {
    if (!routeCoordinates.length) return 11;
    const first = routeCoordinates[0] || [];
    const mid = routeCoordinates[Math.floor(routeCoordinates.length / 2)] || [];
    const last = routeCoordinates[routeCoordinates.length - 1] || [];
    const normalized = [first, mid, last]
        .map((pair) => `${Number(pair[0] || 0).toFixed(4)}|${Number(pair[1] || 0).toFixed(4)}`)
        .join("|");
    return hashString(normalized);
}

function weatherCodeToText(code) {
    const mapping = {
        0: "Clear",
        1: "Mostly Clear",
        2: "Partly Cloudy",
        3: "Cloudy",
        45: "Fog",
        48: "Fog",
        51: "Light Drizzle",
        53: "Drizzle",
        55: "Heavy Drizzle",
        61: "Light Rain",
        63: "Rain",
        65: "Heavy Rain",
        71: "Light Snow",
        73: "Snow",
        75: "Heavy Snow",
        80: "Rain Showers",
        81: "Heavy Showers",
        82: "Intense Showers",
        95: "Thunderstorm"
    };
    return mapping[Number(code)] || "Clear";
}

const formatDistance = (km) => `${km.toFixed(2)} km`;

function createClientUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `uid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateDeviceUserId() {
    try {
        const saved = localStorage.getItem(DEVICE_USER_ID_KEY);
        if (saved) return saved;
        const next = createClientUuid();
        localStorage.setItem(DEVICE_USER_ID_KEY, next);
        return next;
    } catch (_error) {
        return "anonymous-local-user";
    }
}

function toApiUrl(path) {
    const normalizedPath = String(path || "").startsWith("/") ? path : `/${String(path || "")}`;
    return `${API_BASE_URL}${normalizedPath}`;
}

async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_SYNC_TIMEOUT_MS);
    const authToken = getStoredAuthToken();

    try {
        const response = await fetch(toApiUrl(path), {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                ...(options.headers || {})
            },
            signal: controller.signal
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`${response.status} ${response.statusText}${message ? ` - ${message}` : ""}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeHistoryEntry(entry) {
    return {
        source: String(entry.source || entry.origin || "").trim(),
        destination: String(entry.destination || "").trim(),
        purpose: String(entry.purpose || "personal"),
        priority: String(entry.priority || "normal"),
        timestamp: Number(entry.timestamp || Date.now())
    };
}

function mergeSearchHistorySets(...historySets) {
    const uniqueMap = new Map();

    historySets.flat().forEach((entry) => {
        const normalized = normalizeHistoryEntry(entry);
        if (!normalized.source || !normalized.destination) return;
        const key = `${normalized.source.toLowerCase()}|${normalized.destination.toLowerCase()}|${normalized.purpose}|${normalized.priority}`;
        const existing = uniqueMap.get(key);
        if (!existing || normalized.timestamp > existing.timestamp) {
            uniqueMap.set(key, normalized);
        }
    });

    return [...uniqueMap.values()]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_HISTORY_ITEMS);
}

function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} mins`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours} hr ${mins} mins` : `${hours} hr`;
}

function formatHour(hour24) {
    const hour = hour24 % 24;
    const suffix = hour >= 12 ? "PM" : "AM";
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display}:00 ${suffix}`;
}

function getLabel(labels, key, fallback = "Unknown") {
    return labels[key] || fallback;
}

function getTrafficColor(level) {
    if (level === "High") return "#EF4444";
    if (level === "Medium") return "#F59E0B";
    return "#10B981";
}

function scoreToTrafficLevel(score) {
    if (score < 35) return "Low";
    if (score < 65) return "Medium";
    return "High";
}

function setWorkspaceState(nextState) {
    workspaceState = nextState;
    const splash = document.getElementById("workspace-splash");
    const loader = document.getElementById("workspace-loader");
    const content = document.getElementById("workspace-content");

    splash?.classList.toggle("hidden", nextState !== "splash");
    loader?.classList.toggle("hidden", nextState !== "loading");
    content?.classList.toggle("hidden", nextState !== "results");

    if (nextState === "results") {
        setTimeout(() => {
            map?.invalidateSize();
            if (routeLayer) {
                const bounds = routeLayer.getBounds?.();
                if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [40, 40] });
            }
            if (lastRouteSnapshot?.prediction?.traffic_points?.length) {
                ensureTrafficGraphRendered(lastRouteSnapshot.prediction.traffic_points);
            }
        }, 250);
    }
}

function updateOfflineBanner() {
    const banner = document.getElementById("offline-banner");
    if (!banner) return;
    banner.classList.toggle("hidden", navigator.onLine);
}

function getCurrentUserEmail() {
    try {
        return (
            localStorage.getItem(AUTH_EMAIL_KEY) ||
            sessionStorage.getItem(AUTH_EMAIL_KEY) ||
            "Secure User"
        );
    } catch (_error) {
        return "Secure User";
    }
}

function getCurrentUserRole() {
    try {
        return (
            localStorage.getItem(AUTH_ROLE_KEY) ||
            sessionStorage.getItem(AUTH_ROLE_KEY) ||
            String(decodeJwtPayload(getStoredAuthToken())?.role || "")
        )
            .trim()
            .toLowerCase();
    } catch (_error) {
        return "";
    }
}

function getCurrentUserId() {
    const email = getCurrentUserEmail();
    if (email && email !== "Secure User") return email.toLowerCase();
    return getOrCreateDeviceUserId();
}

function updateAdminControlsButton() {
    const btn = document.getElementById("admin-controls-btn");
    if (!btn) return;
    const isAdmin = getCurrentUserRole() === "admin";
    btn.classList.toggle("hidden", !isAdmin);
    if (!isAdmin) return;
    btn.onclick = () => {
        window.location.href = resolvePortalPathByRole("admin");
    };
}

function updateAuthHeader() {
    const userPill = document.getElementById("user-pill");
    if (userPill) {
        userPill.textContent = getCurrentUserEmail();
    }
    updateAdminControlsButton();
}

function logoutCurrentUser() {
    clearAuthSession();
    window.location.href = LOGIN_PAGE_PATH;
}

function computePolylineDistanceMeters(polylineCoords, toLatLng) {
    if (!map || !polylineCoords?.length) return Number.POSITIVE_INFINITY;
    let minDistance = Number.POSITIVE_INFINITY;
    polylineCoords.forEach(([lat, lon]) => {
        const pointDistance = map.distance([lat, lon], toLatLng);
        if (pointDistance < minDistance) minDistance = pointDistance;
    });
    return minDistance;
}

function initMap() {
    map = L.map("map", { zoomControl: true, scrollWheelZoom: true }).setView([14.4644, 75.9218], 11);

    const standardLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });
    const satelliteLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            attribution: "Tiles &copy; Esri",
            maxZoom: 19
        }
    );

    activeBaseLayer = standardLayer;
    standardLayer.addTo(map);
    L.control.layers(
        {
            "Standard (OSM)": standardLayer,
            "Satellite (Esri)": satelliteLayer
        },
        {},
        { position: "topright" }
    ).addTo(map);

    pathLine = L.polyline([], { color: "#2563EB", weight: 4, opacity: 0.7 }).addTo(map);
    trafficHotspotLayer = L.layerGroup().addTo(map);
    tollLayer = L.layerGroup().addTo(map);
    poiLayers.gas = L.layerGroup();
    poiLayers.charging = L.layerGroup();
    poiLayers.police = L.layerGroup();

    bindStaticListeners();
    map.on("click", handleMapClickAddStop);
    setupRouteDragSkeleton();
    initSpeechVoices();

    loadSearchHistory();
    loadCachedRealtimeData();
    updateWeatherDisplay("Clear, 28C");
    updateConnectionStatus();
    updateOfflineBanner();
    updateAuthHeader();
    updateLiveIndicators(false);
    updateFatigueUi("low", "Start monitoring to detect eye-closure and yawn patterns.");
    setWorkspaceState("splash");
    setAmbulanceUi("Ambulance priority is in standby.", "--", "--");
    renderTrafficHotspotList([]);
    renderEvStationList([]);
    renderFuelStationList([]);
    renderPoliceStationList([]);
    renderTollPlazaList([]);
    updateRouteSelectionInputs();

    const hourValue = document.getElementById("future-hour-value");
    if (hourValue) hourValue.textContent = "0";
    setTimeout(() => map.invalidateSize(), 300);
}

window.onload = initMap;

function bindStaticListeners() {
    document.getElementById("locate-btn")?.addEventListener("click", toggleLiveLocation);
    document.getElementById("logout-btn")?.addEventListener("click", logoutCurrentUser);
    document.getElementById("waypoint-mode-btn")?.addEventListener("click", toggleWaypointMode);
    document.getElementById("ambulance-mode-btn")?.addEventListener("click", toggleAmbulanceMode);
    document.getElementById("voice-btn")?.addEventListener("click", startVoiceInput);
    document.getElementById("voice-command-btn")?.addEventListener("click", startVoiceCommandStarter);
    document.getElementById("poi-gas")?.addEventListener("change", applyPoiLayerVisibility);
    document.getElementById("poi-charging")?.addEventListener("change", applyPoiLayerVisibility);
    document.getElementById("poi-police")?.addEventListener("change", applyPoiLayerVisibility);
    document.getElementById("fatigue-start-btn")?.addEventListener("click", startFatigueMonitoring);
    document.getElementById("fatigue-stop-btn")?.addEventListener("click", () => stopFatigueMonitoring());
    document.getElementById("source-location-btn")?.addEventListener("click", () => {
        void captureCurrentLocationForField("source");
    });
    document.getElementById("destination-location-btn")?.addEventListener("click", () => {
        void captureCurrentLocationForField("destination");
    });
    document.getElementById("destination-map-btn")?.addEventListener("click", toggleDestinationPickMode);
    document.getElementById("emergency-modal-close-btn")?.addEventListener("click", hideEmergencyPriorityModal);

    const sourceInput = document.getElementById("source");
    const destinationInput = document.getElementById("destination");
    if (sourceInput) {
        sourceInput.addEventListener("input", () => {
            const typed = sourceInput.value.trim().toLowerCase();
            const selected = String(sourceSelection?.label || "").trim().toLowerCase();
            if (!typed || (sourceSelection && typed !== selected)) {
                sourceSelection = null;
            }
        });
        sourceInput.addEventListener("blur", () => {
            void preResolveTypedEndpoint("source");
        });
    }
    if (destinationInput) {
        destinationInput.addEventListener("input", () => {
            const typed = destinationInput.value.trim().toLowerCase();
            const selected = String(destinationSelection?.label || "").trim().toLowerCase();
            if (!typed || (destinationSelection && typed !== selected)) {
                destinationSelection = null;
            }
        });
        destinationInput.addEventListener("blur", () => {
            void preResolveTypedEndpoint("destination");
        });
    }

    document.getElementById("future-traffic-slider")?.addEventListener("input", (event) => {
        const hoursAhead = Number(event.target.value);
        const hourValue = document.getElementById("future-hour-value");
        if (hourValue) hourValue.textContent = String(hoursAhead);
        applyFutureTrafficPrediction(hoursAhead);
    });
}

function initSpeechVoices() {
    if (!("speechSynthesis" in window)) return;
    cachedVoices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        cachedVoices = window.speechSynthesis.getVoices();
    };
}

function selectCalmVoice() {
    if (!cachedVoices.length && "speechSynthesis" in window) {
        cachedVoices = window.speechSynthesis.getVoices();
    }
    const englishVoices = cachedVoices.filter((voice) => /en/i.test(voice.lang));
    const preferredPatterns = [/Google UK English Female/i, /Samantha/i, /Microsoft Zira/i, /Female/i];
    for (const pattern of preferredPatterns) {
        const match = englishVoices.find((voice) => pattern.test(voice.name));
        if (match) return match;
    }
    return englishVoices[0] || cachedVoices[0] || null;
}

function setSpeakingPulse(active) {
    document.getElementById("locate-btn")?.classList.toggle("pulse", active);
    document.getElementById("live-badge")?.classList.toggle("pulse", active);
}

function announceRouteDetails(data) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;

    const utterance = new SpeechSynthesisUtterance(
        `Route found from ${data.source} to ${data.destination}. ` +
        `Total distance is ${data.distanceText} with a duration of ${data.durationText}. ` +
        `Traffic level is ${data.trafficLevel}.`
    );

    const voice = selectCalmVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => setSpeakingPulse(true);
    utterance.onend = () => setSpeakingPulse(false);
    utterance.onerror = () => setSpeakingPulse(false);

    setSpeakingPulse(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

async function geocode(place, options = {}) {
    const coordinateInput = parseCoordinateInput(place);
    if (coordinateInput) return coordinateInput;

    const inputPlace = String(place || "").trim();
    if (!inputPlace) throw new Error("Location is empty");

    const referenceCoords = Array.isArray(options.referenceCoords) ? options.referenceCoords : getMapCenterCoords();
    const queries = buildGeocodeSearchQueries(inputPlace);
    let bestCandidate = null;

    for (const query of queries) {
        const url = new URL(NOMINATIM_SEARCH_ENDPOINT);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "8");
        url.searchParams.set("accept-language", "en");
        url.searchParams.set("q", query);

        const results = await fetchJsonWithTimeout(url.toString(), {}, GEOCODE_FETCH_TIMEOUT_MS);
        const picked = pickBestGeocodeResult(results, inputPlace, referenceCoords);
        if (picked && (!bestCandidate || picked._score > bestCandidate._score)) {
            bestCandidate = picked;
        }
    }

    if (!bestCandidate) throw new Error(`Location "${inputPlace}" not found`);
    return [Number(bestCandidate.lat), Number(bestCandidate.lon)];
}

async function reverseGeocode(lat, lon) {
    const url = new URL(NOMINATIM_REVERSE_ENDPOINT);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const data = await fetchJsonWithTimeout(url.toString(), {}, GEOCODE_FETCH_TIMEOUT_MS);
    const label = data.display_name ? data.display_name.split(",").slice(0, 2).join(",").trim() : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    return label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function formatCoordinateLabel(coords = [], fallback = "Selected location") {
    if (!Array.isArray(coords) || coords.length !== 2) return fallback;
    const [lat, lon] = coords;
    return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

function setRouteSelection(target, coords, label, sourceType = "gps") {
    const normalized = Array.isArray(coords) && coords.length === 2
        ? [Number(coords[0]), Number(coords[1])]
        : null;
    if (!normalized || !Number.isFinite(normalized[0]) || !Number.isFinite(normalized[1])) return;

    const selection = {
        coords: normalized,
        label: String(label || formatCoordinateLabel(normalized)).trim() || formatCoordinateLabel(normalized),
        sourceType,
        updatedAt: Date.now()
    };

    if (target === "source") sourceSelection = selection;
    if (target === "destination") destinationSelection = selection;
    updateRouteSelectionInputs();
}

function clearRouteSelections() {
    sourceSelection = null;
    destinationSelection = null;
    destinationPickMode = false;
    const sourceInput = document.getElementById("source");
    const destinationInput = document.getElementById("destination");
    if (sourceInput) sourceInput.value = "";
    if (destinationInput) destinationInput.value = "";
    updateRouteSelectionInputs();
}

function updateRouteSelectionInputs() {
    const sourceInput = document.getElementById("source");
    const destinationInput = document.getElementById("destination");
    if (sourceInput && sourceSelection?.label) sourceInput.value = sourceSelection.label;
    if (destinationInput && destinationSelection?.label) destinationInput.value = destinationSelection.label;

    const destinationMapBtn = document.getElementById("destination-map-btn");
    if (destinationMapBtn) {
        destinationMapBtn.classList.toggle("active", destinationPickMode);
        destinationMapBtn.textContent = destinationPickMode ? "Tap Map to Set" : "Pick on Map";
    }
}

async function preResolveTypedEndpoint(target) {
    const input = document.getElementById(target);
    if (!input) return;

    const rawText = String(input.value || "").trim();
    if (!rawText) {
        if (target === "source") sourceSelection = null;
        if (target === "destination") destinationSelection = null;
        return;
    }

    const existingSelection = target === "source" ? sourceSelection : destinationSelection;
    const existingLabel = String(existingSelection?.label || "").trim().toLowerCase();
    if (existingSelection?.coords?.length === 2 && existingLabel === rawText.toLowerCase()) {
        return;
    }

    const parsedCoords = parseCoordinateInput(rawText);
    if (parsedCoords) {
        setRouteSelection(target, parsedCoords, formatCoordinateLabel(parsedCoords), "manual-coords");
        return;
    }

    try {
        const referenceCoords =
            target === "destination" && sourceSelection?.coords?.length === 2
                ? [Number(sourceSelection.coords[0]), Number(sourceSelection.coords[1])]
                : getMapCenterCoords();
        const resolvedCoords = await geocode(rawText, { referenceCoords });
        setRouteSelection(target, resolvedCoords, rawText, "typed-search");
    } catch (_error) {
        // Keep raw text if geocode fails. Route resolution will retry on Find Route.
    }
}

async function captureCurrentLocationForField(target) {
    if (!navigator.geolocation) {
        showAlert("Geolocation is not supported in your browser.");
        return;
    }

    const buttonId = target === "source" ? "source-location-btn" : "destination-location-btn";
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = true;
        button.textContent = "Locating...";
    }

    const coords = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve([position.coords.latitude, position.coords.longitude]),
            (error) => reject(error),
            { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 }
        );
    }).catch((error) => {
        showAlert(`Unable to access location: ${error.message}`);
        return null;
    });

    if (!coords) {
        if (button) {
            button.disabled = false;
            button.textContent = "Use My Location";
        }
        return;
    }

    let label = formatCoordinateLabel(coords);
    try {
        label = await reverseGeocode(coords[0], coords[1]);
    } catch (_error) {
        label = formatCoordinateLabel(coords);
    }

    setRouteSelection(target, coords, label, "gps");
    if (map) {
        map.setView(coords, Math.max(map.getZoom(), 13), { animate: true });
    }

    if (button) {
        button.disabled = false;
        button.textContent = "Use My Location";
    }
}

function toggleDestinationPickMode() {
    destinationPickMode = !destinationPickMode;
    updateRouteSelectionInputs();
    if (destinationPickMode) {
        showSmartAlert("Tap on map to set destination coordinate.");
    }
}

async function handleMapDestinationPick(event) {
    if (!destinationPickMode) return false;
    destinationPickMode = false;
    const { lat, lng } = event.latlng;

    let label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
        label = await reverseGeocode(lat, lng);
    } catch (_error) {
        label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    setRouteSelection("destination", [lat, lng], label, "map");
    showSmartAlert(`Destination pinned: ${label}`);
    return true;
}

function formatRouteEndpointName(selection, fallbackLabel = "Selected location") {
    if (selection?.label) return String(selection.label).trim();
    if (selection?.coords?.length === 2) return formatCoordinateLabel(selection.coords, fallbackLabel);
    return fallbackLabel;
}

async function resolveEndpointSelection(target, fallbackInput = "", referenceCoords = null) {
    const selection = target === "source" ? sourceSelection : destinationSelection;
    const rawText = String(fallbackInput || "").trim();
    const selectionLabel = String(selection?.label || "").trim().toLowerCase();
    const typedLabel = rawText.toLowerCase();

    if (selection?.coords?.length === 2) {
        if (!rawText || typedLabel === selectionLabel) {
            return {
                coords: [Number(selection.coords[0]), Number(selection.coords[1])],
                label: formatRouteEndpointName(selection, target === "source" ? "Source" : "Destination")
            };
        }
    }

    if (!rawText) {
        throw new Error(`Set ${target} using address text, lat,lng coordinates, "Use My Location", or map pin before finding route.`);
    }

    const parsedCoords = parseCoordinateInput(rawText);
    if (parsedCoords) {
        const label = formatCoordinateLabel(parsedCoords);
        setRouteSelection(target, parsedCoords, label, "manual-coords");
        return {
            coords: parsedCoords,
            label
        };
    }

    const resolvedCoords = await geocode(rawText, { referenceCoords });
    setRouteSelection(target, resolvedCoords, rawText, "search");
    return {
        coords: resolvedCoords,
        label: rawText
    };
}

function normalizeRouteMode(type = "default") {
    const value = String(type || "default").trim().toLowerCase();
    if (value === "best") return "fastest";
    if (value === "fuel") return "eco";
    if (["default", "shortest", "fastest", "eco"].includes(value)) return value;
    return "default";
}

function chooseRouteByContext(routes, type, purpose, priority) {
    if (type === "shortest") return routes.reduce((a, b) => (a.distance < b.distance ? a : b));
    if (type === "best" || type === "fastest") return routes.reduce((a, b) => (a.duration < b.duration ? a : b));
    if (type === "fuel" || type === "eco") {
        return routes.reduce((a, b) => (a.distance / Math.max(a.duration, 1)) < (b.distance / Math.max(b.duration, 1)) ? a : b);
    }

    const isEmergency = purpose === "hospital" || priority === "emergency";
    if (isEmergency || priority === "urgent") return routes.reduce((a, b) => (a.duration < b.duration ? a : b));

    if (purpose === "school" || purpose === "office" || purpose === "airport" || priority === "important") {
        return routes.reduce((a, b) => ((a.duration * 0.75) + (a.distance * 0.25)) < ((b.duration * 0.75) + (b.distance * 0.25)) ? a : b);
    }

    if (purpose === "temple" || purpose === "tourism") {
        return routes.reduce((a, b) => ((a.duration * 0.55) + (a.distance * 0.45)) < ((b.duration * 0.55) + (b.distance * 0.45)) ? a : b);
    }

    return routes[0];
}

function buildRouteSignature(route = {}) {
    const coords = route.geometry?.coordinates || [];
    if (!coords.length) {
        return `empty|${Math.round(Number(route.distance || 0))}|${Math.round(Number(route.duration || 0))}`;
    }
    const first = coords[0] || [];
    const mid = coords[Math.floor(coords.length / 2)] || [];
    const last = coords[coords.length - 1] || [];
    const signatureCoords = [first, mid, last]
        .map((pair) => `${Number(pair[0] || 0).toFixed(4)},${Number(pair[1] || 0).toFixed(4)}`)
        .join("|");
    return `${Math.round(Number(route.distance || 0))}|${Math.round(Number(route.duration || 0))}|${signatureCoords}`;
}

function dedupeRoutes(routes = []) {
    const unique = [];
    const seen = new Set();

    routes.forEach((route) => {
        if (!route?.geometry?.coordinates?.length) return;
        const signature = buildRouteSignature(route);
        if (seen.has(signature)) return;
        seen.add(signature);
        unique.push(route);
    });

    return unique;
}

function buildOsrmRouteUrl(routePoints, alternatives = true) {
    const routeCoordinates = routePoints.map(([lat, lon]) => `${lon},${lat}`).join(";");
    const routeUrl = new URL(`${OSRM_ROUTE_BASE}/${routeCoordinates}`);
    routeUrl.searchParams.set("overview", "full");
    routeUrl.searchParams.set("geometries", "geojson");
    routeUrl.searchParams.set("alternatives", alternatives ? "true" : "false");
    routeUrl.searchParams.set("steps", "true");
    routeUrl.searchParams.set("annotations", "distance,duration,speed");
    routeUrl.searchParams.set("continue_straight", "true");
    return routeUrl;
}

async function fetchRoutesFromOsrm(routePoints, alternatives = true) {
    const routeUrl = buildOsrmRouteUrl(routePoints, alternatives);
    const routeRes = await fetch(routeUrl.toString());
    if (!routeRes.ok) throw new Error(`Routing API error: ${routeRes.status}`);

    const routeData = await routeRes.json();
    if (routeData.code && routeData.code !== "Ok") {
        throw new Error(`Routing failed: ${routeData.message || routeData.code}`);
    }
    if (!routeData.routes?.length) throw new Error("No route found between these locations");

    return routeData.routes;
}

function buildAlternativeViaCandidates(routePoints, baseRoute) {
    if (!routePoints?.length || !baseRoute?.geometry?.coordinates?.length) return [];

    const source = routePoints[0];
    const destination = routePoints[routePoints.length - 1];
    const geometry = baseRoute.geometry.coordinates;
    const anchors = [];
    const geometryRatios = [0.2, 0.35, 0.5, 0.65, 0.8];

    geometryRatios.forEach((ratio) => {
        const idx = clamp(Math.floor(ratio * (geometry.length - 1)), 0, geometry.length - 1);
        anchors.push({
            coord: geometry[idx],
            prev: geometry[Math.max(0, idx - 12)] || geometry[idx],
            next: geometry[Math.min(geometry.length - 1, idx + 12)] || geometry[idx]
        });
    });

    const directRatios = [0.25, 0.5, 0.75];
    directRatios.forEach((ratio) => {
        const lat = source[0] + (destination[0] - source[0]) * ratio;
        const lon = source[1] + (destination[1] - source[1]) * ratio;
        const prev = [lon - (destination[1] - source[1]) * 0.05, lat - (destination[0] - source[0]) * 0.05];
        const next = [lon + (destination[1] - source[1]) * 0.05, lat + (destination[0] - source[0]) * 0.05];
        anchors.push({ coord: [lon, lat], prev, next });
    });

    const candidates = [];
    const seen = new Set();
    const kmOffsets = [2.5, 4.5, 7.5, 10.5];
    const forwardOffsets = [0, 1.8];

    anchors.forEach(({ coord, prev, next }, anchorIndex) => {
        const anchorLat = Number(coord?.[1] || source[0] || 0);
        const anchorLon = Number(coord?.[0] || source[1] || 0);
        let tangentLon = Number(next?.[0] || 0) - Number(prev?.[0] || 0);
        let tangentLat = Number(next?.[1] || 0) - Number(prev?.[1] || 0);
        const tangentLength = Math.hypot(tangentLon, tangentLat) || 1;
        tangentLon /= tangentLength;
        tangentLat /= tangentLength;

        const perpendicularLon = -tangentLat;
        const perpendicularLat = tangentLon;
        const degreesPerKmLat = 1 / 111;
        const degreesPerKmLon = 1 / (111 * Math.max(Math.abs(Math.cos(toRadians(anchorLat))), 0.2));

        kmOffsets.forEach((km, offsetIndex) => {
            [-1, 1].forEach((direction) => {
                forwardOffsets.forEach((forwardKm) => {
                    const lat = clamp(
                        anchorLat +
                            (perpendicularLat * direction * km * degreesPerKmLat) +
                            (tangentLat * forwardKm * degreesPerKmLat),
                        -89.8,
                        89.8
                    );
                    const lon = clamp(
                        anchorLon +
                            (perpendicularLon * direction * km * degreesPerKmLon) +
                            (tangentLon * forwardKm * degreesPerKmLon),
                        -179.8,
                        179.8
                    );
                    const candidate = [lat, lon];
                    if (haversineDistanceKm(candidate, source) < 2.2 || haversineDistanceKm(candidate, destination) < 2.2) return;
                    const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${anchorIndex}|${offsetIndex}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    candidates.push(candidate);
                });
            });
        });
    });

    return candidates;
}

async function loadRouteAlternatives(routePoints, viaStops = []) {
    let routes = dedupeRoutes(await fetchRoutesFromOsrm(routePoints, true));
    if (routes.length >= 3 || viaStops.length > 0 || routePoints.length !== 2) return routes;

    const source = routePoints[0];
    const destination = routePoints[routePoints.length - 1];
    const candidates = buildAlternativeViaCandidates(routePoints, routes[0]);
    const MAX_PROBES = 28;
    let probeCount = 0;

    for (const viaCandidate of candidates) {
        if (routes.length >= 3 || probeCount >= MAX_PROBES) break;
        probeCount += 1;
        try {
            const altRoutes = await fetchRoutesFromOsrm([source, viaCandidate, destination], false);
            routes = dedupeRoutes([...routes, ...altRoutes]);
        } catch (error) {
            console.info("Alternative corridor probe skipped:", error.message);
        }
    }

    return routes;
}

function buildRouteVariants(routes) {
    const pool = dedupeRoutes(routes);
    if (!pool.length) throw new Error("No route variants available.");

    const pickVariant = (sortFn, usedSignatures) => {
        const sorted = [...pool].sort(sortFn);
        const distinct = sorted.find((route) => !usedSignatures.has(buildRouteSignature(route)));
        const picked = distinct || sorted[0];
        usedSignatures.add(buildRouteSignature(picked));
        return picked;
    };

    const usedSignatures = new Set();
    const fastest = pickVariant((a, b) => a.duration - b.duration, usedSignatures);
    const shortest = pickVariant((a, b) => a.distance - b.distance, usedSignatures);
    const eco = pickVariant(
        (a, b) => (a.distance / Math.max(a.duration, 1)) - (b.distance / Math.max(b.duration, 1)),
        usedSignatures
    );

    return {
        shortest: { key: "shortest", label: "Shortest", route: shortest },
        fastest: { key: "fastest", label: "Fastest", route: fastest },
        eco: { key: "eco", label: "Eco", route: eco },
        availableRoutes: pool
    };
}

function ensureDistinctRouteVariants(routeVariants) {
    const variants = ["fastest", "shortest", "eco"];
    const baseRoute =
        routeVariants?.fastest?.route ||
        routeVariants?.shortest?.route ||
        routeVariants?.eco?.route;
    if (!baseRoute?.geometry?.coordinates?.length) return routeVariants;

    variants.forEach((key) => {
        let variant = routeVariants[key];
        if (!variant?.route?.geometry?.coordinates?.length) {
            routeVariants[key] = {
                key,
                label: key === "fastest" ? "Fastest" : key === "shortest" ? "Shortest" : "Eco",
                route: baseRoute
            };
        }
    });

    routeVariants.availableRoutes = dedupeRoutes([
        routeVariants.fastest.route,
        routeVariants.shortest.route,
        routeVariants.eco.route,
        ...(routeVariants.availableRoutes || [])
    ]);
    return routeVariants;
}

function getSelectedVariantKey(route, routeVariants) {
    const signature = buildRouteSignature(route);
    if (signature === buildRouteSignature(routeVariants.shortest.route)) return "shortest";
    if (signature === buildRouteSignature(routeVariants.fastest.route)) return "fastest";
    if (signature === buildRouteSignature(routeVariants.eco.route)) return "eco";
    return "recommended";
}

function resolveSelectedRoute(type, routes, routeVariants, purpose, priority) {
    if (type === "shortest") return routeVariants.shortest.route;
    if (type === "best" || type === "fastest") return routeVariants.fastest.route;
    if (type === "fuel" || type === "eco") return routeVariants.eco.route;
    return chooseRouteByContext(routes, type, purpose, priority);
}

async function findRoute(type = "default") {
    if (!map) {
        showAlert("Map is still loading. Please wait a moment.");
        return;
    }

    const normalizedType = normalizeRouteMode(type);
    const sourceInputValue = document.getElementById("source")?.value?.trim() || "";
    const destinationInputValue = document.getElementById("destination")?.value?.trim() || "";
    const viaInput = document.getElementById("via-points");
    const viaStops = viaInput ? viaInput.value.split(",").map((stop) => stop.trim()).filter(Boolean) : [];
    const purpose = document.getElementById("trip-purpose")?.value || "personal";
    const priority = document.getElementById("trip-priority")?.value || "normal";
    const hour = Number(document.getElementById("travel-hour").value);
    const day = document.getElementById("travel-day").value;
    const vehicle = document.getElementById("vehicle-type").value;

    if (!sourceInputValue && !sourceSelection) {
        return showAlert('Set source using text address, lat,lng, or "Use My Location" before finding route.');
    }
    if (!destinationInputValue && !destinationSelection) {
        return showAlert('Set destination using text address, lat,lng, "Use My Location", or "Pick on Map" before finding route.');
    }
    if (viaStops.length > 5) return showAlert("Please use up to 5 via stops");

    const findBtn = document.getElementById("find-btn");
    const originalText = findBtn.textContent;
    setWorkspaceState("loading");
    findBtn.textContent = "Finding Route...";
    findBtn.classList.add("loading");
    findBtn.disabled = true;

    let source = sourceInputValue || "Source";
    let destination = destinationInputValue || "Destination";

    try {
        const sourceResolved = await resolveEndpointSelection("source", sourceInputValue, getMapCenterCoords());
        const destinationResolved = await resolveEndpointSelection(
            "destination",
            destinationInputValue,
            sourceResolved.coords
        );
        const srcCoords = sourceResolved.coords;
        const destCoords = destinationResolved.coords;
        source = sourceResolved.label;
        destination = destinationResolved.label;

        const routePoints = [srcCoords];
        const viaCoords = [];
        let referenceCoords = srcCoords;
        for (const stop of viaStops) {
            const coords = await geocode(stop, { referenceCoords });
            viaCoords.push(coords);
            routePoints.push(coords);
            referenceCoords = coords;
        }
        routePoints.push(destCoords);

        const osrmRoutes = await loadRouteAlternatives(routePoints, viaStops);
        if (!osrmRoutes.length) throw new Error("No route found between these locations");

        const routeVariants = ensureDistinctRouteVariants(buildRouteVariants(osrmRoutes));
        const selectedRoute = resolveSelectedRoute(normalizedType, osrmRoutes, routeVariants, purpose, priority);
        selectedRouteGeometry = selectedRoute.geometry;
        selectedRouteCoordinates = selectedRoute.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        const selectedVariantKey =
            normalizedType === "eco" ? "eco" :
            normalizedType === "fastest" ? "fastest" :
            normalizedType === "shortest" ? "shortest" :
            getSelectedVariantKey(selectedRoute, routeVariants);
        selectedRouteKey = selectedVariantKey;
        routeDisplayMode = normalizedType === "default" ? "all" : "single";
        const distanceKm = selectedRoute.distance / 1000;
        const durationMins = Math.max(1, Math.round(selectedRoute.duration / 60));
        const prediction = await getTrafficPrediction(hour, day, distanceKm, durationMins, vehicle, purpose, priority);
        const weatherSnapshot = await getRouteWeatherSnapshot(selectedRoute.geometry.coordinates, hour);
        prediction.weather = weatherSnapshot.label;
        prediction.weather_source = weatherSnapshot.source;
        prediction.vehicle = vehicle;
        const nextSnapshot = {
            source,
            destination,
            prediction,
            distanceKm,
            durationMins,
            purpose,
            priority,
            routeCoordinates: selectedRoute.geometry.coordinates,
            selectedVariantKey
        };
        lastRouteSnapshot = nextSnapshot;

        drawRouteOnMap(routeVariants, selectedVariantKey, prediction, routeDisplayMode);
        clearDraftWaypointMarkers();
        addRouteMarkers(srcCoords, destCoords, source, destination, viaCoords, viaStops);
        await refreshEvStations(selectedRoute.geometry.coordinates, prediction);
        setWorkspaceState("results");

        updateResultsUI({
            source, destination, viaStops, purpose, priority, vehicle, routeMode: normalizedType,
            distanceKm, durationMins, prediction, routeVariants, selectedVariantKey
        });
        syncFatigueTripContext(distanceKm, durationMins, prediction.congestion_level);
        refreshTrafficHotspots(selectedRoute.geometry.coordinates, prediction);
        refreshTollPlazas(selectedRoute.geometry.coordinates, distanceKm, vehicle, prediction);
        saveCachedRealtimeData();
        if (ambulanceModeActive) {
            restartAmbulanceSimulation();
        }

        cacheOfflineRoute({
            source,
            destination,
            viaStops,
            srcCoords,
            destCoords,
            viaCoords,
            routes: osrmRoutes,
            hour,
            day,
            vehicle,
            purpose,
            priority,
            selectedVariantKey,
            timestamp: Date.now()
        });

        saveToHistory(source, destination, purpose, priority, {
            routeMode: normalizedType,
            distanceKm,
            durationMins
        });
        focusMapSection();
        announceRouteDetails({
            source,
            destination,
            distanceText: formatDistance(distanceKm),
            durationText: formatDuration(durationMins),
            trafficLevel: prediction.congestion_level
        });

        const slider = document.getElementById("future-traffic-slider");
        if (slider) applyFutureTrafficPrediction(Number(slider.value || "0"));
        scheduleSmartAlert(nextSnapshot);
        startRealtimeDataLoop();
    } catch (error) {
        console.error("Route Error:", error);
        const cached = getOfflineRoute(source, destination);
        if (cached) {
            try {
                await renderRouteFromOfflineCache(cached, normalizedType);
                setWorkspaceState("results");
                showSmartAlert("Offline route loaded from cache.");
            } catch (cacheError) {
                console.error("Offline cache fallback error:", cacheError);
                setWorkspaceState("splash");
                showAlert("Error: " + error.message);
            }
        } else {
            setWorkspaceState("splash");
            showAlert("Error: " + error.message);
        }
    } finally {
        findBtn.textContent = originalText;
        findBtn.classList.remove("loading");
        findBtn.disabled = false;
    }
}

function drawRouteOnMap(routeVariants, selectedVariantKey, prediction, displayMode = "all") {
    routeLayers.forEach((layer) => map.removeLayer(layer));
    routeLayers = [];
    routeLayerMeta = [];
    routeLayer = null;

    const styleMap = {
        fastest: { color: "#2563EB", label: "Fastest" },
        shortest: { color: "#6B7280", label: "Shortest" },
        eco: { color: "#10B981", label: "Eco" }
    };
    const fastestMins = Math.round(routeVariants.fastest.route.duration / 60);
    const preferredVariant = routeVariants[selectedVariantKey] || routeVariants.fastest;
    const variantsToRender =
        displayMode === "single"
            ? [preferredVariant]
            : [routeVariants.fastest, routeVariants.shortest, routeVariants.eco];
    const renderedSignatures = new Set();

    variantsToRender.forEach((variant) => {
        if (!variant?.route?.geometry?.coordinates?.length) return;
        const signature = buildRouteSignature(variant.route);
        if (renderedSignatures.has(signature)) return;
        renderedSignatures.add(signature);

        const style = styleMap[variant.key] || { color: "#4F46E5", label: variant.label };
        const isSelected =
            variant.key === selectedVariantKey ||
            buildRouteSignature(preferredVariant.route) === signature;
        const delay = Math.max(0, Math.round(variant.route.duration / 60) - fastestMins);
        const tooltipText = `${style.label} route | Traffic: ${prediction.congestion_level} | Delay: ${delay} mins`;

        const layer = L.geoJSON(variant.route.geometry, {
            style: {
                color: style.color,
                weight: isSelected ? 7 : 4,
                opacity: isSelected ? 0.96 : 0.6,
                dashArray: isSelected ? null : "8 7"
            }
        }).addTo(map);

        layer.eachLayer((segment) => {
            segment.bindTooltip(tooltipText, { sticky: true, opacity: 0.95 });
            segment.on("mouseover", () => segment.openTooltip());
            segment.on("mouseout", () => segment.closeTooltip());
        });

        routeLayers.push(layer);
        routeLayerMeta.push({
            key: variant.key,
            label: style.label,
            delay,
            distanceKm: variant.route.distance / 1000,
            durationMins: Math.round(variant.route.duration / 60)
        });
        if (isSelected) routeLayer = layer;
    });

    if (!routeLayer && routeLayers.length) routeLayer = routeLayers[0];

    const bounds = routeLayer?.getBounds?.() || routeLayers[0]?.getBounds?.();
    if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [50, 50] });
}

function focusMapSection() {
    const mapSection = document.querySelector(".map-section");
    if (!mapSection) return;

    mapSection.scrollIntoView({ behavior: "smooth", block: "start" });
    mapSection.classList.remove("map-highlight");
    void mapSection.offsetWidth;
    mapSection.classList.add("map-highlight");

    setTimeout(() => {
        if (!map) return;
        map.invalidateSize();
        if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
    }, 650);

    setTimeout(() => mapSection.classList.remove("map-highlight"), 1300);
}

function clearRouteMarkers() {
    if (sourceMarker) {
        map.removeLayer(sourceMarker);
        sourceMarker = null;
    }
    if (destMarker) {
        map.removeLayer(destMarker);
        destMarker = null;
    }
    viaMarkers.forEach((marker) => map.removeLayer(marker));
    viaMarkers = [];
}

function clearDraftWaypointMarkers() {
    draftWaypointMarkers.forEach((marker) => map.removeLayer(marker));
    draftWaypointMarkers = [];
}

function addRouteMarkers(srcCoords, destCoords, srcName, destName, viaCoords = [], viaNames = []) {
    clearRouteMarkers();

    const startIcon = L.divIcon({
        className: "custom-marker",
        html: '<div style="background:#10B981;width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:15px;">&#x1F6A9;</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    const endIcon = L.divIcon({
        className: "custom-marker",
        html: '<div style="background:#EF4444;width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:15px;">&#x1F3C1;</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    const viaIcon = (index) => L.divIcon({
        className: "custom-marker",
        html: `<div style="background:#F59E0B;width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.2);color:white;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">${index + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    sourceMarker = L.marker(srcCoords, { icon: startIcon }).addTo(map).bindPopup(`<strong>Start:</strong> ${srcName}`).bindTooltip(`Start: ${srcName}`, { direction: "top" });
    sourceMarker.on("mouseover", () => sourceMarker.openTooltip());
    viaCoords.forEach((coords, index) => {
        const marker = L.marker(coords, { icon: viaIcon(index) })
            .addTo(map)
            .bindPopup(`<strong>Via ${index + 1}:</strong> ${viaNames[index] || "Stop"}`)
            .bindTooltip(`Via ${index + 1}: ${viaNames[index] || "Stop"}`, { direction: "top" });
        marker.on("mouseover", () => marker.openTooltip());
        viaMarkers.push(marker);
    });
    destMarker = L.marker(destCoords, { icon: endIcon }).addTo(map).bindPopup(`<strong>Destination:</strong> ${destName}`).bindTooltip(`Destination: ${destName}`, { direction: "top" });
    destMarker.on("mouseover", () => destMarker.openTooltip());
}

function toggleWaypointMode() {
    waypointAddMode = !waypointAddMode;
    const btn = document.getElementById("waypoint-mode-btn");
    if (!btn) return;
    btn.classList.toggle("active", waypointAddMode);
    btn.textContent = `Add Stop Mode: ${waypointAddMode ? "On" : "Off"}`;
}

async function handleMapClickAddStop(event) {
    const pickedDestination = await handleMapDestinationPick(event);
    if (pickedDestination) return;

    if (!waypointAddMode) return;

    const viaInput = document.getElementById("via-points");
    if (!viaInput) return;

    const currentStops = viaInput.value.split(",").map((stop) => stop.trim()).filter(Boolean);
    if (currentStops.length >= 5) {
        showAlert("Maximum 5 via stops supported.");
        return;
    }

    const { lat, lng } = event.latlng;
    let stopName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try {
        stopName = await reverseGeocode(lat, lng);
    } catch (error) {
        console.warn("Reverse geocode fallback:", error.message);
    }
    const normalizedStopName = stopName.split(",")[0].trim() || stopName;

    viaInput.value = [...currentStops, normalizedStopName].join(", ");

    const draftIcon = L.divIcon({
        className: "custom-marker",
        html: '<div style="background:#334155;width:22px;height:22px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });

    const marker = L.marker([lat, lng], { icon: draftIcon }).addTo(map).bindPopup(`Stop added: ${normalizedStopName}`).openPopup();
    draftWaypointMarkers.push(marker);
    showSmartAlert(`Waypoint added: ${normalizedStopName}. Click Find Route to recalculate.`);
}

function makePoiIcon(label, bg) {
    return L.divIcon({
        className: "poi-marker",
        html: `<div style="background:${bg};color:#fff;padding:4px 6px;border-radius:10px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);font-size:10px;font-weight:700;">${label}</div>`,
        iconSize: [26, 22],
        iconAnchor: [13, 11]
    });
}

function pickRouteSamplePoints(routeCoordinates, count = 3) {
    if (!routeCoordinates.length) return [];
    const points = [];
    for (let i = 1; i <= count; i += 1) {
        const ratio = i / (count + 1);
        points.push(routeCoordinates[Math.floor(ratio * (routeCoordinates.length - 1))]);
    }
    return points;
}

function computeRouteDistanceKm(routeCoordinates = []) {
    if (!routeCoordinates?.length || routeCoordinates.length < 2) return 0;
    let total = 0;
    for (let index = 1; index < routeCoordinates.length; index += 1) {
        const [prevLon, prevLat] = routeCoordinates[index - 1];
        const [nextLon, nextLat] = routeCoordinates[index];
        total += haversineDistanceKm([prevLat, prevLon], [nextLat, nextLon]);
    }
    return total;
}

function sampleRouteForPoiQuery(routeCoordinates = [], maxSamples = 16) {
    const points = routeCoordinates
        .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
        .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    if (!points.length) return [];
    if (points.length <= 3) return points;

    const routeDistanceKm = computeRouteDistanceKm(points);
    const desiredSamples = Math.max(8, Math.min(maxSamples, Math.round(routeDistanceKm / 13) + 7));
    const sampled = [];
    const seenIndexes = new Set();

    for (let index = 0; index < desiredSamples; index += 1) {
        const routeIndex = Math.round((index * (points.length - 1)) / Math.max(desiredSamples - 1, 1));
        if (seenIndexes.has(routeIndex)) continue;
        seenIndexes.add(routeIndex);
        sampled.push(points[routeIndex]);
    }

    return sampled;
}

function pointToSegmentDistanceMeters(pointLat, pointLon, startLat, startLon, endLat, endLon) {
    const earthRadius = 6371000;
    const scale = Math.cos(toRadians(pointLat));

    const startX = toRadians(startLon - pointLon) * earthRadius * scale;
    const startY = toRadians(startLat - pointLat) * earthRadius;
    const endX = toRadians(endLon - pointLon) * earthRadius * scale;
    const endY = toRadians(endLat - pointLat) * earthRadius;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSq = (segmentX * segmentX) + (segmentY * segmentY);

    if (segmentLengthSq <= 0.000001) {
        return Math.hypot(startX, startY);
    }

    const projected = clamp(
        -((startX * segmentX) + (startY * segmentY)) / segmentLengthSq,
        0,
        1
    );
    const closestX = startX + (projected * segmentX);
    const closestY = startY + (projected * segmentY);
    return Math.hypot(closestX, closestY);
}

function computeDistanceToRouteMeters(routeCoordinates = [], pointLat, pointLon) {
    if (!routeCoordinates.length) return Number.POSITIVE_INFINITY;

    const normalizedRoute = routeCoordinates
        .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
        .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));

    if (!normalizedRoute.length) return Number.POSITIVE_INFINITY;
    if (normalizedRoute.length === 1) {
        return haversineDistanceKm([normalizedRoute[0][1], normalizedRoute[0][0]], [pointLat, pointLon]) * 1000;
    }

    let minDistance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < normalizedRoute.length; index += 1) {
        const [startLon, startLat] = normalizedRoute[index - 1];
        const [endLon, endLat] = normalizedRoute[index];
        const distance = pointToSegmentDistanceMeters(
            pointLat,
            pointLon,
            startLat,
            startLon,
            endLat,
            endLon
        );
        if (distance < minDistance) minDistance = distance;
    }

    return Number.isFinite(minDistance) ? minDistance : Number.POSITIVE_INFINITY;
}

function buildRouteBoundingBox(routeCoordinates = []) {
    const lats = routeCoordinates.map((point) => Number(point?.[1])).filter(Number.isFinite);
    const lons = routeCoordinates.map((point) => Number(point?.[0])).filter(Number.isFinite);
    if (!lats.length || !lons.length) return null;

    const paddingDegrees = Math.max(0.008, (POI_QUERY_RADIUS_METERS / 111000) + 0.004);
    const latPadding = paddingDegrees;
    const lonPadding = paddingDegrees * 1.2;
    return {
        south: Math.max(-89.9, Math.min(...lats) - latPadding),
        west: Math.max(-179.9, Math.min(...lons) - lonPadding),
        north: Math.min(89.9, Math.max(...lats) + latPadding),
        east: Math.min(179.9, Math.max(...lons) + lonPadding)
    };
}

function buildOverpassRoutePoiQuery(routeCoordinates = [], radiusMeters = POI_QUERY_RADIUS_METERS) {
    const sampledPoints = sampleRouteForPoiQuery(routeCoordinates, 12);
    if (!sampledPoints.length) return "";

    const radius = Math.max(300, Math.min(5000, Math.round(radiusMeters)));
    const selectors = [
        '["amenity"="charging_station"]',
        '["amenity"="fuel"]',
        '["amenity"="gas_station"]',
        '["shop"="fuel"]',
        '["amenity"="police"]',
        '["office"="police"]'
    ];
    const clauses = [];

    sampledPoints.forEach(([lon, lat]) => {
        selectors.forEach((selector) => {
            clauses.push(`  nwr${selector}(around:${radius},${lat},${lon});`);
        });
    });

    return `
[out:json][timeout:35];
(
${clauses.join("\n")}
);
out center tags;
`;
}

function buildOverpassBoundingBoxPoiQuery(bbox) {
    const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    return `
[out:json][timeout:25];
(
  nwr["amenity"="charging_station"](${box});
  nwr["amenity"="fuel"](${box});
  nwr["amenity"="gas_station"](${box});
  nwr["shop"="fuel"](${box});
  nwr["amenity"="police"](${box});
  nwr["office"="police"](${box});
);
out center tags;
`;
}

async function fetchOverpassWithFallback(query, timeoutMs = POI_QUERY_TIMEOUT_MS) {
    if (!String(query || "").trim()) return [];

    let lastError = null;
    const encodedBody = `data=${encodeURIComponent(query)}`;

    for (const endpoint of OVERPASS_API_FALLBACK_ENDPOINTS) {
        try {
            const response = await fetchJsonWithTimeout(
                endpoint,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                    },
                    body: encodedBody
                },
                timeoutMs
            );

            if (!Array.isArray(response?.elements)) {
                throw new Error("Invalid Overpass payload");
            }
            return response.elements;
        } catch (error) {
            lastError = error;
            console.info(`Overpass endpoint failed (${endpoint}):`, error.message);
        }
    }

    if (lastError) throw lastError;
    return [];
}

function buildPoiDataStatus(tags = {}) {
    const operator = String(tags.operator || tags.brand || "").trim();
    const opening = String(tags.opening_hours || "").trim();
    const statusParts = [];

    if (operator) statusParts.push(`Operator: ${operator}`);
    if (opening) statusParts.push(`Hours: ${opening}`);

    const status = statusParts.join(" | ");
    if (!status) return "Source: OpenStreetMap";
    if (status.length <= 80) return status;
    return `${status.slice(0, 77)}...`;
}

function buildAroundViewbox(lat, lon, radiusMeters = 2600) {
    const deltaLat = radiusMeters / 111000;
    const cosLat = Math.max(Math.abs(Math.cos(toRadians(lat))), 0.2);
    const deltaLon = radiusMeters / (111000 * cosLat);
    const left = lon - deltaLon;
    const right = lon + deltaLon;
    const top = lat + deltaLat;
    const bottom = lat - deltaLat;
    return `${left},${top},${right},${bottom}`;
}

function parseNominatimPoiResult(candidate, category) {
    const lat = Number(candidate?.lat);
    const lon = Number(candidate?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const displayName = String(candidate?.display_name || "").trim();
    const primaryName = String(candidate?.name || "").trim() || displayName.split(",")[0].trim();
    const type = String(candidate?.type || "").replaceAll("_", " ").trim();
    const name = primaryName || (category === "ev" ? "Charging Station" : "Fuel Station");

    return {
        id: `nominatim-${category}-${candidate?.place_id || `${lat.toFixed(5)}-${lon.toFixed(5)}`}`,
        category,
        lat,
        lon,
        name,
        dataStatus: type ? `Source: Nominatim (${type})` : "Source: Nominatim",
        tags: {}
    };
}

async function fetchNominatimPoisForCategory(routeCoordinates = [], category = "fuel") {
    const sampledPoints = sampleRouteForPoiQuery(routeCoordinates, 5);
    if (!sampledPoints.length) return [];

    const queries = category === "ev"
        ? ["EV charging station", "electric vehicle charging station"]
        : ["fuel station", "gas station", "petrol pump"];

    const collected = [];
    for (const [lon, lat] of sampledPoints) {
        for (const query of queries) {
            try {
                const url = new URL(NOMINATIM_SEARCH_ENDPOINT);
                url.searchParams.set("format", "jsonv2");
                url.searchParams.set("addressdetails", "1");
                url.searchParams.set("limit", "4");
                url.searchParams.set("accept-language", "en");
                url.searchParams.set("q", query);
                url.searchParams.set("bounded", "1");
                url.searchParams.set("viewbox", buildAroundViewbox(lat, lon, POI_QUERY_RADIUS_METERS + 600));

                const results = await fetchJsonWithTimeout(url.toString(), {}, GEOCODE_FETCH_TIMEOUT_MS);
                (Array.isArray(results) ? results : []).forEach((candidate) => {
                    const parsed = parseNominatimPoiResult(candidate, category);
                    if (parsed) collected.push(parsed);
                });
            } catch (error) {
                console.info(`Nominatim ${category} lookup failed:`, error.message);
            }
            await delay(90);
        }
    }

    return collected;
}

function parseOverpassElement(element = {}) {
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const tags = element.tags || {};
    const amenity = String(tags.amenity || "").toLowerCase();
    const office = String(tags.office || "").toLowerCase();
    const shop = String(tags.shop || "").toLowerCase();

    let category = "";
    if (amenity === "charging_station") category = "ev";
    else if (amenity === "fuel" || amenity === "gas_station" || shop === "fuel") category = "fuel";
    else if (amenity === "police" || office === "police") category = "police";
    if (!category) return null;

    const name = String(tags.name || "").trim();
    return {
        id: `${element.type || "node"}-${element.id || `${lat.toFixed(5)}-${lon.toFixed(5)}`}`,
        category,
        lat,
        lon,
        name: name || (category === "ev" ? "Charging Station" : category === "fuel" ? "Fuel Station" : "Police Station"),
        dataStatus: buildPoiDataStatus(tags),
        tags
    };
}

async function fetchRoutePoisFromOverpass(routeCoordinates = []) {
    const grouped = { ev: [], fuel: [], police: [] };
    let elements = [];

    const routeQuery = buildOverpassRoutePoiQuery(routeCoordinates, POI_QUERY_RADIUS_METERS);
    if (routeQuery) {
        try {
            elements = await fetchOverpassWithFallback(routeQuery, POI_QUERY_TIMEOUT_MS);
        } catch (error) {
            console.info("POI corridor query failed, switching to bbox fallback:", error.message);
        }
    }

    if (!elements.length) {
        const bbox = buildRouteBoundingBox(routeCoordinates);
        if (bbox) {
            try {
                const fallbackQuery = buildOverpassBoundingBoxPoiQuery(bbox);
                elements = await fetchOverpassWithFallback(fallbackQuery, POI_QUERY_TIMEOUT_MS);
            } catch (error) {
                console.info("POI bbox query failed, switching to Nominatim fallback:", error.message);
            }
        }
    }

    if (!elements.length) {
        const [evFallback, fuelFallback] = await Promise.all([
            fetchNominatimPoisForCategory(routeCoordinates, "ev"),
            fetchNominatimPoisForCategory(routeCoordinates, "fuel")
        ]);
        grouped.ev.push(...evFallback);
        grouped.fuel.push(...fuelFallback);
        return grouped;
    }

    elements.forEach((element) => {
        const parsed = parseOverpassElement(element);
        if (!parsed) return;
        grouped[parsed.category].push(parsed);
    });

    return grouped;
}

function dedupePoiRecords(records = []) {
    const seen = new Set();
    const output = [];
    records.forEach((record) => {
        const normalizedName = String(record.name || "").trim().toLowerCase();
        const locationKey = `${Number(record.lat).toFixed(5)}|${Number(record.lon).toFixed(5)}`;
        const key = normalizedName
            ? `${record.category}|${normalizedName}|${locationKey}`
            : `${record.category}|${locationKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push(record);
    });
    return output;
}

function buildPoiRecord(record, routeCoordinates) {
    const distanceToRouteMeters = computeDistanceToRouteMeters(routeCoordinates, record.lat, record.lon);
    return {
        ...record,
        distanceToRouteMeters: Math.round(distanceToRouteMeters),
        dataStatus: record.dataStatus || "Source: OpenStreetMap"
    };
}

function renderEvStationList(stations) {
    const list = document.getElementById("ev-list");
    if (!list) return;
    list.innerHTML = "";
    if (!stations.length) {
        const li = document.createElement("li");
        li.textContent = "No stations found on this route.";
        list.appendChild(li);
        return;
    }

    stations.forEach((station) => {
        const li = document.createElement("li");
        li.textContent = `${station.name} | Distance to route: ${station.distanceToRouteMeters} m | Availability: ${station.dataStatus}`;
        list.appendChild(li);
    });
}

function renderFuelStationList(stations) {
    const list = document.getElementById("fuel-list");
    if (!list) return;
    list.innerHTML = "";
    if (!stations.length) {
        const li = document.createElement("li");
        li.textContent = "No stations found on this route.";
        list.appendChild(li);
        return;
    }

    stations.forEach((station) => {
        const li = document.createElement("li");
        li.textContent = `${station.name} | Distance to route: ${station.distanceToRouteMeters} m | Availability: ${station.dataStatus}`;
        list.appendChild(li);
    });
}

function renderPoliceStationList(stations) {
    const list = document.getElementById("police-list");
    if (!list) return;
    list.innerHTML = "";
    if (!stations.length) {
        const li = document.createElement("li");
        li.textContent = "No police stations found on this route.";
        list.appendChild(li);
        return;
    }

    stations.forEach((station) => {
        const li = document.createElement("li");
        li.textContent = `${station.name} | Distance to route: ${station.distanceToRouteMeters} m`;
        list.appendChild(li);
    });
}

function drawPoiMarkersFromCurrentLists() {
    Object.values(poiLayers).forEach((layer) => layer.clearLayers());

    evStations.forEach((station) => {
        poiLayers.charging.addLayer(
            L.marker([station.lat, station.lon], { icon: makePoiIcon("EV", "#10b981") })
                .bindPopup(`${station.name}<br>Distance to route: ${station.distanceToRouteMeters} m<br>Availability: ${station.dataStatus}`)
        );
    });

    fuelStations.forEach((station) => {
        poiLayers.gas.addLayer(
            L.marker([station.lat, station.lon], { icon: makePoiIcon("G", "#f59e0b") })
                .bindPopup(`${station.name}<br>Distance to route: ${station.distanceToRouteMeters} m<br>Availability: ${station.dataStatus}`)
        );
    });

    policeStations.forEach((station) => {
        poiLayers.police.addLayer(
            L.marker([station.lat, station.lon], { icon: makePoiIcon("P", "#2563eb") })
                .bindPopup(`${station.name}<br>Distance to route: ${station.distanceToRouteMeters} m`)
        );
    });
}

async function updatePoiOverlays(routeCoordinates) {
    const previousSnapshot = {
        ev: [...evStations],
        fuel: [...fuelStations],
        police: [...policeStations]
    };

    Object.values(poiLayers).forEach((layer) => layer.clearLayers());
    evStations = [];
    fuelStations = [];
    policeStations = [];
    if (!routeCoordinates?.length) return;

    if (!navigator.onLine) {
        if (previousSnapshot.ev.length || previousSnapshot.fuel.length || previousSnapshot.police.length) {
            evStations = previousSnapshot.ev;
            fuelStations = previousSnapshot.fuel;
            policeStations = previousSnapshot.police;
            drawPoiMarkersFromCurrentLists();
            renderEvStationList(evStations);
            renderFuelStationList(fuelStations);
            renderPoliceStationList(policeStations);
        } else {
            renderEvStationList([]);
            renderFuelStationList([]);
            renderPoliceStationList([]);
        }
        return;
    }

    let grouped = { ev: [], fuel: [], police: [] };
    try {
        grouped = await fetchRoutePoisFromOverpass(routeCoordinates);
    } catch (error) {
        console.info("POI lookup unavailable:", error.message);
        if (previousSnapshot.ev.length || previousSnapshot.fuel.length || previousSnapshot.police.length) {
            evStations = previousSnapshot.ev;
            fuelStations = previousSnapshot.fuel;
            policeStations = previousSnapshot.police;
            drawPoiMarkersFromCurrentLists();
            renderEvStationList(evStations);
            renderFuelStationList(fuelStations);
            renderPoliceStationList(policeStations);
            showSmartAlert("Live station lookup failed. Showing last known nearby stations.");
        } else {
            renderEvStationList([]);
            renderFuelStationList([]);
            renderPoliceStationList([]);
        }
        return;
    }

    evStations = dedupePoiRecords(grouped.ev)
        .map((item) => buildPoiRecord(item, routeCoordinates))
        .filter((item) => item.distanceToRouteMeters <= POI_SEARCH_RADIUS_METERS)
        .sort((a, b) => a.distanceToRouteMeters - b.distanceToRouteMeters)
        .slice(0, POI_ROUTE_MAX_RESULTS);

    fuelStations = dedupePoiRecords(grouped.fuel)
        .map((item) => buildPoiRecord(item, routeCoordinates))
        .filter((item) => item.distanceToRouteMeters <= POI_SEARCH_RADIUS_METERS)
        .sort((a, b) => a.distanceToRouteMeters - b.distanceToRouteMeters)
        .slice(0, POI_ROUTE_MAX_RESULTS);

    policeStations = dedupePoiRecords(grouped.police)
        .map((item) => buildPoiRecord(item, routeCoordinates))
        .filter((item) => item.distanceToRouteMeters <= POI_SEARCH_RADIUS_METERS)
        .sort((a, b) => a.distanceToRouteMeters - b.distanceToRouteMeters)
        .slice(0, POI_ROUTE_MAX_RESULTS);

    drawPoiMarkersFromCurrentLists();
    renderEvStationList(evStations);
    renderFuelStationList(fuelStations);
    renderPoliceStationList(policeStations);
}

function renderTollPlazaList(plazas = []) {
    const list = document.getElementById("toll-list");
    const total = document.getElementById("toll-total");
    if (!list || !total) return;

    list.innerHTML = "";
    if (!plazas.length) {
        const li = document.createElement("li");
        li.textContent = "No toll plazas estimated for this route segment.";
        list.appendChild(li);
        total.textContent = "Estimated toll total: INR 0";
        return;
    }

    let aggregate = 0;
    plazas.forEach((plaza) => {
        aggregate += plaza.estimatedCost;
        const li = document.createElement("li");
        li.textContent = `${plaza.name} | ${plaza.distanceFromStartKm.toFixed(1)} km from start | Cost: INR ${plaza.estimatedCost}`;
        list.appendChild(li);
    });
    total.textContent = `Estimated toll total: INR ${Math.round(aggregate)}`;
}

function buildTollPlazaPlan(routeCoordinates, totalRouteDistanceKm, vehicle = "car", congestionLevel = "Medium") {
    if (!routeCoordinates?.length) return [];
    const profile = TOLL_RATE_PROFILE[vehicle] || TOLL_RATE_PROFILE.car;
    const plazaCount =
        totalRouteDistanceKm < 38 ? 0 :
        totalRouteDistanceKm < 95 ? 1 :
        totalRouteDistanceKm < 175 ? 2 :
        totalRouteDistanceKm < 260 ? 3 : 4;
    if (!plazaCount) return [];

    const samplePoints = pickRouteSamplePoints(routeCoordinates, plazaCount);
    const congestionFactor = congestionLevel === "High" ? 1.12 : congestionLevel === "Medium" ? 1.06 : 1;
    const routeSeed = buildRouteSeed(routeCoordinates);

    return samplePoints.map(([lon, lat], index) => {
        const ratio = (index + 1) / (plazaCount + 1);
        const distanceFromStartKm = totalRouteDistanceKm * ratio;
        const dynamicFactor = 0.9 + (seededNoise(routeSeed, index + 21) * 0.35);
        const estimatedCost = Math.max(30, Math.round(profile.basePerPlaza * congestionFactor * dynamicFactor));
        return {
            name: `Toll Plaza ${index + 1}`,
            lat,
            lon,
            distanceFromStartKm,
            estimatedCost
        };
    });
}

function refreshTollPlazas(routeCoordinates, totalRouteDistanceKm, vehicle = "car", prediction = null) {
    tollPlazas = [];
    tollLayer?.clearLayers();
    if (!routeCoordinates?.length) {
        renderTollPlazaList([]);
        return;
    }

    const plannedDistance = Math.max(totalRouteDistanceKm || 0, computeRouteDistanceKm(routeCoordinates));
    tollPlazas = buildTollPlazaPlan(routeCoordinates, plannedDistance, vehicle, prediction?.congestion_level || "Medium");
    tollPlazas.forEach((plaza) => {
        const marker = L.marker([plaza.lat, plaza.lon], { icon: makePoiIcon("T", "#0f766e") })
            .bindPopup(`${plaza.name}<br>Distance from start: ${plaza.distanceFromStartKm.toFixed(1)} km<br>Estimated toll: INR ${plaza.estimatedCost}`);
        tollLayer?.addLayer(marker);
    });
    renderTollPlazaList(tollPlazas);
}

function applyPoiLayerVisibility() {
    const toggleMap = {
        gas: document.getElementById("poi-gas")?.checked,
        charging: document.getElementById("poi-charging")?.checked,
        police: document.getElementById("poi-police")?.checked
    };

    Object.entries(poiLayers).forEach(([key, layer]) => {
        if (!layer) return;
        const shouldShow = Boolean(toggleMap[key]);
        if (shouldShow && !map.hasLayer(layer)) layer.addTo(map);
        if (!shouldShow && map.hasLayer(layer)) map.removeLayer(layer);
    });
}

function renderTrafficHotspotList(hotspots) {
    const list = document.getElementById("traffic-hotspot-list");
    if (!list) return;
    list.innerHTML = "";

    if (!hotspots.length) {
        const li = document.createElement("li");
        li.textContent = "Run a route to load traffic hotspots between source and destination.";
        list.appendChild(li);
        return;
    }

    hotspots.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.label} | ${item.severity} | Delay ${item.delayMins} mins | Updated ${item.updatedAt}`;
        list.appendChild(li);
    });
}

function isIncidentNearRoute(incident, routeCoordinates, thresholdMeters = 1500) {
    if (!map || !routeCoordinates?.length) return false;
    const incidentLat = Number(incident.lat);
    const incidentLng = Number(incident.lng);
    if (!Number.isFinite(incidentLat) || !Number.isFinite(incidentLng)) return false;

    const step = Math.max(1, Math.floor(routeCoordinates.length / 100));
    let minDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < routeCoordinates.length; i += step) {
        const [lon, lat] = routeCoordinates[i];
        const distance = map.distance([lat, lon], [incidentLat, incidentLng]);
        if (distance < minDistance) minDistance = distance;
        if (minDistance <= thresholdMeters) return true;
    }

    return minDistance <= thresholdMeters;
}

function buildIncidentSeverity(incidentType, congestionLevel) {
    const isRoadwork = /road/i.test(String(incidentType || ""));
    if (congestionLevel === "High") return isRoadwork ? "High" : "High";
    if (congestionLevel === "Medium") return isRoadwork ? "Medium" : "High";
    return isRoadwork ? "Low" : "Medium";
}

function estimateIncidentDelayMins(severity) {
    if (severity === "High") return 14;
    if (severity === "Medium") return 8;
    return 4;
}

async function appendLiveIncidents(routeCoordinates, prediction) {
    if (!trafficHotspotLayer || !navigator.onLine || !routeCoordinates?.length) return;

    try {
        const response = await apiRequest("/incidents/live");
        const incidents = Array.isArray(response.incidents) ? response.incidents : [];
        if (!incidents.length) return;

        const nearby = incidents
            .filter((incident) => isIncidentNearRoute(incident, routeCoordinates))
            .slice(0, 6);
        if (!nearby.length) return;

        nearby.forEach((incident) => {
            const typeLabel = /road/i.test(String(incident.type || "")) ? "Road Work" : "Accident";
            const severity = buildIncidentSeverity(typeLabel, prediction?.congestion_level || "Medium");
            const delayMins = estimateIncidentDelayMins(severity);
            const color = severity === "High" ? "#ef4444" : severity === "Medium" ? "#f59e0b" : "#22c55e";
            const lat = Number(incident.lat);
            const lon = Number(incident.lng);
            const updatedAt = incident.createdAt ? new Date(incident.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString();

            const marker = L.circleMarker([lat, lon], {
                radius: 7,
                color,
                fillColor: color,
                fillOpacity: 0.88,
                weight: 2
            })
                .bindTooltip(`${typeLabel} | ${severity} | Delay ${delayMins} mins`, { sticky: true })
                .bindPopup(`<strong>${typeLabel}</strong><br>Severity: ${severity}<br>Estimated delay: ${delayMins} mins<br>Updated: ${updatedAt}`);

            marker.on("mouseover", () => marker.openTooltip());
            trafficHotspotLayer.addLayer(marker);

            trafficHotspots.unshift({
                label: `${typeLabel} (Live)`,
                severity,
                delayMins,
                updatedAt,
                lat,
                lon
            });
        });

        trafficHotspots = trafficHotspots
            .sort((a, b) => Number(b.delayMins || 0) - Number(a.delayMins || 0))
            .slice(0, 10);

        renderTrafficHotspotList(trafficHotspots);
        renderIncidentReports();
        saveCachedRealtimeData();
    } catch (error) {
        console.info("Live incident overlay unavailable:", error.message);
    }
}

function refreshTrafficHotspots(routeCoordinates, prediction) {
    if (!trafficHotspotLayer) return;
    trafficHotspotLayer.clearLayers();
    trafficHotspots = [];
    renderTrafficHotspotList([]);
    renderIncidentReports();
    if (!routeCoordinates?.length) return;
    void appendLiveIncidents(routeCoordinates, prediction);
}

async function refreshEvStations(routeCoordinates) {
    await updatePoiOverlays(routeCoordinates);
    applyPoiLayerVisibility();
}

function setupRouteDragSkeleton() {
    window.enableRouteDragEditing = () => {
        showSmartAlert("Route drag editing skeleton ready. Integrate Leaflet.draw for full drag support.");
    };
}

function updateLiveIndicators(active) {
    const locateBtn = document.getElementById("locate-btn");
    const liveBadge = document.getElementById("live-badge");
    if (locateBtn) {
        locateBtn.classList.toggle("active", active);
        locateBtn.title = active ? "Stop Live Location" : "Toggle Live Location";
        const label = locateBtn.querySelector("span");
        if (label) label.textContent = active ? "LIVE" : "GPS";
    }
    if (liveBadge) liveBadge.classList.toggle("active", active);
}

function toggleLiveLocation() {
    if (watchId) stopLiveLocationTracking();
    else startLiveLocationTracking();
}

function startLiveLocationTracking() {
    if (!navigator.geolocation) return showAlert("Live location is not supported in your browser.");
    updateLiveIndicators(true);

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            const userIcon = L.divIcon({
                className: "user-marker",
                html: '<div style="background:#2563EB;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(37,99,235,0.6);"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            if (!userMarker) {
                userMarker = L.marker(latlng, { icon: userIcon }).addTo(map).bindPopup("Your Live Location");
                map.setView(latlng, Math.max(map.getZoom(), 14), { animate: true });
            } else {
                smoothMove(userMarker, latlng);
            }
            pathLine?.addLatLng(latlng);
            if (ambulanceModeActive && ambulanceMarker) {
                const ambulancePoint = ambulanceMarker.getLatLng();
                if (ambulancePoint) {
                    void handleAmbulanceProximity([ambulancePoint.lat, ambulancePoint.lng], ambulanceTrackedPath);
                }
            }
        },
        (err) => {
            showAlert("Unable to fetch live location: " + err.message);
            stopLiveLocationTracking();
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
}

function stopLiveLocationTracking() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    pathLine?.setLatLngs([]);
    updateLiveIndicators(false);
}

function setAmbulanceUi(statusText, distanceText, etaText) {
    const status = document.getElementById("ambulance-status");
    const distance = document.getElementById("ambulance-distance");
    const eta = document.getElementById("ambulance-eta");
    if (status) status.textContent = statusText;
    if (distance) distance.textContent = `Distance to you: ${distanceText}`;
    if (eta) eta.textContent = `ETA to corridor: ${etaText}`;
}

function showEmergencyPriorityModal(message = EMERGENCY_ROUTE_ALERT_MESSAGE) {
    const modal = document.getElementById("emergency-priority-modal");
    const text = document.getElementById("emergency-priority-message");
    if (!modal) return;
    if (text) text.textContent = message;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
}

function hideEmergencyPriorityModal() {
    const modal = document.getElementById("emergency-priority-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
}

function getCurrentTripPriority() {
    return String(document.getElementById("trip-priority")?.value || "normal").trim().toLowerCase();
}

function samplePathCoordinates(path = [], maxPoints = 60) {
    if (!Array.isArray(path) || !path.length) return [];

    const step = Math.max(1, Math.floor(path.length / maxPoints));
    const sampled = [];
    for (let index = 0; index < path.length; index += step) {
        const lat = Number(path[index]?.[0]);
        const lng = Number(path[index]?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        sampled.push([lat, lng]);
    }

    const last = path[path.length - 1];
    const lastLat = Number(last?.[0]);
    const lastLng = Number(last?.[1]);
    if (Number.isFinite(lastLat) && Number.isFinite(lastLng)) {
        const tail = sampled[sampled.length - 1];
        if (!tail || tail[0] !== lastLat || tail[1] !== lastLng) {
            sampled.push([lastLat, lastLng]);
        }
    }

    return sampled;
}

function pointToPathDistanceMeters(pointLatLng = [], polylinePath = []) {
    if (!Array.isArray(pointLatLng) || pointLatLng.length !== 2 || !polylinePath.length) {
        return Number.POSITIVE_INFINITY;
    }

    const [pointLat, pointLng] = pointLatLng;
    if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) {
        return Number.POSITIVE_INFINITY;
    }

    const sampledPolyline = samplePathCoordinates(polylinePath, 260);
    if (!sampledPolyline.length) return Number.POSITIVE_INFINITY;

    let minDistanceMeters = Number.POSITIVE_INFINITY;
    sampledPolyline.forEach(([lat, lng]) => {
        const distanceMeters = haversineDistanceKm([pointLat, pointLng], [lat, lng]) * 1000;
        if (distanceMeters < minDistanceMeters) minDistanceMeters = distanceMeters;
    });

    return minDistanceMeters;
}

function routePolylinesMatch(userRoutePath = [], ambulanceRoutePath = [], thresholdMeters = AMBULANCE_ROUTE_MATCH_THRESHOLD_METERS) {
    if (!userRoutePath.length || !ambulanceRoutePath.length) return false;

    const sampledAmbulancePath = samplePathCoordinates(ambulanceRoutePath, 70);
    if (!sampledAmbulancePath.length) return false;

    const overlapCount = sampledAmbulancePath.reduce((count, point) => {
        return count + (pointToPathDistanceMeters(point, userRoutePath) <= thresholdMeters ? 1 : 0);
    }, 0);

    return overlapCount / sampledAmbulancePath.length >= AMBULANCE_ROUTE_OVERLAP_RATIO;
}

function toggleAmbulanceMode() {
    ambulanceModeActive = !ambulanceModeActive;
    const btn = document.getElementById("ambulance-mode-btn");
    if (btn) {
        btn.classList.toggle("active", ambulanceModeActive);
        btn.textContent = `Ambulance Priority: ${ambulanceModeActive ? "On" : "Off"}`;
    }

    if (ambulanceModeActive) {
        restartAmbulanceSimulation();
        showSmartAlert("Emergency corridor mode enabled.");
    } else {
        stopAmbulanceSimulation();
        setAmbulanceUi("Ambulance priority is in standby.", "--", "--");
        hideEmergencyPriorityModal();
        showSmartAlert("Emergency corridor mode disabled.");
    }
}

function getUserReferencePoint() {
    if (userMarker) {
        const loc = userMarker.getLatLng();
        return [loc.lat, loc.lng];
    }
    if (sourceMarker) {
        const loc = sourceMarker.getLatLng();
        return [loc.lat, loc.lng];
    }
    if (sourceSelection?.coords?.length === 2) {
        return [Number(sourceSelection.coords[0]), Number(sourceSelection.coords[1])];
    }
    return null;
}

function maybeSpeakEmergencyPriorityAlert(message, force = false) {
    const now = Date.now();
    if (!force && now - ambulanceLastVoiceAlertAt < EMERGENCY_VOICE_REPEAT_MS) {
        return;
    }
    ambulanceLastVoiceAlertAt = now;
    speakFatigueWarning(message);
}

async function emitAmbulanceClearPathAlert(
    level,
    distanceMeters,
    message = EMERGENCY_ROUTE_ALERT_MESSAGE,
    forcePriorityModal = false
) {
    const now = Date.now();
    if (now - ambulanceLastPriorityAlertAt < AMBULANCE_ALERT_COOLDOWN_MS) return;
    ambulanceLastPriorityAlertAt = now;

    showSmartAlert(message);
    if (forcePriorityModal) {
        showEmergencyPriorityModal(message);
    } else {
        hideEmergencyPriorityModal();
    }
    maybeSpeakEmergencyPriorityAlert(message, true);
    await notifyBrowser(
        forcePriorityModal ? "Emergency Priority Alert" : (level === "critical" ? "Critical Ambulance Alert" : "Ambulance Priority Alert"),
        `${message} (${Math.round(distanceMeters)} m)`,
        {
            requireInteraction: forcePriorityModal || level === "critical",
            renotify: true,
            tag: "trafficai-emergency-corridor"
        }
    );
}

async function handleAmbulanceProximity(ambulanceLatLng, ambulancePath = ambulanceTrackedPath) {
    const userPoint = getUserReferencePoint();
    const emergencyPriority = getCurrentTripPriority() === "emergency";
    const ambulancePoint =
        Array.isArray(ambulanceLatLng) && ambulanceLatLng.length === 2
            ? [Number(ambulanceLatLng[0]), Number(ambulanceLatLng[1])]
            : null;

    if (
        !userPoint ||
        !ambulancePoint ||
        !Number.isFinite(userPoint[0]) ||
        !Number.isFinite(userPoint[1]) ||
        !Number.isFinite(ambulancePoint[0]) ||
        !Number.isFinite(ambulancePoint[1])
    ) {
        ambulanceAlertLevel = "none";
        hideEmergencyPriorityModal();
        return;
    }

    const distanceKm = haversineDistanceKm(ambulancePoint, userPoint);
    const distanceMeters = Math.round(distanceKm * 1000);
    const etaMinutes = Math.max(1, Math.round(distanceKm / 0.55));
    const sameRoute = routePolylinesMatch(
        selectedRouteCoordinates,
        ambulancePath,
        AMBULANCE_ROUTE_MATCH_THRESHOLD_METERS
    );

    setAmbulanceUi(
        sameRoute
            ? "Emergency vehicle active on your selected route corridor."
            : "Emergency vehicle detected, but outside your selected route corridor.",
        `${distanceKm.toFixed(2)} km`,
        sameRoute ? `${etaMinutes} mins` : "--"
    );

    const shouldAlert = sameRoute && distanceKm <= AMBULANCE_DISTANCE_THRESHOLD_KM;
    if (shouldAlert) {
        const nextLevel = emergencyPriority ? "critical" : "warning";
        if (
            ambulanceAlertLevel !== nextLevel ||
            Date.now() - ambulanceLastPriorityAlertAt >= AMBULANCE_ALERT_COOLDOWN_MS
        ) {
            ambulanceAlertLevel = nextLevel;
            await emitAmbulanceClearPathAlert(
                nextLevel,
                distanceMeters,
                EMERGENCY_ROUTE_ALERT_MESSAGE,
                emergencyPriority
            );
        } else if (emergencyPriority) {
            showEmergencyPriorityModal(EMERGENCY_ROUTE_ALERT_MESSAGE);
        }
        if (emergencyPriority) {
            maybeSpeakEmergencyPriorityAlert(EMERGENCY_ROUTE_ALERT_MESSAGE, false);
        }
        return;
    }

    ambulanceAlertLevel = "none";
    hideEmergencyPriorityModal();
}

function stopAmbulanceSimulation() {
    if (ambulanceSimulationTimer) {
        clearInterval(ambulanceSimulationTimer);
        ambulanceSimulationTimer = null;
    }
    if (ambulanceDistanceCheckTimer) {
        clearInterval(ambulanceDistanceCheckTimer);
        ambulanceDistanceCheckTimer = null;
    }
    if (ambulanceMarker) {
        map.removeLayer(ambulanceMarker);
        ambulanceMarker = null;
    }
    if (ambulancePriorityLayer) {
        map.removeLayer(ambulancePriorityLayer);
        ambulancePriorityLayer = null;
    }
    ambulanceRouteCursor = 0;
    ambulanceAlertLevel = "none";
    ambulanceLastPriorityAlertAt = 0;
    ambulanceLastVoiceAlertAt = 0;
    ambulanceTrackedPath = [];
    hideEmergencyPriorityModal();
}

function restartAmbulanceSimulation() {
    stopAmbulanceSimulation();
    if (!ambulanceModeActive || !selectedRouteCoordinates?.length || !map) return;

    ambulanceTrackedPath = selectedRouteCoordinates
        .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
        .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    if (!ambulanceTrackedPath.length) return;

    ambulancePriorityLayer = L.polyline(ambulanceTrackedPath, {
        color: "#dc2626",
        weight: 10,
        opacity: 0.18
    }).addTo(map);

    const ambulanceIcon = L.divIcon({
        className: "ambulance-marker",
        html: '<div style="background:#dc2626;color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.25);">&#x1F691;</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    const step = Math.max(1, Math.floor(ambulanceTrackedPath.length / 140));
    ambulanceMarker = L.marker(ambulanceTrackedPath[0], { icon: ambulanceIcon })
        .addTo(map)
        .bindTooltip("Emergency Ambulance", { sticky: true });

    setAmbulanceUi("Emergency corridor active. Live proximity checks started.", "--", "--");
    ambulanceSimulationTimer = setInterval(() => {
        if (!ambulanceMarker || !ambulanceTrackedPath.length) return;
        ambulanceRouteCursor = (ambulanceRouteCursor + step) % ambulanceTrackedPath.length;
        const nextLatLng = ambulanceTrackedPath[ambulanceRouteCursor];
        ambulanceMarker.setLatLng(nextLatLng);
    }, 1600);

    ambulanceDistanceCheckTimer = setInterval(() => {
        if (!ambulanceModeActive || !ambulanceMarker) return;
        const point = ambulanceMarker.getLatLng();
        if (!point) return;
        void handleAmbulanceProximity([point.lat, point.lng], ambulanceTrackedPath);
    }, EMERGENCY_ALERT_POLL_MS);

    const initialPoint = ambulanceMarker.getLatLng();
    if (initialPoint) {
        void handleAmbulanceProximity([initialPoint.lat, initialPoint.lng], ambulanceTrackedPath);
    }
}

function smoothMove(marker, newLatLng, duration = 700) {
    const start = marker.getLatLng();
    const end = L.latLng(newLatLng);
    const startTime = performance.now();
    const animate = (time) => {
        const t = Math.min((time - startTime) / duration, 1);
        marker.setLatLng([start.lat + (end.lat - start.lat) * t, start.lng + (end.lng - start.lng) * t]);
        if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
}

function getWeatherByHour(hour) {
    if (hour >= 12 && hour <= 16) return "Clear, 31C";
    if (hour >= 17 && hour <= 20) return "Cloudy, 27C";
    if (hour >= 21 || hour <= 5) return "Clear, 24C";
    return "Clear, 28C";
}

async function getRouteWeatherSnapshot(routeCoordinates, fallbackHour = new Date().getHours()) {
    const fallback = { label: "Data unavailable", source: "unavailable" };
    if (!navigator.onLine || !routeCoordinates?.length) return fallback;

    try {
        const midPoint = routeCoordinates[Math.floor(routeCoordinates.length / 2)];
        const lon = Number(midPoint?.[0]);
        const lat = Number(midPoint?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;

        const weatherUrl = new URL(WEATHER_API_ENDPOINT);
        weatherUrl.searchParams.set("latitude", lat.toFixed(5));
        weatherUrl.searchParams.set("longitude", lon.toFixed(5));
        weatherUrl.searchParams.set("current", "temperature_2m,weather_code");
        weatherUrl.searchParams.set("timezone", "auto");

        const data = await fetchJsonWithTimeout(weatherUrl.toString(), {}, WEATHER_FETCH_TIMEOUT_MS);
        const code = data?.current?.weather_code;
        const temp = data?.current?.temperature_2m;
        if (code === undefined || temp === undefined) return fallback;

        return {
            label: `${weatherCodeToText(code)}, ${Math.round(temp)}C`,
            source: "open-meteo"
        };
    } catch (error) {
        console.info("Weather API unavailable:", error.message);
        return fallback;
    }
}

function getWeatherImpactText(weather, congestionLevel) {
    const text = weather.toLowerCase();
    if (text.includes("rain") || text.includes("storm")) return "Wet roads likely. Maintain longer braking distance and lower speed on turns.";
    if (text.includes("fog") || text.includes("haze")) return "Reduced visibility expected. Use low beam and keep safe following distance.";
    if (text.includes("clear")) return congestionLevel === "High" ? "High visibility, but traffic density remains the main delay factor." : "High visibility and stable conditions. Ideal for smoother driving.";
    return "Moderate weather impact expected. Drive with caution near busy junctions.";
}

function buildTrafficCycle24() {
    return Array.from({ length: 24 }, (_, h) => {
        if ((h >= 8 && h <= 10) || (h >= 17 && h <= 19)) return 72;
        if (h >= 11 && h <= 16) return 48;
        if (h >= 22 || h <= 5) return 18;
        return 30;
    });
}

function predictFutureTrafficScore(baseScore, hoursAhead) {
    const cycle = buildTrafficCycle24();
    const targetHour = (new Date().getHours() + hoursAhead) % 24;
    return clamp((baseScore * 0.58) + (cycle[targetHour] * 0.42), 10, 95);
}

function suggestFutureLeaveTime(baseTrafficPoints, hoursAhead) {
    const cycle = buildTrafficCycle24();
    const adjusted = baseTrafficPoints.map((point, idx) => clamp((point * 0.65) + (cycle[(idx + hoursAhead) % 24] * 0.35), 0, 100));
    return formatHour(adjusted.indexOf(Math.min(...adjusted)));
}

function simulateTrafficPrediction(hour, day, distanceKm, durationMins, vehicle, purpose = "personal", priority = "normal") {
    const safeDistance = Math.max(distanceKm, 1);
    const safeDuration = Math.max(durationMins, 1);
    const averageSpeed = safeDistance / (safeDuration / 60);
    const routeEfficiencyPenalty = clamp((safeDuration / safeDistance) * 8 - 8, -8, 22);

    let score = 26;
    if ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20)) score += 30;
    else if (hour >= 11 && hour <= 16) score += 14;
    if (day === "1") score -= 10;
    else score += 6;

    if (averageSpeed < 25) score += 14;
    else if (averageSpeed < 35) score += 8;
    else if (averageSpeed > 60) score -= 7;

    if (safeDistance > 120) score += 8;
    else if (safeDistance < 15) score -= 5;
    score += routeEfficiencyPenalty;

    if (vehicle === "truck") score += 9;
    if (vehicle === "bus") score += 5;
    if (vehicle === "bike") score -= 6;
    if (purpose === "hospital" || priority === "emergency") score += 6;
    if (purpose === "temple" || purpose === "tourism") score -= 3;

    score = clamp(Math.round(score), 10, 95);
    const seed = hashString(`${hour}|${day}|${vehicle}|${purpose}|${priority}|${Math.round(safeDistance)}|${Math.round(safeDuration)}`);
    const dayModifier = day === "1" ? -6 : 4;
    const trafficPoints = buildTrafficCycle24().map((value, idx) => {
        const noise = Math.round((seededNoise(seed, idx + 1) - 0.5) * 8);
        const routeLoad = clamp(routeEfficiencyPenalty * 0.7, -4, 12);
        return clamp(value + routeLoad + dayModifier + noise, 8, 95);
    });

    const currentHourLoad = trafficPoints[Number(hour)] ?? trafficPoints[new Date().getHours()];
    score = clamp(Math.round((score * 0.58) + (currentHourLoad * 0.42)), 10, 95);
    const level = scoreToTrafficLevel(score);
    const bestHour = trafficPoints.indexOf(Math.min(...trafficPoints));
    const priorityBuffer = { normal: "No extra buffer", important: "Leave ~10 mins earlier", urgent: "Leave ~20 mins earlier", emergency: "Leave immediately" };

    const purposeAdvice = {
        hospital: "Medical trip detected: fastest and most reliable corridor prioritized.",
        school: "School trip detected: aiming for consistent arrival windows.",
        office: "Office trip detected: balancing predictability and travel time.",
        temple: "Religious trip detected: keeping route comfort and flow balanced.",
        airport: "Transit hub trip detected: on-time arrival given higher weight.",
        delivery: "Delivery trip detected: consistent movement corridor selected.",
        tourism: "Tourism trip detected: comfort-priority route balancing enabled."
    };
    const levelAdvice = { Low: "Roads are relatively free-flowing.", Medium: "Moderate delays expected in urban choke points.", High: "Heavy congestion likely around core junctions." };
    const priorityAdvice = { important: "Add a small buffer before departure.", urgent: "Prefer immediate start and dynamic rerouting.", emergency: "Fastest possible movement recommended now." };

    return {
        congestion_level: level,
        congestion_score: score,
        advice: [purposeAdvice[purpose], levelAdvice[level], priorityAdvice[priority]].filter(Boolean).join(" "),
        weather: "Data unavailable",
        traffic_points: trafficPoints,
        leave_time: formatHour(bestHour),
        buffer_note: priorityBuffer[priority] || priorityBuffer.normal
    };
}

async function getTrafficPrediction(hour, day, distanceKm, durationMins, vehicle, purpose = "personal", priority = "normal") {
    const fallback = simulateTrafficPrediction(hour, day, distanceKm, durationMins, vehicle, purpose, priority);
    if (!navigator.onLine) return fallback;

    try {
        const response = await apiRequest("/traffic/predict", {
            method: "POST",
            body: JSON.stringify({
                day: day === "1" ? "weekend" : "weekday",
                time: `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:00`
            })
        });

        if (typeof response.score !== "number" || !response.level) return fallback;

        const normalizedLevel =
            response.level === "Heavy" ? "High" :
            response.level === "Medium" ? "Medium" :
            "Low";

        return {
            ...fallback,
            congestion_level: normalizedLevel,
            congestion_score: clamp(Math.round(response.score), 0, 100),
            model_source: response.meta?.model || "backend-rule-model"
        };
    } catch (error) {
        console.info("Backend prediction unavailable, using local model:", error.message);
        return fallback;
    }
}

function estimateFuelAndCo2(distanceKm, vehicle, routeVariants, selectedVariantKey) {
    const profile = FUEL_PROFILES[vehicle] || FUEL_PROFILES.car;
    const liters = distanceKm / profile.kmPerL;
    const fuelCost = liters * profile.fuelPricePerL;
    const co2Grams = liters * profile.co2PerL;
    const fastestKm = routeVariants.fastest.route.distance / 1000;
    const fastestCo2 = (fastestKm / profile.kmPerL) * profile.co2PerL;
    const co2Saved = selectedVariantKey === "eco" ? Math.max(0, fastestCo2 - co2Grams) : 0;
    return { liters, fuelCost, co2Grams, co2Saved, fuelPricePerL: profile.fuelPricePerL };
}

function renderRouteComparison(routeVariants, selectedVariantKey) {
    const list = document.getElementById("route-compare-list");
    if (!list) return;
    list.innerHTML = "";
    [routeVariants.shortest, routeVariants.fastest, routeVariants.eco].forEach((variant) => {
        const li = document.createElement("li");
        const distanceKm = variant.route.distance / 1000;
        const durationMins = Math.max(1, Math.round(variant.route.duration / 60));
        const selectedTag = variant.key === selectedVariantKey ? " (Selected)" : "";
        li.textContent = `${variant.label}: ${formatDistance(distanceKm)}, ${formatDuration(durationMins)}${selectedTag}`;
        list.appendChild(li);
    });
}

function renderIncidentReports() {
    const list = document.getElementById("incident-list");
    if (!list) return;
    list.innerHTML = "";

    if (!trafficHotspots.length) {
        const li = document.createElement("li");
        li.textContent = "No verified live incidents reported on this route.";
        list.appendChild(li);
        return;
    }

    trafficHotspots.slice(0, 6).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.label} | ${item.severity} | Delay ${item.delayMins} mins`;
        list.appendChild(li);
    });
}

function getMultiModalSuggestion(level, distanceKm) {
    if (level === "High" && distanceKm > 20) return "Heavy congestion detected. Consider nearby bus or train options for faster arrival reliability.";
    if (level === "Medium") return "Moderate congestion. Keep transit alternatives ready in case peak delays increase.";
    return "Current traffic is manageable. Road travel remains the best option for this trip.";
}

function updateResultsUI(payload) {
    const { source, destination, viaStops, purpose, priority, vehicle, routeMode, distanceKm, durationMins, prediction, routeVariants, selectedVariantKey } = payload;

    document.getElementById("result-card")?.classList.remove("hidden");
    const badge = document.getElementById("congestion-badge");
    if (badge) {
        badge.textContent = `${prediction.congestion_level} Congestion`;
        badge.className = prediction.congestion_level.toLowerCase();
    }
    const progressFill = document.querySelector(".progress-fill");
    if (progressFill) progressFill.style.width = `${prediction.congestion_score}%`;

    const viaDetails = viaStops.length ? `<strong>Via Stops:</strong> ${viaStops.join(" -> ")}<br>` : "";
    const purposeLabel = getLabel(PURPOSE_LABELS, purpose, "Personal");
    const priorityLabel = getLabel(PRIORITY_LABELS, priority, "Normal");
    const routeDetails = document.getElementById("route-details");
    if (routeDetails) {
        routeDetails.innerHTML = `
            <strong>Route:</strong> ${source} -> ${destination}<br>
            <strong>Distance:</strong> ${formatDistance(distanceKm)}<br>
            <strong>Estimated Duration:</strong> ${formatDuration(durationMins)}<br>
            <strong>Purpose:</strong> ${purposeLabel}<br>
            <strong>Priority:</strong> ${priorityLabel}<br>
            ${viaDetails}
            <strong>Traffic Level:</strong> ${prediction.congestion_level}
        `;
    }

    const adviceBox = document.getElementById("advice-box");
    if (adviceBox) adviceBox.textContent = prediction.advice;
    updateWeatherDisplay(prediction.weather);

    const fuelData = estimateFuelAndCo2(distanceKm, vehicle, routeVariants, selectedVariantKey);
    const fuelEstimate = document.getElementById("fuel-estimate");
    if (fuelEstimate) {
        fuelEstimate.textContent = `Estimated fuel: ${fuelData.liters.toFixed(2)} L at INR ${fuelData.fuelPricePerL}/L. Approx cost: INR ${fuelData.fuelCost.toFixed(0)}.`;
    }

    const weatherImpact = document.getElementById("weather-impact");
    if (weatherImpact) {
        const weatherSourceText = prediction.weather_source === "open-meteo" ? "Live weather feed" : "Estimated weather model";
        weatherImpact.textContent = `${prediction.weather} -> ${getWeatherImpactText(prediction.weather, prediction.congestion_level)} (${weatherSourceText})`;
    }

    const co2Footprint = document.getElementById("co2-footprint");
    if (co2Footprint) {
        const savingsText = selectedVariantKey === "eco"
            ? ` CO2 saved vs fastest: ${fuelData.co2Saved.toFixed(0)} g.`
            : " Choose Eco route to compare CO2 savings vs fastest.";
        co2Footprint.textContent = `Estimated CO2: ${fuelData.co2Grams.toFixed(0)} g.${savingsText}`;
    }

    renderRouteComparison(routeVariants, selectedVariantKey);
    renderIncidentReports();

    const multimodal = document.getElementById("multimodal-suggestion");
    if (multimodal) multimodal.textContent = getMultiModalSuggestion(prediction.congestion_level, distanceKm);

    const leaveInfo = document.getElementById("leave-info");
    const normalizedMode = normalizeRouteMode(routeMode);
    const modeLabel = normalizedMode === "eco" ? "Eco" : normalizedMode === "fastest" ? "Fastest" : normalizedMode === "shortest" ? "Shortest" : "Recommended";
    if (leaveInfo) leaveInfo.textContent = `Recommended departure: ${prediction.leave_time} (${prediction.buffer_note}) | Route mode: ${modeLabel}`;

    ensureTrafficGraphRendered(prediction.traffic_points);
    window.requestAnimationFrame(() => ensureTrafficGraphRendered(prediction.traffic_points));
}

function updateWeatherDisplay(weather) {
    const weatherInfo = document.getElementById("weather-info");
    if (weatherInfo) weatherInfo.textContent = weather;
}

function applyFutureTrafficPrediction(hoursAhead) {
    const futureNote = document.getElementById("future-traffic-note");
    const leaveInfo = document.getElementById("leave-info");
    if (!lastRouteSnapshot || !futureNote || !leaveInfo) {
        if (futureNote) futureNote.textContent = "Predicted using historical pattern simulation.";
        return;
    }

    const futureScore = predictFutureTrafficScore(lastRouteSnapshot.prediction.congestion_score, hoursAhead);
    const futureLevel = scoreToTrafficLevel(futureScore);
    const futureLeaveTime = suggestFutureLeaveTime(lastRouteSnapshot.prediction.traffic_points, hoursAhead);

    leaveInfo.textContent = `Recommended departure: ${futureLeaveTime} (${lastRouteSnapshot.prediction.buffer_note}) | Future traffic at +${hoursAhead}h: ${futureLevel}`;
    futureNote.textContent = `Predicted using historical pattern simulation. Forecast score at +${hoursAhead}h: ${Math.round(futureScore)}%.`;
}

function cacheOfflineRoute(payload) {
    try {
        localStorage.setItem(OFFLINE_ROUTE_CACHE_KEY, JSON.stringify(payload));
        offlineRouteCache = payload;
    } catch (error) {
        console.warn("Unable to store offline route cache:", error.message);
    }
}

function getOfflineRoute(source, destination) {
    if (!offlineRouteCache) {
        const raw = localStorage.getItem(OFFLINE_ROUTE_CACHE_KEY);
        if (raw) {
            try {
                offlineRouteCache = JSON.parse(raw);
            } catch (error) {
                console.warn("Offline route cache parsing error:", error.message);
            }
        }
    }
    if (!offlineRouteCache) return null;
    if (!source || !destination) return offlineRouteCache;

    const sameRoute =
        offlineRouteCache.source?.toLowerCase() === source.toLowerCase() &&
        offlineRouteCache.destination?.toLowerCase() === destination.toLowerCase();
    return sameRoute ? offlineRouteCache : offlineRouteCache;
}

async function renderRouteFromOfflineCache(cachePayload, requestedType = "default") {
    if (!cachePayload?.routes?.length) throw new Error("No cached route available.");

    const source = sourceSelection?.label || document.getElementById("source").value.trim() || cachePayload.source;
    const destination = destinationSelection?.label || document.getElementById("destination").value.trim() || cachePayload.destination;
    const viaInput = document.getElementById("via-points");
    const viaStops = viaInput ? viaInput.value.split(",").map((item) => item.trim()).filter(Boolean) : cachePayload.viaStops || [];
    const purpose = document.getElementById("trip-purpose")?.value || cachePayload.purpose || "personal";
    const priority = document.getElementById("trip-priority")?.value || cachePayload.priority || "normal";
    const vehicle = document.getElementById("vehicle-type")?.value || cachePayload.vehicle || "car";
    const hour = Number(document.getElementById("travel-hour")?.value || cachePayload.hour || 9);
    const day = document.getElementById("travel-day")?.value || cachePayload.day || "0";

    const normalizedType = normalizeRouteMode(requestedType);
    const routeVariants = ensureDistinctRouteVariants(buildRouteVariants(cachePayload.routes));
    const selectedRoute = resolveSelectedRoute(normalizedType, cachePayload.routes, routeVariants, purpose, priority);
    const selectedVariantKey =
        normalizedType === "eco" ? "eco" :
        normalizedType === "fastest" ? "fastest" :
        normalizedType === "shortest" ? "shortest" :
        getSelectedVariantKey(selectedRoute, routeVariants);
    routeDisplayMode = normalizedType === "default" ? "all" : "single";

    const distanceKm = selectedRoute.distance / 1000;
    const durationMins = Math.max(1, Math.round(selectedRoute.duration / 60));
    const prediction = await getTrafficPrediction(hour, day, distanceKm, durationMins, vehicle, purpose, priority);
    const weatherSnapshot = await getRouteWeatherSnapshot(selectedRoute.geometry.coordinates, hour);
    prediction.weather = weatherSnapshot.label;
    prediction.weather_source = weatherSnapshot.source;
    prediction.vehicle = vehicle;
    const nextSnapshot = {
        source,
        destination,
        prediction,
        distanceKm,
        durationMins,
        purpose,
        priority,
        routeCoordinates: selectedRoute.geometry.coordinates,
        selectedVariantKey
    };
    lastRouteSnapshot = nextSnapshot;
    selectedRouteGeometry = selectedRoute.geometry;
    selectedRouteCoordinates = selectedRoute.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    selectedRouteKey = selectedVariantKey;

    let srcCoords = sourceSelection?.coords || cachePayload.srcCoords || null;
    let destCoords = destinationSelection?.coords || cachePayload.destCoords || null;
    let viaCoords = cachePayload.viaCoords || [];
    if (!srcCoords || !destCoords) {
        srcCoords = await geocode(source, { referenceCoords: getMapCenterCoords() });
        destCoords = await geocode(destination, { referenceCoords: srcCoords });
    }
    if (!viaCoords.length && viaStops.length) {
        viaCoords = [];
        let viaReference = srcCoords;
        for (const stop of viaStops) {
            const coords = await geocode(stop, { referenceCoords: viaReference });
            viaCoords.push(coords);
            viaReference = coords;
        }
    }

    drawRouteOnMap(routeVariants, selectedVariantKey, prediction, routeDisplayMode);
    clearDraftWaypointMarkers();
    addRouteMarkers(srcCoords, destCoords, source, destination, viaCoords, viaStops);
    setRouteSelection("source", srcCoords, source, "cache");
    setRouteSelection("destination", destCoords, destination, "cache");
    refreshTrafficHotspots(selectedRoute.geometry.coordinates, prediction);
    await refreshEvStations(selectedRoute.geometry.coordinates, prediction);
    refreshTollPlazas(selectedRoute.geometry.coordinates, distanceKm, vehicle, prediction);
    setWorkspaceState("results");
    updateResultsUI({
        source,
        destination,
        viaStops,
        purpose,
        priority,
        vehicle,
        routeMode: normalizedType,
        distanceKm,
        durationMins,
        prediction,
        routeVariants,
        selectedVariantKey
    });
    syncFatigueTripContext(distanceKm, durationMins, prediction.congestion_level);
    if (ambulanceModeActive) restartAmbulanceSimulation();

    startRealtimeDataLoop();
}

function saveCachedRealtimeData() {
    try {
        const payload = {
            hotspots: trafficHotspots,
            evStations,
            fuelStations,
            policeStations,
            tollPlazas,
            timestamp: Date.now()
        };
        localStorage.setItem(OFFLINE_REALTIME_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn("Unable to cache realtime data:", error.message);
    }
}

function loadCachedRealtimeData() {
    try {
        const raw = localStorage.getItem(OFFLINE_REALTIME_CACHE_KEY);
        if (!raw) return;
        const payload = JSON.parse(raw);
        trafficHotspots = payload.hotspots || [];
        evStations = payload.evStations || [];
        fuelStations = payload.fuelStations || [];
        policeStations = payload.policeStations || [];
        tollPlazas = payload.tollPlazas || [];
        renderTrafficHotspotList(trafficHotspots);
        renderEvStationList(evStations);
        renderFuelStationList(fuelStations);
        renderPoliceStationList(policeStations);
        renderTollPlazaList(tollPlazas);
        tollLayer?.clearLayers();
        tollPlazas.forEach((plaza) => {
            if (!Number.isFinite(Number(plaza.lat)) || !Number.isFinite(Number(plaza.lon))) return;
            const marker = L.marker([Number(plaza.lat), Number(plaza.lon)], { icon: makePoiIcon("T", "#0f766e") })
                .bindPopup(`${plaza.name}<br>Distance from start: ${Number(plaza.distanceFromStartKm || 0).toFixed(1)} km<br>Estimated toll: INR ${Math.round(Number(plaza.estimatedCost || 0))}`);
            tollLayer?.addLayer(marker);
        });
    } catch (error) {
        console.warn("Unable to load realtime cache:", error.message);
    }
}

function stopRealtimeDataLoop() {
    if (trafficRefreshTimer) {
        clearInterval(trafficRefreshTimer);
        trafficRefreshTimer = null;
    }
    if (evRefreshTimer) {
        clearInterval(evRefreshTimer);
        evRefreshTimer = null;
    }
    if (realtimeDataTimer) {
        clearInterval(realtimeDataTimer);
        realtimeDataTimer = null;
    }
}

function startRealtimeDataLoop() {
    stopRealtimeDataLoop();
    if (!lastRouteSnapshot?.routeCoordinates?.length) return;

    trafficRefreshTimer = setInterval(() => {
        if (!lastRouteSnapshot?.routeCoordinates?.length) return;
        refreshTrafficHotspots(lastRouteSnapshot.routeCoordinates, lastRouteSnapshot.prediction);
        saveCachedRealtimeData();
    }, REALTIME_POLL_MS);

    evRefreshTimer = setInterval(() => {
        if (!lastRouteSnapshot?.routeCoordinates?.length) return;
        refreshEvStations(lastRouteSnapshot.routeCoordinates, lastRouteSnapshot.prediction);
        saveCachedRealtimeData();
    }, EV_REFRESH_MS);

    realtimeDataTimer = setInterval(() => {
        if (ambulanceModeActive && selectedRouteCoordinates?.length) {
            setAmbulanceUi("Emergency corridor active. Live tracking updates every few seconds.", document.getElementById("ambulance-distance")?.textContent?.replace("Distance to you: ", "") || "--", document.getElementById("ambulance-eta")?.textContent?.replace("ETA to corridor: ", "") || "--");
        }
    }, 15000);
}

function showSmartAlert(message) {
    const box = document.getElementById("smart-alert");
    if (!box) return;
    box.textContent = message;
    box.classList.remove("hidden");
    window.setTimeout(() => box.classList.add("hidden"), 9000);
}

async function notifyBrowser(title, body, options = {}) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        try {
            await Notification.requestPermission();
        } catch (error) {
            console.warn("Notification permission request failed:", error.message);
        }
    }
    if (Notification.permission === "granted") {
        const notificationOptions = {
            body,
            tag: options.tag,
            renotify: Boolean(options.renotify),
            requireInteraction: Boolean(options.requireInteraction)
        };
        new Notification(title, notificationOptions);
    }
}

function scheduleSmartAlert(snapshot) {
    if (smartAlertTimer) clearTimeout(smartAlertTimer);
    smartAlertTimer = setTimeout(async () => {
        const projected = predictFutureTrafficScore(snapshot.prediction.congestion_score, 1);
        if (projected > snapshot.prediction.congestion_score + 10) {
            const msg = `Traffic may increase soon for ${snapshot.source} -> ${snapshot.destination}. Consider leaving earlier than planned.`;
            showSmartAlert(msg);
            await notifyBrowser("TrafficAI Smart Alert", msg);
        }
    }, 45000);
}

function getFatigueLevel(score) {
    if (score < 35) return "low";
    if (score < 70) return "medium";
    return "high";
}

function resetFatigueFrameCounters() {
    closedEyeFrameCount = 0;
    yawnFrameCount = 0;
}

function updateFatigueUi(level, detailsText = "") {
    const badge = document.getElementById("fatigue-status-badge");
    const risk = document.getElementById("fatigue-risk");
    const meterFill = document.getElementById("fatigue-meter-fill");
    const details = document.getElementById("fatigue-details");

    if (badge) {
        const modeLabel = fatigueMonitorActive ? (fatigueDetectionMode === "camera" ? "Camera AI" : "Fallback AI") : "Monitoring Off";
        const levelLabel = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
        badge.className = `fatigue-badge ${fatigueMonitorActive ? level : "off"}`;
        badge.textContent = fatigueMonitorActive ? `${modeLabel} - ${levelLabel}` : modeLabel;
    }

    if (risk) {
        if (fatigueMonitorActive) {
            const levelLabel = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
            risk.textContent = `Risk: ${Math.round(fatigueScore)}% (${levelLabel})`;
        } else {
            risk.textContent = "Risk: --";
        }
    }

    if (meterFill) meterFill.style.width = `${fatigueMonitorActive ? Math.round(fatigueScore) : 0}%`;
    if (details) {
        details.textContent = `${detailsText}${fatigueTripContextNote ? ` ${fatigueTripContextNote}` : ""}`.trim();
    }
}

function updateFatigueScore(nextScore, detailsText) {
    fatigueScore = clamp(nextScore, 0, 100);
    updateFatigueUi(getFatigueLevel(fatigueScore), detailsText);
}

function getPointDistance(landmarks, a, b) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) return 0;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function getEyeAspectRatio(landmarks, points) {
    const verticalA = getPointDistance(landmarks, points[1], points[5]);
    const verticalB = getPointDistance(landmarks, points[2], points[4]);
    const horizontal = getPointDistance(landmarks, points[0], points[3]);
    return horizontal > 0 ? (verticalA + verticalB) / (2 * horizontal) : 0;
}

function getMouthAspectRatio(landmarks) {
    const vertical = getPointDistance(landmarks, 13, 14);
    const horizontal = getPointDistance(landmarks, 61, 291);
    return horizontal > 0 ? vertical / horizontal : 0;
}

function syncFatigueTripContext(distanceKm, durationMins, trafficLevel) {
    const context = [];
    if (durationMins >= 180) context.push("Long-drive risk: plan a 15 min break every 2 hours.");
    else if (durationMins >= 120) context.push("Trip duration is high: plan a short refresh break.");
    else if (durationMins >= 90) context.push("Medium-long trip: stay hydrated and avoid monotony.");
    if (trafficLevel === "High") context.push("Heavy traffic may increase mental fatigue.");
    if (distanceKm >= 200) context.push("Keep emergency contact and rest stop options ready.");

    fatigueTripContextNote = context.join(" ");
    if (!fatigueMonitorActive) {
        const details = document.getElementById("fatigue-details");
        if (details) {
            details.textContent = `${fatigueTripContextNote || "Start monitoring to detect eye-closure and yawn patterns."} Enable monitoring before departure.`;
        }
    } else {
        const boost = durationMins >= 180 ? 12 : durationMins >= 120 ? 8 : durationMins >= 90 ? 4 : 0;
        const trafficBoost = trafficLevel === "High" ? 4 : trafficLevel === "Medium" ? 2 : 0;
        updateFatigueScore(fatigueScore + boost + trafficBoost, "Trip context updated for fatigue monitoring.");
    }
}

async function triggerFatigueAlert(message, force = false) {
    const now = Date.now();
    if (!force && now < fatigueAlertCooldownUntil) return;
    fatigueAlertCooldownUntil = now + FATIGUE_CONFIG.alertCooldownMs;

    const log = document.getElementById("fatigue-alert-log");
    if (log) log.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
    showSmartAlert(message);
    speakFatigueWarning(message);
    await notifyBrowser("Driver Fatigue Alert", message);
}

function speakFatigueWarning(message) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(`Safety alert. ${message}`);
    const voice = selectCalmVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => setSpeakingPulse(true);
    utterance.onend = () => setSpeakingPulse(false);
    utterance.onerror = () => setSpeakingPulse(false);
    window.speechSynthesis.cancel();
    try {
        window.speechSynthesis.resume();
    } catch (_error) {
        // Ignore resume failures and attempt speaking anyway.
    }
    window.speechSynthesis.speak(utterance);
}

async function initFatigueFaceMesh() {
    if (fatigueFaceMesh || !window.FaceMesh) return Boolean(fatigueFaceMesh);
    fatigueFaceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    fatigueFaceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    fatigueFaceMesh.onResults(handleFatigueFaceResults);
    return true;
}

function handleFatigueFaceResults(results) {
    if (!fatigueMonitorActive || fatigueDetectionMode !== "camera") return;

    const landmarks = results.multiFaceLandmarks?.[0];
    if (!landmarks) {
        updateFatigueScore(
            fatigueScore + 1.3,
            "Face not detected clearly. Keep your face centered and eyes on the road."
        );
        if (fatigueScore >= 74) void triggerFatigueAlert("Driver attention lost. Please pause and refocus.", false);
        return;
    }

    const leftEar = getEyeAspectRatio(landmarks, LEFT_EYE_POINTS);
    const rightEar = getEyeAspectRatio(landmarks, RIGHT_EYE_POINTS);
    const ear = (leftEar + rightEar) / 2;
    const mar = getMouthAspectRatio(landmarks);

    if (ear < FATIGUE_CONFIG.earThreshold) closedEyeFrameCount += 1;
    else closedEyeFrameCount = Math.max(0, closedEyeFrameCount - 2);

    if (mar > FATIGUE_CONFIG.marThreshold) yawnFrameCount += 1;
    else yawnFrameCount = Math.max(0, yawnFrameCount - 1);

    let delta = -0.5;
    if (ear < FATIGUE_CONFIG.earThreshold) delta += 1.2;
    if (mar > FATIGUE_CONFIG.marThreshold) delta += 0.9;
    if (lastRouteSnapshot?.prediction?.congestion_level === "High") delta += 0.3;

    updateFatigueScore(
        fatigueScore + delta,
        `EAR: ${ear.toFixed(2)} | Yawn index: ${mar.toFixed(2)} | Eye events: ${eyesClosedEventCount} | Yawns: ${yawnEventCount}`
    );

    if (closedEyeFrameCount >= FATIGUE_CONFIG.closedEyeFramesForAlert) {
        resetFatigueFrameCounters();
        eyesClosedEventCount += 1;
        updateFatigueScore(fatigueScore + 14, "Extended eye closure detected. Consider an immediate break.");
        void triggerFatigueAlert("Drowsiness detected from prolonged eye closure. Please stop and rest.", true);
    }

    if (yawnFrameCount >= FATIGUE_CONFIG.yawnFramesForAlert) {
        yawnFrameCount = 0;
        yawnEventCount += 1;
        updateFatigueScore(fatigueScore + 10, "Repeated yawn pattern detected. Fresh air and short break recommended.");
        void triggerFatigueAlert("Frequent yawning detected. Consider taking a short break.", false);
    }

    if (fatigueScore >= 82) {
        void triggerFatigueAlert("High fatigue risk. Pull over safely and rest before continuing.", false);
    }
}

function startFatigueFallback(reason = "Camera AI unavailable.") {
    fatigueDetectionMode = "fallback";
    if (fatigueFrameHandle) {
        cancelAnimationFrame(fatigueFrameHandle);
        fatigueFrameHandle = null;
    }
    if (fatigueFallbackTimer) clearInterval(fatigueFallbackTimer);
    resetFatigueFrameCounters();
    updateFatigueUi(getFatigueLevel(fatigueScore), `${reason} Running historical-pattern fallback monitoring.`);

    fatigueFallbackTimer = setInterval(() => {
        if (!fatigueMonitorActive || fatigueDetectionMode !== "fallback") return;
        const hour = new Date().getHours();
        let delta = (hour >= 22 || hour <= 5) ? 2.3 : 1.1;
        if (lastRouteSnapshot?.durationMins >= 120) delta += 1.5;
        else if (lastRouteSnapshot?.durationMins >= 90) delta += 0.8;
        if (lastRouteSnapshot?.prediction?.congestion_level === "High") delta += 0.9;
        if (lastRouteSnapshot?.prediction?.congestion_level === "Medium") delta += 0.4;

        updateFatigueScore(fatigueScore + delta, "Fallback fatigue model active (time + trip load based).");
        if (fatigueScore >= 76) {
            void triggerFatigueAlert("Fatigue risk increasing in fallback mode. Please schedule a break.", false);
        }
    }, 6000);
}

async function startFatigueMonitoring() {
    if (fatigueMonitorActive) return;
    fatigueMonitorActive = true;
    fatigueScore = 8;
    fatigueAlertCooldownUntil = 0;
    resetFatigueFrameCounters();
    eyesClosedEventCount = 0;
    yawnEventCount = 0;
    const log = document.getElementById("fatigue-alert-log");
    if (log) log.textContent = "Monitoring started. Keep your face in view for reliable detection.";
    updateFatigueUi("low", "Initializing fatigue monitor...");

    const video = document.getElementById("fatigue-video");
    if (!video) {
        showAlert("Fatigue monitor UI is unavailable.");
        fatigueMonitorActive = false;
        return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        startFatigueFallback("Camera access is not supported in this browser.");
        return;
    }

    try {
        fatigueStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } },
            audio: false
        });
        video.srcObject = fatigueStream;
        await video.play();
        video.classList.add("active");

        const faceMeshReady = await initFatigueFaceMesh();
        if (!faceMeshReady) {
            startFatigueFallback("FaceMesh model unavailable.");
            return;
        }

        fatigueDetectionMode = "camera";
        updateFatigueUi("low", "Camera AI monitoring started. Keep your face visible for accurate detection.");

        const runFrame = async () => {
            if (!fatigueMonitorActive || fatigueDetectionMode !== "camera") return;
            try {
                if (video.readyState >= 2 && fatigueFaceMesh) {
                    await fatigueFaceMesh.send({ image: video });
                }
            } catch (error) {
                console.warn("Fatigue FaceMesh loop error:", error.message);
                startFatigueFallback("Face tracking interruption detected.");
                return;
            }
            fatigueFrameHandle = requestAnimationFrame(() => {
                void runFrame();
            });
        };

        void runFrame();
    } catch (error) {
        console.warn("Fatigue monitor camera error:", error.message);
        startFatigueFallback("Camera permission denied or unavailable.");
    }
}

function stopFatigueMonitoring(silent = false) {
    fatigueMonitorActive = false;
    fatigueDetectionMode = "off";
    fatigueAlertCooldownUntil = 0;
    resetFatigueFrameCounters();
    eyesClosedEventCount = 0;
    yawnEventCount = 0;

    if (fatigueFrameHandle) {
        cancelAnimationFrame(fatigueFrameHandle);
        fatigueFrameHandle = null;
    }
    if (fatigueFallbackTimer) {
        clearInterval(fatigueFallbackTimer);
        fatigueFallbackTimer = null;
    }
    if (fatigueStream) {
        fatigueStream.getTracks().forEach((track) => track.stop());
        fatigueStream = null;
    }

    const video = document.getElementById("fatigue-video");
    if (video) {
        video.pause();
        video.srcObject = null;
        video.classList.remove("active");
    }

    fatigueScore = 0;
    if (!silent) {
        const log = document.getElementById("fatigue-alert-log");
        if (log) log.textContent = "No active fatigue alerts.";
        updateFatigueUi("low", "Monitoring stopped. Restart before your next trip.");
    }
}

function startVoiceInput() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        showAlert("Voice input is not supported in your browser.");
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const voiceBtn = document.getElementById("voice-btn");
    if (voiceBtn) {
        voiceBtn.textContent = "Listening...";
        voiceBtn.style.background = "#EEF2FF";
        voiceBtn.style.borderColor = "#4F46E5";
    }

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        sourceSelection = null;
        destinationSelection = null;
        destinationPickMode = false;
        updateRouteSelectionInputs();
        if (transcript.toLowerCase().includes(" to ")) {
            const parts = transcript.split(/\s+to\s+/i);
            document.getElementById("source").value = parts[0].trim();
            document.getElementById("destination").value = parts[1].trim();
        } else {
            document.getElementById("source").value = transcript.trim();
        }
        if (voiceBtn) {
            voiceBtn.innerHTML = '<span class="voice-icon">Mic</span> Voice Input';
            voiceBtn.style.background = "";
            voiceBtn.style.borderColor = "";
        }
    };

    recognition.onerror = (event) => {
        showAlert("Voice recognition error: " + event.error);
        if (voiceBtn) {
            voiceBtn.innerHTML = '<span class="voice-icon">Mic</span> Voice Input';
            voiceBtn.style.background = "";
            voiceBtn.style.borderColor = "";
        }
    };

    recognition.onend = () => {
        if (voiceBtn) {
            voiceBtn.innerHTML = '<span class="voice-icon">Mic</span> Voice Input';
            voiceBtn.style.background = "";
            voiceBtn.style.borderColor = "";
        }
    };

    recognition.start();
}

function startVoiceCommandStarter() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        showAlert("Voice command is not supported in your browser.");
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const commandBtn = document.getElementById("voice-command-btn");
    if (commandBtn) {
        commandBtn.textContent = "Listening command...";
        commandBtn.style.background = "#EEF2FF";
        commandBtn.style.borderColor = "#4F46E5";
    }

    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript.trim().toLowerCase();
        sourceSelection = null;
        destinationSelection = null;
        destinationPickMode = false;
        updateRouteSelectionInputs();

        const fromToMatch = text.match(/from\s+(.+)\s+to\s+(.+)/i);
        if (fromToMatch) {
            document.getElementById("source").value = fromToMatch[1].trim();
            document.getElementById("destination").value = fromToMatch[2].trim();
        } else {
            const toMatch = text.match(/route\s+to\s+(.+)/i);
            if (toMatch) document.getElementById("destination").value = toMatch[1].trim();
        }

        let mode = "default";
        if (text.includes("fastest")) mode = "fastest";
        else if (text.includes("shortest")) mode = "shortest";
        else if (text.includes("eco")) mode = "eco";

        if (!text.includes("trafficai") && !text.includes("route")) {
            showAlert('Try saying: "Hey TrafficAI, find the fastest route to Mysore."');
        } else {
            findRoute(mode);
        }

        if (commandBtn) {
            commandBtn.innerHTML = '<span class="voice-icon">VC</span> Voice Command (Starter)';
            commandBtn.style.background = "";
            commandBtn.style.borderColor = "";
        }
    };

    recognition.onerror = () => {
        if (commandBtn) {
            commandBtn.innerHTML = '<span class="voice-icon">VC</span> Voice Command (Starter)';
            commandBtn.style.background = "";
            commandBtn.style.borderColor = "";
        }
    };

    recognition.onend = () => {
        if (commandBtn) {
            commandBtn.innerHTML = '<span class="voice-icon">VC</span> Voice Command (Starter)';
            commandBtn.style.background = "";
            commandBtn.style.borderColor = "";
        }
    };

    recognition.start();
}

function drawTrafficGraph(points) {
    const canvas = document.getElementById("traffic-graph");
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const safePoints = Array.isArray(points) && points.length >= 2
        ? points.map((point) => clamp(Number(point) || 0, 0, 100))
        : buildTrafficCycle24();

    const width = Math.round(canvas.clientWidth || canvas.offsetWidth || 320);
    const height = Math.round(canvas.clientHeight || canvas.offsetHeight || 140);
    if (width < 24 || height < 24) {
        return false;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(15, 118, 110, 0.32)");
    gradient.addColorStop(1, "rgba(14, 165, 233, 0.06)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, height);
    safePoints.forEach((point, i) => {
        const x = (i / (safePoints.length - 1)) * width;
        const y = height - (point / 100) * height;
        ctx.lineTo(x, y);
    });
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#0F766E";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    safePoints.forEach((point, i) => {
        const x = (i / (safePoints.length - 1)) * width;
        const y = height - (point / 100) * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    return true;
}

function ensureTrafficGraphRendered(points, retries = 8) {
    const rendered = drawTrafficGraph(points);
    if (rendered || retries <= 0) return;
    window.setTimeout(() => ensureTrafficGraphRendered(points, retries - 1), 220);
}

async function syncSearchToCloud(entry) {
    if (!navigator.onLine) return;

    try {
        await apiRequest("/search/save", {
            method: "POST",
            body: JSON.stringify({
                origin: entry.source,
                destination: entry.destination,
                purpose: entry.purpose,
                priority: entry.priority,
                routeMode: entry.routeMode || "default",
                distanceKm: Number(entry.distanceKm || 0),
                durationMins: Number(entry.durationMins || 0),
                userId: getCurrentUserId()
            })
        });
    } catch (error) {
        console.info("Cloud search sync skipped:", error.message);
    }
}

async function loadSearchHistoryFromCloud() {
    if (!navigator.onLine) return;

    try {
        const uid = encodeURIComponent(getCurrentUserId());
        const response = await apiRequest(`/search/user/${uid}`);
        const cloudItems = Array.isArray(response.items) ? response.items : [];
        if (!cloudItems.length) return;

        searchHistory = mergeSearchHistorySets(searchHistory, cloudItems);
        try {
            localStorage.setItem("trafficai_history", JSON.stringify(searchHistory));
        } catch (_error) {
            // Ignore local storage write failures and keep in-memory history.
        }
        renderSearchHistory();
    } catch (error) {
        console.info("Cloud history load skipped:", error.message);
    }
}

function saveToHistory(source, destination, purpose = "personal", priority = "normal", meta = {}) {
    const entry = {
        ...normalizeHistoryEntry({ source, destination, purpose, priority, timestamp: Date.now() }),
        routeMode: meta.routeMode || "default",
        distanceKm: Number(meta.distanceKm || 0),
        durationMins: Number(meta.durationMins || 0)
    };
    searchHistory = mergeSearchHistorySets([entry], searchHistory);
    try {
        localStorage.setItem("trafficai_history", JSON.stringify(searchHistory));
    } catch (_error) {
        // Keep running with in-memory history.
    }
    renderSearchHistory();
    void syncSearchToCloud(entry);
}

function loadSearchHistory() {
    try {
        const saved = localStorage.getItem("trafficai_history");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                searchHistory = mergeSearchHistorySets(parsed);
            } catch (error) {
                console.warn("Unable to parse local search history:", error.message);
                searchHistory = [];
            }
        }
    } catch (_error) {
        searchHistory = [];
    }
    renderSearchHistory();
    void loadSearchHistoryFromCloud();
}

function renderSearchHistory() {
    const list = document.getElementById("history-list");
    if (!list) return;
    list.innerHTML = "";

    if (!searchHistory.length) {
        const li = document.createElement("li");
        li.textContent = "No recent searches";
        li.style.color = "#94A3B8";
        list.appendChild(li);
        return;
    }

    searchHistory.forEach((entry) => {
        const li = document.createElement("li");
        const purposeLabel = getLabel(PURPOSE_LABELS, entry.purpose || "personal", "Personal");
        const priorityLabel = getLabel(PRIORITY_LABELS, entry.priority || "normal", "Normal");
        li.textContent = `${entry.source} -> ${entry.destination} (${purposeLabel}, ${priorityLabel})`;
        li.style.cursor = "pointer";
        li.onclick = () => {
            sourceSelection = null;
            destinationSelection = null;
            destinationPickMode = false;
            updateRouteSelectionInputs();
            document.getElementById("source").value = entry.source;
            document.getElementById("destination").value = entry.destination;
            const viaInput = document.getElementById("via-points");
            if (viaInput) viaInput.value = "";
            const purposeInput = document.getElementById("trip-purpose");
            const priorityInput = document.getElementById("trip-priority");
            if (purposeInput) purposeInput.value = entry.purpose || "personal";
            if (priorityInput) priorityInput.value = entry.priority || "normal";
        };
        list.appendChild(li);
    });
}

document.getElementById("reset-btn").onclick = function () {
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    routeLayers.forEach((layer) => map.removeLayer(layer));
    routeLayers = [];
    routeLayerMeta = [];
    clearRouteMarkers();
    clearDraftWaypointMarkers();
    stopLiveLocationTracking();
    stopFatigueMonitoring();
    stopAmbulanceSimulation();
    stopRealtimeDataLoop();
    pathLine?.setLatLngs([]);
    trafficHotspotLayer?.clearLayers();
    tollLayer?.clearLayers();
    trafficHotspots = [];
    renderTrafficHotspotList([]);
    evStations = [];
    renderEvStationList([]);
    fuelStations = [];
    policeStations = [];
    renderFuelStationList([]);
    renderPoliceStationList([]);
    tollPlazas = [];
    renderTollPlazaList([]);
    Object.values(poiLayers).forEach((layer) => {
        layer.clearLayers();
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    ["poi-gas", "poi-charging", "poi-police"].forEach((id) => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = false;
    });
    waypointAddMode = false;
    const waypointBtn = document.getElementById("waypoint-mode-btn");
    if (waypointBtn) {
        waypointBtn.classList.remove("active");
        waypointBtn.textContent = "Add Stop Mode: Off";
    }
    const ambulanceBtn = document.getElementById("ambulance-mode-btn");
    if (ambulanceBtn) {
        ambulanceBtn.classList.remove("active");
        ambulanceBtn.textContent = "Ambulance Priority: Off";
    }
    ambulanceModeActive = false;
    selectedRouteCoordinates = [];
    selectedRouteGeometry = null;
    selectedRouteKey = "recommended";
    routeDisplayMode = "all";
    map.setView([14.4644, 75.9218], 11);
    clearRouteSelections();
    const viaInput = document.getElementById("via-points");
    if (viaInput) viaInput.value = "";
    const purposeInput = document.getElementById("trip-purpose");
    const priorityInput = document.getElementById("trip-priority");
    if (purposeInput) purposeInput.value = "personal";
    if (priorityInput) priorityInput.value = "normal";
    document.getElementById("result-card")?.classList.add("hidden");
    document.getElementById("smart-alert")?.classList.add("hidden");
    document.getElementById("leave-info").textContent = "Enter route to calculate...";
    document.getElementById("future-traffic-note").textContent = "Predicted using historical pattern simulation.";
    setAmbulanceUi("Ambulance priority is in standby.", "--", "--");
    const slider = document.getElementById("future-traffic-slider");
    const hourValue = document.getElementById("future-hour-value");
    if (slider) slider.value = "0";
    if (hourValue) hourValue.textContent = "0";
    lastRouteSnapshot = null;
    setWorkspaceState("splash");
};

function showAlert(message) {
    alert(message);
}

function updateConnectionStatus() {
    const indicator = document.getElementById("status-indicator");
    if (!indicator) return;
    if (navigator.onLine) {
        indicator.innerHTML = '<span class="status-dot"></span> Connected';
        indicator.className = "connected";
    } else {
        indicator.innerHTML = '<span class="status-dot"></span> Offline';
        indicator.className = "disconnected";
    }
    updateOfflineBanner();
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
window.addEventListener("resize", () => {
    if (workspaceState === "results") {
        setTimeout(() => map?.invalidateSize(), 180);
    }
});
window.addEventListener("beforeunload", () => {
    stopFatigueMonitoring(true);
    stopRealtimeDataLoop();
    stopAmbulanceSimulation();
});
updateConnectionStatus();
