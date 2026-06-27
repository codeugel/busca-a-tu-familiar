const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const loading = document.getElementById('loading');
const status = document.getElementById('search-status');

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    document.getElementById('stat-patients').textContent = data.total_patients || 0;
    document.getElementById('stat-clinics').textContent = data.total_clinics || 0;
    document.getElementById('stat-searches').textContent = data.total_searches || 0;
  } catch (error) {
    console.error(error);
  }
}

function renderResults(items, query) {
  resultsContainer.innerHTML = '';

  if (!items.length) {
    resultsContainer.innerHTML = `
      <div class="card">
        <h3>No se encontraron resultados</h3>
        <p>Prueba con un nombre completo, parte del nombre o una cédula.</p>
      </div>`;
    return;
  }

  const queryText = query.trim();
  const highlight = (text) => {
    if (!text) return '';
    const safeText = String(text);
    if (!queryText) return safeText;
    const regex = new RegExp(`(${queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    return safeText.replace(regex, '<span class="highlight">$1</span>');
  };

  const cards = items.map((patient) => {
    const statusClass = patient.status === 'alta' ? 'alt' : patient.status === 'pendiente' ? 'pending' : '';
    const updatedAt = patient.updated_at ? new Date(patient.updated_at).toLocaleString('es-VE') : 'Sin registro';
    return `
      <article class="result-card">
        <h3>${highlight(patient.full_name || 'Sin nombre')}</h3>
        <p><strong>Cédula:</strong> ${patient.cedula || 'No registrada'}</p>
        <p><strong>Edad:</strong> ${patient.age || 'No registrada'}</p>
        <p><strong>Clínica:</strong> ${patient.clinic_name || 'Sin clínica'}</p>
        <p><strong>Dirección:</strong> ${patient.clinic_address || 'No registrada'}</p>
        <p><strong>Teléfono:</strong> ${patient.clinic_phone || 'No registrado'}</p>
        <p><strong>Edificio:</strong> ${patient.building || 'No registrado'}</p>
        <p><strong>Contacto:</strong> ${patient.contact_name || 'No registrado'} ${patient.contact_phone ? `- ${patient.contact_phone}` : ''}</p>
        <div class="badge ${statusClass}">${patient.status || 'Ingresado'}</div>
        <p class="status-text">Actualizado: ${updatedAt}</p>
      </article>`;
  });

  resultsContainer.innerHTML = cards.join('');
}

async function runSearch(query) {
  loading.classList.remove('hidden');
  status.textContent = 'Buscando...';
  resultsContainer.innerHTML = '';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo completar la búsqueda');
    }

    renderResults(data.results || [], query);
    status.textContent = `${data.count} resultado${data.count === 1 ? '' : 's'} encontrado${data.count === 1 ? '' : 's'}`;
  } catch (error) {
    status.textContent = error.message;
    resultsContainer.innerHTML = `<div class="card"><h3>Error</h3><p>${error.message}</p></div>`;
  } finally {
    loading.classList.add('hidden');
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(searchInput.value);
});

window.addEventListener('DOMContentLoaded', () => {
  loadStats();
  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (initialQuery) {
    searchInput.value = initialQuery;
    runSearch(initialQuery);
  }
});
