<script setup>
import { ref, computed, onMounted } from 'vue';
import { db, storage } from '@/firebase';
import {
  addDoc, updateDoc, doc, collection, serverTimestamp, Timestamp, getDoc
} from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuthStore } from '@/stores/authStore';

const auth = useAuthStore();

/* ---------- utils ---------- */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const toTs = (s) => Timestamp.fromDate(new Date(`${s}T00:00:00`));

/* ---------- form ---------- */
const form = ref({
  reportDateStr: todayStr(),
  storeRef: null,        // DocReference (stores)
  storeName: '',
  cashierName: '',
  hasValues: null,       // radios sin selección inicial
  status: 'draft',
  salesNet: 0,
  cashCaptured: 0,
  posCaptured: 0,
  depositsCaptured: 0,
  // URLs definitivos (después de subir)
  depositImages: [],
  posReportImages: [],
  comment: '',
  createdBy: null,
  createdByName: '',
});

const isSaving = ref(false);
const lastSavedId = ref(null);

/* ---------- buffers de archivos (aún sin subir) ---------- */
const pending = ref({
  depositFiles: /** @type {File[]} */ ([]),
  posFiles: /** @type {File[]} */ ([]),
});
const previews = ref({
  deposit: /** @type {string[]} */ ([]),
  pos: /** @type {string[]} */ ([]),
});
const upProg = ref({ deposit: 0, pos: 0 });

/* ---------- permisos ---------- */
const roleId = computed(() => (auth.user?.roleId?.id || '').toLowerCase());
const isManager = computed(() => roleId.value.includes('gerente'));
const isAdminOrSuper = computed(() => roleId.value.includes('admin') || roleId.value.includes('super'));
const canPickStore = computed(() => isAdminOrSuper.value); // gerente usa su tienda fija

/* ---------- cargar usuario/tienda ---------- */
async function loadUserAndStore() {
  const uid = auth.user?.uid;
  if (!uid) return;

  const userSnap = await getDoc(doc(db, 'users', uid));
  if (userSnap.exists()) {
    const u = userSnap.data();
    form.value.cashierName = u.display_name || auth.user?.displayName || auth.user?.name || '';
    form.value.createdBy = uid;
    form.value.createdByName = form.value.cashierName;

    if (u.storeId) {
      form.value.storeRef = u.storeId; // DocReference
      try {
        const storeSnap = await getDoc(u.storeId);
        if (storeSnap.exists()) {
          const s = storeSnap.data();
          form.value.storeName = s.name || s.storeName || s.title || '';
        }
      } catch (e) {
        console.warn('No se pudo leer la tienda:', e);
      }
    }
  } else {
    // fallback si no existe /users/{uid}
    form.value.cashierName = auth.user?.displayName || auth.user?.name || '';
    form.value.createdBy = uid;
    form.value.createdByName = form.value.cashierName;
  }
}
onMounted(loadUserAndStore);

/* ---------- UI derivadas ---------- */
const showValues = computed(() => form.value.hasValues === true);
const showOnlySend = computed(() => form.value.hasValues === false);
const diff = computed(() => {
  const v = Number(form.value.salesNet||0);
  const r = Number(form.value.cashCaptured||0) + Number(form.value.posCaptured||0) + Number(form.value.depositsCaptured||0);
  return (v - r).toFixed(2);
});

/* ---------- manejo de archivos ---------- */
function onPick(kind, e) {
  const files = Array.from(e.target.files || []);
  pending.value[kind === 'deposit' ? 'depositFiles' : 'posFiles'] = files;

  // Previews locales
  previews.value[kind] = files.map((f) => URL.createObjectURL(f));
}

async function uploadFiles(kind, files) {
  const urls = [];
  let done = 0;
  for (const f of files) {
    const ext = (f.name || 'jpg').split('.').pop();
    const path = `dailyReports/${form.value.reportDateStr}/${auth.user?.uid || 'anon'}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const r = sRef(storage, path);
    const snap = await uploadBytes(r, f);
    const url = await getDownloadURL(snap.ref);
    urls.push(url);
    done++;
    upProg.value[kind] = Math.round((done / files.length) * 100);
  }
  setTimeout(() => (upProg.value[kind] = 0), 500);
  return urls;
}

/* ---------- helpers de persistencia ---------- */
async function ensureUploadsIfNeeded() {
  // Sube lo que esté pendiente.
  if (pending.value.depositFiles.length) {
    const urls = await uploadFiles('deposit', pending.value.depositFiles);
    form.value.depositImages = urls;
    pending.value.depositFiles = [];
  }
  if (pending.value.posFiles.length) {
    const urls = await uploadFiles('pos', pending.value.posFiles);
    form.value.posReportImages = urls;
    pending.value.posFiles = [];
  }
}

/* ---------- acciones ---------- */
async function saveDraft() {
  isSaving.value = true;
  try {
    // sube archivos si el usuario ya eligió
    await ensureUploadsIfNeeded();

    const payload = {
      reportDate: toTs(form.value.reportDateStr),
      storeRef: form.value.storeRef || null,
      storeName: form.value.storeName || '',
      cashierName: form.value.cashierName || '',
      hasValues: form.value.hasValues === true,
      salesNet: Number(form.value.salesNet || 0),
      cashCaptured: Number(form.value.cashCaptured || 0),
      posCaptured: Number(form.value.posCaptured || 0),
      depositsCaptured: Number(form.value.depositsCaptured || 0),
      depositImages: form.value.depositImages,
      posReportImages: form.value.posReportImages,
      comment: form.value.comment || '',
      status: form.value.hasValues === true ? 'pending_images' : 'submitted',
      createdBy: form.value.createdBy,
      createdByName: form.value.createdByName,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    const col = collection(db, 'dailyStoreReports');
    const { id } = await addDoc(col, payload);
    lastSavedId.value = id;
    form.value.status = payload.status;
    alert('Guardado como borrador.');
  } catch (e) {
    console.error('saveDraft error:', e);
    alert(`No se pudo guardar: ${e.message || e}`);
  } finally {
    isSaving.value = false;
  }
}

async function submitForReview() {
  try {
    // Si hay valores, asegúrate de tener evidencias (y súbelas si solo están pendientes)
    if (showValues.value) {
      await ensureUploadsIfNeeded();

      if (!form.value.depositImages.length || !form.value.posReportImages.length) {
        alert('Debes adjuntar la imagen del depósito y el reporte del POS antes de enviar.');
        return;
      }
      if (!form.value.comment?.trim()) {
        alert('Agrega un comentario antes de enviar.');
        return;
      }
    }

    isSaving.value = true;

    const base = {
      reportDate: toTs(form.value.reportDateStr),
      storeRef: form.value.storeRef || null,
      storeName: form.value.storeName || '',
      cashierName: form.value.cashierName || '',
      hasValues: form.value.hasValues === true,
      salesNet: Number(form.value.salesNet || 0),
      cashCaptured: Number(form.value.cashCaptured || 0),
      posCaptured: Number(form.value.posCaptured || 0),
      depositsCaptured: Number(form.value.depositsCaptured || 0),
      depositImages: form.value.depositImages,
      posReportImages: form.value.posReportImages,
      comment: form.value.comment || '',
      status: 'submitted',
      updatedAt: serverTimestamp(),
    };

    if (!lastSavedId.value) {
      const col = collection(db, 'dailyStoreReports');
      const { id } = await addDoc(col, { ...base, createdBy: form.value.createdBy, createdByName: form.value.createdByName, createdAt: serverTimestamp() });
      lastSavedId.value = id;
    } else {
      await updateDoc(doc(db, 'dailyStoreReports', lastSavedId.value), base);
    }
    form.value.status = 'submitted';
    alert('Enviado para revisión.');
  } catch (e) {
    console.error('submitForReview error:', e);
    alert(`No se pudo enviar: ${e.message || e}`);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-5 space-y-4">
    <h1 class="text-2xl font-semibold">Reporte Diario de Operaciones de Caja</h1>

    <!-- Generales -->
    <section class="bg-white rounded-xl border p-4 space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">Fecha *</label>
          <input type="date" class="border rounded-lg p-2 w-full" v-model="form.reportDateStr" />
        </div>

        <div v-if="canPickStore">
          <label class="block text-sm font-medium mb-1">Tienda *</label>
          <input class="border rounded-lg p-2 w-full" v-model="form.storeName" placeholder="Nombre de tienda" />
        </div>
        <div v-else>
          <label class="block text-sm font-medium mb-1">Tienda</label>
          <input class="border rounded-lg p-2 w-full bg-gray-100" :value="form.storeName" readonly />
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Cajero / Oficial *</label>
          <input class="border rounded-lg p-2 w-full" v-model="form.cashierName" placeholder="Nombre del cajero" />
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">¿Hay valores que reportar?</label>
          <div class="flex gap-6 mt-2">
            <label class="flex items-center gap-2">
              <input type="radio" :value="true" v-model="form.hasValues" />
              Sí
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" :value="false" v-model="form.hasValues" />
              No
            </label>
          </div>
          <p v-if="form.hasValues===null" class="text-xs text-gray-500 mt-1">Seleccione una opción para continuar.</p>
        </div>
      </div>
    </section>

    <!-- Valores (solo si Sí) -->
    <section v-if="showValues" class="bg-white rounded-xl border p-4 space-y-4">
      <h2 class="font-semibold">Valores a reportar</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">Ventas netas (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded-lg p-2 w-full" v-model.number="form.salesNet" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados en efectivo (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded-lg p-2 w-full" v-model.number="form.cashCaptured" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados con tarjeta (POS) (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded-lg p-2 w-full" v-model.number="form.posCaptured" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Pagos captados con depósitos (HNL) *</label>
          <input type="number" min="0" step="0.01" class="border rounded-lg p-2 w-full" v-model.number="form.depositsCaptured" />
        </div>
      </div>

      <p class="text-sm text-gray-600">Diferencia (Ventas - Reportado): <b>HNL {{ diff }}</b></p>

      <!-- Evidencias -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-medium mb-1">Foto(s) del depósito</label>
          <input type="file" accept="image/*" capture="environment" multiple @change="(e)=>onPick('deposit', e)" class="block w-full text-sm" />
          <div v-if="upProg.deposit" class="text-xs text-gray-500 mt-1">Subiendo… {{ upProg.deposit }}%</div>
          <div class="flex flex-wrap gap-2 mt-2">
            <img v-for="(u,i) in previews.deposit" :key="'dpv-'+i" :src="u" class="h-16 w-16 object-cover rounded border" />
            <img v-for="(u,i) in form.depositImages" :key="'dpu-'+i" :src="u" class="h-16 w-16 object-cover rounded border" />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Reporte de POS / Auditoría (foto)</label>
          <input type="file" accept="image/*" capture="environment" multiple @change="(e)=>onPick('pos', e)" class="block w-full text-sm" />
          <div v-if="upProg.pos" class="text-xs text-gray-500 mt-1">Subiendo… {{ upProg.pos }}%</div>
          <div class="flex flex-wrap gap-2 mt-2">
            <img v-for="(u,i) in previews.pos" :key="'ppv-'+i" :src="u" class="h-16 w-16 object-cover rounded border" />
            <img v-for="(u,i) in form.posReportImages" :key="'ppu-'+i" :src="u" class="h-16 w-16 object-cover rounded border" />
          </div>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Comentarios</label>
        <textarea class="border rounded-lg p-2 w-full" rows="3" v-model="form.comment"
          placeholder="Ej.: L 1,200 se dejó para reembolso de caja chica; se adjunta comprobante."></textarea>
      </div>
    </section>

    <!-- Acciones -->
    <section v-if="form.hasValues!==null" class="bg-white rounded-xl border p-4">
      <div v-if="showValues" class="flex flex-wrap gap-3 items-center">
        <button class="px-4 py-2 rounded-lg bg-gray-200" :disabled="isSaving" @click="saveDraft">Guardar como borrador</button>
        <button class="px-4 py-2 rounded-lg bg-blue-600 text-white" :disabled="isSaving" @click="submitForReview">Enviar para revisión</button>
        <span v-if="form.status" class="text-sm text-gray-600">Estado actual: <b>{{ form.status }}</b></span>
      </div>

      <div v-else-if="showOnlySend" class="flex flex-wrap gap-3 items-center">
        <button class="px-4 py-2 rounded-lg bg-blue-600 text-white" :disabled="isSaving" @click="submitForReview">Enviar para revisión</button>
        <span v-if="form.status" class="text-sm text-gray-600">Estado actual: <b>{{ form.status }}</b></span>
      </div>
    </section>
  </div>
</template>
