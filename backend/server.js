const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const axios = require('axios');
require('dotenv').config();

const { supabase, testConnection } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const fallbackPatientsFile = path.join(dataDir, 'patients.json');
const fallbackClinicsFile = path.join(dataDir, 'clinics.json');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readFallbackRecords(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeFallbackRecords(filePath, records) {
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
}

function saveFallbackPatient(patient) {
  const records = readFallbackRecords(fallbackPatientsFile);
  const next = [...records, patient];
  writeFallbackRecords(fallbackPatientsFile, next);
  return patient;
}

function saveFallbackClinic(clinic) {
  const records = readFallbackRecords(fallbackClinicsFile);
  const existingIndex = records.findIndex((item) => item.name?.toLowerCase() === clinic.name?.toLowerCase());
  const next = existingIndex >= 0 ? records.map((item, index) => index === existingIndex ? { ...item, ...clinic } : item) : [...records, clinic];
  writeFallbackRecords(fallbackClinicsFile, next);
  return clinic;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short'));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON inválido en la solicitud' });
  }
  next(err);
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, espera un momento' }
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muchas búsquedas, espera un momento' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Espera un momento para registrar más' }
});

const ocrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes OCR, espera un momento' }
});

app.use(generalLimiter);
app.use(express.static(path.join(__dirname, '../frontend'), { maxAge: '1h' }));

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function ensureClinic(clinicName, clinicAddress, clinicPhone) {
  const name = String(clinicName || '').trim();
  if (!name) return null;

  try {
    const { data, error } = await supabase
      .from('clinics')
      .upsert({
        name,
        address: clinicAddress?.trim() || null,
        phone: clinicPhone?.trim() || null
      }, { onConflict: 'name' })
      .select('id, name');

    if (error) throw error;
    return data && data[0] ? data[0] : null;
  } catch (error) {
    console.error('Error guardando clínica:', error.message);
    const clinic = {
      id: `local-${Date.now()}`,
      name,
      address: clinicAddress?.trim() || null,
      phone: clinicPhone?.trim() || null,
      created_at: new Date().toISOString()
    };
    saveFallbackClinic(clinic);
    return clinic;
  }
}

app.get('/api/admin/login', async (req, res) => {
  const { password } = req.query;
  if (!password) {
    return res.status(400).json({ error: 'Se requiere la contraseña' });
  }

  res.json({
    success: password === process.env.ADMIN_PASSWORD,
    message: password === process.env.ADMIN_PASSWORD ? 'Acceso permitido' : 'Contraseña incorrecta'
  });
});

app.get('/api/search', searchLimiter, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Escribe al menos 2 caracteres' });
    }

    const searchTerm = q.trim();
    const normalized = normalizeText(searchTerm);
    const isCedula = /^(?:V|E)[-\s]?\d{6,10}$/i.test(searchTerm.replace(/\s/g, ''));

    let query;

    if (isCedula) {
      const cedulaClean = searchTerm.replace(/[\s-]/g, '').toUpperCase();
      query = supabase
        .from('patients')
        .select('*')
        .or(`cedula.ilike.%${cedulaClean}%,cedula.ilike.%${searchTerm}%`);
    } else {
      const words = normalized.split(/\s+/).filter((word) => word.length >= 2);

      if (words.length === 0) {
        return res.json({ success: true, count: 0, results: [] });
      }

      let conditions = words.map((word) => `name_normalized.ilike.%${word}%`).join(',');
      conditions += `,full_name.ilike.%${searchTerm}%`;

      query = supabase.from('patients').select('*').or(conditions);
    }

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(50);
    if (error) throw error;

    let results = data || [];
    if (!isCedula && results.length > 1) {
      results.sort((a, b) => {
        const aMatch = a.name_normalized.includes(normalized) ? 1 : 0;
        const bMatch = b.name_normalized.includes(normalized) ? 1 : 0;
        return bMatch - aMatch;
      });
    }

    supabase.from('search_log').insert({ search_term: searchTerm, results_count: results.length }).then(() => {}).catch(() => {});

    res.json({
      success: true,
      count: results.length,
      results: results.map((patient) => ({
        id: patient.id,
        full_name: patient.full_name,
        cedula: patient.cedula,
        age: patient.age,
        clinic_name: patient.clinic_name,
        clinic_address: patient.clinic_address,
        clinic_phone: patient.clinic_phone,
        building: patient.building,
        contact_phone: patient.contact_phone,
        contact_name: patient.contact_name,
        status: patient.status,
        notes: patient.notes,
        updated_at: patient.updated_at
      }))
    });
  } catch (error) {
    console.error('Error búsqueda:', error);
    res.status(500).json({ error: 'Error en la búsqueda, intenta de nuevo' });
  }
});

app.post('/api/register', registerLimiter, async (req, res) => {
  try {
    const {
      full_name,
      cedula,
      age,
      clinic_name,
      clinic_address,
      clinic_phone,
      building,
      contact_phone,
      contact_name,
      status,
      notes,
      admin_password
    } = req.body;

    if (admin_password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    if (!full_name || !clinic_name) {
      return res.status(400).json({ error: 'Nombre y clínica son obligatorios' });
    }

    await ensureClinic(clinic_name, clinic_address, clinic_phone);

    const { data, error } = await supabase
      .from('patients')
      .insert({
        full_name: full_name.trim(),
        cedula: cedula?.trim() || null,
        age: age?.trim() || null,
        clinic_name: clinic_name.trim(),
        clinic_address: clinic_address?.trim() || null,
        clinic_phone: clinic_phone?.trim() || null,
        building: building?.trim() || null,
        contact_phone: contact_phone?.trim() || null,
        contact_name: contact_name?.trim() || null,
        status: status || 'ingresado',
        notes: notes?.trim() || null,
        source: 'manual'
      })
      .select();

    if (error) {
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        const fallbackPatient = saveFallbackPatient({
          id: `local-${Date.now()}`,
          full_name: full_name.trim(),
          cedula: cedula?.trim() || null,
          age: age?.trim() || null,
          clinic_name: clinic_name.trim(),
          clinic_address: clinic_address?.trim() || null,
          clinic_phone: clinic_phone?.trim() || null,
          building: building?.trim() || null,
          contact_phone: contact_phone?.trim() || null,
          contact_name: contact_name?.trim() || null,
          status: status || 'ingresado',
          notes: notes?.trim() || null,
          source: 'manual',
          created_at: new Date().toISOString()
        });

        return res.status(201).json({
          success: true,
          fallback: true,
          message: `✅ ${full_name} registrado localmente porque Supabase bloqueó la inserción por RLS.`,
          patient: fallbackPatient
        });
      }
      throw error;
    }

    res.status(201).json({ success: true, message: `✅ ${full_name} registrado en ${clinic_name}`, patient: data[0] });
  } catch (error) {
    console.error('Error registro:', error);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/api/register-bulk', registerLimiter, async (req, res) => {
  try {
    const { patients, clinic_name, clinic_address, clinic_phone, admin_password } = req.body;

    if (admin_password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    if (!Array.isArray(patients) || patients.length === 0) {
      return res.status(400).json({ error: 'Lista vacía' });
    }

    await ensureClinic(clinic_name, clinic_address, clinic_phone);

    const batch = patients
      .slice(0, 200)
      .filter((patient) => patient.full_name && patient.full_name.trim().length >= 3)
      .map((patient) => ({
        full_name: patient.full_name.trim(),
        cedula: patient.cedula?.trim() || null,
        age: patient.age?.trim() || null,
        clinic_name: clinic_name || patient.clinic_name || 'Sin asignar',
        clinic_address: clinic_address || patient.clinic_address || null,
        clinic_phone: clinic_phone || patient.clinic_phone || null,
        building: patient.building?.trim() || null,
        contact_phone: patient.contact_phone?.trim() || null,
        contact_name: patient.contact_name?.trim() || null,
        status: 'ingresado',
        source: patient.source || 'bulk'
      }));

    if (batch.length === 0) {
      return res.status(400).json({ error: 'No hay nombres válidos' });
    }

    const { data, error } = await supabase.from('patients').insert(batch).select();
    if (error) {
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        const fallbackPatients = batch.map((patient) => ({
          ...patient,
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          clinic_name: clinic_name?.trim() || patient.clinic_name || null,
          clinic_address: clinic_address?.trim() || null,
          clinic_phone: clinic_phone?.trim() || null,
          source: 'manual',
          created_at: new Date().toISOString()
        }));
        fallbackPatients.forEach((patient) => saveFallbackPatient(patient));

        return res.status(201).json({
          success: true,
          fallback: true,
          message: `✅ ${fallbackPatients.length} pacientes guardados localmente por bloqueo de Supabase.`,
          count: fallbackPatients.length
        });
      }
      throw error;
    }

    res.status(201).json({ success: true, message: `✅ ${data.length} personas registradas en ${clinic_name}`, count: data.length });
  } catch (error) {
    console.error('Error masivo:', error);
    res.status(500).json({ error: 'Error en registro masivo' });
  }
});

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo imágenes'));
    }
  }
});

app.post('/api/ocr', ocrLimiter, upload.single('image'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió imagen' });
    }

    if (req.body.admin_password !== process.env.ADMIN_PASSWORD) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    filePath = req.file.path;
    const rawText = await extractTextFromImage(filePath);

    fs.unlinkSync(filePath);
    filePath = null;

    const parsed = parseListFromText(rawText);

    res.json({ success: true, raw_text: rawText, parsed, count: parsed.length });
  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    console.error('Error OCR:', error);
    res.status(500).json({ error: 'Error procesando imagen. Intenta con foto más clara.' });
  }
});

async function extractTextFromImage(filePath) {
  const base64 = fs.readFileSync(filePath, 'base64');

  if (process.env.GOOGLE_CLOUD_API_KEY) {
    try {
      const visionResponse = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_CLOUD_API_KEY}`,
        {
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
          }]
        },
        { timeout: 20000 }
      );

      const text = visionResponse?.data?.responses?.[0]?.fullTextAnnotation?.text || '';
      if (text.trim()) return text.trim();
    } catch (visionError) {
      console.warn('Google Vision falló, intentando OCR.space:', visionError.message);
    }
  }

  try {
    const response = await axios.post(
      'https://api.ocr.space/parse/image',
      {
        apikey: process.env.OCRSPACE_API_KEY || 'helloworld',
        language: 'spa',
        isOverlayRequired: false,
        base64image: `data:image/png;base64,${base64}`
      },
      { timeout: 30000 }
    );

    const text = response?.data?.ParsedResults?.[0]?.ParsedText || '';
    if (text.trim()) return text.trim();
  } catch (ocrSpaceError) {
    console.warn('OCR.space falló, usando Tesseract local:', ocrSpaceError.message);
  }

  const tessResult = await Tesseract.recognize(filePath, 'spa', { logger: () => {} });
  return tessResult.data.text || '';
}

function parseListFromText(text) {
  const results = [];
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 3);

  for (const line of lines) {
    let cleaned = line
      .replace(/^\d+[\.\)\-\s]+/, '')
      .replace(/^[\-•\*\>\s]+/, '')
      .trim();

    if (cleaned.length < 3) continue;

    let age = null;
    let name = cleaned;

    const ageMatch = cleaned.match(/[,\-\s]+(\d{1,3})\s*(años|a)?\.?\s*$/i);
    if (ageMatch) {
      age = ageMatch[1];
      name = cleaned.substring(0, cleaned.indexOf(ageMatch[0])).trim();
    }

    let cedula = null;
    const cedulaMatch = name.match(/[VvEe][-\s]?(\d{6,10})/);
    if (cedulaMatch) {
      cedula = cedulaMatch[0].toUpperCase().replace(/\s/g, '');
      name = name.replace(cedulaMatch[0], '').trim();
    }

    name = name
      .replace(/[^a-záéíóúñA-ZÁÉÍÓÚÑ\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (name.length >= 3 && /[a-záéíóúñ]{2,}/i.test(name)) {
      results.push({ full_name: name, age, cedula });
    }
  }

  return results;
}

app.get('/api/stats', async (req, res) => {
  try {
    const { count: totalPatients } = await supabase.from('patients').select('*', { count: 'exact', head: true });
    const { count: totalSearches } = await supabase.from('search_log').select('*', { count: 'exact', head: true });
    const { data: clinics } = await supabase.from('clinics').select('name');

    res.json({ total_patients: totalPatients || 0, total_searches: totalSearches || 0, total_clinics: clinics?.length || 0 });
  } catch (error) {
    res.json({ total_patients: 0, total_searches: 0, total_clinics: 0 });
  }
});

app.get('/api/clinics', async (req, res) => {
  try {
    const { data } = await supabase.from('clinics').select('*').order('name');
    res.json({ clinics: data || [] });
  } catch (error) {
    res.json({ clinics: [] });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🏥 Busca a tu Familiar\nServidor: http://localhost:${PORT}\n`);
  await testConnection();
});
