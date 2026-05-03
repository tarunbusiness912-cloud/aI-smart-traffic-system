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

// ✅ CREATE APP FIRST
const app = express();
const PORT = Number(process.env.PORT || 8080);

// ✅ SIMPLE + WORKING CORS
const allowedOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:3000",
    "https://ai-smart-traffic-congestion-and-pre.vercel.app",
    "https://ai-smart-traffic-congestion-and-21ae.onrender.com"
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            console.log("Blocked by CORS:", origin);
            return callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));

// ✅ FIREBASE INIT
const firebaseStatus = initFirebase();
if (firebaseStatus.enabled) {
    console.log("[TrafficAI] Firebase connected.");
} else {
    console.warn(`[TrafficAI] ${firebaseStatus.reason}`);
}

// ✅ HEALTH CHECK
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        service: "trafficai-backend",
        firebase: getFirebaseStatus(),
        time: new Date().toISOString()
    });
});

// ✅ ROUTES
app.use("/api/search", searchRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/traffic", trafficRoutes);

// ✅ TEST ROUTES
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
        level: result.level
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
                duration: 150
            },
            {
                type: "Best Route",
                distance: 130,
                duration: 140
            },
            {
                type: "Fuel Efficient",
                distance: 140,
                duration: 160
            }
        ]
    });
});

// ✅ STATIC FILES
const webRoot = path.resolve(__dirname, "..");

app.use(express.static(webRoot));

app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
        return res.sendFile(path.join(webRoot, "loged.html"));
    }
    res.status(404).json({ error: "Endpoint not found" });
});

// ✅ ERROR HANDLER
app.use((error, _req, res, _next) => {
    console.error("[TrafficAI] Error:", error);
    res.status(500).json({ error: error.message });
});

// ✅ START SERVER
app.listen(PORT, () => {
    console.log(`[TrafficAI] Server running on port ${PORT}`);
});