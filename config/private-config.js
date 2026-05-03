(function initTrafficAiPrivateConfig(globalScope) {
    const isLocal =
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";

    const privateConfig = {
        apiBase: isLocal
            ? "http://localhost:8080/api"
            : "https://ai-smart-traffic-congestion-and-21ae.onrender.com/api",

        services: {
            nominatimSearch: 'https://nominatim.openstreetmap.org/search',
            nominatimReverse: 'https://nominatim.openstreetmap.org/reverse',
            osrmRouteBase: 'https://router.project-osrm.org/route/v1/driving',
            overpassApi: 'https://overpass-api.de/api/interpreter',
            weatherApi: 'https://api.open-meteo.com/v1/forecast'
        },

        loginPagePath: 'loged.html',
        userPortalPath: 'user-dashboard.html',
        adminPortalPath: 'admin-portal.html',

        userPortalRoute: '/user-dashboard',
        adminPortalRoute: '/admin-portal',

        adminUsername: 'admin@trafficai.local'
    };

    globalScope.TRAFFICAI_PRIVATE_CONFIG = Object.freeze(privateConfig);
})(window);