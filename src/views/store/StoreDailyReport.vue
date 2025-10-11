<script setup>
import { ref, computed, onMounted } from 'vue';
import { db } from '@/firebase';
import {
  addDoc, updateDoc, doc, collection, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';

// 💡 Si ya creaste servicios aparte, puedes reemplazar estas llamadas
// por funciones de dailyReportsService. Este archivo funciona por sí solo.

const auth = useAuthStore();

/* ---------------------------
   Modelo del formulario
--------------------------- */
const todayStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const form = ref({
  // fecha en texto para el <input type="date">
  reportDateStr: todayStr(),

  // referencias
  storeRef: null,       // DocumentReference de la tienda
  storeName: '',
  cashierName: '',

  // flags
  hasValues: true,      // ¿Hay valores que reportar?
  status: 'draft',      // draft | pending_images | submitted | approved | rejected

  // montos
  salesNet: 0,
  cashCaptured: 0,
  posCaptured: 0,
  depositsCaptured: 0,

  // archivos (URLs opcionales si ya subiste a Storage; aquí solo guardamos texto)
  depositImages: [],    // ["https://..."]
  posReportImages: [],  // ["https://..."]

  // comentario final obligatorio al enviar
  comment: '',

  // auditoría
  createdBy: null,
  createdByName: '',
});

const isSaving = ref(false);
const lastSavedId = ref(null);

/* ---------------------------
   Permisos / rol
--------------------------- */
const roleId = computed(() => (auth.user?.roleId?.id || '').toLowerCase());
const isAdmin = computed(() => roleId.value.includes('admin'));
const isSuper = computed(() => roleId.value.includes('super'));
const isManager = computed(() => roleId.value.includes('gerente'));
const isOperator = computed(() => roleId.value.includes('operador'));
const canPickStore = computed(() => isAdmin.value || isSuper.value);

// Si no es admin/super, fijamos la tienda del usuario
onMounted(() => {
  if (!canPickStore.value) {
    if (auth.user?.storeId) {
      form.value.storeRef = auth.user.storeId;          // DocumentReference
      form.value.storeName = auth.user.storeName || ''; // por si lo tienes en el perfil
    }
    form.value.cashierName = auth.user?.displayName || auth.user?.name || '';
  }
  form.value.createdBy = auth.user?.uid || null;
  form.value.createdByName = auth.user?.displayName || auth.user?.name || '';
});

/* ---------------------------
   Helpers
--------------------------- */
function toTimestampFromStr(yyyyMmDd) {
  const date = new Date(`${yyyyMmDd}T00:00:00`);
  return Timestamp.fromDate(date);
}

function diffExplained() {
  // ejemplo simple: diferencia entre ventas netas y (pos + depósitos + efectivo)
  const expected = Number(form.value.salesNet || 0);
  const reported = Number(form.value.posCaptured || 0)
    + Number(form.value.depositsCaptured || 0)
    + Number(form.value.cashCaptured || 0);
  return (expected - reported).toFixed(2);
}

/* ---------------------------
   Acciones
--------------------------- */
// Guardar como **Borrador** (o “Pendiente imágenes” si marcó que sí hay valores)
async function saveDraft() {
  isSaving.value = true;
  try {
    const payload = {
      reportDate: toTimestampFromStr(form.value.reportDateStr),
      storeRef: form.value.storeRef || null,
      storeName: form.value.storeName || '',
      cashierName: form.value.cashierName || '',
      hasValues: !!form.value.hasValues,
      salesNet: Number(form.value.salesNet || 0),
      cashCaptured: Number(form.value.cashCaptured || 0),
      posCaptured: Number(form.value.posCaptured || 0),
      depositsCaptured: Number(form.value.depositsCaptured || 0),
      depositImages: form.value.depositImages || [],
      posReportImages: form.value.posReportImages || [],
      comment: form.value.comment || '',
      status: form.value.hasValues ? 'pending_images' : 'submitted',
      createdBy: form.value.createdBy,
      createdByName: form.value.createdByName,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    const col = collection(db, 'dailyStoreReports');
    const docRef = await addDoc(col, payload);
    lastSavedId.value = docRef.id;
    form.value.status = payload.status;
    alert('Guardado como borrador.');
  } catch (e) {
    console.error(e);
    alert('No se pudo guardar.');
  } finally {
    isSaving.value = false;
  }
}

// Enviar para **revisión** (valida imágenes y comentario si hay valores)
async function submitForReview() {
  if (form.value.hasValues) {
    if (!form.value.depositImages?.length || !form.value.posReportImages?.length) {
      alert('Debes adjuntar la imagen del depósito y el reporte del POS antes de enviar.');
      return;
    }
    if (!form.value.comment || !form.value.comment.trim()) {
      alert('Agrega un comentario antes de enviar.');
      return;
    }
  }

  isSaving.value = true;
  try {
    if (!lastSavedId.value) {
      // nunca se guardó: creamos y dejamos en submitted
      const col = collection(db, 'dailyStoreReports');
      const docRef = await addDoc(col, {
        reportDate: toTimestampFromStr(form.value.reportDateStr),
        storeRef: form.value.storeRef || null,
        storeName: form.value.storeName || '',
        cashierName: form.value.cashierName || '',
        hasValues: !!form.value.hasValues,
        salesNet: Number(form.value.salesNet || 0),
        cashCaptured: Number(form.value.cashCaptured || 0),
        posCaptured: Number(form.value.posCaptured || 0),
        depositsCaptured: Number(form.value.depositsCaptured || 0),
        depositImages: form.value.depositImages || [],
        posReportImages: form.value.posReportImages || [],
        comment: form.value.comment || '',
        status: 'submitted',
        createdBy: form.value.createdBy,
        createdByName: form.value.createdByName,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      lastSavedId.value = docRef.id;
    } else {
      await updateDoc(doc(db, 'dailyStoreReports', lastSavedId.value), {
        reportDate: toTimestampFromStr(form.value.reportDateStr),
        storeRef: form.value.storeRef || null,
        storeName: form.value.storeName || '',
        cashierName: form.value.cashierName || '',
        hasValues: !!form.value.hasValues,
        salesNet: Number(form.value.salesNet || 0),
        cashCaptured: Number(form.value.cashCaptured || 0),
        posCaptured: Number(form.value.posCaptured || 0),
        depositsCaptured: Number(form.value.depositsCaptured || 0),
        depositImages: form.value.depositImages || [],
        posReportImages: form.value.posReportImages || [],
        comment: form.value.comment || '',
        status: 'submitted',
        updatedAt: serverTimestamp(),
      });
    }
    form.value.status = 'submitted';
    alert('Enviado para revisión.');
  } catch (e) {
    console.error(e);
    alert('No se pudo enviar.');
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-5">
    <h1 class="text-2xl font-semibold mb-4">Reporte Diario de Operaciones de Caja</h1>

    <!-- Generales -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded border mb-4">
      <div>
        <label class="block text-sm font-medium mb-1">Fecha *</label>
        <!-- ✅ solo v-model, sin :value ni @input -->
        <input type="date" class="border rounded p-2 w-full" v-model="form.reportDateStr" />
      </div>

      <div v-if="canPickStore">
        <label class="block text-sm font-medium mb-1">Tienda *</label>
        <!-- Aquí coloca tu selector real de tiendas. Por ahora, free text -->
        <input class="border rounded p-2 w-full" v-model="form.storeName" placeholder="Nombre de tienda" />
      </div>
      <div v-else>
        <label class="block text-sm font-medium mb-1">Tienda</label>
        <input class="border rounded p-2 w-full bg-gray-100" :value="form.storeName" readonly />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Cajero / Oficial *</label>
        <input class="border rounded p-2 w-full" v-model="form.cashierName" placeholder="Nombre del cajero" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">¿Hay valores que reportar?</label>
        <div class="flex gap-6 mt-2">
          <label class="flex items-center gap-2">
            <input type="radio" value="true" v-model="form.hasValues" :true-value="true" :false-value="false" />
            Sí
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" value="false" v-model="form.hasValues" :true-value="true" :false-value="false" />
            No
          </label>
        </div>
      </div>
    </div>

    <!-- Valores -->
    <div v-if="form.hasValues" class="bg-white p-4 rounded border mb-4">
      <h2 class="font-semibold mb-3">Valores a reportar</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">Ventas netas (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded p-2 w-full" v-model.number="form.salesNet" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados en efectivo (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded p-2 w-full" v-model.number="form.cashCaptured" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados con tarjeta (POS) (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded p-2 w-full" v-model.number="form.posCaptured" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados con depósitos (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded p-2 w-full" v-model.number="form.depositsCaptured" />
        </div>
      </div>

      <div class="mt-4 text-sm text-gray-600">
        Diferencia (Ventas - Reportado): <b>HNL {{ diffExplained() }}</b>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <label class="block text-sm font-medium mb-1">Foto(s) del depósito</label>
          <!-- En tu implementación real usa file upload a Storage; aquí guardas URLs -->
          <textarea class="border rounded p-2 w-full" rows="2"
            v-model="form.depositImages"
            placeholder='["https://..."]'></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Reporte de POS / Auditoría (foto)</label>
          <textarea class="border rounded p-2 w-full" rows="2"
            v-model="form.posReportImages"
            placeholder='["https://..."]'></textarea>
        </div>
      </div>
    </div>

    <!-- Comentario y acciones -->
    <div class="bg-white p-4 rounded border">
      <div class="mb-3">
        <label class="block text-sm font-medium mb-1">Comentarios</label>
        <textarea class="border rounded p-2 w-full" rows="3" v-model="form.comment"
          placeholder="Ej.: L 1,200 se dejó para reembolso de caja chica, se adjuntará comprobante."></textarea>
      </div>

      <div class="flex flex-wrap gap-3">
        <button class="px-4 py-2 rounded bg-gray-200" :disabled="isSaving" @click="saveDraft">
          Guardar como borrador
        </button>
        <button class="px-4 py-2 rounded bg-blue-600 text-white" :disabled="isSaving" @click="submitForReview">
          Enviar para revisión
        </button>
        <span v-if="form.status" class="text-sm text-gray-600 self-center">
          Estado actual: <b>{{ form.status }}</b>
        </span>
      </div>
    </div>
  </div>
</template>
