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

// Excel
const xlsFileInput = document.getElementById('xls-file');
const xlsUploadLabel = document.getElementById('xls-upload-label');
const xlsFileInfo = document.getElementById('xls-file-info');
const xlsFilename = document.getElementById('xls-filename');
const xlsRowCount = document.getElementById('xls-row-count');
const xlsTotalCount = document.getElementById('xls-total-count');
const xlsPreviewBox = document.getElementById('xls-preview-box');
const xlsPreview = document.getElementById('xls-preview');
const xlsUploadBtn = document.getElementById('xls-upload-btn');
const xlsProgress = document.getElementById('xls-progress');
const xlsProgressBar = document.getElementById('xls-progress-bar');
const xlsProgressText = document.getElementById('xls-progress-text');
const xlsMessage = document.getElementById('xls-message');
const xlsClinic = document.getElementById('xls-clinic');
const xlsPhone = document.getElementById('xls-phone');
const xlsPassword = document.getElementById('xls-password');

let currentPassword = '';
let parsedOcrItems = [];
let xlsPatients = [];

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

// ==========================================
// EXCEL UPLOADER
// Adaptado para Excel de Hospitales (Venezuela)
// Columnas: N°, APELLIDOS Y NOMBRES, EDAD,
// CÉDULA/ID, TELÉFONO, DIRECCIÓN, OBSERVACIONES
// ==========================================

// Buscar índice de columna por palabras clave
function findCol(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toUpperCase();
    for (const keyword of keywords) {
      if (h.includes(keyword)) return i;
    }
  }
  return -1;
}

// Leer archivo Excel cuando se selecciona
xlsFileInput.addEventListener('change', () => {
  const file = xlsFileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: ''
      });

      if (rows.length < 2) {
        setMessage(xlsMessage, 'El archivo está vacío', true);
        return;
      }

      // Buscar fila de encabezados (puede no estar en la fila 0
      // si el Excel tiene título tipo "HOSPITAL UNIVERSITARIO..." arriba)
      let headerIndex = -1;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const rowText = rows[i].join('|').toUpperCase();
        if (rowText.includes('APELLIDO') ||
            rowText.includes('NOMBRE') ||
            rowText.includes('PACIENTE')) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1) {
        setMessage(xlsMessage,
          'No se encontraron encabezados. El Excel debe tener una columna como "APELLIDOS Y NOMBRES"',
          true);
        return;
      }

      const headers = rows[headerIndex].map((h) =>
        String(h || '').trim().toUpperCase()
      );

      // Detectar índices de cada columna
      const cols = {
        name: findCol(headers, ['APELLIDO', 'NOMBRE', 'PACIENTE']),
        age: findCol(headers, ['EDAD', 'AÑOS', 'AGE']),
        cedula: findCol(headers, ['CÉDULA', 'CEDULA', 'CI', 'DNI', 'DOCUMENTO']),
        phone: findCol(headers, ['TELÉFONO', 'TELEFONO', 'CELULAR', 'CONTACTO', 'PHONE']),
        address: findCol(headers, ['DIRECCIÓN', 'DIRECCION', 'HOSPITAL', 'CLÍNICA', 'CLINICA']),
        notes: findCol(headers, ['OBSERVACIÓN', 'OBSERVACION', 'NOTA', 'COMENTARIO', 'DIAGNÓSTICO', 'DIAGNOSTICO'])
      };

      if (cols.name === -1) {
        setMessage(xlsMessage, 'No se encontró columna de NOMBRE', true);
        return;
      }

      // Procesar filas de datos
      const dataRows = rows.slice(headerIndex + 1);
      xlsPatients = [];
      let detectedClinic = '';

      dataRows.forEach((row) => {
        const name = String(row[cols.name] || '').trim();
        if (name.length < 3) return;

        // Limpiar cédula (quitar puntos y espacios)
        let cedula = '';
        if (cols.cedula !== -1) {
          cedula = String(row[cols.cedula] || '')
            .replace(/[.\s]/g, '')
            .trim();
        }

        let age = '';
        if (cols.age !== -1) {
          age = String(row[cols.age] || '').trim();
        }

        let phone = '';
        if (cols.phone !== -1) {
          phone = String(row[cols.phone] || '').trim();
        }

        let clinicFromExcel = '';
        if (cols.address !== -1) {
          clinicFromExcel = String(row[cols.address] || '').trim();
          if (clinicFromExcel && !detectedClinic) {
            detectedClinic = clinicFromExcel;
          }
        }

        let notes = '';
        if (cols.notes !== -1) {
          notes = String(row[cols.notes] || '').trim();
        }

        xlsPatients.push({
          full_name: name,
          cedula: cedula || null,
          age: age || null,
          contact_phone: phone || null,
          notes: notes || null,
          source: 'excel'
        });
      });

      if (xlsPatients.length === 0) {
        setMessage(xlsMessage, 'No se encontraron pacientes válidos', true);
        return;
      }

      // Auto-llenar nombre del hospital si está vacío
      if (detectedClinic && !xlsClinic.value) {
        xlsClinic.value = detectedClinic;
      }

      // Mostrar info del archivo
      xlsFilename.textContent = file.name;
      xlsRowCount.textContent = xlsPatients.length;
      xlsTotalCount.textContent = xlsPatients.length;
      xlsUploadLabel.classList.add('hidden');
      xlsFileInfo.classList.remove('hidden');
      xlsPreviewBox.classList.remove('hidden');

      // Vista previa
      showXlsPreview();

      setMessage(xlsMessage,
        `${xlsPatients.length} pacientes listos para cargar`,
        false);

    } catch (err) {
      console.error('Error leyendo Excel:', err);
      setMessage(xlsMessage,
        'Error leyendo el archivo. Verifica que sea Excel válido.',
        true);
    }
  };

  reader.readAsArrayBuffer(file);
});

// Mostrar preview de los primeros 5 registros
function showXlsPreview() {
  const preview = xlsPatients.slice(0, 5);

  let html = `
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Edad</th>
          <th>Cédula</th>
          <th>Teléfono</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
  `;

  preview.forEach((p) => {
    html += `
      <tr>
        <td>${p.full_name || ''}</td>
        <td>${p.age || '-'}</td>
        <td>${p.cedula || '-'}</td>
        <td>${p.contact_phone || '-'}</td>
        <td>${p.notes ? p.notes.substring(0, 40) : '-'}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  xlsPreview.innerHTML = html;
}

// Cargar al servidor por lotes
xlsUploadBtn.addEventListener('click', async () => {
  const clinic = xlsClinic.value.trim();
  const phone = xlsPhone.value.trim();
  const password = currentPassword || xlsPassword.value;

  if (!clinic) {
    setMessage(xlsMessage, 'Indica el nombre del hospital/clínica', true);
    return;
  }
  if (!password) {
    setMessage(xlsMessage, 'Falta la contraseña de admin', true);
    return;
  }
  if (xlsPatients.length === 0) {
    setMessage(xlsMessage, 'No hay pacientes para cargar', true);
    return;
  }

  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(xlsPatients.length / BATCH_SIZE);
  let uploaded = 0;
  let errors = 0;

  xlsProgress.classList.remove('hidden');
  xlsUploadBtn.disabled = true;
  xlsUploadBtn.textContent = '⏳ Cargando...';

  for (let i = 0; i < totalBatches; i++) {
    const batch = xlsPatients.slice(
      i * BATCH_SIZE,
      (i + 1) * BATCH_SIZE
    );

    try {
      const response = await fetch('/api/register-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patients: batch,
          clinic_name: clinic,
          clinic_phone: phone,
          admin_password: password
        })
      });

      const result = await response.json();

      if (response.ok && result.success !== false) {
        uploaded += result.count || batch.length;
      } else {
        errors += batch.length;
        console.error('Error lote', i, ':', result.error);
      }
    } catch (err) {
      errors += batch.length;
      console.error('Error lote', i, ':', err);
    }

    const progress = Math.round(((i + 1) / totalBatches) * 100);
    xlsProgressBar.style.width = progress + '%';
    xlsProgressText.textContent =
      `Lote ${i + 1}/${totalBatches} - ${uploaded} cargados`;

    // Pequeña pausa entre lotes para no saturar
    await new Promise((r) => setTimeout(r, 300));
  }

  xlsProgressText.textContent =
    `✅ Completado: ${uploaded} de ${xlsPatients.length}`;

  setMessage(xlsMessage,
    `✅ ${uploaded} pacientes cargados en ${clinic}${errors ? ` (${errors} errores)` : ''}`,
    errors > 0);

  xlsUploadBtn.disabled = false;
  xlsUploadBtn.innerHTML = `📥 Cargar <span id="xls-total-count">${xlsPatients.length}</span> pacientes`;

  // Recargar lista de clínicas para el datalist
  loadClinics();
});

window.addEventListener('DOMContentLoaded', () => {
  loadClinics();
});