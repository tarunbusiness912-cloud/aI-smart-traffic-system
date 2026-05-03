const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://ai-smart-traffic-congestion-and-pre.vercel.app"
];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like Postman)
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