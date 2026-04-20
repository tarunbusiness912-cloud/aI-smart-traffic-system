(function initTrafficAiPrivateConfig(globalScope) {
    const privateConfig = {
        apiBaseCandidates: [
            '/api',
            'http://localhost:8080/api',
            'http://127.0.0.1:8080/api'
        ],
        services: {
            nominatimSearch: 'https://nominatim.openstreetmap.org/search',
            nominatimReverse: 'https://nominatim.openstreetmap.org/reverse',
            osrmRouteBase: 'https://router.project-osrm.org/route/v1/driving',
            overpassApi: 'https://overpass-api.de/api/interpreter',
            weatherApi: 'https://api.open-meteo.com/v1/forecast'
        },
        googleMapsApiKey: '',
        poiSearchRadiusMeters: 2000,
        emergencyAlertPollMs: 8000,
        loginPagePath: 'loged.html',
        userPortalPath: 'user-dashboard.html',
        adminPortalPath: 'admin-portal.html',
        adminPortalRoute: '/admin-portal',
        userPortalRoute: '/user-dashboard',
        adminUsername: 'admin@trafficai.local'
    };

    globalScope.TRAFFICAI_PRIVATE_CONFIG = Object.freeze(privateConfig);
}(window));
