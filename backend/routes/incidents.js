const express = require("express");
const { getDb, isFirebaseEnabled } = require("../firebase");

const router = express.Router();
const memoryIncidents = [];

function normalizeIncidentType(type = "") {
    const value = String(type).trim().toLowerCase();
    if (value === "roadwork" || value === "road work") return "Roadwork";
    return "Accident";
}

function mapIncidentPayload(body = {}) {
    const now = Date.now();
    return {
        type: normalizeIncidentType(body.type),
        lat: Number(body.lat),
        lng: Number(body.lng),
        status: String(body.status || "pending").toLowerCase(),
        reportedBy: String(body.reportedBy || "anonymous"),
        createdAt: new Date(now).toISOString(),
        timestamp: now
    };
}

function validateIncident(payload) {
    if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
        return "Valid lat and lng are required";
    }
    if (!["pending", "verified"].includes(payload.status)) {
        return "status must be pending or verified";
    }
    return null;
}

router.post("/report", async (req, res) => {
    const payload = mapIncidentPayload(req.body);
    payload.status = "pending";
    const errorMessage = validateIncident(payload);
    if (errorMessage) return res.status(400).json({ error: errorMessage });

    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const writeResult = await db.collection("incidents").add(payload);
            return res.status(201).json({
                ok: true,
                source: "firestore",
                id: writeResult.id
            });
        }

        const record = { ...payload, id: `mem-${payload.timestamp}` };
        memoryIncidents.unshift(record);
        while (memoryIncidents.length > 300) memoryIncidents.pop();
        return res.status(201).json({
            ok: true,
            source: "memory",
            id: record.id
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to report incident", message: error.message });
    }
});

router.get("/live", async (_req, res) => {
    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const snapshot = await db.collection("incidents").where("status", "==", "verified").limit(150).get();
            const items = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

            return res.json({
                ok: true,
                source: "firestore",
                incidents: items
            });
        }

        const incidents = memoryIncidents
            .filter((item) => item.status === "verified")
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

        return res.json({
            ok: true,
            source: "memory",
            incidents
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to fetch incidents", message: error.message });
    }
});

module.exports = {
    router,
    memoryIncidents
};
