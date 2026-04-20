const express = require("express");
const { getDb, isFirebaseEnabled } = require("../firebase");

const router = express.Router();
const memorySearches = [];

function shapeSearchRecord(input = {}) {
    const now = Date.now();
    return {
        origin: String(input.origin || "").trim(),
        destination: String(input.destination || "").trim(),
        purpose: String(input.purpose || "personal").trim(),
        priority: String(input.priority || "normal").trim(),
        routeMode: String(input.routeMode || "default").trim(),
        distanceKm: Number(input.distanceKm || 0),
        durationMins: Number(input.durationMins || 0),
        userId: String(input.userId || "anonymous").trim(),
        timestamp: now,
        createdAt: new Date(now).toISOString()
    };
}

function validateSearchPayload(payload) {
    if (!payload.origin) return "origin is required";
    if (!payload.destination) return "destination is required";
    if (!payload.userId) return "userId is required";
    return null;
}

router.post("/save", async (req, res) => {
    const payload = shapeSearchRecord(req.body);
    const validationError = validateSearchPayload(payload);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const writeResult = await db.collection("searches").add(payload);
            return res.status(201).json({
                ok: true,
                source: "firestore",
                id: writeResult.id
            });
        }

        memorySearches.unshift({ ...payload, id: `mem-${payload.timestamp}` });
        while (memorySearches.length > 250) memorySearches.pop();
        return res.status(201).json({
            ok: true,
            source: "memory",
            id: memorySearches[0].id
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to save search", message: error.message });
    }
});

router.get("/user/:uid", async (req, res) => {
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ error: "uid is required" });

    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const snapshot = await db.collection("searches").where("userId", "==", uid).limit(50).get();
            const items = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
                .slice(0, 12);

            return res.json({
                ok: true,
                source: "firestore",
                items
            });
        }

        const items = memorySearches
            .filter((entry) => entry.userId === uid)
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
            .slice(0, 12);

        return res.json({
            ok: true,
            source: "memory",
            items
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to fetch user searches", message: error.message });
    }
});

async function getLatestSearchForUser(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return null;

    if (isFirebaseEnabled()) {
        const db = getDb();
        const snapshot = await db
            .collection("searches")
            .where("userId", "==", uid)
            .limit(25)
            .get();
        const latest = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
        return latest || null;
    }

    const found = memorySearches
        .filter((entry) => entry.userId === uid)
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
    return found || null;
}

async function getLatestSearchesByUserIds(userIds = []) {
    const result = {};
    const ids = [...new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
    for (const userId of ids) {
        // Sequential lookup keeps firestore query usage predictable.
        // eslint-disable-next-line no-await-in-loop
        result[userId] = await getLatestSearchForUser(userId);
    }
    return result;
}

module.exports = router;
module.exports.memorySearches = memorySearches;
module.exports.getLatestSearchForUser = getLatestSearchForUser;
module.exports.getLatestSearchesByUserIds = getLatestSearchesByUserIds;
