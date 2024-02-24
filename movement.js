// Configuration object for default values and settings
const config = {
    mapboxAccessToken: 'pk.eyJ1IjoidW5oY3IiLCJhIjoiOUQzQ2dnbyJ9.6ghfFmvxpu7HvHzXci_ogw',
    mapStyle: 'mapbox://styles/unhcr/ckvl4xy2mj45z15mpkq6w2nv8',
    initialCenter: [0, 20],
    initialZoom: 2.3,
    globeProjection: true,
    terrainSource: 'mapbox://mapbox.terrain-rgb',
    terrainExaggeration: 1.5,
    movementDataUrl: './data/movement_data.csv',
    spinningSpeed: -0.1,
    dotAnimationSpeed: 0.003,
    dotSpacing: 0.2,
    minimumDots: 1,
    dotCountFactor: 100
};

// Configuration object for spinning behavior
const spinningConfig = {
    isEnabled: false, // Initially false, will be set to true by default after initialization
    spinningSpeed: -0.1, // Initial spinning speed
    animationFrameId: null, // ID for the requestAnimationFrame to manage spinning
};

// Initialize the Mapbox map
mapboxgl.accessToken = config.mapboxAccessToken;
let map = new mapboxgl.Map({
    container: 'map',
    style: config.mapStyle,
    center: config.initialCenter,
    zoom: config.initialZoom,
    projection: config.globeProjection ? 'globe' : 'mercator'
});
map.doubleClickZoom.disable();

let spinning = false;
let animationFrameId;
let selectedFromCountry = null;
let selectedToCountry = null;
let globalGeoJson;
let animationFrameRequestID;
const infoPanel = document.getElementById('info-panel');

map.on('load', function () {
    setFog();
    fetchDataAndInitialize(config.movementDataUrl);
    initializeSpinningGlobe();
    spinningConfig.isEnabled = true; // Enable spinning by default
    startSpinning(); // Start spinning immediately
});

/**
 * Sets the fog configuration for the map.
 * @param {object} map - The Mapbox GL map instance.
 */
function setFog() {
    map.setFog({
        color: 'rgba(120, 144, 156, 0.5)',
        'high-color': 'rgba(40, 54, 85, 0.5)',
        'horizon-blend': 0.1,
        'space-color': 'rgb(5, 5, 15)',
        'star-intensity': 0.75
    });
}

/**
 * Fetches data and initializes map layers and animations with proper handling of CSV parsing.
 * This function integrates fetching, retry logic, and parsing seamlessly for better efficiency.
 * @param {string} dataUrl - The URL to fetch movement data from.
 * @returns {Promise<void>}
 */
async function fetchDataAndInitialize(dataUrl) {
    try {
        const csvData = await fetchWithRetry(dataUrl, 3, 1000);
        const parsedData = await parseCsvAsync(csvData);
        if (parsedData.data && parsedData.data.length > 0) {
            globalGeoJson = convertToGeoJson(parsedData.data);
            const aggregatedData = aggregateMovementCounts(globalGeoJson);
            initializeMovingDotsSourceAndLayer();
            animateDots();
            addBubbleLayer(aggregatedData);
        } else {
            throw new Error('Parsed data is empty or invalid');
        }
    } catch (error) {
        console.error('Error fetching or processing movement data:', error);
    }
}

/**
 * Wraps Papa Parse's parse method in a promise for use with async/await, ensuring CSV parsing is handled asynchronously.
 * @param {string} csvData - The CSV data as a string.
 * @returns {Promise<Object>} - A promise that resolves with the parsed CSV data.
 */
function parseCsvAsync(csvData) {
    return new Promise((resolve, reject) => {
        Papa.parse(csvData, {
            header: true,
            complete: results => {
                if (results && results.data) {
                    resolve(results);
                } else {
                    reject(new Error('No data found in CSV.'));
                }
            },
            error: reject
        });
    });
}

/**
 * Attempts to fetch data from a URL with retries on failure, leveraging async/await for clarity.
 * @param {string} url - The URL to fetch data from.
 * @param {number} retries - Number of allowed retries.
 * @param {number} delay - Delay between retries in milliseconds.
 * @returns {Promise<string>} - The fetched data as text if successful.
 */
async function fetchWithRetry(url, retries, delay) {
    let error;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Request failed with status: ${response.status}`);
            return await response.text();
        } catch (err) {
            error = err;
            console.log(`Attempt ${attempt + 1} failed: ${err.message}. Retrying after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw error;
}

// Initializes the spinning globe feature and user interactions
function initializeSpinningGlobe() {
    map.on('dblclick', () => toggleSpinning(!spinningConfig.isEnabled));
    map.on('dragstart', () => stopSpinning());
    map.on('pitchstart', () => stopSpinning());
}

// Toggles the spinning state and either starts or stops the spinning
function toggleSpinning(enableSpinning) {
    spinningConfig.isEnabled = enableSpinning;
    if (enableSpinning) {
        startSpinning();
    } else {
        stopSpinning();
    }
}
// Starts the spinning animation of the globe
function startSpinning() {
    if (spinningConfig.animationFrameId) return; // Avoid starting multiple spin animations
    spinGlobe();
}

// Stops the spinning animation of the globe
function stopSpinning() {
    if (spinningConfig.animationFrameId) {
        cancelAnimationFrame(spinningConfig.animationFrameId);
        spinningConfig.animationFrameId = null;
    }
}

function adjustSpinning(shouldSpin) {
    spinning = shouldSpin;
    if (spinning) {
        spinGlobe();
    } else {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
    }
}

// Spin the globe by updating the map's center longitude
function spinGlobe() {
    if (!spinningConfig.isEnabled) return; // Exit if spinning is disabled

    const center = map.getCenter();
    center.lng = (center.lng + spinningConfig.spinningSpeed) % 360;
    map.setCenter(center);

    spinningConfig.animationFrameId = requestAnimationFrame(spinGlobe);
}

// Utility function to convert CSV data to GeoJSON format
function convertToGeoJson(csvData) {
    try {
        return {
            type: "FeatureCollection",
            features: csvData.map(row => {
                if (!row.country_from || !row.country_to) return null;
                return {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [parseFloat(row.longitude_from), parseFloat(row.latitude_from)],
                            [parseFloat(row.longitude_to), parseFloat(row.latitude_to)]
                        ]
                    },
                    properties: {
                        country_from: row.country_from,
                        country_to: row.country_to,
                        movement_count: parseInt(row.movement_count, 10),
                        progress: 0,
                        speed: calculateSpeedBasedOnData(row)
                    }
                };
            }).filter(feature => feature !== null)
        };
    } catch (error) {
        console.error('Error converting CSV to GeoJSON:', error);
        return { type: "FeatureCollection", features: [] };
    }
}

//Utility function to create speed
function calculateSpeedBasedOnData(row) {
    // Example calculation, could be based on 'movement_count' or any other metric
    const baseSpeed = config.dotAnimationSpeed; // Use the global config as a base
    const speedFactor = row.movement_count / 50; // scale speed by movement count
    return baseSpeed * (1 + speedFactor); // Adjust speed based on the factor
}

// Function to initialize moving dots source and layer if they don't exist
function initializeMovingDotsSourceAndLayer() {
    // Check if the source already exists to avoid redundant operations
    if (!map.getSource('moving-dots')) {
        map.addSource('moving-dots', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Similarly, check if the layer already exists before attempting to add it
    if (!map.getLayer('moving-dots-layer')) {
        map.addLayer({
            id: 'moving-dots-layer',
            type: 'circle',
            source: 'moving-dots',
            paint: {
                'circle-radius': 2,
                'circle-color': '#007cbf'
            }
        });
    } else {
        // If the layer already exists, you can opt to update its properties or data source if necessary
        // For example, to update the data source (if your application logic requires it):
        // map.getSource('moving-dots').setData(newGeoJsonData);
    }
}

// Function to animate moving dots based on GeoJSON features
function animateDots() {
    if (animationFrameRequestID) {
        cancelAnimationFrame(animationFrameRequestID);
    }

    if (!globalGeoJson) return;
    animationFrameRequestID = requestAnimationFrame(animateDots);

    const movingDotsData = globalGeoJson.features.reduce((acc, feature) => {
        // Adjust logic to include dots both leaving from and arriving at the selected country
        if (selectedFromCountry && feature.properties.country_from !== selectedFromCountry && feature.properties.country_to !== selectedFromCountry) {
            return acc; // Skip dots not related to the selected country
        }
        if (selectedToCountry && feature.properties.country_to !== selectedToCountry && feature.properties.country_from !== selectedToCountry) {
            return acc; // Similarly, skip dots not related to the selected destination
        }
        generateMovingDotsForFeature(feature, acc);
        return acc;
    }, { type: 'FeatureCollection', features: [] });

    map.getSource('moving-dots').setData(movingDotsData);

    if (map.getLayer('moving-dots-layer')) {
        map.setPaintProperty('moving-dots-layer', 'circle-color', ['get', 'color']);
    }
}

// Helper function to generate moving dots for a single feature
function generateMovingDotsForFeature(feature, movingDotsData) {
    const numberOfDots = Math.max(config.minimumDots, Math.ceil(feature.properties.movement_count / config.dotCountFactor));
    for (let i = 0; i < numberOfDots; i++) {
        const progress = (feature.properties.progress + (config.dotSpacing * i)) % 1;
        const point = calculatePointOnLine(feature, progress);
        movingDotsData.features.push(createDotFeature(point, progress, feature.properties.speed));
    }
    feature.properties.progress += feature.properties.speed;
    if (feature.properties.progress > 1) feature.properties.progress %= 1; // Reset progress
}

/**
 * Calculates a point along a line at a specified progress ratio.
 * @param {Object} feature - A GeoJSON feature representing the line.
 * @param {number} progress - The progress ratio (0 to 1) along the line.
 * @returns {Object|null} A GeoJSON point feature representing the location on the line, or null if invalid input.
 */
function calculatePointOnLine(feature, progress) {
    // Validate input to ensure it's a valid line with coordinates
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) {
        console.error('Invalid line feature:', feature);
        return null; // Early exit for invalid input
    }

    // Use Turf.js to calculate the point along the line at the given progress
    try {
        const line = turf.lineString(feature.geometry.coordinates);
        const totalLength = turf.length(line, { units: 'kilometers' });
        const distanceAlong = totalLength * progress;
        return turf.along(line, distanceAlong, { units: 'kilometers' });
    } catch (error) {
        console.error('Error calculating point on line:', error);
        return null;
    }
}

/**
 * Creates a dot feature for visualization on the map.
 * @param {Object} point - A GeoJSON point feature.
 * @param {number} progress - The progress ratio of the dot along its path.
 * @param {number} speed - The speed at which the dot moves.
 * @returns {Object} A GeoJSON feature representing the dot.
 */
function createDotFeature(point, progress, speed) {
    if (!point || !point.geometry) {
        console.error('Invalid point for dot feature:', point);
        return null; // Early exit for invalid input
    }

    // Proximity could be used to adjust the visual appearance of the dot
    const proximity = progress; // Simple direct use; refine based on your visualization needs
    const color = `rgba(${255 * (1 - proximity)}, ${255 * proximity}, 0, 1)`; // Color transition based on proximity

    return {
        type: 'Feature',
        geometry: point.geometry,
        properties: {
            proximity,
            color,
            speed
        }
    };
}

/**
 * Aggregates movement counts for each country from GeoJSON data.
 * @param {Object} geoJson - The GeoJSON object containing movement data.
 * @returns {Array} An array of GeoJSON features with aggregated movement counts.
 */
function aggregateMovementCounts(geoJson) {
    if (!geoJson || !Array.isArray(geoJson.features)) {
        console.error('Invalid GeoJSON data provided to aggregateMovementCounts');
        return []; // Return an empty array to avoid further processing errors
    }

    const aggregation = geoJson.features.reduce((acc, feature) => {
        const { country_from, movement_count } = feature.properties;
        // Initialize country entry in accumulator if not already present
        if (!acc[country_from]) {
            acc[country_from] = { count: 0, coordinates: [] };
        }
        acc[country_from].count += movement_count;
        // Store coordinates if not already done
        if (!acc[country_from].coordinates.length) {
            acc[country_from].coordinates = feature.geometry.coordinates[0];
        }
        return acc;
    }, {});

    return Object.entries(aggregation).map(([country, data]) => ({
        type: "Feature",
        properties: { country_from: country, movement_count: data.count },
        geometry: { type: "Point", coordinates: data.coordinates }
    }));
}

/**
 * Finds coordinates for a given country based on aggregated data.
 * @param {Object} aggregatedData - Aggregated data including countries and their coordinates.
 * @param {string} country - The country to find coordinates for.
 * @returns {Array} The coordinates for the country, or a default value if not found.
 */
function findCoordinatesForCountry(geoJson, country) {
    const feature = geoJson.features.find(f => f.properties.country_from === country);
    return feature ? feature.geometry.coordinates[0] : [0, 0]; // Default to [0, 0] if not found
}

/**
 * Adds or updates a bubble layer on the map with aggregated data.
 * @param {Array} aggregatedData - The aggregated data to visualize.
 */
function addBubbleLayer(aggregatedData) {
    const sourceId = 'country-from-bubbles';
    const layerId = 'country-from-bubbles-layer';

    // Validate aggregatedData structure
    if (!Array.isArray(aggregatedData) || !aggregatedData.length) {
        console.error('addBubbleLayer called with invalid or empty aggregatedData');
        return; // Prevent further execution if data is invalid
    }

    // Check if the source exists and update it; otherwise, create a new source and layer
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({
            type: 'FeatureCollection',
            features: aggregatedData
        });
    } else {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: aggregatedData
            }
        });
        map.addLayer({
            id: layerId,
            type: 'circle',
            source: sourceId,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'movement_count'], 0, 10, 100000, 50],
                'circle-color': '#B41C37',
                'circle-opacity': 0.75
            }
        });
    }
    
    // Ensure interaction handlers are initialized after adding the layer
    initializeBubbleLayerInteractions();
}

function showInformationPanel(connection) {

    // Change the projection to 'mercator' for a flat map view
    map.setProjection('mercator');

    // Validate connection object for necessary properties
    if (!connection.fromCoordinates || connection.fromCoordinates.length !== 2) {
        console.error('Invalid coordinates provided for information panel:', connection.fromCoordinates);
        return; // Exit the function if coordinates are invalid
    }

    // Stop the globe spinning to focus user attention on the information panel
    spinningConfig.isEnabled = false; // Enable spinning by default
    stopSpinning(); // Stop spinning immediately
    adjustSpinning(false);

    // Update the UI elements with the connection details
    updateInformationPanelUI(connection);

    // Fly the map to the selected country's coordinates
    map.flyTo({
        center: connection.fromCoordinates,
        essential: true,
        padding: {top: 0, bottom: 0, left: 0, right: 300},
        zoom: 2
    });
}

function updateInformationPanelUI(connection) {
    const titleElement = infoPanel.querySelector('h1');
    const paragraphElement = infoPanel.querySelector('p');
    const closeButton = infoPanel.querySelector('.close-btn');

    // Ensuring the UI elements exist before attempting to update them
    if (titleElement && paragraphElement) {
        titleElement.textContent = connection.from;
        paragraphElement.textContent = `Total Movement: ${connection.count}`; //TODO - Add Utility function to perform number formatting
        closeButton.onclick = hideInformationPanel; // Ensuring the close button is functional

        // Transition the panel into view
        infoPanel.style.transform = 'translateX(0)';
    }
}

function hideInformationPanel() {
    // Change the projection back to 'globe'
    map.setProjection('globe');

    // Resume the spinning of the globe to indicate the return to the global view
    adjustSpinning(true);
    spinningConfig.isEnabled = true; // Enable spinning by default
    startSpinning(); // Start spinning immediately

    // Transition the panel out of view
    infoPanel.style.transform = 'translateX(100%)';

    // Ease the map back to a default view, ensuring a cohesive user experience
    map.easeTo({
        center: [0, 20], // Example default center coordinates
        padding: {left: 0, right: 0},
        duration: 1000,
        zoom: config.initialZoom //TODO - Reset zoom not working
    });

    // Clear the selection to allow for new interactions
    selectedFromCountry = null;

    // Restart the animation of moving dots to reflect the reset state
    animateDots();

    refreshBubbleVisualization();
}

function initializeBubbleLayerInteractions() {
    // Check if events have already been initialized to prevent duplication
    if (window.bubbleLayerEventsInitialized) return;
    window.bubbleLayerEventsInitialized = true;

    const layerId = 'country-from-bubbles-layer'; // Corrected layer ID

    // Handle click events on the bubble layer
    map.on('click', layerId, function(e) {
        const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
        if (features.length > 0) {
            const feature = features[0];

            // Toggle selection of the 'from' country
            //selectedFromCountry = (selectedFromCountry === feature.properties.country_from) ? null : feature.properties.country_from;
            selectedFromCountry = feature.properties.country_from;

            filterVisualizationForSelectedCountry(selectedFromCountry);

            // Restart dot animations to reflect the new selection
            animateDots();

            // Construct the connection object for the information panel
            const connection = {
                from: feature.properties.country_from,
                count: feature.properties.movement_count,
                fromCoordinates: feature.geometry.coordinates
            };

            // Display the information panel with details about the selected country
            showInformationPanel(connection);
        }
    });

    // Change cursor style on hover to indicate clickable elements
    map.on('mouseenter', layerId, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', layerId, () => map.getCanvas().style.cursor = '');
}

function filterVisualizationForSelectedCountry(selectedCountry) {
    // Filter to get movements where the selected country is either the origin or the destination
    const relatedMovements = globalGeoJson.features.filter(feature =>
        feature.properties.country_from === selectedCountry || feature.properties.country_to === selectedCountry
    );

    // Aggregate data for the related bubbles, including the selected country itself
    const aggregatedData = aggregateDataForBothDirections(selectedCountry, relatedMovements);

    // Update the bubble layer with the new aggregated data, ensuring the selected country's bubble is displayed
    updateBubbleLayer(aggregatedData);
}

function updateMovingDotsLayer(filteredMovements) {
    // Assuming you have a function to update the moving dots source with new data
    map.getSource('moving-dots').setData({
        type: 'FeatureCollection',
        features: filteredMovements
    });
}

/**
 * Aggregates data for destinations based on movements from the selected country.
 * @param {Array<string>} destinations - An array of unique destination country codes/names.
 * @param {Array<Object>} movements - Filtered movement features from the selected origin country.
 * @returns {Array<Object>} Aggregated data for destination bubbles.
 */
function aggregateDataForBothDirections(selectedCountry, movements) {
    let aggregates = {};

    movements.forEach(movement => {
        const { country_from, country_to, movement_count } = movement.properties;
        // Aggregate movements for the selected country as both source and destination
        if (!aggregates[country_from]) aggregates[country_from] = { count: 0, coordinates: [] };
        if (!aggregates[country_to]) aggregates[country_to] = { count: 0, coordinates: [] };
        
        aggregates[country_from].count += movement_count;
        aggregates[country_to].count += movement_count;
        
        // Assuming the function getCoordinatesForCountry aggregates coordinates for each country
        aggregates[country_from].coordinates = getOriginCoordinates(country_from, globalGeoJson);
        aggregates[country_to].coordinates = getOriginCoordinates(country_to, globalGeoJson);
    });

    // Convert aggregates to GeoJSON features
    let aggregatedData = Object.keys(aggregates).map(country => ({
        type: "Feature",
        properties: {
            country_from: country,
            movement_count: aggregates[country].count,
        },
        geometry: {
            type: "Point",
            coordinates: aggregates[country].coordinates
        }
    }));

    return aggregatedData;
}

function updateBubbleLayer(aggregatedData) {
    // Update the bubble layer with the new aggregated data.
    // This function body remains the same as in your initial code.
    map.getSource('country-from-bubbles').setData({
        type: 'FeatureCollection',
        features: aggregatedData
    });
}

function getOriginCoordinates(country, geoJson) {
    // Implement logic to find the coordinates for the origin country
    // This could be an average of all starting points or a predefined location
    const originFeatures = geoJson.features.filter(feature => feature.properties.country_from === country);
    if (originFeatures.length > 0) {
        // Example: Averaging the coordinates of all movements from the origin
        const avgCoords = originFeatures.reduce((acc, feature) => {
            acc[0] += feature.geometry.coordinates[0][0] / originFeatures.length;
            acc[1] += feature.geometry.coordinates[0][1] / originFeatures.length;
            return acc;
        }, [0, 0]);
        return avgCoords;
    }
    return [0, 0]; // Default coordinates if none are found
}

function aggregateDataForDestinations(selectedCountry, movements) {
    // Initialize an object to hold the aggregate counts and coordinates for each related country
    let relatedCountryAggregates = {};

    // Loop through each movement to aggregate counts and collect coordinates
    movements.forEach(movement => {
        // For movements from the selected country, aggregate destination data
        if (movement.properties.country_from === selectedCountry) {
            const destination = movement.properties.country_to;
            aggregateMovementData(destination, movement, relatedCountryAggregates, movement.geometry.coordinates[1]);
        }

        // For movements to the selected country, aggregate origin data
        if (movement.properties.country_to === selectedCountry) {
            const origin = movement.properties.country_from;
            aggregateMovementData(origin, movement, relatedCountryAggregates, movement.geometry.coordinates[0]);
        }
    });

    // Convert the aggregates into GeoJSON features for the bubbles
    return Object.keys(relatedCountryAggregates).map(country => {
        const data = relatedCountryAggregates[country];
        // Calculate the average coordinates for each related country
        const avgCoordinates = data.coordinates.reduce((acc, coords) => [acc[0] + coords[0], acc[1] + coords[1]], [0, 0])
            .map(coord => coord / data.coordinates.length);

        return {
            type: "Feature",
            properties: {
                country_from: country,
                movement_count: data.count,
            },
            geometry: {
                type: "Point",
                coordinates: avgCoordinates
            }
        };
    });
}

function aggregateMovementData(country, movement, aggregates, coordinates) {
    if (!aggregates[country]) {
        aggregates[country] = {
            count: 0,
            coordinates: []
        };
    }
    aggregates[country].count += movement.properties.movement_count;
    aggregates[country].coordinates.push(coordinates);
}

function getOriginCoordinates(country, geoJson) {
    // Find the first feature where the selected country is an origin or destination
    const feature = geoJson.features.find(f =>
        f.properties.country_from === country || f.properties.country_to === country
    );

    // Return the coordinates for that feature, or a default if not found
    if (feature) {
        return feature.properties.country_from === country ? feature.geometry.coordinates[0] : feature.geometry.coordinates[1];
    } else {
        return [0, 0]; // Default coordinates if none are found
    }
}

function refreshBubbleVisualization() {
    // Check if a country is selected; if not, aggregate and display global data.
    if (!selectedFromCountry && !selectedToCountry) {
        const aggregatedGlobalData = aggregateGlobalMovementCounts(globalGeoJson);
        updateBubbleLayer(aggregatedGlobalData);
    } else {
        // If a country is selected, filter and display data relevant to that selection.
        const selectedCountry = selectedFromCountry || selectedToCountry; // Assuming you have logic to handle this
        const relatedMovements = filterRelatedMovements(selectedCountry, globalGeoJson);
        const aggregatedData = aggregateDataForSelectedCountry(relatedMovements, selectedCountry);
        updateBubbleLayer(aggregatedData);
    }
}

function aggregateGlobalMovementCounts(geoJson) {
    // This function aggregates movement counts for all countries, creating a global overview.
    let counts = {};
    geoJson.features.forEach(feature => {
        let country = feature.properties.country_from;
        if (!counts[country]) counts[country] = 0;
        counts[country] += feature.properties.movement_count;
    });

    // Convert the counts into the format expected by the bubble layer.
    return Object.entries(counts).map(([country, count]) => ({
        type: "Feature",
        properties: {
            country_from: country,
            movement_count: count,
        },
        geometry: {
            type: "Point",
            coordinates: getOriginCoordinates(country, geoJson) // Assuming this function returns appropriate coordinates
        }
    }));
}

function filterRelatedMovements(selectedCountry, geoJson) {
    // Filter movements related to the selected country, either as origin or destination.
    return geoJson.features.filter(feature =>
        feature.properties.country_from === selectedCountry || feature.properties.country_to === selectedCountry
    );
}

function aggregateDataForSelectedCountry(movements, selectedCountry) {
    // Aggregate data for the selected country, similar to aggregateDataForBothDirections or any specific logic needed.
    // This is a placeholder for the aggregation logic, which should match your app's requirements.
    return aggregateDataForBothDirections(selectedCountry, movements);
}


