const express = require("express");

const router = express.Router();

function normalizeDay(dayInput = "") {
    const value = String(dayInput).trim().toLowerCase();
    if (value === "weekday" || value === "0") return "weekday";
    if (value === "weekend" || value === "1") return "weekend";
    return "weekday";
}

function parseHourFromTime(timeInput = "08:30") {
    if (typeof timeInput === "number" && Number.isFinite(timeInput)) {
        return Math.max(0, Math.min(23, Math.floor(timeInput)));
    }

    const match = String(timeInput).match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return 8;
    const hour = Number(match[1]);
    return Math.max(0, Math.min(23, hour));
}

function mapTrafficLevel(score) {
    if (score <= 30) return "Low";
    if (score <= 60) return "Medium";
    return "Heavy";
}

function calculateTrafficPrediction({ day = "weekday", time = "08:30" }) {
    const normalizedDay = normalizeDay(day);
    const hour = parseHourFromTime(time);

    let score = 40;
    if (normalizedDay === "weekday") score += 30;
    if (hour >= 7 && hour <= 10) score += 20;
    if (hour >= 17 && hour <= 21) score += 25;
    if (normalizedDay === "weekend") score -= 10;

    const safeScore = Math.max(0, Math.min(100, score));
    return {
        score: safeScore,
        level: mapTrafficLevel(safeScore),
        day: normalizedDay,
        hour
    };
}

router.post("/predict", (req, res) => {
    try {
        const { day, time } = req.body || {};
        const prediction = calculateTrafficPrediction({ day, time });
        res.json({
            score: prediction.score,
            level: prediction.level,
            meta: {
                day: prediction.day,
                hour: prediction.hour,
                model: "rule-based-v1"
            }
        });
    } catch (error) {
        res.status(500).json({ error: "Prediction failed", message: error.message });
    }
});

module.exports = {
    router,
    calculateTrafficPrediction
};
