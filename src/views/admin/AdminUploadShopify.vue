<script setup>
import { ref, computed } from 'vue';
import { db } from '@/firebase';
import {
  collection, writeBatch, doc, serverTimestamp, query, where, getDocs, Timestamp
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import AlertModal from '@/components/modals/AlertModal.vue';
import { useAuthStore } from '@/stores/authStore';

/* ==================== Auth ==================== */
const authStore = useAuthStore();

/* ==================== UI state ==================== */
const selectedFile = ref(null);
const fileName = ref('Ningún archivo seleccionado');
const excelHeaders = ref([]);
const excelData = ref([]);
const isProcessing = ref(false);
const isAlertOpen = ref(false);
const alertMessage = ref('');

/* ==================== BankKey ==================== */
const normalizeBankKey = (raw = '') => {
  const s = String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (s.includes('CREDOMATIC') || s === 'BAC' || s.includes('DEP B BAC') || s.includes('DEP B. BAC')) return 'BAC';
  if (s.includes('FICO')) return 'FICOHSA';
  if (s.includes('ATLANT')) return 'ATLANTIDA';
  if (s.includes('PAIS')) return 'BANPAIS';
  if (s.includes('OCCIDENT')) return 'OCCIDENTE';
  if (s.includes('BANRURAL')) return 'BANRURAL';
  return s || 'DESCONOCIDO';
};

/* ==================== Mapeo de columnas ==================== */
const dbFields = ref([
  { key: 'paymentGateway', label: 'Banco/Pasarela (ej. BAC Credomatic)', required: true,  mappedColumn: '' }, // A
  { key: 'orderId',        label: 'Número de Orden',                       required: true,  mappedColumn: '' }, // B
  { key: 'saleDate',       label: 'Fecha (dd/mm/aaaa)',                    required: true,  mappedColumn: '' }, // C
  { key: 'posLocationName',label: 'Tienda',                                required: false, mappedColumn: '' }, // D
  { key: 'staffMemberName',label: 'Vendedor',                              required: false, mappedColumn: '' }, // E
  { key: 'grossPayments',  label: 'Monto / Net payment',                   required: true,  mappedColumn: '' }, // H o F
  { key: 'refunded',       label: 'Refunded (opcional)',                   required: false, mappedColumn: '' }, // G
]);

const showMappingUI = computed(() => excelHeaders.value.length > 0);
const previewData  = computed(() => excelData.value.length < 2 ? [] : excelData.value.slice(1, 6));

/* ==================== Fecha ==================== */
/** Devuelve un Date LOCAL a medianoche sin cambiar el día */
const parseDateLocal = (input) => {
  if (!input) return null;

  // número serial de Excel
  if (typeof input === 'number' && input > 1) {
    // 25569 = 1/1/1970; esto nos da fecha UTC; la convertimos a LOCAL sin mover el día
    const utc = new Date(Math.round((input - 25569) * 86400 * 1000));
    return new Date(utc.getFullYear(), utc.getMonth(), utc.getDate());
  }

  // cadena dd/mm/aaaa
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
        return new Date(y, m, d);
      }
    }
    // Intento final con Date; luego fijo a medianoche local
    const tryDate = new Date(trimmed);
    if (!isNaN(tryDate)) return new Date(tryDate.getFullYear(), tryDate.getMonth(), tryDate.getDate());
    return null;
  }

  // Date
  if (input instanceof Date && !isNaN(input)) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }

  return null;
};

/* ==================== Archivo ==================== */
const handleFileChange = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  selectedFile.value = file;
  fileName.value = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      // IMPORTANTE: cellDates:true conserva fechas reales cuando Excel las almacena como fechas
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

      if (jsonData.length > 1) {
        excelHeaders.value = jsonData[0].map(String);
        excelData.value = jsonData;
      } else {
        showAlert('El archivo está vacío o no tiene un formato válido.');
        resetFileState();
      }
    } catch (error) {
      console.error('Error al procesar el archivo:', error);
      showAlert('Hubo un error al leer el archivo. Asegúrate de que sea un formato válido.');
      resetFileState();
    }
  };
  reader.readAsArrayBuffer(file);
};

/* ==================== Subida ==================== */
const handleUpload = async () => {
  isProcessing.value = true;

  // Validación de mapeo
  if (dbFields.value.some(f => f.required && !f.mappedColumn)) {
    showAlert('Por favor, mapea todas las columnas requeridas (*).');
    isProcessing.value = false;
    return;
  }

  const mapping = dbFields.value.reduce((acc, f) => ({ ...acc, [f.key]: f.mappedColumn }), {});
  const rows = excelData.value.slice(1);

  // Parseamos filas
  const parsed = rows.map(row => {
    const v = (key) => row[excelHeaders.value.indexOf(mapping[key])];

    const bankRaw = String(v('paymentGateway') || '').trim();
    const bankKey = normalizeBankKey(bankRaw);

    const orderId = String(v('orderId') || '').trim();
    const saleDate = parseDateLocal(v('saleDate'));
    const storeName = String(v('posLocationName') || '').trim();
    const vendorName = String(v('staffMemberName') || '').trim();

    // monto: usamos 'net payment' si está mapeado, si no F (montodeposito)
    let amtRaw = v('grossPayments');
    const amount = Number(String(amtRaw || '0').replace(/[^0-9.-]+/g, ''));
    const refunded = Number(String(v('refunded') || '0').replace(/[^0-9.-]+/g, ''));

    if (!orderId || !saleDate || !(amount > 0)) return null;

    return {
      orderId,
      saleDate,            // Date local
      amount,
      refunded,
      bankRaw,
      bankKey,
      storeName,
      vendorName
    };
  }).filter(Boolean);

  if (parsed.length === 0) {
    showAlert('No se encontraron filas con datos válidos (fecha, orden y monto) para procesar.');
    isProcessing.value = false;
    return;
  }

  // Evitar duplicados dentro del rango de fechas de archivo por orderId
  const dates = parsed.map(r => r.saleDate);
  const minDate = new Date(Math.min.apply(null, dates));
  const maxDate = new Date(Math.max.apply(null, dates));

  try {
    // Traemos ventas existentes en ventana por orderId
    const q = query(
      collection(db, 'shopifySales'),
      where('saleDate', '>=', Timestamp.fromDate(minDate)),
      where('saleDate', '<=', Timestamp.fromDate(maxDate))
    );
    const snap = await getDocs(q);
    const existingOrders = new Set(snap.docs.map(d => String(d.data().orderId || '').trim()));

    // Escribimos en batch
    const batch = writeBatch(db);
    let newCount = 0;
    let skipped = 0;

    for (const r of parsed) {
      if (existingOrders.has(r.orderId)) { skipped++; continue; }

      const ref = doc(collection(db, 'shopifySales'));
      batch.set(ref, {
        orderId: r.orderId,
        saleDate: Timestamp.fromDate(r.saleDate), // guardamos a medianoche local
        grossPayments: r.amount,                  // usamos net payment como base de conciliación
        refundedAmount: r.refunded || 0,
        paymentGateway: r.bankRaw,
        bankKey: r.bankKey,

        posLocationName: r.storeName || null,
        staffMemberName: r.vendorName || null,

        reconciliationStatus: 'pendiente',       // en español
        matchedTotal: 0,
        remainingAmount: r.amount,
        matchedDepositRef: [],
        uploadDate: serverTimestamp(),
        createdBy_uid: authStore.user?.uid || null
      });

      existingOrders.add(r.orderId);
      newCount++;
    }

    if (newCount > 0) await batch.commit();

    let msg = `Ventas subidas correctamente.\n- Nuevas: ${newCount}`;
    if (skipped > 0) msg += `\n- Omitidas (orden repetida en rango): ${skipped}`;
    showAlert(msg);
    resetFileState();
  } catch (err) {
    console.error(err);
    showAlert(`Error al subir ventas: ${err.message}`);
  } finally {
    isProcessing.value = false;
  }
};

/* ==================== Helpers UI ==================== */
const resetFileState = () => {
  selectedFile.value = null;
  fileName.value = 'Ningún archivo seleccionado';
  excelHeaders.value = [];
  excelData.value = [];
  dbFields.value.forEach(f => (f.mappedColumn = ''));
  const fileInput = document.getElementById('shopify-file-input');
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
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Subir Ventas Shopify</h2>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <input
          id="shopify-file-input"
          class="hidden"
          type="file"
          accept=".xlsx,.xls,.csv"
          @change="handleFileChange"
        />
        <label for="shopify-file-input"
               class="cursor-pointer px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">
          Seleccionar Archivo
        </label>
        <p class="mt-4 text-sm text-gray-500">{{ fileName }}</p>
      </div>

      <div v-if="excelHeaders.length > 0" class="mt-8">
        <h3 class="text-lg font-bold text-gray-800">Paso 1: Mapea las columnas</h3>
        <p class="text-gray-600 mt-2 mb-6">Asigna cada campo a la columna correspondiente de tu archivo.</p>

        <div class="space-y-4 max-w-3xl">
          <div v-for="field in dbFields" :key="field.key"
               class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <label :for="`map-${field.key}`" class="font-medium text-gray-700">
              {{ field.label }} <span v-if="field.required" class="text-red-500">*</span>
            </label>
            <select :id="`map-${field.key}`"
                    v-model="field.mappedColumn"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">-- Selecciona columna --</option>
              <option v-for="h in excelHeaders" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
        </div>

        <h4 class="text-lg font-bold text-gray-800 mt-8">Vista previa (primeras 5 filas)</h4>
        <div class="mt-4 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
            <tr>
              <th v-for="h in excelHeaders" :key="h"
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {{ h }}
              </th>
            </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
            <tr v-for="(row, i) in previewData" :key="i">
              <td v-for="(cell, j) in row" :key="j" class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                {{ cell }}
              </td>
            </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-8 flex justify-end">
          <button
            @click="handleUpload"
            :disabled="isProcessing"
            class="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-green-300">
            {{ isProcessing ? 'Procesando...' : 'Procesar y Subir Ventas' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>