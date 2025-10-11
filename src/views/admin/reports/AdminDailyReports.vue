<script setup>
import { ref, onMounted } from 'vue'
import { db } from '@/firebase'
import {
  collection, query, where, orderBy, getDocs, Timestamp
} from 'firebase/firestore'

// ====== Filtros ======
const groupBy = ref('vendor') // 'vendor' | 'store'
const depStatus = ref('parcial') // parcial por defecto
const bank = ref('Todos')

const today = new Date()
const first = new Date(today.getFullYear(), today.getMonth(), 1)
const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)
const dateFrom = ref(first.toISOString().substring(0,10))
const dateTo   = ref(last.toISOString().substring(0,10))

const loading = ref(false)
const rows = ref([])

const fmt = (n)=> `L ${Number(n||0).toFixed(2)}`
const toDate = (d)=> d?.toDate ? d.toDate() : new Date(d)

// ====== Carga ======
async function load(){
  loading.value = true
  rows.value = []

  const from = new Date(dateFrom.value + 'T00:00:00')
  const to   = new Date(dateTo.value   + 'T23:59:59')

  // Deposits
  const depWhere = [
    where('transactionDate','>=', Timestamp.fromDate(from)),
    where('transactionDate','<=', Timestamp.fromDate(to)),
    orderBy('transactionDate','desc')
  ]
  const depQ = query(collection(db,'deposits'), ...depWhere)
  const depSnap = await getDocs(depQ)
  const deposits = depSnap.docs
    .map(d=>({ id:d.id, ...d.data() }))
    .filter(d=>{
      const st = String(d.status||'').toLowerCase()
      if (depStatus.value!=='Todos' && st!==depStatus.value) return false
      if (bank.value!=='Todos' && (d.bankKey||'')!==bank.value) return false
      return true
    })

  // Sales (para cruce simple)
  const saleWhere = [
    where('saleDate','>=', Timestamp.fromDate(from)),
    where('saleDate','<=', Timestamp.fromDate(to)),
    orderBy('saleDate','desc')
  ]
  const saleQ = query(collection(db,'shopifySales'), ...saleWhere)
  const saleSnap = await getDocs(saleQ)
  const sales = saleSnap.docs.map(d=>({ id:d.id, ...d.data() }))

  // Agrupar
  const map = new Map()

  function keyOf(d){
    return groupBy.value==='vendor'
      ? (d.vendorName||'---')
      : (d.storeName || d.posLocationName || '---')
  }

  // base por grupo
  for (const s of sales){
    const k = groupBy.value==='vendor'
      ? (s.staffMemberName||'---')
      : (s.storeName||s.posLocationName||'---')
    if (!map.has(k)) map.set(k,{
      group: k,
      depCount: 0, depTotal: 0, concTotal: 0, remTotal: 0,
      saleTotal: 0, saleConc: 0
    })
    const r = map.get(k)
    r.saleTotal += Number(s.grossPayments||0)
    if (String(s.reconciliationStatus||'').toLowerCase()==='matched') {
      r.saleConc += Number(s.grossPayments||0)
    }
  }

  for (const d of deposits){
    const k = keyOf(d)
    if (!map.has(k)) map.set(k,{
      group: k,
      depCount: 0, depTotal: 0, concTotal: 0, remTotal: 0,
      saleTotal: 0, saleConc: 0
    })
    const r = map.get(k)
    r.depCount += 1
    const amt = Number(d.amount||0)
    const matched = Number(d.matchedTotal||0)
    const rem = Math.max(0, amt - matched)

    r.depTotal += amt
    r.concTotal += matched
    r.remTotal  += rem
  }

  rows.value = Array.from(map.values())
  loading.value = false
}

function setThisMonth(){
  const t = new Date()
  dateFrom.value = new Date(t.getFullYear(), t.getMonth(), 1).toISOString().substring(0,10)
  dateTo.value   = new Date(t.getFullYear(), t.getMonth()+1, 0).toISOString().substring(0,10)
  load()
}

onMounted(load)
</script>

<template>
  <div class="p-6 space-y-4">
    <h1 class="text-2xl font-bold">Reportes</h1>

    <div class="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
      <div>
        <label class="block text-sm text-gray-700 mb-1">Agrupar por</label>
        <select v-model="groupBy" class="w-full border rounded p-2">
          <option value="vendor">Vendedor</option>
          <option value="store">Tienda</option>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-700 mb-1">Estado depósito</label>
        <select v-model="depStatus" class="w-full border rounded p-2">
          <option>Todos</option>
          <option value="disponible">disponible</option>
          <option value="reservado">reservado</option>
          <option value="parcial">parcial</option>
          <option value="liquidado">liquidado</option>
          <option value="auto_liquidado">auto_liquidado</option>
          <option value="devuelto">devuelto</option>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-700 mb-1">Banco</label>
        <select v-model="bank" class="w-full border rounded p-2">
          <option>Todos</option>
          <option>BAC</option><option>ATLANTIDA</option><option>FICOHSA</option>
          <option>BANRURAL</option><option>OCCIDENTE</option><option>BANPAIS</option>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-700 mb-1">Desde</label>
        <input type="date" v-model="dateFrom" class="w-full border rounded p-2" />
      </div>
      <div>
        <label class="block text-sm text-gray-700 mb-1">Hasta</label>
        <input type="date" v-model="dateTo" class="w-full border rounded p-2" />
      </div>

      <div class="flex gap-2">
        <button class="px-4 py-2 rounded bg-blue-600 text-white" @click="load">Aplicar</button>
        <button class="px-4 py-2 rounded bg-gray-200" @click="setThisMonth">Mes actual</button>
      </div>
    </div>

    <div class="bg-white border rounded">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left">{{ groupBy==='vendor' ? 'Vendedor' : 'Tienda' }}</th>
            <th class="p-2 text-right"># Depósitos</th>
            <th class="p-2 text-right">Depósitos (L)</th>
            <th class="p-2 text-right">Conciliado (L)</th>
            <th class="p-2 text-right">Restante (L)</th>
            <th class="p-2 text-right">Ventas (L)</th>
            <th class="p-2 text-right">Ventas conciliadas (L)</th>
            <th class="p-2 text-right">Dif Ventas-Conc (L)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="p-4 text-center text-gray-500">Cargando…</td>
          </tr>
          <tr v-else v-for="r in rows" :key="r.group" class="border-t">
            <td class="p-2">{{ r.group }}</td>
            <td class="p-2 text-right">{{ r.depCount }}</td>
            <td class="p-2 text-right">{{ fmt(r.depTotal) }}</td>
            <td class="p-2 text-right">{{ fmt(r.concTotal) }}</td>
            <td class="p-2 text-right">{{ fmt(r.remTotal) }}</td>
            <td class="p-2 text-right">{{ fmt(r.saleTotal) }}</td>
            <td class="p-2 text-right">{{ fmt(r.saleConc) }}</td>
            <td class="p-2 text-right">{{ fmt(r.saleTotal - r.concTotal) }}</td>
          </tr>
          <tr v-if="!loading && rows.length===0">
            <td colspan="8" class="p-4 text-center text-gray-500">Sin datos para los filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
