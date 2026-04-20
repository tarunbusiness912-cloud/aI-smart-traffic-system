const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const emergencyState = {
    active: false,
    routeCoordinates: [], // [lon, lat]
    radiusMeters: 1200,
    source: null,
    destination: null,
    routeMeta: {
        distanceMeters: 0,
        durationSeconds: 0
    },
    activatedAt: 0,
    updatedAt: 0,
    updatedBy: "system"
};

const userLocations = new Map();

function getJwtSecret() {
    return process.env.JWT_SECRET || "trafficai-dev-jwt-secret";
}

function verifyAdminToken(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing admin token" });

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        if (String(decoded?.role || "").toLowerCase() !== "admin") {
            return res.status(403).json({ error: "Admin role required" });
        }
        req.admin = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired admin token", message: error.message });
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function haversineMeters(aLat, aLon, bLat, bLon) {
    const dLat = toRadians(bLat - aLat);
    const dLon = toRadians(bLon - aLon);
    const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function computeDistanceToRouteMeters(routeCoordinates = [], lat, lon) {
    if (!routeCoordinates.length) return Number.POSITIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    const step = Math.max(1, Math.floor(routeCoordinates.length / 250));

    for (let index = 0; index < routeCoordinates.length; index += step) {
        const point = routeCoordinates[index];
        const pointLon = Number(point?.[0]);
        const pointLat = Number(point?.[1]);
        if (!Number.isFinite(pointLat) || !Number.isFinite(pointLon)) continue;
        const distance = haversineMeters(pointLat, pointLon, lat, lon);
        if (distance < min) min = distance;
    }

    return min;
}

function getCurrentEmergencyVehiclePoint() {
    if (!emergencyState.active || !emergencyState.routeCoordinates.length) return null;
    const coords = emergencyState.routeCoordinates;
    if (coords.length === 1) {
        return { lon: Number(coords[0][0]), lat: Number(coords[0][1]), index: 0 };
    }

    const duration = Math.max(
        90,
        Number(emergencyState.routeMeta?.durationSeconds || 0) || Math.round(coords.length * 1.4)
    );
    const elapsedSeconds = Math.max(0, (Date.now() - Number(emergencyState.activatedAt || Date.now())) / 1000);
    const progress = clamp(elapsedSeconds / duration, 0, 1);
    const index = clamp(Math.round(progress * (coords.length - 1)), 0, coords.length - 1);
    return {
        lon: Number(coords[index][0]),
        lat: Number(coords[index][1]),
        index
    };
}

function normalizeLatLngPair(pair = {}) {
    const lat = Number(pair.lat);
    const lng = Number(pair.lng ?? pair.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

async function fetchOptimalEmergencyRoute({ source, destination }) {
    const osrmBase =
        process.env.OSRM_ROUTE_BASE ||
        "https://router.project-osrm.org/route/v1/driving";

    const url = new URL(
        `${osrmBase}/${source.lng},${source.lat};${destination.lng},${destination.lat}`
    );
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("steps", "true");

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Routing API error ${response.status}`);
    }

    const data = await response.json();
    if (data.code && data.code !== "Ok") {
        throw new Error(data.message || data.code || "Routing failed");
    }

    const route = data.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || !coordinates.length) {
        throw new Error("No emergency route found");
    }

    return {
        coordinates,
        distanceMeters: Number(route.distance || 0),
        durationSeconds: Number(route.duration || 0)
    };
}

function setEmergencyState({
    routeCoordinates,
    radiusMeters,
    source,
    destination,
    updatedBy,
    routeMeta
}) {
    emergencyState.active = true;
    emergencyState.routeCoordinates = routeCoordinates;
    emergencyState.radiusMeters = clamp(Number(radiusMeters || 1200), 200, 5000);
    emergencyState.source = source || null;
    emergencyState.destination = destination || null;
    emergencyState.routeMeta = {
        distanceMeters: Number(routeMeta?.distanceMeters || 0),
        durationSeconds: Number(routeMeta?.durationSeconds || 0)
    };
    emergencyState.activatedAt = Date.now();
    emergencyState.updatedAt = Date.now();
    emergencyState.updatedBy = updatedBy || "admin";
}

function clearEmergencyState(updatedBy = "admin") {
    emergencyState.active = false;
    emergencyState.routeCoordinates = [];
    emergencyState.radiusMeters = 1200;
    emergencyState.source = null;
    emergencyState.destination = null;
    emergencyState.routeMeta = { distanceMeters: 0, durationSeconds: 0 };
    emergencyState.activatedAt = 0;
    emergencyState.updatedAt = Date.now();
    emergencyState.updatedBy = updatedBy;
}

function buildUserAlert(userId, location) {
    const payload = {
        userId,
        active: Boolean(emergencyState.active),
        shouldClearPath: false,
        severity: "none",
        distanceToRouteMeters: null,
        distanceToVehicleMeters: null,
        message: ""
    };

    if (!emergencyState.active || !location || !emergencyState.routeCoordinates.length) {
        return payload;
    }

    const distanceToRouteMeters = computeDistanceToRouteMeters(
        emergencyState.routeCoordinates,
        Number(location.lat),
        Number(location.lng)
    );

    payload.distanceToRouteMeters = Math.round(distanceToRouteMeters);
    if (distanceToRouteMeters > emergencyState.radiusMeters) {
        return payload;
    }

    const vehiclePoint = getCurrentEmergencyVehiclePoint();
    const distanceToVehicleMeters = vehiclePoint
        ? haversineMeters(
              Number(vehiclePoint.lat),
              Number(vehiclePoint.lon),
              Number(location.lat),
              Number(location.lng)
          )
        : null;

    payload.shouldClearPath = true;
    payload.distanceToVehicleMeters =
        distanceToVehicleMeters === null ? null : Math.round(distanceToVehicleMeters);

    if (distanceToVehicleMeters !== null && distanceToVehicleMeters <= 150) {
        payload.severity = "critical";
    } else if (distanceToVehicleMeters !== null && distanceToVehicleMeters <= 600) {
        payload.severity = "high";
    } else {
        payload.severity = "medium";
    }

    payload.message =
        payload.severity === "critical"
            ? "Emergency vehicle is extremely close. Clear the corridor immediately."
            : "Emergency vehicle route nearby. Please clear the lane and keep corridor open.";

    return payload;
}

function serializeEmergencyState() {
    const vehiclePoint = getCurrentEmergencyVehiclePoint();
    const impactedUsers = [...userLocations.entries()]
        .map(([userId, location]) => ({ userId, location, alert: buildUserAlert(userId, location) }))
        .filter((item) => item.alert.shouldClearPath)
        .map((item) => ({
            userId: item.userId,
            distanceToRouteMeters: item.alert.distanceToRouteMeters,
            distanceToVehicleMeters: item.alert.distanceToVehicleMeters,
            severity: item.alert.severity,
            updatedAt: item.location.updatedAt
        }))
        .sort((a, b) => Number(a.distanceToVehicleMeters || 999999) - Number(b.distanceToVehicleMeters || 999999));

    return {
        ok: true,
        active: Boolean(emergencyState.active),
        radiusMeters: emergencyState.radiusMeters,
        source: emergencyState.source,
        destination: emergencyState.destination,
        routeMeta: emergencyState.routeMeta,
        vehiclePosition: vehiclePoint,
        updatedAt: emergencyState.updatedAt,
        updatedBy: emergencyState.updatedBy,
        impactedUsers
    };
}

router.get("/status", (_req, res) => {
    res.json(serializeEmergencyState());
});

router.post("/activate", verifyAdminToken, async (req, res) => {
    const source = normalizeLatLngPair(req.body?.source || {});
    const destination = normalizeLatLngPair(req.body?.destination || {});
    const radiusMeters = Number(req.body?.radiusMeters || 1200);

    let routeCoordinates = Array.isArray(req.body?.routeCoordinates)
        ? req.body.routeCoordinates
              .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
              .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
        : [];

    try {
        let routeMeta = {
            distanceMeters: 0,
            durationSeconds: 0
        };

        if (!routeCoordinates.length) {
            if (!source || !destination) {
                return res.status(400).json({
                    error: "source and destination coordinates are required when routeCoordinates are not provided"
                });
            }

            const routeResult = await fetchOptimalEmergencyRoute({ source, destination });
            routeCoordinates = routeResult.coordinates;
            routeMeta = {
                distanceMeters: routeResult.distanceMeters,
                durationSeconds: routeResult.durationSeconds
            };
        }

        if (!routeCoordinates.length) {
            return res.status(400).json({ error: "Unable to determine emergency route coordinates" });
        }

        setEmergencyState({
            routeCoordinates,
            radiusMeters,
            source,
            destination,
            updatedBy: req.admin?.username || req.admin?.email || "admin",
            routeMeta
        });

        return res.json(serializeEmergencyState());
    } catch (error) {
        return res.status(500).json({ error: "Unable to activate emergency corridor", message: error.message });
    }
});

router.post("/deactivate", verifyAdminToken, (req, res) => {
    clearEmergencyState(req.admin?.username || req.admin?.email || "admin");
    res.json(serializeEmergencyState());
});

router.post("/user-location", async (req, res) => {
    const userId = String(req.body?.userId || "").trim().toLowerCase();
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);

    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "Valid lat and lng are required" });
    }

    const location = {
        lat,
        lng,
        updatedAt: Date.now()
    };
    userLocations.set(userId, location);

    const alert = buildUserAlert(userId, location);
    return res.json({
        ok: true,
        userId,
        location,
        alert,
        emergency: {
            active: emergencyState.active,
            radiusMeters: emergencyState.radiusMeters
        }
    });
});

router.get("/alerts/:userId", (req, res) => {
    const userId = String(req.params.userId || "").trim().toLowerCase();
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const location = userLocations.get(userId) || null;
    const alert = buildUserAlert(userId, location);
    return res.json({
        ok: true,
        userId,
        hasLocation: Boolean(location),
        alert,
        emergency: {
            active: emergencyState.active,
            radiusMeters: emergencyState.radiusMeters,
            vehiclePosition: getCurrentEmergencyVehiclePoint()
        }
    });
});

module.exports = {
    router,
    emergencyState,
    userLocations,
    buildUserAlert,
    verifyAdminToken
};