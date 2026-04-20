const AUTH_FLAG_KEY = "loggedIn";
const AUTH_TOKEN_KEY = "trafficai_admin_token";
const AUTH_EMAIL_KEY = "trafficai_admin_email";
const AUTH_ROLE_KEY = "trafficai_user_role";

const config = window.TRAFFICAI_PRIVATE_CONFIG || {};
const apiCandidates = Array.isArray(config.apiBaseCandidates)
    ? config.apiBaseCandidates
    : ["/api", "http://localhost:8080/api"];
const loginPagePath = config.loginPagePath || "loged.html";
const userPortalPath = config.userPortalPath || "user-dashboard.html";
const userPortalRoute = config.userPortalRoute || "/user-dashboard";

const connectionPill = document.getElementById("connection-pill");
const adminUser = document.getElementById("admin-user");
const controlStatus = document.getElementById("control-status");
const emergencyStatusEl = document.getElementById("emergency-status");

const priorityState = document.getElementById("priority-state");
const priorityBtn = document.getElementById("priority-btn");
const refreshBtn = document.getElementById("refresh-btn");

const incidentListEl = document.getElementById("incident-list");
const emptyStateEl = document.getElementById("incident-empty");
const incidentSubmitBtn = document.getElementById("incident-submit-btn");

const emergencyActivateBtn = document.getElementById("emergency-activate-btn");
const emergencyDeactivateBtn = document.getElementById("emergency-deactivate-btn");

const emergencySourceInput = document.getElementById("emergency-source");
const emergencyDestinationInput = document.getElementById("emergency-destination");
const emergencyRadiusInput = document.getElementById("emergency-radius");

const incidentTypeInput = document.getElementById("incident-type");
const incidentLatInput = document.getElementById("incident-lat");
const incidentLngInput = document.getElementById("incident-lng");
const incidentReporterInput = document.getElementById("incident-reporter");

const userLogTableBody = document.getElementById("user-log-table-body");

let apiBase = "";
let refreshTimer = null;

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

function getStoredToken() {
    try {
        return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
    } catch (_error) {
        return "";
    }
}

function getStoredRole() {
    try {
        return (localStorage.getItem(AUTH_ROLE_KEY) || sessionStorage.getItem(AUTH_ROLE_KEY) || "").toLowerCase();
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
            // Ignore storage clear failures.
        }
    });
}

function redirectToLogin() {
    window.location.href = loginPagePath;
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

function enforceAdminSession() {
    const token = getStoredToken();
    if (!token) {
        clearAuthSession();
        redirectToLogin();
        return false;
    }

    const payload = decodeJwtPayload(token);
    if (!payload) {
        clearAuthSession();
        redirectToLogin();
        return false;
    }

    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
        clearAuthSession();
        redirectToLogin();
        return false;
    }

    const role = getStoredRole() || String(payload.role || "").toLowerCase();
    if (role !== "admin") {
        window.location.href = shouldUseRoutePaths() ? userPortalRoute : userPortalPath;
        return false;
    }

    return true;
}

function getStoredUsername() {
    try {
        return localStorage.getItem(AUTH_EMAIL_KEY) || sessionStorage.getItem(AUTH_EMAIL_KEY) || "admin@trafficai.local";
    } catch (_error) {
        return "admin@trafficai.local";
    }
}

function setStatus(message, type = "info") {
    controlStatus.className = `status-line ${type}`;
    controlStatus.textContent = message;
}

function setEmergencyStatus(message, type = "info") {
    emergencyStatusEl.className = `status-line ${type}`;
    emergencyStatusEl.textContent = message;
}

function setConnectionState(isOnline) {
    if (!connectionPill) return;
    connectionPill.className = `pill status-pill ${isOnline ? "online" : "offline"}`;
    connectionPill.textContent = isOnline ? "Online" : "Offline";
}

function normalizeBase(baseValue) {
    const raw = String(baseValue || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) {
        try {
            const parsed = new URL(raw);
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
        } catch (_error) {
            return "";
        }
    }
    if (raw.startsWith("/")) return raw.replace(/\/+$/, "");
    return "";
}

function parseLatLng(text) {
    const match = String(text || "").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function detectApiBase() {
    const normalizedCandidates = [...new Set(apiCandidates.map(normalizeBase).filter(Boolean))];
    for (const candidate of normalizedCandidates) {
        try {
            const response = await fetchWithTimeout(`${candidate}/health`, { method: "GET" }, 3500);
            if (!response.ok) continue;
            apiBase = candidate;
            setConnectionState(true);
            return candidate;
        } catch (_error) {
            // Try next candidate.
        }
    }

    apiBase = "";
    setConnectionState(false);
    return "";
}

async function apiRequest(path, options = {}) {
    const token = getStoredToken();
    const base = apiBase || (await detectApiBase());
    if (!base) throw new Error("Backend unreachable");

    const response = await fetchWithTimeout(`${base}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    }, 12000);

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
    }
    return payload;
}

function formatTimestamp(value) {
    if (!value) return "--";
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return new Date(numeric).toLocaleString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
    return "--";
}

function renderIncidents(items) {
    incidentListEl.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
        emptyStateEl.hidden = false;
        return;
    }

    emptyStateEl.hidden = true;

    items.forEach((incident) => {
        const row = document.createElement("div");
        row.className = "incident-item";

        const meta = document.createElement("div");
        meta.className = "incident-meta";
        const type = String(incident.type || "Incident");
        const by = String(incident.reportedBy || "anonymous");
        const lat = Number(incident.lat || 0).toFixed(5);
        const lng = Number(incident.lng || 0).toFixed(5);
        meta.innerHTML = `<p class="incident-type">${type}</p><p>By: ${by}</p><p>Location: ${lat}, ${lng}</p><p>Reported: ${formatTimestamp(incident.timestamp || incident.createdAt)}</p>`;

        const verifyBtn = document.createElement("button");
        verifyBtn.className = "btn btn-success";
        verifyBtn.type = "button";
        verifyBtn.textContent = "Verify Incident";
        verifyBtn.addEventListener("click", async () => {
            verifyBtn.disabled = true;
            verifyBtn.textContent = "Verifying...";
            try {
                await apiRequest(`/admin/verify-incident/${encodeURIComponent(String(incident.id || ""))}`, {
                    method: "POST",
                    body: JSON.stringify({})
                });
                setStatus("Incident verified successfully.", "ok");
                await loadIncidents();
            } catch (error) {
                setStatus(error.message || "Failed to verify incident.", "error");
            } finally {
                verifyBtn.disabled = false;
                verifyBtn.textContent = "Verify Incident";
            }
        });

        row.appendChild(meta);
        row.appendChild(verifyBtn);
        incidentListEl.appendChild(row);
    });
}

function renderUserLogs(items) {
    userLogTableBody.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No users found.</td>';
        userLogTableBody.appendChild(row);
        return;
    }

    items.forEach((user) => {
        const row = document.createElement("tr");
        const lastRoute = user.lastSearch
            ? `${user.lastSearch.origin || "--"} -> ${user.lastSearch.destination || "--"} (${user.lastSearch.routeMode || "default"})`
            : "No route search yet";
        row.innerHTML = `
            <td>${user.username || "--"}</td>
            <td>${user.phone || "--"}</td>
            <td>${formatTimestamp(user.createdAt)}</td>
            <td>${lastRoute}</td>
            <td>${formatTimestamp(user.lastSearch?.timestamp || user.lastSearch?.createdAt)}</td>
        `;
        userLogTableBody.appendChild(row);
    });
}

async function loadPriority() {
    try {
        const payload = await apiRequest("/admin/priority", { method: "GET" });
        const active = Boolean(payload.ambulancePriority);
        priorityState.textContent = `Ambulance Priority: ${active ? "Enabled" : "Disabled"}`;
        priorityBtn.className = `btn ${active ? "btn-warn" : "btn-primary"}`;
        priorityBtn.textContent = active ? "Disable Priority" : "Enable Priority";
    } catch (error) {
        priorityState.textContent = "Ambulance Priority: Unknown";
        setStatus(error.message || "Unable to load priority status.", "error");
    }
}

async function loadIncidents() {
    try {
        const payload = await apiRequest("/admin/pending-incidents", { method: "GET" });
        renderIncidents(payload.incidents || []);
        setStatus(`Loaded ${Array.isArray(payload.incidents) ? payload.incidents.length : 0} pending incident(s).`, "ok");
    } catch (error) {
        renderIncidents([]);
        setStatus(error.message || "Unable to load pending incidents.", "error");
    }
}

async function loadUserLogs() {
    try {
        const payload = await apiRequest("/admin/user-logs", { method: "GET" });
        renderUserLogs(payload.users || []);
    } catch (error) {
        userLogTableBody.innerHTML = `<tr><td colspan="5">${error.message || "Unable to load user logs."}</td></tr>`;
    }
}

async function loadEmergencyStatus() {
    try {
        const payload = await apiRequest("/emergency/status", { method: "GET" });
        if (!payload.active) {
            setEmergencyStatus("Emergency corridor inactive.", "info");
            return;
        }

        const impactedCount = Array.isArray(payload.impactedUsers) ? payload.impactedUsers.length : 0;
        setEmergencyStatus(
            `Emergency corridor active | Radius ${payload.radiusMeters}m | Impacted users: ${impactedCount}`,
            "ok"
        );
    } catch (error) {
        setEmergencyStatus(error.message || "Unable to load emergency status.", "error");
    }
}

async function togglePriority() {
    priorityBtn.disabled = true;
    try {
        const payload = await apiRequest("/admin/toggle-priority", {
            method: "POST",
            body: JSON.stringify({})
        });
        const active = Boolean(payload.ambulancePriority);
        priorityState.textContent = `Ambulance Priority: ${active ? "Enabled" : "Disabled"}`;
        priorityBtn.className = `btn ${active ? "btn-warn" : "btn-primary"}`;
        priorityBtn.textContent = active ? "Disable Priority" : "Enable Priority";
        setStatus(`Ambulance priority ${active ? "enabled" : "disabled"}.`, "ok");
    } catch (error) {
        setStatus(error.message || "Unable to toggle priority.", "error");
    } finally {
        priorityBtn.disabled = false;
    }
}

async function submitIncident() {
    const type = String(incidentTypeInput.value || "Accident").trim();
    const lat = Number(incidentLatInput.value);
    const lng = Number(incidentLngInput.value);
    const reportedBy = String(incidentReporterInput.value || getStoredUsername()).trim();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setStatus("Valid latitude and longitude are required.", "error");
        return;
    }

    incidentSubmitBtn.disabled = true;
    incidentSubmitBtn.textContent = "Submitting...";

    try {
        await apiRequest("/incidents/report", {
            method: "POST",
            body: JSON.stringify({ type, lat, lng, reportedBy })
        });
        setStatus("Incident submitted successfully.", "ok");
        incidentLatInput.value = "";
        incidentLngInput.value = "";
        await loadIncidents();
    } catch (error) {
        setStatus(error.message || "Unable to submit incident.", "error");
    } finally {
        incidentSubmitBtn.disabled = false;
        incidentSubmitBtn.textContent = "Add Incident";
    }
}

async function activateEmergencyCorridor() {
    const source = parseLatLng(emergencySourceInput.value);
    const destination = parseLatLng(emergencyDestinationInput.value);
    const radiusMeters = Number(emergencyRadiusInput.value || 1200);

    if (!source || !destination) {
        setEmergencyStatus("Start and destination must be in lat,lng format.", "error");
        return;
    }

    emergencyActivateBtn.disabled = true;
    emergencyActivateBtn.textContent = "Activating...";

    try {
        const payload = await apiRequest("/emergency/activate", {
            method: "POST",
            body: JSON.stringify({ source, destination, radiusMeters })
        });
        const impactedCount = Array.isArray(payload.impactedUsers) ? payload.impactedUsers.length : 0;
        setEmergencyStatus(
            `Emergency corridor activated. Radius ${payload.radiusMeters}m | Impacted users: ${impactedCount}`,
            "ok"
        );
    } catch (error) {
        setEmergencyStatus(error.message || "Unable to activate emergency corridor.", "error");
    } finally {
        emergencyActivateBtn.disabled = false;
        emergencyActivateBtn.textContent = "Activate Corridor";
    }
}

async function deactivateEmergencyCorridor() {
    emergencyDeactivateBtn.disabled = true;
    emergencyDeactivateBtn.textContent = "Stopping...";
    try {
        await apiRequest("/emergency/deactivate", {
            method: "POST",
            body: JSON.stringify({})
        });
        setEmergencyStatus("Emergency corridor deactivated.", "ok");
    } catch (error) {
        setEmergencyStatus(error.message || "Unable to deactivate emergency corridor.", "error");
    } finally {
        emergencyDeactivateBtn.disabled = false;
        emergencyDeactivateBtn.textContent = "Deactivate";
    }
}

async function refreshAll() {
    const base = await detectApiBase();
    if (!base) {
        setStatus("Backend is not reachable right now.", "error");
        return;
    }

    await Promise.all([
        loadPriority(),
        loadIncidents(),
        loadEmergencyStatus(),
        loadUserLogs()
    ]);
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        void refreshAll();
    }, 20000);
}

function logout() {
    clearAuthSession();
    redirectToLogin();
}

function bindEvents() {
    priorityBtn.addEventListener("click", () => {
        void togglePriority();
    });

    refreshBtn.addEventListener("click", () => {
        void refreshAll();
    });

    incidentSubmitBtn.addEventListener("click", () => {
        void submitIncident();
    });

    emergencyActivateBtn.addEventListener("click", () => {
        void activateEmergencyCorridor();
    });

    emergencyDeactivateBtn.addEventListener("click", () => {
        void deactivateEmergencyCorridor();
    });

    document.getElementById("logout-btn")?.addEventListener("click", logout);
    window.addEventListener("online", () => setConnectionState(true));
    window.addEventListener("offline", () => setConnectionState(false));
}

function bootstrap() {
    if (!enforceAdminSession()) return;
    adminUser.textContent = getStoredUsername();

    const userPortalLink = document.getElementById("user-dashboard-link");
    if (userPortalLink) {
        userPortalLink.href = shouldUseRoutePaths() ? userPortalRoute : userPortalPath;
    }

    incidentReporterInput.value = getStoredUsername();
    bindEvents();
    void refreshAll();
    startAutoRefresh();
}

bootstrap();
