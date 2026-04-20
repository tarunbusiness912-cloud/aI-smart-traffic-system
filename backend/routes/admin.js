const express = require("express");
const jwt = require("jsonwebtoken");
const { getAuth, getDb, isFirebaseEnabled } = require("../firebase");
const { memoryIncidents } = require("./incidents");
const { listUsers, normalizeUsername } = require("../services/userStore");
const { getLatestSearchesByUserIds } = require("./searches");

const router = express.Router();
const memorySettings = {
    ambulancePriority: false,
    updatedAt: Date.now(),
    updatedBy: "system"
};

function getJwtSecret() {
    return process.env.JWT_SECRET || "trafficai-dev-jwt-secret";
}

function createAdminToken(payload) {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: "8h" });
}

function verifyAdminToken(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing admin token" });

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        req.admin = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired admin token", message: error.message });
    }
}

function isAuthorizedFirebaseAdmin(decodedToken = {}) {
    if (decodedToken.admin === true) return true;
    const allowedAdminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase();
    if (allowedAdminEmail && String(decodedToken.email || "").toLowerCase() === allowedAdminEmail) return true;
    return false;
}

router.post("/login", async (req, res) => {
    const { idToken, email, password } = req.body || {};

    if (idToken && isFirebaseEnabled()) {
        try {
            const auth = getAuth();
            const decodedToken = await auth.verifyIdToken(idToken);
            if (!isAuthorizedFirebaseAdmin(decodedToken)) {
                return res.status(403).json({ error: "User is not authorized as admin" });
            }

            const token = createAdminToken({
                uid: decodedToken.uid,
                email: decodedToken.email || null,
                role: "admin"
            });

            return res.json({
                ok: true,
                source: "firebase",
                token
            });
        } catch (error) {
            return res.status(401).json({ error: "Firebase admin login failed", message: error.message });
        }
    }

    const envEmail = String(process.env.ADMIN_EMAIL || "");
    const envPassword = String(process.env.ADMIN_PASSWORD || "");
    if (email && password && email === envEmail && password === envPassword) {
        const token = createAdminToken({
            uid: "env-admin",
            email,
            role: "admin"
        });
        return res.json({
            ok: true,
            source: "env",
            token
        });
    }

    return res.status(401).json({
        error: "Admin login failed. Provide Firebase ID token or valid ADMIN_EMAIL / ADMIN_PASSWORD."
    });
});

router.get("/pending-incidents", verifyAdminToken, async (_req, res) => {
    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const snapshot = await db.collection("incidents").where("status", "==", "pending").limit(150).get();
            const incidents = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

            return res.json({
                ok: true,
                source: "firestore",
                incidents
            });
        }

        const incidents = memoryIncidents
            .filter((item) => item.status === "pending")
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

        return res.json({
            ok: true,
            source: "memory",
            incidents
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to fetch pending incidents", message: error.message });
    }
});

router.get("/priority", async (_req, res) => {
    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            const doc = await db.collection("settings").doc("trafficControl").get();
            const data = doc.exists ? doc.data() : {};
            return res.json({
                ok: true,
                source: "firestore",
                ambulancePriority: Boolean(data.ambulancePriority)
            });
        }

        return res.json({
            ok: true,
            source: "memory",
            ambulancePriority: Boolean(memorySettings.ambulancePriority)
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to fetch priority setting", message: error.message });
    }
});

router.post("/toggle-priority", verifyAdminToken, async (req, res) => {
    try {
        const requested = req.body?.ambulancePriority;

        if (isFirebaseEnabled()) {
            const db = getDb();
            const docRef = db.collection("settings").doc("trafficControl");
            const currentDoc = await docRef.get();
            const current = Boolean(currentDoc.exists ? currentDoc.data().ambulancePriority : false);
            const nextValue = typeof requested === "boolean" ? requested : !current;

            await docRef.set(
                {
                    ambulancePriority: nextValue,
                    updatedAt: Date.now(),
                    updatedBy: req.admin?.email || "admin"
                },
                { merge: true }
            );

            return res.json({
                ok: true,
                source: "firestore",
                ambulancePriority: nextValue
            });
        }

        memorySettings.ambulancePriority =
            typeof requested === "boolean" ? requested : !memorySettings.ambulancePriority;
        memorySettings.updatedAt = Date.now();
        memorySettings.updatedBy = req.admin?.email || "admin";

        return res.json({
            ok: true,
            source: "memory",
            ambulancePriority: memorySettings.ambulancePriority
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to toggle ambulance priority", message: error.message });
    }
});

router.post("/verify-incident/:id", verifyAdminToken, async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Incident id is required" });

    try {
        if (isFirebaseEnabled()) {
            const db = getDb();
            await db.collection("incidents").doc(id).set(
                {
                    status: "verified",
                    verifiedAt: Date.now(),
                    verifiedBy: req.admin?.email || "admin"
                },
                { merge: true }
            );

            return res.json({
                ok: true,
                source: "firestore",
                id,
                status: "verified"
            });
        }

        const target = memoryIncidents.find((incident) => incident.id === id);
        if (!target) return res.status(404).json({ error: "Incident not found" });
        target.status = "verified";
        target.verifiedAt = Date.now();
        target.verifiedBy = req.admin?.email || "admin";

        return res.json({
            ok: true,
            source: "memory",
            id,
            status: "verified"
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to verify incident", message: error.message });
    }
});

router.get("/user-logs", verifyAdminToken, async (_req, res) => {
    try {
        const users = await listUsers(300);
        if (!users.length) {
            return res.json({
                ok: true,
                users: []
            });
        }

        const userIdCandidates = [];
        users.forEach((user) => {
            const username = String(user.username || "").trim();
            const usernameLower = String(user.usernameLower || normalizeUsername(username));
            if (username) userIdCandidates.push(username);
            if (usernameLower) userIdCandidates.push(usernameLower);
        });

        const latestByUserId = await getLatestSearchesByUserIds(userIdCandidates);
        const rows = users.map((user) => {
            const username = String(user.username || "").trim();
            const usernameLower = String(user.usernameLower || normalizeUsername(username));
            const latestSearch =
                latestByUserId[usernameLower] ||
                latestByUserId[username] ||
                null;

            return {
                username: username || usernameLower,
                phone: user.phone || "",
                createdAt: user.createdAt || null,
                updatedAt: user.updatedAt || null,
                source: user.source || "memory",
                lastSearch: latestSearch
                    ? {
                          origin: latestSearch.origin || "",
                          destination: latestSearch.destination || "",
                          routeMode: latestSearch.routeMode || "default",
                          timestamp: latestSearch.timestamp || null,
                          createdAt: latestSearch.createdAt || null
                      }
                    : null
            };
        });

        rows.sort((a, b) => {
            const aTs = Number(a.lastSearch?.timestamp || 0);
            const bTs = Number(b.lastSearch?.timestamp || 0);
            return bTs - aTs;
        });

        return res.json({
            ok: true,
            users: rows
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to fetch user logs", message: error.message });
    }
});

module.exports = router;
