// Initialize Leaflet map
const map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
}).addTo(map);

// State variables
let currentLayer = null;
let coordinateList = [];
let isPolygonComplete = false;
let searchResults = [];
let resultLayers = L.layerGroup().addTo(map);

// Utility Functions
function showNotification(message, isError = false) {
  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.bottom = '20px';
  notification.style.right = '20px';
  notification.style.padding = '10px 20px';
  notification.style.background = isError ? '#ff4444' : '#4CAF50';
  notification.style.color = 'white';
  notification.style.borderRadius = '5px';
  notification.style.zIndex = '1000';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function clearMap() {
  if (currentLayer) {
    map.removeLayer(currentLayer);
    currentLayer = null;
  }
}

// Geometry Functions
function renderGeometry(geometryType, coordinates) {
  clearMap();

  let geojsonFeature;

  if (geometryType === 'Point') {
    geojsonFeature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: coordinates,
      },
    };
  } else if (geometryType === 'LineString') {
    geojsonFeature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: coordinates,
      },
    };
  } else if (geometryType === 'Polygon') {
    if (coordinates.length > 0 && coordinates[0].length > 0) {
      const closedRing = [...coordinates[0]];
      if (closedRing.length > 2 && 
          (closedRing[0][0] !== closedRing[closedRing.length-1][0] || 
           closedRing[0][1] !== closedRing[closedRing.length-1][1])) {
        closedRing.push([...closedRing[0]]);
      }
      coordinates = [closedRing];
    }

    geojsonFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: coordinates,
      },
    };
  } else {
    showNotification("Unsupported geometry type: " + geometryType, true);
    return;
  }

  currentLayer = L.geoJSON(geojsonFeature).addTo(map);

  try {
    map.fitBounds(currentLayer.getBounds());
  } catch (e) {
    if (geometryType === 'Point') {
      map.setView([coordinates[1], coordinates[0]], 14);
    }
  }
}

// Coordinate Management
function updateCoordinatesInput() {
  const geometryType = document.getElementById('geometry_type').value;
  let result;
  
  if (geometryType === 'Point') {
    result = coordinateList.length > 0 ? coordinateList[0] : [];
  } else if (geometryType === 'LineString') {
    result = coordinateList;
  } else if (geometryType === 'Polygon') {
    result = coordinateList.length > 0 ? [coordinateList] : [[]];
  }

  document.getElementById('coordinates').value = JSON.stringify(result);
  updateMapPreview();
}

function updateMapPreview() {
  const geometryType = document.getElementById('geometry_type').value;
  const coordsText = document.getElementById('coordinates').value.trim();

  if (!coordsText) {
    clearMap();
    return;
  }

  try {
    const coords = JSON.parse(coordsText);
    renderGeometry(geometryType, coords);
  } catch (e) {
    clearMap();
    console.error("Invalid coordinates JSON:", e);
  }
}

function updateUIForGeometryType() {
  const geometryType = document.getElementById('geometry_type').value;
  const finishBtn = document.getElementById('finishPolygonBtn');
  
  if (geometryType === 'Polygon') {
    finishBtn.style.display = 'inline-block';
    isPolygonComplete = false;
  } else {
    finishBtn.style.display = 'none';
    isPolygonComplete = true;
  }
  
  coordinateList = [];
  document.getElementById('coordinateList').innerHTML = '';
  updateCoordinatesInput();
}

// Point and Polygon Functions
function addPointFromInputs() {
  const easting = parseFloat(document.getElementById('easting').value);
  const northing = parseFloat(document.getElementById('northing').value);

  if (isNaN(easting) || isNaN(northing)) {
    showNotification("Please enter valid numeric coordinates", true);
    return;
  }

  coordinateList.push([easting, northing]);
  
  const li = document.createElement('li');
  li.textContent = `(${easting}, ${northing})`;
  document.getElementById('coordinateList').appendChild(li);
  
  updateCoordinatesInput();
  
  document.getElementById('easting').value = '';
  document.getElementById('northing').value = '';
}

function finishPolygon() {
  if (coordinateList.length < 3) {
    showNotification("A polygon requires at least 3 points", true);
    return;
  }
  
  isPolygonComplete = true;
  updateCoordinatesInput();
}

// Search Functions
function displayResults(results) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';
  
  results.forEach(record => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.id}</td>
      <td>${record.owner_name}</td>
      <td>${record.survey_date}</td>
      <td>${record.geometry_type}</td>
    `;
    
    row.addEventListener('click', () => {
      showRecordDetails(record);
      zoomToRecord(record);
    });
    
    tbody.appendChild(row);
  });
}

function zoomToRecord(record) {
  if (record.geometry_geojson) {
    const layer = L.geoJSON(record.geometry_geojson);
    map.fitBounds(layer.getBounds());
    
    resultLayers.eachLayer(l => {
      if (l.feature) {
        l.setStyle({
          color: l.feature.properties?.id === record.id ? '#ff0000' : '#3388ff',
          weight: l.feature.properties?.id === record.id ? 5 : 3
        });
      }
    });
  }
}

function showRecordDetails(record) {
  const detailsContent = document.getElementById('details-content');
  detailsContent.innerHTML = `
    <p><strong>ID:</strong> ${record.id}</p>
    <p><strong>Owner:</strong> ${record.owner_name}</p>
    <p><strong>Survey Date:</strong> ${record.survey_date}</p>
    <p><strong>Geometry Type:</strong> ${record.geometry_type}</p>
    <p><strong>SRID:</strong> ${record.srid}</p>
    <p><strong>Notes:</strong> ${record.notes || 'None'}</p>
    <p><strong>Coordinates:</strong></p>
    <pre>${JSON.stringify(record.coordinates, null, 2)}</pre>
  `;
  
  document.getElementById('record-details').style.display = 'block';
  document.getElementById('results-table-container').style.display = 'none';
}

function hideDetails() {
  document.getElementById('record-details').style.display = 'none';
  document.getElementById('results-table-container').style.display = 'block';
}

function clearSearch() {
  document.getElementById('search-owner').value = '';
  document.getElementById('results-body').innerHTML = '';
  resultLayers.clearLayers();
  searchResults = [];
  hideDetails();
}

async function searchRecords() {
  const searchTerm = document.getElementById('search-owner').value.trim();
  
  try {
    let url = 'http://localhost:5000/records';
    if (searchTerm) {
      url += `?owner_name=${encodeURIComponent(searchTerm)}`;
    }
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    
    searchResults = await response.json();
    displayResults(searchResults);
    
    resultLayers.clearLayers();
    
    searchResults.forEach(record => {
      if (record.geometry_geojson) {
        const layer = L.geoJSON(record.geometry_geojson, {
          onEachFeature: (feature, layer) => {
            layer.on('click', () => showRecordDetails(record));
          }
        });
        resultLayers.addLayer(layer);
      }
    });
    
    if (searchResults.length > 0) {
      map.fitBounds(resultLayers.getBounds());
    }
    
  } catch (error) {
    console.error("Search error:", error);
    showNotification(`Search failed: ${error.message}`, true);
  }
}

// Form Submission
async function submitForm(e) {
  e.preventDefault();

  const geometryType = document.getElementById('geometry_type').value;
  const owner_name = document.getElementById('owner_name').value.trim();
  const survey_date = document.getElementById('survey_date').value;
  const notes = document.getElementById('notes').value.trim();
  const srid = parseInt(document.getElementById('srid').value);
  let coordinates;

  try {
    coordinates = JSON.parse(document.getElementById('coordinates').value);
  } catch {
    showNotification('Invalid coordinates JSON', true);
    return;
  }

  if (geometryType === 'Point' && (!Array.isArray(coordinates) || coordinates.length !== 2)) {
    showNotification("Point requires exactly 2 coordinates [x, y]", true);
    return;
  }
  
  if (geometryType === 'LineString' && (!Array.isArray(coordinates) || coordinates.length < 2)) {
    showNotification("LineString requires at least 2 points", true);
    return;
  }
  
  if (geometryType === 'Polygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0 || 
        !Array.isArray(coordinates[0]) || coordinates[0].length < 3) {
      showNotification("Polygon requires at least 3 points", true);
      return;
    }
    
    const first = coordinates[0][0];
    const last = coordinates[0][coordinates[0].length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates[0].push([first[0], first[1]]);
    }
  }

  if (!owner_name || !survey_date || !geometryType || !coordinates) {
    showNotification("Please fill in all required fields.", true);
    return;
  }

  const data = {
    owner_name,
    survey_date,
    geometry_type: geometryType,
    coordinates,
    srid,
    notes: notes || null,
  };

  try {
    const response = await fetch('http://localhost:5000/records', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (response.ok) {
      showNotification(`Record added successfully with ID: ${result.record.id}`);
      document.getElementById('recordForm').reset();
      coordinateList = [];
      document.getElementById('coordinateList').innerHTML = '';
      clearMap();
      updateUIForGeometryType();
    } else {
      showNotification('Error: ' + (result.error || 'Unknown error'), true);
    }
  } catch (error) {
    showNotification('Network error: ' + error.message, true);
  }
}

// Data Loading
async function loadRecords() {
  try {
    const response = await fetch('http://localhost:5000/records');
    if (!response.ok) throw new Error("Failed to fetch records");

    const records = await response.json();

    records.forEach(rec => {
      if (rec.geometry_geojson) {
        L.geoJSON(rec.geometry_geojson).addTo(map);
      }
    });
  } catch (error) {
    console.error("Failed to load records:", error);
    showNotification("Failed to load records", true);
  }
}

// Initialize Application
function initializeApp() {
  // Set up event listeners
  document.getElementById('geometry_type').addEventListener('change', updateUIForGeometryType);
  document.getElementById('addPointBtn').addEventListener('click', addPointFromInputs);
  document.getElementById('finishPolygonBtn').addEventListener('click', finishPolygon);
  document.getElementById('coordinates').addEventListener('input', function() {
    const geometryType = document.getElementById('geometry_type').value;
    const coordsText = document.getElementById('coordinates').value.trim();
    if (coordsText) {
      try {
        const coords = JSON.parse(coordsText);
        renderGeometry(geometryType, coords);
      } catch (e) {
        console.error("Invalid coordinates JSON:", e);
      }
    } else {
      clearMap();
    }
  });
  document.getElementById('recordForm').addEventListener('submit', submitForm);
  document.getElementById('search-btn').addEventListener('click', searchRecords);
  document.getElementById('clear-search').addEventListener('click', clearSearch);
  document.getElementById('close-details').addEventListener('click', hideDetails);

  // Initialize UI
  updateUIForGeometryType();
  loadRecords();
  searchRecords();
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);