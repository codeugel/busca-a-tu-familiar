const loginPanel = document.getElementById('login-panel');
const adminPanel = document.getElementById('admin-panel');
const loginBtn = document.getElementById('login-btn');
const loginMessage = document.getElementById('login-message');
const adminPasswordInput = document.getElementById('admin-password');

const tabs = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const clinicDatalist = document.getElementById('clinic-list');

const manualForm = document.getElementById('manual-form');
const manualMessage = document.getElementById('manual-message');

const ocrForm = document.getElementById('ocr-form');
const ocrFileInput = document.getElementById('ocr-file');
const ocrPreview = document.getElementById('ocr-preview');
const ocrRaw = document.getElementById('ocr-raw');
const ocrList = document.getElementById('ocr-list');
const ocrMessage = document.getElementById('ocr-message');
const saveOcrBtn = document.getElementById('save-ocr-btn');
const ocrProgress = document.getElementById('ocr-progress');
const ocrProgressBar = ocrProgress.querySelector('div');

const bulkForm = document.getElementById('bulk-form');
const bulkMessage = document.getElementById('bulk-message');

let currentPassword = '';
let parsedOcrItems = [];

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? '#d93025' : '#188038';
}

async function loadClinics() {
  try {
    const response = await fetch('/api/clinics');
    const data = await response.json();
    clinicDatalist.innerHTML = (data.clinics || []).map((clinic) => `<option value="${clinic.name}"></option>`).join('');
  } catch (error) {
    console.error(error);
  }
}

loginBtn.addEventListener('click', () => {
  currentPassword = adminPasswordInput.value;
  if (!currentPassword) {
    setMessage(loginMessage, 'Ingresa la contraseña', true);
    return;
  }

  loginPanel.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  setMessage(loginMessage, 'Acceso concedido', false);
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((item) => item.classList.remove('active'));
    tabPanels.forEach((panel) => panel.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

manualForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(manualForm);
  const payload = Object.fromEntries(formData.entries());
  payload.admin_password = currentPassword || payload.admin_password;

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo guardar');
    manualForm.reset();
    setMessage(manualMessage, result.message || 'Paciente registrado', false);
  } catch (error) {
    setMessage(manualMessage, error.message, true);
  }
});

ocrFileInput.addEventListener('change', () => {
  const file = ocrFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    ocrPreview.src = event.target.result;
    ocrPreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

ocrForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = ocrFileInput.files[0];
  if (!file) {
    setMessage(ocrMessage, 'Selecciona una imagen', true);
    return;
  }

  const formData = new FormData();
  formData.append('image', file);
  formData.append('admin_password', currentPassword || document.getElementById('ocr-password').value);
  formData.append('clinic_name', document.getElementById('ocr-clinic').value);
  formData.append('clinic_phone', document.getElementById('ocr-phone').value);

  ocrRaw.textContent = '';
  ocrList.innerHTML = '';
  saveOcrBtn.classList.add('hidden');
  ocrProgress.classList.remove('hidden');
  ocrProgressBar.style.width = '10%';
  setMessage(ocrMessage, 'Procesando imagen...', false);

  try {
    const response = await fetch('/api/ocr', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo procesar');

    ocrRaw.textContent = result.raw_text || 'Sin texto detectado';
    parsedOcrItems = result.parsed || [];
    ocrList.innerHTML = parsedOcrItems.map((item, index) => `
      <label class="ocr-item">
        <input type="checkbox" checked data-index="${index}" />
        <div>
          <strong>${item.full_name}</strong><br />
          Edad: ${item.age || 'N/A'}<br />
          Cédula: ${item.cedula || 'N/A'}
        </div>
      </label>`).join('');
    saveOcrBtn.classList.remove('hidden');
    setMessage(ocrMessage, `${result.count} personas detectadas`, false);
  } catch (error) {
    setMessage(ocrMessage, error.message, true);
  } finally {
    ocrProgress.classList.add('hidden');
  }
});

saveOcrBtn.addEventListener('click', async () => {
  const selectedIndexes = Array.from(ocrList.querySelectorAll('input[type="checkbox"]'))
    .filter((input) => input.checked)
    .map((input) => Number(input.dataset.index));

  const selectedPatients = selectedIndexes.map((index) => parsedOcrItems[index]).filter(Boolean);
  if (!selectedPatients.length) {
    setMessage(ocrMessage, 'Selecciona al menos un paciente', true);
    return;
  }

  try {
    const response = await fetch('/api/register-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patients: selectedPatients,
        clinic_name: document.getElementById('ocr-clinic').value,
        clinic_phone: document.getElementById('ocr-phone').value,
        admin_password: currentPassword || document.getElementById('ocr-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo guardar');
    setMessage(ocrMessage, result.message || 'Guardado', false);
  } catch (error) {
    setMessage(ocrMessage, error.message, true);
  }
});

bulkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const lines = document.getElementById('bulk-text').value.split('\n').filter(Boolean);
  const patients = lines.map((line) => {
    const [full_name, age] = line.split(',').map((part) => part.trim());
    return { full_name, age };
  });

  try {
    const response = await fetch('/api/register-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patients,
        clinic_name: document.getElementById('bulk-clinic').value,
        clinic_phone: document.getElementById('bulk-phone').value,
        admin_password: currentPassword || document.getElementById('bulk-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo guardar');
    bulkForm.reset();
    setMessage(bulkMessage, result.message || 'Guardado', false);
  } catch (error) {
    setMessage(bulkMessage, error.message, true);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  loadClinics();
});
