const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };
const EMERGENCY_DISTANCE_METERS = 500;
const ROUTE_BUFFER_METERS = 1000;
const SEARCH_POINT_INTERVAL_METERS = 2200;
const MAX_SEARCH_POINTS = 22;

const EV_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
const FUEL_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/orange-dot.png";

const MOCK_AMBULANCE_PATH = [
    { lat: 12.9679, lng: 77.6013 },
    { lat: 12.9710, lng: 77.5991 },
    { lat: 12.9741, lng: 77.5975 },
    { lat: 12.9780, lng: 77.5962 },
    { lat: 12.9826, lng: 77.5948 },
    { lat: 12.9860, lng: 77.5927 },
    { lat: 12.9894, lng: 77.5902 }
];

let map = null;
let geocoder = null;
let directionsService = null;
let directionsRenderer = null;
let placesService = null;

let sourceAutocomplete = null;
let destinationAutocomplete = null;
let sourceSelection = null;
let destinationSelection = null;

let selectedRoutePath = [];
let currentMode = "fastest";
let userLiveLocation = null;
let userMarker = null;

let poiMarkers = [];
let ambulancePolyline = null;
let ambulanceMarker = null;
let ambulancePathLatLng = [];
let ambulanceRouteCursor = 0;
let ambulanceMovementTimer = null;

const fieldWriteLock = {
    source: false,
    destination: false
};

const activeEmergencyVehicle = {
    id: "AMB-MOCK-01",
    active: true
};

document.addEventListener("DOMContentLoaded", bootstrapTrafficAIDashboard);

function bootstrapTrafficAIDashboard() {
    bindUiEvents();
    setActiveModeButton(currentMode);
    setRouteStatus("Loading Google Maps...");
    loadGoogleMapsScript();
}

function bindUiEvents() {
    const findRouteBtn = document.getElementById("find-route-btn");
    if (findRouteBtn) {
        findRouteBtn.addEventListener("click", () => {
            void findRoute(currentMode);
        });
    }

    document.querySelectorAll(".route-mode-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const mode = normalizeMode(button.dataset.mode);
            currentMode = mode;
            setActiveModeButton(mode);

            const sourceValue = document.getElementById("source")?.value?.trim();
            const destinationValue = document.getElementById("destination")?.value?.trim();
            if (sourceValue && destinationValue) {
                void findRoute(mode);
            }
        });
    });

    document.getElementById("source-location-btn")?.addEventListener("click", () => {
        void useMyLocationForField("source");
    });
    document.getElementById("destination-location-btn")?.addEventListener("click", () => {
        void useMyLocationForField("destination");
    });

    const sourceInput = document.getElementById("source");
    const destinationInput = document.getElementById("destination");
    if (sourceInput) {
        sourceInput.addEventListener("input", () => {
            if (!fieldWriteLock.source) sourceSelection = null;
        });
    }
    if (destinationInput) {
        destinationInput.addEventListener("input", () => {
            if (!fieldWriteLock.destination) destinationSelection = null;
        });
    }

    window.findRoute = findRoute;
}

function getGoogleMapsApiKey() {
    const configKey = window.TRAFFICAI_PRIVATE_CONFIG?.googleMapsApiKey;
    const globalKey = window.TRAFFICAI_GOOGLE_MAPS_API_KEY;
    return String(configKey || globalKey || "YOUR_GOOGLE_MAPS_API_KEY").trim();
}

function loadGoogleMapsScript() {
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY") {
        setRouteStatus("Add a Google Maps API key using window.TRAFFICAI_GOOGLE_MAPS_API_KEY.");
        return;
    }

    if (window.google?.maps) {
        initTrafficAIDashboard();
        return;
    }

    window.initTrafficAIDashboard = initTrafficAIDashboard;
    const script = document.createElement("script");
    script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&callback=initTrafficAIDashboard`;
    script.async = true;
    script.defer = true;
    script.onerror = () => setRouteStatus("Google Maps JavaScript API failed to load.");
    document.head.appendChild(script);
}

function initTrafficAIDashboard() {
    const mapElement = document.getElementById("map");
    if (!mapElement) {
        setRouteStatus("Map container not found.");
        return;
    }

    map = new google.maps.Map(mapElement, {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
    });

    geocoder = new google.maps.Geocoder();
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        preserveViewport: false,
        suppressMarkers: false,
        polylineOptions: {
            strokeColor: "#2563eb",
            strokeOpacity: 0.9,
            strokeWeight: 6
        }
    });
    placesService = new google.maps.places.PlacesService(map);

    const trafficLayer = new google.maps.TrafficLayer();
    trafficLayer.setMap(map);

    initializeAutocomplete();
    initializeAmbulancePath();
    startUserLocationWatcher();

    setRouteStatus("Map ready. Enter Source and Destination, then Generate Route.");
}

function initializeAutocomplete() {
    const sourceInput = document.getElementById("source");
    const destinationInput = document.getElementById("destination");
    if (!sourceInput || !destinationInput) return;

    const options = {
        fields: ["formatted_address", "geometry", "name"],
        types: ["geocode"]
    };

    sourceAutocomplete = new google.maps.places.Autocomplete(sourceInput, options);
    destinationAutocomplete = new google.maps.places.Autocomplete(destinationInput, options);

    sourceAutocomplete.addListener("place_changed", () => {
        const place = sourceAutocomplete.getPlace();
        if (!place?.geometry?.location) return;
        setFieldSelection("source", {
            label: String(place.formatted_address || place.name || sourceInput.value || "").trim(),
            location: place.geometry.location
        });
        map.panTo(place.geometry.location);
    });

    destinationAutocomplete.addListener("place_changed", () => {
        const place = destinationAutocomplete.getPlace();
        if (!place?.geometry?.location) return;
        setFieldSelection("destination", {
            label: String(place.formatted_address || place.name || destinationInput.value || "").trim(),
            location: place.geometry.location
        });
        map.panTo(place.geometry.location);
    });
}

function initializeAmbulancePath() {
    ambulancePathLatLng = MOCK_AMBULANCE_PATH.map((point) => new google.maps.LatLng(point.lat, point.lng));

    ambulancePolyline = new google.maps.Polyline({
        map,
        path: ambulancePathLatLng,
        strokeColor: "#dc2626",
        strokeOpacity: 0.85,
        strokeWeight: 5
    });

    ambulanceMarker = new google.maps.Marker({
        map,
        position: ambulancePathLatLng[0],
        title: "Active Ambulance",
        zIndex: 30,
        icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 5,
            fillColor: "#dc2626",
            fillOpacity: 1,
            strokeColor: "#7f1d1d",
            strokeWeight: 2
        }
    });

    if (ambulanceMovementTimer) {
        window.clearInterval(ambulanceMovementTimer);
    }
    ambulanceMovementTimer = window.setInterval(() => {
        if (!activeEmergencyVehicle.active || !ambulancePathLatLng.length || !ambulanceMarker) return;
        ambulanceRouteCursor = (ambulanceRouteCursor + 1) % ambulancePathLatLng.length;
        ambulanceMarker.setPosition(ambulancePathLatLng[ambulanceRouteCursor]);
        evaluateEmergencyRisk();
    }, 3000);
}

function startUserLocationWatcher() {
    if (!navigator.geolocation) return;

    navigator.geolocation.watchPosition(
        (position) => {
            if (!window.google?.maps) return;
            userLiveLocation = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
            updateUserMarker(userLiveLocation, false);
            evaluateEmergencyRisk();
        },
        () => {
            // No-op. User may deny permission and still use manual routing.
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 6000 }
    );
}

function setFieldSelection(target, selection) {
    const input = document.getElementById(target);
    if (!input || !selection) return;

    const label = String(selection.label || "").trim();
    const location = toLatLng(selection.location);
    const lockKey = target === "source" ? "source" : "destination";

    fieldWriteLock[lockKey] = true;
    input.value = label || formatLatLng(location);
    fieldWriteLock[lockKey] = false;

    const normalized = { label: input.value.trim(), location };
    if (target === "source") sourceSelection = normalized;
    if (target === "destination") destinationSelection = normalized;
}

async function useMyLocationForField(target) {
    if (!window.google?.maps) {
        setRouteStatus("Map is still loading. Please retry in a moment.");
        return;
    }
    if (!navigator.geolocation) {
        setRouteStatus("Geolocation is not supported by this browser.");
        return;
    }

    setRouteStatus(`Fetching current location for ${target}...`);
    await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
                userLiveLocation = latLng;
                updateUserMarker(latLng, true);

                let label = formatLatLng(latLng);
                if (geocoder) {
                    try {
                        label = await reverseGeocodeLocation(latLng);
                    } catch (_error) {
                        label = formatLatLng(latLng);
                    }
                }

                setFieldSelection(target, { label, location: latLng });
                if (map) map.panTo(latLng);
                setRouteStatus(`${capitalize(target)} updated from current location.`);
                evaluateEmergencyRisk();
                resolve();
            },
            (error) => {
                setRouteStatus(`Unable to access location (${geolocationErrorText(error)}).`);
                resolve();
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    });
}

function updateUserMarker(latLng, centerMap) {
    if (!map || !latLng) return;
    if (!userMarker) {
        userMarker = new google.maps.Marker({
            map,
            position: latLng,
            title: "Your current location",
            zIndex: 25,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#0ea5e9",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2
            }
        });
    } else {
        userMarker.setPosition(latLng);
    }

    if (centerMap) {
        map.panTo(latLng);
        map.setZoom(Math.max(map.getZoom(), 13));
    }
}

async function reverseGeocodeLocation(latLng) {
    return new Promise((resolve, reject) => {
        geocoder.geocode({ location: latLng }, (results, status) => {
            if (status === "OK" && Array.isArray(results) && results[0]) {
                resolve(results[0].formatted_address);
                return;
            }
            reject(new Error(`Reverse geocoding failed: ${status}`));
        });
    });
}

async function resolveFieldLocation(fieldId, cachedSelection) {
    const input = document.getElementById(fieldId);
    const typed = String(input?.value || "").trim();
    if (cachedSelection && typed && typed.toLowerCase() === cachedSelection.label.toLowerCase()) {
        return cachedSelection;
    }
    if (!typed) {
        throw new Error(`Please enter ${fieldId}.`);
    }

    const geocoded = await geocodeAddress(typed);
    setFieldSelection(fieldId, geocoded);
    return geocoded;
}

async function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
        geocoder.geocode({ address }, (results, status) => {
            if (status === "OK" && Array.isArray(results) && results[0]?.geometry?.location) {
                resolve({
                    label: results[0].formatted_address,
                    location: results[0].geometry.location
                });
                return;
            }
            reject(new Error(`Could not locate: ${address}`));
        });
    });
}

async function requestDirections(request) {
    return new Promise((resolve, reject) => {
        directionsService.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
                resolve(result);
                return;
            }
            reject(new Error(`Directions request failed: ${status}`));
        });
    });
}

function normalizeMode(mode) {
    const value = String(mode || "").trim().toLowerCase();
    if (value === "shortest" || value === "fastest" || value === "eco") return value;
    return "fastest";
}

function setActiveModeButton(mode) {
    document.querySelectorAll(".route-mode-btn").forEach((button) => {
        button.classList.toggle("active", normalizeMode(button.dataset.mode) === normalizeMode(mode));
    });
}

function getRouteMetrics(route) {
    let distanceMeters = 0;
    let durationSeconds = 0;
    let durationTrafficSeconds = 0;
    let stepCount = 0;

    (route.legs || []).forEach((leg) => {
        distanceMeters += Number(leg?.distance?.value || 0);
        durationSeconds += Number(leg?.duration?.value || 0);
        durationTrafficSeconds += Number(leg?.duration_in_traffic?.value || leg?.duration?.value || 0);
        stepCount += Array.isArray(leg?.steps) ? leg.steps.length : 0;
    });

    return {
        distanceMeters,
        durationSeconds,
        durationTrafficSeconds,
        stepCount
    };
}

function chooseRouteIndexByMode(routes, mode) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    routes.forEach((route, index) => {
        const metrics = getRouteMetrics(route);
        let score = metrics.durationTrafficSeconds;

        if (mode === "shortest") {
            score = metrics.distanceMeters;
        } else if (mode === "eco") {
            const trafficFactor = metrics.durationTrafficSeconds / Math.max(metrics.durationSeconds, 1);
            const turnPenalty = 1 + metrics.stepCount / 220;
            score = metrics.distanceMeters * trafficFactor * turnPenalty;
        }

        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function buildRouteSummary(route, mode) {
    const metrics = getRouteMetrics(route);
    const km = (metrics.distanceMeters / 1000).toFixed(1);
    const mins = Math.round(metrics.durationTrafficSeconds / 60);
    const modeLabel = mode === "eco" ? "Eco" : capitalize(mode);
    return `${modeLabel} route selected: ${km} km, ~${mins} min (traffic-aware).`;
}

async function findRoute(mode = currentMode) {
    currentMode = normalizeMode(mode);
    setActiveModeButton(currentMode);

    if (!map || !geocoder || !directionsService || !directionsRenderer || !placesService) {
        setRouteStatus("Map is still initializing.");
        return;
    }

    clearPoiMarkers();
    toggleStationWarning(false);

    try {
        const source = await resolveFieldLocation("source", sourceSelection);
        const destination = await resolveFieldLocation("destination", destinationSelection);

        setRouteStatus(`Calculating ${currentMode} route...`);

        const directionsResult = await requestDirections({
            origin: source.location,
            destination: destination.location,
            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: true,
            drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS
            },
            unitSystem: google.maps.UnitSystem.METRIC
        });

        const routes = directionsResult.routes || [];
        if (!routes.length) throw new Error("No route returned by Directions Service.");

        const selectedIndex = chooseRouteIndexByMode(routes, currentMode);
        const selectedRoute = routes[selectedIndex];

        directionsRenderer.setDirections(directionsResult);
        directionsRenderer.setRouteIndex(selectedIndex);

        selectedRoutePath = Array.isArray(selectedRoute.overview_path)
            ? selectedRoute.overview_path.map((point) => toLatLng(point))
            : [];

        setRouteStatus(buildRouteSummary(selectedRoute, currentMode));
        evaluateEmergencyRisk();
        await searchStationsAlongRoute(selectedRoutePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to generate route.";
        setRouteStatus(message);
    }
}

function sampleRoutePath(routePath, intervalMeters = SEARCH_POINT_INTERVAL_METERS, maxPoints = MAX_SEARCH_POINTS) {
    if (!routePath.length) return [];
    if (routePath.length <= 2) return routePath.map((point) => toLatLng(point));

    const sampled = [toLatLng(routePath[0])];
    let travelled = 0;

    for (let index = 1; index < routePath.length && sampled.length < maxPoints - 1; index += 1) {
        const prev = toLatLng(routePath[index - 1]);
        const current = toLatLng(routePath[index]);
        travelled += google.maps.geometry.spherical.computeDistanceBetween(prev, current);
        if (travelled >= intervalMeters) {
            sampled.push(current);
            travelled = 0;
        }
    }

    sampled.push(toLatLng(routePath[routePath.length - 1]));
    return sampled;
}

async function nearbySearch(request) {
    return new Promise((resolve) => {
        placesService.nearbySearch(request, (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(results)) {
                resolve(results);
                return;
            }
            resolve([]);
        });
    });
}

function dedupePlaces(places) {
    const unique = new Map();
    places.forEach((place) => {
        const key = String(place?.place_id || place?.name || "");
        if (!key || unique.has(key)) return;
        unique.set(key, place);
    });
    return [...unique.values()];
}

function distanceToRouteMeters(location, routePath) {
    const locationLatLng = toLatLng(location);
    let minDistance = Number.POSITIVE_INFINITY;
    routePath.forEach((point) => {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(locationLatLng, toLatLng(point));
        if (distance < minDistance) minDistance = distance;
    });
    return minDistance;
}

function filterPlacesWithinRouteBuffer(places, routePath, bufferMeters) {
    return places
        .map((place) => {
            const location = place?.geometry?.location;
            if (!location) return null;
            const routeDistanceMeters = distanceToRouteMeters(location, routePath);
            return routeDistanceMeters <= bufferMeters ? { ...place, routeDistanceMeters } : null;
        })
        .filter(Boolean);
}

async function searchStationsAlongRoute(routePath) {
    if (!routePath.length) {
        renderStationLists([], []);
        toggleStationWarning(false);
        return;
    }

    const sampledPoints = sampleRoutePath(routePath);
    const evCandidates = [];
    const fuelCandidates = [];

    for (const point of sampledPoints) {
        const [evResults, fuelResults] = await Promise.all([
            nearbySearch({
                location: point,
                radius: ROUTE_BUFFER_METERS,
                type: "charging_station",
                keyword: "EV charging"
            }),
            nearbySearch({
                location: point,
                radius: ROUTE_BUFFER_METERS,
                type: "gas_station"
            })
        ]);

        evCandidates.push(...evResults);
        fuelCandidates.push(...fuelResults);
        await delay(120);
    }

    const evStations = filterPlacesWithinRouteBuffer(dedupePlaces(evCandidates), routePath, ROUTE_BUFFER_METERS);
    const fuelStations = filterPlacesWithinRouteBuffer(dedupePlaces(fuelCandidates), routePath, ROUTE_BUFFER_METERS);

    renderStationMarkers(evStations, fuelStations);
    renderStationLists(evStations, fuelStations);
    toggleStationWarning(evStations.length === 0 && fuelStations.length === 0);
}

function renderStationMarkers(evStations, fuelStations) {
    clearPoiMarkers();
    evStations.forEach((station) => {
        const marker = createStationMarker(station, EV_ICON_URL, "EV Charging Station");
        if (marker) poiMarkers.push(marker);
    });
    fuelStations.forEach((station) => {
        const marker = createStationMarker(station, FUEL_ICON_URL, "Fuel Station");
        if (marker) poiMarkers.push(marker);
    });
}

function createStationMarker(station, iconUrl, stationType) {
    if (!map || !station?.geometry?.location) return null;

    const marker = new google.maps.Marker({
        map,
        position: station.geometry.location,
        icon: iconUrl,
        title: `${stationType}: ${station.name || "Unknown"}`
    });

    const distanceText = Number.isFinite(station.routeDistanceMeters)
        ? `${Math.round(station.routeDistanceMeters)} m from route`
        : "";
    const infoWindow = new google.maps.InfoWindow({
        content: `<div><strong>${escapeHtml(station.name || stationType)}</strong><br>${escapeHtml(station.vicinity || "")}<br>${escapeHtml(distanceText)}</div>`
    });

    marker.addListener("click", () => {
        infoWindow.open({ map, anchor: marker });
    });

    return marker;
}

function clearPoiMarkers() {
    poiMarkers.forEach((marker) => marker.setMap(null));
    poiMarkers = [];
}

function renderStationLists(evStations, fuelStations) {
    renderStationList("ev-list", evStations, "No EV charging stations within 1 km route buffer.");
    renderStationList("fuel-list", fuelStations, "No fuel stations within 1 km route buffer.");
}

function renderStationList(listId, stations, fallbackText) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.innerHTML = "";
    if (!stations.length) {
        const item = document.createElement("li");
        item.textContent = fallbackText;
        list.appendChild(item);
        return;
    }

    stations.slice(0, 10).forEach((station) => {
        const item = document.createElement("li");
        const name = String(station.name || "Unnamed Station").trim();
        const distance = Number.isFinite(station.routeDistanceMeters)
            ? `${Math.round(station.routeDistanceMeters)} m`
            : "--";
        item.textContent = `${name} (${distance} from route)`;
        list.appendChild(item);
    });
}

function toggleStationWarning(visible) {
    const warning = document.getElementById("station-warning");
    if (!warning) return;
    warning.classList.toggle("hidden", !visible);
}

function evaluateEmergencyRisk() {
    const emergencyOverlay = document.getElementById("emergency-overlay");
    if (!emergencyOverlay) return;

    if (!activeEmergencyVehicle.active || !ambulancePathLatLng.length || !selectedRoutePath.length) {
        emergencyOverlay.classList.add("hidden");
        return;
    }

    const routeNearAmbulance = routeNearPath(selectedRoutePath, ambulancePathLatLng, EMERGENCY_DISTANCE_METERS);
    const userNearAmbulance = userLiveLocation
        ? pointNearPath(userLiveLocation, ambulancePathLatLng, EMERGENCY_DISTANCE_METERS)
        : false;

    emergencyOverlay.classList.toggle("hidden", !(routeNearAmbulance || userNearAmbulance));
}

function routeNearPath(routePath, referencePath, thresholdMeters) {
    const sampledRoute = sampleRoutePath(routePath, 550, 140);
    return sampledRoute.some((routePoint) => pointNearPath(routePoint, referencePath, thresholdMeters));
}

function pointNearPath(point, referencePath, thresholdMeters) {
    const pointLatLng = toLatLng(point);
    for (const pathPoint of referencePath) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(pointLatLng, toLatLng(pathPoint));
        if (distance <= thresholdMeters) return true;
    }
    return false;
}

function geolocationErrorText(error) {
    if (!error) return "Unknown error";
    if (error.code === 1) return "Permission denied";
    if (error.code === 2) return "Position unavailable";
    if (error.code === 3) return "Request timed out";
    return "Unknown error";
}

function setRouteStatus(message) {
    const status = document.getElementById("route-status");
    if (status) status.textContent = message;
}

function formatLatLng(latLng) {
    const point = toLatLng(latLng);
    return `${point.lat().toFixed(6)}, ${point.lng().toFixed(6)}`;
}

function toLatLng(value) {
    if (value instanceof google.maps.LatLng) return value;
    return new google.maps.LatLng(Number(value?.lat || 0), Number(value?.lng || 0));
}

function capitalize(value) {
    const text = String(value || "");
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}
