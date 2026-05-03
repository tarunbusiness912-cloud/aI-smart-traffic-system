const admin = require("firebase-admin");

let firestore = null;
let firebaseAuth = null;
let status = {
    enabled: false,
    reason: "Firebase not initialized"
};

function normalizePrivateKey(value) {
    return value ? value.replace(/\\n/g, "\n") : "";
}

function buildServiceAccountFromEnv() {
    const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (inlineJson) {
        try {
            const parsed = JSON.parse(inlineJson);
            if (parsed.project_id && parsed.client_email && parsed.private_key) {
                return {
                    projectId: parsed.project_id,
                    clientEmail: parsed.client_email,
                    privateKey: normalizePrivateKey(parsed.private_key)
                };
            }
        } catch (error) {
            status = {
                enabled: false,
                reason: `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`
            };
            return null;
        }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!projectId || !clientEmail || !privateKey) {
        return null;
    }

    return { projectId, clientEmail, privateKey };
}

function initFirebase() {
    if (firestore && firebaseAuth) return status;

    const serviceAccount = buildServiceAccountFromEnv();
    if (!serviceAccount) {
        status = {
            enabled: false,
            reason: "Missing Firebase credentials in .env. Running in local fallback mode."
        };
        return status;
    }

    try {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: serviceAccount.projectId,
                    clientEmail: serviceAccount.clientEmail,
                    privateKey: serviceAccount.privateKey
                }),
                projectId: serviceAccount.projectId
            });
        }

        firestore = admin.firestore();
        firebaseAuth = admin.auth();
        status = {
            enabled: true,
            reason: "Firebase initialized successfully"
        };
    } catch (error) {
        status = {
            enabled: false,
            reason: `Firebase initialization failed: ${error.message}`
        };
    }

    return status;
}

function getDb() {
    return firestore;
}

function getAuth() {
    return firebaseAuth;
}

function isFirebaseEnabled() {
    return status.enabled;
}

function getFirebaseStatus() {
    return status;
}

module.exports = {
    initFirebase,
    getDb,
    getAuth,
    isFirebaseEnabled,
    getFirebaseStatus
};
