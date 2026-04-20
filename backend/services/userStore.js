const crypto = require("crypto");
const { getDb, isFirebaseEnabled } = require("../firebase");

const memoryUsers = new Map();

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

    const item = memoryUsers.get(usernameLower);
    if (!item) return null;
    return {
        ...item,
        source: "memory"
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

    memoryUsers.set(usernameLower, userRecord);
    return {
        created: true,
        source: "memory",
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

    return [...memoryUsers.values()]
        .slice(0, Math.max(1, Number(limit) || 200))
        .map((data) => ({
            username: data.username || data.usernameLower || "",
            usernameLower: data.usernameLower || normalizeUsername(data.username || ""),
            phone: data.phone || "",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            source: "memory"
        }));
}

module.exports = {
    saveUser,
    findUserByUsername,
    verifyUserCredentials,
    normalizeUsername,
    listUsers
};
