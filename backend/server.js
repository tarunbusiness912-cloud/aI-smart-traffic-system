const path = require("path");
const express = require("express");
const cors = require("cors");
const { initFirebase, getFirebaseStatus } = require("./firebase");
const searchRoutes = require("./routes/searches");
const { router: incidentRoutes } = require("./routes/incidents");
const adminRoutes = require("./routes/admin");
const authRoutes = require("./routes/auth");
const { router: emergencyRoutes } = require("./routes/emergency");
const { router: trafficRoutes, calculateTrafficPrediction } = require("./routes/traffic");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 8080);

const fallbackOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:3000",
<<<<<<< HEAD
    "http://localhost:3000",
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`
];
const configuredOrigins = (process.env.CORS_ORIGINS || fallbackOrigins.join(","))
=======
    "http://localhost:3000"
];
const renderExternalUrl = String(process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
if (renderExternalUrl) {
    fallbackOrigins.push(renderExternalUrl);
}
const allowedOrigins = (process.env.CORS_ORIGINS || fallbackOrigins.join(","))
>>>>>>> 34b413703414eb9233785b577a1c6385eae1426a
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

<<<<<<< HEAD
function parseOriginPattern(value) {
    if (!value.includes("*")) return null;
    const escaped = value
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
}

const allowedOrigins = configuredOrigins.filter((item) => !item.includes("*"));
const allowedOriginPatterns = configuredOrigins
    .map((item) => parseOriginPattern(item))
    .filter(Boolean);

function isSameHostOrigin(origin, requestHost) {
    if (!origin || !requestHost) return false;
    try {
        return new URL(origin).host.toLowerCase() === String(requestHost).toLowerCase();
    } catch (_error) {
        return false;
    }
}

function isLocalhostOrigin(origin) {
    if (!origin) return false;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1";
    } catch (_error) {
        return false;
    }
}

function isOriginAllowed(origin) {
    if (!origin || origin === "null") return true;
    if (isLocalhostOrigin(origin)) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (allowedOriginPatterns.some((pattern) => pattern.test(origin))) return true;
    return false;
}

app.use(
    cors((req, callback) => {
        const requestOrigin = req.header("origin");
        const requestHost = req.header("host");
        if (isOriginAllowed(requestOrigin) || isSameHostOrigin(requestOrigin, requestHost)) {
            return callback(null, {
                origin: true,
                credentials: true
            });
        }
        return callback(new Error(`CORS blocked for origin: ${requestOrigin || "unknown"}`));
=======
app.use(
    cors({
        origin(origin, callback) {
            if (!origin || origin === "null" || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error(`CORS blocked for origin: ${origin}`));
        },
        credentials: true
>>>>>>> 34b413703414eb9233785b577a1c6385eae1426a
    })
);
app.use(express.json({ limit: "1mb" }));

const firebaseStatus = initFirebase();
if (firebaseStatus.enabled) {
    console.log("[TrafficAI] Firebase connected.");
} else {
    console.warn(`[TrafficAI] ${firebaseStatus.reason}`);
}

app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        service: "trafficai-backend",
        firebase: getFirebaseStatus(),
        time: new Date().toISOString()
    });
});

app.use("/api/search", searchRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/traffic", trafficRoutes);

// Compatibility endpoints for existing clients.
app.get("/predict", (req, res) => {
    const hour = Number(req.query.hour || 8);
    const day = String(req.query.day || "0");
    const normalizedDay = day === "1" ? "weekend" : "weekday";
    const result = calculateTrafficPrediction({
        day: normalizedDay,
        time: `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:00`
    });
    res.json({
        score: result.score,
        level: result.level,
        congestion_level: result.level,
        congestion_score: result.score
    });
});

app.get("/weather", (_req, res) => {
    const weatherTypes = ["Sunny", "Rainy", "Cloudy", "Stormy"];
    const randomWeather = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];
    res.json({
        weather: randomWeather,
        temperature: Math.floor(Math.random() * 10) + 25,
        humidity: Math.floor(Math.random() * 40) + 40
    });
});

app.get("/route", (_req, res) => {
    res.json({
        routes: [
            {
                type: "Shortest Route",
                distance: 120,
                duration: 150,
                color: "blue",
                path: [[12.97, 77.59], [13.0, 77.6]]
            },
            {
                type: "Best Route",
                distance: 130,
                duration: 140,
                color: "green",
                path: [[12.97, 77.59], [13.1, 77.65]]
            },
            {
                type: "Fuel Efficient",
                distance: 140,
                duration: 160,
                color: "orange",
                path: [[12.97, 77.59], [13.2, 77.7]]
            }
        ]
    });
});

const webRoot = path.resolve(__dirname, "..");
const webRoutes = {
    "/": "loged.html",
    "/login": "loged.html",
    "/user-dashboard": "user-dashboard.html",
    "/admin-portal": "admin-portal.html"
};

app.use(
    express.static(webRoot, {
        index: false
    })
);

Object.entries(webRoutes).forEach(([routePath, fileName]) => {
    app.get(routePath, (_req, res) => {
        res.sendFile(path.join(webRoot, fileName));
    });
});

app.use((req, res) => {
    if (!req.path.startsWith("/api")) {
        return res.status(404).sendFile(path.join(webRoot, "loged.html"));
    }
    return res.status(404).json({ error: "Endpoint not found", path: req.originalUrl });
});

app.use((error, _req, res, _next) => {
    console.error("[TrafficAI] Unhandled error:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
});

app.listen(PORT, () => {
    console.log(`[TrafficAI] Server running on http://localhost:${PORT}`);
});
