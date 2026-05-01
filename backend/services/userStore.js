const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getDb, isFirebaseEnabled } = require("../firebase");

const memoryUsers = new Map();
const localStoreDir = path.join(__dirname, "..", ".local-store");
const localStoreFile = path.join(localStoreDir, "users.json");
let localUsersLoaded = false;
let localWriteQueue = Promise.resolve();

function normalizeUsername(value = "") {
    return String(value).trim().toLowerCase();
}

function sanitizeUsername(value = "") {
    return String(value).trim();
}

function sanitizePhone(value = "") {
    return String(value).trim();
}

function encodeDocId(usernameLower) {
    return Buffer.from(usernameLower, "utf8").toString("base64url");
}

function normalizeRecord(record = {}) {
    const username = sanitizeUsername(record.username || record.usernameLower || "");
    const usernameLower = normalizeUsername(record.usernameLower || username);
    const phone = sanitizePhone(record.phone || "");
    const passwordHash = String(record.passwordHash || "");
    const passwordSalt = String(record.passwordSalt || "");
    const createdAt = record.createdAt ? String(record.createdAt) : null;
    const updatedAt = record.updatedAt ? String(record.updatedAt) : null;

    if (!usernameLower || !passwordHash || !passwordSalt) return null;

    return {
        username: username || usernameLower,
        usernameLower,
        phone,
        passwordHash,
        passwordSalt,
        createdAt,
        updatedAt
    };
}

async function loadLocalUsersIfNeeded() {
    if (localUsersLoaded || isFirebaseEnabled()) return;
    localUsersLoaded = true;

    try {
        const raw = await fs.promises.readFile(localStoreFile, "utf8");
        const parsed = JSON.parse(raw);
        const users = Array.isArray(parsed?.users) ? parsed.users : [];

        users.forEach((item) => {
            const normalized = normalizeRecord(item);
            if (normalized) {
                memoryUsers.set(normalized.usernameLower, normalized);
            }
        });
    } catch (error) {
        if (error && error.code !== "ENOENT") {
            console.warn("[TrafficAI] Unable to load local users store:", error.message);
        }
    }
}

async function persistLocalUsers() {
    if (isFirebaseEnabled()) return;
    await loadLocalUsersIfNeeded();

    const snapshot = {
        version: 1,
        updatedAt: new Date().toISOString(),
        users: [...memoryUsers.values()].map((item) => ({
            username: item.username,
            usernameLower: item.usernameLower,
            phone: item.phone,
            passwordHash: item.passwordHash,
            passwordSalt: item.passwordSalt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        }))
    };

    localWriteQueue = localWriteQueue.then(async () => {
        await fs.promises.mkdir(localStoreDir, { recursive: true });
        await fs.promises.writeFile(localStoreFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    });

    try {
        await localWriteQueue;
    } catch (error) {
        console.warn("[TrafficAI] Unable to persist local users store:", error.message);
    }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (error, derivedKey) => {
            if (error) return reject(error);
            return resolve({
                salt,
                hash: derivedKey.toString("hex")
            });
        });
    });
}

function verifyHashedPassword(password, salt, expectedHash) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), String(salt), 64, (error, derivedKey) => {
            if (error) return reject(error);

            const currentHashBuffer = Buffer.from(derivedKey.toString("hex"), "hex");
            const expectedHashBuffer = Buffer.from(String(expectedHash || ""), "hex");
            if (currentHashBuffer.length !== expectedHashBuffer.length) {
                return resolve(false);
            }

            return resolve(crypto.timingSafeEqual(currentHashBuffer, expectedHashBuffer));
        });
    });
}

async function findUserByUsername(username) {
    const usernameLower = normalizeUsername(username);
    if (!usernameLower) return null;

    if (isFirebaseEnabled()) {
        const db = getDb();
        const doc = await db.collection("users").doc(encodeDocId(usernameLower)).get();
        if (!doc.exists) return null;
        const data = doc.data() || {};
        return {
            username: data.username || usernameLower,
            usernameLower,
            phone: data.phone || "",
            passwordHash: data.passwordHash || "",
            passwordSalt: data.passwordSalt || "",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            source: "firestore"
        };
    }

    await loadLocalUsersIfNeeded();

    const item = memoryUsers.get(usernameLower);
    if (!item) return null;
    return {
        ...item,
        source: "local-file"
    };
}

async function saveUser({ username, password, phone }) {
    const cleanUsername = sanitizeUsername(username);
    const cleanPhone = sanitizePhone(phone);
    const usernameLower = normalizeUsername(cleanUsername);

    if (!cleanUsername || !password || !cleanPhone) {
        throw new Error("username, password, and phone are required");
    }

    const existing = await findUserByUsername(cleanUsername);
    if (existing) {
        return {
            created: false,
            reason: "exists"
        };
    }

    const { hash, salt } = await hashPassword(password);
    const now = new Date().toISOString();
    const userRecord = {
        username: cleanUsername,
        usernameLower,
        phone: cleanPhone,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: now,
        updatedAt: now
    };

    if (isFirebaseEnabled()) {
        const db = getDb();
        await db.collection("users").doc(encodeDocId(usernameLower)).set(userRecord, { merge: false });
        return {
            created: true,
            source: "firestore",
            user: {
                username: cleanUsername,
                phone: cleanPhone
            }
        };
    }

    await loadLocalUsersIfNeeded();
    memoryUsers.set(usernameLower, userRecord);
    await persistLocalUsers();
    return {
        created: true,
        source: "local-file",
        user: {
            username: cleanUsername,
            phone: cleanPhone
        }
    };
}

async function verifyUserCredentials({ username, password }) {
    const user = await findUserByUsername(username);
    if (!user) {
        return {
            ok: false,
            reason: "not_found"
        };
    }

    const passwordMatches = await verifyHashedPassword(password, user.passwordSalt, user.passwordHash);
    if (!passwordMatches) {
        return {
            ok: false,
            reason: "invalid_password"
        };
    }

    return {
        ok: true,
        source: user.source,
        user: {
            username: user.username,
            phone: user.phone
        }
    };
}

async function listUsers(limit = 200) {
    if (isFirebaseEnabled()) {
        const db = getDb();
        const snapshot = await db.collection("users").limit(Math.max(1, Number(limit) || 200)).get();
        return snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                username: data.username || data.usernameLower || "",
                usernameLower: data.usernameLower || normalizeUsername(data.username || ""),
                phone: data.phone || "",
                createdAt: data.createdAt || null,
                updatedAt: data.updatedAt || null,
                source: "firestore"
            };
        });
    }

    await loadLocalUsersIfNeeded();

    return [...memoryUsers.values()]
        .slice(0, Math.max(1, Number(limit) || 200))
        .map((data) => ({
            username: data.username || data.usernameLower || "",
            usernameLower: data.usernameLower || normalizeUsername(data.username || ""),
            phone: data.phone || "",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            source: "local-file"
        }));
}

module.exports = {
    saveUser,
    findUserByUsername,
    verifyUserCredentials,
    normalizeUsername,
    listUsers
};
