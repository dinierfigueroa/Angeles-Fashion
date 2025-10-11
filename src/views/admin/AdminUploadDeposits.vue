<script setup>
import { ref, computed } from 'vue';
import { db } from '@/firebase';
import {
  collection, writeBatch, doc, serverTimestamp, query, where, getDocs, getDoc, Timestamp
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import AlertModal from '@/components/modals/AlertModal.vue';
import { useAuthStore } from '@/stores/authStore';
import { linkDepositToSales } from '@/services/reconcileService';

const authStore = useAuthStore();

const selectedFile = ref(null);
const fileName = ref('Ningún archivo seleccionado');
const selectedBank = ref('');
const excelHeaders = ref([]);
const excelData = ref([]);
const isProcessing = ref(false);
const isAlertOpen = ref(false);
const alertMessage = ref('');

/* ---------------- Normalización de banco -> bankKey ---------------- */
const normalizeBankKey = (raw = '') => {
  const s = raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (s.includes('CREDOMATIC') || s === 'BAC') return 'BAC';
  if (s.includes('FICO')) return 'FICOHSA';
  if (s.includes('ATLANT')) return 'ATLANTIDA';
  if (s.includes('PAIS')) return 'BANPAIS';
  if (s.includes('OCCIDENT')) return 'OCCIDENTE';
  return s || 'DESCONOCIDO';
};

const dbFields = ref([
  { key: 'transactionDate', label: 'Fecha de Transacción', required: true,  mappedColumn: '' },
  { key: 'description',     label: 'Descripción',          required: true,  mappedColumn: '' },
  { key: 'referenceT',      label: 'Referencia',           required: false, mappedColumn: '' },
  { key: 'amount',          label: 'Monto (Crédito)',      required: true,  mappedColumn: '' },
]);

const showMappingUI = computed(() => excelHeaders.value.length > 0 && selectedBank.value);
const previewData  = computed(() => excelData.value.length < 2 ? [] : excelData.value.slice(1, 6));

/* ---------------- Parseo de fechas desde Excel ---------------- */
const parseDate = (dateInput) => {
  if (!dateInput) return null;

  // Excel serial number
  if (typeof dateInput === 'number' && dateInput > 1) {
    const date = new Date(Math.round((dateInput - 25569) * 86400 * 1000));
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  // dd/mm/yyyy
  if (typeof dateInput === 'string') {
    const parts = dateInput.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
  }

  const finalAttempt = new Date(dateInput);
  return !isNaN(finalAttempt.getTime()) ? finalAttempt : null;
};

/* ---------------- Carga de archivo ---------------- */
const handleFileChange = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  selectedFile.value = file;
  fileName.value = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

      if (jsonData.length > 1) {
        excelHeaders.value = jsonData[0].map(String);
        excelData.value = jsonData;
      } else {
        showAlert('El archivo Excel está vacío o no tiene un formato válido.');
        resetFileState();
      }
    } catch (error) {
      console.error('Error al procesar el archivo Excel:', error);
      showAlert('Hubo un error al leer el archivo. Asegúrate de que sea un formato válido.');
      resetFileState();
    }
  };
  reader.readAsArrayBuffer(file);
};

/* ---------------- Subida y conciliación ---------------- */
const handleUpload = async () => {
  isProcessing.value = true;

  // Validación de mapeo
  if (dbFields.value.some(f => f.required && !f.mappedColumn)) {
    showAlert('Por favor, mapea todas las columnas requeridas (*).');
    isProcessing.value = false;
    return;
  }

  const mapping = dbFields.value.reduce((acc, f) => ({ ...acc, [f.key]: f.mappedColumn }), {});
  const dataRows = excelData.value.slice(1);

  // Parseo
  const parsedRows = dataRows.map(row => {
    const amountStr = String(row[excelHeaders.value.indexOf(mapping.amount)] || '0');
    const amount = parseFloat(amountStr.replace(/[^0-9.-]+/g, ''));
    const date = parseDate(row[excelHeaders.value.indexOf(mapping.transactionDate)]);
    const reference = mapping.referenceT ? String(row[excelHeaders.value.indexOf(mapping.referenceT)] || '') : '';
    if (isNaN(amount) || amount <= 0 || !date) return null;
    return {
      date,
      amount,
      reference,
      description: String(row[excelHeaders.value.indexOf(mapping.description)] || ''),
      dateStr: date.toISOString().split('T')[0]
    };
  }).filter(Boolean);

  if (parsedRows.length === 0) {
    showAlert('No se encontraron filas con datos válidos (fecha y monto positivo) en el archivo para procesar.');
    isProcessing.value = false;
    return;
  }

  // Rango de fechas para evitar duplicados por ventana
  const dates = parsedRows.map(r => r.date);
  const minDate = new Date(Math.min.apply(null, dates));
  const maxDate = new Date(Math.max.apply(null, dates));

  try {
    // Duplicados existentes en ventana
    const q = query(
      collection(db, 'deposits'),
      where('bank', '==', selectedBank.value),
      where('transactionDate', '>=', Timestamp.fromDate(minDate)),
      where('transactionDate', '<=', Timestamp.fromDate(maxDate))
    );
    const existingDepositsSnapshot = await getDocs(q);

    const existingKeys = new Set();
    existingDepositsSnapshot.forEach(d => {
      const data = d.data();
      const dateStr = data.transactionDate.toDate().toISOString().split('T')[0];
      const key = `${data.bank}-${dateStr}-${data.amount}-${data.referenceT || ''}`;
      existingKeys.add(key);
    });

    // Escritura batch
    const batch = writeBatch(db);
    let newCount = 0;
    let skippedCount = 0;
    const createdIds = [];

    for (const row of parsedRows) {
      const newKey = `${selectedBank.value}-${row.dateStr}-${row.amount}-${row.reference}`;
      if (existingKeys.has(newKey)) {
        skippedCount++;
        continue;
      }

      const newDepositRef = doc(collection(db, 'deposits'));
      batch.set(newDepositRef, {
        bank: selectedBank.value,
        bankKey: normalizeBankKey(selectedBank.value), // clave normalizada
        transactionDate: row.date,
        description: row.description,
        referenceT: row.reference,
        amount: row.amount,
        status: 'disponible',             // <- ESTADO INICIAL EN ESPAÑOL
        uploadDate: serverTimestamp(),
        createdBy_uid: doc(db, 'users', authStore.user.uid),
        matchedTotal: 0,
        remainingAmount: row.amount,
        settledBy: null,
        saleRef: []
      });

      existingKeys.add(newKey);
      newCount++;
      createdIds.push(newDepositRef.id);
    }

    // Commit
    if (newCount > 0) {
      await batch.commit();

      // Intento de conciliación inmediata en cliente (además de los triggers)
      for (const id of createdIds) {
        const dd = await getDoc(doc(db, 'deposits', id));
        if (dd.exists()) {
          const dep = { id, ...dd.data() };
          // tolerancia 0 Lempiras, ventana de ±1 día (ajustable)
          await linkDepositToSales(dep, { tolerance: 0, dayWindow: 1 });
        }
      }
    }

    // Mensaje
    let message = `Proceso completado.\n- Se subieron ${newCount} depósitos nuevos.`;
    if (skippedCount > 0) {
      message += `\n- Se omitieron ${skippedCount} depósitos duplicados.`;
    }
    showAlert(message);
    resetFileState();
  } catch (error) {
    console.error('Error al subir depósitos:', error);
    showAlert(`Ocurrió un error: ${error.message}. Es muy probable que necesites crear un índice en Firestore. Revisa la consola (F12) para ver el enlace.`);
  } finally {
    isProcessing.value = false;
  }
};

/* ---------------- Helpers UI ---------------- */
const resetFileState = () => {
  selectedFile.value = null;
  fileName.value = 'Ningún archivo seleccionado';
  excelHeaders.value = [];
  excelData.value = [];
  dbFields.value.forEach(f => (f.mappedColumn = ''));
  const fileInput = document.getElementById('excel-file-input');
  if (fileInput) fileInput.value = '';
};

const showAlert = (msg) => {
  alertMessage.value = msg;
  isAlertOpen.value = true;
};
</script>

<template>
  <div class="space-y-8">
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Subir Movimientos Bancarios</h2>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <input type="file" id="excel-file-input" class="hidden" accept=".xlsx, .xls, .csv" @change="handleFileChange">
        <label for="excel-file-input" class="cursor-pointer px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">
          Seleccionar Archivo
        </label>
        <p class="mt-4 text-sm text-gray-500">{{ fileName }}</p>
      </div>

      <div v-if="excelHeaders.length > 0" class="mt-8">
        <div class="mb-6">
          <label for="bank-select" class="block text-lg font-bold text-gray-800 mb-2">Paso 1: Selecciona el Banco</label>
          <select id="bank-select" v-model="selectedBank" class="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
            <option disabled value="">-- Elige un banco --</option>
            <option value="BAC Credomatic">BAC Credomatic</option>
            <option value="ATLANTIDA">ATLANTIDA</option>
            <option value="FICOHSA">FICOHSA</option>
            <option value="BANRURAL">BANRURAL</option>
            <option value="OCCIDENTE">OCCIDENTE</option>
            <option value="BANPAIS">BANPAIS</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="showMappingUI" class="bg-white p-6 rounded-lg shadow">
      <h3 class="text-lg font-bold text-gray-800">Paso 2: Mapeo de Columnas</h3>
      <p class="text-gray-600 mt-2 mb-6">Por favor, asigna la columna de tu archivo Excel a cada campo requerido.</p>

      <div class="space-y-4 max-w-3xl">
        <div v-for="field in dbFields" :key="field.key" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <label :for="`map-${field.key}`" class="font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <select :id="`map-${field.key}`" v-model="field.mappedColumn" class="w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="">-- No usar --</option>
            <option v-for="header in excelHeaders" :key="header" :value="header">{{ header }}</option>
          </select>
        </div>
      </div>

      <h4 class="text-lg font-bold text-gray-800 mt-8">Vista Previa (primeras 5 filas)</h4>
      <div class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th v-for="header in excelHeaders" :key="header" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ header }}</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-for="(row, index) in previewData" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex" class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-8 flex justify-end">
        <button @click="handleUpload" :disabled="isProcessing" class="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-green-300">
          {{ isProcessing ? 'Procesando...' : 'Procesar y Subir Depósitos' }}
        </button>
      </div>
    </div>
  </div>

  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>
