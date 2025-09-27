<script setup>
import { ref, computed } from 'vue';
import { db } from '@/firebase';
import {
  collection, writeBatch, doc, serverTimestamp, query, where, getDocs, Timestamp, orderBy, arrayUnion, updateDoc
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import AlertModal from '@/components/modals/AlertModal.vue';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();

const fileName = ref('Ningún archivo seleccionado');
const excelHeaders = ref([]);
const excelData = ref([]);
const isProcessing = ref(false);
const isAlertOpen = ref(false);
const alertMessage = ref('');

const dbFields = ref([
  { key: 'orderId',           label: 'Order name (# de Orden)',          required: true,  mappedColumn: '' },
  { key: 'saleDate',          label: 'Day (Fecha)',                      required: true,  mappedColumn: '' },
  { key: 'paymentGateway',    label: 'Payment gateway (Banco)',          required: true,  mappedColumn: '' },
  { key: 'grossPayments',     label: 'Gross payments (Monto)',           required: true,  mappedColumn: '' },
  { key: 'staffMemberName',   label: 'Staff member name (Vendedor)',     required: true,  mappedColumn: '' },
  { key: 'posLocationName',   label: 'Pos location name (Sucursal)',     required: true,  mappedColumn: '' },
]);

const showMappingUI = computed(() => excelHeaders.value.length > 0);

const showAlert = (msg) => { alertMessage.value = msg; isAlertOpen.value = true; };

const resetFileState = () => {
  fileName.value = 'Ningún archivo seleccionado';
  excelHeaders.value = [];
  excelData.value = [];
  dbFields.value.forEach(f => f.mappedColumn = '');
  const fileInput = document.getElementById('shopify-file-input');
  if(fileInput) fileInput.value = '';
};

// -------------------------
// Helpers
// -------------------------
const parseDate = (dateInput) => {
  if (!dateInput) return null;
  if (typeof dateInput === 'number' && dateInput > 1) {
    const date = new Date(Math.round((dateInput - 25569) * 86400 * 1000));
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  if (dateInput instanceof Date) return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  const finalAttempt = new Date(dateInput);
  return !isNaN(finalAttempt.getTime())
    ? new Date(finalAttempt.getFullYear(), finalAttempt.getMonth(), finalAttempt.getDate())
    : null;
};

const normalize = (s) => (s || '')
  .toString()
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const bankMap = [
  { contains: ['bac', 'credomatic'], std: 'BAC Credomatic' },
  { contains: ['ficohsa'],           std: 'FICOHSA' },
  { contains: ['atlantida', 'atl'],  std: 'ATLANTIDA' },
  { contains: ['occidente'],         std: 'OCCIDENTE' },
  { contains: ['banpais', 'banpa'],  std: 'BANPAIS' },
  { contains: ['banrural'],          std: 'BANRURAL' },
];

const normalizeBank = (raw) => {
  const n = normalize(raw);
  for (const rule of bankMap) {
    if (rule.contains.some(k => n.includes(k))) return rule.std;
  }
  return raw || '';
};

const amountEquals = (a, b, tol = 1.0) => Math.abs((Number(a)||0) - (Number(b)||0)) <= tol;

const toStartOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const toEndOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

const plusDays = (d, days) => { const x = new Date(d); x.setDate(x.getDate()+days); return x; };

// Buscar usuario por display_name (igual ignorando acentos y mayúsculas)
const findUserByDisplayName = async (name) => {
  if (!name) return null;
  const n = normalize(name);
  // Traemos usuarios con una paginita (si tienes muchos usuarios, podríamos mejorar esto con un campo auxiliar)
  const qUsers = query(collection(db, 'users'), orderBy('display_name'));
  const snap = await getDocs(qUsers);
  for (const docu of snap.docs) {
    const d = docu.data();
    if (normalize(d.display_name) === n) {
      return { id: docu.id, ref: doc(db, 'users', docu.id), ...d };
    }
  }
  return null;
};

// -------------------------
// File handling
// -------------------------
const handleFileChange = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  fileName.value = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
      if (jsonData.length > 1) {
        excelHeaders.value = jsonData[0].map(String);
        excelData.value = jsonData;
      } else {
        showAlert('El archivo Excel está vacío o no tiene un formato válido.');
        resetFileState();
      }
    } catch (error) {
      console.error("Error al procesar el archivo Excel:", error);
      showAlert('Hubo un error al leer el archivo. Asegúrate de que sea un formato válido.');
      resetFileState();
    }
  };
  reader.readAsArrayBuffer(file);
};

// -------------------------
// Conciliación automática
// -------------------------
const autoReconcileNewSales = async (createdSales) => {
  // createdSales: array de { ref, data }
  const amountTolerance = 1.0; // Lempiras
  const dateWindowDays  = 1;   // ±1 día

  for (const s of createdSales) {
    try {
      // 1) Datos base y normalizaciones
      const saleBankStd = normalizeBank(s.data.paymentGateway);
      const saleDate = s.data.saleDate.toDate ? s.data.saleDate.toDate() : s.data.saleDate;
      const winStart = toStartOfDay(plusDays(saleDate, -dateWindowDays));
      const winEnd   = toEndOfDay(plusDays(saleDate, dateWindowDays));

      // 2) Trata de mapear vendedor → user/store
      let vendorUser = null;
      if (s.data.staffMemberName) {
        vendorUser = await findUserByDisplayName(s.data.staffMemberName);
        if (vendorUser) {
          await updateDoc(s.ref, {
            vendorRef: vendorUser.ref,
            storeId: vendorUser.storeId || null,
            storeName: vendorUser.storeName || null
          });
        }
      }

      // 3) Carga candidatos de depósitos
      const qDeps = query(
        collection(db, 'deposits'),
        where('status', 'in', ['disponible', 'reservado']),
        where('bank', '==', saleBankStd),
        where('transactionDate', '>=', Timestamp.fromDate(winStart)),
        where('transactionDate', '<=', Timestamp.fromDate(winEnd))
      );
      const snap = await getDocs(qDeps);
      const candidates = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
        .filter(d => amountEquals(d.amount, s.data.grossPayments, amountTolerance));

      if (candidates.length === 0) {
        // Nada encontrado → marcar pendiente revisión
        await updateDoc(s.ref, {
          reconciliationStatus: 'pendiente-revision',
          status: 'pendiente',
        });
        continue;
      }

      // 4) Estrategia de selección
      let pick = null;

      // a) Prioriza reservados al mismo vendedor/tienda (si tenemos vendorUser)
      if (vendorUser) {
        const samePerson = candidates.filter(d =>
          d.status === 'reservado' &&
          d.vendorId?.id === vendorUser.id
        );
        if (samePerson.length === 1) pick = samePerson[0];
        if (!pick && samePerson.length > 1) {
          // el más cercano por fecha
          samePerson.sort((a,b) => Math.abs(a.transactionDate.toDate() - saleDate) - Math.abs(b.transactionDate.toDate() - saleDate));
          pick = samePerson[0];
        }
      }

      // b) Si no hay pick aún: cualquier reservado
      if (!pick) {
        const reserved = candidates.filter(d => d.status === 'reservado');
        if (reserved.length === 1) pick = reserved[0];
        else if (reserved.length > 1) {
          reserved.sort((a,b) => Math.abs(a.transactionDate.toDate() - saleDate) - Math.abs(b.transactionDate.toDate() - saleDate));
          pick = reserved[0];
        }
      }

      // c) Si todavía no: disponibles
      if (!pick) {
        const available = candidates.filter(d => d.status === 'disponible');
        if (available.length === 1) pick = available[0];
        else if (available.length > 1) {
          available.sort((a,b) => Math.abs(a.transactionDate.toDate() - saleDate) - Math.abs(b.transactionDate.toDate() - saleDate));
          pick = available[0];
        }
      }

      // 5) Aplica actualización
      if (!pick) {
        await updateDoc(s.ref, {
          reconciliationStatus: 'pendiente-revision',
          status: 'pendiente',
        });
        continue;
      }

      const diferencia = Number((s.data.grossPayments || 0) - (pick.amount || 0));

      // batch pequeño por venta para mantenerlo simple y seguro
      const batch = writeBatch(db);

      // deposit update → LIQUIDADO
      const historyEntry = {
        action: 'Liquidado',
        timestamp: serverTimestamp(),
        details: `Conciliado automáticamente con orden ${s.data.orderId}`,
        user: authStore?.user?.uid ? doc(db, 'users', authStore.user.uid) : null,
        userName: authStore?.user?.display_name || 'Sistema'
      };

      batch.update(pick.ref, {
        status: 'liquidado',
        liquidationDate: serverTimestamp(),
        vendorId: pick.vendorId || (vendorUser ? vendorUser.ref : null),
        vendorName: pick.vendorName || (vendorUser ? vendorUser.display_name : s.data.staffMemberName || null),
        storeId: pick.storeId || (vendorUser?.storeId || null),
        storeName: pick.storeName || (vendorUser?.storeName || s.data.posLocationName || null),
        shopifyOrderId: s.data.orderId,
        orderId: s.data.orderId,
        orderTotal: s.data.grossPayments || 0,
        diferencia,
        saleRef: arrayUnion(s.ref),
        history: arrayUnion(historyEntry)
      });

      // sale update
      batch.update(s.ref, {
        status: 'conciliada',
        reconciliationStatus: 'conciliada',
        reconciliationDate: serverTimestamp(),
        matchedDepositRef: arrayUnion(pick.ref)
      });

      await batch.commit();

    } catch (err) {
      console.error('Error conciliando venta:', err);
      try {
        await updateDoc(s.ref, { reconciliationStatus: 'pendiente-revision' });
      } catch {}
    }
  }
};

// -------------------------
// Upload + conciliación
// -------------------------
const handleUpload = async () => {
  isProcessing.value = true;
  try {
    if (dbFields.value.some(f => f.required && !f.mappedColumn)) {
      showAlert('Por favor, mapea todas las columnas requeridas (*).');
      isProcessing.value = false;
      return;
    }

    const mapping = dbFields.value.reduce((acc, field) => ({...acc, [field.key]: field.mappedColumn}), {});
    const dataRows = excelData.value.slice(1);

    // Prevenir duplicados por orderId
    const orderIds = dataRows
      .map(row => String(row[excelHeaders.value.indexOf(mapping.orderId)] || '').trim())
      .filter(Boolean);

    const existingSales = new Set();
    if (orderIds.length > 0) {
      for (let i = 0; i < orderIds.length; i += 30) {
        const chunk = orderIds.slice(i, i + 30);
        const qx = query(collection(db, "shopifySales"), where("orderId", "in", chunk));
        const snapshot = await getDocs(qx);
        snapshot.forEach(doc => existingSales.add(doc.data().orderId));
      }
    }

    const batch = writeBatch(db);
    const createdSales = []; // { ref, data }
    let newCount = 0;
    let skippedCount = 0;

    for (const row of dataRows) {
      const orderId = String(row[excelHeaders.value.indexOf(mapping.orderId)] || '').trim();
      if (!orderId) continue;

      if (existingSales.has(orderId)) {
        skippedCount++;
        continue;
      }

      const amount = parseFloat(String(row[excelHeaders.value.indexOf(mapping.grossPayments)] || '0').replace(/[^0-9.-]+/g, ''));
      const date = parseDate(row[excelHeaders.value.indexOf(mapping.saleDate)]);
      if (isNaN(amount) || amount <= 0 || !date) continue;

      const paymentGateway = String(row[excelHeaders.value.indexOf(mapping.paymentGateway)] || '').trim();
      const staffMemberName = String(row[excelHeaders.value.indexOf(mapping.staffMemberName)] || '').trim();
      const posLocationName = String(row[excelHeaders.value.indexOf(mapping.posLocationName)] || '').trim();

      const newSaleRef = doc(collection(db, "shopifySales"));
      const newSaleData = {
        orderId,
        saleDate: Timestamp.fromDate(date),
        paymentGateway,
        grossPayments: amount,
        staffMemberName,
        posLocationName,
        status: 'pendiente',
        uploadDate: serverTimestamp(),
        uploadedBy_uid: authStore?.user?.uid ? doc(db, 'users', authStore.user.uid) : null,
        reconciliationStatus: 'pendiente'
      };

      batch.set(newSaleRef, newSaleData);
      createdSales.push({ ref: newSaleRef, data: newSaleData });
      newCount++;
    }

    if (newCount > 0) await batch.commit();

    // Conciliación automática SOLO para lo nuevo
    if (createdSales.length > 0) {
      await autoReconcileNewSales(createdSales);
    }

    let message = `Proceso completado.\n- Se subieron ${newCount} ventas nuevas.`;
    if (skippedCount > 0) message += `\n- Se omitieron ${skippedCount} ventas duplicadas.`;
    message += `\n\nSe intentó conciliar automáticamente las ventas nuevas. Revisa estados en "Ver Depósitos" o crea una pantalla para revisar "pendiente-revision".`;
    showAlert(message);
    resetFileState();
  } catch (error) {
    console.error("Error al subir ventas:", error);
    showAlert('Ocurrió un error al guardar/conciliar las ventas.');
  } finally {
    isProcessing.value = false;
  }
};
</script>

<template>
  <div class="space-y-8">
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Subir Reporte de Ventas (Shopify)</h2>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <input type="file" id="shopify-file-input" class="hidden" accept=".xlsx, .xls, .csv" @change="handleFileChange">
        <label for="shopify-file-input" class="cursor-pointer px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Seleccionar Archivo</label>
        <p class="mt-4 text-sm text-gray-500">{{ fileName }}</p>
      </div>
    </div>

    <div v-if="showMappingUI" class="bg-white p-6 rounded-lg shadow">
      <h3 class="text-lg font-bold text-gray-800">Mapeo de Columnas del Reporte</h3>
      <p class="text-gray-600 mt-2 mb-6">Asigna la columna de tu archivo Excel a cada campo requerido.</p>
      <div class="space-y-4 max-w-3xl">
        <div v-for="field in dbFields" :key="field.key" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <label class="font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <select v-model="field.mappedColumn" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm">
            <option value="">-- No usar --</option>
            <option v-for="header in excelHeaders" :key="header" :value="header">{{ header }}</option>
          </select>
        </div>
      </div>
      <div class="mt-8 flex justify-end">
        <button @click="handleUpload" :disabled="isProcessing" class="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-green-300">
          {{ isProcessing ? 'Procesando...' : 'Procesar, Subir y Conciliar' }}
        </button>
      </div>
    </div>
  </div>

  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>