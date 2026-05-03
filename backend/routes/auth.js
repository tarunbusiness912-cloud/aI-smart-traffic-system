const express = require("express");
const jwt = require("jsonwebtoken");
const { saveUser, verifyUserCredentials, normalizeUsername } = require("../services/userStore");

const router = express.Router();
const DEFAULT_ADMIN_USERNAME = "admin@trafficai.local";
const ADMIN_ALIASES = new Set(["admin"]);

function getJwtSecret() {
    return process.env.JWT_SECRET || "trafficai-dev-jwt-secret";
}

function createSessionToken(payload) {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: "8h" });
}

function getConfiguredAdminUsername() {
    const fromEnv = normalizeUsername(process.env.ADMIN_EMAIL || "");
    return fromEnv || DEFAULT_ADMIN_USERNAME;
}

function getConfiguredAdminPassword() {
    return String(process.env.ADMIN_PASSWORD || "trafficai-admin-123");
}

function isValidPhone(phone) {
    return /^[0-9+\-\s()]{8,20}$/.test(String(phone || "").trim());
}

function isValidUsername(username) {
    return String(username || "").trim().length >= 3;
}

function isValidPassword(password) {
    return String(password || "").length >= 6;
}

function buildPortalRoute(role) {
    return role === "admin" ? "/admin-portal" : "/user-dashboard";
}

function isAdminLoginName(normalizedUsername, configuredAdminUsername) {
    if (!normalizedUsername) return false;
    return (
        normalizedUsername === DEFAULT_ADMIN_USERNAME ||
        normalizedUsername === configuredAdminUsername ||
        ADMIN_ALIASES.has(normalizedUsername)
    );
}

router.post("/signup", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const phone = String(req.body?.phone || "").trim();

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (!isValidPassword(password)) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: "Phone number format is invalid." });
    }

    const normalized = normalizeUsername(username);
    if (isAdminLoginName(normalized, getConfiguredAdminUsername())) {
        return res.status(403).json({ error: "Admin username is reserved and cannot be used for signup." });
    }

    try {
        const saveResult = await saveUser({ username, password, phone });
        if (!saveResult.created) {
            return res.status(409).json({ error: "User already exists." });
        }

        const token = createSessionToken({
            sub: normalizeUsername(username),
            username,
            role: "user"
        });

        return res.status(201).json({
            ok: true,
            role: "user",
            source: saveResult.source,
            redirect: buildPortalRoute("user"),
            token,
            user: {
                username,
                phone
            }
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to create account.", message: error.message });
    }
});

router.post("/login", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const normalized = normalizeUsername(username);

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    const configuredAdminUsername = getConfiguredAdminUsername();
    if (isAdminLoginName(normalized, configuredAdminUsername)) {
        const expectedPassword = getConfiguredAdminPassword();
        if (password !== expectedPassword) {
            return res.status(401).json({ error: "Invalid admin credentials." });
        }

        const token = createSessionToken({
            sub: normalized,
            username: DEFAULT_ADMIN_USERNAME,
            role: "admin"
        });

        return res.json({
            ok: true,
            role: "admin",
            source: "env",
            redirect: buildPortalRoute("admin"),
            token,
            user: {
                username: DEFAULT_ADMIN_USERNAME
            }
        });
    }

    try {
        const result = await verifyUserCredentials({ username, password });
        if (!result.ok) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        const token = createSessionToken({
            sub: normalizeUsername(result.user.username),
            username: result.user.username,
            role: "user"
        });

        return res.json({
            ok: true,
            role: "user",
            source: result.source,
            redirect: buildPortalRoute("user"),
            token,
            user: {
                username: result.user.username,
                phone: result.user.phone
            }
        });
    } catch (error) {
        return res.status(500).json({ error: "Unable to login.", message: error.message });
    }
});

module.exports = router;
