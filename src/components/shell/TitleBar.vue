<script setup lang="ts">
import { connection, statusLabel } from '@/stores/connection'
import { macros } from '@/stores/macros'
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <span class="logo">▣</span>
      <span class="name">NeoMacros 面板</span>
    </div>
    <div class="conn" :class="connection.status">
      <span class="badge-dot dot" />
      <span>{{ statusLabel }}</span>
      <span v-if="connection.status === 'online' && connection.meta" class="meta">
        MC {{ connection.meta.gameVersion }} · mod v{{ connection.meta.modVersion }} ·
        :{{ macros.server?.port ?? '—' }}
      </span>
      <span v-else-if="connection.host" class="meta">{{ connection.host }}</span>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg-chrome);
  border-bottom: 1px solid var(--divider);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.logo {
  color: var(--accent);
  font-size: 15px;
}

.conn {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-2);
}

.conn .dot {
  background: var(--text-3);
}

.conn.online .dot {
  background: var(--success);
}

.conn.probing .dot,
.conn.reconnecting .dot {
  background: var(--warning);
}

.conn.unreachable .dot,
.conn.unpaired .dot {
  background: var(--danger);
}

.conn.online {
  color: var(--text-1);
}

.meta {
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
